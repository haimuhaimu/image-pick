import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,submission,png} from './fixtures.mjs';
import {loadAlbum} from '../src/manifest.mjs';
import {saveReceipt,readFeedback} from '../src/review-store.mjs';
import {createAlbumServer} from '../src/server.mjs';

async function setup(t) {
  const f=await fixture(t,3),old=await loadAlbum(f.manifest);
  const request=submission(old.album,'r1');
  request.photos[0].localVerdict='rework';request.photos[0].note='只去纹理；保留颜色。\n<img src=x onerror=alert(1)>';
  const receipt=await saveReceipt(old.album,request,f.reviews);
  const next={...f.source,revision:'2',photos:[...f.source.photos,{id:'new-photo',file:'new.png',title:'New result',comparisons:{previous:'photo-1'}}]};
  await writeFile(join(f.dir,'new.png'),png(20,30,190));
  const manifestPath=join(f.dir,'next.json');await writeFile(manifestPath,JSON.stringify(next));
  const {album}=await loadAlbum(manifestPath);
  const context={schemaVersion:1,albumId:album.id,manifestDigest:album.manifestDigest,currentPhotoIds:['new-photo'],
    history:[{photoId:'photo-1',manifest:'album.json',manifestDigest:old.album.manifestDigest,submissionId:receipt.submissionId}],
    results:[{photoId:'new-photo',previousPhotoId:'photo-1',previousSubmissionId:'r1',summary:'只处理表面，保留颜色。'}]};
  const contextPath=join(f.dir,'review-context.json');
  const load=async(value=context)=>{
    await writeFile(contextPath,JSON.stringify(value));
    const module=await import('../src/review-context.mjs');
    return module.loadReviewContext({contextPath,manifestPath,album,reviewsDirectory:f.reviews});
  };
  return {...f,manifestPath,album,old,context,load};
}

test('review context pins exact history without changing the current album or inheriting opinions',async t=>{
  const f=await setup(t),before=await readFile(f.manifest),currentBefore=await readFile(f.manifestPath);
  const newer=submission(f.old.album,'r2');newer.photos[0].note='较新但不是这次请求';await saveReceipt(f.old.album,newer,f.reviews);
  const context=await f.load();
  assert.deepEqual(context.currentPhotoIds,['new-photo']);
  assert.equal(context.history[0].submissionId,'r1');
  assert.equal(context.history[0].feedback.note,'只去纹理；保留颜色。\n<img src=x onerror=alert(1)>');
  assert.equal(context.history[0].feedback.localVerdict,'rework');
  assert.equal(context.results[0].summary,'只处理表面，保留颜色。');
  assert.match(context.contextDigest,/^[a-f0-9]{64}$/);
  const changed=structuredClone(f.context);changed.results[0].summary='Changed context';
  assert.notEqual((await f.load(changed)).contextDigest,context.contextDigest);
  assert.equal(JSON.stringify(context).includes(f.dir),false);assert.equal(JSON.stringify(context).includes('album.json'),false);
  assert.deepEqual(await readFile(f.manifest),before);assert.deepEqual(await readFile(f.manifestPath),currentBefore);
  assert.equal((await readFeedback(f.album,f.reviews)).receipt,null);
  assert.equal((await loadAlbum(f.manifestPath)).album.manifestDigest,f.album.manifestDigest);
});

test('context submissions protect historical rows, bind the displayed scope and allow exact retries',async t=>{
  const f=await setup(t),context=await f.load(),loaded=await loadAlbum(f.manifestPath);
  const initial=submission(f.album,'initial');initial.photos[0].note='Existing history opinion';
  await saveReceipt(f.album,initial,f.reviews);
  const server=createAlbumServer({...loaded,reviewsDirectory:f.reviews,reviewContext:context});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`http://127.0.0.1:${server.address().port}`,{token}=await(await fetch(`${url}/api/album`)).json();
  const send=(payload,digest=context.contextDigest)=>fetch(`${url}/api/feedback`,{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-Image-Pick-Token':token,'X-Image-Pick-Context':digest??''},body:JSON.stringify(payload)});
  const payload={...initial,submissionId:'next',photos:structuredClone(initial.photos)};
  payload.photos.at(-1).localVerdict='selected';
  assert.equal((await send(payload,'')).status,409);
  assert.equal((await send(payload,'0'.repeat(64))).status,409);
  const changed=structuredClone(payload);changed.photos[0].note='Overwritten';
  assert.equal((await send(changed)).status,409);
  const first=await send(payload);assert.equal(first.status,200);const receipt=(await first.json()).receipt;
  const later=structuredClone(payload);later.submissionId='later';later.photos.at(-1).note='Another review';
  assert.equal((await send(later)).status,200);
  assert.deepEqual((await(await send(payload)).json()).receipt,receipt);
  assert.equal((await readFeedback(f.album,f.reviews)).receipt.photos[0].note,'Existing history opinion');
});

test('review context rejects wrong version, wrong receipt, duplicate roles and mismatched parent relationships',async t=>{
  const f=await setup(t);
  for(const mutate of [
    c=>c.manifestDigest='0'.repeat(64),c=>c.albumId='another-album',
    c=>c.currentPhotoIds=[],c=>c.currentPhotoIds=['new-photo','new-photo'],
    c=>c.history[0].photoId='new-photo',c=>c.history.push({...c.history[0]}),
    c=>c.history[0].manifestDigest='0'.repeat(64),c=>c.history[0].submissionId='missing',
    c=>c.results[0].previousSubmissionId='r2',c=>c.results[0].previousPhotoId='photo-2',
    c=>c.results.push({...c.results[0]}),c=>c.results[0].summary='x'.repeat(4001),
  ]) {const c=structuredClone(f.context);mutate(c);await assert.rejects(f.load(c));}
});

test('historical identity must match the retained image bytes, not just its photo ID',async t=>{
  const f=await setup(t);
  await writeFile(join(f.dir,'image-1.png'),png(3,3,99));
  const changed=await loadAlbum(f.manifest);
  const request=submission(changed.album,'changed');request.photos[0].localVerdict='rework';await saveReceipt(changed.album,request,f.reviews);
  f.context.history[0].manifestDigest=changed.album.manifestDigest;f.context.history[0].submissionId='changed';
  f.context.results[0].previousSubmissionId='changed';
  await assert.rejects(f.load(),/identity/i);
});

test('review context refuses escaped or symlinked paths instead of exposing unrelated manifests',async t=>{
  const f=await setup(t),outside=await fixture(t,2);
  for(const manifest of ['../album.json','/tmp/album.json','https://example.com/a.json']) {
    const c=structuredClone(f.context);c.history[0].manifest=manifest;await assert.rejects(f.load(c),/path/i);
  }
  await symlink(outside.manifest,join(f.dir,'escaped.json'));
  const c=structuredClone(f.context);c.history[0].manifest='escaped.json';await assert.rejects(f.load(c),/path/i);
  const module=await import('../src/review-context.mjs');
  await assert.rejects(module.loadReviewContext({contextPath:outside.manifest,manifestPath:f.manifestPath,album:f.album,reviewsDirectory:f.reviews}),/path/i);
});
