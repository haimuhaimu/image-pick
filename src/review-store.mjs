import { lstat, mkdir, chmod, open, readdir, link, unlink, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validId } from './manifest.mjs';

const MAX_RECEIPT = 8 * 1024 * 1024;
let lastSubmittedAt = 0;

function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}

// Keep case-sensitive public IDs distinct on case-insensitive filesystems, and
// avoid Windows device names without narrowing the public ID contract.
function storageId(id) { return `id-${Buffer.from(id, 'utf8').toString('hex')}`; }

function receiptId(filename) {
  if (!/^id-(?:[a-f0-9]{2}){1,80}\.json$/.test(filename)) fail('Invalid receipt filename', 500);
  const id = Buffer.from(filename.slice(3, -5), 'hex').toString('utf8');
  if (!validId(id) || `${storageId(id)}.json` !== filename) fail('Invalid receipt filename', 500);
  return id;
}

function isTimestamp(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59;
}

function normalizeRequest(album, request) {
  if (!request || request.schemaVersion !== 1 || request.albumId !== album.id || request.manifestDigest !== album.manifestDigest || !validId(request.submissionId)) fail('Submission does not match this album or has an invalid ID');
  if (!Array.isArray(request.photos) || request.photos.length !== album.photos.length) fail('Include each photo exactly once');
  const rows = new Map();
  for (const row of request.photos) {
    if (!row || !validId(row.id) || rows.has(row.id) || ![null, 'selected', 'rework', 'reject'].includes(row.localVerdict)) fail('Invalid photo ID or local verdict');
    if (typeof row.note !== 'string' || row.note.length > 4000) fail('Notes must contain at most 4000 characters');
    if (!isTimestamp(row.statusUpdatedAt) || !isTimestamp(row.noteUpdatedAt)) fail('Invalid update timestamp');
    rows.set(row.id, { id: row.id, localVerdict: row.localVerdict, note: row.note, statusUpdatedAt: row.statusUpdatedAt, noteUpdatedAt: row.noteUpdatedAt });
  }
  const photos = album.photos.map(photo => {
    if (!rows.has(photo.id)) fail('Include each known photo exactly once');
    return rows.get(photo.id);
  });
  const normalized = { schemaVersion: 1, albumId: album.id, manifestDigest: album.manifestDigest, submissionId: request.submissionId, photos };
  if (Buffer.byteLength(JSON.stringify(normalized)) > 4 * 1024 * 1024) fail('Request exceeds 4 MiB');
  return normalized;
}

function withAuthority(album, request, submittedAt) {
  return { ...request, photos: request.photos.map((photo, i) => ({ ...photo, baseline: album.photos[i].baseline, title: album.photos[i].title })),
    revision: album.revision, submittedAt, projectRegistryModified: false };
}

function validateReceipt(album, value) {
  try {
    if (!value || value.submittedAt === null || !isTimestamp(value.submittedAt)) fail('Invalid submittedAt');
    const request = normalizeRequest(album, value);
    const normalized = withAuthority(album, request, value.submittedAt);
    if (!isDeepStrictEqual(value, normalized)) fail('Receipt metadata does not match the album');
    return normalized;
  } catch { fail('Invalid receipt on disk', 500); }
}

async function directory(path, create) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) fail('Review directory must be a real directory', 500);
  if (create && (info.mode & 0o777) !== 0o700) await chmod(path, 0o700);
  return path;
}

async function storeDirectory(album, reviewsDirectory, create) {
  if (!validId(album.id) || !/^[a-f0-9]{64}$/.test(album.manifestDigest)) fail('Invalid album binding');
  const root = resolve(reviewsDirectory);
  try {
    // Resolve the caller-owned parent (e.g. macOS /var) while refusing links at
    // the private review root and every directory ImagePick owns below it.
    if (create) await mkdir(dirname(root), { recursive: true, mode: 0o700 });
    const parent = await realpath(dirname(root));
    const privateRoot = await directory(join(parent, basename(root)), create);
    const albumRoot = await directory(join(privateRoot, storageId(album.id)), create);
    return await directory(join(albumRoot, album.manifestDigest), create);
  } catch (error) {
    if (!create && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readReceipt(album, path, expectedId) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size <= 0 || info.size > MAX_RECEIPT) fail('Invalid receipt file', 500);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== info.size || opened.ino !== info.ino || opened.dev !== info.dev) fail('Receipt changed while reading', 500);
    const bytes = Buffer.alloc(info.size + 1); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size) fail('Receipt changed while reading', 500);
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))); } catch { fail('Malformed receipt file', 500); }
    const receipt = validateReceipt(album, value);
    if (receipt.submissionId !== expectedId) fail('Receipt ID does not match its filename', 500);
    return receipt;
  } finally { await handle.close(); }
}

export async function saveReceipt(album, request, reviewsDirectory) {
  const normalized = normalizeRequest(album, request);
  const dir = await storeDirectory(album, reviewsDirectory, true);
  const destination = join(dir, `${storageId(normalized.submissionId)}.json`);
  const retry = async () => {
    const previous = await readReceipt(album, destination, normalized.submissionId);
    if (!isDeepStrictEqual(normalizeRequest(album, previous), normalized)) fail('Submission ID already contains a different snapshot', 409);
    return previous;
  };
  try { return await retry(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  lastSubmittedAt = Math.max(Date.now(), lastSubmittedAt + 1);
  const receipt = withAuthority(album, normalized, new Date(lastSubmittedAt).toISOString());
  const temporary = join(dir, `.pending-${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${JSON.stringify(receipt)}\n`); await handle.sync(); await handle.close(); handle = null;
    // A hard link publishes complete bytes atomically and cannot replace evidence.
    try { await link(temporary, destination); }
    catch (error) { if (error.code === 'EEXIST') return await retry(); throw error; }
    const dirHandle = await open(dir, constants.O_RDONLY);
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    return receipt;
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function readFeedback(album, reviewsDirectory, sinceId = null) {
  if (sinceId !== null && !validId(sinceId)) fail('Invalid since submission ID');
  const dir = await storeDirectory(album, reviewsDirectory, false);
  const receipts = [];
  if (dir) {
    for (const filename of await readdir(dir)) {
      if (filename.startsWith('.pending-')) continue;
      receipts.push(await readReceipt(album, join(dir, filename), receiptId(filename)));
    }
  }
  receipts.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || (a.submissionId < b.submissionId ? -1 : a.submissionId > b.submissionId ? 1 : 0));
  const receipt = receipts.at(-1) ?? null;
  const summary = { selected: 0, rework: 0, reject: 0, unreviewed: 0, baselineSelected: album.photos.filter(p => p.baseline === 'selected').length };
  for (const photo of receipt?.photos ?? album.photos) summary[photo.localVerdict ?? 'unreviewed']++;
  let changes = null;
  if (sinceId !== null) {
    const since = receipts.find(r => r.submissionId === sinceId);
    if (!since) fail('Unknown submission ID for this album version');
    changes = [];
    for (let i = 0; i < album.photos.length; i++) {
      const before = since.photos[i], after = receipt.photos[i];
      if (before.localVerdict !== after.localVerdict || before.note !== after.note) changes.push({ id: after.id, before: { localVerdict: before.localVerdict, note: before.note }, after: { localVerdict: after.localVerdict, note: after.note } });
    }
  }
  return { albumId: album.id, manifestDigest: album.manifestDigest, receipt, summary, changes };
}
