# Changelog

## [Unreleased]

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
