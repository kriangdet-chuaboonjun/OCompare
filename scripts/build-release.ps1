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
    & (Join-Path $PSScriptRoot 'prepare-explorer.ps1')
    if ($LASTEXITCODE) { throw 'Explorer integration build failed.' }
    & (Join-Path $projectRoot 'node_modules\.bin\tauri.cmd') build --ci --bundles nsis
    if ($LASTEXITCODE) { throw 'Signed Tauri build failed.' }
    & node (Join-Path $PSScriptRoot 'package-release.mjs')
    if ($LASTEXITCODE) { throw 'Release packaging failed.' }
    & node (Join-Path $PSScriptRoot 'publish-release.mjs') --dry-run
    if ($LASTEXITCODE) { throw 'Release signature validation failed.' }
} catch { Write-Error $_; exit 1 }
finally {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}
