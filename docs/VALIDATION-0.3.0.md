# Validation — O_Compare Rust 0.3.0

Date: 2026-10-20 (Asia/Bangkok). Status: feature implementation, release packaging and recorded verification complete; remaining manual coverage is listed below.

## Current automated evidence

- TypeScript typecheck and frontend production build passed.
- Rust filesystem suite: 33 passed (fileio 5, copy 6, rules 4, sessions 2, folders 11, watcher 5).
- rustfmt check and Clippy all targets with warnings denied passed. Release build succeeded with the existing Monaco chunk-size warning.
- Monaco regression: 7 scenarios passed.
- Browser integration uses real Rust services through a test JSON-lines transport with filesystem access confined to a disposable temporary root. Only native dialog responses are test doubles. Browser plugin unavailable; existing Edge/Playwright harness used.
- Fixture contains 10,000 matching files per side plus nested, Thai, empty, binary, conflicting and one-sided entries. Virtualized rows, sorting, Tree/Flat, masks, Peek, multi-selection, Copy, Sessions, unsaved guards and responsive overflow are exercised.
- Electron original: all 22 SHA-256 manifest entries still match.

## Visual intent

The reference's paired table, compact toolbar, per-side columns, narrow status gutter, stripe rows, blue selection, path bars and bottom log/status are implemented using O_Compare's own SVGs and name. Hidden Beyond Compare menu features are outside approved scope. The Files/Folders mode switch remains available above the workspace.

## Native evidence

- Opened the release portable executable directly, with no dev server. The UI used `http://tauri.localhost/` and reported v0.3.0.
- Real Tauri commands compared three fixture pairs: Identical 1, Minor 1, Different 1. Both disk-space values came from the native service.
- Selected `copy.txt`, invoked Copy Left → Right and reviewed the real Rust preview: 0 create / 1 overwrite / 0 skipped / 13 bytes. Before confirmation the destination still contained `native target`.
- Confirmed Copy now through the native UI. The app reported 1 copied / 0 skipped / 0 failed and refreshed to Identical 2 / Minor 1 / Different 0. A filesystem check confirmed destination `native source`, equal SHA-256 and equal mtime.
- Native Sessions opened successfully. Comparison history persisted through the app-data commands. Browse opened the Windows Select Folder dialog.
- The helper subsequently reported `element 646 is not available in cached app state` and then `user input was detected in this window`; further app input stopped. Completing folder selection and additional native interactions are therefore not claimed.
- Silent per-user installer test installed into the owned `.test-install` directory, opened sample files with a v0.3.0 title, exited normally under the test controller, and uninstalled with exit 0. The executable and temporary installation directory were removed. Evidence: `install-test.json` and `install-0.3.0.log`.
- Installer smoke observed zero immediate WebView child processes while the separately launched portable WebView was also running; native rendered UI and IPC were verified directly above, rather than inferring them from that process count.

Browser results are separate from native integration and Windows DPI evidence.

## Limits to report

- Minor is limited to 10 MiB per file and supported text encodings; bytes always determine Identical. Encoding/BOM changes are Different.
- Copy is per-file atomic replacement, without multi-file rollback or Undo. Stop keeps already completed items. Links/reparse points and file/directory conflicts are skipped.
- Actual disk-full and Windows 150% system scaling must be distinguished from read-only failure tests and responsive/headless rendering.

## Final check and artifact evidence

- `npm test`: exit 0; Rust 33, Monaco 7, workspace UI 10 groups, controls 4 groups, plus pure projection/tree assertions. Browser page errors: none.
- Workspace fixtures: over 10,000 paired entries (20,000 matching files across the roots); DOM draws only the visible window of rows.
- Additional control checks exercise Name-column resize, split resize, log resize, selected expand/collapse, select/invert, context-menu file opening, Home, session Open/Delete, and browser DPR 1.5 at 1000x700.
- Desktop screenshot: `evidence/folders-0.3.0-desktop.png`; compact: `evidence/folders-0.3.0-compact.png`; browser DPR: `evidence/folders-0.3.0-dpr150.png`.
- Native screenshots: `evidence/folders-native-0.3.0.jpg`, `evidence/copy-preview-native-0.3.0.jpg`; file results: `evidence/native-copy-0.3.0.json`.
- `npm run build:win`: exit 0. Portable 12,910,080 bytes; installer 5,831,476 bytes. Hashes are in `release/SHA256SUMS.txt`.
- Original Electron source: all 22 manifest hashes match; the original project was not modified.

## Coverage still requiring manual completion

- Windows **system scaling 150%** was not changed/tested. Browser DPR 1.5 is evidence only for browser rendering, not native system DPI or drag/drop coordinates.
- Did not intentionally exhaust an actual disk. Real Windows read-only destination and failed settings writes prove preservation/cleanup on those errors; actual disk-full remains a separate manual check.
- Native long-running Copy Stop, every unsaved-dialog button and completing native directory selection were not manually exercised in this session. Core cancellation, destination guards, file preservation and real-Rust UI guards passed automated tests.
- Copy is not a multi-file transaction, does not synchronize/deletes extra files, and has no overwrite Undo. Arbitrary external writers are not a filesystem transaction participant.
