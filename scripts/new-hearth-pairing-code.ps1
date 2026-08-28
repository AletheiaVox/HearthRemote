$ErrorActionPreference = 'Stop'
$taskName = 'Hearth Remote Gateway'
$hostRoot = if ($env:HEARTH_REMOTE_HOST_ROOT) { $env:HEARTH_REMOTE_HOST_ROOT } else { Join-Path $env:USERPROFILE '.hearth-remote\host' }
$gatewayRoot = Join-Path $hostRoot 'hearth-gateway'
$pairingPath = Join-Path $gatewayRoot 'pairing-code.json'
$previousWrite = if (Test-Path -LiteralPath $pairingPath) { (Get-Item -LiteralPath $pairingPath).LastWriteTimeUtc } else { [datetime]::MinValue }

Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
$listener = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 4520 -ErrorAction SilentlyContinue
if ($listener) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $process -or $process.CommandLine -notlike '*out\gateway\server.js*') {
        throw "Port 4520 is occupied by an unexpected process. Nothing was stopped."
    }
    Stop-Process -Id $listener.OwningProcess -Force
}
Start-ScheduledTask -TaskName $taskName

$deadline = (Get-Date).AddSeconds(40)
do {
    Start-Sleep -Milliseconds 500
    $item = Get-Item -LiteralPath $pairingPath -ErrorAction SilentlyContinue
} until (($item -and $item.LastWriteTimeUtc -gt $previousWrite) -or (Get-Date) -gt $deadline)
if (-not $item -or $item.LastWriteTimeUtc -le $previousWrite) { throw 'Hearth Gateway did not create a fresh pairing code.' }

$pairing = Get-Content -Raw -LiteralPath $pairingPath | ConvertFrom-Json
Write-Host ''
Write-Host 'Open this address on a device connected to your tailnet:' -ForegroundColor Cyan
$tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($tailscale) {
    try {
        $status = & $tailscale.Source status --json | ConvertFrom-Json
        $dnsName = [string]$status.Self.DNSName
        if ($dnsName) { Write-Host ('https://{0}:4520' -f $dnsName.TrimEnd('.')) }
    } catch { Write-Host 'Open the Hearth Remote address shown by `tailscale serve status`.' }
} else { Write-Host 'Open the Hearth Remote address shown by `tailscale serve status`.' }
Write-Host ''
Write-Host "Pairing code: $($pairing.code)" -ForegroundColor Magenta
Write-Host "Expires:      $($pairing.expiresAt)"
Write-Host ''
