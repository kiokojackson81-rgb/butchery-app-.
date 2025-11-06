param(
  [Parameter(Mandatory=$true)] [string]$ConsumerKey,
  [Parameter(Mandatory=$true)] [string]$ConsumerSecret,
  [string]$ConfirmUrl = 'https://barakafresh.com/api/daraja/c2b/confirm',
  [string]$ValidateUrl = 'https://barakafresh.com/api/daraja/c2b/validate',
  [string]$BaseUrl = 'https://api.safaricom.co.ke',
  [string[]]$Stores = @('3574841','3574839','3574837','3574835','3574821')
)

# Small helper that invokes the existing single-register script for each store number
$ErrorActionPreference = 'Stop'

Write-Host "== Batch Register C2B (v2) for store numbers ==" -ForegroundColor Cyan
Write-Host "Base: $BaseUrl"
Write-Host ("Stores: {0}" -f ($Stores -join ', '))

$overallOk = $true

foreach ($store in $Stores) {
  Write-Host "\n--- Registering for Store $store ---" -ForegroundColor Yellow
  $cmd = @(
    "-File", (Join-Path $PSScriptRoot 'register-c2b.direct.ps1'),
    "-ConsumerKey", $ConsumerKey,
    "-ConsumerSecret", $ConsumerSecret,
    "-ShortCode", $store,
    "-ConfirmUrl", $ConfirmUrl,
    "-ValidateUrl", $ValidateUrl,
    "-BaseUrl", $BaseUrl
  )
  try {
    pwsh -NoProfile @cmd
    if ($LASTEXITCODE -ne 0) { $overallOk = $false }
  } catch {
    Write-Host ("Failed to invoke register for {0}: {1}" -f $store, $_) -ForegroundColor Red
    $overallOk = $false
  }
}

if ($overallOk) {
  Write-Host "\nAll store registrations attempted. Check above for per-store statuses." -ForegroundColor Green
  exit 0
} else {
  Write-Host "\nOne or more store registrations failed. Review logs above." -ForegroundColor Red
  exit 1
}
