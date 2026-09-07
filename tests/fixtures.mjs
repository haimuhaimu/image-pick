import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

export function png(width = 2, height = 3, color = 200) {
  const chunk = (type, data) => {
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, color);
  for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export async function fixture(t, count = 4) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'image-pick-test-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = { schemaVersion: 1, id: 'test-album', revision: '1', title: 'Synthetic album', photos: [] };
  for (let i = 1; i <= count; i++) {
    const name = `image-${i}.png`;
    await writeFile(join(dir, name), png(2 + i, 3, 30 * i));
    source.photos.push({ id: `photo-${i}`, file: name, title: `Photo ${i}`, ...(i === count ? { baseline: 'selected' } : {}) });
  }
  const manifest = join(dir, 'album.json');
  const writeManifest = async (value = source) => writeFile(manifest, JSON.stringify(value));
  await writeManifest();
  return { dir, manifest, source, writeManifest, reviews: join(dir, 'private', 'reviews') };
}

export function submission(album, submissionId = 'submission-1') {
  return { schemaVersion: 1, albumId: album.id, manifestDigest: album.manifestDigest, submissionId,
    photos: album.photos.map(({ id }) => ({ id, localVerdict: null, note: '', statusUpdatedAt: null, noteUpdatedAt: null })) };
}
