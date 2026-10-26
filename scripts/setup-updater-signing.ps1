param([string]$KeyDirectory = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.config\OCompare\signing'))
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$keyPath = Join-Path $KeyDirectory 'release.key'
$passwordPath = Join-Path $KeyDirectory 'password.dpapi'
$backupDirectory = Join-Path (Split-Path $KeyDirectory -Parent) 'signing-backup'

function Protect-Directory([string]$Path) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $Path /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE) { throw 'Unable to restrict signing directory access.' }
}

try {
    if ((Test-Path -LiteralPath $keyPath) -or (Test-Path -LiteralPath $passwordPath)) {
        if (!(Test-Path -LiteralPath $keyPath) -or !(Test-Path -LiteralPath $passwordPath) -or !(Test-Path -LiteralPath "$keyPath.pub")) {
            throw 'Signing files are incomplete; restore the existing key from backup. Never replace a published signing key.'
        }
    } else {
        Protect-Directory $KeyDirectory
        $bytes = New-Object byte[] 48
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $password = [Convert]::ToBase64String($bytes)
        $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
        ConvertFrom-SecureString $securePassword | Set-Content -LiteralPath $passwordPath
        # Suppress CLI output: it may include key material. Only the public key enters the checkout.
        & (Join-Path $projectRoot 'node_modules\.bin\tauri.cmd') signer generate --ci -w $keyPath -p $password 2>&1 | Out-Null
        if ($LASTEXITCODE) { throw 'Signing key generation failed.' }
        $password = $null
    }
    Protect-Directory $backupDirectory
    foreach ($path in @($keyPath, "$keyPath.pub", $passwordPath)) {
        Copy-Item -LiteralPath $path -Destination $backupDirectory -Force
    }
    $configPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
    $configText = Get-Content -LiteralPath $configPath -Raw
    $config = $configText | ConvertFrom-Json
    $publicKey = (Get-Content -LiteralPath "$keyPath.pub" -Raw).Trim()
    if ($config.plugins.updater.pubkey -and $config.plugins.updater.pubkey -ne $publicKey) {
        throw 'Configured public key differs from the existing signing key; refusing key rotation.'
    }
    $configText = $configText -replace '("pubkey"\s*:\s*)"[^"]*"', ('$1"' + $publicKey + '"')
    [IO.File]::WriteAllText($configPath, $configText, [Text.UTF8Encoding]::new($false))
    Write-Output "Signing key ready outside repository: $keyPath"
    Write-Output "Protected local backup: $backupDirectory"
} catch { Write-Error $_; exit 1 }
