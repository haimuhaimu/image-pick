import {draftKey,initialReviews,updateReview,readLocalState,makeLocalState,reviewStatus,filterPhotos,adjacentId,createSubmission,exportDraft,sameReviews,receiveExternalDraft,receiptMatchesSubmission,fitTransform,renderedCenter} from './model.mjs';

const $=id=>document.getElementById(id);
const labels={selected:'精选',rework:'返修',reject:'淘汰',unreviewed:'未标记'};
const THEME_KEY='image-pick:theme:v1';
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
let album=null,token=null,receipt=null,reviews=[],currentId=null,group=null,status='all';
let storageSeen=null,storageFailed=false,storageMessage='',externalConflict=null,pendingSubmission=null,sending=false,submissionError='';
let comparing=false,faceMode=false,zoom=1,pan=[0,0],toastTimer;
const viewports=[
  {element:$('currentViewport'),image:$('currentImage'),photo:null},
  {element:$('referenceViewport'),image:$('referenceImage'),photo:null},
];
const current=()=>album?.photos.find(photo=>photo.id === currentId);
const currentReview=()=>reviews.find(row=>row.id === currentId);
const filtered=()=>album ? filterPhotos(album.photos,reviews,group,status) : [];
const samePending=(first,second)=>JSON.stringify(first) === JSON.stringify(second);

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent=message;
  $('toast').hidden=false;
  toastTimer=setTimeout(()=>$('toast').hidden=true,4000);
}

function renderSaveStatus() {
  $('saveStatus').classList.toggle('error',storageFailed || Boolean(externalConflict));
  $('saveStatus').textContent=externalConflict
    ? '本页草稿已保留；另一标签页有不同内容，暂未覆盖浏览器中的草稿。'
    : storageFailed ? storageMessage : '草稿已保存在此浏览器；只有提交后才会生成独立回执。';
  $('conflictBanner').hidden=!externalConflict;
  $('useExternal').disabled=sending || !externalConflict?.state;
  $('keepLocal').disabled=sending;
  renderSubmissionStatus();
}

function renderSubmissionStatus() {
  const output=$('submissionStatus');
  output.classList.toggle('error',Boolean(submissionError));
  if (sending) output.textContent='正在提交固定快照… 你可以继续编辑，新改动会保留为草稿。';
  else if (pendingSubmission) output.textContent=`上次提交未确认。重试会发送同一快照；之后的新改动仍保留在草稿。${submissionError ? ` ${submissionError}` : ''}`;
  else if (receipt && sameReviews(reviews,receipt.photos)) output.textContent=`已提交 · ${new Date(receipt.submittedAt).toLocaleString()} · 独立回执已保存，原图未改动。`;
  else if (receipt) output.textContent='草稿有新改动，尚未提交。上次回执已保留，当前编辑不会自动覆盖它。';
  else output.textContent='尚未提交 · 本地草稿。可以只评价部分图片；未标记不代表通过。';
  $('submitButton').textContent=sending ? '提交中…' : pendingSubmission ? '重试提交' : '提交评价';
  $('submitButton').disabled=!album || sending || Boolean(externalConflict);
  $('exportButton').disabled=!album;
}

function checkExternal(raw) {
  if (raw === storageSeen) return false;
  const incoming=readLocalState(raw,album);
  if (incoming && !receiveExternalDraft(reviews,incoming.photos).conflict && samePending(pendingSubmission,incoming.pendingSubmission)) {
    storageSeen=raw;
    return false;
  }
  externalConflict={raw,state:incoming};
  $('conflictText').textContent=incoming
    ? '另一标签页有不同草稿。本页内容已保留，未自动覆盖；请先导出备份，再选择保留哪一页的草稿。'
    : '浏览器中的草稿已被清除或无法读取。本页内容已保留，未自动覆盖；请先导出备份。';
  renderSaveStatus();
  return true;
}

function saveDraft(force=false) {
  if (!album) return false;
  try {
    const latest=localStorage.getItem(draftKey(album));
    if (!force && (externalConflict || checkExternal(latest))) return false;
    const raw=JSON.stringify(makeLocalState(album,reviews,pendingSubmission));
    localStorage.setItem(draftKey(album),raw);
    storageSeen=raw;
    storageFailed=false;
    externalConflict=null;
    renderSaveStatus();
    return true;
  } catch {
    storageFailed=true;
    storageMessage='未能保存浏览器草稿，请先导出备份。当前编辑仍在本页，刷新可能丢失。';
    renderSaveStatus();
    return false;
  }
}

function edit(patch) {
  if (!current()) return;
  try {reviews=updateReview(reviews,currentId,patch);}
  catch(error) {notify(error.message);$('note').value=currentReview()?.note ?? '';return;}
  saveDraft();
  if (!filtered().some(photo=>photo.id === currentId)) {
    currentId=filtered()[0]?.id ?? null;
    resetView();
    render();
  } else if (Object.hasOwn(patch,'note') && Object.keys(patch).length === 1) {
    $('noteCount').textContent=`${currentReview().note.length} / 4000`;
    renderSubmissionStatus();
  } else {
    renderReview(false);
    renderFilmstrip();
  }
}

async function fetchJSON(url,options={}) {
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000),...options});
  const data=await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '本地服务未能完成请求。');
  return data;
}

async function submit() {
  if (!album || sending || externalConflict) return;
  if (!pendingSubmission) {
    pendingSubmission=createSubmission(album,reviews,crypto.randomUUID());
    saveDraft();
    if (externalConflict) return;
  }
  // A retry always sends the exact old snapshot, never the edits made during its request.
  const snapshot=pendingSubmission;
  sending=true;
  submissionError='';
  renderSaveStatus();
  try {
    // Refresh only the session token, so restarting the service does not invalidate a retry.
    const boot=await fetchJSON('/api/album');
    if (boot.album?.id !== album.id || boot.album?.manifestDigest !== album.manifestDigest) throw new Error('相册版本已改变。请先导出本页草稿，再重新打开相册。');
    token=boot.token;
    const result=await fetchJSON('/api/feedback',{
      method:'POST',headers:{'Content-Type':'application/json','X-Image-Pick-Token':token},body:JSON.stringify(snapshot),
    });
    if (!receiptMatchesSubmission(result.receipt,snapshot)) throw new Error('回执与发送的快照不匹配，请保留草稿并重试。');
    receipt=result.receipt;
    pendingSubmission=null;
    submissionError='';
    // Do not restore reviews from the receipt: they may contain newer in-flight edits.
    saveDraft();
  } catch(error) {
    submissionError=error.name === 'TimeoutError' ? '连接超时；无法确认是否已保存。' : `无法确认保存结果：${error.message}`;
  } finally {
    sending=false;
    renderSaveStatus();
  }
}

function downloadDraft() {
  if (!album) return;
  const data=new Blob([JSON.stringify(exportDraft(album,reviews),null,2)],{type:'application/json;charset=utf-8'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(data);
  link.download=`${album.id}-draft-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),2000);
  notify('草稿已导出；文件不是提交回执，原图未改动。');
}

function resetView() {zoom=1;pan=[0,0];faceMode=false;}
function selectPhoto(id) {
  if (!album.photos.some(photo=>photo.id === id)) return;
  currentId=id;
  resetView();
  render();
}
function navigate(delta) {
  const id=adjacentId(filtered(),currentId,delta);
  if(id) selectPhoto(id);
}

function geometry(view) {
  const photo=view.photo;
  if (!photo) return null;
  const vw=view.element.clientWidth,vh=view.element.clientHeight,fit=Math.min(vw/photo.width,vh/photo.height);
  let baseZoom=1,anchor=[.5,.5];
  if (faceMode && photo.faceBox && fit>0) {
    const [left,top,right,bottom]=photo.faceBox;
    anchor=[(left+right)/2,(top+bottom)/2];
    baseZoom=clamp(Math.min(vw/((right-left)*photo.width*1.6),vh/((bottom-top)*photo.height*1.6))/fit,1,8);
  }
  const center=[clamp(anchor[0]+pan[0],0,1),clamp(anchor[1]+pan[1],0,1)];
  return {...fitTransform(photo.width,photo.height,vw,vh,baseZoom*zoom,center),baseZoom,anchor};
}

function positionPhotos() {
  for(const view of viewports) {
    if (!view.photo || !view.element.clientWidth) continue;
    const transform=geometry(view);
    view.image.style.width=`${transform.width}px`;
    view.image.style.height=`${transform.height}px`;
    view.image.style.transform=`translate(${transform.left}px,${transform.top}px)`;
    view.element.classList.toggle('zoomed',transform.zoom>1.01);
  }
  const transform=geometry(viewports[0]);
  $('zoomValue').textContent=`${transform ? Number(transform.zoom.toFixed(1)) : 1}×`;
  $('zoomOut').disabled=!transform || transform.zoom<=1;
  $('zoomIn').disabled=!transform || transform.zoom>=8;
  $('faceButton').setAttribute('aria-pressed',String(faceMode));
}

function zoomBy(factor) {
  const transform=geometry(viewports[0]);
  if (!transform) return;
  zoom=clamp(transform.zoom*factor,1,8)/transform.baseZoom;
  if (transform.baseZoom*zoom<=1.001) resetView();
  positionPhotos();
}

function loadImage(view,photo) {
  view.photo=photo;
  if(!photo) return;
  const message=view.element.querySelector('.image-message');
  if(view.image.dataset.photoId === photo.id && view.image.complete && view.image.naturalWidth) {
    message.hidden=true;
    return;
  }
  view.image.dataset.photoId=photo.id;
  view.image.alt=photo.title;
  view.image.hidden=true;
  message.replaceChildren(document.createTextNode('正在打开原图…'));
  message.hidden=false;
  const finish=()=>{
    if(view.photo?.id !== photo.id) return;
    view.image.hidden=false;
    message.hidden=true;
    positionPhotos();
  };
  view.image.onload=finish;
  view.image.onerror=()=>{
    if(view.photo?.id !== photo.id) return;
    const retry=document.createElement('button');
    retry.textContent='重新加载';
    retry.onclick=()=>loadImage(view,photo);
    message.replaceChildren(document.createTextNode('图片暂时无法读取，请确认本地服务仍在运行。'),retry);
    message.hidden=false;
  };
  view.image.src=photo.url;
  if(view.image.complete && view.image.naturalWidth) finish();
}

function renderReview(updateNote=true) {
  const photo=current(),row=currentReview();
  $('photoCode').textContent=photo?.code ?? '';
  $('photoTitle').textContent=photo?.title ?? '没有符合筛选的图片';
  $('photoMeta').textContent=photo ? `${photo.width} × ${photo.height} / ${photo.group}` : '更换下方筛选条件后继续选片。';
  $('baselineLabel').textContent=photo ? photo.baseline === 'selected' ? '来源记录：已精选（不代表本次确认）' : '来源记录：候选图片' : '';
  $('verdictText').textContent=row?.localVerdict ? `本次标记：${labels[row.localVerdict]}` : '本次未标记';
  document.querySelectorAll('[data-verdict]').forEach(button=>{
    button.disabled=!photo;
    button.setAttribute('aria-pressed',String(Boolean(photo && row?.localVerdict === button.dataset.verdict)));
  });
  $('clearVerdict').hidden=!row?.localVerdict;
  $('note').disabled=!photo;
  if(updateNote) $('note').value=row?.note ?? '';
  $('noteCount').textContent=`${row?.note.length ?? 0} / 4000`;
  $('downloadImage').hidden=!photo;
  $('downloadImage').href=photo?.url ?? '#';
  const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[photo?.mimeType];
  $('downloadImage').download=photo ? `${photo.id}.${extension}` : '';
  renderSubmissionStatus();
}

function thumbnail(photo,overview=false) {
  const button=document.createElement('button');
  button.className=overview ? 'grid-photo' : 'thumb';
  button.dataset.photoId=photo.id;
  button.setAttribute('aria-label',`${photo.code} ${photo.title}，${labels[reviewStatus(photo,reviews)]}`);
  if(photo.id === currentId) button.setAttribute('aria-current','true');
  const image=document.createElement('img');
  image.src=photo.url;image.alt='';image.loading='lazy';image.decoding='async';
  image.width=overview ? 160 : 64;image.height=overview ? 180 : 58;
  const title=document.createElement(overview ? 'strong' : 'span');
  title.textContent=overview ? photo.title : photo.code;
  button.append(image,title);
  if(overview) {
    const details=document.createElement('span');
    details.textContent=`${photo.group} / ${labels[reviewStatus(photo,reviews)]}`;
    button.append(details);
  } else if(reviewStatus(photo,reviews) !== 'unreviewed') {
    const mark=document.createElement('span');mark.className='thumb-mark';mark.setAttribute('aria-hidden','true');button.append(mark);
  }
  button.onclick=()=>{
    if(overview) {group=null;status='all';$('statusFilter').value=status;$('overview').close();}
    selectPhoto(photo.id);
  };
  return button;
}

function renderGroups() {
  const groups=[...new Set(album.photos.map(photo=>photo.group))];
  $('groupTabs').replaceChildren(...[null,...groups].map(value=>{
    const button=document.createElement('button');
    button.textContent=value ?? '全部';
    button.setAttribute('aria-pressed',String(value === group));
    const count=document.createElement('span');
    count.textContent=value === null ? album.photos.length : album.photos.filter(photo=>photo.group === value).length;
    button.append(count);
    button.onclick=()=>{group=value;currentId=filtered()[0]?.id ?? null;resetView();render();};
    return button;
  }));
}

function renderFilmstrip() {
  const scroll=$('filmstrip').scrollLeft;
  $('filmstrip').replaceChildren(...filtered().map(photo=>thumbnail(photo)));
  $('filmstrip').scrollLeft=scroll;
  const active=$('filmstrip').querySelector('[aria-current="true"]');
  if(active) {
    const left=active.offsetLeft-$('filmstrip').offsetLeft;
    if(left<scroll) $('filmstrip').scrollLeft=left;
    else if(left+active.offsetWidth>scroll+$('filmstrip').clientWidth) $('filmstrip').scrollLeft=left+active.offsetWidth-$('filmstrip').clientWidth;
  }
}

function render() {
  const photo=current(),items=filtered(),reference=photo?.seedId ? album.photos.find(item=>item.id === photo.seedId) : null;
  if(!reference) comparing=false;
  $('compareButton').disabled=!reference;
  $('compareButton').title=reference ? '与该图片对应的参照同时查看' : '这张图片没有指定参照';
  $('compareButton').setAttribute('aria-pressed',String(comparing));
  $('singleButton').setAttribute('aria-pressed',String(!comparing));
  $('referencePane').hidden=!comparing;
  $('photoPanes').classList.toggle('compare',comparing);
  $('photoPanes').hidden=!photo;
  $('emptyState').hidden=Boolean(photo);
  $('position').textContent=photo ? `${items.findIndex(item=>item.id === photo.id)+1} / ${items.length} 张` : '0 张';
  $('previousButton').disabled=$('nextButton').disabled=items.length<2;
  $('faceButton').disabled=!photo?.faceBox;
  $('fitButton').disabled=!photo;
  $('currentCaption').textContent=photo ? `当前 / ${photo.code}` : '';
  loadImage(viewports[0],photo);
  if(comparing) {$('referenceCaption').textContent=`参照 / ${reference.code}`;loadImage(viewports[1],reference);}
  else viewports[1].photo=null;
  renderReview();renderGroups();renderFilmstrip();positionPhotos();
}

function toggleCompare(value=!comparing) {
  if(!current()?.seedId) return;
  comparing=value;render();
}
function toggleFocus() {
  const focused=$('album').classList.toggle('focus');
  $('focusButton').textContent=focused ? '退出专注' : '专注';
  $('focusButton').setAttribute('aria-pressed',String(focused));
  positionPhotos();
}

$('previousButton').onclick=()=>navigate(-1);
$('nextButton').onclick=()=>navigate(1);
$('singleButton').onclick=()=>toggleCompare(false);
$('compareButton').onclick=()=>toggleCompare();
$('fitButton').onclick=()=>{resetView();positionPhotos();};
$('faceButton').onclick=()=>{if(!current()?.faceBox)return;faceMode=true;zoom=1;pan=[0,0];positionPhotos();};
$('zoomIn').onclick=()=>zoomBy(1.3);
$('zoomOut').onclick=()=>zoomBy(1/1.3);
$('focusButton').onclick=toggleFocus;
$('note').addEventListener('input',()=>edit({note:$('note').value}));
$('note').addEventListener('paste',event=>{
  const text=event.clipboardData?.getData('text/plain');
  if(typeof text === 'string' && $('note').value.length-($('note').selectionEnd-$('note').selectionStart)+text.length>4000) {
    event.preventDefault();notify('备注最多 4000 个字符；此次粘贴未加入，请缩短后再粘贴。');
  }
});
$('clearVerdict').onclick=()=>edit({localVerdict:null});
document.querySelectorAll('[data-verdict]').forEach(button=>button.onclick=()=>edit({localVerdict:button.dataset.verdict}));
$('statusFilter').onchange=event=>{status=event.target.value;currentId=filtered().some(photo=>photo.id === currentId) ? currentId : filtered()[0]?.id ?? null;resetView();render();};
$('clearFilters').onclick=()=>{group=null;status='all';$('statusFilter').value=status;currentId=album.photos[0]?.id ?? null;resetView();render();};
$('overviewButton').onclick=()=>{$('overviewGrid').replaceChildren(...album.photos.map(photo=>thumbnail(photo,true)));$('overview').showModal();};
$('closeOverview').onclick=()=>$('overview').close();
$('overview').onclick=event=>{
  if(event.target === $('overview')) {
    const bounds=$('overview').getBoundingClientRect();
    if(event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom) $('overview').close();
  }
};
$('exportButton').onclick=$('conflictExport').onclick=downloadDraft;
$('submitButton').onclick=submit;
$('keepLocal').onclick=()=>{if(!sending)saveDraft(true);};
$('useExternal').onclick=()=>{
  if(sending || !album) return;
  try {
    const raw=localStorage.getItem(draftKey(album)),incoming=readLocalState(raw,album);
    if(!incoming) throw new Error('另一份草稿目前无法读取；本页内容未更改，请导出备份。');
    reviews=incoming.photos;pendingSubmission=incoming.pendingSubmission;storageSeen=raw;externalConflict=null;storageFailed=false;submissionError='';
    if(!filtered().some(photo=>photo.id === currentId))currentId=filtered()[0]?.id ?? null;
    render();renderSaveStatus();
  } catch(error) {notify(error.message);}
};

try {const theme=localStorage.getItem(THEME_KEY);if(theme === 'light' || theme === 'dark')document.documentElement.dataset.theme=theme;} catch { /* Review storage has its own visible error state. */ }
$('themeButton').onclick=()=>{
  const dark=document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  document.documentElement.dataset.theme=dark ? 'light' : 'dark';
  try {localStorage.setItem(THEME_KEY,dark ? 'light' : 'dark');} catch {notify('外观已切换，但当前浏览器无法保存设置。');}
};

document.addEventListener('keydown',event=>{
  if(event.target.closest('input,textarea,select,[contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey || $('overview').open) return;
  const actions={
    arrowleft:()=>navigate(-1),arrowright:()=>navigate(1),'1':()=>edit({localVerdict:'selected'}),'2':()=>edit({localVerdict:'rework'}),'3':()=>edit({localVerdict:'reject'}),
    f:()=>$('faceButton').click(),'0':()=>$('fitButton').click(),c:()=>toggleCompare(),'+':()=>zoomBy(1.3),'=':()=>zoomBy(1.3),'-':()=>zoomBy(1/1.3),
    escape:()=>{if($('album').classList.contains('focus'))toggleFocus();else if(comparing)toggleCompare(false);else{resetView();positionPhotos();}},
  };
  const action=actions[event.key.toLowerCase()];
  if(action){event.preventDefault();action();}
});

for(const view of viewports) {
  const element=view.element,pointers=new Map();
  let last=null,pinchDistance=null,gestureStart=null;
  const distance=()=>{const values=[...pointers.values()];return values.length === 2 ? Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y) : null;};
  element.addEventListener('wheel',event=>{if(!view.photo)return;event.preventDefault();zoomBy(Math.exp(-event.deltaY*.002));},{passive:false});
  element.addEventListener('dblclick',event=>{event.preventDefault();const transform=geometry(view);if(!transform)return;if(transform.zoom>1.1){resetView();positionPhotos();}else $('faceButton').click();});
  element.addEventListener('pointerdown',event=>{
    if(!view.photo || event.button>0 || event.target.closest('button'))return;
    element.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});last=[event.clientX,event.clientY];
    gestureStart={x:event.clientX,y:event.clientY,time:Date.now(),single:true};
    if(pointers.size>1){pinchDistance=distance();gestureStart.single=false;}
    element.classList.add('dragging');
  });
  element.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const transform=geometry(view);if(!transform)return;
    if(pointers.size === 2){const next=distance();if(pinchDistance && next)zoomBy(next/pinchDistance);pinchDistance=next;last=null;return;}
    if(last && transform.zoom>1.01){
      const vw=element.clientWidth,vh=element.clientHeight,actual=renderedCenter(transform,vw,vh);
      const requested=[clamp(actual[0]-(event.clientX-last[0])/transform.width,0,1),clamp(actual[1]-(event.clientY-last[1])/transform.height,0,1)];
      const bounded=renderedCenter(fitTransform(view.photo.width,view.photo.height,vw,vh,transform.zoom,requested),vw,vh);
      pan=[bounded[0]-transform.anchor[0],bounded[1]-transform.anchor[1]];positionPhotos();
    }
    last=[event.clientX,event.clientY];
  });
  const end=event=>{
    const transform=geometry(view);
    if(event.type === 'pointerup' && gestureStart?.single && pointers.size === 1 && transform?.zoom<=1.01 && event.pointerType === 'touch'){
      const dx=event.clientX-gestureStart.x,dy=event.clientY-gestureStart.y;
      if(Date.now()-gestureStart.time<700 && Math.abs(dx)>65 && Math.abs(dx)>Math.abs(dy)*1.5)navigate(dx<0 ? 1 : -1);
    }
    pointers.delete(event.pointerId);
    if(!pointers.size){last=null;pinchDistance=null;gestureStart=null;element.classList.remove('dragging');}
    else{const point=[...pointers.values()][0];last=[point.x,point.y];pinchDistance=null;}
  };
  element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);
  new ResizeObserver(positionPhotos).observe(element);
}

window.addEventListener('storage',event=>{if(album && (event.key === draftKey(album) || event.key === null))checkExternal(event.newValue);});
window.addEventListener('beforeunload',event=>{if(storageFailed || externalConflict || sending){event.preventDefault();event.returnValue='';}});

async function initialize() {
  $('fatalError').hidden=true;
  try {
    const data=await fetchJSON('/api/album');
    if(!data.album || !Array.isArray(data.album.photos) || !data.album.photos.length || data.album.photos.length>500 || typeof data.token !== 'string')throw new Error('相册清单不完整。');
    if(data.album.photos.some(photo=>photo.url !== `/images/${photo.id}`))throw new Error('图片地址不属于本地相册。');
    album=data.album;token=data.token;receipt=data.receipt;
    reviews=initialReviews(album,receipt);
    try {
      const raw=localStorage.getItem(draftKey(album)),saved=readLocalState(raw,album);
      storageSeen=raw;
      if(saved){reviews=saved.photos;pendingSubmission=saved.pendingSubmission;}
      else if(raw !== null){externalConflict={raw,state:null};$('conflictText').textContent='本地草稿格式无法读取，未自动覆盖。请先保留原备份，再选择是否使用本页草稿。';}
    }catch{storageFailed=true;storageMessage='未能读取浏览器草稿。当前编辑仍可提交或导出；请勿依赖刷新保存。';}
    $('albumTitle').textContent=album.title;
    $('totalCount').textContent=album.photos.length;
    $('overviewButton').disabled=false;
    $('statusFilter').disabled=false;
    currentId=album.photos[0].id;
    render();renderSaveStatus();
  }catch(error){
    $('fatalError').hidden=false;$('photoPanes').hidden=true;$('emptyState').hidden=true;
    $('fatalText').textContent=`${error.message} 请确认本地相册服务仍在运行，然后重试。`;
    $('position').textContent='暂未连接';
  }
}
$('retryButton').onclick=initialize;
initialize();
