# O_Compare Rust 0.3.2 — unified toolbar icons

- Mode tabs Files/Folders and both toolbars use a shared local SVG icon family: 24-unit viewBox, 20 CSS px display, rounded 1.75-unit strokes.
- Active tabs/icons use the existing blue accent. Labels, command IDs, tooltips and click handlers are preserved.
- Replaced Files toolbar font glyphs with SVGs and refined matching Folder toolbar symbols. No icon package or network dependency was added.
- TypeScript typecheck passed. Four existing controls interaction groups passed in Edge headless, covering mode visibility, shared header alignment, column/pane/log resizing, tree actions, context-menu file opening and browser DPR 1.5.
- Visually inspected Files and Folders at 1500x950. Captured full-screen and toolbar-only screenshots in evidence/icons-*-0.3.2.png.
- Native backend behavior is unchanged; no new native DPI or filesystem claims are made for this visual patch.
