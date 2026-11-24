import {test,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,submission,png} from './fixtures.mjs';
import {loadAlbum} from '../src/manifest.mjs';
import {loadReviewContext} from '../src/review-context.mjs';
import {saveReceipt,readFeedback} from '../src/review-store.mjs';
import {createAlbumServer} from '../src/server.mjs';
import {draftKey,makeLocalState} from '../web/model.mjs';

let f,server,base,cleanup,loaded,context;
test.beforeEach(async()=>{
  f=await fixture({after:fn=>cleanup=fn},3);
  const old=await loadAlbum(f.manifest),r1=submission(old.album,'old-r1');
  r1.photos[0].localVerdict='rework';r1.photos[0].note='只去纹理，保留颜色。\n<img src=x onerror=alert(1)>';
  await saveReceipt(old.album,r1,f.reviews);
  const r2=submission(old.album,'old-r2');r2.photos[0].note='This later receipt is not the requested feedback';await saveReceipt(old.album,r2,f.reviews);
  const next={...f.source,revision:'2',photos:[...f.source.photos,{id:'new-photo',file:'new.png',title:'This round',comparisons:{previous:'photo-1'}}]};
  await writeFile(join(f.dir,'new.png'),png(20,30,180));
  const manifestPath=join(f.dir,'next.json');await writeFile(manifestPath,JSON.stringify(next));loaded=await loadAlbum(manifestPath);
  const sidecar={schemaVersion:1,albumId:loaded.album.id,manifestDigest:loaded.album.manifestDigest,currentPhotoIds:['new-photo'],history:[{photoId:'photo-1',manifest:'album.json',manifestDigest:old.album.manifestDigest,submissionId:'old-r1'}],results:[{photoId:'new-photo',previousPhotoId:'photo-1',previousSubmissionId:'old-r1',summary:'清理纹理；保留颜色。'}]};
  const contextPath=join(f.dir,'context.json');await writeFile(contextPath,JSON.stringify(sidecar));
  context=await loadReviewContext({contextPath,manifestPath,album:loaded.album,reviewsDirectory:f.reviews});
  server=createAlbumServer({...loaded,reviewsDirectory:f.reviews,reviewContext:context});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
});
test.afterEach(async()=>{if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await cleanup();});

async function addSecondCurrentPhoto({currentFirst=false}={}) {
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  const old=await loadAlbum(f.manifest),previous=submission(old.album,'second-photo-feedback');
  previous.photos[1].localVerdict='rework';previous.photos[1].note='第二张：保留构图，只去背景纹理。';
  await saveReceipt(old.album,previous,f.reviews);
  const manifestPath=join(f.dir,'next.json'),next=JSON.parse(await readFile(manifestPath,'utf8'));
  next.photos.push({id:'second-new-photo',file:'second-new.png',title:'Second current image',comparisons:{previous:'photo-2',reference:'photo-3'}});
  if(currentFirst)next.photos.unshift(next.photos.splice(next.photos.findIndex(photo=>photo.id==='new-photo'),1)[0]);
  await writeFile(join(f.dir,'second-new.png'),png(24,32,160));
  await writeFile(manifestPath,JSON.stringify(next));loaded=await loadAlbum(manifestPath);
  const contextPath=join(f.dir,'context.json'),sidecar=JSON.parse(await readFile(contextPath,'utf8'));
  sidecar.manifestDigest=loaded.album.manifestDigest;sidecar.currentPhotoIds.push('second-new-photo');
  sidecar.history.push({photoId:'photo-2',manifest:'album.json',manifestDigest:old.album.manifestDigest,submissionId:'second-photo-feedback'});
  sidecar.results.push({photoId:'second-new-photo',previousPhotoId:'photo-2',previousSubmissionId:'second-photo-feedback',summary:'第二张：已去背景纹理。'});
  await writeFile(contextPath,JSON.stringify(sidecar));
  context=await loadReviewContext({contextPath,manifestPath,album:loaded.album,reviewsDirectory:f.reviews});
  server=createAlbumServer({...loaded,reviewsDirectory:f.reviews,reviewContext:context});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
}

test('return from previous feedback resumes the exact current image and comparison, without misattributing notes',async({page})=>{
  await addSecondCurrentPhoto();await page.goto(base);
  await page.locator('#note').fill('第一张的意见，请保留');
  await page.locator('#filmstrip [data-photo-id="second-new-photo"]').click();
  await page.locator('#note').fill('第二张复评草稿');
  await page.locator('#comparisonRole').selectOption('reference');
  await page.locator('#viewPrevious').click();
  await expect(page.locator('#photoCode')).toHaveText('photo-2');
  await expect(page.locator('#historyNote')).toHaveText('第二张：保留构图，只去背景纹理。');
  await page.locator('#returnCurrent').click();
  await expect(page.locator('#photoCode')).toHaveText('second-new-photo');
  await expect(page.locator('#note')).toHaveValue('第二张复评草稿');
  await expect(page.locator('#compareButton')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#comparisonRole')).toHaveValue('reference');
  await expect(page.locator('#referenceCaption')).toHaveText('参考图 / photo-3');
  await page.locator('#note').fill('第二张确认：纹理已去掉');
  await page.locator('#submitButton').click();await expect(page.locator('#submissionStatus')).toContainText('已提交');
  const {receipt}=await readFeedback(loaded.album,f.reviews);
  expect(receipt.photos.find(row=>row.id==='new-photo').note).toBe('第一张的意见，请保留');
  expect(receipt.photos.find(row=>row.id==='second-new-photo').note).toBe('第二张确认：纹理已去掉');
  expect(receipt.photos.find(row=>row.id==='photo-2').note).toBe('');
  await page.reload();await page.locator('#filmstrip [data-photo-id="second-new-photo"]').click();
  await expect(page.locator('#note')).toHaveValue('第二张确认：纹理已去掉');
});

test('narrow touch scope tabs and overview return to the last current image without forcing comparison',async({browser},testInfo)=>{
  await addSecondCurrentPhoto();
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'dark',reducedMotion:'reduce'}),page=await mobile.newPage();
  try {
    await page.goto(base);await page.locator('#filmstrip [data-photo-id="second-new-photo"]').tap();
    await page.locator('#note').fill('第二张触摸复评');await page.locator('#singleButton').tap();
    for(const scope of ['历史2','参考1','全部5']) {
      await page.getByRole('button',{name:scope,exact:true}).tap();
      await page.getByRole('button',{name:'本轮2',exact:true}).tap();
      await expect(page.locator('#photoCode')).toHaveText('second-new-photo');
      await expect(page.locator('#note')).toHaveValue('第二张触摸复评');
      await expect(page.locator('#singleButton')).toHaveAttribute('aria-pressed','true');
    }
    await page.locator('#overviewButton').tap();await page.locator('#overview [data-photo-id="photo-2"]').tap();
    await page.locator('#returnCurrent').tap();
    await expect(page.locator('#photoCode')).toHaveText('second-new-photo');
    await expect(page.locator('#note')).toHaveValue('第二张触摸复评');
    await expect(page.locator('#singleButton')).toHaveAttribute('aria-pressed','true');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#revisionCard').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('multi-current-mobile.png')});
  }finally{await mobile.close();}
});

test('all scope preserves the selected image when the manifest starts with a current image',async({page})=>{
  await addSecondCurrentPhoto({currentFirst:true});await page.goto(base);
  await page.locator('#filmstrip [data-photo-id="second-new-photo"]').click();
  await page.locator('#comparisonRole').selectOption('reference');
  await page.getByRole('button',{name:'全部5',exact:true}).click();
  await expect(page.locator('#photoCode')).toHaveText('second-new-photo');
  await page.getByRole('button',{name:'本轮2',exact:true}).click();
  await expect(page.locator('#photoCode')).toHaveText('second-new-photo');
  await expect(page.locator('#comparisonRole')).toHaveValue('reference');
  await expect(page.locator('#compareButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('#viewPrevious').click();
  await page.getByRole('button',{name:'全部5',exact:true}).click();
  await expect(page.locator('#photoCode')).toHaveText('photo-2');
  await page.locator('#returnCurrent').click();
  await expect(page.locator('#photoCode')).toHaveText('second-new-photo');
  await expect(page.locator('#comparisonRole')).toHaveValue('reference');
  await page.getByRole('button',{name:'全部5',exact:true}).click();
  await page.locator('#filmstrip [data-photo-id="new-photo"]').click();
  await page.locator('#viewPrevious').click();await page.locator('#returnCurrent').click();
  await expect(page.locator('#photoCode')).toHaveText('new-photo');
});

test('current round opens alone with pinned feedback, history is read-only and draft survives return and reload',async({page})=>{
  await page.goto(base);
  await expect(page.locator('#filmstrip .thumb')).toHaveCount(1);
  await expect(page.locator('#photoCode')).toHaveText('new-photo');
  await expect(page.locator('#revisionCard')).toContainText('只去纹理，保留颜色。');
  await expect(page.locator('#revisionCard')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#revisionCard img')).toHaveCount(0);
  await expect(page.locator('#revisionCard')).not.toContainText('This later receipt');
  await expect(page.locator('#note')).toHaveValue('');
  await page.locator('#note').fill('这次纹理已去掉');
  await page.locator('[data-verdict="selected"]').click();
  await page.getByRole('button',{name:'查看上一版与评价',exact:true}).click();
  await expect(page.locator('#photoCode')).toHaveText('photo-1');
  await expect(page.locator('#historyCard')).toContainText('old-r1');
  expect(await page.locator('#historyCard').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('revisionCard'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('#note')).toBeHidden();
  await page.locator('#currentViewport').focus();await page.keyboard.press('3');
  await page.getByRole('button',{name:'回到本轮',exact:true}).click();
  await expect(page.locator('#note')).toHaveValue('这次纹理已去掉');
  await page.reload();await expect(page.locator('#note')).toHaveValue('这次纹理已去掉');
  await page.locator('#submitButton').click();await expect(page.locator('#submissionStatus')).toContainText('已提交');
  const {receipt}=await readFeedback(loaded.album,f.reviews);
  expect(receipt.photos[0].localVerdict).toBeNull();expect(receipt.photos.at(-1).localVerdict).toBe('selected');
});

test('scoped imports skip historical rows and stale context cannot submit',async({page})=>{
  await page.goto(base);await expect(page.locator('#currentImage')).toBeVisible();
  const draft={...submission(loaded.album),draft:true};
  draft.photos[0].note='DO NOT IMPORT HISTORY';draft.photos.at(-1).note='New review imported';
  await page.locator('#importFile').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(draft))});
  await expect(page.locator('#note')).toHaveValue('New review imported');
  const download=page.waitForEvent('download');await page.locator('#exportButton').click();
  const exported=JSON.parse(await readFile(await(await download).path(),'utf8'));
  expect(exported.photos[0].note).toBe('');
  await page.route('**/api/album',async route=>{const response=await route.fetch();const data=await response.json();data.reviewContext.contextDigest='0'.repeat(64);await route.fulfill({response,json:data});});
  await page.locator('#submitButton').click();await expect(page.locator('#submissionStatus')).toContainText('复评范围已改变');
  expect((await readFeedback(loaded.album,f.reviews)).receipt).toBeNull();
  await expect(page.locator('#note')).toHaveValue('New review imported');
});

test('narrow touch view exposes all scopes and preserves an existing current receipt',async({browser},testInfo)=>{
  const saved=submission(loaded.album,'existing');saved.photos.at(-1).localVerdict='selected';saved.photos.at(-1).note='Existing current review';await saveReceipt(loaded.album,saved,f.reviews);
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'dark',reducedMotion:'reduce'}),page=await mobile.newPage();
  try {
    await page.goto(base);await expect(page.locator('#note')).toHaveValue('Existing current review');
    await page.getByRole('button',{name:'历史1',exact:true}).tap();await expect(page.locator('#historyCard')).toBeVisible();
    await page.getByRole('button',{name:'参考2',exact:true}).tap();await expect(page.locator('#filmstrip .thumb')).toHaveCount(2);
    await page.getByRole('button',{name:'全部4',exact:true}).tap();await expect(page.locator('#filmstrip .thumb')).toHaveCount(4);
    await page.getByRole('button',{name:'回到本轮',exact:true}).tap();await expect(page.locator('#note')).toHaveValue('Existing current review');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#revisionCard').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('revision-mobile.png')});
  }finally{await mobile.close();}
});

test('wider-scope drafts are preserved and visibly blocked instead of entering an endless retry',async({page})=>{
  const pending=submission(loaded.album,'uncertain-old-submit');pending.photos[0].note='Unsaved historical note';
  const state=makeLocalState(loaded.album,pending.photos,pending),key=draftKey(loaded.album);
  await page.addInitScript(({key,state})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify(state));},{key,state});
  await page.goto(base);
  await expect(page.locator('#scopeConflict')).toContainText('旧草稿还包含历史或参考图的改动');
  await expect(page.locator('#submitButton')).toBeDisabled();await expect(page.locator('#importButton')).toBeDisabled();
  const download=page.waitForEvent('download');await page.locator('#scopeBackup').click();
  const backup=JSON.parse(await readFile(await(await download).path(),'utf8'));
  expect(backup).toEqual(state);expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)).toEqual(state);
  await page.reload();await expect(page.locator('#scopeConflict')).toBeVisible();
  expect((await readFeedback(loaded.album,f.reviews)).receipt).toBeNull();
});

test('existing noncurrent rework remains preserved but cannot become a new scoped AI handoff',async({page})=>{
  const saved=submission(loaded.album,'existing-history-rework');saved.photos[0].localVerdict='rework';saved.photos[0].note='Preserve this old opinion';
  await saveReceipt(loaded.album,saved,f.reviews);await page.goto(base);
  await expect(page.locator('#submissionStatus')).toContainText('旧评价含返修项');await expect(page.locator('#handoffButton')).toBeDisabled();
  await page.locator('#note').fill('New current note');await page.locator('#submitButton').click();
  await expect(page.locator('#submissionStatus')).toContainText('已提交');
  expect((await readFeedback(loaded.album,f.reviews)).receipt.photos[0].note).toBe('Preserve this old opinion');
  await expect(page.locator('#handoffButton')).toBeDisabled();
});
