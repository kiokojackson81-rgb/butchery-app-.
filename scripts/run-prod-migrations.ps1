<#
Run pending Prisma migrations against the production Neon DB.

Usage (PowerShell):
  # Dry-run status
  .\scripts\run-prod-migrations.ps1 -WhatIfStatus

  # Run status + deploy
  .\scripts\run-prod-migrations.ps1

Notes:
- Script uses the DATABASE_URL and DATABASE_URL_UNPOOLED variables below as defaults.
- It asks for confirmation before applying migrations.
- Make sure you have a DB backup/snapshot before applying DDL in production.
#>
param(
    [switch]$WhatIfStatus,
    [switch]$AutoYes
)

# --- CONFIG: override these by setting environment variables or in a .env file
# IMPORTANT: Do NOT commit real credentials. Use environment variables in CI or a local .env file.
$defaultDatabaseUrl = "<PROD_DATABASE_URL>"
$defaultDatabaseUrlUnpooled = "<PROD_DATABASE_URL_UNPOOLED>"

# Prefer environment variables if provided (CI or local env)
$env:DATABASE_URL = $env:DATABASE_URL
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = $defaultDatabaseUrl }
$env:DATABASE_URL_UNPOOLED = $env:DATABASE_URL_UNPOOLED
if (-not $env:DATABASE_URL_UNPOOLED) { $env:DATABASE_URL_UNPOOLED = $defaultDatabaseUrlUnpooled }

Write-Host "Using DATABASE_URL: $($env:DATABASE_URL)"
Write-Host "Using DATABASE_URL_UNPOOLED: $($env:DATABASE_URL_UNPOOLED)"

if ($WhatIfStatus) {
    Write-Host "=== Prisma migrate status (read-only) ==="
    npx prisma migrate status --schema=prisma/schema.prisma
    exit $LASTEXITCODE
}

# Safety: show short summary and ask for confirmation
Write-Host "This will apply pending Prisma migrations from prisma/migrations to the DB pointed by DATABASE_URL."
Write-Host "Ensure you have a backup/snapshot in case of unexpected failures."

if ($AutoYes) {
    $confirm = $true
} else {
    $confirmation = Read-Host "Type YES to continue and apply migrations"
    $confirm = $confirmation -eq 'YES'
}

if (-not $confirm) {
    Write-Host "Aborting: user did not confirm."
    exit 2
}

# 1) Show status
Write-Host "=== Running prisma migrate status ==="
npx prisma migrate status --schema=prisma/schema.prisma
if ($LASTEXITCODE -ne 0) {
    Write-Host "prisma migrate status failed (exit $LASTEXITCODE). Aborting." -ForegroundColor Red
    exit $LASTEXITCODE
}

# 2) Deploy migrations
Write-Host "=== Deploying pending migrations (prisma migrate deploy) ==="
npx prisma migrate deploy --schema=prisma/schema.prisma
if ($LASTEXITCODE -ne 0) {
    Write-Host "prisma migrate deploy failed (exit $LASTEXITCODE). Check logs above and resolve DB errors." -ForegroundColor Red
    exit $LASTEXITCODE
}

# 3) Pull DB schema to verify
Write-Host "=== Pulling DB schema (prisma db pull) ==="
npx prisma db pull --print --schema=prisma/schema.prisma
if ($LASTEXITCODE -ne 0) {
    Write-Host "prisma db pull failed (exit $LASTEXITCODE). Verify connectivity and schema." -ForegroundColor Yellow
    exit $LASTEXITCODE
}

# 4) Generate Prisma client
Write-Host "=== Generating Prisma client ==="
npx prisma generate --schema=prisma/schema.prisma
if ($LASTEXITCODE -ne 0) {
    Write-Host "prisma generate failed (exit $LASTEXITCODE). Redeploy with regenerated client." -ForegroundColor Yellow
    exit $LASTEXITCODE
}

Write-Host "Migrations applied and Prisma client generated successfully. Please trigger a redeploy of the app (Vercel) if not running in CI." -ForegroundColor Green
exit 0
