<#
.SYNOPSIS
  Starts the INYX backend (FastAPI) and frontend (Vite) for local development. Ctrl+C stops both.

.DESCRIPTION
  - Creates backend\.venv and installs backend\requirements-dev.txt on first run.
  - Runs `npm ci` in frontend\ on first run.
  - Starts uvicorn on -ApiPort and Vite on -WebPort. The Vite dev server proxies /api to the backend, so the
    browser needs no CORS in development. CORS_ORIGINS is still set for the frontend origin, in case you point
    the app at the backend directly with VITE_API_URL.
  - Refuses to start if a port is already taken (for example a stale dev server) and says how to free it.

.EXAMPLE
  .\scripts\dev.ps1
  .\scripts\dev.ps1 -WebPort 5180
#>
param(
  [int]$ApiPort = 8000,
  [int]$WebPort = 5173
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$python = Join-Path $backend '.venv\Scripts\python.exe'

function Assert-PortFree([int]$Port, [string]$Name) {
  $owner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

  if ($owner) {
    $process = Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue
    throw "Port $Port ($Name) is already in use by '$($process.ProcessName)' (pid $($owner.OwningProcess)). Stop it (Stop-Process -Id $($owner.OwningProcess)) or pick another port with -ApiPort / -WebPort."
  }
}

Assert-PortFree $ApiPort 'backend'
Assert-PortFree $WebPort 'frontend'

if (-not (Test-Path $python)) {
  Write-Host 'Creating backend virtual environment...' -ForegroundColor Cyan
  python -m venv (Join-Path $backend '.venv')
  & $python -m pip install --quiet -r (Join-Path $backend 'requirements-dev.txt')
}

if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
  Write-Host 'Installing frontend dependencies...' -ForegroundColor Cyan
  Push-Location $frontend
  try { npm ci } finally { Pop-Location }
}

$env:APP_ENV = 'development'
$env:LOG_JSON = 'false'
$env:CORS_ORIGINS = "http://localhost:$WebPort,http://127.0.0.1:$WebPort"
$env:VITE_DEV_API_TARGET = "http://127.0.0.1:$ApiPort"

$api = $null
$web = $null

try {
  $api = Start-Process -PassThru -NoNewWindow -WorkingDirectory $backend -FilePath $python -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--port', $ApiPort, '--reload')
  $web = Start-Process -PassThru -NoNewWindow -WorkingDirectory $frontend -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--port', $WebPort, '--strictPort')

  # Wait for the backend to answer before announcing the URLs.
  $ready = $false
  for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
    try { $ready = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ApiPort/api/v1/health/live" -TimeoutSec 2).StatusCode -eq 200 } catch { Start-Sleep -Milliseconds 500 }
  }

  if (-not $ready) { throw 'The backend did not become ready within 30 seconds.' }

  Write-Host ''
  Write-Host "  INYX app   http://localhost:$WebPort" -ForegroundColor Green
  Write-Host "  API docs   http://localhost:$ApiPort/docs" -ForegroundColor Green
  Write-Host '  Press Ctrl+C to stop both.' -ForegroundColor DarkGray
  Write-Host ''

  Wait-Process -Id $api.Id, $web.Id -ErrorAction SilentlyContinue
} finally {
  foreach ($p in @($api, $web)) {
    if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F | Out-Null }
  }
}
