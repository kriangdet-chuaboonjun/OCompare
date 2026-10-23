$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$left = Join-Path $workspace 'samples\left.sql'
$right = Join-Path $workspace 'samples\right.sql'
$applications = @(
    @{ name = 'Electron'; exe = (Join-Path $workspace '..\O_Compare\dist\win-unpacked\O_Compare.exe') },
    @{ name = 'Tauri'; exe = (Join-Path $workspace 'release\O_Compare-Rust-0.1.5-portable.exe') }
)
$measurements = @()
foreach ($iteration in 1..3) {
    foreach ($application in $applications) {
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $process = Start-Process -FilePath $application.exe -ArgumentList ('"{0}" "{1}"' -f $left,$right) -WindowStyle Hidden -PassThru
        try {
            $loadedMs = $null
            if ($application.name -eq 'Tauri') {
                do {
                    Start-Sleep -Milliseconds 50
                    $process.Refresh()
                    if ($process.HasExited) { throw "$($application.name) exited during measurement" }
                    if ($timer.Elapsed.TotalSeconds -gt 20) { throw "$($application.name) did not load sample files in 20 seconds" }
                } until ($process.MainWindowTitle -like 'left.sql <--> right.sql*')
                $loadedMs = [Math]::Round($timer.Elapsed.TotalMilliseconds, 1)
            }
            Start-Sleep -Seconds 2
            $allProcesses = Get-CimInstance Win32_Process
            $ids = [Collections.Generic.HashSet[int]]::new()
            $null = $ids.Add($process.Id)
            do {
                $before = $ids.Count
                foreach ($candidate in $allProcesses) {
                    if ($ids.Contains([int]$candidate.ParentProcessId)) { $null = $ids.Add([int]$candidate.ProcessId) }
                }
            } while ($ids.Count -gt $before)
            $totalWorking = 0L
            $totalPrivate = 0L
            foreach ($processId in $ids) {
                $child = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if ($child) { $totalWorking += $child.WorkingSet64; $totalPrivate += $child.PrivateMemorySize64 }
            }
            $measurements += [ordered]@{
                application = $application.name; iteration = $iteration
                timeToLoadedTitleMs = $loadedMs
                loadedTitleVerified = ($process.MainWindowTitle -like 'left.sql <--> right.sql*')
                processCount = $ids.Count
                workingSetMiB = [Math]::Round($totalWorking / 1MB, 2)
                privateMemoryMiB = [Math]::Round($totalPrivate / 1MB, 2)
            }
        } finally {
            if (-not $process.HasExited) { Stop-Process -Id $process.Id }
        }
    }
}
[ordered]@{
    method = 'Three alternating hidden launches with the same sample arguments. Tauri: time to loaded title; Electron hidden title unavailable, startup time null and content loading unverified. Summed process-tree memory 2 seconds later; samples not synchronized to identical readiness. OS cache not cleared. Working sets may share pages. Do not infer relative startup speed or RAM savings from these observations.'
    measurements = $measurements
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $workspace 'docs\evidence\release-measurements.json')
$measurements | Format-Table
