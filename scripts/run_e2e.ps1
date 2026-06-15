#!/usr/bin/env pwsh
# Windows PowerShell wrapper for the docker-based e2e suite.
#
# Usage (from repo root):
#   pwsh scripts/run_e2e.ps1                 # full suite
#   pwsh scripts/run_e2e.ps1 -k checklist    # one keyword
#   pwsh scripts/run_e2e.ps1 tests/e2e/test_ref_config.py -v
#
# All extra args are passed through to pytest (as the PYTEST_ARGS env var).

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Passthrough
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

Write-Host "[run_e2e] building backend-e2e image ..." -ForegroundColor Cyan
& docker compose -f docker-compose.e2e.yml build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Passthrough.Count -gt 0) {
    $env:PYTEST_ARGS = ($Passthrough -join ' ')
}

Write-Host "[run_e2e] bringing up postgres + gotenberg + backend + tests ..." -ForegroundColor Cyan
& docker compose -f docker-compose.e2e.yml up -d --wait --remove-orphans
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& docker compose -f docker-compose.e2e.yml logs -f tests
$testsExit = $LASTEXITCODE

& docker compose -f docker-compose.e2e.yml down --remove-orphans
exit $testsExit
