param([Parameter(Mandatory=$true)][string]$InstallDirectory, [switch]$Development)
$ErrorActionPreference = 'Stop'
try {
  $installRoot = (Resolve-Path -LiteralPath $InstallDirectory).Path
  $exePath = Join-Path $installRoot 'o-compare-rust.exe'
  $packagePath = Join-Path $installRoot 'resources\explorer\OCompare.Explorer.msix'
  if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) { throw 'o-compare-rust.exe was not found.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($packagePath)
  try { $hasSignature = $null -ne $zip.GetEntry('AppxSignature.p7x') } finally { $zip.Dispose() }
  if ($Development) {
    $devMode = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense
    if ($devMode -ne 1) { throw 'Development registration requires Developer Mode to already be enabled. No system setting has been changed.' }
    $packageHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.Substring(0,16)
    $developmentPath = Join-Path $installRoot "resources\explorer\Development-$packageHash"
    if (-not (Test-Path -LiteralPath (Join-Path $developmentPath 'AppxManifest.xml'))) {
      [IO.Compression.ZipFile]::ExtractToDirectory($packagePath,$developmentPath)
    }
    Add-AppxPackage -Register (Join-Path $developmentPath 'AppxManifest.xml') -ExternalLocation $installRoot -ErrorAction Stop
  } else {
    if (-not $hasSignature) { throw 'Explorer integration requires a signed package trusted by Windows. Set signing configuration and rebuild; direct file/folder comparison remains available.' }
    Add-AppxPackage -Path $packagePath -ExternalLocation $installRoot -ErrorAction Stop
  }
  $registryPath = 'HKCU:\Software\FusionSoft\O_Compare_Rust\ExplorerIntegration'
  New-Item -Path $registryPath -Force | Out-Null
  New-ItemProperty -Path $registryPath -Name AppPath -Value $exePath -PropertyType String -Force | Out-Null
  # Refresh cached shell associations without restarting the user's Explorer windows.
  if (-not ('OCompareShellRefresh' -as [type])) {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OCompareShellRefresh { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2); }'
  }
  [OCompareShellRefresh]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output 'OCompare Explorer integration registered for the current user.'
} catch { Write-Output ('Explorer integration was not registered: ' + $_.Exception.Message); exit 1 }
