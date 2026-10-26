# OCompare

Windows application for comparing and editing text files and comparing folders side by side. Built with Tauri 2, Rust, TypeScript, and Monaco Editor.

## Online updates

OCompare 0.4.5 and later check for stable updates on startup. Use **Check for updates** in the toolbar to check manually. The application only downloads or installs after you choose **Download and install**. Release notes, progress, and retry controls are shown in the application.

Installation uses Windows Setup and may request administrator permission. Unsaved documents must be saved or explicitly discarded; Cancel or a failed save postpones installation. Stop folder jobs before installing. A portable copy uses the same Setup to install OCompare into Windows rather than replacing the portable executable.

Versions through 0.4.4 require a one-time manual installation of 0.4.5 or later. Update downloads have a mandatory updater signature; Windows Authenticode signing is not currently configured and Windows may show its usual publisher warning.

## Development

Install the current Tauri 2 Windows prerequisites (Rust, Visual Studio C++ build tools, Windows SDK, and WebView2) and Node.js 24 or later.

```powershell
npm ci
npm run dev
npm test
npm run build
```

See [release instructions](docs/RELEASING.md) for signed Windows builds and GitHub publication.

