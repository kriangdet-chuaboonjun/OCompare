# Explorer integration

Folders (one folder at a time, directly on the Windows 11 main context menu):
1. Right-click the left folder: **Select Left Folder for Compare**.
2. Right-click the right folder: **Compare Folders to “left folder name”**.
3. OCompare opens Folder Compare with both paths. The command resets for the next pair.

The folder command changes its action so Windows does not group multiple verbs into
an app flyout. Folder selection is independent of file selection. A failed launch
keeps the left folder for retry. If that folder was removed, the command selects the
current folder as the new left folder and explains that another folder must be chosen.

Files retain **OCompare > Select Left for Compare**, then **OCompare > Compare to**.
Comparison opens a new app process and leaves existing windows intact.

Production registration requires a signed MSIX trusted by Windows. Configure
OCOMPARE_PACKAGE_PUBLISHER, OCOMPARE_SIGN_CERT_PATH, optionally
OCOMPARE_SIGN_CERT_PASSWORD and OCOMPARE_SIGN_TIMESTAMP_URL before build:win.
The build reports whether the sparse package is signed. No certificate or system
security setting is installed or changed by these scripts.

For development only, on a machine with Developer Mode already enabled:
`powershell -NoProfile -File resources\explorer\register.ps1 -InstallDirectory . -Development`
Use the integration directory containing o-compare-rust.exe and resources.
Explorer may need to be restarted once before newly registered commands appear.
Unregister with the adjacent unregister.ps1 and the same InstallDirectory.
The standalone portable EXE supports two path arguments but has no shell resources.
