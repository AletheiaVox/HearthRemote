[CmdletBinding()]
param(
    [string]$HostRoot = (Join-Path $env:USERPROFILE '.hearth-remote\host'),
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$checks = [Collections.Generic.List[object]]::new()

function Add-Check([string]$Name, [bool]$Ok, [string]$Message, [string]$Fix = '') {
    $checks.Add([pscustomobject]@{ name = $Name; ok = $Ok; message = $Message; fix = $Fix })
}

$tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
Add-Check 'Tailscale installed' ([bool]$tailscale) $(if ($tailscale) { $tailscale.Source } else { 'tailscale.exe was not found' }) 'Install Tailscale and sign in.'
if ($tailscale) {
    try {
        $status = (& $tailscale.Source status --json 2>&1 | Out-String) | ConvertFrom-Json
        $dnsName = ([string]$status.Self.DNSName).TrimEnd('.')
        Add-Check 'Tailscale connected' ([bool]$dnsName) $(if ($dnsName) { $dnsName } else { 'No tailnet DNS name was reported' }) 'Open Tailscale and connect this computer.'
    } catch { Add-Check 'Tailscale connected' $false $_.Exception.Message 'Open Tailscale and connect this computer.' }
}

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
$runtime = if (Test-Path -LiteralPath $runtimeRoot) {
    Get-ChildItem -LiteralPath $runtimeRoot -Filter codex.exe -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.DirectoryName 'codex-code-mode-host.exe') } |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
}
Add-Check 'Complete Codex runtime' ([bool]$runtime) $(if ($runtime) { $runtime.FullName } else { 'No version-matched codex.exe and codex-code-mode-host.exe pair was found' }) 'Open or update the Codex desktop app, then run host setup again.'

$tokenPath = Join-Path $HostRoot 'app-server-token'
$tokenValid = $false
if (Test-Path -LiteralPath $tokenPath -PathType Leaf) {
    $tokenValid = (Get-Content -Raw -LiteralPath $tokenPath).Trim() -match '^[A-Za-z0-9_-]{40,256}$'
}
Add-Check 'Capability token' $tokenValid $(if ($tokenValid) { 'Present and structurally valid; value hidden' } else { 'Missing or invalid' }) 'Run host setup again.'

foreach ($service in @(
    @{ Name = 'Codex listener'; Uri = 'http://127.0.0.1:4500/readyz' },
    @{ Name = 'Phone gateway'; Uri = 'http://127.0.0.1:4520/api/health' }
)) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $service.Uri -TimeoutSec 3
        Add-Check $service.Name ($response.StatusCode -eq 200) "HTTP $($response.StatusCode) on loopback" 'Run host setup again.'
    } catch { Add-Check $service.Name $false $_.Exception.Message 'Run host setup again.' }
}

$report = [ordered]@{
    product = 'Hearth Remote'
    generatedAt = [DateTimeOffset]::Now.ToString('o')
    computer = [Environment]::MachineName
    ok = @($checks | Where-Object { -not $_.ok }).Count -eq 0
    checks = $checks
}

if ($Json) { $report | ConvertTo-Json -Depth 5; if (-not $report.ok) { exit 1 }; exit 0 }
Write-Host 'Hearth Remote Doctor' -ForegroundColor Magenta
foreach ($check in $checks) {
    $symbol = if ($check.ok) { '[OK]' } else { '[!!]' }
    $color = if ($check.ok) { 'Green' } else { 'Yellow' }
    Write-Host ("{0} {1}: {2}" -f $symbol, $check.name, $check.message) -ForegroundColor $color
    if (-not $check.ok -and $check.fix) { Write-Host ("     {0}" -f $check.fix) -ForegroundColor DarkGray }
}
if ($report.ok) { Write-Host "`nEverything Hearth Remote needs is healthy." -ForegroundColor Green; exit 0 }
Write-Host "`nOne or more checks need attention. No changes were made." -ForegroundColor Yellow
exit 1
