# Changelog

## [Unreleased]

## [0.4.18] - 2026-11-11

- Restore unsaved Files tabs after a normal close: closing the window stores every tab with unsaved text (Ctrl+T tabs and edited files, both sides, Thai included) in the app data folder without asking Save or Discard, and the next start brings them back in the same order, still modified, with the active tab selected. Original files change only when you press Save. If a file changed, moved or was deleted meanwhile, the draft is still restored and flagged: Save asks before replacing a changed file (the old version goes to History) and uses Save As for a missing one. If the recovery data cannot be written, OCompare says so and keeps the window open so you can try again or save your files. A comparison launched from Explorer opens in a new tab beside the restored ones.
- Save (Ctrl+S) now saves the side the mouse pointer is over, whether it is that side's editor or path bar; when the pointer is over neither side it still saves the focused editor.
- Remove Compare History and the Files Compare button added in 0.4.17. History is again only the Backup history: copies of a file made before Save, Copy or Restore, used to restore the file.

## [0.4.17] - 2026-11-10

- Record every completed Files and Folders comparison automatically (one entry per run, even when nothing differs). Canceled or failed comparisons are not recorded, and a failed save is reported without hiding the comparison.
- Record comparisons of pasted text too: text pasted into a side with no file is stored with the entry and can be reopened later, also when the other side is a file.
- Merge History into one dialog: a single newest-first timeline of comparisons and saved versions, with filters (All, Comparisons, Saved versions), a path search, and Open for comparisons or Compare with current and Restore for saved versions. The History button in Files starts on the focused file's saved versions; in Folders it is always available.
- Add a Compare button to the Files toolbar that re-reads both files from disk (or uses the pasted text) and compares again as a new recorded run.

## [0.4.16] - 2026-11-04

- Keep Files and Folders commands on one toolbar row when resizing; move commands that do not fit into the More commands menu and restore them when the window widens.
- Show matching command icons in the overflow menu, with separate checkmarks for active options and disabled states preserved.
- Add Settings, opened from a rounded gear button, and move Dark Mode and Check for updates into it while retaining theme persistence and the existing update safeguards.

## [0.4.15] - 2026-11-04

- Align the Folders toolbar with Files: horizontal icon-and-label buttons, matching icon sizes, and compact secondary commands that wrap without pushing global controls offscreen.
- Use the compact Folders-style path bar in both modes, with matching 22px controls, Segoe UI text, and spacing while retaining file selection, Save, and parent-folder actions.

## [0.4.14] - 2026-11-03

- Add a dropdown to each file path field in Files mode that lists every file open in any tab, so a side can be switched to an already open document in one click; unsaved-change confirmation still applies.
- Compact the path bar: the path field and its dropdown share one bordered box, and the Open and Save buttons are square icon buttons without the placeholder text.

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
