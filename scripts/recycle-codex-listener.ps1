[CmdletBinding()]
param(
    [string]$HostRoot = (Join-Path $env:USERPROFILE '.hearth-remote\host'),

    [switch]$Worker,

    [ValidateRange(250, 10000)]
    [int]$DelayMilliseconds = 1500
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$listenerRoot = [IO.Path]::GetFullPath($HostRoot)
$logPath = Join-Path $listenerRoot 'listener-recycle.log'
$readyUri = 'http://127.0.0.1:4500/readyz'
$listenerPattern = '--listen\s+ws://127\.0\.0\.1:4500(?:\s|$)'

function Write-RecycleLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Value ('{0} {1}' -f [DateTimeOffset]::Now.ToString('o'), $Message) -Encoding utf8
}

function Test-ListenerReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $readyUri -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

if (-not $Worker) {
    # The script can be launched from Codex's bundled PowerShell runtime, whose
    # PSHOME may be an ephemeral path. Use the stable Windows host for the
    # detached worker so it survives the listener process it is about to stop.
    $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'
        '-WindowStyle', 'Hidden'
        '-File', ('"{0}"' -f $PSCommandPath)
        '-HostRoot', ('"{0}"' -f $listenerRoot)
        '-Worker'
        '-DelayMilliseconds', [string]$DelayMilliseconds
    )
    $process = Start-Process -FilePath $powershellPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
    [ordered]@{
        scheduled = $true
        workerProcessId = $process.Id
        timestamp = [DateTimeOffset]::Now.ToString('o')
    } | ConvertTo-Json -Compress
    exit 0
}

Start-Sleep -Milliseconds $DelayMilliseconds
$listeners = @(Get-CimInstance Win32_Process -Filter "Name = 'codex.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match '\bapp-server\b' -and $_.CommandLine -match $listenerPattern
})

foreach ($process in $listeners) {
    if ($process.Name -ne 'codex.exe' -or $process.CommandLine -notmatch $listenerPattern) {
        throw "Refusing to recycle process $($process.ProcessId): it is not the dedicated remote listener."
    }
    Write-RecycleLog "Stopping listener pid=$($process.ProcessId) binary=$($process.ExecutablePath)"
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
}

$deadline = [DateTimeOffset]::Now.AddSeconds(30)
do {
    if (Test-ListenerReady) {
        Write-RecycleLog 'Fresh listener is ready.'
        exit 0
    }

    $task = Get-ScheduledTask -TaskName 'Hearth Remote Codex Listener' -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq 'Ready') {
        Write-RecycleLog 'Supervisor was not running; starting its scheduled task.'
        Start-ScheduledTask -TaskName 'Hearth Remote Codex Listener'
    }
    Start-Sleep -Milliseconds 500
} while ([DateTimeOffset]::Now -lt $deadline)

Write-RecycleLog 'Listener did not return within 30 seconds.'
exit 1
