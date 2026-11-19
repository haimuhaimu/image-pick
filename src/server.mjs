import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { saveReceipt, readFeedback } from './review-store.mjs';

const MAX_BODY = 4 * 1024 * 1024;
const web = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/model.mjs', ['model.mjs', 'text/javascript; charset=utf-8']],
]);

function reject(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sameToken(actual, expected) {
  return typeof actual === 'string' && Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function requestJson(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) reject('Use Content-Type: application/json');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') reject('Encoded request bodies are unsupported');
  if (Number(req.headers['content-length']) > MAX_BODY) { req.resume(); reject('Request exceeds 4 MiB'); }
  const bytes = await new Promise((resolve, rejectBody) => {
    let size = 0, tooLarge = false; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { tooLarge = true; chunks.length = 0; rejectBody(Object.assign(new Error('Request exceeds 4 MiB'), { statusCode: 400 })); }
      else if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks)); });
    req.on('error', rejectBody);
    req.on('aborted', () => rejectBody(Object.assign(new Error('Request interrupted'), { statusCode: 400 })));
  });
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { reject('Malformed JSON request'); }
}

export function createAlbumServer({ album, images, reviewsDirectory, reviewContext=null }) {
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      const host = `127.0.0.1:${server.address().port}`; const origin = `http://${host}`;
      const count = key => req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === key).length;
      if (count('host') !== 1 || req.headers.host !== host || count('origin') > 1 || count('x-image-pick-token') > 1 || count('x-image-pick-context') > 1) reject('Untrusted request source', 403);
      if (req.headers.origin !== undefined && req.headers.origin !== origin) reject('Untrusted request origin', 403);
      const site = req.headers['sec-fetch-site'];
      if (site !== undefined && site !== 'same-origin' && !(site === 'none' && req.method === 'GET')) reject('Untrusted fetch source', 403);
      if (req.method === 'POST' && (req.headers.origin !== origin || !sameToken(req.headers['x-image-pick-token'], token))) reject('Invalid submission origin or token', 403);
      if (req.method === 'POST' && req.headers['sec-fetch-mode'] && !['cors', 'same-origin'].includes(req.headers['sec-fetch-mode'])) reject('Untrusted fetch mode', 403);
      if (req.method === 'POST' && req.headers['sec-fetch-dest'] && req.headers['sec-fetch-dest'] !== 'empty') reject('Untrusted fetch destination', 403);
      // Exact allowlist routing: never resolve a request URL as a filesystem path.
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/api/album') {
        const { receipt } = await readFeedback(album, reviewsDirectory);
        return json(res, 200, { album, token, receipt, ...(reviewContext ? {reviewContext} : {}) });
      }
      if (req.method === 'POST' && path === '/api/feedback') {
        if ((req.headers['x-image-pick-context'] ?? null)!==(reviewContext?.contextDigest ?? null)) reject('复评范围已改变；请保留草稿并重新打开相册。',409);
        const payload = await requestJson(req);
        const receipt = await saveReceipt(album, payload, reviewsDirectory, {currentPhotoIds:reviewContext?.currentPhotoIds ?? null});
        return json(res, 200, { receipt });
      }
      if (req.method === 'GET' && path.startsWith('/images/')) {
        const image = images.get(path.slice('/images/'.length));
        if (!image) return json(res, 404, { error: 'Image not found' });
        res.writeHead(200, { 'Content-Type': image.mimeType, 'Content-Length': image.bytes.length });
        return res.end(image.bytes);
      }
      if (req.method === 'GET' && web.has(path)) {
        const [file, type] = web.get(path);
        const bytes = await readFile(new URL(`../web/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length }); return res.end(bytes);
      }
      json(res, 404, { error: 'Route not found' });
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      const status = [400, 403, 409].includes(error.statusCode) ? error.statusCode : 500;
      json(res, status, { error: status === 500 ? 'Unable to read or save local review data' : error.message });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  return server;
}
