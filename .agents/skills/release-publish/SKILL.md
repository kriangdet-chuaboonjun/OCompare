---
name: release-publish
description: "Use when preparing, building, or publishing an OCompare Windows release to GitHub Releases, including requests to release+publish, ออกรุ่นใหม่, สร้างตัวติดตั้ง, or เผยแพร่รุ่น. Follow the requested build-only, validation-only, or full release scope."
---

# OCompare release + publish

Use the repository's signed Inno Setup release pipeline. Run commands from the Git root and respond to the user in Thai. Creating or editing this skill does not request a new application release.

Read [docs/RELEASING.md](../../../docs/RELEASING.md), `package.json`, and the current release scripts before execution; those files own the implementation. Repository: `kriangdet-chuaboonjun/OCompare`.

## Select the requested operation

| Request | Action |
| --- | --- |
| Build installer only | `npm run build:win`; report local artifacts |
| Validate existing artifacts | `npm run publish:release -- --dry-run` and `node scripts/test-release-signature.mjs` |
| Release + publish | Prepare the version, validate, commit/push release changes, publish, and verify online |
| Publish prepared release | Validate existing artifacts and Git state, then publish; rebuild if they no longer match the release sources |

`npm run release:win` includes publication. Use it only for an authorized full release whose version/changelog and tested release commit are already on `origin/main`. Build-only and validation-only requests do not authorize Git commits, pushes, tags, or GitHub mutations.

## Prepare a release

1. Inspect `git status --short`, branch, remotes, current versions, and GitHub releases including drafts. Preserve unrelated edits; do not hide them with stash/reset or include them in a release commit. Resolve a dirty checkout before publication.
2. Use the requested stable version. If omitted, keep an unpublished local version newer than the latest stable release; otherwise increment the patch version above the greater of the local/latest stable versions. Do not reuse a published version.
3. Synchronize `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and both lock files. Move relevant changes into a dated `## [VERSION]` changelog section, retain `## [Unreleased]`, and derive notes from actual changes. Use the user's local date.
4. Check Node/npm, Rust/Cargo, Git/GitHub CLI, and Windows build prerequisites. Check signing-file presence without displaying their contents. Recover the existing release key if missing: published clients trust that key. `setup:updater-signing` is for initial setup or reconnecting the existing key, not key rotation.

## Validate and publish

```powershell
npm test
npm audit
npm run build:win
npm run publish:release -- --dry-run
node scripts/test-release-signature.mjs
```

Stop on failed checks and fix the owning cause before continuing. The signature test requires the signed build. The existing scripts handle native Explorer resources, DPAPI signing credentials, checksums, and signed-version verification; reuse them rather than recreating the pipeline.

For an authorized full release, commit only relevant tested changes and push the release commit to `origin/main`. Confirm the checkout is clean and HEAD matches that remote branch, then run:

```powershell
npm run publish:release
```

The publisher uploads five assets to a draft, verifies downloaded bytes, then publishes. If it fails, inspect the retained draft and report its URL/reason. An existing release or draft stops the publisher; do not delete or overwrite it automatically. GitHub's release-by-tag endpoint does not expose an unpublished draft: inspect drafts through the releases list and numeric release ID.

## Verify the outcome

- Confirm the release is published, its tag targets the intended commit, and the setup, portable, `.sig`, `latest.json`, and `SHA256SUMS.txt` assets exist.
- Fetch the public `releases/latest/download/latest.json` without credentials and check its version and immutable version-tag installer URL.
- Exercise the application's online check when available. Distinguish an app/portable smoke test from an actual installer upgrade. Apply installer-validation requirements from `docs/RELEASING.md` and the current request, honoring explicit user overrides. If a required VM/UAC check cannot run, retain the prepared artifacts and report the exact unmet requirement before publication.
- Report version, release URL, local installer path, commit/push result, checks passed, and remaining validation limits. Never claim installed-setup validation from browser tests alone.

Signing material remains outside Git. Pass credentials through the existing protected files/environment workflow, and never print or upload them. Repository visibility changes and release deletion require their own user request.
