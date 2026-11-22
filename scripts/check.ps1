<#
.SYNOPSIS
  Runs every check CI runs, locally, and prints a summary. Exits non-zero if anything fails.

.EXAMPLE
  .\scripts\check.ps1
#>
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
$ruff = Join-Path $root 'backend\.venv\Scripts\ruff.exe'
$results = [ordered]@{}

function Step([string]$Name, [string]$Directory, [scriptblock]$Command) {
  Write-Host "`n=== $Name" -ForegroundColor Cyan
  Push-Location $Directory
  try {
    & $Command
    $results[$Name] = ($LASTEXITCODE -eq 0)
  } catch {
    Write-Host $_ -ForegroundColor Red
    $results[$Name] = $false
  } finally {
    Pop-Location
  }
}

Step 'backend: ruff check' "$root\backend" { & $ruff check . }
Step 'backend: ruff format' "$root\backend" { & $ruff format --check . }
Step 'backend: pytest' $root { & $python -m pytest -q backend/tests }
Step 'frontend: typecheck' "$root\frontend" { npx tsc -b }
Step 'frontend: lint' "$root\frontend" { npm run lint }
Step 'frontend: tests' "$root\frontend" { npm test }
Step 'frontend: build' "$root\frontend" { npm run build }
Step 'data validation' $root { python .github/scripts/validate_data.py . }

Write-Host "`n=== Summary" -ForegroundColor Cyan
foreach ($name in $results.Keys) {
  $mark = if ($results[$name]) { 'PASS' } else { 'FAIL' }
  $color = if ($results[$name]) { 'Green' } else { 'Red' }
  Write-Host ("{0}  {1}" -f $mark, $name) -ForegroundColor $color
}

if ($results.Values -contains $false) { exit 1 }
