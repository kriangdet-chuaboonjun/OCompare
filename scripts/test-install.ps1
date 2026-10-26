$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.test-install'))
if (-not $installRoot.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar) -or (Test-Path -LiteralPath $installRoot)) {
    throw "Unsafe or existing installation test directory: $installRoot"
}
$alreadyInstalled = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall,HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall | Get-ItemProperty | Where-Object { $_.DisplayName -in @('O_Compare Rust', 'O_Compare', 'OCompare') }
if ($alreadyInstalled) { throw 'OCompare is already installed; do not replace an existing installation during this test.' }
$version = (Get-Content -LiteralPath (Join-Path $workspace 'package.json') | ConvertFrom-Json).version
$installer = Join-Path $workspace "release\OCompare-$version-x64-setup.exe"
$result = [ordered]@{ installExit = $null; installedExe = $null; launched = $false; title = ''; webviewProcesses = 0; uninstallExit = $null; filesRemoved = $false }
try {
    $installation = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR="' + $installRoot + '"') -WindowStyle Hidden -Wait -PassThru
    $result.installExit = $installation.ExitCode
    if ($installation.ExitCode -ne 0) { throw "Installer failed: $($installation.ExitCode)" }
    $appExe = Join-Path $installRoot 'o-compare-rust.exe'
    if (-not (Test-Path -LiteralPath $appExe)) { throw "Installed executable missing: $appExe" }
    $result.installedExe = $appExe
    $launched = Start-Process -FilePath $appExe -ArgumentList (Join-Path $workspace 'samples\left.sql'),(Join-Path $workspace 'samples\right.sql') -WindowStyle Hidden -PassThru
    try {
        Start-Sleep -Seconds 4
        $launched.Refresh()
        if ($launched.HasExited) { throw "Installed application exited unexpectedly: $($launched.ExitCode)" }
        $result.launched = $true
        $result.title = $launched.MainWindowTitle
        $result.webviewProcesses = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launched.Id)" | Where-Object { $_.Name -eq 'msedgewebview2.exe' }).Count
    } finally {
        if (-not $launched.HasExited) { Stop-Process -Id $launched.Id }
    }
} finally {
    $uninstaller = Join-Path $installRoot 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        # Inno's uninstaller also removes its registry entry, including the remembered install directory.
        $uninstallation = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -Wait -PassThru
        $result.uninstallExit = $uninstallation.ExitCode
        for ($i = 0; $i -lt 60 -and (Test-Path -LiteralPath $uninstaller); $i++) { Start-Sleep -Milliseconds 500 }
        $result.filesRemoved = -not (Test-Path -LiteralPath (Join-Path $installRoot 'o-compare-rust.exe'))
        if ((Test-Path -LiteralPath $installRoot) -and @(Get-ChildItem -LiteralPath $installRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $installRoot }
    }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workspace 'docs\evidence\install-test.json')
}
if ($result.uninstallExit -ne 0 -or -not $result.filesRemoved) { throw 'Uninstall verification failed' }
$result | ConvertTo-Json
