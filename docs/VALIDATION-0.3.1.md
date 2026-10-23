# O_Compare Rust 0.3.1 — Folder toolbar alignment

- Removed Home and Sessions from the Folders toolbar and its More menu. Existing settings/session files are retained.
- Moved folder commands to the same top header row as Files commands; each mode displays only its own toolbar.
- Kept control state updates scoped to the relocated folder toolbar, including disabled Copy/Stop/Files and Minor/Peek toggles.
- TypeScript typecheck passed. Real-Rust folder UI suite: 10 interaction groups passed with over 10,000 paired entries and no page errors.
- Additional controls: 4 groups passed, including an explicit assertion that Files/Folders toolbars occupy the same Y coordinate, mode visibility, column/pane/log resizing, context-menu opening and browser DPR 1.5.
- Screenshots: evidence/folders-0.3.1-desktop.png and evidence/folders-0.3.1-compact.png.
- Native backend behavior is unchanged. This patch does not claim a new native Windows system-DPI test; the 0.3.0 native coverage and limits still apply.
