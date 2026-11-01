---
name: commit-push-release
description: "Commit, push, and optionally publish an OCompare release in one guided flow. Use whenever the user asks to commit, push, commit+push, ship, ออกรุ่น, ปล่อยรุ่นใหม่, or release OCompare, even if they only say 'commit และ push' or 'release เลย'. Picks the scope (commit only / commit+push / full release) from the request and stops at the first stage the user did not ask for."
---

# OCompare commit → push → release

One flow with three stages. Run commands from the Git root, answer the user in Thai, and keep technical terms in English. Each later stage is outward-facing and hard to reverse (a pushed commit, then a public GitHub Release that updater clients download), so do only the stages the request covers.

| Request | Stages |
| --- | --- |
| "commit" | 1 |
| "commit และ push" / "push" | 1 → 2 |
| "release" / "ออกรุ่น" / "commit push release" | 1 → 2 → 3 |

If the scope is unclear, ask once. Approval for one stage does not extend to the next.

## Stage 1 — Commit

1. Run `git status --short` and `git diff --stat`. The working tree often holds unrelated unfinished work (native/, docs/, release scripts); never `git stash`/`reset`/`checkout --` it away.
2. Stage by explicit path, only files that belong to this change. Never `git add -A` / `git add .`. If it is unclear whether a file belongs, ask.
3. Message style follows history: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`), English subject ≤ 72 chars, body only when the why isn't obvious. Release commits are exactly `chore(release): prepare X.Y.Z`. Append the commit attribution line the session gives you.
4. Before committing code changes run `npm run typecheck` (and the narrowest relevant test from CLAUDE.md). Fix failures instead of committing over them. Never use `--no-verify`.
5. Report the short hash and files committed.

## Stage 2 — Push

1. Confirm the branch (`main` unless told otherwise) and that `origin` is `kriangdet-chuaboonjun/OCompare`.
2. `git push origin <branch>`. No force push. If the push is rejected, fetch and report the divergence; do not rebase or merge without being asked.
3. Report that local and remote now point at the same commit (`git rev-parse HEAD origin/<branch>`).

## Stage 3 — Release

Only when the user asked for a release. The pipeline (signing, Inno Setup, checksums, draft→publish, resume) is owned by the repo, not by this skill — read `.agents/skills/release-publish/SKILL.md` and `docs/RELEASING.md` and follow them; do not recreate the steps. What this skill adds is the ordering with stages 1–2:

1. **Pick the version.** Use the one the user gave; otherwise patch-increment above the greater of the local version and the latest stable GitHub release (`gh release list`, including drafts). Never reuse a published version.
2. **Prepare.** Sync the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and both lock files. Add a dated `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (keep `## [Unreleased]` above it) with notes derived from the actual commits since the last tag/release, using today's local date.
3. **Validate.** `npm test`, `npm run build:win`, `npm run publish:release -- --dry-run`, `node scripts/test-release-signature.mjs`. Stop on any failure and fix the cause. In Git Bash `npm run` may not find `cargo`; use PowerShell. UI tests use fixed ports, so never run them concurrently.
4. **Commit and push the release changes** via stages 1–2 (`chore(release): prepare X.Y.Z`). The publisher refuses a dirty checkout or a HEAD that differs from `origin/main`, so every relevant change must already be committed and pushed. If unrelated user edits keep the tree dirty, tell the user and ask how to proceed rather than discarding or committing them.
5. **Publish.** `npm run publish:release`. If it fails partway, keep the same commit and artifacts and run `npm run publish:release -- --resume-draft`. Never delete a release or draft, never overwrite assets, never change repository visibility.
6. **Verify online.** Release is published and the tag targets the intended commit; the five assets exist (setup, portable, `.sig`, `latest.json`, `SHA256SUMS.txt`); the public `releases/latest/download/latest.json` shows the new version and the version-tag installer URL.

Signing keys, password files, and env files stay outside Git and are never printed. Don't claim installer-upgrade validation from browser tests alone; state which parts of `docs/RELEASING.md`'s validation list were not run.

## Final report

Say which stages ran and which were deliberately skipped, then give: commit hash(es), push result, and for a release the version, release URL, checks passed, and remaining validation limits.
