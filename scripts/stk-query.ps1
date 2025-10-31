param(
  [Parameter(Mandatory=$true)] [string]$ConsumerKey,
  [Parameter(Mandatory=$true)] [string]$ConsumerSecret,
  [Parameter(Mandatory=$true)] [string]$BusinessShortCode,
  [Parameter(Mandatory=$true)] [string]$CheckoutRequestID,
  [Parameter(Mandatory=$true)] [string]$Passkey,
  [string]$BaseUrl = 'https://api.safaricom.co.ke'
)

function Get-TimeStamp {
  $now = [DateTime]::UtcNow
  return $now.ToString('yyyyMMddHHmmss')
}
function New-Password {
  param([string]$ShortCode,[string]$Passkey,[string]$Timestamp)
  $raw = "$ShortCode$Passkey$Timestamp"
  [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($raw))
}

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$pair  = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$ConsumerKey`:$ConsumerSecret"))
$tokRes = Invoke-WebRequest -Uri "$BaseUrl/oauth/v1/generate?grant_type=client_credentials" -Headers @{ Authorization = "Basic $pair" } -Method GET -ErrorAction Stop
Write-Host ("OAuth status: {0}  x-request-id: {1}" -f $tokRes.StatusCode, $tokRes.Headers['x-request-id'])
$token = ($tokRes.Content | ConvertFrom-Json).access_token
if (-not $token) { throw "No access_token issued." }
$auth = @{ Authorization = "Bearer $token"; 'Content-Type'='application/json' }

$ts = Get-TimeStamp
$stkPassword = New-Password -ShortCode $BusinessShortCode -Passkey $Passkey -Timestamp $ts
$body = @{
  BusinessShortCode = $BusinessShortCode
  Password          = $stkPassword
  Timestamp         = $ts
  CheckoutRequestID = $CheckoutRequestID
} | ConvertTo-Json -Compress

try {
  # Use -SkipHttpErrorCheck so we can inspect the body even on non-2xx (Core returns HttpResponseMessage)
  $q = Invoke-WebRequest -Method POST -Uri "$BaseUrl/mpesa/stkpushquery/v1/query" -Headers $auth -Body $body -SkipHttpErrorCheck
  Write-Host ("Query status: {0}  x-request-id: {1}" -f $q.StatusCode, $q.Headers['x-request-id'])
  if ($q.Content) { $q.Content | Write-Host }
  if ($q.StatusCode -ge 200 -and $q.StatusCode -lt 300) { exit 0 } else { exit 2 }
} catch {
  Write-Host "Query request failed before response:" -ForegroundColor Red
  $_ | Out-String | Write-Host
  exit 1
}
