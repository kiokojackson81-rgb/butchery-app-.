param(
  [Parameter(Mandatory=$true)] [string]$AdminKey,
  [int]$Amount = 50,
  [string]$BaseUrl = 'https://barakafresh.com',
  [int]$MaxSeconds = 300,
  [int]$IntervalSeconds = 5
)

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$u = "$BaseUrl/api/admin/payments/recent"
$headers = @{ 'x-admin-key' = $AdminKey }

Write-Host ("Watching for SUCCESS payment amount KES {0} (any till) for up to {1}s..." -f $Amount, $MaxSeconds)

$start = Get-Date
while ($true) {
  try {
    $res = Invoke-WebRequest -Method GET -Uri $u -Headers $headers -SkipHttpErrorCheck -TimeoutSec 30
    if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
      try {
        $json = $res.Content | ConvertFrom-Json
        $items = @()
        if ($json -and $json.data -and $json.data.items) { $items = $json.data.items }
        $hit = $items | Where-Object { $_.amount -eq $Amount -and $_.status -eq 'SUCCESS' } | Select-Object -First 1
        if ($hit) {
          Write-Host "Hit: $(($hit | ConvertTo-Json -Depth 8))"
          [console]::beep(1000,200) | Out-Null
          break
        } else {
          Write-Host ("No match yet at {0:HH:mm:ss}. Last item: {1} KES, status {2}, code {3}" -f (Get-Date), ($items[0].amount), ($items[0].status), ($items[0].businessShortCode))
        }
      } catch {
        Write-Host $res.Content
      }
    } else {
      Write-Host ("Status: {0}" -f $res.StatusCode)
      Write-Host $res.Content
    }
  } catch {
    $_ | Out-String | Write-Host
  }

  if (((Get-Date) - $start).TotalSeconds -ge $MaxSeconds) { Write-Host "Timed out waiting for KES $Amount payment."; exit 2 }
  Start-Sleep -Seconds $IntervalSeconds
}

exit 0
