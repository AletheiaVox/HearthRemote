$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) {
    throw 'Electron runtime is missing. Run npm install first.'
}

$smokeProfile = Join-Path ([IO.Path]::GetTempPath()) ('hearth-remote-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $smokeProfile | Out-Null
try {
    $arguments = '"{0}" --hearth-smoke-test --user-data-dir="{1}"' -f $projectRoot, $smokeProfile
    $process = Start-Process -FilePath $electron -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Hearth Remote smoke test failed with exit code $($process.ExitCode)."
    }
}
finally {
    if (Test-Path -LiteralPath $smokeProfile) { Remove-Item -LiteralPath $smokeProfile -Recurse -Force }
}
