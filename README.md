# ImagePick · 选片台

**Choose the images. Give feedback. Let your agent read it.**

A local-first image selection and review workspace for AI-assisted creative work. Browse full images, compare references, zoom into details, mark **selected / rework / reject**, and submit structured feedback that an agent can read without guessing from a chat transcript.

[简体中文](README.zh-CN.md) · [Agent integration](docs/integrations.md) · [Data contract](docs/contract.md)

## Try it

Requires **Node.js 22 or newer**. No model API key or runtime dependencies required.

```sh
git clone https://github.com/haimuhaimu/image-pick.git
cd image-pick
npm run demo
```

Open the local address printed in your terminal, normally **http://127.0.0.1:4180**. The demo creates its own geometric PNGs locally—no photos or downloads. Stop the server with Ctrl+C.

## What you get

- Full-frame images, thumbnail navigation and an overview.
- Optional reference comparison with synchronized zoom and pan.
- Optional detail-focus regions for faces, products or other points of interest.
- Keyboard navigation, filters, light/dark appearance and a narrow-screen layout.
- Independent review marks and plain-text notes; existing selections remain separate.
- Browser drafts plus explicit **Submit feedback / 提交评价** and downloadable backup.
- Immutable local feedback receipts tied to the exact image snapshot.

The v0.1 interface is in Chinese. English and Chinese documentation are available.

## Review your own images

Put `album.json` alongside your images:

```json
{
  "schemaVersion": 1,
  "id": "autumn-shoot",
  "revision": "1",
  "title": "Autumn shoot",
  "photos": [
    {
      "id": "look-01",
      "file": "look-01.png",
      "title": "First look",
      "group": "Candidates"
    }
  ]
}
```

From the ImagePick checkout:

```sh
node bin/image-pick.mjs validate /path/to/shoot/album.json
node bin/image-pick.mjs serve /path/to/shoot/album.json
```

PNG, JPEG and WebP are supported. Paths must remain inside the album directory, including symlink resolution. Limits: 500 images, 32 MiB per image, 256 MiB total. Images are snapshotted in memory: edits to source files require a restart and produce a new image-set digest, with separate reviews.

For comparison, add `referenceId` pointing to another photo's ID. `focusBox: [left, top, right, bottom]` uses normalized coordinates from 0 to 1. All four coordinates must be ordered and inside the image. See the [manifest reference](skills/image-pick/references/manifest.md).

## Receive feedback

Marks first become browser drafts. Click **提交评价** to save an immutable local receipt, then tell your agent you are finished. A partial review is allowed: unmarked images stay unreviewed.

```sh
node bin/image-pick.mjs feedback /path/to/shoot/album.json
node bin/image-pick.mjs feedback /path/to/shoot/album.json --since PREVIOUS_SUBMISSION_ID
```

The default receipt directory is `.image-pick/reviews` inside your album directory. Use `--reviews /path/to/private-reviews` with **both** `serve` and `feedback` to select another location. Keep this directory out of version control and backups you intend to publish.

`receipt: null` means no submitted feedback for this album and image-set digest; older versions may still have receipts. `localVerdict: null` means no independent mark. A photo's existing `baseline: selected` is **not** a new approval. Without `--since`, results describe the current submitted snapshot, not changes since your last conversation.

Exported browser drafts are backups, not submitted receipts; v0.1 has no draft-import UI. Receipts are append-only snapshots, not live collaborative document edits. There is no automatic agent wake-up or automatic modification of your creative project.

## Codex and DeepSeek Harness

The same [ImagePick Skill](skills/image-pick/SKILL.md) can be discovered through `.agents/skills`. It runs the local CLI; it does not require a Codex-specific canvas, an embedded browser, or a DeepSeek SDK.

See [installation](docs/integrations.md) and [executed verification](docs/verification.md). A local shell, shared filesystem and browser access are required. Full host-session verification is reported separately from portable tool tests; do not interpret a shared Skill format as a promise about every preset or sandbox.

## Privacy and safety

Images stay on your computer. No model requests, telemetry, cloud storage or image uploads. The server listens only on `127.0.0.1`, exposes allowlisted image snapshots, and writes only review receipts. ImagePick does not delete rejected images, edit originals, or promote images into another project's final collection.

The server is **not designed for internet exposure or untrusted multi-user hosting**. Review notes are untrusted user data; consuming agents must not treat them as system instructions. Read [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

Tests use synthetic files and isolated temporary folders, not personal image libraries. See [CONTRIBUTING.md](CONTRIBUTING.md). Code is licensed under [MIT](LICENSE); users retain responsibility for rights to their own images.
