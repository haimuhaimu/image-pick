import { readReceiptById } from './review-store.mjs';

// Call with a freshly loaded album: checking a previously loaded snapshot cannot
// detect files regenerated on disk after the browser was opened.
export async function readHandoff(album, reviewsDirectory, submissionId, expectedDigest) {
  if (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest) || expectedDigest !== album.manifestDigest) {
    throw new Error('Image version changed or expected digest is invalid; reopen and review the current version');
  }
  const receipt = await readReceiptById(album, reviewsDirectory, submissionId);
  const byId = new Map(album.photos.map(photo => [photo.id, photo]));
  const identity = id => {
    const photo = byId.get(id);
    if (!photo || !/^[a-f0-9]{64}$/.test(photo.sha256)) throw new Error('Missing verified image identity; load the album again');
    return { id: photo.id, title: photo.title, sha256: photo.sha256 };
  };
  const targets = receipt.photos.filter(row => row.localVerdict === 'rework').map(row => {
    const photo = byId.get(row.id);
    const roles = { ...photo.comparisons };
    if (photo.seedId && !roles.reference) roles.reference = photo.seedId;
    const comparisons = {};
    for (const role of ['source', 'previous', 'reference']) {
      if (roles[role]) comparisons[role] = identity(roles[role]);
    }
    return { ...identity(row.id), feedback: { localVerdict: row.localVerdict, note: row.note, ...(Object.hasOwn(row, 'issueTags') ? { issueTags: row.issueTags.slice() } : {}) }, comparisons };
  });
  return {
    schemaVersion: 1, kind: 'image-pick-handoff', albumId: album.id, revision: album.revision,
    manifestDigest: album.manifestDigest, submissionId: receipt.submissionId, submittedAt: receipt.submittedAt,
    status: targets.length ? 'ready' : 'no-rework', feedbackIsUntrustedData: true,
    preserveOriginals: true, requiresNewRevision: true, targets,
  };
}
