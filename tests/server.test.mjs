import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, png, submission } from './fixtures.mjs';
import { loadAlbum } from '../src/manifest.mjs';
import { createAlbumServer } from '../src/server.mjs';

async function running(t) {
  const f = await fixture(t); const loaded = await loadAlbum(f.manifest);
  const server = createAlbumServer({ ...loaded, reviewsDirectory: f.reviews });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { ...f, ...loaded, server, url };
}

function http(url, { path = '/api/album', method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${url}${path}`, { method, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks), json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('bootstrap returns token and only public metadata while image route retains original snapshot', async (t) => {
  const f = await running(t);
  const first = await http(f.url); const bootstrap = first.json();
  assert.equal(first.status, 200); assert.equal(bootstrap.receipt, null); assert.deepEqual(bootstrap.album, f.album);
  assert.ok(bootstrap.token.length >= 32); assert.equal(first.headers['cache-control'], 'no-store');
  assert.match(first.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(first.headers['x-content-type-options'], 'nosniff'); assert.equal(first.headers['x-frame-options'], 'DENY');
  await writeFile(join(f.dir, 'image-1.png'), png(9, 9));
  const image = await http(f.url, { path: '/images/photo-1' });
  assert.equal(image.status, 200); assert.equal(image.headers['content-type'], 'image/png');
  assert.deepEqual(image.bytes, f.images.get('photo-1').bytes);
  for (const path of ['/album.json', '/images/../album.json', '/images/%2e%2e%2falbum.json', '/images/unknown', '/src/server.mjs']) {
    const response = await http(f.url, { path }); assert.equal(response.status, 404, path);
  }
});

test('host, origin, fetch metadata and submission token reject cross-origin access', async (t) => {
  const f = await running(t); const { token } = (await http(f.url)).json();
  for (const headers of [{ Host: 'evil.test' }, { Host: `localhost:${f.server.address().port}` }, { Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await http(f.url, { headers }); assert.equal(response.status, 403); assert.equal(typeof response.json().error, 'string');
  }
  const headers = { Origin: f.url, 'Content-Type': 'application/json', 'X-Image-Pick-Token': token };
  for (const patch of [{ Origin: '' }, { Origin: 'https://evil.test' }, { 'X-Image-Pick-Token': '' }, { 'X-Image-Pick-Token': 'wrong' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    const response = await http(f.url, { method: 'POST', path: '/api/feedback', headers: { ...headers, ...patch }, body: JSON.stringify(submission(f.album)) });
    assert.equal(response.status, 403); assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
});

test('HTTP validates payloads and confirms durable idempotent receipts with collision 409', async (t) => {
  const f = await running(t); const { token } = (await http(f.url)).json();
  const headers = { Origin: f.url, 'Content-Type': 'application/json', 'X-Image-Pick-Token': token };
  const send = (body, extra = {}) => http(f.url, { path: '/api/feedback', method: 'POST', headers: { ...headers, ...extra }, body });
  for (const body of ['{', JSON.stringify({ ...submission(f.album), manifestDigest: '0'.repeat(64) }), ' '.repeat(4 * 1024 * 1024 + 1)]) {
    assert.equal((await send(body)).status, 400);
  }
  assert.equal((await send(JSON.stringify(submission(f.album)), { 'Content-Type': 'text/plain' })).status, 400);
  const payload = submission(f.album); payload.photos[0].localVerdict = 'selected';
  const first = await send(JSON.stringify(payload)); assert.equal(first.status, 200);
  const retry = await send(JSON.stringify(payload)); assert.deepEqual(retry.json(), first.json());
  payload.photos[0].note = 'changed'; assert.equal((await send(JSON.stringify(payload))).status, 409);
  assert.deepEqual((await http(f.url)).json().receipt, first.json().receipt);
});

test('write failures return a generic JSON 500 without filesystem paths', async (t) => {
  const f = await running(t); const { token } = (await http(f.url)).json();
  await writeFile(join(f.dir, 'private'), 'not a directory');
  const result = await http(f.url, { method: 'POST', path: '/api/feedback', headers: { Origin: f.url, 'Content-Type': 'application/json', 'X-Image-Pick-Token': token }, body: JSON.stringify(submission(f.album)) });
  assert.equal(result.status, 500); assert.equal(result.bytes.toString().includes(f.dir), false);
});
