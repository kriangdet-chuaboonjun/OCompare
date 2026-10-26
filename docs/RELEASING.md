# Signed Windows releases

Release repository: https://github.com/kriangdet-chuaboonjun/OCompare (public).
Updater manifest: https://github.com/kriangdet-chuaboonjun/OCompare/releases/latest/download/latest.json.

## Signing setup (once on the release machine)

```powershell
npm ci
npm run setup:updater-signing
```

The setup script creates an encrypted Tauri private key outside the checkout at `%USERPROFILE%\.config\OCompare\signing\release.key`. A random password is protected with Windows DPAPI in `password.dpapi`; only the current Windows user on this machine can decrypt that password. The directory ACL allows the current user and SYSTEM. Only the public key is placed in `tauri.conf.json`.

A protected local backup is stored beside the signing directory in `signing-backup`. This protects against accidental file deletion, not disk loss. Back up the encrypted key and password in an approved off-device password manager or encrypted backup before distributing the first release. DPAPI password files alone are not portable to another machine; preserve the password using your secure backup process. Never commit or upload private keys, password files, environment files, or their backups. Never regenerate the key after distribution: existing clients trust the original public key.

For another build environment, supply `TAURI_SIGNING_PRIVATE_KEY` (path or content) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` through environment variables. The build script automatically loads the local DPAPI-protected password if no external key was provided. The updater signature is separate from Windows Authenticode signing.

## Build and validate

1. Set the same stable version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; update the package and Cargo lock files.
2. Add a dated `## [version]` section to `CHANGELOG.md` with release notes and retain `## [Unreleased]` above it.
3. Run:

```powershell
npm ci
npm test
npm run build:win
npm run publish:release -- --dry-run
node scripts/test-release-signature.mjs
```

`build:win` retains the native Explorer integration build, builds the app, compiles `packaging/windows/OCompare.iss` with Inno Setup 6 (`winget install JRSoftware.InnoSetup`), signs the setup with `tauri signer sign --app-version`, and generates these files under `release/`:

- `OCompare-VERSION-portable.exe`
- `OCompare-VERSION-x64-setup.exe`
- `OCompare-VERSION-x64-setup.exe.sig`
- `latest.json` (immutable tag URL, version, release notes, signature)
- `SHA256SUMS.txt` (hashes of the four other assets)

The signature verifier uses the same minisign library as Tauri and checks the signed trusted-comment version against the release version. Clients require a signed version as well. An invalid signature, mixed versions, missing release notes, wrong manifest URL, or mismatched checksum stops publication. Keep the current signed artifacts until publication finishes; do not alter them after validation.

## Publish

After validating on Windows, commit and push the tested release changes to `origin/main`. Authenticate GitHub CLI with an account allowed to publish releases; its token never enters the app.

```powershell
npm run publish:release
```

To run tests, build, validate, and publish together after pushing the release commit, use `npm run release:win`.

The publisher checks the clean checkout, remote commit, public visibility, existing release tags, checksums, and cryptographic signature. It creates a draft, uploads two files at a time with progress reports, downloads them to compare bytes, then publishes the draft as the latest release. An existing published release is never overwritten. Uploads allow up to 30 minutes per file and stop if no data is transferred for five minutes. GitHub credentials are passed to Windows' built-in curl over stdin, never command-line arguments or files. Prereleases are not published by this script.

If an upload fails, retain the same source commit and local artifacts, inspect the draft, then continue with:

```powershell
npm run publish:release -- --resume-draft
```

Resume requires a draft targeting the exact current commit. It verifies and skips completed files, retries missing files, and removes only incomplete `starter` upload placeholders for the expected filenames. It does not resume partway through a single file: a failed file starts again. Wrong bytes, unexpected assets, a published release, or a changed source commit stop the command without overwriting valid assets. `--dry-run` performs local validation only; `--help` lists the options.

Public visibility is a one-time repository setting and is not changed by the publication script. Before making a private repository public, scan the entire Git history and all files being published for credentials. Stop and remediate any findings before changing visibility.

## Update behavior and validation

Only newer stable Windows x64 releases are offered. Startup failures stay quiet; manual checks show errors and support retry. Metadata requests time out after 30 seconds; downloads after 120 seconds. Download and install are separate so the final workspace guard runs after signature verification. The guard freezes editors and commands, drains pending operations, resolves every unsaved document using Save/Discard/Cancel, and refuses installation while folder jobs are running. The updater starts the Inno setup with `/SILENT` (configured in `plugins.updater.windows.installerArgs`); Inno ignores the updater's NSIS switches, and the setup reopens OCompare when it sees `/UPDATE`.

Validate a real update from an installed version and from a portable copy in Windows Sandbox or a VM before release. Cover UAC cancellation, failed/invalid downloads, unsaved Untitled documents, failed saves, active folder copy jobs, user settings, backup history, and Explorer integration. Automated browser tests substitute only the native download/process boundary; they do not prove installer behavior. Version 0.4.4 cannot bootstrap this feature automatically; install 0.4.5 manually once.
