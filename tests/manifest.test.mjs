import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, png } from './fixtures.mjs';
import { loadAlbum } from '../src/manifest.mjs';

test('normalizes public metadata without leaking filenames and snapshots actual image bytes', async (t) => {
  const f = await fixture(t);
  f.source.photos[0].referenceId = 'photo-4'; f.source.photos[0].focusBox = [0.1, 0.2, 0.8, 0.9];
  await f.writeManifest();
  const { album, images } = await loadAlbum(f.manifest);
  assert.deepEqual(album.photos[0], { id: 'photo-1', code: 'photo-1', title: 'Photo 1', group: 'Images', baseline: 'candidate', seedId: 'photo-4', faceBox: [0.1, 0.2, 0.8, 0.9], width: 3, height: 3, mimeType: 'image/png', url: '/images/photo-1', sha256: createHash('sha256').update(png(3, 3, 30)).digest('hex') });
  assert.match(album.manifestDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(album).includes(f.dir), false);
  const original = Buffer.from(images.get('photo-1').bytes);
  await writeFile(join(f.dir, 'image-1.png'), png(5, 6));
  assert.deepEqual(images.get('photo-1').bytes, original);
  assert.notEqual((await loadAlbum(f.manifest)).album.manifestDigest, album.manifestDigest);
  assert.ok(Object.isFrozen(album.photos[0]));
});

test('keeps the pre-extension digest for a legacy album while exposing each content identity', async (t) => {
  const f = await fixture(t, 1);
  const { album } = await loadAlbum(f.manifest);
  // Captured from v0.1 before adding comparisons or public content hashes.
  assert.equal(album.manifestDigest, '1134dc1cec1e4a0665e414885054ac7b9c51db385c990ae4627aee5caf8812b1');
  assert.equal(album.photos[0].sha256, createHash('sha256').update(png(3, 3, 30)).digest('hex'));
  assert.equal(Object.hasOwn(album.photos[0], 'comparisons'), false);
});

test('binds comparison roles into the digest and keeps legacy references compatible', async (t) => {
  const f = await fixture(t);
  const original = (await loadAlbum(f.manifest)).album;
  f.source.photos[0].comparisons = { previous: 'photo-3', source: 'photo-2', reference: 'photo-4' };
  await f.writeManifest();
  const first = (await loadAlbum(f.manifest)).album;
  assert.deepEqual(first.photos[0].comparisons, { source: 'photo-2', previous: 'photo-3', reference: 'photo-4' });
  assert.equal(first.photos[0].seedId, 'photo-4');
  assert.notEqual(first.manifestDigest, original.manifestDigest);
  assert.ok(Object.isFrozen(first.photos[0].comparisons));
  f.source.photos[0].referenceId = 'photo-4';
  f.source.photos[0].comparisons = { reference: 'photo-4', source: 'photo-2', previous: 'photo-3' };
  await f.writeManifest();
  assert.equal((await loadAlbum(f.manifest)).album.manifestDigest, first.manifestDigest);
  f.source.photos[0].comparisons.previous = 'photo-2'; await f.writeManifest();
  assert.notEqual((await loadAlbum(f.manifest)).album.manifestDigest, first.manifestDigest);
});

test('rejects invalid comparison roles, missing IDs, self references and contradictory legacy references', async (t) => {
  const f = await fixture(t);
  for (const comparisons of [null, [], 'photo-2', { unknown: 'photo-2' }, { source: 'missing' }, { previous: 'photo-1' }, { source: null }, { reference: 'photo-3' }]) {
    f.source.photos[0].referenceId = 'photo-4'; f.source.photos[0].comparisons = comparisons;
    await f.writeManifest();
    await assert.rejects(loadAlbum(f.manifest), undefined, JSON.stringify(comparisons));
  }
});

test('rejects escaped paths, symlinks outside the album, non-files and unsupported bytes', async (t) => {
  const f = await fixture(t); const outer = await fixture(t, 1);
  await symlink(join(outer.dir, 'image-1.png'), join(f.dir, 'escape.png'));
  await mkdir(join(f.dir, 'folder.png'));
  await writeFile(join(f.dir, 'markup.png'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const file of ['../outside.png', 'escape.png', 'folder.png', 'markup.png', 'https://example.com/a.png', '/tmp/a.png']) {
    await f.writeManifest({ ...f.source, photos: [{ ...f.source.photos[0], file }] });
    await assert.rejects(loadAlbum(f.manifest), undefined, file);
  }
});

test('rejects malformed IDs, duplicate photos, missing references and invalid focus coordinates', async (t) => {
  const f = await fixture(t);
  for (const patch of [{ id: '__proto__' }, { id: 'constructor' }, { id: 'a/b' }, { referenceId: 'absent' }, { referenceId: 'photo-1' }, { focusBox: [0.8, 0.2, 0.1, 0.9] }, { focusBox: [0, 0, 2, 1] }, { baseline: 'approved' }]) {
    await f.writeManifest({ ...f.source, photos: [{ ...f.source.photos[0], ...patch }] });
    await assert.rejects(loadAlbum(f.manifest));
  }
  for (const photos of [[], [f.source.photos[0], f.source.photos[0]]]) {
    await f.writeManifest({ ...f.source, photos }); await assert.rejects(loadAlbum(f.manifest));
  }
});

test('metadata and image content affect digest while equivalent defaults stay stable', async (t) => {
  const f = await fixture(t);
  const first = (await loadAlbum(f.manifest)).album.manifestDigest;
  f.source.photos[0].group = 'Images'; f.source.photos[0].baseline = 'candidate';
  await f.writeManifest(); assert.equal((await loadAlbum(f.manifest)).album.manifestDigest, first);
  f.source.photos[0].title = 'Changed'; await f.writeManifest();
  assert.notEqual((await loadAlbum(f.manifest)).album.manifestDigest, first);
});

test('rejects invalid image dimensions and a file exceeding the per-image bound', async (t) => {
  const f = await fixture(t, 1);
  const invalid = png(); invalid.writeUInt32BE(0, 16);
  await writeFile(join(f.dir, 'image-1.png'), invalid); await assert.rejects(loadAlbum(f.manifest));
  await writeFile(join(f.dir, 'image-1.png'), Buffer.alloc(32 * 1024 * 1024 + 1));
  await assert.rejects(loadAlbum(f.manifest));
});

test('reads JPEG and WebP dimensions from bytes, independent of extension', async (t) => {
  const f = await fixture(t, 1);
  // Synthetic 1×1 JPEG (single component, baseline frame) and lossy WebP.
  const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0000ffd9', 'hex');
  const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  for (const [bytes, mimeType] of [[jpeg, 'image/jpeg'], [webp, 'image/webp']]) {
    await writeFile(join(f.dir, 'image-1.png'), bytes);
    const { album } = await loadAlbum(f.manifest);
    assert.equal(album.photos[0].mimeType, mimeType); assert.equal(album.photos[0].width, 1); assert.equal(album.photos[0].height, 1);
    await writeFile(join(f.dir, 'image-1.png'), bytes.subarray(0, -4)); await assert.rejects(loadAlbum(f.manifest));
  }
});
