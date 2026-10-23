# Explorer integration

Right-click a file or folder: OCompare > Select Left for Compare.
Right-click another item: OCompare > Compare to the selected left item.
Both items must be files, or both must be folders. Comparison opens a new Rust app process.

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
