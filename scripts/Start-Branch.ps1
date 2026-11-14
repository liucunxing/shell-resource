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
        throw 'PG startup requires -SettingsFile pointing to an existing approved TOML configuration.'
    }
    $selectedSettings = (Resolve-Path -LiteralPath $SettingsFile).Path
    $application = 'app.main:app'
    $port = 8020
} else {
    if ($SettingsFile) { throw '-SettingsFile is only accepted by the pg-real branch.' }
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'frontend/dist/index.html') -PathType Leaf)) {
        throw 'Build the frontend in this worktree before starting the local prototype preview.'
    }
    $selectedSettings = Join-Path $backendRoot 'config/settings.example.toml'
    $application = 'tests.v19_prototype_fixture:app'
    $port = 8019
}

$savedEnvironment = @{}
foreach ($name in @('APP_ENV', 'APP_SETTINGS_FILE', 'PYTHONPATH')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$locationPushed = $false
try {
    $env:APP_ENV = if ($mode -eq 'pg-real') { 'development' } else { 'test' }
    $env:APP_SETTINGS_FILE = $selectedSettings
    $env:PYTHONPATH = Join-Path $backendRoot 'src'
    if ($savedEnvironment['PYTHONPATH']) {
        $env:PYTHONPATH += [IO.Path]::PathSeparator + $savedEnvironment['PYTHONPATH']
    }
    Push-Location -LiteralPath $backendRoot
    $locationPushed = $true
    Write-Host "Starting $mode at http://127.0.0.1:$port (Ctrl+C to stop)."
    & $pythonExecutable -m uvicorn $application --app-dir src --host 127.0.0.1 --port $port
    $serverExitCode = $LASTEXITCODE
    if ($serverExitCode -ne 0) { throw "Server exited with code $serverExitCode." }
} finally {
    if ($locationPushed) { Pop-Location }
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
}
