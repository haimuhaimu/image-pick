import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, stat, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, submission } from './fixtures.mjs';
import { loadAlbum } from '../src/manifest.mjs';
import { saveReceipt } from '../src/review-store.mjs';
import { generateDemo } from '../scripts/demo.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/image-pick.mjs', import.meta.url));

test('CLI works outside the package, distinguishes empty feedback, and rejects unknown options', async (t) => {
  const f = await fixture(t);
  const run = args => exec(process.execPath, [cli, ...args], { cwd: f.dir });
  const album = JSON.parse((await run(['validate', './album.json'])).stdout);
  assert.equal(album.id, 'test-album');
  const empty = JSON.parse((await run(['feedback', './album.json'])).stdout);
  assert.equal(empty.receipt, null); assert.equal(empty.summary.baselineSelected, 1); assert.equal(empty.summary.selected, 0);
  assert.match((await run(['--help'])).stdout, /serve/);
  await assert.rejects(stat(join(f.dir, '.image-pick')), { code: 'ENOENT' });
  for (const args of [['nope'], ['validate'], ['validate', './album.json', '--port', '0'], ['serve', './album.json', '--port', '-1'], ['feedback', './album.json', '--unknown'], ['feedback', './album.json', '--since', 'missing']]) {
    await assert.rejects(run(args), error => error.code === 1 && error.stderr.length > 0 && error.stdout === '');
  }
});

test('serve prints one usable loopback URL and exits cleanly on termination', async (t) => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [cli, 'serve', './album.json', '--port', '0'], { cwd: f.dir, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  const firstLine = await new Promise((resolve, reject) => {
    let out = ''; let err = '';
    const timeout = setTimeout(() => reject(new Error(`No server startup: ${err}`)), 5000);
    child.stderr.on('data', b => { err += b; });
    child.stdout.on('data', b => { out += b; if (out.includes('\n')) { clearTimeout(timeout); resolve(out.trim()); } });
    child.once('error', reject); child.once('exit', code => { clearTimeout(timeout); if (!out) reject(new Error(`Exited ${code}: ${err}`)); });
  });
  const result = JSON.parse(firstLine);
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/$/); assert.equal(result.albumId, 'test-album');
  assert.equal(result.reviewsDirectory, join(f.dir, '.image-pick', 'reviews'));
  assert.equal((await fetch(`${result.url}api/album`)).status, 200);
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); assert.equal(await exited, 0);
});

test('demo generates four original PNGs without overwriting existing files or generating at import', async (t) => {
  const f = await fixture(t);
  const dir = join(f.dir, 'demo'); const manifest = await generateDemo(dir);
  assert.equal(manifest, join(dir, 'album.json'));
  const { album } = await loadAlbum(manifest);
  assert.equal(album.photos.length, 4); assert.equal(album.photos.filter(p => p.baseline === 'selected').length, 1);
  assert.equal(album.photos.filter(p => p.seedId !== null).length, 3);
  assert.ok(album.photos.some(p => p.faceBox));
  assert.ok(new Set(album.photos.map(p => p.width / p.height)).size >= 2);
  const before = await readFile(manifest); const entries = await readdir(dir);
  await generateDemo(dir); assert.deepEqual(await readFile(manifest), before); assert.deepEqual(await readdir(dir), entries);
});

test('manifest symlink aliases resolve to the same default review directory and receipt', async (t) => {
  const f = await fixture(t);
  const { album } = await loadAlbum(f.manifest);
  const receipt = await saveReceipt(album, submission(album), join(f.dir, '.image-pick', 'reviews'));
  const aliasDirectory = join(f.dir, 'aliases'); await mkdir(aliasDirectory);
  const alias = join(aliasDirectory, 'album.json'); await symlink(f.manifest, alias);
  const result = await exec(process.execPath, [cli, 'feedback', alias], { cwd: aliasDirectory });
  assert.deepEqual(JSON.parse(result.stdout).receipt, receipt);
});
