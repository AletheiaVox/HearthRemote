[CmdletBinding()]
param(
    [string]$HostRoot = (Join-Path $env:USERPROFILE '.hearth-remote\host'),
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'Hermes Remote Listener'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bridgeRoot = Join-Path ([IO.Path]::GetFullPath($HostRoot)) 'hermes-bridge'
$bridgeTarget = Join-Path $bridgeRoot 'server.js'
$bridgeSource = Join-Path $projectRoot 'out\hermes-bridge\server.js'
$tokenPath = Join-Path ([IO.Path]::GetFullPath($HostRoot)) 'app-server-token'
$hermesExe = Join-Path $env:LOCALAPPDATA 'hermes\hermes-agent\bin\hermes.exe'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$backupRoot = Join-Path $bridgeRoot ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$taskBackup = Join-Path $backupRoot 'Hermes Remote Listener.xml'
$bridgeBackup = Join-Path $backupRoot 'server.js'
$hadTask = [bool](Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)
$hadBridge = Test-Path -LiteralPath $bridgeTarget -PathType Leaf

function Get-PortOwner([int]$Port) {
    $connections = @(Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $Port -ErrorAction SilentlyContinue)
    $owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -gt 1) { throw "Port $Port has multiple listening owners; nothing was stopped." }
    if ($owners.Count -eq 0) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId = $($owners[0])" -ErrorAction SilentlyContinue
}

function Test-HermesServeProcess([object]$Process, [int]$Port) {
    if (-not $Process -or [string]::IsNullOrWhiteSpace([string]$Process.CommandLine)) { return $false }
    $line = [string]$Process.CommandLine
    return $line -match '(?i)hermes(?:\.exe)?' -and
        $line -match '(?i)(?:^|\s)serve(?:\s|$)' -and
        $line -match ('(?i)--port(?:=|\s+)' + [regex]::Escape([string]$Port) + '(?:\s|$)')
}

function Test-BridgeProcess([object]$Process) {
    if (-not $Process -or [string]::IsNullOrWhiteSpace([string]$Process.CommandLine)) { return $false }
    return ([string]$Process.CommandLine) -match '(?i)hermes-bridge[\\/]server\.js'
}

function Stop-VerifiedPortOwner([int]$Port, [switch]$AllowBridge) {
    $owner = Get-PortOwner $Port
    if (-not $owner) { return }
    $isExpected = (Test-HermesServeProcess $owner $Port) -or ($AllowBridge -and (Test-BridgeProcess $owner))
    if (-not $isExpected) {
        throw "Port $Port is occupied by an unexpected process (PID $($owner.ProcessId)). Nothing was stopped."
    }

    # The uv launcher may wrap Hermes in a second Python process. Climb only
    # through parents carrying the same verified serve-and-port marker.
    $top = $owner
    while ($top.ParentProcessId) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($top.ParentProcessId)" -ErrorAction SilentlyContinue
        if (-not (Test-HermesServeProcess $parent $Port)) { break }
        $top = $parent
    }
    & taskkill.exe /PID $top.ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Windows could not stop the verified process on port $Port." }

    $deadline = [DateTimeOffset]::Now.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 250
        $remaining = Get-PortOwner $Port
    } while ($remaining -and [DateTimeOffset]::Now -lt $deadline)
    if ($remaining) { throw "The verified process on port $Port did not stop." }
}

function Remove-NewTaskAndProcesses {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    try { Stop-VerifiedPortOwner -Port 4510 -AllowBridge } catch { Write-Warning $_.Exception.Message }
    try { Stop-VerifiedPortOwner -Port 4511 } catch { Write-Warning $_.Exception.Message }
}

if (-not (Test-Path -LiteralPath $hermesExe -PathType Leaf)) {
    throw "Hermes is not installed at its expected Desktop path: $hermesExe"
}
if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    throw 'The Hearth Remote capability token is missing. Install the Codex listener first.'
}
$token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
if ($token -notmatch '^[A-Za-z0-9_-]{40,256}$') { throw 'The Hearth Remote capability token is invalid.' }

if (-not $SkipBuild) {
    & npm.cmd run build:hermes-bridge --prefix $projectRoot
    if ($LASTEXITCODE -ne 0) { throw 'The Hermes compatibility bridge build failed.' }
}
if (-not (Test-Path -LiteralPath $bridgeSource -PathType Leaf)) {
    throw "The built Hermes bridge is missing: $bridgeSource"
}

New-Item -ItemType Directory -Path $bridgeRoot -Force | Out-Null
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $bridgeRoot '/inheritance:r' '/grant:r' "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Windows could not restrict the Hermes bridge folder.' }
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

if ($hadTask) {
    Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $taskBackup -Encoding Unicode
}
if ($hadBridge) { Copy-Item -LiteralPath $bridgeTarget -Destination $bridgeBackup -Force }
Copy-Item -LiteralPath $bridgeSource -Destination $bridgeTarget -Force

try {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Stop-VerifiedPortOwner -Port 4510 -AllowBridge
    Stop-VerifiedPortOwner -Port 4511

    $action = New-ScheduledTaskAction -Execute $nodePath -Argument ('"{0}" --hermes-exe "{1}" --token-file "{2}" --log-root "{3}" --public-port 4510 --backend-port 4511' -f $bridgeTarget, $hermesExe, $tokenPath, $bridgeRoot)
    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentIdentity
    $watchdogTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $watchdogTrigger) -Settings $settings -Description 'Supervises Hermes behind the authenticated loopback bridge used by Hearth Remote.' -User $currentIdentity -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName

    $deadline = [DateTimeOffset]::Now.AddSeconds(60)
    $status = $null
    do {
        try { $status = Invoke-RestMethod -Uri 'http://127.0.0.1:4510/api/status' -TimeoutSec 2 } catch { $status = $null }
        $taskState = (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State
        if ($null -ne $status -and $taskState -eq 'Running') { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTimeOffset]::Now -lt $deadline)
    if ($null -eq $status -or $taskState -ne 'Running') {
        Get-Content -LiteralPath (Join-Path $bridgeRoot 'bridge-supervisor.log') -Tail 60 -ErrorAction SilentlyContinue
        Get-Content -LiteralPath (Join-Path $bridgeRoot 'serve.stderr.log') -Tail 60 -ErrorAction SilentlyContinue
        throw 'The supervised Hermes bridge did not become ready within 60 seconds.'
    }
}
catch {
    $installError = $_
    Write-Warning 'Hermes bridge setup failed. Restoring the previous task and bridge file...'
    Remove-NewTaskAndProcesses
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    if ($hadBridge -and (Test-Path -LiteralPath $bridgeBackup -PathType Leaf)) {
        Copy-Item -LiteralPath $bridgeBackup -Destination $bridgeTarget -Force
    }
    elseif (-not $hadBridge) {
        Remove-Item -LiteralPath $bridgeTarget -Force -ErrorAction SilentlyContinue
    }
    if ($hadTask -and (Test-Path -LiteralPath $taskBackup -PathType Leaf)) {
        Register-ScheduledTask -TaskName $taskName -Xml (Get-Content -Raw -LiteralPath $taskBackup) -Force | Out-Null
        Start-ScheduledTask -TaskName $taskName
    }
    throw $installError
}

Write-Host 'Hermes bridge supervision is installed.' -ForegroundColor Green
Write-Host 'Tailnet port 4510 is authenticated and forwarded to Hermes on loopback port 4511.'
Write-Host "Rollback copy: $backupRoot"
