# Light / Dark Mode verification — 2026-10-20

The toolbar toggle changes Files, Folders, Monaco and app dialogs in place. Light is the default; the selected mode is saved locally. Existing edits, undo history and folder results survive theme changes. The Windows title bar uses Tauri's window theme API.

## Verification

- `npm test`: passed — 34 Rust tests, 7 Monaco scenarios, folder tree/model checks, 10 filesystem-backed folder scenarios, 6 control interaction groups and the theme suite.
- `npm run test:theme`: passed again after final palette changes. Covers Light default on a dark OS, both toggle directions, keyboard activation, reload persistence, invalid preferences, blocked storage, editor text/cursor/undo preservation, folder results, dialogs, selected-row text contrast and compact window access.
- `npm run build`: passed; Vite reports a large-chunk warning for the Monaco bundle.
- `npm run tauri -- build --bundles nsis`: passed. Final Portable and Setup copies match the build outputs by SHA-256; checksums are recorded in `SHA256SUMS.txt`.
- Browser environment: Edge headless, 1500×950 and 900×650, existing real Rust filesystem transport and disposable fixtures. No page errors or Vite overlay. Browser plugin not available; used the repository's Playwright workflow.
- Screenshots: `files-light.png`, `files-dark.png`, `folders-light.png`, `folders-dark.png`, `dialog-dark.png`, `compact-dark.png`.

## Limits

The installed Windows app, native title bar appearance and installation/upgrade were not interactively tested. Browser persistence proves reload behavior on the renderer origin, not an actual installed-app restart.

The initial `npm run build:win` created the app and installer but its auxiliary Explorer integration copy failed with EPERM on an existing locked DLL. The final app and installer are rebuilt with `npm run tauri -- build --bundles nsis` and packaged separately; the locked auxiliary integration directory is left as-is.
