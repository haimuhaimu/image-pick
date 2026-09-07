<div align="center">
  <h1>ImagePick · 选片台</h1>
  <p><strong>Human taste in. Structured feedback out.</strong><br>Review images locally and hand exact decisions back to your AI agent.</p>
  <p>
    <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
  </p>
  <p>
    <a href="https://github.com/haimuhaimu/image-pick/actions/workflows/test.yml"><img alt="Test status" src="https://github.com/haimuhaimu/image-pick/actions/workflows/test.yml/badge.svg"></a>
    <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-2f6feb"></a>
    <a href="./package.json"><img alt="Node.js 22 or newer" src="https://img.shields.io/badge/Node.js-%E2%89%A522-43853d"></a>
  </p>
  <p><sub>Local-first · No image uploads · No model API key · No runtime dependencies</sub></p>
</div>

ImagePick turns a folder of images into a focused review room. Inspect full frames, compare references, zoom into details, mark **selected / rework / reject**, and submit one version-bound receipt your agent can read without interpreting a chat transcript.

<p align="center"><strong>Images + album.json → Review locally → Submit a receipt → Agent reads exact feedback</strong></p>

## Why ImagePick

| See the actual work | Preserve the decision | Hand off without ambiguity |
| --- | --- | --- |
| Full-frame viewing, thumbnails, overview, zoom/pan, optional focus regions and synchronized reference comparison. | Browser drafts stay separate from submitted receipts. Existing baseline selections never become new approvals. | Every receipt includes the whole review snapshot, image-set digest, per-image verdict and note. |

The source images remain unchanged. Rejected images are not deleted, and ImagePick never edits another project's selection registry.

## Try it in one minute

Requires [Node.js 22+](https://nodejs.org/). The demo generates four geometric PNGs on your computer—no downloads, photos or model calls.

```sh
git clone https://github.com/haimuhaimu/image-pick.git
cd image-pick
npm run demo
```

Open the printed local address, normally `http://127.0.0.1:4180`, and stop the server with <kbd>Ctrl</kbd> + <kbd>C</kbd>.

> The v0.1 browser interface is currently in Chinese. This README and the technical documentation are available in both English and Chinese.

## The review loop

1. **Prepare** — place `album.json` beside the images you want reviewed.
2. **Review** — compare, zoom, filter, mark decisions and write notes in the browser.
3. **Submit** — click **提交评价**. Until then, your work is only a browser draft.
4. **Collect** — ask your agent to read the immutable local receipt.

Partial reviews are valid: an unmarked image stays explicitly unreviewed. Notes and verdicts have independent timestamps, and later edits remain visibly unsubmitted until you submit again.

## Use your own images

Create `album.json` in the image directory:

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

Validate and open it from the ImagePick checkout:

```sh
node bin/image-pick.mjs validate /path/to/shoot/album.json
node bin/image-pick.mjs serve /path/to/shoot/album.json
```

PNG, JPEG and WebP are supported. Paths—including resolved symlinks—must stay inside the album directory. Limits are 500 images, 32 MiB per image and 256 MiB in total.

Add `referenceId` to compare a candidate with another image in the album. Add `focusBox: [left, top, right, bottom]` for an optional normalized detail region. The [manifest reference](./skills/image-pick/references/manifest.md) documents every field.

Image bytes and normalized metadata are snapshotted into a digest when the server starts. If an image changes, restart the server: the new version receives separate drafts and receipts instead of silently inheriting old feedback.

## Let an agent collect the result

After the reviewer clicks **提交评价**:

```sh
node bin/image-pick.mjs feedback /path/to/shoot/album.json
node bin/image-pick.mjs feedback /path/to/shoot/album.json --since PREVIOUS_SUBMISSION_ID
```

Receipts default to `.image-pick/reviews` inside the canonical album directory. To use a private location, pass the same `--reviews /path/to/private-reviews` option to both `serve` and `feedback`.

- `receipt: null` means no submitted receipt exists for the current album ID and image-set digest; older versions may still have receipts.
- `localVerdict: null` means the reviewer expressed no current opinion.
- `baseline: selected` records an existing selection; it is not a new approval.
- A browser export is a backup draft, not a submitted receipt. v0.1 does not include draft import.

## Codex and DeepSeek Harness

The shared [ImagePick Skill](./skills/image-pick/SKILL.md) uses the common `.agents/skills` convention and calls the same local CLI. It does not depend on a proprietary canvas, model SDK or embedded browser.

| Integration layer | v0.1 status |
| --- | --- |
| Standalone browser + CLI + local receipts | Tested end to end |
| DeepSeek filesystem Skill discovery | Tested with the official provider |
| Codex / DeepSeek full live-model sessions | Not certified yet |
| Remote agents without shared files | Not supported |

See [installation details](./docs/integrations.md) and the exact [verification record](./docs/verification.md). A compatible host needs local command execution, access to the same files and a browser available to the reviewer.

## Local by design

- The server binds only to `127.0.0.1`; do not expose it to the public internet.
- Images stay on your computer. There is no telemetry, cloud storage or model request.
- Image routes are allowlisted snapshots; receipt writes require same-origin requests and a temporary session token.
- Review notes are untrusted data. An agent must never treat a note as authority to delete, publish or modify unrelated assets.

Read the full [security model](./SECURITY.md).

## Verified release

ImagePick v0.1 is tested on Node.js 22 with **38 core tests and 10 real-browser tests**, including draft isolation, lost-response retry, cross-tab conflict handling, version changes, corrupted receipts, case-sensitive IDs, and actual JPEG/WebP decoding. GitHub Actions repeats the suite on Linux.

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) to contribute. ImagePick is released under the [MIT License](./LICENSE); you remain responsible for the rights to images you review.
