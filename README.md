# OCompare

Windows application for comparing and editing text files and comparing folders side by side. Built with Tauri 2, Rust, TypeScript, and Monaco Editor.

## Online updates

OCompare 0.4.5 and later check for stable updates on startup. Use **Check for updates** in the toolbar to check manually. When an update is found, the toolbar shows **Install update x.y.z**; one click downloads and installs it. Nothing is downloaded or installed before you click. Release notes, progress, and retry controls are shown in the application.

Setup (Inno Setup, like OTokenUsage) installs OCompare for the current Windows user in `%LOCALAPPDATA%\Programs\OCompare` and does not need administrator permission. It offers Thai or English, and when OCompare is already installed it asks whether to update (or repair) or uninstall. If OCompare is open, Setup asks before closing it, and OCompare still asks about unsaved documents. Updating from 0.4.5 or earlier, which installed system-wide, asks for administrator permission once to remove the old copy; settings and history are kept. Unsaved documents must be saved or explicitly discarded; Cancel or a failed save postpones installation. Stop folder jobs before installing. A portable copy is never installed into Windows: it shows **Get version x.y.z**, which opens the GitHub release page so you can download the new portable executable.

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

