# Toolbar Overflow Implementation Plan

**Goal:** Keep Files and Folders toolbars on one row with accessible overflow.

**Architecture:** A shared renderer controller measures available width and hides lower-priority buttons. A popup delegates actions to original buttons. Observe resize and toolbar changes for active tabs and current state.

**Tech Stack:** TypeScript, CSS, existing context menu, Playwright.

**Spec:** docs/superpowers/specs/2026-11-04-toolbar-overflow-design.md

## Constraints and review focus

- Preserve command handlers and disabled/pressed state.
- Keep all commands reachable, including on newly created folder tabs.
- Restore buttons when widening; no repeated resize loops.
- Menu must close on resize/mode/tab changes and support keyboard dismissal.
- Test actual geometry, commands and selection states, not CSS source strings.

## Tasks

- [x] Add a browser regression test for narrow/wide Files/Folders and menu interactions; confirm failure on the current implementation.
- [x] Add shared overflow controller, mount it in main.ts, replace old folder-only More logic, and remove wrap/media hiding rules.
- [x] Reuse context popup with checked state and close notification for trigger accessibility.
- [x] Run browser regression, build, and project test suite; inspect screenshots and diff.

Validation: build and toolbar regression pass; geometry checked at 640, 800, 1100, 1400 and 1920 CSS px for both workspaces. Rust/editor/model checks passed in the aggregate run. Remaining folder, theme, accessibility and updater suites passed separately. Aggregate attempts encountered a concurrent fixture executable lock and a large-folder scan timeout; the isolated 10,000-entry folder test passed on retry. Legacy tests now invoke hidden commands through the popup and wait for resize layout. Browser screenshots inspected; installed Tauri/WebView2 and Windows DPI behavior were not checked.
