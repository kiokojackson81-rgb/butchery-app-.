Param(
  [string]$Code = "jacksona",
  [string]$Name = "Jackson A",
  [string]$Outlet = "Kawangware"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[setup] $msg" -ForegroundColor Cyan }
function Write-Done($msg) { Write-Host "[done]  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[warn]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[err]   $msg" -ForegroundColor Red }

# 1) Ensure Docker is available
try {
  docker --version | Out-Null
} catch {
  Write-Err "Docker is not installed or not on PATH. Install Docker Desktop, then re-run this script."
  exit 1
}

# 2) Ensure .env exists with DB URLs
$envFile = Join-Path $PSScriptRoot "..\..\.env"
if (-not (Test-Path $envFile)) {
  Write-Step ".env not found → creating a local one for Docker Postgres"
  $dbUrl = 'postgresql://butchery:butchery@localhost:5432/butchery?pgbouncer=true&connection_limit=1&connect_timeout=10'
  $dbUrlDirect = 'postgresql://butchery:butchery@localhost:5432/butchery?connect_timeout=10'
  @(
    "DATABASE_URL=\"$dbUrl\"",
    "DATABASE_URL_UNPOOLED=\"$dbUrlDirect\"",
    "NEXT_TELEMETRY_DISABLED=1",
    "WA_DRY_RUN=true",
    "WA_AI_ENABLED=false",
    "WA_INTERACTIVE_ENABLED=true",
    "WA_GPT_ONLY=true",
    "WA_TABS_ENABLED=true"
  ) | Set-Content -NoNewline:$false -Encoding UTF8 $envFile
  Write-Done ".env created"
} else {
  Write-Step ".env already exists — skipping creation"
}

# 3) Start Docker Postgres via docker-compose
Write-Step "Starting Docker Postgres (docker compose up -d)"
try {
  docker compose up -d | Out-Null
} catch {
  Write-Err "Failed to start Docker compose: $($_.Exception.Message)"
  exit 1
}

# 4) Wait for port 5432 to accept connections (max ~30s)
Write-Step "Waiting for Postgres on localhost:5432"
$max = 60; $ok = $false
for ($i=0; $i -lt $max; $i++) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect('localhost', 5432, $null, $null)
    $wait = $iar.AsyncWaitHandle.WaitOne(500)
    if ($wait -and $tcp.Connected) { $tcp.Close(); $ok = $true; break }
    Start-Sleep -Milliseconds 500
  } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ok) {
  Write-Err "Postgres did not become ready on port 5432 — check Docker Desktop"
  exit 1
}
Write-Done "Postgres is ready"

# 5) Export env vars for current process (also loaded from .env by Prisma)
$env:DATABASE_URL = (Get-Content $envFile | Select-String -Pattern '^DATABASE_URL=' | ForEach-Object { $_.ToString().Substring(13).Trim('"') })
$env:DATABASE_URL_UNPOOLED = (Get-Content $envFile | Select-String -Pattern '^DATABASE_URL_UNPOOLED=' | ForEach-Object { $_.ToString().Substring(23).Trim('"') })
if (-not $env:DATABASE_URL) { Write-Err "DATABASE_URL missing from .env"; exit 1 }

# 6) Push Prisma schema
Write-Step "Applying Prisma schema (npm run -s prisma:push)"
& npm run -s prisma:push
if ($LASTEXITCODE -ne 0) { Write-Err "Prisma push failed"; exit 1 }
Write-Done "Schema applied"

# 7) Seed attendant code
Write-Step "Seeding attendant code: $Code ($Name @ $Outlet)"
$env:SEED_CODE = $Code
$env:SEED_NAME = $Name
$env:SEED_OUTLET = $Outlet
& npm run -s seed:attendant:sample
if ($LASTEXITCODE -ne 0) { Write-Warn "Seeding script reported errors; continuing" }
Write-Done "Seeding attempted"

Write-Done "Local DB initialized. Next steps:"
Write-Host "\n  1) Start dev server:   npm run dev:3002"
Write-Host   "  2) Health check:       http://localhost:3002/api/health/db (should show { ok: true })"
Write-Host   "  3) Login with code:    $Code (case-insensitive)\n"
