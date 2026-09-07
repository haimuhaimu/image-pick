import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateDemo} from '../scripts/demo.mjs';
import {loadAlbum} from '../src/manifest.mjs';
import {createAlbumServer} from '../src/server.mjs';

let directory,manifestPath,server,base,loaded,manifest;
async function start(port=0) {
  loaded=await loadAlbum(manifestPath);
  server=createAlbumServer({...loaded,reviewsDirectory:join(directory,'private-reviews')});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  base=`http://127.0.0.1:${server.address().port}`;
}
async function stop() {
  if (!server) return;
  const closing=server;
  server=null;
  await new Promise((resolve,reject)=>{closing.close(error=>error ? reject(error) : resolve());closing.closeAllConnections();});
}
async function ready(page) {
  await page.goto(base);
  await expect(page.locator('#currentImage')).toBeVisible();
}
async function select(page,id) {
  await page.locator('#overviewButton').click();
  await page.locator(`[data-photo-id="${id}"].grid-photo`).click();
  await expect(page.locator('#photoCode')).toHaveText(id);
  await expect(page.locator('#currentImage')).toBeVisible();
}
async function exported(page) {
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出草稿',exact:true}).click();
  const download=await downloadPromise;
  return JSON.parse(await readFile(await download.path(),'utf8'));
}
async function receipt(request) {
  const response=await request.get(`${base}/api/album`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).receipt;
}
test.beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'image-pick-browser-'));
  manifestPath=await generateDemo(directory);
  manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  await start();
});
test.afterEach(async()=>{
  await stop();
  if (directory) await rm(directory,{recursive:true,force:true});
});

test('neutral dynamic album shows full images, focus, reference, keyboard and desktop/mobile layouts',async({page},testInfo)=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await ready(page);
  await expect(page).toHaveTitle('ImagePick · 选片台');
  await expect(page.locator('.thumb')).toHaveCount(loaded.album.photos.length);
  for (const photo of loaded.album.photos) {
    await select(page,photo.id);
    const image=await page.locator('#currentImage').boundingBox();
    const viewport=await page.locator('#currentViewport').boundingBox();
    expect(image.x).toBeGreaterThanOrEqual(viewport.x-1);
    expect(image.y).toBeGreaterThanOrEqual(viewport.y-1);
    expect(image.x+image.width).toBeLessThanOrEqual(viewport.x+viewport.width+1);
    expect(image.y+image.height).toBeLessThanOrEqual(viewport.y+viewport.height+1);
  }
  const focused=loaded.album.photos.find(photo=>photo.faceBox && photo.seedId);
  expect(focused).toBeTruthy();
  await select(page,focused.id);
  await page.locator('#faceButton').click();
  expect(parseFloat(await page.locator('#zoomValue').innerText())).toBeGreaterThan(1);
  await page.locator('#compareButton').click();
  await expect(page.locator('#referenceImage')).toBeVisible();
  await expect(page.locator('#referenceCaption')).toContainText(focused.seedId);
  await page.screenshot({path:testInfo.outputPath('desktop-focus-compare.png')});
  await page.locator('#fitButton').click();
  await page.locator('#note').fill('文字输入不会切换图片');
  await page.locator('#note').press('ArrowRight');
  await expect(page.locator('#photoCode')).toHaveText(focused.id);
  const noFocus=loaded.album.photos.find(photo=>!photo.faceBox);
  await select(page,noFocus.id);
  await expect(page.locator('#faceButton')).toBeDisabled();
  await page.locator('#currentCaption').click();
  await page.keyboard.press('f');
  await expect(page.locator('#zoomValue')).toHaveText('1×');
  const baseline=loaded.album.photos.find(photo=>photo.baseline === 'selected');
  await select(page,baseline.id);
  await expect(page.locator('#baselineLabel')).toContainText('已精选');
  await expect(page.locator('[data-verdict="selected"]')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#verdictText')).toContainText('未标记');
  await page.locator('#themeButton').click();
  await page.screenshot({path:testInfo.outputPath('desktop-dark.png')});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#submitButton')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:testInfo.outputPath('mobile-dark.png'),fullPage:true});
  await select(page,focused.id);
  await page.locator('#compareButton').click();
  await expect(page.locator('#referenceImage')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('#themeButton').click();
  await page.screenshot({path:testInfo.outputPath('mobile-light-compare.png'),fullPage:true});
  expect(errors).toEqual([]);
});

test('partial submission is acknowledged on disk, restores without browser draft, and text remains inert',async({page,browser,request})=>{
  await stop();
  manifest.title='<img src=x onerror="window.imagePickXss=1">';
  manifest.photos[0].title='<script>window.imagePickXss=2</script>';
  await writeFile(manifestPath,JSON.stringify(manifest));
  await start();
  await ready(page);
  await expect(page.locator('#albumTitle')).toHaveText(manifest.title);
  await expect(page.locator('#photoTitle')).toHaveText(manifest.photos[0].title);
  await page.locator('#note').fill('<img src=x onerror="window.imagePickXss=3">');
  await page.locator('[data-verdict="rework"]').click();
  await page.getByRole('button',{name:'提交评价',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'已提交'})).toBeVisible();
  const saved=await receipt(request);
  expect(saved.photos).toHaveLength(loaded.album.photos.length);
  expect(saved.photos[0].localVerdict).toBe('rework');
  expect(saved.photos.slice(1).every(photo=>photo.localVerdict === null)).toBeTruthy();
  expect(saved.photos[0].note).toBe('<img src=x onerror="window.imagePickXss=3">');
  expect(saved.projectRegistryModified).toBe(false);
  expect(await page.evaluate(()=>window.imagePickXss)).toBeUndefined();
  const clean=await browser.newContext();
  try {
    const restored=await clean.newPage();
    await ready(restored);
    await expect(restored.locator('#note')).toHaveValue(saved.photos[0].note);
    await expect(restored.getByRole('status').filter({hasText:'已提交'})).toBeVisible();
  } finally {await clean.close();}
});

test('a lost response retries the exact snapshot while later edits stay unsubmitted and exportable',async({page,request})=>{
  await ready(page);
  const calls=[];
  page.on('request',req=>{if(req.url().endsWith('/api/feedback')) calls.push(req.postDataJSON());});
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  let stored;
  const storedPromise=new Promise(resolve=>{stored=resolve;});
  // Fault injection drops only the response: the actual backend still validates and stores it.
  await page.route('**/api/feedback',async route=>{
    const response=await route.fetch();
    expect(response.ok()).toBeTruthy();
    stored();
    await held;
    await route.abort('failed');
  },{times:1});
  await page.locator('#note').fill('Snapshot sent first');
  await page.getByRole('button',{name:'提交评价',exact:true}).click();
  await storedPromise;
  await page.locator('#note').fill('Newer edit while request is in flight');
  release();
  await expect(page.locator('#submissionStatus')).toContainText('未确认');
  expect((await receipt(request)).photos[0].note).toBe('Snapshot sent first');
  const backup=await exported(page);
  expect(backup.draft).toBe(true);
  expect(backup.submittedAt).toBeNull();
  expect(backup.photos[0].note).toBe('Newer edit while request is in flight');
  await page.getByRole('button',{name:'重试提交',exact:true}).click();
  await expect(page.locator('#submissionStatus')).toContainText('尚未提交');
  expect(calls[1]).toEqual(calls[0]);
  await expect(page.locator('#note')).toHaveValue('Newer edit while request is in flight');
  await page.getByRole('button',{name:'提交评价',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'已提交'})).toBeVisible();
  expect(calls[2].submissionId).not.toBe(calls[0].submissionId);
  expect((await receipt(request)).photos[0].note).toBe('Newer edit while request is in flight');
});

test('an uncertain submission survives page and server restart without changing retry identity',async({page,request})=>{
  await ready(page);
  let sent;
  await page.route('**/api/feedback',async route=>{
    sent=route.request().postDataJSON();
    await route.fetch();
    await route.abort('failed');
  },{times:1});
  await page.locator('#note').fill('Durable pending draft');
  await page.getByRole('button',{name:'提交评价',exact:true}).click();
  await expect(page.locator('#submissionStatus')).toContainText('未确认');
  const port=server.address().port;
  await stop();
  await start(port);
  await ready(page);
  await expect(page.locator('#note')).toHaveValue('Durable pending draft');
  await page.getByRole('button',{name:'重试提交',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'已提交'})).toBeVisible();
  expect((await receipt(request)).submissionId).toBe(sent.submissionId);
});

test('another tab cannot silently overwrite this tab and conflict backup retains complete notes',async({page,context})=>{
  await ready(page);
  const other=await context.newPage();
  await ready(other);
  await page.locator('#note').fill('A'.repeat(4000));
  await expect(other.locator('#conflictBanner')).toBeVisible();
  await other.locator('#note').fill('B'.repeat(4000));
  await expect(page.locator('#note')).toHaveValue('A'.repeat(4000));
  await expect(other.locator('#note')).toHaveValue('B'.repeat(4000));
  expect((await exported(other)).photos[0].note).toBe('B'.repeat(4000));
  await expect(other.locator('#conflictBanner')).toContainText('保留');
  await other.close();
});

test('same-origin album changes and changed revisions do not inherit old draft opinions',async({page})=>{
  await ready(page);
  await page.locator('#note').fill('Only for this image version');
  const port=server.address().port;
  const original=structuredClone(manifest);
  await stop();
  manifest.id='different-album';
  await writeFile(manifestPath,JSON.stringify(manifest));
  await start(port);
  await ready(page);
  await expect(page.locator('#note')).toHaveValue('');
  await stop();
  manifest={...original,revision:'second-version'};
  await writeFile(manifestPath,JSON.stringify(manifest));
  await start(port);
  await ready(page);
  await expect(page.locator('#note')).toHaveValue('');
  await stop();
  await writeFile(manifestPath,JSON.stringify(original));
  await start(port);
  await ready(page);
  await expect(page.locator('#note')).toHaveValue('Only for this image version');
});

test('storage failures remain visible and offline draft export keeps the unsaved edit',async({page})=>{
  await ready(page);
  // Failure at the browser storage boundary; the viewer/model and export stay real.
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});
  await page.locator('#note').fill('Retain despite full storage');
  await expect(page.locator('#saveStatus')).toContainText('未能保存');
  expect((await exported(page)).photos[0].note).toBe('Retain despite full storage');
});

test('a disconnected bootstrap leaves review filters disabled until successful retry',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/album',route=>route.abort('failed'),{times:1});
  await page.goto(base);
  await expect(page.locator('#fatalError')).toBeVisible();
  await expect(page.locator('#statusFilter')).toBeDisabled();
  await expect(page.locator('#submitButton')).toBeDisabled();
  await page.getByRole('button',{name:'重新连接',exact:true}).click();
  await expect(page.locator('#currentImage')).toBeVisible();
  await expect(page.locator('#statusFilter')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('filters, complete-note limits and immediate reverse pan remain usable',async({page})=>{
  await ready(page);
  await page.locator('#note').fill('Original note');
  await page.locator('#note').fill('x'.repeat(4001));
  await expect(page.locator('#note')).toHaveValue('Original note');
  await expect(page.locator('#toast')).toContainText('4000');
  await page.locator('#statusFilter').selectOption('reject');
  await expect(page.locator('#emptyState')).toBeVisible();
  await page.locator('#clearFilters').click();
  await expect(page.locator('.thumb')).toHaveCount(loaded.album.photos.length);
  await page.locator('#zoomIn').click();
  await page.locator('#zoomIn').click();
  await page.locator('#zoomIn').click();
  const viewport=await page.locator('#currentViewport').boundingBox();
  const x=viewport.x+viewport.width*.5,y=viewport.y+viewport.height*.4;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x,y+1200,{steps:5});
  const before=await page.locator('#currentImage').boundingBox();
  await page.mouse.move(x,y+1150,{steps:2});
  const after=await page.locator('#currentImage').boundingBox();
  await page.mouse.up();
  expect(after.y).toBeLessThan(before.y-10);
  await page.locator('#fitButton').click();
  await page.locator('#focusButton').click();
  await expect(page.locator('.review-panel')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.review-panel')).toBeVisible();
});

test('actual canvas-generated JPEG and WebP decode through the real image service',async({page,request})=>{
  const shapes=[
    {id:'jpeg-shape',file:'shape.jpg',mimeType:'image/jpeg',width:144,height:96},
    {id:'webp-shape',file:'shape.webp',mimeType:'image/webp',width:80,height:128},
  ];
  const encoded=await page.evaluate(items=>items.map(item=>{
    const canvas=document.createElement('canvas');
    canvas.width=item.width;canvas.height=item.height;
    const context=canvas.getContext('2d');
    context.fillStyle='#f4eee1';context.fillRect(0,0,item.width,item.height);
    context.fillStyle='#4a7980';context.fillRect(item.width*.2,item.height*.25,item.width*.6,item.height*.5);
    context.fillStyle='#d48058';context.beginPath();context.arc(item.width*.5,item.height*.5,Math.min(item.width,item.height)*.2,0,Math.PI*2);context.fill();
    return canvas.toDataURL(item.mimeType,.85);
  }),shapes);
  await stop();
  for(let index=0;index<shapes.length;index++) {
    expect(encoded[index].startsWith(`data:${shapes[index].mimeType};base64,`)).toBeTruthy();
    await writeFile(join(directory,shapes[index].file),Buffer.from(encoded[index].split(',')[1],'base64'));
  }
  manifest.photos=shapes.map(shape=>({id:shape.id,file:shape.file,title:shape.id,group:'Synthetic encodings'}));
  await writeFile(manifestPath,JSON.stringify(manifest));
  await start();
  const bootstrap=await request.get(`${base}/api/album`);
  expect(bootstrap.ok()).toBeTruthy();
  const publicAlbum=(await bootstrap.json()).album;
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await ready(page);
  for(const shape of shapes) {
    const photo=publicAlbum.photos.find(item=>item.id === shape.id);
    expect({mimeType:photo.mimeType,width:photo.width,height:photo.height}).toEqual({mimeType:shape.mimeType,width:shape.width,height:shape.height});
    const imageResponse=await request.get(`${base}${photo.url}`);
    expect(imageResponse.ok()).toBeTruthy();
    expect(imageResponse.headers()['content-type']).toBe(shape.mimeType);
    await select(page,shape.id);
    await expect.poll(()=>page.locator('#currentImage').evaluate(image=>({complete:image.complete,width:image.naturalWidth,height:image.naturalHeight}))).toEqual({complete:true,width:shape.width,height:shape.height});
    await expect(page.locator('#currentViewport .image-message')).toBeHidden();
  }
  expect(errors).toEqual([]);
});
