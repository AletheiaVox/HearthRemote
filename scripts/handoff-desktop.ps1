[CmdletBinding()]
param(
    [ValidateSet('Status', 'Prepare', 'Force')]
    [string]$Mode = 'Status',

    [ValidateRange(1, 60)]
    [int]$GraceSeconds = 15
)

$ErrorActionPreference = 'Stop'
$hostRoot = Split-Path -Parent $PSCommandPath
$logPath = Join-Path $hostRoot 'handoff.log'

function Get-HandoffState {
    $allProcesses = Get-CimInstance Win32_Process
    $desktopRoots = @($allProcesses | Where-Object {
        $_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -match 'OpenAI\.Codex_' -and $_.CommandLine -notmatch '--type='
    })
    $desktopServers = @($allProcesses | Where-Object {
        $_.Name -eq 'codex.exe' -and $_.CommandLine -match 'OpenAI\.Codex_' -and
        $_.CommandLine -match '\bapp-server\b' -and $_.CommandLine -match '--analytics-default-enabled' -and
        $_.CommandLine -notmatch '--listen'
    })
    $remoteListeners = @($allProcesses | Where-Object {
        $_.Name -eq 'codex.exe' -and $_.CommandLine -match '\bapp-server\b' -and
        $_.CommandLine -match '--listen\s+ws://127\.0\.0\.1:4500'
    })
    [ordered]@{
        host = [Environment]::MachineName
        mode = $Mode
        timestamp = [DateTimeOffset]::Now.ToString('o')
        desktopAppRunning = $desktopRoots.Count -gt 0
        desktopAppProcessIds = @($desktopRoots | ForEach-Object { [int]$_.ProcessId })
        desktopServerRunning = $desktopServers.Count -gt 0
        desktopServerProcessIds = @($desktopServers | ForEach-Object { [int]$_.ProcessId })
        remoteListenerRunning = $remoteListeners.Count -gt 0
        remoteListenerProcessIds = @($remoteListeners | ForEach-Object { [int]$_.ProcessId })
        readyForRemote = $desktopRoots.Count -eq 0 -and $desktopServers.Count -eq 0 -and $remoteListeners.Count -gt 0
    }
}

function Wait-ForDesktopExit([int]$Seconds) {
    $deadline = [DateTimeOffset]::Now.AddSeconds($Seconds)
    do {
        $state = Get-HandoffState
        if (-not $state.desktopAppRunning -and -not $state.desktopServerRunning) { return $state }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::Now -lt $deadline)
    return (Get-HandoffState)
}

function Write-State($State, [string]$Action) {
    $State['action'] = $Action
    $json = $State | ConvertTo-Json -Depth 5 -Compress
    Add-Content -LiteralPath $logPath -Value $json -Encoding utf8
    Write-Output $json
}

try {
    $initial = Get-HandoffState
    if ($Mode -eq 'Status') { Write-State $initial 'inspected'; exit 0 }
    if ($initial.readyForRemote) { Write-State $initial 'already-ready'; exit 0 }

    if ($Mode -eq 'Prepare') {
        $closeRequested = @()
        foreach ($processId in $initial.desktopAppProcessIds) {
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($process -and $process.MainWindowHandle -ne 0 -and $process.CloseMainWindow()) { $closeRequested += $processId }
        }
        $final = Wait-ForDesktopExit $GraceSeconds
        $final['closeRequestedProcessIds'] = $closeRequested
        if ($final.readyForRemote) { Write-State $final 'graceful-close-complete'; exit 0 }
        Write-State $final 'graceful-close-timed-out'; exit 20
    }

    # Force mode is called only after a second confirmation in the client. It
    # targets the packaged Codex desktop tree, never the dedicated listener.
    foreach ($processId in $initial.desktopAppProcessIds) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    $remaining = Get-HandoffState
    foreach ($processId in $remaining.desktopServerProcessIds) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    $final = Wait-ForDesktopExit 5
    if ($final.readyForRemote) { Write-State $final 'force-close-complete'; exit 0 }
    Write-State $final 'force-close-failed'; exit 21
}
catch {
    $failure = [ordered]@{ host = [Environment]::MachineName; mode = $Mode; timestamp = [DateTimeOffset]::Now.ToString('o'); action = 'error'; error = $_.Exception.Message; readyForRemote = $false }
    $json = $failure | ConvertTo-Json -Compress
    Add-Content -LiteralPath $logPath -Value $json -Encoding utf8
    Write-Output $json
    exit 99
}
