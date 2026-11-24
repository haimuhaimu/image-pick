import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile,unlink,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as demos from '../scripts/demo.mjs';
import {loadAlbum} from '../src/manifest.mjs';
import {loadReviewContext} from '../src/review-context.mjs';
import {readFeedback,saveReceipt} from '../src/review-store.mjs';
import {submission} from './fixtures.mjs';

async function directory(t){const dir=await mkdtemp(join(tmpdir(),'imagepick-rereview-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function snapshot(dir){const files=await readdir(dir,{recursive:true,withFileTypes:true});return Object.fromEntries(await Promise.all(files.filter(f=>f.isFile()).map(async f=>{const path=join(f.parentPath,f.name);return [path,await readFile(path)];})));}

test('rereview demo binds two synthetic histories and leaves the current round unreviewed',async t=>{
  assert.equal(typeof demos.generateRereviewDemo,'function');
  const dir=await directory(t),result=await demos.generateRereviewDemo(dir);
  const {album}=await loadAlbum(result.manifestPath);
  const context=await loadReviewContext({...result,album});
  assert.deepEqual(context.currentPhotoIds,['circle-new','triangle-new']);
  assert.deepEqual(context.history.map(row=>row.photoId),['circle-old','triangle-old']);
  assert.ok(context.history.every(row=>row.submissionId==='synthetic-r1'&&row.feedback.note.startsWith('合成示例意见：')));
  assert.equal((await readFeedback(album,result.reviewsDirectory)).receipt,null);
  const hashes=Object.fromEntries(album.photos.map(p=>[p.id,p.sha256]));
  assert.notEqual(hashes['circle-new'],hashes['circle-old']);
  assert.equal(hashes['triangle-new'],hashes['triangle-old']); // Intentionally unfinished example, not an accepted repair.
});

test('rerunning the demo preserves generated files, synthetic history and submitted current feedback byte for byte',async t=>{
  const dir=await directory(t),result=await demos.generateRereviewDemo(dir),{album}=await loadAlbum(result.manifestPath);
  const request=submission(album,'my-demo-review');request.photos.find(p=>p.id==='triangle-new').note='Still needs a warmer color';
  await saveReceipt(album,request,result.reviewsDirectory);
  const before=await snapshot(dir);await demos.generateRereviewDemo(dir);
  assert.deepEqual(await snapshot(dir),before);
  assert.equal((await readFeedback(album,result.reviewsDirectory)).receipt.submissionId,'my-demo-review');
});

test('rereview demo refuses changed files and symbolic links without overwriting them',async t=>{
  const dir=await directory(t);await demos.generateRereviewDemo(dir);
  const target=join(dir,'circle-old.png');await writeFile(target,'keep this changed file');
  await assert.rejects(demos.generateRereviewDemo(dir));assert.equal(await readFile(target,'utf8'),'keep this changed file');
  const external=join(await directory(t),'outside.txt');await writeFile(external,'do not touch');
  await unlink(target);await symlink(external,target);
  await assert.rejects(demos.generateRereviewDemo(dir));assert.equal(await readFile(external,'utf8'),'do not touch');
});

test('rereview demo rejects a named pipe instead of waiting for a writer',{skip:process.platform==='win32'},async t=>{
  const dir=await directory(t);await demos.generateRereviewDemo(dir);
  const target=join(dir,'circle-old.png');await unlink(target);
  const run=promisify(execFile);await run('mkfifo',[target]);
  const moduleUrl=new URL('../scripts/demo.mjs',import.meta.url).href;
  const script=`import {generateRereviewDemo} from ${JSON.stringify(moduleUrl)};generateRereviewDemo(${JSON.stringify(dir)}).catch(error=>{console.error(error.message);process.exitCode=1;});`;
  await assert.rejects(run(process.execPath,['--input-type=module','-e',script],{timeout:2000}),error=>{
    assert.equal(error.code,1,'must reject the file, not time out while opening it');
    assert.equal(error.signal,null);
    assert.match(error.stderr,/Rereview demo files have changed/);
    return true;
  });
});
