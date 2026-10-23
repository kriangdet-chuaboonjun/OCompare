param([string]$Version, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $Version) { $Version = ((Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version) + '.0' }
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'A four-part package version is required.' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'packaging\windows\generated' }
$stageDir = Join-Path $OutputDirectory 'stage'
$logoDir = Join-Path $stageDir 'resources\explorer\Assets'
New-Item -ItemType Directory -Force -Path $logoDir | Out-Null
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$sdkDir = Get-ChildItem -LiteralPath $sdkRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'x64\makeappx.exe') } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $sdkDir) { throw 'Windows SDK packaging tools not found.' }
$publisher = if ($env:OCOMPARE_PACKAGE_PUBLISHER) { $env:OCOMPARE_PACKAGE_PUBLISHER } else { 'CN=FusionSoft' }
$manifest = Get-Content (Join-Path $projectRoot 'packaging\windows\AppxManifest.xml.in') -Raw
$manifest = $manifest.Replace('@PUBLISHER@', [System.Security.SecurityElement]::Escape($publisher)).Replace('@VERSION@', $Version)
[IO.File]::WriteAllText((Join-Path $stageDir 'AppxManifest.xml'), $manifest, [Text.UTF8Encoding]::new($false))
# สร้างขนาดไอคอนตาม manifest จาก asset เดิม
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile((Join-Path $projectRoot 'assets\O_compare_icon.png'))
try {
  foreach ($item in @(@('StoreLogo.png',50),@('Square150x150Logo.png',150),@('Square44x44Logo.png',44))) {
    $bitmap = [Drawing.Bitmap]::new([int]$item[1],[int]$item[1]); $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try { $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $graphics.DrawImage($source,0,0,$bitmap.Width,$bitmap.Height); $bitmap.Save((Join-Path $logoDir $item[0]),[Drawing.Imaging.ImageFormat]::Png) }
    finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $source.Dispose() }
$packagePath = Join-Path $OutputDirectory 'OCompare.Explorer.msix'
# Sparse package อ้าง executable ภายนอก จึงต้องใช้ /nv ตามข้อกำหนด Microsoft
& (Join-Path $sdkDir.FullName 'x64\makeappx.exe') pack /d $stageDir /p $packagePath /o /nv
if ($LASTEXITCODE) { throw 'Sparse package build failed.' }
$signed = $false
if ($env:OCOMPARE_SIGN_CERT_PATH -and $env:OCOMPARE_PACKAGE_PUBLISHER) {
  $signArgs = @('sign','/fd','SHA256','/f',$env:OCOMPARE_SIGN_CERT_PATH)
  if ($env:OCOMPARE_SIGN_CERT_PASSWORD) { $signArgs += @('/p',$env:OCOMPARE_SIGN_CERT_PASSWORD) }
  if ($env:OCOMPARE_SIGN_TIMESTAMP_URL) { $signArgs += @('/tr',$env:OCOMPARE_SIGN_TIMESTAMP_URL,'/td','SHA256') }
  & (Join-Path $sdkDir.FullName 'x64\signtool.exe') @signArgs $packagePath
  if ($LASTEXITCODE) { throw 'Sparse package signing failed.' }
  $signed = $true
}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'package-status.json'), (@{ signed = $signed; version = $Version } | ConvertTo-Json))
Write-Output "Explorer package built. Signed: $signed"
