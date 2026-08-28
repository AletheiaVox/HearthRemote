[CmdletBinding()]
param(
    [string]$HostRoot = (Join-Path $env:USERPROFILE '.hearth-remote\host'),
    [string]$DefaultCwd = (Join-Path $env:USERPROFILE 'Documents'),
    [string]$DnsName = '',
    [switch]$EnableHermes,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot 'start-hearth-gateway.ps1'
$gatewayRoot = Join-Path ([IO.Path]::GetFullPath($HostRoot)) 'hearth-gateway'
$taskName = 'Hearth Remote Gateway'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

if (-not $SkipBuild) {
    & npm.cmd run build:phone --prefix $projectRoot
    if ($LASTEXITCODE -ne 0) { throw 'The Hearth phone build failed.' }
}

New-Item -ItemType Directory -Path $gatewayRoot -Force | Out-Null
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $gatewayRoot '/inheritance:r' '/grant:r' "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Windows could not restrict the Hearth Gateway credential folder.' }

if ([string]::IsNullOrWhiteSpace($DnsName)) { throw 'A Tailscale DNS name is required to install the phone gateway.' }
$publicOrigin = 'https://{0}:4520' -f $DnsName.TrimEnd('.')
$hermesSwitch = if ($EnableHermes) { ' -EnableHermes' } else { '' }
$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -ProjectRoot "{1}" -NodePath "{2}" -HostRoot "{3}" -PublicOrigin "{4}" -DefaultCwd "{5}" -HostName "{6}"{7}' -f $startScript, $projectRoot, $nodePath, $HostRoot, $publicOrigin, $DefaultCwd, [Environment]::MachineName, $hermesSwitch
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $currentIdentity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$existing = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 4520 -ErrorAction SilentlyContinue
if ($existing) {
    $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing.OwningProcess)"
    if (-not $existingProcess -or $existingProcess.CommandLine -notlike '*out\gateway\server.js*') {
        throw "Port 4520 is occupied by an unexpected process. Nothing was stopped."
    }
    Stop-Process -Id $existing.OwningProcess -Force
}
Start-ScheduledTask -TaskName $taskName

$deadline = (Get-Date).AddSeconds(40)
do {
    Start-Sleep -Milliseconds 500
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4520/api/health' -TimeoutSec 2 } catch { $health = $null }
} until ($health.status -eq 'ready' -or (Get-Date) -gt $deadline)
if ($health.status -ne 'ready') {
    Get-Content -LiteralPath (Join-Path $gatewayRoot 'gateway.stderr.log') -Tail 60 -ErrorAction SilentlyContinue
    throw 'Hearth Gateway did not become ready.'
}

& tailscale.exe serve --bg --https=4520 http://127.0.0.1:4520
if ($LASTEXITCODE -ne 0) { throw 'Tailscale could not publish the Hearth Gateway inside the tailnet.' }

$pairingPath = Join-Path $gatewayRoot 'pairing-code.json'
$deadline = (Get-Date).AddSeconds(10)
do { Start-Sleep -Milliseconds 250 } until ((Test-Path -LiteralPath $pairingPath) -or (Get-Date) -gt $deadline)
if (-not (Test-Path -LiteralPath $pairingPath)) { throw 'The gateway started but did not create a pairing code.' }
$pairing = Get-Content -Raw -LiteralPath $pairingPath | ConvertFrom-Json

Write-Host ''
Write-Host 'Hearth Remote phone gateway is ready.' -ForegroundColor Green
Write-Host "URL:  $publicOrigin"
Write-Host "Code: $($pairing.code)"
Write-Host "The one-time code expires at $($pairing.expiresAt)."
