import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftKey, initialReviews, updateReview, readLocalState, makeLocalState,
  reviewStatus, filterPhotos, adjacentId, createSubmission, exportDraft,
  sameReviews, receiveExternalDraft, receiptMatchesSubmission,
  fitTransform, renderedCenter,
  importDraft, handoffRequest, comparisonOptions, parseDraftFile,
} from '../web/model.mjs';

const album = {
  id:'demo', revision:'1', manifestDigest:'a'.repeat(64),
  photos:[
    {id:'candidate',title:'Candidate',group:'Candidates',baseline:'candidate'},
    {id:'reference',title:'Reference',group:'References',baseline:'selected'},
  ],
};
const early = '2026-09-07T00:00:00.000Z';
const later = '2026-09-07T00:01:00.000Z';

test('a reused photo ID cannot recover another album or changed-image draft', () => {
  const key = draftKey(album);
  assert.notEqual(draftKey({...album,id:'another'}),key);
  assert.notEqual(draftKey({...album,manifestDigest:'b'.repeat(64)}),key);
  const saved = JSON.stringify(makeLocalState(album,initialReviews(album)));
  assert.equal(readLocalState(saved,{...album,id:'another'}),null);
  assert.equal(readLocalState(saved,{...album,manifestDigest:'b'.repeat(64)}),null);
});

test('a baseline selection never becomes a new local verdict or timestamp', () => {
  const rows = initialReviews(album);
  assert.deepEqual(rows[1],{id:'reference',localVerdict:null,note:'',statusUpdatedAt:null,noteUpdatedAt:null});
  assert.equal(reviewStatus(album.photos[1],rows),'unreviewed');
  assert.equal(filterPhotos(album.photos,rows,null,'selected').length,0);
});

test('note and verdict changes have independent timestamps and preserve prior state', () => {
  const initial = initialReviews(album);
  const noted = updateReview(initial,'candidate',{note:'Keep pose'},early);
  const marked = updateReview(noted,'candidate',{localVerdict:'rework'},later);
  assert.deepEqual(marked[0],{id:'candidate',localVerdict:'rework',note:'Keep pose',statusUpdatedAt:later,noteUpdatedAt:early});
  assert.equal(noted[0].statusUpdatedAt,null);
  assert.equal(initial[0].note,'');
  assert.deepEqual(updateReview(marked,'candidate',{note:'Keep pose'},later),marked);
  assert.equal(updateReview(marked,'candidate',{localVerdict:null},later)[0].note,'Keep pose');
});

test('long notes are rejected in full rather than silently truncated', () => {
  const initial = initialReviews(album);
  assert.equal(updateReview(initial,'candidate',{note:'x'.repeat(4000)},early)[0].note.length,4000);
  assert.throws(()=>updateReview(initial,'candidate',{note:'x'.repeat(4001)},early),/4000/);
  assert.throws(()=>updateReview(initial,'candidate',{localVerdict:'publish'},early));
  assert.throws(()=>updateReview(initial,'missing',{note:'hello'},early));
  assert.equal(initial[0].note,'');
});

test('partial review submits every photo while preserving null opinions', () => {
  const rows = updateReview(initialReviews(album),'candidate',{localVerdict:'selected'},early);
  const snapshot = createSubmission(album,rows,'submission-1');
  assert.deepEqual(snapshot,{schemaVersion:1,albumId:'demo',manifestDigest:'a'.repeat(64),submissionId:'submission-1',photos:[
    {id:'candidate',localVerdict:'selected',note:'',statusUpdatedAt:early,noteUpdatedAt:null},
    {id:'reference',localVerdict:null,note:'',statusUpdatedAt:null,noteUpdatedAt:null},
  ]});
  assert.throws(()=>{snapshot.photos[0].note='mutated';});
  const edits = updateReview(rows,'candidate',{note:'Made while submitting'},later);
  assert.equal(snapshot.photos[0].note,'');
  assert.equal(sameReviews(edits,snapshot.photos),false);
});

test('restart recovery preserves the exact pending retry separately from newer edits', () => {
  const first = updateReview(initialReviews(album),'candidate',{note:'First snapshot'},early);
  const pending = createSubmission(album,first,'retry-1');
  const newer = updateReview(first,'candidate',{note:'Newer draft'},later);
  const loaded = readLocalState(JSON.stringify(makeLocalState(album,newer,pending)),album);
  assert.equal(loaded.photos[0].note,'Newer draft');
  assert.deepEqual(loaded.pendingSubmission,pending);
  assert.equal(loaded.pendingSubmission.photos[0].note,'First snapshot');
});

test('malformed, unknown, duplicate and oversized local rows are not adopted', () => {
  assert.equal(readLocalState('{broken',album),null);
  const good = makeLocalState(album,initialReviews(album));
  assert.equal(readLocalState(JSON.stringify({...good,photos:[good.photos[0],good.photos[0]]}),album),null);
  assert.equal(readLocalState(JSON.stringify({...good,photos:[{...good.photos[0],id:'unknown'},good.photos[1]]}),album),null);
  assert.equal(readLocalState(JSON.stringify({...good,photos:[{...good.photos[0],note:'a'.repeat(4001)},good.photos[1]]}),album),null);
  assert.equal(readLocalState(JSON.stringify({...good,pendingSubmission:{...createSubmission(album,good.photos,'retry'),manifestDigest:'b'.repeat(64)}}),album),null);
});

test('offline exports are explicitly drafts, not acknowledged receipts', () => {
  const data = exportDraft(album,initialReviews(album),early);
  assert.equal(data.draft,true);
  assert.equal(data.submittedAt,null);
  assert.equal(data.generatedAt,early);
  assert.equal(data.albumId,'demo');
  assert.equal(data.manifestDigest,'a'.repeat(64));
  assert.equal(data.photos.length,2);
  assert.equal('token' in data,false);
});

test('receipt restoration requires the current image version and keeps null timestamps', () => {
  const rows = updateReview(initialReviews(album),'candidate',{note:'Submitted note'},early);
  const receipt = {...createSubmission(album,rows,'receipt-1'),submittedAt:later,projectRegistryModified:false};
  assert.deepEqual(initialReviews(album,receipt),rows);
  assert.throws(()=>initialReviews(album,{...receipt,manifestDigest:'b'.repeat(64)}));
  assert.equal(initialReviews(album,receipt)[0].statusUpdatedAt,null);
});

test('external tab changes retain this tab verbatim and signal a conflict without merging text', () => {
  const local = updateReview(initialReviews(album),'candidate',{note:'L'.repeat(4000)},early);
  const remote = updateReview(initialReviews(album),'candidate',{note:'R'.repeat(4000)},later);
  const result = receiveExternalDraft(local,remote);
  assert.equal(result.conflict,true);
  assert.deepEqual(result.photos,local);
  assert.equal(result.photos[0].note.length,4000);
  assert.equal(receiveExternalDraft(local,structuredClone(local)).conflict,false);
});

test('an unrelated or mismatched response cannot acknowledge a pending submission', () => {
  const pending = createSubmission(album,initialReviews(album),'receipt-1');
  const response = {...pending,submittedAt:later,projectRegistryModified:false};
  assert.equal(receiptMatchesSubmission(response,pending),true);
  assert.equal(receiptMatchesSubmission({...response,submissionId:'other'},pending),false);
  assert.equal(receiptMatchesSubmission({...response,submittedAt:null},pending),false);
  assert.equal(receiptMatchesSubmission({...response,photos:updateReview(pending.photos,'candidate',{note:'different'},early)},pending),false);
});

test('dynamic groups filter local verdicts and navigation handles empty groups', () => {
  const reviews = updateReview(initialReviews(album),'reference',{localVerdict:'reject'},early);
  assert.deepEqual(filterPhotos(album.photos,reviews,'References','reject').map(p=>p.id),['reference']);
  assert.equal(adjacentId(album.photos,'candidate',-1),'reference');
  assert.equal(adjacentId([],null,1),null);
});

test('an actual group named all is not mistaken for the all-groups filter', () => {
  const photos=[{...album.photos[0],group:'all'},album.photos[1]];
  assert.deepEqual(filterPhotos(photos,initialReviews(album),'all','all').map(photo=>photo.id),['candidate']);
  assert.equal(filterPhotos(photos,initialReviews(album),null,'all').length,2);
});

test('fit preserves the entire photo at any aspect ratio and caps zoom', () => {
  assert.deepEqual(fitTransform(1000,2000,800,800,1,[.5,.5]),{width:400,height:800,left:200,top:0,zoom:1});
  assert.deepEqual(fitTransform(2000,1000,800,800,1,[.5,.5]),{width:800,height:400,left:0,top:200,zoom:1});
  assert.equal(fitTransform(1000,1000,500,500,999,[.5,.5]).zoom,8);
  const clamped = fitTransform(1000,1000,500,500,2,[.5,0]);
  assert.deepEqual(renderedCenter(clamped,500,500),[.5,.25]);
});

test('issue tags are independent, survive retry/export and cannot mutate a frozen submission', () => {
  const initial = initialReviews(album);
  const tagged = updateReview(initial,'candidate',{issueTags:['identity','details']},early);
  assert.equal(tagged[0].localVerdict,null);
  assert.equal(tagged[0].issuesUpdatedAt,early);
  const pending = createSubmission(album,tagged,'tags-1');
  assert.throws(()=>pending.photos[0].issueTags.push('other'));
  const cleared = updateReview(tagged,'candidate',{issueTags:[]},later);
  assert.equal(sameReviews(tagged,cleared),false);
  assert.deepEqual(exportDraft(album,cleared).photos[0].issueTags,[]);
  const loaded = readLocalState(JSON.stringify(makeLocalState(album,cleared,pending)),album);
  assert.deepEqual(loaded.pendingSubmission.photos[0].issueTags,['identity','details']);
  assert.deepEqual(loaded.photos[0].issueTags,[]);
  assert.equal(receiveExternalDraft(tagged,cleared).conflict,true);
  assert.equal(receiptMatchesSubmission({...pending,photos:cleared,submittedAt:later,projectRegistryModified:false},pending),false);
  assert.equal(Object.hasOwn(initial[0],'issueTags'),false);
  for (const issueTags of [['unknown'],['identity','identity'],'identity']) assert.throws(()=>updateReview(initial,'candidate',{issueTags},early));
});

test('imports fill untouched rows only and never turn imported receipt data into acknowledgment', () => {
  const empty = initialReviews(album);
  const touched = updateReview(updateReview(empty,'candidate',{note:'clear me'},early),'candidate',{note:''},later);
  const imported = updateReview(updateReview(empty,'candidate',{note:'do not overwrite'},early),'reference',{issueTags:['color'],note:'Fix color'},early);
  const foreignReceipt = {...exportDraft(album,imported),draft:false,submissionId:'forged',submittedAt:early};
  const result = importDraft(album,touched,foreignReceipt);
  assert.deepEqual(result.photos[0],touched[0]);
  assert.deepEqual(result.photos[1],imported[1]);
  assert.deepEqual({imported:result.imported,skipped:result.skipped},{imported:1,skipped:1});
  assert.equal(Object.hasOwn(result,'receipt'),false);
  const pending = createSubmission(album,empty,'retry');
  assert.deepEqual(makeLocalState(album,result.photos,pending).pendingSubmission,pending);
  assert.throws(()=>importDraft(album,empty,{...foreignReceipt,manifestDigest:'b'.repeat(64)}),/version/);
  assert.throws(()=>importDraft(album,empty,{...foreignReceipt,photos:[{...imported[0],noteUpdatedAt:'2026-02-30T00:00:00Z'},imported[1]]}));
  assert.throws(()=>importDraft(album,empty,{...foreignReceipt,photos:[{...imported[0],issueTags:['other']},imported[1]]}));
});

test('handoff selects the exact acknowledged receipt and refuses dirty or pending drafts', () => {
  const rows = updateReview(initialReviews(album),'candidate',{localVerdict:'rework',note:'literal $(do not execute)'},early);
  const receipt = {...createSubmission(album,rows,'exact-1'),submittedAt:later,projectRegistryModified:false};
  const result = handoffRequest(album,rows,receipt);
  assert.equal(result.submissionId,'exact-1');
  assert.equal(result.manifestDigest,album.manifestDigest);
  assert.equal(result.reworkCount,1);
  assert.equal(JSON.stringify(result).includes('do not execute'),false);
  assert.equal(handoffRequest(album,rows,null),null);
  assert.equal(handoffRequest(album,rows,receipt,createSubmission(album,rows,'retry')),null);
  assert.equal(handoffRequest(album,updateReview(rows,'candidate',{issueTags:['text']},later),receipt),null);
  assert.equal(handoffRequest(album,rows,{...receipt,manifestDigest:'b'.repeat(64)}),null);
});

test('comparison choices use named roles while preserving legacy reference IDs', () => {
  assert.deepEqual(comparisonOptions({seedId:'reference'}),[{role:'reference',id:'reference',label:'参考图'}]);
  assert.deepEqual(comparisonOptions({comparisons:{source:'s',previous:'p',reference:'r'},seedId:'r'}).map(x=>x.role),['source','previous','reference']);
  assert.deepEqual(comparisonOptions({seedId:null}),[]);
});

test('maximum-size exported drafts can be recovered without lossy UTF-8 decoding', () => {
  const large={...album,photos:Array.from({length:500},(_,i)=>({...album.photos[0],id:`image-${i}`}))};
  const rows=initialReviews(large).map(row=>({...row,note:'\u0000'.repeat(4000),noteUpdatedAt:early}));
  const bytes=new TextEncoder().encode(JSON.stringify(exportDraft(large,rows),null,2));
  assert.ok(bytes.byteLength>4*1024*1024);
  assert.deepEqual(importDraft(large,initialReviews(large),parseDraftFile(bytes)).photos,rows);
  assert.throws(()=>parseDraftFile(new Uint8Array(16*1024*1024+1)),/16 MiB/);
  assert.throws(()=>parseDraftFile(new Uint8Array([0xff])));
});
