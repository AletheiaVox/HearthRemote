[CmdletBinding()]
param(
    [string]$HostRoot = (Join-Path $env:USERPROFILE '.hearth-remote\host'),

    [string]$WorkingDirectory = (Join-Path $env:USERPROFILE 'Documents'),

    [ValidateRange(2, 300)]
    [int]$PollSeconds = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$listenerRoot = [IO.Path]::GetFullPath($HostRoot)
$tokenPath = Join-Path $listenerRoot 'app-server-token'
$stdoutPath = Join-Path $listenerRoot 'app-server.stdout.log'
$stderrPath = Join-Path $listenerRoot 'app-server.stderr.log'
$supervisorLogPath = Join-Path $listenerRoot 'listener-supervisor.log'
$workingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)
$readyUri = 'http://127.0.0.1:4500/readyz'
$listenerPattern = '--listen\s+ws://127\.0\.0\.1:4500(?:\s|$)'
$featurePattern = 'features\.code_mode_host=true'
$mutex = [Threading.Mutex]::new($false, 'Local\HearthRemoteCodexListenerSupervisor')
$ownsMutex = $false

function Write-SupervisorLog([string]$Message) {
    $line = '{0} {1}' -f [DateTimeOffset]::Now.ToString('o'), $Message
    Add-Content -LiteralPath $supervisorLogPath -Value $line -Encoding utf8
}

function Get-CodexRuntime {
    $privateBinRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
    if (Test-Path -LiteralPath $privateBinRoot -PathType Container) {
        $candidate = Get-ChildItem -LiteralPath $privateBinRoot -Filter 'codex.exe' -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object {
                Test-Path -LiteralPath (Join-Path $_.DirectoryName 'codex-code-mode-host.exe') -PathType Leaf
            } |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1
        if ($candidate) {
            return [pscustomobject]@{
                CodexPath = $candidate.FullName
                CodeModeHostPath = Join-Path $candidate.DirectoryName 'codex-code-mode-host.exe'
            }
        }
    }

    throw 'No complete Codex runtime was found. Waiting for the desktop app update to finish.'
}

function Get-RemoteListenerProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name = 'codex.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -match '\bapp-server\b' -and $_.CommandLine -match $listenerPattern
    })
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

function Test-CurrentListener($Process, $Runtime) {
    if (-not $Process) { return $false }
    $sameBinary = [string]::Equals(
        [IO.Path]::GetFullPath([string]$Process.ExecutablePath),
        [IO.Path]::GetFullPath([string]$Runtime.CodexPath),
        [StringComparison]::OrdinalIgnoreCase
    )
    return $sameBinary -and $Process.CommandLine -match $featurePattern -and (Test-ListenerReady)
}

function Stop-VerifiedListeners($Processes, [string]$Reason) {
    foreach ($process in @($Processes)) {
        if ($process.Name -ne 'codex.exe' -or $process.CommandLine -notmatch $listenerPattern) {
            throw "Refusing to stop process $($process.ProcessId): it is not the dedicated remote listener."
        }
        Write-SupervisorLog "Stopping listener pid=$($process.ProcessId) reason=$Reason binary=$($process.ExecutablePath)"
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
    }
}

function Start-RemoteListener($Runtime) {
    if (-not (Test-Path -LiteralPath $Runtime.CodeModeHostPath -PathType Leaf)) {
        throw "The version-matched Code Mode host is missing: $($Runtime.CodeModeHostPath)"
    }
    if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
        throw "Capability token is missing: $tokenPath"
    }
    if (-not (Test-Path -LiteralPath $workingDirectory -PathType Container)) {
        throw "Working directory is missing: $workingDirectory"
    }

    $arguments = @(
        '-c', 'features.code_mode_host=true'
        'app-server'
        '--listen', 'ws://127.0.0.1:4500'
        '--ws-auth', 'capability-token'
        '--ws-token-file', $tokenPath
    )
    $process = Start-Process `
        -FilePath $Runtime.CodexPath `
        -ArgumentList $arguments `
        -WorkingDirectory $workingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    $deadline = [DateTimeOffset]::Now.AddSeconds(20)
    do {
        if ($process.HasExited) {
            throw "The Codex remote listener exited during startup with code $($process.ExitCode)."
        }
        if (Test-ListenerReady) {
            Write-SupervisorLog "Listener ready pid=$($process.Id) binary=$($Runtime.CodexPath) codeModeHost=$($Runtime.CodeModeHostPath)"
            return
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::Now -lt $deadline)

    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'The Codex remote listener did not become ready within 20 seconds.'
}

try {
    try {
        $ownsMutex = $mutex.WaitOne(0)
    }
    catch [Threading.AbandonedMutexException] {
        # A killed supervisor can leave the named mutex abandoned. Windows
        # grants ownership to this process while reporting the abandonment, so
        # recover instead of letting the replacement supervisor exit too.
        $ownsMutex = $true
        Write-SupervisorLog "Recovered abandoned supervisor mutex pid=$PID"
    }
    if (-not $ownsMutex) {
        exit 0
    }

    New-Item -ItemType Directory -Path $listenerRoot -Force | Out-Null
    Write-SupervisorLog "Supervisor started pid=$PID pollSeconds=$PollSeconds"

    while ($true) {
        try {
            $runtime = Get-CodexRuntime
            $listeners = @(Get-RemoteListenerProcesses)
            $primary = $listeners | Select-Object -First 1
            if ($listeners.Count -gt 1) {
                Stop-VerifiedListeners -Processes ($listeners | Select-Object -Skip 1) -Reason 'duplicate-listener'
            }
            if (-not (Test-CurrentListener -Process $primary -Runtime $runtime)) {
                if ($primary) {
                    $reason = if (-not (Test-ListenerReady)) { 'unhealthy' } elseif ($primary.CommandLine -notmatch $featurePattern) { 'code-mode-host-not-explicit' } else { 'codex-runtime-updated' }
                    Stop-VerifiedListeners -Processes @($primary) -Reason $reason
                    Start-Sleep -Milliseconds 500
                }
                Start-RemoteListener -Runtime $runtime
            }
        }
        catch {
            Write-SupervisorLog "Supervisor check failed: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds $PollSeconds
    }
}
finally {
    if ($ownsMutex) {
        try { Write-SupervisorLog "Supervisor stopped pid=$PID" } catch {}
    }
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
