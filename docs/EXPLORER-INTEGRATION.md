# Native Explorer integration in O_Compare_Rust

Target correction: all current implementation and builds live in O_Compare_Rust.
The temporary Electron Explorer registration was removed. Existing folder comparison,
file editing, encoding and copy controls remain the Rust project's existing behavior.

Implementation: native C++ IExplorerCommand DLL + small identity launcher + sparse
MSIX package. Files and Directory menus share a remembered left path in a dedicated
Rust registry namespace. Each Compare launches o-compare-rust.exe with literal UTF-16
arguments, without a shell. Startup validates all paths and routes files to Monaco
or directories to the existing recursive folder controller. There is no single-instance
redirect, so existing unsaved documents stay in their original window.

Build: `npm run build:win`. Production shell registration requires a trusted signing
certificate; absent signing, build reports unsigned and the installer logs the
registration limitation. It does not change trust or Developer Mode.
For local verification with Developer Mode already enabled, run the register.ps1
inside release/explorer-integration/resources/explorer with -Development and an
absolute -InstallDirectory pointing to release/explorer-integration.

Checks: startup integration tests cover empty requests, files, folders, mixed pairs,
missing paths and Thai/shell-character filenames. Native contract tests cover Windows
argument quoting, installation path resolution, registry persistence and COM factory.
Existing npm test and build checks are required before completion. Desktop/Explorer
interaction evidence is recorded separately after the build.

## Verification on 2026-10-20

- npm test passed: 34 Rust integration tests, 7 Monaco scenarios, 10 folder
  workspace scenarios and 4 control interaction groups; tree/model checks passed.
- Native CTest passed; registered COM Select Left + Compare invoked successfully
  for real files and real folders (HRESULT 0x00000000).
- Release frontend typecheck/build and Tauri NSIS build passed; cargo fmt check
  and clippy --all-targets -D warnings passed.
- Real Windows Tauri UI opened through the native launcher: file sample showed
  5 difference sections with separate UTF-8/BOM/EOL values; folder sample showed
  6 files and 1 directory, 3 identical, 1 different, 1 left-only, 1 right-only,
  0 errors. Existing browser tests separately prove file-pair opening and guards.
- Rust sparse package registered in Development mode twice successfully without
  changing Developer Mode/trust. Registered COM server activation also passed.
- Production registration correctly refused the unsigned MSIX. Signed deployment
  and installer upgrade/uninstall have not been exercised end to end.
- After the user approved an Explorer restart, the Windows 11 main context menu
  displayed O_Compare. Real right-click tests passed for both files and folders:
  Select Left did not open a new app window; Compare to showed the remembered name
  and opened a new Rust window with the correct two paths and mode. The file pair
  showed 5 difference sections. The folder pair showed the same 6-file/1-directory
  summary above. Double-clicking changed.sql in folder results opened both file
  contents in Monaco and displayed Pending vs Completed as 1 difference section.
  These checks used the Development registration on this machine; signed installer
  deployment remains unverified.

New source is in the Rust project only. The Electron development registration was
removed; existing Electron source/build files were left as they were at the target
correction. Unregister removes installation ownership while retaining physical
selected-left preference; package-virtualized state retention on uninstall is not
verified.
