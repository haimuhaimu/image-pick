import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat, writeFile, symlink, unlink, mkdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fixture, submission } from './fixtures.mjs';
import { loadAlbum } from '../src/manifest.mjs';
import { saveReceipt, readFeedback } from '../src/review-store.mjs';

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path)); else out.push(path);
  }
  return out;
}

test('an absent receipt is empty feedback with baseline separate from local verdicts', async (t) => {
  const f = await fixture(t); const { album } = await loadAlbum(f.manifest);
  const feedback = await readFeedback(album, f.reviews);
  assert.deepEqual(feedback, { albumId: album.id, manifestDigest: album.manifestDigest, receipt: null,
    summary: { selected: 0, rework: 0, reject: 0, unreviewed: 4, baselineSelected: 1 }, changes: null });
  await assert.rejects(stat(f.reviews), { code: 'ENOENT' });
});

test('reads and retries a pre-extension receipt without changing its bytes or optional fields', async (t) => {
  const f = await fixture(t, 1); const { album } = await loadAlbum(f.manifest);
  // Literal receipt captured before implementing the optional tag fields.
  const legacy = '{"schemaVersion":1,"albumId":"test-album","manifestDigest":"1134dc1cec1e4a0665e414885054ac7b9c51db385c990ae4627aee5caf8812b1","submissionId":"legacy-snapshot","photos":[{"id":"photo-1","localVerdict":null,"note":"","statusUpdatedAt":null,"noteUpdatedAt":null,"baseline":"selected","title":"Photo 1"}],"revision":"1","submittedAt":"2026-09-07T00:00:00.000Z","projectRegistryModified":false}';
  const dir = join(f.reviews, `id-${Buffer.from('test-album').toString('hex')}`, '1134dc1cec1e4a0665e414885054ac7b9c51db385c990ae4627aee5caf8812b1');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `id-${Buffer.from('legacy-snapshot').toString('hex')}.json`);
  await writeFile(path, legacy);
  assert.deepEqual((await readFeedback(album, f.reviews)).receipt, JSON.parse(legacy));
  assert.deepEqual(await saveReceipt(album, submission(album, 'legacy-snapshot'), f.reviews), JSON.parse(legacy));
  assert.equal(await readFile(path, 'utf8'), legacy);
});

test('tags survive receipts and retries independently of verdicts and produce semantic differences', async (t) => {
  const f = await fixture(t, 1); const { album } = await loadAlbum(f.manifest);
  await saveReceipt(album, submission(album, 'before-tags'), f.reviews);
  const request = submission(album, 'tagged');
  Object.assign(request.photos[0], { issueTags: ['identity', 'details'], issuesUpdatedAt: '2026-11-18T01:00:00.000Z' });
  const receipt = await saveReceipt(album, request, f.reviews);
  assert.deepEqual(receipt.photos[0].issueTags, ['identity', 'details']);
  assert.equal(receipt.photos[0].localVerdict, null);
  assert.deepEqual(await saveReceipt(album, request, f.reviews), receipt);
  assert.deepEqual((await readFeedback(album, f.reviews, 'before-tags')).changes, [{ id: 'photo-1', before: { localVerdict: null, note: '' }, after: { localVerdict: null, note: '', issueTags: ['identity', 'details'] } }]);
  const timestampOnly = structuredClone(request); timestampOnly.submissionId = 'later-time'; timestampOnly.photos[0].issuesUpdatedAt = '2026-11-18T02:00:00.000Z';
  await saveReceipt(album, timestampOnly, f.reviews);
  assert.deepEqual((await readFeedback(album, f.reviews, 'tagged')).changes, []);
  const cleared = structuredClone(timestampOnly); cleared.submissionId = 'cleared'; cleared.photos[0].issueTags = [];
  await saveReceipt(album, cleared, f.reviews);
  assert.deepEqual((await readFeedback(album, f.reviews, 'tagged')).changes[0].after.issueTags, []);
  request.photos[0].issueTags = ['color'];
  await assert.rejects(saveReceipt(album, request, f.reviews), { statusCode: 409 });
});

test('rejects malformed or incomplete tag fields before recording feedback', async (t) => {
  const f = await fixture(t, 1); const { album } = await loadAlbum(f.manifest);
  for (const fields of [{ issueTags: ['identity'] }, { issuesUpdatedAt: null }, { issueTags: 'identity', issuesUpdatedAt: null }, { issueTags: ['execute'], issuesUpdatedAt: null }, { issueTags: ['color', 'color'], issuesUpdatedAt: null }, { issueTags: [], issuesUpdatedAt: '2026-02-30T00:00:00.000Z' }]) {
    const request = submission(album); Object.assign(request.photos[0], fields);
    await assert.rejects(saveReceipt(album, request, f.reviews), { statusCode: 400 });
  }
  await assert.rejects(stat(f.reviews), { code: 'ENOENT' });
});

test('receipts are authoritative, private, append-only and idempotent even under concurrent retries', async (t) => {
  const f = await fixture(t); const { album } = await loadAlbum(f.manifest);
  const req = submission(album); req.photos[0].localVerdict = 'rework'; req.photos[0].note = '<b>Keep pose</b>';
  const receipts = await Promise.all(Array.from({ length: 4 }, () => saveReceipt(album, req, f.reviews)));
  for (const receipt of receipts) assert.deepEqual(receipt, receipts[0]);
  const receipt = receipts[0];
  assert.equal(receipt.projectRegistryModified, false); assert.equal(receipt.revision, '1');
  assert.equal(receipt.photos[3].baseline, 'selected'); assert.equal(receipt.photos[0].title, 'Photo 1');
  assert.equal(receipt.photos[0].note, '<b>Keep pose</b>'); assert.ok(Date.parse(receipt.submittedAt));
  const saved = (await files(f.reviews)).filter((name) => name.endsWith('.json'));
  assert.equal(saved.length, 1);
  assert.equal((await stat(saved[0])).mode & 0o777, 0o600);
  assert.equal((await stat(f.reviews)).mode & 0o777, 0o700);
  const evidence = await readFile(saved[0], 'utf8');
  req.photos[0].note = 'Different';
  await assert.rejects(saveReceipt(album, req, f.reviews), { statusCode: 409 });
  assert.equal(await readFile(saved[0], 'utf8'), evidence);
  const feedback = await readFeedback(album, f.reviews);
  assert.deepEqual(feedback.summary, { selected: 0, rework: 1, reject: 0, unreviewed: 3, baselineSelected: 1 });
});

test('validates exact photo coverage, binding, notes, timestamps and verdicts', async (t) => {
  const f = await fixture(t); const { album } = await loadAlbum(f.manifest);
  for (const mutate of [
    r => { r.manifestDigest = '0'.repeat(64); }, r => { r.albumId = 'other'; }, r => { r.submissionId = '../escape'; },
    r => { r.photos.pop(); }, r => { r.photos[1] = r.photos[0]; }, r => { r.photos[0].id = 'unknown'; },
    r => { r.photos[0].note = 'a'.repeat(4001); }, r => { r.photos[0].statusUpdatedAt = 'yesterday'; },
    r => { r.photos[0].noteUpdatedAt = '2026-02-30T00:00:00.000Z'; }, r => { r.photos[0].localVerdict = 'approved'; },
  ]) {
    const req = submission(album); mutate(req);
    await assert.rejects(saveReceipt(album, req, f.reviews), { statusCode: 400 });
  }
});

test('compares saved snapshots by verdict and note and refuses unknown or wrong-version since IDs', async (t) => {
  const f = await fixture(t); const { album } = await loadAlbum(f.manifest);
  const before = submission(album, 'before'); await saveReceipt(album, before, f.reviews);
  const after = submission(album, 'after'); after.photos[0].localVerdict = 'selected';
  after.photos[1].noteUpdatedAt = '2026-09-07T00:00:00.000Z';
  await saveReceipt(album, after, f.reviews);
  const feedback = await readFeedback(album, f.reviews, 'before');
  assert.deepEqual(feedback.changes, [{ id: 'photo-1', before: { localVerdict: null, note: '' }, after: { localVerdict: 'selected', note: '' } }]);
  await assert.rejects(readFeedback(album, f.reviews, 'missing'));
  await assert.rejects(readFeedback({ ...album, manifestDigest: 'a'.repeat(64) }, f.reviews, 'before'));
});

test('refuses tampered and symlinked receipt files and symlinked store directories', async (t) => {
  const f = await fixture(t); const { album } = await loadAlbum(f.manifest);
  const receipt = await saveReceipt(album, submission(album), f.reviews);
  const saved = (await files(f.reviews)).find((name) => name.endsWith('.json'));
  await writeFile(saved, JSON.stringify({ ...receipt, revision: 'tampered' }));
  await assert.rejects(readFeedback(album, f.reviews));
  await writeFile(join(f.dir, 'external.json'), JSON.stringify(receipt));
  await unlink(saved); await symlink(join(f.dir, 'external.json'), saved);
  await assert.rejects(readFeedback(album, f.reviews));
  await symlink(f.reviews, join(f.dir, 'linked-reviews'));
  await assert.rejects(saveReceipt(album, submission(album, 'another'), join(f.dir, 'linked-reviews')));
});

test('validates disk filename identity and uses submission ID as deterministic timestamp tie-break', async (t) => {
  const f = await fixture(t); const { album } = await loadAlbum(f.manifest);
  const a = await saveReceipt(album, submission(album, 'alpha'), f.reviews);
  const z = submission(album, 'zulu'); z.photos[0].localVerdict = 'reject';
  const b = await saveReceipt(album, z, f.reviews);
  const saved = await files(f.reviews);
  const later = (await Promise.all(saved.map(async path => ({ path, receipt: JSON.parse(await readFile(path, 'utf8')) })))).find(item => item.receipt.submissionId === 'zulu').path;
  await writeFile(later, JSON.stringify({ ...b, submittedAt: a.submittedAt }));
  assert.equal((await readFeedback(album, f.reviews)).receipt.submissionId, 'zulu');
  await writeFile(later, JSON.stringify({ ...b, submissionId: 'wrong' }));
  await assert.rejects(readFeedback(album, f.reviews));
});

test('rejects oversized direct submissions before creating unreadable evidence', async (t) => {
  const f = await fixture(t, 1); const { album } = await loadAlbum(f.manifest);
  const largeAlbum = { ...album, photos: Array.from({ length: 500 }, (_, i) => ({ ...album.photos[0], id: `photo-${i}` })) };
  const req = submission(largeAlbum); for (const row of req.photos) row.note = '\u0000'.repeat(4000);
  await assert.rejects(saveReceipt(largeAlbum, req, f.reviews), { statusCode: 400 });
  await assert.rejects(stat(f.reviews), { code: 'ENOENT' });
});

test('rejects malformed UTF-8 evidence instead of silently replacing invalid note bytes', async (t) => {
  const f = await fixture(t); const { album } = await loadAlbum(f.manifest);
  const req = submission(album); req.photos[0].note = 'unique-note-marker';
  await saveReceipt(album, req, f.reviews);
  const saved = (await files(f.reviews)).find(name => name.endsWith('.json'));
  const bytes = await readFile(saved);
  const marker = bytes.indexOf('unique-note-marker'); assert.ok(marker >= 0);
  bytes[marker] = 0xff; await writeFile(saved, bytes);
  await assert.rejects(readFeedback(album, f.reviews), { statusCode: 500 });
});

test('distinct submission IDs differing only in case remain independent snapshots', async (t) => {
  const f = await fixture(t); const { album } = await loadAlbum(f.manifest);
  const first = await saveReceipt(album, submission(album, 'case-test'), f.reviews);
  const secondRequest = submission(album, 'CASE-TEST'); secondRequest.photos[0].note = 'another snapshot';
  const second = await saveReceipt(album, secondRequest, f.reviews);
  assert.equal(first.submissionId, 'case-test'); assert.equal(second.submissionId, 'CASE-TEST');
  assert.equal((await files(f.reviews)).length, 2);
  assert.deepEqual((await readFeedback(album, f.reviews, 'case-test')).changes, [{ id: 'photo-1', before: { localVerdict: null, note: '' }, after: { localVerdict: null, note: 'another snapshot' } }]);
  assert.deepEqual(await saveReceipt(album, submission(album, 'case-test'), f.reviews), first);
});

test('valid public IDs do not become reserved Windows directory or file basenames', async (t) => {
  const f = await fixture(t); f.source.id = 'NUL'; await f.writeManifest();
  const { album } = await loadAlbum(f.manifest);
  const receipt = await saveReceipt(album, submission(album, 'CON'), f.reviews);
  assert.equal(receipt.albumId, 'NUL'); assert.equal(receipt.submissionId, 'CON');
  for (const path of await files(f.reviews)) {
    for (const segment of relative(f.reviews, path).split(sep)) {
      assert.doesNotMatch(segment, /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i);
      assert.doesNotMatch(segment, /[. ]$/);
    }
  }
});
