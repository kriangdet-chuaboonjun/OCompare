# Folder Context Menu Implementation Plan

> Execute each task in this session using a failing native contract test followed by implementation and verification.

**Goal:** Expose adaptive folder selection/comparison on the Explorer main context menu.

**Architecture:** Add one folder COM class to the existing DLL. Store its left folder independently, launch the existing app with two directory arguments, then reset after success.

**Tech Stack:** C++17, Win32 Shell COM, sparse MSIX, Rust/Tauri.

**Spec:** ../specs/2026-10-26-folder-context-menu-design.md

## Constraints and review focus

- Keep file commands and existing CLSID behavior intact.
- Require one real filesystem folder; reject files and multi-selection.
- Handle absent and stale selection, escaped menu names, failed launches and repeated pairs.
- No Explorer restart, package registration, release or trust changes in this task.

## Task 1: Native command and package registration

- [x] Add native DLL tests activating the new folder CLSID, checking direct-command flags, selection persistence, titles, invalid selections and separation from file selection. Run the native build/test and observe failure before implementation.
- [x] Update `core.h`, `command.h`, `module.cpp`, `command.cpp` and `selection.cpp` with the folder command and remembered state. Keep HRESULT handling at COM boundaries.
- [x] Register the folder CLSID for Directory only in `packaging/windows/AppxManifest.xml.in`; keep the existing file CLSID.
- [x] Run native contracts, package build, npm test and frontend build. Verify generated manifest and existing startup folder routing.
- [x] Update Explorer usage documentation with the adaptive flow and installation limits; review the final diff.

## Verification

Native red run: folder-specific CLSID activation failed before implementation.
Green runs: native DLL contracts, full `npm test` (with the existing Cargo bin directory added to this process PATH), `npm run build`, and sparse MSIX creation passed. Generated manifest routes Directory to the new COM class. Frontend build retains its chunk-size advisory. The package is unsigned; installed Explorer UI placement and package activation were not exercised. No installer or installed application was replaced.

The dialog-dismissal test helper initially stalled when posting a synthetic OK command. Using WM_CLOSE scoped to the test's own thread resolved it; final CTest passed in 1.21 seconds. CTest now has a 30-second timeout. Cleanup of interrupted runs' temporary fixtures was rejected by automatic policy review; some temporary test directories and isolated test registry keys remain.
