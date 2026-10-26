$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    if (!$env:TAURI_SIGNING_PRIVATE_KEY) {
        $keyDirectory = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.config\OCompare\signing'
        $env:TAURI_SIGNING_PRIVATE_KEY = Join-Path $keyDirectory 'release.key'
        $passwordPath = Join-Path $keyDirectory 'password.dpapi'
        if (!(Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY) -or !(Test-Path -LiteralPath $passwordPath)) {
            throw 'Run npm run setup:updater-signing once, or supply signing environment variables.'
        }
        $securePassword = (Get-Content -LiteralPath $passwordPath -Raw).Trim() | ConvertTo-SecureString
        $credential = [PSCredential]::new('updater', $securePassword)
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $credential.GetNetworkCredential().Password
    }
    # `tauri signer sign` reads key content from TAURI_SIGNING_PRIVATE_KEY and a key file from *_PATH.
    if (Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY -PathType Leaf) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $env:TAURI_SIGNING_PRIVATE_KEY
        Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY
    }
    & (Join-Path $PSScriptRoot 'prepare-explorer.ps1')
    if ($LASTEXITCODE) { throw 'Explorer integration build failed.' }
    & (Join-Path $projectRoot 'node_modules\.bin\tauri.cmd') build --ci --no-bundle
    if ($LASTEXITCODE) { throw 'Tauri build failed.' }
    $version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
    $iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $iscc) { throw 'Inno Setup 6 not found (winget install JRSoftware.InnoSetup)' }
    & $iscc /Q "/DAppVersion=$version" (Join-Path $projectRoot 'packaging\windows\OCompare.iss')
    if ($LASTEXITCODE) { throw 'Installer build failed.' }
    # The updater requires a signature bound to the release version (requireSignedVersion).
    $setup = Join-Path $projectRoot "src-tauri\target\release\installer\OCompare-$version-x64-setup.exe"
    & (Join-Path $projectRoot 'node_modules\.bin\tauri.cmd') signer sign --app-version $version $setup
    if ($LASTEXITCODE) { throw 'Updater signing failed.' }
    & node (Join-Path $PSScriptRoot 'package-release.mjs')
    if ($LASTEXITCODE) { throw 'Release packaging failed.' }
    & node (Join-Path $PSScriptRoot 'publish-release.mjs') --dry-run
    if ($LASTEXITCODE) { throw 'Release signature validation failed.' }
} catch { Write-Error $_; exit 1 }
finally {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}
