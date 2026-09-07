import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const MAX_IMAGE = 32 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;
const forbiddenIds = new Set(['__proto__', 'prototype', 'constructor', ...Object.getOwnPropertyNames(Object.prototype)]);

export function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) && !forbiddenIds.has(value);
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function plainText(value, label, limit) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value), `Invalid ${label}`);
  return value;
}

async function boundedFile(path, limit) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    requireValue(info.isFile(), 'Expected a regular file');
    requireValue(info.size > 0 && info.size <= limit, 'File exceeds size limit or is empty');
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    requireValue(offset === info.size, 'File changed while loading');
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

function dimensions(bytes) {
  let width, height, mimeType;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    requireValue(bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR', 'Invalid PNG header');
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mimeType = 'image/png';
    const validDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    requireValue(validDepths[bytes[25]]?.includes(bytes[24]) && bytes[26] === 0 && bytes[27] === 0 && bytes[28] <= 1, 'Unsupported PNG header');
    let offset = 8, sawData = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8);
      requireValue(offset + size + 12 <= bytes.length, 'Truncated PNG');
      if (type === 'IDAT') sawData = true;
      offset += size + 12;
      if (type === 'IEND') { ended = size === 0 && offset === bytes.length; break; }
    }
    requireValue(sawData && ended, 'Incomplete PNG');
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = 'image/jpeg';
    requireValue(bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9, 'Incomplete JPEG');
    let offset = 2;
    while (offset + 3 < bytes.length) {
      requireValue(bytes[offset++] === 0xff, 'Invalid JPEG marker');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const size = bytes.readUInt16BE(offset);
      requireValue(size >= 2 && offset + size <= bytes.length, 'Invalid JPEG segment');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        requireValue(size >= 8 && size === 8 + 3 * bytes[offset + 7], 'Invalid JPEG frame');
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5);
      }
      offset += size;
    }
  } else if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    mimeType = 'image/webp';
    requireValue(bytes.readUInt32LE(4) + 8 === bytes.length, 'Invalid WebP length');
    let offset = 12, sawImage = false;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString('ascii', offset, offset + 4); const size = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      requireValue(start + size + (size % 2) <= bytes.length, 'Truncated WebP');
      if (type === 'VP8X') {
        requireValue(size === 10, 'Invalid WebP extended header');
        width = bytes.readUIntLE(start + 4, 3) + 1; height = bytes.readUIntLE(start + 7, 3) + 1;
      } else if (type === 'VP8 ') {
        requireValue(size >= 10 && (bytes[start] & 1) === 0 && bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a])), 'Invalid WebP frame');
        width ??= bytes.readUInt16LE(start + 6) & 0x3fff; height ??= bytes.readUInt16LE(start + 8) & 0x3fff; sawImage = true;
      } else if (type === 'VP8L') {
        requireValue(size >= 5 && bytes[start] === 0x2f && bytes[start + 4] < 32, 'Invalid lossless WebP');
        const packed = bytes.readUInt32LE(start + 1);
        width ??= (packed & 0x3fff) + 1; height ??= ((packed >>> 14) & 0x3fff) + 1; sawImage = true;
      } else if (type === 'ANMF') { sawImage = size >= 16; }
      offset = start + size + (size % 2);
    }
    requireValue(offset === bytes.length && sawImage, 'Incomplete WebP');
  } else { throw new Error('Unsupported image bytes; use PNG, JPEG or WebP'); }
  requireValue(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 0x7fffffff && height <= 0x7fffffff, 'Invalid image dimensions');
  return { width, height, mimeType };
}

function freeze(value) {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
}

export async function loadAlbum(manifestPath) {
  const absolute = await realpath(resolve(manifestPath));
  const root = dirname(absolute);
  let manifest;
  try { manifest = JSON.parse((await boundedFile(absolute, 4 * 1024 * 1024)).toString('utf8')); }
  catch (error) { throw new Error(`Cannot read manifest: ${error.code ?? error.message}`); }
  requireValue(manifest && manifest.schemaVersion === 1 && validId(manifest.id), 'Invalid manifest schema or album ID');
  plainText(manifest.revision, 'revision', 80); plainText(manifest.title, 'album title', 500);
  requireValue(Array.isArray(manifest.photos) && manifest.photos.length >= 1 && manifest.photos.length <= 500, 'Expected 1–500 photos');
  const ids = new Set(); const photos = []; const images = new Map(); const hashes = []; let total = 0;
  for (const photo of manifest.photos) {
    requireValue(photo && validId(photo.id) && !ids.has(photo.id), 'Invalid or duplicate photo ID'); ids.add(photo.id);
    const title = plainText(photo.title, 'photo title', 500);
    const group = plainText(photo.group ?? 'Images', 'group', 200);
    const baseline = photo.baseline ?? 'candidate';
    requireValue(['candidate', 'selected'].includes(baseline), 'Invalid baseline');
    const seedId = photo.referenceId ?? null, faceBox = photo.focusBox ?? null;
    requireValue(seedId === null || (validId(seedId) && seedId !== photo.id), 'Invalid reference');
    requireValue(faceBox === null || (Array.isArray(faceBox) && faceBox.length === 4 && faceBox.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && faceBox[0] < faceBox[2] && faceBox[1] < faceBox[3]), 'Invalid focus box');
    const file = photo.file;
    requireValue(typeof file === 'string' && file.length > 0 && !isAbsolute(file) && !file.includes('\\') && !file.includes('\0') && !/^[A-Za-z][A-Za-z\d+.-]*:/.test(file) && !file.split('/').includes('..'), 'Image path must be local and contained');
    const path = await realpath(resolve(root, file)); const rel = relative(root, path);
    requireValue(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Image path escapes manifest directory');
    const bytes = await boundedFile(path, Math.min(MAX_IMAGE, MAX_TOTAL - total)); total += bytes.length;
    const info = dimensions(bytes);
    photos.push({ id: photo.id, code: photo.id, title, group, baseline, seedId, faceBox: faceBox?.slice() ?? null, ...info, url: `/images/${photo.id}` });
    images.set(photo.id, Object.freeze({ bytes, mimeType: info.mimeType }));
    hashes.push(createHash('sha256').update(bytes).digest('hex'));
  }
  requireValue(photos.every(p => p.seedId === null || ids.has(p.seedId)), 'Reference photo does not exist');
  const metadata = { schemaVersion: 1, id: manifest.id, revision: manifest.revision, title: manifest.title, photos };
  const manifestDigest = createHash('sha256').update(JSON.stringify({ metadata, imageHashes: hashes })).digest('hex');
  return { album: freeze({ ...metadata, manifestDigest }), images };
}
