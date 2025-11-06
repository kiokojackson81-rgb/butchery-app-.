param(
  [Parameter(Mandatory=$true)] [string]$AdminKey,
  [Parameter(Mandatory=$true)] [int]$Amount,
  [string]$Outlet,
  [string]$BaseUrl = 'https://barakafresh.com',
  [int]$TimeoutSec = 180,
  [int]$IntervalSec = 5
)

$ErrorActionPreference = 'SilentlyContinue'
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$u = "$BaseUrl/api/admin/payments/recent"
$headers = @{ 'x-admin-key' = $AdminKey }

Write-Host ("Watching for payment amount={0} outlet={1} (timeout {2}s)" -f $Amount, ($Outlet ?? '<any>'), $TimeoutSec)

while ((Get-Date) -lt $deadline) {
  try {
    $res = Invoke-WebRequest -Method GET -Uri $u -Headers $headers -SkipHttpErrorCheck
    if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
      $json = $res.Content | ConvertFrom-Json
      $items = @($json.data.items)
      if ($null -ne $items) {
        $match = $items | Where-Object { $_.amount -eq $Amount -and ([string]::IsNullOrEmpty($Outlet) -or $_.outlet -eq $Outlet) }
        if ($match -and $match.Count -gt 0) {
          Write-Host "\nMatch found:" -ForegroundColor Green
          $match | ConvertTo-Json -Depth 8
          exit 0
        }
      }
    } else {
      Write-Host ("Status: {0}" -f $res.StatusCode)
      Write-Host $res.Content
    }
  } catch {}
  Start-Sleep -Seconds $IntervalSec
}

Write-Host "\nNo matching payment observed within timeout." -ForegroundColor Yellow
exit 1
