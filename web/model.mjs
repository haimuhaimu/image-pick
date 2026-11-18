export const verdicts = Object.freeze(['selected','rework','reject']);
export const issueLabels = Object.freeze({composition:'构图',identity:'形象一致性',color:'颜色',details:'细节',text:'文字',other:'其他'});
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
function validTime(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year,month,day,hour,minute,second] = value.slice(0,19).split(/[-T:]/).map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year,month,0)).getUTCDate() && hour <= 23 && minute <= 59 && second <= 59;
}
const validTags = tags => Array.isArray(tags) && tags.length <= Object.keys(issueLabels).length && new Set(tags).size === tags.length && tags.every(tag=>typeof tag === 'string' && Object.hasOwn(issueLabels,tag));
const cloneRow = row => ({id:row.id,localVerdict:row.localVerdict,note:row.note,statusUpdatedAt:row.statusUpdatedAt,noteUpdatedAt:row.noteUpdatedAt,
  ...(Object.hasOwn(row,'issueTags') ? {issueTags:[...row.issueTags],issuesUpdatedAt:row.issuesUpdatedAt} : {})});

export function draftKey(album) {
  return `image-pick:review:v1:${album.id}:${album.manifestDigest}`;
}

function validatedRows(album,rows) {
  if (!Array.isArray(rows) || rows.length !== album.photos.length) throw new Error('Incomplete review');
  const byId = new Map();
  for (const row of rows) {
    if (!row || !validId(row.id) || byId.has(row.id) || (row.localVerdict !== null && !verdicts.includes(row.localVerdict)) || typeof row.note !== 'string' || row.note.length > 4000 || !validTime(row.statusUpdatedAt) || !validTime(row.noteUpdatedAt)) throw new Error('Invalid review');
    if (Object.hasOwn(row,'issueTags') !== Object.hasOwn(row,'issuesUpdatedAt') || (Object.hasOwn(row,'issueTags') && (!validTags(row.issueTags) || !validTime(row.issuesUpdatedAt)))) throw new Error('Invalid issue tags');
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
  if (Object.hasOwn(patch,'issueTags') && !validTags(patch.issueTags)) throw new Error('Invalid issue tags');
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
    if (Object.hasOwn(patch,'issueTags') && JSON.stringify(patch.issueTags) !== JSON.stringify(row.issueTags ?? [])) {
      next.issueTags = [...patch.issueTags];
      next.issuesUpdatedAt = now;
    }
    return next;
  });
}

export function createSubmission(album,rows,submissionId) {
  if (!validId(submissionId)) throw new Error('Invalid submission ID');
  const photos = validatedRows(album,rows).map(row=> {
    if (row.issueTags) Object.freeze(row.issueTags);
    return Object.freeze(row);
  });
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
    return other && ['localVerdict','note','statusUpdatedAt','noteUpdatedAt','issuesUpdatedAt'].every(key=>row[key] === other[key]) && JSON.stringify(row.issueTags) === JSON.stringify(other.issueTags);
  });
}

export function receiveExternalDraft(local,remote) {
  return {photos:local,conflict:!sameReviews(local,remote)};
}

export function receiptMatchesSubmission(receipt,submission) {
  return Boolean(receipt && submission && receipt.schemaVersion === 1 && receipt.albumId === submission.albumId && receipt.manifestDigest === submission.manifestDigest && receipt.submissionId === submission.submissionId && receipt.projectRegistryModified === false && receipt.submittedAt !== null && validTime(receipt.submittedAt) && sameReviews(receipt.photos,submission.photos));
}

function untouched(row) {
  return row.localVerdict === null && row.note === '' && row.statusUpdatedAt === null && row.noteUpdatedAt === null && (row.issueTags?.length ?? 0) === 0 && (row.issuesUpdatedAt ?? null) === null;
}

// Imported files are only draft data. They can never acknowledge a submission.
export const MAX_DRAFT_IMPORT_BYTES = 16*1024*1024;
export function parseDraftFile(bytes) {
  // 500 × 4000 code units can expand to 12 MB as JSON escapes. Backups have a
  // separate bound from the HTTP submission body so every valid export fits.
  if (bytes.byteLength>MAX_DRAFT_IMPORT_BYTES) throw new Error('反馈文件超过 16 MiB');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

export function importDraft(album,rows,data) {
  checkBinding(album,data);
  const current = validatedRows(album,rows), incoming = validatedRows(album,data.photos);
  let imported = 0, skipped = 0;
  const photos = current.map((row,index)=> {
    if (untouched(incoming[index])) return row;
    if (!untouched(row)) { skipped++; return row; }
    imported++; return incoming[index];
  });
  return {photos,imported,skipped};
}

export function handoffRequest(album,rows,receipt,pendingSubmission=null) {
  if (pendingSubmission || !receipt) return null;
  try {
    const snapshot = createSubmission(album,rows,receipt.submissionId);
    if (!receiptMatchesSubmission(receipt,snapshot)) return null;
    return {schemaVersion:1,albumId:album.id,manifestDigest:album.manifestDigest,submissionId:receipt.submissionId,reworkCount:rows.filter(row=>row.localVerdict === 'rework').length};
  } catch { return null; }
}

export function comparisonOptions(photo) {
  const ids = {...(photo.seedId ? {reference:photo.seedId} : {}),...photo.comparisons};
  return [['source','来源图'],['previous','上一版'],['reference','参考图']].filter(([role])=>ids[role]).map(([role,label])=>({role,id:ids[role],label}));
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
