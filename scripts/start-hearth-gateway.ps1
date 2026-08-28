[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$NodePath = '',
    [string]$HostRoot = (Join-Path $env:USERPROFILE '.hearth-remote\host'),
    [string]$PublicOrigin = '',
    [string]$DefaultCwd = (Join-Path $env:USERPROFILE 'Documents'),
    [string]$HostName = [Environment]::MachineName,
    [switch]$EnableHermes
)

$ErrorActionPreference = 'Stop'
$listenerRoot = [IO.Path]::GetFullPath($HostRoot)
$gatewayRoot = Join-Path $listenerRoot 'hearth-gateway'
$tokenPath = Join-Path $listenerRoot 'app-server-token'
$staticRoot = Join-Path $ProjectRoot 'out\web'
$serverPath = Join-Path $ProjectRoot 'out\gateway\server.js'
$stdoutPath = Join-Path $gatewayRoot 'gateway.stdout.log'
$stderrPath = Join-Path $gatewayRoot 'gateway.stderr.log'

New-Item -ItemType Directory -Path $gatewayRoot -Force | Out-Null

try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4520/api/health' -TimeoutSec 2
    if ($health.status -eq 'ready') { exit 0 }
} catch {
    # Expected when the gateway has not started yet.
}

foreach ($required in @($tokenPath, $staticRoot, $serverPath)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Hearth Gateway requirement is missing: $required" }
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $NodePath = (Get-Command node.exe -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Node.js executable is missing: $NodePath"
}
$serverArgument = '"{0}"' -f $serverPath
$env:HEARTH_GATEWAY_PORT = '4520'
$env:HEARTH_GATEWAY_AUTH_ROOT = $gatewayRoot
$env:HEARTH_GATEWAY_STATIC_ROOT = $staticRoot
$env:HEARTH_GATEWAY_TOKEN_PATH = $tokenPath
$env:HEARTH_GATEWAY_PUBLIC_ORIGIN = $PublicOrigin
$env:HEARTH_GATEWAY_DEFAULT_CWD = $DefaultCwd
$env:HEARTH_GATEWAY_HANDOFF_PATH = (Join-Path $listenerRoot 'handoff-desktop.ps1')
$env:HEARTH_GATEWAY_HOST_NAME = $HostName
$env:HEARTH_GATEWAY_HERMES_ENABLED = if ($EnableHermes) { '1' } else { '0' }
try {
    $process = Start-Process `
        -FilePath $NodePath `
        -ArgumentList $serverArgument `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
    # Keep the gateway process independent from this short-lived launcher.
    # Otherwise Windows Terminal retains a visible PowerShell console for the
    # full lifetime of the gateway after every logon.
    exit 0
} finally {
    Remove-Item Env:\HEARTH_GATEWAY_PORT,Env:\HEARTH_GATEWAY_AUTH_ROOT,Env:\HEARTH_GATEWAY_STATIC_ROOT,Env:\HEARTH_GATEWAY_TOKEN_PATH,Env:\HEARTH_GATEWAY_PUBLIC_ORIGIN,Env:\HEARTH_GATEWAY_DEFAULT_CWD,Env:\HEARTH_GATEWAY_HANDOFF_PATH,Env:\HEARTH_GATEWAY_HOST_NAME,Env:\HEARTH_GATEWAY_HERMES_ENABLED -ErrorAction SilentlyContinue
}
