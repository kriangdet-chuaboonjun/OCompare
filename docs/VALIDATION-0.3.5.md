# O_Compare 0.3.5

- Changed the product name shown in the window, setup, Start menu, and install directory to `O_Compare`.
- The window title displays only `O_Compare v0.3.5`, regardless of the files or folders open in the app.
- Kept the application identifier and executable name stable.
- The setup migration hook recognizes the previous `O_Compare Rust` system-wide and per-user uninstall entries and retains app data.
- `npm run build:win` produced the 0.3.5 portable executable and NSIS setup package, including the title bar update.
- Build output includes an existing Vite chunk-size warning.
- Build metadata and release SHA256 hashes were checked. A fresh elevated install and full upgrade on Windows were not run in this session.
