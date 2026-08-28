[CmdletBinding()]
param(
    [string]$DefaultCwd = (Join-Path $env:USERPROFILE 'Documents'),
    [string]$HostRoot = (Join-Path $env:USERPROFILE '.hearth-remote\host'),
    [string]$ConnectionFile = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Hearth-Remote-Connection.json'),
    [switch]$EnableHermes,
    [switch]$SkipBuild,
    [switch]$Plan
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) { Write-Host "`n$Text" -ForegroundColor Cyan }

Write-Host 'Hearth Remote host setup' -ForegroundColor Magenta
Write-Host 'Codex runs as a hidden host service; the Codex desktop app does not need to stay open.'
Write-Host 'The service stays on loopback and is published only inside your private Tailscale network.'

if (-not (Test-Path -LiteralPath $DefaultCwd -PathType Container)) {
    throw "The default project folder does not exist: $DefaultCwd"
}

$tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if (-not $tailscale) {
    throw 'Tailscale is not installed. Install it from https://tailscale.com/download/windows, sign in, then run setup again.'
}

Write-Step '1 of 5 - Checking the private network'
try { $status = (& $tailscale.Source status --json 2>&1 | Out-String) | ConvertFrom-Json }
catch { throw 'Tailscale is installed but not connected. Open Tailscale, sign in, and run setup again.' }
$dnsName = [string]$status.Self.DNSName
if ([string]::IsNullOrWhiteSpace($dnsName)) { throw 'Tailscale did not report a DNS name for this computer.' }
$dnsName = $dnsName.TrimEnd('.')
Write-Host "Connected as $dnsName" -ForegroundColor Green

$migrationScript = Join-Path $PSScriptRoot 'migrate-legacy-host.ps1'
$migrationPlan = & $migrationScript -Mode Plan -HostRoot $HostRoot
if ($Plan) {
    Write-Host ''
    Write-Host 'Setup plan - no changes were made' -ForegroundColor Magenta
    Write-Host "Host:             $([Environment]::MachineName)"
    Write-Host "Tailnet address:  $dnsName"
    Write-Host "Project folder:   $([IO.Path]::GetFullPath($DefaultCwd))"
    Write-Host "Runtime folder:   $([IO.Path]::GetFullPath($HostRoot))"
    Write-Host "Hermes enabled:   $([bool]$EnableHermes)"
    Write-Host "Legacy migration: $($migrationPlan.requiresMigration)"
    if ($migrationPlan.requiresMigration) {
        Write-Host 'The existing capability token and paired-phone store will be adopted; the old listener task will be exported, stopped, and disabled.'
    }
    exit 0
}

$migrationPrepared = $false
try {
    if ($migrationPlan.requiresMigration) {
        Write-Step 'Preparing rollback-safe legacy adoption'
        $migrationResult = & $migrationScript -Mode Prepare -HostRoot $HostRoot
        $migrationPrepared = $migrationResult.status -eq 'prepared'
        Write-Host "Rollback backup: $($migrationResult.backupRoot)" -ForegroundColor DarkGray
    }

    Write-Step '2 of 5 - Installing the update-aware Codex listener'
    $listenerArgs = @{ HostRoot = $HostRoot; WorkingDirectory = $DefaultCwd }
    & (Join-Path $PSScriptRoot 'install-codex-listener.ps1') @listenerArgs

    Write-Step '3 of 5 - Publishing private tailnet addresses'
    & $tailscale.Source serve --bg --https=4500 http://127.0.0.1:4500
    if ($LASTEXITCODE -ne 0) {
        throw 'Tailscale could not publish the Codex listener. If a browser approval page opened, approve HTTPS and run setup again.'
    }
    if ($EnableHermes) {
        & $tailscale.Source serve --bg --https=4510 http://127.0.0.1:4510
        if ($LASTEXITCODE -ne 0) { throw 'Tailscale could not publish the optional Hermes listener.' }
    }

    Write-Step '4 of 5 - Building and installing phone access'
    $gatewayArgs = @{ HostRoot = $HostRoot; DefaultCwd = $DefaultCwd; DnsName = $dnsName; EnableHermes = $EnableHermes; SkipBuild = $SkipBuild }
    & (Join-Path $PSScriptRoot 'install-hearth-gateway.ps1') @gatewayArgs

    Write-Step '5 of 5 - Creating the laptop connection file'
    $tokenPath = Join-Path $HostRoot 'app-server-token'
    $token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
    if ($token -notmatch '^[A-Za-z0-9_-]{40,256}$') { throw 'The generated capability token failed validation.' }
    $connection = [ordered]@{
    format = 'hearth-remote-connection'
    version = 1
    createdAt = [DateTimeOffset]::Now.ToString('o')
    connection = [ordered]@{
        hostName = [Environment]::MachineName
        endpoint = "wss://${dnsName}:4500"
        hermesEndpoint = if ($EnableHermes) { "wss://${dnsName}:4510/api/ws" } else { '' }
        defaultCwd = [IO.Path]::GetFullPath($DefaultCwd)
        handoffScriptPath = Join-Path ([IO.Path]::GetFullPath($HostRoot)) 'handoff-desktop.ps1'
        hermesEnabled = [bool]$EnableHermes
        token = $token
    }
    }
    $connectionDirectory = Split-Path -Parent $ConnectionFile
    if (-not (Test-Path -LiteralPath $connectionDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $connectionDirectory -Force | Out-Null
    }
    $temporaryFile = "$ConnectionFile.tmp"
    $connectionJson = $connection | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($temporaryFile, $connectionJson, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryFile -Destination $ConnectionFile -Force

    if ($migrationPrepared) { & $migrationScript -Mode Commit -HostRoot $HostRoot | Out-Null }
}
catch {
    $setupError = $_
    if ($migrationPrepared) {
        Write-Warning 'Setup failed after legacy adoption began. Restoring the previous listener and gateway tasks...'
        try { & $migrationScript -Mode Rollback -HostRoot $HostRoot | Out-Null }
        catch { Write-Warning "Automatic rollback also reported an error: $($_.Exception.Message)" }
    }
    throw $setupError
}

Write-Host ''
Write-Host 'Hearth Remote is ready.' -ForegroundColor Green
Write-Host "Laptop connection file: $ConnectionFile"
Write-Host "Phone address: https://${dnsName}:4520"
Write-Host ''
Write-Host 'Move the connection file to your laptop, import it in Hearth Remote, then delete the file.' -ForegroundColor Yellow
Write-Host 'It contains a private capability token. Hearth Remote encrypts that token after import.'
Write-Host ''
Write-Host 'If Tailscale opened a browser asking you to enable HTTPS, approve it and run this setup once more.'
