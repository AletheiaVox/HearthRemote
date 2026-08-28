[CmdletBinding()]
param(
    [string]$CodexExe
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not $CodexExe) {
    $binRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
    $candidate = Get-ChildItem -LiteralPath $binRoot -Filter 'codex.exe' -File -Recurse |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $candidate) {
        throw "Could not find the Codex executable under $binRoot. Pass -CodexExe explicitly."
    }
    $CodexExe = $candidate.FullName
}

$CodexExe = (Resolve-Path -LiteralPath $CodexExe).Path
$generatedRoot = Join-Path $projectRoot 'schemas\generated'
$jsonOut = Join-Path $generatedRoot 'json'
$tsOut = Join-Path $generatedRoot 'typescript'

New-Item -ItemType Directory -Path $jsonOut -Force | Out-Null
New-Item -ItemType Directory -Path $tsOut -Force | Out-Null

& $CodexExe app-server generate-json-schema --experimental --out $jsonOut
if ($LASTEXITCODE -ne 0) { throw "Codex JSON Schema generation failed with exit code $LASTEXITCODE." }

& $CodexExe app-server generate-ts --experimental --out $tsOut
if ($LASTEXITCODE -ne 0) { throw "Codex TypeScript generation failed with exit code $LASTEXITCODE." }

$version = (& $CodexExe --version).Trim()
$metadata = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    codexVersion = $version
    codexExecutable = $CodexExe
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $generatedRoot 'metadata.json') -Encoding utf8

Write-Host "Generated app-server protocol references for $version"
Write-Host $generatedRoot
