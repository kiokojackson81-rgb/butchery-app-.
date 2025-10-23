<#
Production migration helper (PowerShell)

Usage (interactive): set env vars and run from project root:

# Set these in the environment before running (required):
# $env:ALLOW_PROD_MIGRATE = 'true'        # safety gate
# $env:DATABASE_URL = '<production-database-url>'
# $env:ADMIN_CHECK_SECRET = '<your-admin-check-secret>'

# Run:
# pwsh ./scripts/prod-migrate.ps1

# This script will:
#  - refuse to run unless ALLOW_PROD_MIGRATE is 'true'
#  - take a pg_dump backup file (requires pg_dump on PATH)
#  - run `npx prisma migrate deploy`
#  - print next steps for verification
#
# WARNING: Run only in maintenance windows and ensure backups are tested.
#> 

if ($env:ALLOW_PROD_MIGRATE -ne 'true') {
  Write-Host "Refusing to run: set ALLOW_PROD_MIGRATE='true' to allow production migrate." -ForegroundColor Red
  exit 1
}

if (-not $env:DATABASE_URL) {
  Write-Host "DATABASE_URL must be set (production DB)." -ForegroundColor Red
  exit 1
}

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  Write-Host "pg_dump not found on PATH. Install PostgreSQL client tools or run backup elsewhere first." -ForegroundColor Yellow
  Write-Host "Continuing without pg_dump. BE CAREFUL." -ForegroundColor Red
  $doBackup = $false
} else { $doBackup = $true }

$timestamp = (Get-Date).ToString('yyyyMMdd_HHmm')
$backupFile = "backup_prod_$timestamp.dump"

if ($doBackup) {
  Write-Host "Taking pg_dump backup to $backupFile ..."
  try {
    pg_dump $env:DATABASE_URL -F c -b -v -f $backupFile
    Write-Host "Backup created: $backupFile"
  } catch {
    Write-Host "pg_dump failed: $_" -ForegroundColor Red
    Write-Host "Aborting migration." -ForegroundColor Red
    exit 1
  }
}

Write-Host "Applying Prisma migrations (npx prisma migrate deploy) against production DB..." -ForegroundColor Yellow
try {
  # Use the local node to run migrate deploy
  npm exec --yes prisma migrate deploy --schema=prisma/schema.prisma
  Write-Host "Migrations applied. Verify app and logs." -ForegroundColor Green
} catch {
  Write-Host "Prisma migrate deploy failed: $_" -ForegroundColor Red
  Write-Host "You can restore backup with pg_restore if needed." -ForegroundColor Yellow
  exit 1
}

Write-Host "Done. Next: verify tables exist (psql) and test /api/auth/login." -ForegroundColor Green
