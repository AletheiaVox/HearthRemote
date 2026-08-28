[CmdletBinding()]
param(
    [string]$ProjectRoot = '',

    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$scriptPath = $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw 'PowerShell could not determine the preview script location.' }
$scriptDirectory = Split-Path -Parent $scriptPath
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Join-Path $scriptDirectory '..'
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$portable = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'dist') -Filter 'Hearth Remote *.exe' -File -ErrorAction Stop |
    Where-Object { $_.Name -notlike '*Setup*' } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if (-not $portable) { throw 'No portable Hearth Remote build was found. Run npm run dist:win first.' }

if ($CheckOnly) {
    Write-Host "First-run preview is ready: $($portable.FullName)" -ForegroundColor Green
    exit 0
}

$previewRoot = Join-Path ([IO.Path]::GetTempPath()) ('hearth-remote-preview-' + [guid]::NewGuid().ToString('N'))
$previewProfile = Join-Path $previewRoot 'profile'
$localPortable = Join-Path $previewRoot $portable.Name
New-Item -ItemType Directory -Path $previewProfile -Force | Out-Null
try {
    Write-Host 'Copying the preview to this computer so Windows does not have to run it from the shared drive...' -ForegroundColor DarkGray
    Copy-Item -LiteralPath $portable.FullName -Destination $localPortable
    Write-Host "Opening $($portable.Name) with a disposable first-run profile..." -ForegroundColor Cyan
    Write-Host 'Close Hearth Remote when you are finished. Your real settings will not be changed.'
    $arguments = '--user-data-dir="{0}"' -f $previewProfile
    $process = Start-Process -FilePath $localPortable -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "The preview exited with code $($process.ExitCode)." }
}
finally {
    if (Test-Path -LiteralPath $previewRoot) { Remove-Item -LiteralPath $previewRoot -Recurse -Force }
}
