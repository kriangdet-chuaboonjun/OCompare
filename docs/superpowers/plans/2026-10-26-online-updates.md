# Online Updates Implementation Plan

**Goal:** Deliver the approved GitHub Releases updater in OCompare 0.4.5.
**Architecture:** Tauri's signed Windows NSIS updater sits behind a small TypeScript interface. A controller owns check/download/install state; the existing workspace owns save and folder-job guards.
**Tech Stack:** Tauri 2, Rust, TypeScript, NSIS, GitHub CLI.
**Spec:** User-approved plan in this chat, 2026-10-26.

## Global constraints
- Stable Windows x64 releases only; user initiates download and installation.
- Public repository: kriangdet-chuaboonjun/OCompare, after a redacted secret scan.
- Private signing keys outside the checkout; build receives keys through environment variables.
- Preserve all existing comparison, backup, and Explorer integration behavior.

## Review focus
- Cancelled/failed saves and Untitled documents cannot be bypassed by installation.
- Pending file actions and folder operations cannot race the final installation gate.
- Invalid signatures, unavailable network and malformed manifests never close the app.
- Portable updates launch the installed application, not the old portable executable.
- Publication validates version, signatures and checksums before exposing latest.json.

## Tasks (native execution in this session)
- [x] Write failing controller tests for quiet checks, stable versions, duplicate clicks, progress, failure/retry, and installation guards. Implement `UpdateController` and native adapter; run tests.
- [x] Add accessible update dialog and toolbar button, integrate shared workspace installation guard and startup check. Test the rendered UI, including Save/Discard/Cancel and both themes.
- [x] Add release artifact validation tests. Extend packaging, signing setup and draft-first publication; generate a protected signing key outside the repository.
- [x] Bump synchronized versions to 0.4.5, configure signed updater artifacts, and document build/release/bootstrap behavior.
- [x] Run the full existing test command, signed release build, cryptographic tamper/version checks and native WebView updater smoke test. Gitleaks found no leaks in all seven historical commits or publication files before changing the repository to public.
- [ ] Validate actual installed/portable-to-installed upgrades through UAC in Windows Sandbox or a VM. No accessible VM or Windows Sandbox executable is available in this session; host installation was not substituted for isolated validation.

## Review and validation notes
- Fresh review identified deferred file events being dropped while the workspace was frozen; fixed and regression-tested against the real workspace and disk.
- Fresh review identified missing signed-version checks in the publication verifier; fixed and tested with a cryptographically valid signature for a different version. Runtime requires signed versions too.
- `npm test`, `npm run build:win`, `npm run publish:release -- --dry-run`, `node scripts/test-release-signature.mjs`, and `npm audit` passed. The build retains the pre-existing large JavaScript chunk warning.
- Native smoke used a separate WebView profile and exercised the actual updater permissions/network path without running the installer.
