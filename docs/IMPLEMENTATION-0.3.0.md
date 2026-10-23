# O_Compare Rust 0.3.0 — implementation record

Approved scope: compact paired Folder Comparison based on the supplied reference, visible toolbar functions, manual selected-item Copy, whitespace/EOL Minor rules. No sync/delete or full Beyond Compare menu parity.

- [x] Compact virtual paired tree, file/folder SVGs, Tree/Flat, sorting, resizable panes/columns, selection and keyboard navigation.
- [x] Name/status filters, Exclude precedence, Peek, Minor visibility and Rules.
- [x] Rust byte comparison plus bounded text-only Minor classification; aggregate folder bytes and partial metadata.
- [x] Sessions and history in versioned app-data JSON with atomic persistence and corrupt-file preservation.
- [x] Server-held Copy preview, directional selection, SHA-256 revalidation and verified temporary-file replacement; cancellation and per-item reports.
- [x] Unsaved Monaco destination guard; blocking mode switch/close while a folder job remains active.
- [x] Native Tauri commands and main-window capabilities; no shell capability.
- [x] Native release Copy/compare, installer lifecycle and published validation evidence; remaining manual checks are explicit in VALIDATION-0.3.0.md.

Core checks: 33 filesystem Rust tests; Monaco 7 regression scenarios; real-Rust browser integration with over 10,000 paired entries. Native checks are recorded separately in VALIDATION-0.3.0.md.

Implementation modules: FolderView handles the shared virtual projection and commands; folderModel handles pure filtering/sorting; FolderController coordinates current jobs and dialogs; Rust folder_scan/folder_copy/folder_sessions own filesystem operations and persistent state. Existing text diff engine, file encoding and watcher contracts remain in place.
