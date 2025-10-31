param(
  [Parameter(Mandatory=$true)] [string]$AdminKey,
  [Parameter(Mandatory=$true)] [string]$Receipt,
  [Parameter(Mandatory=$true)] [int]$Amount,
  [string]$ShortCode = '',
  [string]$Outlet = '',
  [string]$Msisdn = '',
  [string]$AccountRef = '',
  [string]$When = '',
  [string]$BaseUrl = 'https://barakafresh.com'
)

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$u = "$BaseUrl/api/admin/payments/manual-upsert"
$headers = @{ 'x-admin-key' = $AdminKey; 'Content-Type' = 'application/json' }
$body = @{ receipt = $Receipt; amount = $Amount; shortcode = $ShortCode; outlet = $Outlet; msisdn = $Msisdn; accountRef = $AccountRef; when = $When } | ConvertTo-Json

try {
  $res = Invoke-WebRequest -Method POST -Uri $u -Headers $headers -Body $body -SkipHttpErrorCheck
  Write-Host ("HTTP {0}" -f $res.StatusCode)
  try { ($res.Content | ConvertFrom-Json) | ConvertTo-Json -Depth 8 } catch { Write-Host $res.Content }
} catch {
  $_ | Out-String | Write-Host
  exit 1
}
