$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$migrationScript = Join-Path $PSScriptRoot 'migrate-legacy-host.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('hearth-migration-test-' + [guid]::NewGuid().ToString('N'))
$legacyRoot = Join-Path $testRoot 'legacy'
$hostRoot = Join-Path $testRoot 'modern'
$testNames = @{
    LegacyListenerTaskName = 'Hearth Migration Test Legacy - Does Not Exist'
    ModernListenerTaskName = 'Hearth Migration Test Modern - Does Not Exist'
    GatewayTaskName = 'Hearth Migration Test Gateway - Does Not Exist'
    GatewayPort = 65432
}

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Migration test failed: $Message" }
}

try {
    New-Item -ItemType Directory -Path (Join-Path $legacyRoot 'hearth-gateway') -Force | Out-Null
    $token = 'migration-test-token-' + ('x' * 48)
    [IO.File]::WriteAllText((Join-Path $legacyRoot 'app-server-token'), $token, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $legacyRoot 'hearth-gateway\paired-devices.json'), '[]', [Text.UTF8Encoding]::new($false))

    $plan = & $migrationScript -Mode Plan -HostRoot $hostRoot -LegacyRoot $legacyRoot @testNames
    Assert $plan.requiresMigration 'the isolated legacy fixture was not detected'

    $prepared = & $migrationScript -Mode Prepare -HostRoot $hostRoot -LegacyRoot $legacyRoot @testNames
    Assert ($prepared.status -eq 'prepared') 'prepare did not reach prepared state'
    Assert ((Get-Content -Raw (Join-Path $hostRoot 'app-server-token')).Trim() -eq $token) 'the token was not preserved byte-for-byte'
    Assert (Test-Path (Join-Path $hostRoot 'hearth-gateway\paired-devices.json')) 'paired devices were not copied'

    $rolledBack = & $migrationScript -Mode Rollback -HostRoot $hostRoot -LegacyRoot $legacyRoot @testNames
    Assert ($rolledBack.status -eq 'rolled-back') 'rollback did not record completion'

    $preparedAgain = & $migrationScript -Mode Prepare -HostRoot $hostRoot -LegacyRoot $legacyRoot @testNames
    Assert ($preparedAgain.status -eq 'prepared') 'prepare was not safely repeatable after rollback'
    $committed = & $migrationScript -Mode Commit -HostRoot $hostRoot -LegacyRoot $legacyRoot @testNames
    Assert ($committed.status -eq 'completed') 'commit did not record completion'

    Write-Host 'Legacy adoption prepare, rollback, repeat, and commit tests passed.' -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
