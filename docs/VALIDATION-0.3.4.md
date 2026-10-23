# Installer 0.3.4

- `npm run build:win` passed; release Setup and portable EXEs report product version 0.3.4. Existing Vite chunk-size warning remains.
- NSIS configuration is `perMachine`; generated installer requests administrator rights and selects `$PROGRAMFILES64\O_Compare Rust` for a fresh x64 install. Existing system-wide installations retain their registered location.
- The application identifier and product name remain unchanged for existing installer detection.
- `powershell -NoProfile -File scripts/test-installer-migration.ps1` passed using the real 0.3.3 Setup in an isolated directory with spaces. The production PREINSTALL hook was compiled into a non-elevated NSIS harness.
- Verified: legacy application and uninstall entry removed, application data preserved, unrelated file preserved, no-install case succeeds, downgrade refused before removing the installed application.
- PowerShell scripts parsed without errors; release SHA256 hashes verified.
- Full installation into Program Files and subsequent machine-wide upgrade were not executed: this session is not elevated. Migration harness proof does not claim UAC or elevated end-to-end installation verification.

Evidence: `evidence/build-win-0.3.4.log` and `evidence/installer-migration-0.3.4.json`.
