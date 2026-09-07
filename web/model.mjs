export const verdicts = Object.freeze(['selected','rework','reject']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
const validTime = value => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
const cloneRow = row => ({id:row.id,localVerdict:row.localVerdict,note:row.note,statusUpdatedAt:row.statusUpdatedAt,noteUpdatedAt:row.noteUpdatedAt});

export function draftKey(album) {
  return `image-pick:review:v1:${album.id}:${album.manifestDigest}`;
}

function validatedRows(album,rows) {
  if (!Array.isArray(rows) || rows.length !== album.photos.length) throw new Error('Incomplete review');
  const byId = new Map();
  for (const row of rows) {
    if (!row || !validId(row.id) || byId.has(row.id) || (row.localVerdict !== null && !verdicts.includes(row.localVerdict)) || typeof row.note !== 'string' || row.note.length > 4000 || !validTime(row.statusUpdatedAt) || !validTime(row.noteUpdatedAt)) throw new Error('Invalid review');
    byId.set(row.id,row);
  }
  return album.photos.map(photo => {
    if (!byId.has(photo.id)) throw new Error('Unknown photo');
    return cloneRow(byId.get(photo.id));
  });
}

function checkBinding(album,data) {
  if (!data || data.schemaVersion !== 1 || data.albumId !== album.id || data.manifestDigest !== album.manifestDigest) throw new Error('Review belongs to another album or image version');
}

export function initialReviews(album,receipt=null) {
  if (receipt) {
    checkBinding(album,receipt);
    return validatedRows(album,receipt.photos);
  }
  return album.photos.map(p=>({id:p.id,localVerdict:null,note:'',statusUpdatedAt:null,noteUpdatedAt:null}));
}

export function updateReview(rows,id,patch,now=new Date().toISOString()) {
  if (!rows.some(row=>row.id === id)) throw new Error('Unknown photo');
  if (!validTime(now) || now === null) throw new Error('Invalid edit time');
  if (Object.hasOwn(patch,'localVerdict') && patch.localVerdict !== null && !verdicts.includes(patch.localVerdict)) throw new Error('Invalid review status');
  if (Object.hasOwn(patch,'note') && (typeof patch.note !== 'string' || patch.note.length > 4000)) throw new Error('备注最多 4000 个字符；未保存超出的内容。');
  return rows.map(row=> {
    if (row.id !== id) return row;
    const next = {...row};
    if (Object.hasOwn(patch,'note') && patch.note !== row.note) {
      next.note = patch.note;
      next.noteUpdatedAt = now;
    }
    if (Object.hasOwn(patch,'localVerdict') && patch.localVerdict !== row.localVerdict) {
      next.localVerdict = patch.localVerdict;
      next.statusUpdatedAt = now;
    }
    return next;
  });
}

export function createSubmission(album,rows,submissionId) {
  if (!validId(submissionId)) throw new Error('Invalid submission ID');
  const photos = validatedRows(album,rows).map(row=>Object.freeze(row));
  return Object.freeze({schemaVersion:1,albumId:album.id,manifestDigest:album.manifestDigest,submissionId,photos:Object.freeze(photos)});
}

export function makeLocalState(album,rows,pendingSubmission=null) {
  const photos = validatedRows(album,rows);
  let pending = null;
  if (pendingSubmission) {
    checkBinding(album,pendingSubmission);
    pending = createSubmission(album,pendingSubmission.photos,pendingSubmission.submissionId);
  }
  return {schemaVersion:1,albumId:album.id,manifestDigest:album.manifestDigest,photos,pendingSubmission:pending};
}

export function readLocalState(raw,album) {
  try {
    const saved = JSON.parse(raw);
    checkBinding(album,saved);
    return makeLocalState(album,saved.photos,saved.pendingSubmission ?? null);
  } catch { return null; }
}

export function exportDraft(album,rows,now=new Date().toISOString()) {
  return {schemaVersion:1,albumId:album.id,manifestDigest:album.manifestDigest,revision:album.revision,draft:true,submittedAt:null,generatedAt:now,projectRegistryModified:false,photos:validatedRows(album,rows)};
}

export function sameReviews(first,second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false;
  const byId = new Map(second.map(row=>[row.id,row]));
  return first.every(row=> {
    const other = byId.get(row.id);
    return other && ['localVerdict','note','statusUpdatedAt','noteUpdatedAt'].every(key=>row[key] === other[key]);
  });
}

export function receiveExternalDraft(local,remote) {
  return {photos:local,conflict:!sameReviews(local,remote)};
}

export function receiptMatchesSubmission(receipt,submission) {
  return Boolean(receipt && submission && receipt.schemaVersion === 1 && receipt.albumId === submission.albumId && receipt.manifestDigest === submission.manifestDigest && receipt.submissionId === submission.submissionId && receipt.projectRegistryModified === false && receipt.submittedAt !== null && validTime(receipt.submittedAt) && sameReviews(receipt.photos,submission.photos));
}

export function reviewStatus(photo,rows) {
  return rows.find(row=>row.id === photo.id)?.localVerdict ?? 'unreviewed';
}

export function filterPhotos(photos,rows,group,status) {
  return photos.filter(p=>(group === null || p.group === group) && (status === 'all' || reviewStatus(p,rows) === status));
}

export function adjacentId(photos,id,delta) {
  if (!photos.length) return null;
  const index = photos.findIndex(p=>p.id === id);
  return photos[index < 0 ? 0 : (index+delta+photos.length)%photos.length].id;
}

export function fitTransform(width,height,viewportWidth,viewportHeight,zoom=1,center=[.5,.5]) {
  const w=Math.max(1,width),h=Math.max(1,height),vw=Math.max(0,viewportWidth),vh=Math.max(0,viewportHeight);
  const z=Math.min(8,Math.max(1,Number.isFinite(zoom) ? zoom : 1));
  const ratio=Math.min(vw/w,vh/h)*z, renderedW=w*ratio,renderedH=h*ratio;
  const left=renderedW<=vw ? (vw-renderedW)/2 : Math.min(0,Math.max(vw-renderedW,vw/2-center[0]*renderedW));
  const top=renderedH<=vh ? (vh-renderedH)/2 : Math.min(0,Math.max(vh-renderedH,vh/2-center[1]*renderedH));
  return {width:renderedW,height:renderedH,left,top,zoom:z};
}

export function renderedCenter(transform,viewportWidth,viewportHeight) {
  return [
    Math.min(1,Math.max(0,(viewportWidth/2-transform.left)/Math.max(1,transform.width))),
    Math.min(1,Math.max(0,(viewportHeight/2-transform.top)/Math.max(1,transform.height))),
  ];
}
