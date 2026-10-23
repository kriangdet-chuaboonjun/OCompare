param([string]$LegacyVersion = '0.3.3')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $workspace ('.test-installer-' + [guid]::NewGuid().ToString('N'))
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\O_Compare Rust'
$productKey = 'Software\co\O_Compare Rust'
$registry = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($productKey)
try { $previousLocation = if ($registry) { $registry.GetValue('') } else { $null } }
finally { if ($registry) { $registry.Dispose() } }
foreach ($hive in @('HKCU:', 'HKLM:')) {
    if (Test-Path -LiteralPath "$hive\$uninstallKey") { throw 'Existing installation detected. Run this test on a clean test account.' }
}
$nsisRoot = Join-Path $env:LOCALAPPDATA 'tauri\NSIS'
$version = (Get-Content (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Path $testRoot | Out-Null
$legacyRoot = Join-Path $testRoot 'legacy with spaces'
$sentinel = Join-Path $env:APPDATA ('th.co.fusionsoft.ocompare.rust\installer-test-' + [guid]::NewGuid().ToString('N') + '.txt')
$report = [ordered]@{ legacyVersion = $LegacyVersion; newVersion = $version; downgradeBlocked = $false; migrationPassed = $false; dataPreserved = $false; unrelatedFilePreserved = $false; noLegacyInstallPassed = $false }
try {
    # Compile the production migration hook in a non-elevated harness, without writing HKLM.
    $harness = @'
Unicode true
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\O_Compare Rust"
!define MANUPRODUCTKEY "Software\co\O_Compare Rust"
!define MAINBINARYNAME "o-compare-rust"
!define VERSION "@VERSION@"
!addplugindir "@PLUGINS@"
!include "@HOOKS@"
OutFile "@OUTPUT@"
Section
  SetRegView 64
  !insertmacro NSIS_HOOK_PREINSTALL
SectionEnd
'@
    $harness = $harness.Replace('@VERSION@', $version).Replace('@PLUGINS@', (Join-Path $nsisRoot 'Plugins\x86-unicode\additional')).Replace('@HOOKS@', (Join-Path $workspace 'packaging\windows\hooks.nsh')).Replace('@OUTPUT@', (Join-Path $testRoot 'migration.exe'))
    [IO.File]::WriteAllText((Join-Path $testRoot 'migration.nsi'), $harness, [Text.UTF8Encoding]::new($false))
    & (Join-Path $nsisRoot 'makensis.exe') /V2 (Join-Path $testRoot 'migration.nsi')
    if ($LASTEXITCODE) { throw 'Migration test harness compilation failed.' }
    $legacyInstaller = Join-Path $workspace "release\O_Compare-Rust-$LegacyVersion-x64-setup.exe"
    $installed = Start-Process -FilePath $legacyInstaller -ArgumentList '/S','/NS',('/D=' + $legacyRoot) -WindowStyle Hidden -Wait -PassThru
    if ($installed.ExitCode -ne 0 -or -not (Test-Path (Join-Path $legacyRoot 'o-compare-rust.exe'))) { throw 'Legacy install failed.' }
    # An older installer must stop before removing a newer per-user installation.
    $guardHarness = $harness.Replace('!define VERSION "' + $version + '"', '!define VERSION "0.0.1"').Replace('migration.exe', 'downgrade.exe')
    [IO.File]::WriteAllText((Join-Path $testRoot 'downgrade.nsi'), $guardHarness, [Text.UTF8Encoding]::new($false))
    & (Join-Path $nsisRoot 'makensis.exe') /V2 (Join-Path $testRoot 'downgrade.nsi')
    if ($LASTEXITCODE) { throw 'Downgrade harness compilation failed.' }
    $blocked = Start-Process -FilePath (Join-Path $testRoot 'downgrade.exe') -WindowStyle Hidden -Wait -PassThru
    $report.downgradeBlocked = $blocked.ExitCode -ne 0 -and (Test-Path "HKCU:\$uninstallKey") -and (Test-Path (Join-Path $legacyRoot 'o-compare-rust.exe'))
    if (-not $report.downgradeBlocked) { throw 'Downgrade protection failed.' }
    New-Item -ItemType Directory -Path (Split-Path $sentinel -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($sentinel, 'retain app data')
    [IO.File]::WriteAllText((Join-Path $legacyRoot 'user-document.txt'), 'retain unrelated file')
    $migrated = Start-Process -FilePath (Join-Path $testRoot 'migration.exe') -WindowStyle Hidden -Wait -PassThru
    $report.migrationPassed = $migrated.ExitCode -eq 0 -and -not (Test-Path "HKCU:\$uninstallKey") -and -not (Test-Path (Join-Path $legacyRoot 'o-compare-rust.exe'))
    $report.dataPreserved = (Test-Path $sentinel) -and [IO.File]::ReadAllText($sentinel) -eq 'retain app data'
    $report.unrelatedFilePreserved = Test-Path (Join-Path $legacyRoot 'user-document.txt')
    if (-not $report.migrationPassed -or -not $report.dataPreserved -or -not $report.unrelatedFilePreserved) { throw 'Legacy migration or preservation verification failed.' }
    $fresh = Start-Process -FilePath (Join-Path $testRoot 'migration.exe') -WindowStyle Hidden -Wait -PassThru
    $report.noLegacyInstallPassed = $fresh.ExitCode -eq 0
    if (-not $report.noLegacyInstallPassed) { throw 'Fresh installation migration hook failed.' }
} finally {
    $uninstaller = Join-Path $legacyRoot 'uninstall.exe'
    if (Test-Path $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait | Out-Null }
    if (Test-Path $sentinel) { Remove-Item -LiteralPath $sentinel }
    # Restore the remembered path; test installs must not become the next setup default.
    $registry = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($productKey)
    try {
        if ($null -eq $previousLocation) { $registry.DeleteValue('', $false) }
        else { $registry.SetValue('', $previousLocation) }
    } finally { $registry.Dispose() }
    $report | ConvertTo-Json | Set-Content (Join-Path $workspace "docs\evidence\installer-migration-$version.json")
    # Only remove this test's unique directory beneath the workspace.
    $resolvedTest = [IO.Path]::GetFullPath($testRoot)
    if (-not $resolvedTest.StartsWith($workspace + '\.test-installer-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $resolvedTest -Recurse -Force
}
$report | ConvertTo-Json
