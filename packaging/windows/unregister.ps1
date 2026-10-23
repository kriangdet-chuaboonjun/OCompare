param([Parameter(Mandatory=$true)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
try {
  $registryPath = 'HKCU:\Software\FusionSoft\O_Compare_Rust\ExplorerIntegration'
  $expectedApp = [IO.Path]::GetFullPath((Join-Path $InstallDirectory 'o-compare-rust.exe'))
  $registeredApp = (Get-ItemProperty -LiteralPath $registryPath -ErrorAction SilentlyContinue).AppPath
  # ตัวถอนรุ่นเก่าไม่มีสิทธิ์ลบ registration ของ installation ใหม่
  if (-not $registeredApp -or -not [string]::Equals($registeredApp,$expectedApp,[StringComparison]::OrdinalIgnoreCase)) { Write-Output 'Registration belongs to another installation or is absent.'; exit 0 }
  Get-AppxPackage -Name 'th.co.fusionsoft.ocompare.rust.explorer' | ForEach-Object { Remove-AppxPackage -Package $_.PackageFullName -ErrorAction Stop }
  # Retain the selected-left preference across reinstall; remove only installation ownership.
  Remove-ItemProperty -LiteralPath $registryPath -Name AppPath -Force
  Write-Output 'OCompare Explorer integration removed.'
} catch { Write-Output ('Explorer integration removal failed: ' + $_.Exception.Message); exit 1 }
