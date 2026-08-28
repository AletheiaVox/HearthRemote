[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$portable = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'dist') -Filter 'Hearth Remote *.exe' -File -ErrorAction Stop |
    Where-Object { $_.Name -notlike '*Setup*' } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if (-not $portable) { throw 'No portable Hearth Remote build was found. Run npm run dist:win first.' }

$previewProfile = Join-Path ([IO.Path]::GetTempPath()) ('hearth-remote-preview-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $previewProfile | Out-Null
try {
    Write-Host "Opening $($portable.Name) with a disposable first-run profile..." -ForegroundColor Cyan
    Write-Host 'Close Hearth Remote when you are finished. Your real settings will not be changed.'
    $arguments = '--user-data-dir="{0}"' -f $previewProfile
    $process = Start-Process -FilePath $portable.FullName -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "The preview exited with code $($process.ExitCode)." }
}
finally {
    if (Test-Path -LiteralPath $previewProfile) { Remove-Item -LiteralPath $previewProfile -Recurse -Force }
}
