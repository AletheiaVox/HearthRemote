[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Prepare', 'Commit', 'Rollback')]
    [string]$Mode = 'Plan',

    [string]$HostRoot = (Join-Path $env:USERPROFILE '.hearth-remote\host'),

    [string]$LegacyRoot = (Join-Path $env:USERPROFILE '.codex\remote-listener'),

    [string]$LegacyListenerTaskName = 'Codex Remote Listener',

    [string]$ModernListenerTaskName = 'Hearth Remote Codex Listener',

    [string]$GatewayTaskName = 'Hearth Remote Gateway',

    [ValidateRange(1024, 65535)]
    [int]$GatewayPort = 4520
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$HostRoot = [IO.Path]::GetFullPath($HostRoot)
$LegacyRoot = [IO.Path]::GetFullPath($LegacyRoot)
$legacyListenerTaskName = $LegacyListenerTaskName
$modernListenerTaskName = $ModernListenerTaskName
$gatewayTaskName = $GatewayTaskName
$statePath = Join-Path $HostRoot 'migration-state.json'
$legacyTokenPath = Join-Path $LegacyRoot 'app-server-token'
$modernTokenPath = Join-Path $HostRoot 'app-server-token'
$legacyDevicesPath = Join-Path $LegacyRoot 'hearth-gateway\paired-devices.json'
$modernGatewayRoot = Join-Path $HostRoot 'hearth-gateway'
$modernDevicesPath = Join-Path $modernGatewayRoot 'paired-devices.json'

function Get-Plan {
    $legacyTask = Get-ScheduledTask -TaskName $legacyListenerTaskName -ErrorAction SilentlyContinue
    $modernTask = Get-ScheduledTask -TaskName $modernListenerTaskName -ErrorAction SilentlyContinue
    $legacyTokenExists = Test-Path -LiteralPath $legacyTokenPath -PathType Leaf
    $modernTokenExists = Test-Path -LiteralPath $modernTokenPath -PathType Leaf
    $legacyTaskEnabled = [bool]($legacyTask -and $legacyTask.Settings.Enabled)
    [pscustomobject]@{
        legacyDetected = [bool]($legacyTokenExists -or $legacyTask)
        requiresMigration = [bool]($legacyTokenExists -and ($legacyTaskEnabled -or -not $modernTokenExists -or -not $modernTask))
        legacyRoot = $LegacyRoot
        hostRoot = $HostRoot
        legacyTokenExists = $legacyTokenExists
        modernTokenExists = $modernTokenExists
        legacyListenerTaskExists = [bool]$legacyTask
        legacyListenerTaskEnabled = $legacyTaskEnabled
        modernListenerTaskExists = [bool]$modernTask
        pairedDevicesAvailable = Test-Path -LiteralPath $legacyDevicesPath -PathType Leaf
    }
}

function Write-JsonFile([string]$Path, $Value) {
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = "$Path.tmp"
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    }
    finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

function Export-TaskIfPresent([string]$TaskName, [string]$Destination) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { return $false }
    $xml = Export-ScheduledTask -TaskName $TaskName
    [IO.File]::WriteAllText($Destination, $xml, [Text.UTF8Encoding]::new($false))
    return $true
}

function Stop-VerifiedGatewayProcess {
    $listener = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $GatewayPort -ErrorAction SilentlyContinue
    if (-not $listener) { return }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notlike '*out\gateway\server.js*') {
        throw "Port $GatewayPort is owned by an unexpected process. Rollback did not stop it."
    }
    Stop-Process -Id ([int]$listener.OwningProcess) -Force -ErrorAction Stop
}

if ($Mode -eq 'Plan') {
    Get-Plan
    exit 0
}

if ($Mode -eq 'Prepare') {
    $plan = Get-Plan
    if (-not $plan.requiresMigration) { $plan; exit 0 }
    if (-not $plan.legacyTokenExists) { throw 'Legacy migration was requested, but its capability token is missing.' }

    $legacyToken = (Get-Content -Raw -LiteralPath $legacyTokenPath).Trim()
    if ($legacyToken -notmatch '^[A-Za-z0-9_-]{40,256}$') { throw 'The legacy capability token is invalid; nothing was changed.' }
    if (Test-Path -LiteralPath $modernTokenPath -PathType Leaf) {
        $modernToken = (Get-Content -Raw -LiteralPath $modernTokenPath).Trim()
        if ($modernToken -ne $legacyToken) { throw 'The legacy and modern capability tokens differ. Refusing an ambiguous migration.' }
    }

    New-Item -ItemType Directory -Path $HostRoot -Force | Out-Null
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $HostRoot '/inheritance:r' '/grant:r' "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Windows could not restrict the new Hearth Remote host folder.' }

    $backupRoot = Join-Path $HostRoot ('migration-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backupRoot | Out-Null
    $legacyListenerXml = Join-Path $backupRoot 'Codex Remote Listener.xml'
    $gatewayXml = Join-Path $backupRoot 'Hearth Remote Gateway.xml'
    $legacyListenerExported = Export-TaskIfPresent $legacyListenerTaskName $legacyListenerXml
    $gatewayExported = Export-TaskIfPresent $gatewayTaskName $gatewayXml

    if (-not (Test-Path -LiteralPath $modernTokenPath -PathType Leaf)) {
        Copy-Item -LiteralPath $legacyTokenPath -Destination $modernTokenPath
    }
    New-Item -ItemType Directory -Path $modernGatewayRoot -Force | Out-Null
    if ((Test-Path -LiteralPath $legacyDevicesPath -PathType Leaf) -and -not (Test-Path -LiteralPath $modernDevicesPath -PathType Leaf)) {
        Copy-Item -LiteralPath $legacyDevicesPath -Destination $modernDevicesPath
    }

    $state = [ordered]@{
        status = 'preparing'
        preparedAt = [DateTimeOffset]::Now.ToString('o')
        legacyRoot = $LegacyRoot
        hostRoot = $HostRoot
        backupRoot = $backupRoot
        legacyListenerTaskName = $legacyListenerTaskName
        modernListenerTaskName = $modernListenerTaskName
        gatewayTaskName = $gatewayTaskName
        legacyListenerTaskExported = $legacyListenerExported
        gatewayTaskExported = $gatewayExported
        legacyListenerXml = if ($legacyListenerExported) { $legacyListenerXml } else { '' }
        gatewayXml = if ($gatewayExported) { $gatewayXml } else { '' }
        legacyListenerWasEnabled = $plan.legacyListenerTaskEnabled
        legacyTokenSha256 = Get-Sha256 $legacyTokenPath
        pairedDevicesCopied = Test-Path -LiteralPath $modernDevicesPath -PathType Leaf
    }
    Write-JsonFile $statePath $state

    try {
        if ($plan.legacyListenerTaskExists) {
            Stop-ScheduledTask -TaskName $legacyListenerTaskName -ErrorAction SilentlyContinue
            Disable-ScheduledTask -TaskName $legacyListenerTaskName | Out-Null
            $deadline = [DateTimeOffset]::Now.AddSeconds(15)
            do {
                $task = Get-ScheduledTask -TaskName $legacyListenerTaskName -ErrorAction SilentlyContinue
                if (-not $task -or $task.State -ne 'Running') { break }
                Start-Sleep -Milliseconds 250
            } while ([DateTimeOffset]::Now -lt $deadline)
            if ($task -and $task.State -eq 'Running') { throw 'The legacy listener supervisor did not stop within 15 seconds.' }
        }
        $state.status = 'prepared'
        $state['legacySupervisorStopped'] = $true
        Write-JsonFile $statePath $state
        [pscustomobject]$state
        exit 0
    }
    catch {
        if ($plan.legacyListenerTaskEnabled) {
            Enable-ScheduledTask -TaskName $legacyListenerTaskName -ErrorAction SilentlyContinue | Out-Null
            Start-ScheduledTask -TaskName $legacyListenerTaskName -ErrorAction SilentlyContinue
        }
        throw
    }
}

if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    [pscustomobject]@{ status = 'not-required'; hostRoot = $HostRoot }
    exit 0
}
$saved = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json

if ($Mode -eq 'Commit') {
    $saved.status = 'completed'
    $saved | Add-Member -NotePropertyName completedAt -NotePropertyValue ([DateTimeOffset]::Now.ToString('o')) -Force
    Write-JsonFile $statePath $saved
    $saved
    exit 0
}

if ($Mode -eq 'Rollback') {
    Stop-ScheduledTask -TaskName $modernListenerTaskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $modernListenerTaskName -ErrorAction SilentlyContinue | Out-Null

    if ($saved.legacyListenerTaskExported -and (Test-Path -LiteralPath $saved.legacyListenerXml -PathType Leaf)) {
        $legacyXml = Get-Content -Raw -LiteralPath $saved.legacyListenerXml
        Register-ScheduledTask -TaskName $legacyListenerTaskName -Xml $legacyXml -Force | Out-Null
    }
    if ($saved.legacyListenerWasEnabled) {
        Enable-ScheduledTask -TaskName $legacyListenerTaskName | Out-Null
        Start-ScheduledTask -TaskName $legacyListenerTaskName
    }

    if ($saved.gatewayTaskExported -and (Test-Path -LiteralPath $saved.gatewayXml -PathType Leaf)) {
        Stop-ScheduledTask -TaskName $gatewayTaskName -ErrorAction SilentlyContinue
        Stop-VerifiedGatewayProcess
        $gatewayXmlContent = Get-Content -Raw -LiteralPath $saved.gatewayXml
        Register-ScheduledTask -TaskName $gatewayTaskName -Xml $gatewayXmlContent -Force | Out-Null
        Start-ScheduledTask -TaskName $gatewayTaskName
    }

    $saved.status = 'rolled-back'
    $saved | Add-Member -NotePropertyName rolledBackAt -NotePropertyValue ([DateTimeOffset]::Now.ToString('o')) -Force
    Write-JsonFile $statePath $saved
    $saved
}
