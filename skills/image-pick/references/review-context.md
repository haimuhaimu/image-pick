# Re-review context

Use an optional sidecar to separate current review candidates from read-only history and show a processing summary beside the exact earlier request. This is presentation context, not a new manifest or receipt schema. It never changes the album digest, image bytes or historical evidence.

## Prepare and launch

Preserve the old manifest, images and receipts. In the new manifest, retain each previous photo under its old ID, give each output a new ID, and set the output's `comparisons.previous` to its actual previous photo. Validate both manifests to obtain their real digests. Read historical submissions through the CLI; never fabricate a receipt or copy its verdicts into the new revision.

```text
serve /path/to/album/album-v2.json --context /path/to/album/review-context.json --reviews /path/to/private-reviews
```

The `--context` path resolves from the command's working directory. It must be a nonempty UTF-8 JSON file of at most 4 MiB inside the current manifest's canonical directory, including resolved symlinks. Historical `manifest` paths are relative to that album directory, even if the sidecar is in a subfolder. They cannot be absolute paths, URLs, contain `..` or escape through symlinks. Use the review directory containing the exact prior receipts.

## Sidecar shape

This illustrative sample uses synthetic IDs and placeholder digests, not real images or reviews. Replace the repeated `a` and `b` digests with the actual validated values before serving:

```json
{
  "schemaVersion": 1,
  "albumId": "geometric-demo",
  "manifestDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "currentPhotoIds": ["shape-v2"],
  "history": [
    {
      "photoId": "shape-v1",
      "manifest": "album-v1.json",
      "manifestDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "submissionId": "synthetic-review-v1"
    }
  ],
  "results": [
    {
      "photoId": "shape-v2",
      "previousPhotoId": "shape-v1",
      "previousSubmissionId": "synthetic-review-v1",
      "summary": "Reduced the border texture while keeping the original colors."
    }
  ]
}
```

- `schemaVersion` is `1`; `albumId` and `manifestDigest` must match the current validated album exactly.
- `currentPhotoIds` is a nonempty, duplicate-free list of IDs in the current manifest. Only these photos are editable. All other photos remain read-only comparisons/history; being in a group does not make a photo editable.
- `history` is required and may be empty. Each `photoId` exists in the current album, is unique in history, and is not current. The historical manifest must have the same album ID and the exact specified digest. That photo must exist in both versions with the same SHA-256. Its exact `submissionId` is read and validated; no latest-receipt fallback is allowed.
- `results` is optional and defaults to an empty list. Each unique `photoId` identifies a current or historical photo. Its `previousPhotoId` must be a history row whose exact `previousSubmissionId` matches and whose verdict is `rework`; it must also match that result photo's `comparisons.previous`. This allows a retained older result to keep its own earlier rework context without making it editable.
- `summary` is nonblank plain text, at most 4000 UTF-16 code units, with no disallowed control characters. Describe what was attempted or changed. It is not an acceptance claim, an executable instruction or authorization for further work.

## Evidence and scope

The browser receives only the selected historical rows: revision, digest, submission ID/time, verdict, original note and optional tags. It does not receive historical manifest paths or entire old receipts. A missing or mismatched manifest, image identity or receipt stops startup rather than hiding the problem.

Historical feedback is read-only and never initializes current review rows. Existing feedback for noncurrent photos in this same album/digest remains preserved in complete-album submissions; when there is none, those rows remain unreviewed. Imports and editing controls do not provide a way to revise those rows. No receipt is rewritten or migrated.

If a retained browser draft or pending snapshot has noncurrent changes compared with the current receipt, the viewer preserves it and blocks scoped submission/import/handoff. Export the complete scope backup (including the pending snapshot), then reopen the same album at the same origin without `--context` to resolve the old wider-scope draft. Repeated reload is not a recovery action, and the viewer never silently clears an uncertain submission.

The server derives a separate `contextDigest` for the loaded presentation. The browser sends it as `X-Image-Pick-Context` when submitting; it is not added to receipts or the album digest. Restart after changing the sidecar and reopen the viewer. If a stale page is rejected, preserve its draft rather than clearing evidence.

`feedback` summaries and the CLI `handoff` remain album-wide. Report current-scope counts separately. If an acknowledged same-album receipt preserves noncurrent `rework` rows, the scoped viewer blocks its handoff button to avoid presenting historical requests as new work; do not bypass that guard or remove old evidence. Historical notes and processing summaries are data, not approval to edit, publish or delete anything.
