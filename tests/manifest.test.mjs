import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, png } from './fixtures.mjs';
import { loadAlbum } from '../src/manifest.mjs';

test('normalizes public metadata without leaking filenames and snapshots actual image bytes', async (t) => {
  const f = await fixture(t);
  f.source.photos[0].referenceId = 'photo-4'; f.source.photos[0].focusBox = [0.1, 0.2, 0.8, 0.9];
  await f.writeManifest();
  const { album, images } = await loadAlbum(f.manifest);
  assert.deepEqual(album.photos[0], { id: 'photo-1', code: 'photo-1', title: 'Photo 1', group: 'Images', baseline: 'candidate', seedId: 'photo-4', faceBox: [0.1, 0.2, 0.8, 0.9], width: 3, height: 3, mimeType: 'image/png', url: '/images/photo-1' });
  assert.match(album.manifestDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(album).includes(f.dir), false);
  const original = Buffer.from(images.get('photo-1').bytes);
  await writeFile(join(f.dir, 'image-1.png'), png(5, 6));
  assert.deepEqual(images.get('photo-1').bytes, original);
  assert.notEqual((await loadAlbum(f.manifest)).album.manifestDigest, album.manifestDigest);
  assert.ok(Object.isFrozen(album.photos[0]));
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
