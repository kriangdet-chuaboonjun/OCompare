$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'build-native.ps1')
if ($LASTEXITCODE) { throw 'Native build failed.' }
& (Join-Path $PSScriptRoot 'build-explorer-package.ps1')
if ($LASTEXITCODE) { throw 'Explorer package build failed.' }
$destination = Join-Path $projectRoot 'src-tauri\explorer'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($name in @('OCompare.Explorer.dll','OCompare.Launcher.exe')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "native\build\Release\$name") -Destination $destination -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'packaging\windows\generated\OCompare.Explorer.msix') -Destination $destination -Force
foreach ($name in @('register.ps1','unregister.ps1','README.md')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "packaging\windows\$name") -Destination $destination -Force
}
