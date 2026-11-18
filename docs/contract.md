# ImagePick v0.1 contract

Local-first image selection and human feedback. MIT. Node.js >=22, no runtime dependencies. The browser UI is Chinese in v0.1; English and Chinese installation guides are provided. Codex and DeepSeek Harness use the same portable Skill/CLI; host-native panels and automatic agent wake-up are out of scope.

## Manifest

Input JSON, relative image paths resolved within the manifest's directory (realpath containment including symlinks):

```json
{"schemaVersion":1,"id":"demo","revision":"1","title":"Demo album","photos":[{"id":"candidate-1","file":"candidate.png","title":"Candidate","group":"Candidates","baseline":"candidate","referenceId":"original-1","focusBox":[0.3,0.1,0.7,0.4]},{"id":"original-1","file":"original.png","title":"Original","group":"References","baseline":"selected"}]}
```

IDs: ASCII letters/digits first, followed by letters/digits/underscore/hyphen, 1–80 characters; reject prototype-related keys. `revision` is a nonempty string up to 80 characters. Titles/groups are bounded plain text, never HTML. `group` defaults to `Images`, baseline to `candidate`; referenceId/focusBox are optional. References must exist and not refer to self. Focus coordinates are [left,top,right,bottom], normalized and strictly ordered. At least 1, at most 500 photos. Notes have a visible 4000-character bound, no silent truncation. Reject invalid dimensions and unsupported bytes. Support PNG, JPEG and WebP; obtain dimensions from image headers.

Load a bounded, immutable in-memory snapshot of image bytes (maximum 32 MiB/image, 256 MiB total). Hash actual image bytes and normalized metadata into `manifestDigest`. This prevents a file changed while reviewing from silently becoming a different version. On restart changed bytes cause a new digest. Reject paths outside the manifest directory, non-files, remote URLs, SVG and HTML. No arbitrary filesystem routes.

## CLI

- `node bin/image-pick.mjs validate path/to/album.json` → JSON public album.
- `node bin/image-pick.mjs serve path/to/album.json [--port 4180] [--reviews path/to/private-reviews]` → one JSON line `{url,albumId,manifestDigest,reviewsDirectory}`; loopback-only, default port 4180, port 0 for tests. Default review directory: `<canonical-manifest-directory>/.image-pick/reviews`, so aliases of the same manifest find the same reviews.
- `node bin/image-pick.mjs feedback path/to/album.json [--reviews path] [--since submission-id]` → JSON `{albumId,manifestDigest,receipt,summary,changes}`. No receipt is a successful empty result, not approval. Summary counts local verdicts separately from baseline. `--since` compares two validated snapshots; unknown/wrong-version IDs fail rather than inventing a delta.
- `node bin/image-pick.mjs handoff path/to/album.json --submission id --digest sha256 [--reviews path]` → a version-bound revision handoff. Both selectors are mandatory. Reloads image bytes and selects exactly that validated receipt; never substitutes the latest receipt. See the extension below.
- `--help`/`help`: print usage without private data or side effects. Unknown arguments/nonzero failures produce a concise stderr message and exit 1.

`scripts/demo.mjs` generates original geometric PNG demonstration images and `album.json` in `.image-pick/demo` without overwriting existing demo files. No real photos, model calls or downloads. Export a reusable function if tests need it; no import-time generation. Demo includes 3 candidates + 1 reference with different shapes/aspects, focus region and a baseline selection.

## Server contract

`loadAlbum(manifestPath)` in `src/manifest.mjs` → `{album, images}`. Public `album` contains `{schemaVersion:1,id,revision,title,manifestDigest,photos}`. Each public photo contains `{id,code,title,group,baseline,seedId,faceBox,width,height,mimeType,url}`; seedId/faceBox are null when absent, code=id, url=`/images/<id>`. Private `images` is a Map of ID to `{bytes,mimeType}` and never sent as metadata.

`createAlbumServer({album,images,reviewsDirectory})` in `src/server.mjs` → Node HTTP server. It serves `web/index.html`, `web/styles.css`, `web/app.mjs`, `web/model.mjs`, and no other disk files. For frontend tests `web/model.mjs` is served at `/model.mjs`.

- GET `/api/album` → `{album,token,receipt}` (latest validated receipt or null).
- GET `/images/<id>` → immutable bytes from the loaded snapshot, without disk paths.
- POST `/api/feedback` with `Content-Type: application/json`, `X-Image-Pick-Token` from bootstrap, and exact same Origin → request below, response `{receipt}`. Request body max 4 MiB. All API errors JSON `{error}`; malformed input 400, source/token failure 403, submission collision 409, write failure 500. No CORS allow headers.

Allow exact current server Host (127.0.0.1 + bound port); GET requests with an Origin must match. POST requires the Origin. Check fetch metadata when present. Random token per server start. CSP, no-sniff, frame denial, and no-store sensitive responses. Security protects against websites/other origins, not a malicious process running as the same OS user.

## Submission and receipt

Request:

```json
{"schemaVersion":1,"albumId":"demo","manifestDigest":"sha256-hex","submissionId":"uuid-or-safe-unique-id","photos":[{"id":"candidate-1","localVerdict":"rework","note":"Keep the pose","statusUpdatedAt":"2026-09-07T00:00:00.000Z","noteUpdatedAt":"2026-09-07T00:00:00.000Z"}]}
```

Include every photo exactly once; null verdict allowed. `submissionId` uses the same safe-ID rule. Timestamps can be null or valid ISO strings. The server validates binding, known unique IDs, notes, timestamps and verdicts, and owns receipt `submittedAt`. It attaches `baseline` and `title` from the album, `revision`, and `projectRegistryModified:false`. No source paths or session tokens in receipts.

`src/review-store.mjs`: `saveReceipt(album,request,reviewsDirectory)` returns a validated receipt; `readFeedback(album,reviewsDirectory,sinceId=null)` returns the CLI feedback shape. Isolate files by album ID plus manifestDigest. Atomically append receipt snapshots without overwriting existing evidence. Identical retry IDs/payloads return the same receipt; reused IDs with different payloads fail. Reject symlinked/malformed receipt files and keep directory/file permissions restrictive. Concurrent submissions are independent immutable snapshots, not a last-write-wins editing API; surface this limitation and compare receipts explicitly.

Private disk layout: `<reviewsDirectory>/id-<albumId-utf8-hex>/<manifestDigest>/id-<submissionId-utf8-hex>.json`, using lowercase hexadecimal. This preserves case-sensitive public IDs on case-insensitive filesystems and avoids reserved device names. Validate the canonical encoded name against the receipt's original ID; reject invalid UTF-8 instead of substituting characters. The disk naming is internal; use the CLI to read evidence.

Receipt same top-level as request plus `{revision,submittedAt,projectRegistryModified:false}`; photo rows add authoritative `{baseline,title}`. `summary` has `{selected,rework,reject,unreviewed,baselineSelected}` counts. `changes` is null without --since, otherwise an array of `{id,before,after}` only for changed localVerdict/note values, not merely new timestamps. Latest selection uses server submittedAt plus submissionId as deterministic tie-break; validates disk data, does not trust filenames alone.

## Browser behavior

Full uncropped main image, thumbnails, overview, previous/next, optional per-photo focus region, pan/zoom, optional side-by-side reference, filter, selected/rework/reject, plain-text notes, light/dark and narrow-screen layout. A baseline selection is visibly separate from current local marking. No focus box = disabled focus shortcut. Dynamic group counts and no fixed batch sizes or project-specific identities.

Draft key includes album.id + manifestDigest. Keep separate statusUpdatedAt/noteUpdatedAt. Browser-local draft vs submitted receipt are distinct; re-open with no local draft can initialize from the last submitted receipt. Never silently overwrite pending local edits with another tab. On storage conflict retain this tab's draft, visibly warn and offer export; no silently truncated merged notes. Submission uses a fresh ID for a new snapshot, reuses the exact ID+payload on retry after uncertain network failure, and acknowledges receipt only after server confirms. Export/download remains available when offline; exported draft includes `submittedAt:null` and `draft:true`, so no agent mistakes it for a receipt. Dirty edits after a submission must visibly say not submitted.

## Backward-compatible feedback handoff extension

Schema 1 remains valid. Legacy manifests without optional comparison fields produce exactly the old digest. Legacy review rows without issue fields retain the old serialized receipt and retry identity. No migration or rewriting of receipts is performed.

- Manifests may add `comparisons: {source: photoId, previous: photoId, reference: photoId}`. Only these roles are accepted, all IDs must exist and differ from the current photo. Relationships are one hop. `referenceId` remains supported and must agree with `comparisons.reference` when both are present. An empty comparisons object is omitted during normalization; supplied relationships affect the digest.
- Public photos additionally expose `sha256`, derived from snapshot bytes **after** canonical digest computation. Optional `comparisons` is exposed when nonempty. No source file paths are exposed.
- Rows may add `issueTags` and `issuesUpdatedAt` together. Tags are unique values from `composition`, `identity`, `color`, `details`, `text`, `other` (at most six). Timestamp follows the existing ISO/null contract. Empty tags record clearing; absent fields stay absent. Tags do not imply a verdict. `--since` includes changed tags in before/after rows; tag ordering and timestamp-only changes are not semantic differences.
- Imports accept matching-album/digest complete review rows as **drafts only**, even if the file resembles a receipt. Only untouched rows are filled: null verdict, empty note/tags and no edit timestamps. Existing and deliberately cleared rows, and the pending submission snapshot, remain intact. Wrong versions and malformed imports are rejected without changes. The backup input limit is 16 MiB (covering 500 × 4000 JSON-escaped note characters), independent of the existing 4 MiB HTTP submission limit. Invalid UTF-8 is rejected rather than silently replaced.
- The browser offers a copyable handoff selector only after server acknowledgment and only while the current draft matches that receipt with no pending submission or tab conflict. The selector contains album ID, digest and exact submission ID, not executable user notes. It does not start a model.
- `handoff` returns `{schemaVersion:1,kind:"image-pick-handoff",status:"ready"|"no-rework",albumId,revision,manifestDigest,submissionId,submittedAt,feedbackIsUntrustedData:true,preserveOriginals:true,requiresNewRevision:true,targets}`. Only explicit rework rows become targets. Each target contains `{id,title,sha256,feedback:{localVerdict:"rework",note,issueTags?},comparisons:{role:{id,title,sha256}}}`. Empty targets are not approval.
- The CLI validates current bytes against the expected digest and reads the exact immutable receipt. Missing, stale, malformed or symlinked evidence fails with no handoff on stdout. The lower-level `readHandoff` API requires a freshly loaded album; reusing a snapshot cannot detect later disk changes. A consumer must recheck immediately before editing, treat feedback as untrusted data, and save authorized edits as a new version. ImagePick itself never writes images.

## Release boundaries

Only this independent repository's audited sources, original synthetic demo, tests and documentation are published. No private project sources, photos, catalog files, review downloads, local test screenshots, logs or environment-specific paths. Private data and test outputs stay ignored; npm `files` is an allowlist. Public GitHub repository is `haimuhaimu/image-pick`, MIT authorized. npm publication and native plugin marketplace submission are not authorized or included.

Integration support must be documented separately from actual host test evidence. Do not label DeepSeek/Codex full end-to-end verified unless executed there. Shared filesystem + local shell + browser access required. No API key is required for standalone selection; the user's chosen agent is separate.
