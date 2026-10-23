param([ValidateSet('Debug','Release')][string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsPath = & $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw 'C++ build tools not found.' }
$cmakePath = Join-Path $vsPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$vsVersion = & $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion
$vsMajor = ([version]$vsVersion).Major
$vsYear = if ($vsMajor -eq 18) { '2026' } elseif ($vsMajor -eq 17) { '2022' } else { throw 'Unsupported Visual Studio version.' }
& $cmakePath -S (Join-Path $projectRoot 'native') -B (Join-Path $projectRoot 'native\build') -G "Visual Studio $vsMajor $vsYear" -A x64
if ($LASTEXITCODE) { throw 'Native configuration failed.' }
& $cmakePath --build (Join-Path $projectRoot 'native\build') --config $Configuration
if ($LASTEXITCODE) { throw 'Native build failed.' }
