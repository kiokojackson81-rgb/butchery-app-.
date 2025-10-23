<#
Start a local Postgres instance in Docker for development.

Usage:
  pwsh ./scripts/start-dev-db.ps1

This will:
  - start postgres:15 container named butchery-dev-db
  - map port 5432 -> 5432 (warning: ensure nothing else uses 5432)
  - print a recommended DATABASE_URL to export
#>

$name = 'butchery-dev-db'
$port = 5432
$user = 'postgres'
$password = 'postgres'
$db = 'butchery'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker not found on PATH. Install Docker Desktop or use another Postgres." -ForegroundColor Red
  exit 1
}

try {
  $existing = docker ps -a --format "{{.Names}}" | Select-String $name
  if ($existing) {
    Write-Host "Container $name already exists. Starting it..."
    docker start $name | Out-Null
  } else {
    Write-Host "Creating and starting container $name..."
    docker run --name $name -e POSTGRES_PASSWORD=$password -e POSTGRES_USER=$user -e POSTGRES_DB=$db -p $port:5432 -d postgres:15 | Out-Null
  }
  Write-Host "Container started. Use the following DATABASE_URL in .env.local or your shell:" -ForegroundColor Green
  $dbUrl = "postgresql://${user}:${password}@localhost:${port}/${db}?schema=public"
  Write-Host "DATABASE_URL=$dbUrl"
} catch {
  Write-Host "Failed to start container: $_" -ForegroundColor Red
  exit 1
}
