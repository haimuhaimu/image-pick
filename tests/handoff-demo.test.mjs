import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateHandoffDemo} from '../scripts/demo.mjs';
import {loadAlbum} from '../src/manifest.mjs';

test('handoff demo uses synthetic version comparisons and never replaces an existing batch',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'image-pick-handoff-demo-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=await generateHandoffDemo(directory);
  const before=await readFile(path,'utf8');
  const {album}=await loadAlbum(path);
  assert.equal(album.photos.length,4);
  assert.deepEqual(album.photos[0].comparisons,{source:'source',previous:'previous',reference:'reference'});
  assert.equal(new Set(album.photos.map(photo=>photo.sha256)).size,4);
  assert.ok(album.photos.every(photo=>photo.baseline === 'candidate'));
  await generateHandoffDemo(directory);
  assert.equal(await readFile(path,'utf8'),before);
});
