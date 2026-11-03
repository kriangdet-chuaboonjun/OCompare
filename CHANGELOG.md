# Changelog

## [Unreleased]

## [0.4.13] - 2026-11-03

- Fix the Windows Explorer context menu (Select Left for Compare / Compare to) disappearing after an upgrade: when the Explorer package is unsigned and Developer Mode is already on, the installer now registers it in Development mode automatically.

## [0.4.12] - 2026-11-02

- Add Structural compare: the new toolbar button opens a read-only tab that compares canonical JSON, XML and CSV (sorted keys or attributes, normalized whitespace, empty elements, delimiters and quoting), so formatting-only differences disappear. Press it again on the original tab to refresh.
- Drop folders onto the Folders view: one folder fills the side under the pointer, two fill both sides, and dropped files are ignored.
- Show the current difference section and the total (for example 2 / 5) between Prev Section and Next Section.

## [0.4.11] - 2026-11-01

- Redesign the main window (Fluent Compact): a single 44px command bar with segmented Files/Folders and All/Diffs/Context groups, icon-only secondary commands, compact file headers with encoding and line-ending badges, rounded tabs, and a refreshed neutral Light/Dark palette.
- Tidy the Folders toolbar so its buttons are no longer clipped and stay on one row at narrow widths.

## [0.4.10] - 2026-10-26

- Fix "Check for updates" failing with "Command is_portable not allowed by ACL": the update-related commands are now permitted for the main window.

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
