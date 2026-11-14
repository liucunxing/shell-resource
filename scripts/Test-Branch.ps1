[CmdletBinding()]
param(
    [string]$Python = '',
    [string]$SettingsFile = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $repoRoot 'backend'
$profileFile = Join-Path $repoRoot 'test-profile.json'
if (-not (Test-Path -LiteralPath $profileFile -PathType Leaf)) {
    throw 'Missing test-profile.json in this worktree. Use the prepared local-demo or pg-real branch.'
}
$profile = Get-Content -LiteralPath $profileFile -Raw | ConvertFrom-Json
if (-not $profile.PSObject.Properties['mode'] -or $profile.mode -notin @('local-prototype', 'pg-real')) {
    throw 'test-profile.json mode must be local-prototype or pg-real.'
}
$mode = [string]$profile.mode
if (-not $Python) { $Python = Join-Path $backendRoot '.venv/Scripts/python.exe' }
$pythonCommand = Get-Command -Name $Python -CommandType Application -ErrorAction Stop
$pythonExecutable = $pythonCommand.Source

if ($mode -eq 'pg-real') {
    if (-not $SettingsFile -or -not (Test-Path -LiteralPath $SettingsFile -PathType Leaf)) {
        throw 'PG tests require -SettingsFile pointing to an existing approved TOML configuration.'
    }
    $selectedSettings = (Resolve-Path -LiteralPath $SettingsFile).Path
} else {
    if ($SettingsFile) { throw '-SettingsFile is only accepted by the pg-real branch.' }
    $selectedSettings = Join-Path $backendRoot 'config/settings.example.toml'
    $prototypeTests = @(Get-ChildItem -LiteralPath (Join-Path $backendRoot 'tests') -Filter 'test_v19_prototype*.py' -File | Sort-Object Name)
    if ($prototypeTests.Count -eq 0) { throw 'No local V19 prototype tests found in this worktree.' }
}

$savedEnvironment = @{}
foreach ($name in @('APP_ENV', 'APP_SETTINGS_FILE', 'PYTHONPATH')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$reportDirectory = Join-Path $repoRoot ('outputs/branch-tests/' + $mode + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$locationPushed = $false
try {
    $env:APP_ENV = if ($mode -eq 'pg-real') { 'development' } else { 'test' }
    $env:APP_SETTINGS_FILE = $selectedSettings
    $env:PYTHONPATH = Join-Path $backendRoot 'src'
    if ($savedEnvironment['PYTHONPATH']) {
        $env:PYTHONPATH += [IO.Path]::PathSeparator + $savedEnvironment['PYTHONPATH']
    }
    New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
    Push-Location -LiteralPath $backendRoot
    $locationPushed = $true
    if ($mode -eq 'local-prototype') {
        $testArguments = @('-m', 'pytest', 'tests/test_local_preview.py')
        $testArguments += @($prototypeTests | ForEach-Object { 'tests/' + $_.Name })
        $testArguments += @('-q', '--junitxml', (Join-Path $reportDirectory 'local-prototype.xml'))
        Write-Host 'Testing local V19 prototype fixtures (SQLite only).'
        & $pythonExecutable @testArguments
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -ne 0) { throw "Local prototype tests failed (exit $testExitCode)." }
    } else {
        foreach ($scriptName in @('assess_sellin_pg', 'verify_v19_pg', 'verify_sellin_live_pg')) {
            Write-Host "Running $scriptName against the explicit development configuration."
            & $pythonExecutable (Join-Path $backendRoot "scripts/$scriptName.py") --report (Join-Path $reportDirectory "$scriptName.json")
            $testExitCode = $LASTEXITCODE
            if ($testExitCode -ne 0) { throw "$scriptName failed (exit $testExitCode). Reports: $reportDirectory" }
        }
    }
    Write-Host "Passed. Reports: $reportDirectory"
} finally {
    if ($locationPushed) { Pop-Location }
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
}
