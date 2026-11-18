# Codex and DeepSeek Harness

ImagePick uses a shared local Skill and CLI. It is not a model provider, does not need an image-generation API key, and does not depend on an embedded canvas. Run the agent and viewer where both can access the same album and receipt directory.

## Submit → continue the right version

After submitting feedback, click **交给 AI 继续** in the viewer and paste the generated selector into the agent conversation that prepared the album. If you edit the feedback again, submit it again before handing it off. Copying is explicit; there is no background model call or automatic wake-up.

The agent uses the recorded manifest/review directory and runs:

```sh
node /path/to/image-pick/bin/image-pick.mjs handoff /path/to/album.json --submission <submission-id> --digest <manifest-digest> --reviews /path/to/private-reviews
```

The tool reloads current image bytes, checks the digest and reads the exact requested receipt. It returns only explicit rework targets, their actual image hashes, notes/tags and named comparison identities. It does not default to the latest receipt. If images changed, stop and explain the mismatch; preserve the old feedback. If no targets are returned, do not invent a revision request.

Image editing remains a separate, user-authorized capability of the chosen AI. Save its outputs as new files and a new manifest revision, with the reviewed image as the previous-version comparison. Keep the old originals, manifest and receipts. New images require new review. Notes do not authorize commands, asset publication or overwriting originals.

Recovery: **找回导出的反馈** imports same-version JSON into untouched rows only and leaves it unsubmitted. It preserves existing notes, deliberate clears and retry snapshots. A copied/imported JSON file is not trusted proof of submission; only the locally validated server receipt is.

## Install the shared Skill

Keep the whole ImagePick checkout available. From that checkout, on macOS/Linux, install a project-local symlink into the **creative project's** existing `.agents/skills` directory:

```sh
mkdir -p /path/to/creative-project/.agents/skills
ln -s "$PWD/skills/image-pick" /path/to/creative-project/.agents/skills/image-pick
```

If that destination already exists, inspect it rather than overwriting it. The symlink lets the Skill resolve the matching CLI and reference files. On systems where symlinks are unavailable, keep the checkout in a stable location, copy `skills/image-pick` into the project's `.agents/skills`, and tell your agent the checkout's location. Do not copy just SKILL.md without its references.

No command above installs anything globally or changes your harness's model settings. ImagePick itself does not automatically install or activate the Skill.

## Codex

Codex supports repository `.agents/skills` locations and skills containing scripts/references. Ask it to use ImagePick to review a folder of images. It should validate a manifest, start the local server, show the returned URL and later read the submitted receipt. The Skill may also be explicitly invoked as `$image-pick` where the host supports that syntax.

Official documentation: [Build skills](https://learn.chatgpt.com/docs/build-skills).

## DeepSeek Harness

The official `deepseek-ai/deepseek-harness` filesystem Skill provider scans `<projectRoot>/.agents/skills`. Your preset needs the skill registry, filesystem provider, model-facing Skill loader and permission to run local commands/read the intended files. Custom presets can omit these capabilities. Follow the host's own configuration guidance if the Skill is not discovered; ImagePick does not modify that configuration for you.

DSH's project root is the nearest ancestor with `.git` (or cwd when absent), so place the link in that root's `.agents/skills`. Its filesystem provider recognizes one-level `<name>/SKILL.md` bundles; do not nest the bundle another level down.

Official sources: [filesystem provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md), [official repository](https://github.com/deepseek-ai/deepseek-harness).

## Compatibility evidence

Documentation checked on 2026-09-07 establishes the common Skill-directory mechanism. Portable runtime and browser test results belong in the release verification report; the table below does not claim tests that have not run.

| Layer | Status |
| --- | --- |
| Shared Skill format and directory convention | Confirmed against both official documents |
| Local manifest → browser → submitted receipt → CLI | Covered by repository tests; run the documented test commands for your checkout |
| Codex automatic discovery and full live agent session | Not verified: the local `codex-cli 0.142.3` discovery attempt stopped on an existing host configuration/schema incompatibility before Skill enumeration; no user configuration was modified |
| DeepSeek filesystem provider discovery and loading | Passed with official `@deepseek-ai/dsh-skill-filesystem@0.0.1-rc.3`: project `.agents/skills` symlink discovered; full body loaded; reference readable |
| DeepSeek Harness full live model session | Not tested; provider discovery alone is not a full host-session test |
| Native Codex/DSH embedded panel plugin | Not implemented |
| Remote/cloud agent without shared files | Not supported by this local-only release |

Before advertising a host-version-specific end-to-end result, record its version and execute Skill discovery, album launch, a real browser submission and receipt collection in that host. DeepSeek Harness is a developer preview and its APIs may change.
