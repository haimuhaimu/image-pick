# Verification

## Local feedback-handoff preview — 2026-11-18

This is local verification of the extension, not a release or a current GitHub CI result. Tests used synthetic images and simulated review feedback only; no personal albums or historical user receipts were copied into fixtures.

- Node.js 26.5.0 / macOS arm64: **54 unit/integration tests passed**. Includes a pre-extension golden album digest and serialized receipt, exact-receipt selection despite newer feedback, changed bytes under the same filename/ID/revision, malformed and symlinked receipts, tag-only edits, lost-response retry snapshots, and maximum-size exported draft recovery.
- Playwright 1.63.0 / Chromium 153: **13 browser tests passed**. Includes actual browser submission → persisted receipt → CLI `handoff` with matching target/hash/note; dirty edits disabling handoff; clipboard-denied fallback; import preserving existing notes; import-driven navigation resetting zoom; and the original browser regression suite.
- Rendered desktop (1440 × 960) and narrow (390 × 844) layouts inspected, including dark mode, reduced motion and browser-emulated touch. The local preview was also opened in the Codex in-app browser and its previous/current comparison inspected. This is not physical-phone certification.
- Independent review found oversized valid backups rejected by the initial import limit and import-driven navigation retaining old zoom. Both were reproduced, fixed and regression-tested.
- Independent agent reference checks found the old Skill lacked exact-receipt handoff/import guidance. With the updated reference, a fresh agent selected the exact receipt, refused stale-version fallback and kept imports as drafts. This was a scoped reference/CLI check, not automatic host discovery or a paid image-editing session.
- The bundled Skill passed its frontmatter/structure validator. The validator's missing PyYAML dependency was installed only in a temporary validation directory, not in the project's runtime dependencies or system environment.
- Package dry-run includes the new handoff module and excludes local demo data, receipts, tests and private verification outputs. No repository creation, commit, push, global Skill installation or publication was performed for this preview.

Reproduce with `npm test`, `npm run test:browser`, then `npm run demo:handoff`. The original `npm run demo` still opens the original independent sample batch. Current-image editing is intentionally delegated to the user's chosen, separately authorized image tool; ImagePick itself does not generate or overwrite images.

## Historical v0.1 verification

Checked on 2026-09-07. This report separates portable tool behavior from host-model sessions. All fixtures are original geometric images and synthetic feedback; no personal libraries or real user reviews were used.

## Executed checks

| Check | Observed result |
| --- | --- |
| Runtime minimum | Node.js 22.23.2 on macOS arm64 |
| Unit and integration suite | 38 passed: real files, HTTP, CLI, immutable image snapshots and receipt persistence |
| Browser suite | 10 passed using Playwright 1.63.0 / Chromium 153, including actual canvas-encoded JPEG and WebP decode through the real image service |
| Rendered layouts | Desktop 1440 × 960 and 390px narrow layout; dark/light, full-frame images and reference comparison inspected |
| Documented quickstart | `npm run demo` generated local PNGs and started the viewer on 127.0.0.1:4180 |
| Shared Skill validation | Passed Skill Creator frontmatter validation |
| Independent Skill forward test | Actual CLI launch, same-origin HTTP submission and CLI collection; draft-only, null opinions, baseline separation, malicious note text, idempotent retry and changed-image version handled |
| DeepSeek filesystem Skill discovery | Official `@deepseek-ai/dsh-skill-filesystem@0.0.1-rc.3` discovered the project-local symlink, loaded the complete Skill and resolved its manifest reference |

The forward test exposed ambiguous wording around an empty current-version result. The Skill now explicitly distinguishes “no receipt for this album/digest” from older receipts in the same directory.

Independent core review found three issues, each reproduced before its fix: manifest aliases choosing different default review directories, lossy UTF-8 decoding of corrupted receipts, and case-sensitive IDs colliding on case-insensitive filesystems. Regression tests and scoped re-review cover all three fixes.

## Boundaries

- These checks exercise the standalone browser, actual Node server and local receipt files. Response-loss and browser-storage-quota tests inject faults only at those boundaries.
- Codex CLI 0.142.3 automatic discovery could not finish because the existing host configuration was incompatible with that CLI's schema. No user configuration was changed. A complete Codex live-model session is not claimed.
- DeepSeek provider discovery is not a complete DeepSeek Harness live-model session. No model session or model API key was used in this check.
- Windows and other browsers have not been executed locally. Tests cover portable filename encoding, but that is not Windows certification.
- Image headers and dimensions are validated; this is not a complete image-decoder or malware scanner.
- GitHub CI is configured to run on Linux with Node 22. Consult the repository's actual Actions result rather than treating this document as proof that a future CI run passed.

Reproduce portable checks with the commands in [CONTRIBUTING.md](../CONTRIBUTING.md). See [integration details](integrations.md) for the shared Skill mechanism and host requirements.
