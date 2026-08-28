[CmdletBinding()]
param(
    [string]$HostRoot = (Join-Path $env:USERPROFILE '.hearth-remote\host'),

    [string]$WorkingDirectory = (Join-Path $env:USERPROFILE 'Documents'),

    [switch]$SkipRestart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'Hearth Remote Codex Listener'
$listenerRoot = [IO.Path]::GetFullPath($HostRoot)
$tokenPath = Join-Path $listenerRoot 'app-server-token'
$startSource = Join-Path $PSScriptRoot 'start-codex-listener.ps1'
$recycleSource = Join-Path $PSScriptRoot 'recycle-codex-listener.ps1'
$handoffSource = Join-Path $PSScriptRoot 'handoff-desktop.ps1'
$startTarget = Join-Path $listenerRoot 'start-listener.ps1'
$recycleTarget = Join-Path $listenerRoot 'recycle-codex-listener.ps1'
$handoffTarget = Join-Path $listenerRoot 'handoff-desktop.ps1'

foreach ($required in @($startSource, $recycleSource, $handoffSource)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required listener file is missing: $required"
    }
}

New-Item -ItemType Directory -Path $listenerRoot -Force | Out-Null
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $listenerRoot '/inheritance:r' '/grant:r' "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Windows could not restrict the Hearth Remote host folder.' }
if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    $bytes = [byte[]]::new(48)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    [IO.File]::WriteAllText($tokenPath, $token, [Text.UTF8Encoding]::new($false))
}
$backupRoot = Join-Path $listenerRoot ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupRoot | Out-Null
foreach ($target in @($startTarget, $recycleTarget, $handoffTarget)) {
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        Copy-Item -LiteralPath $target -Destination (Join-Path $backupRoot (Split-Path -Leaf $target))
    }
}

Copy-Item -LiteralPath $startSource -Destination $startTarget -Force
Copy-Item -LiteralPath $recycleSource -Destination $recycleTarget -Force
Copy-Item -LiteralPath $handoffSource -Destination $handoffTarget -Force

foreach ($script in @($startTarget, $recycleTarget, $handoffTarget)) {
    $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($script, [ref]$null, [ref]$parseErrors) | Out-Null
    if ($parseErrors) { throw ($parseErrors | Out-String) }
}

$currentUser = $currentIdentity
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction `
    -Execute $powershellPath `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -HostRoot "{1}" -WorkingDirectory "{2}"' -f $startTarget, $listenerRoot, $WorkingDirectory)
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$watchdogTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At ((Get-Date).AddMinutes(1)) `
    -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    # Refresh existing installations too. The repeating trigger is a cheap
    # watchdog: IgnoreNew makes each tick a no-op while the supervisor lives,
    # but restarts it within a minute if an updater or crash kills it.
    Set-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger @($logonTrigger, $watchdogTrigger) `
        -Settings $settings | Out-Null
}
else {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger @($logonTrigger, $watchdogTrigger) `
        -Settings $settings `
        -Description 'Supervises the loopback-only Codex app-server used by Hearth Remote.' `
        -User $currentUser | Out-Null
}

if (-not $SkipRestart) {
    Start-ScheduledTask -TaskName $taskName
    $deadline = [DateTimeOffset]::Now.AddSeconds(30)
    do {
        try {
            $status = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4500/readyz' -TimeoutSec 2).StatusCode
        }
        catch {
            $status = $null
        }
        $taskState = (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State
        if ($status -eq 200 -and $taskState -eq 'Running') { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTimeOffset]::Now -lt $deadline)
    if ($status -ne 200 -or $taskState -ne 'Running') { throw 'The Codex remote listener or its supervisor did not become ready within 30 seconds.' }
}

Write-Host 'Codex listener supervision is installed.' -ForegroundColor Green
Write-Host "Rollback copy: $backupRoot"
Write-Host 'The listener now follows Codex desktop updates, uses the matching Code Mode host, and recovers its watchdog automatically.'
