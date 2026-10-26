# Changelog

## [Unreleased]

## [0.4.9] - 2026-10-26

- Fix the Folder tab strip so the close button stays attached to its tab and the tabs look like the Files tabs.

## [0.4.8] - 2026-10-26

- Add direct folder selection and comparison in the Windows 11 Explorer context menu.
- Add independent folder comparison tabs with per-tab results, rules, logs, and watchers, plus shared session history.
- Add Ignore folder to folder context menus and manage ignored paths in Comparison rules; excluded subtrees are also omitted from copy previews.
- Release publishing shows upload progress, supports slow connections, and can continue an interrupted draft without resending verified files.

## [0.4.7] - 2026-10-26

- Add a direct folder command to the Windows 11 Explorer context menu: select the left folder, then compare another folder to it.
- Keep folder selection separate from file selection, reset it after a successful comparison launch, and retain it when launching fails.
- Recover from an unavailable left folder by selecting the current folder and explaining the next step.

## [0.4.6] - 2026-10-26

- The toolbar's **Install update x.y.z** button downloads and installs in one click.
- Portable copies no longer install OCompare into Windows; **Get version x.y.z** opens the release download page instead.
- Shorter update notice in the update dialog.
- Setup now uses Inno Setup like OTokenUsage: per-user install without administrator permission, Thai or English, an update/repair/uninstall choice, desktop shortcut and launch options. Existing installs from the previous Setup (including the system-wide 0.4.5, which needs one administrator prompt) are removed first, keeping settings and history.

## [0.4.5] - 2026-10-26

- Check for stable updates on startup or with the toolbar's Check for updates button.
- Download signed updates from GitHub Releases and install through Windows Setup.
- Protect unsaved documents and running folder jobs before closing for installation.
- Show release notes, download progress, and retry controls inside OCompare.
- Portable copies can use the updater to install OCompare into Windows.
- Add signed release packaging and draft-first GitHub publication with checksum verification.
