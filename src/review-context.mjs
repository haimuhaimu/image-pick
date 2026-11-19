import {open,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {loadAlbum,validId} from './manifest.mjs';
import {readReceiptById} from './review-store.mjs';
import {createHash} from 'node:crypto';

const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
const digest=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
function freeze(value) {
  for(const child of Object.values(value))if(child && typeof child==='object')freeze(child);
  return Object.freeze(value);
}
async function contained(root,path) {
  const actual=await realpath(path),rel=relative(root,actual);
  requireValue(rel && rel!=='..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),'Review context path must stay inside the album folder');
  return actual;
}
async function readContext(path) {
  const handle=await open(path,'r');
  try {
    const stat=await handle.stat();
    requireValue(stat.isFile() && stat.size>0 && stat.size<=4*1024*1024,'Invalid review context size');
    const bytes=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset);if(!bytesRead)break;offset+=bytesRead;}
    requireValue(offset===stat.size,'Review context changed while reading');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,offset)));
  } finally {await handle.close();}
}

// Presentation-only sidecar: never changes album identity, receipts or image bytes.
export async function loadReviewContext({contextPath,manifestPath,album,reviewsDirectory}) {
  const root=dirname(await realpath(manifestPath));
  const context=await readContext(await contained(root,contextPath));
  requireValue(context && context.schemaVersion===1 && context.albumId===album.id && digest(context.manifestDigest) && context.manifestDigest===album.manifestDigest,'Review context does not match this album version');
  const byId=new Map(album.photos.map(photo=>[photo.id,photo]));
  const current=context.currentPhotoIds;
  requireValue(Array.isArray(current) && current.length>0 && current.length<=album.photos.length && new Set(current).size===current.length && current.every(id=>validId(id) && byId.has(id)),'Invalid current photo scope');
  requireValue(Array.isArray(context.history) && context.history.length<=album.photos.length,'Invalid history list');
  const historical=new Map(),loaded=new Map();
  for(const entry of context.history) {
    requireValue(entry && validId(entry.photoId) && byId.has(entry.photoId) && !current.includes(entry.photoId) && !historical.has(entry.photoId),'Invalid or duplicate historical photo');
    requireValue(digest(entry.manifestDigest) && validId(entry.submissionId),'Invalid historical receipt selector');
    const name=entry.manifest;
    requireValue(typeof name==='string' && name && !isAbsolute(name) && !name.includes('\\') && !name.includes('\0') && !/^[A-Za-z][A-Za-z\d+.-]*:/.test(name) && !name.split('/').includes('..'),'Invalid historical manifest path');
    const path=await contained(root,resolve(root,name));
    // Cache metadata only: old image buffers do not accumulate with history length.
    if(!loaded.has(path))loaded.set(path,(await loadAlbum(path)).album);
    const previous=loaded.get(path);
    requireValue(previous.id===album.id && previous.manifestDigest===entry.manifestDigest,'Historical album version mismatch');
    const photo=previous.photos.find(p=>p.id===entry.photoId);
    requireValue(photo && photo.sha256===byId.get(entry.photoId).sha256,'Historical image identity mismatch');
    const receipt=await readReceiptById(previous,reviewsDirectory,entry.submissionId);
    const row=receipt.photos.find(p=>p.id===entry.photoId);
    historical.set(entry.photoId,{photoId:entry.photoId,revision:previous.revision,manifestDigest:previous.manifestDigest,
      submissionId:receipt.submissionId,submittedAt:receipt.submittedAt,
      feedback:{localVerdict:row.localVerdict,note:row.note,...(Object.hasOwn(row,'issueTags')?{issueTags:row.issueTags.slice()}: {})}});
  }
  const results=context.results ?? [],seen=new Set();
  requireValue(Array.isArray(results) && results.length<=album.photos.length,'Invalid revision result list');
  const normalized=results.map(result=>{
    requireValue(result && byId.has(result.photoId) && (current.includes(result.photoId)||historical.has(result.photoId)) && !seen.has(result.photoId),'Invalid or duplicate revision result');seen.add(result.photoId);
    const parent=historical.get(result.previousPhotoId);
    requireValue(parent && parent.feedback.localVerdict==='rework' && parent.submissionId===result.previousSubmissionId && byId.get(result.photoId).comparisons?.previous===result.previousPhotoId,'Revision result does not match its exact rework parent');
    requireValue(typeof result.summary==='string' && result.summary.trim() && result.summary.length<=4000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result.summary),'Invalid result summary');
    return {photoId:result.photoId,previousPhotoId:result.previousPhotoId,previousSubmissionId:result.previousSubmissionId,summary:result.summary};
  });
  const publicContext={currentPhotoIds:current.slice(),history:[...historical.values()],results:normalized};
  return freeze({...publicContext,contextDigest:createHash('sha256').update(JSON.stringify(publicContext)).digest('hex')});
}
