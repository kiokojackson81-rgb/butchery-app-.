param(
  [Parameter(Mandatory=$true)] [string]$ConsumerKey,
  [Parameter(Mandatory=$true)] [string]$ConsumerSecret,
  [Parameter(Mandatory=$true)] [string]$BusinessShortCode, # e.g. 3574813 (PayBill) or 3574877 (BuyGoods)
  [Parameter(Mandatory=$true)] [int]$Amount,
  [Parameter(Mandatory=$true)] [string]$PhoneNumber,        # e.g. 2547XXXXXXXX
  [string]$TransactionType = 'CustomerBuyGoodsOnline',      # or 'CustomerPayBillOnline'
  [string]$AccountReference = 'BUTCHERY',
  [string]$TransactionDesc = 'Payment',
  [Parameter(Mandatory=$true)] [string]$Passkey,            # Passkey matched to BusinessShortCode
  [string]$BaseUrl = 'https://api.safaricom.co.ke',
  [string]$PublicBase = 'https://barakafresh.com'
)

# Compute timestamp and password
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

# OAuth
$pair  = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$ConsumerKey`:$ConsumerSecret"))
$tokRes = Invoke-WebRequest -Uri "$BaseUrl/oauth/v1/generate?grant_type=client_credentials" -Headers @{ Authorization = "Basic $pair" } -Method GET -ErrorAction Stop
Write-Host ("OAuth status: {0}  x-request-id: {1}" -f $tokRes.StatusCode, $tokRes.Headers['x-request-id'])
$token = ($tokRes.Content | ConvertFrom-Json).access_token
if (-not $token) { throw "No access_token issued." }
$auth = @{ Authorization = "Bearer $token"; 'Content-Type'='application/json' }

# STK push
$ts = Get-TimeStamp
$stkPassword = New-Password -ShortCode $BusinessShortCode -Passkey $Passkey -Timestamp $ts
$body = @{
  BusinessShortCode = $BusinessShortCode
  Password          = $stkPassword
  Timestamp         = $ts
  TransactionType   = $TransactionType
  Amount            = [int]$Amount
  PartyA            = $PhoneNumber
  PartyB            = $BusinessShortCode
  PhoneNumber       = $PhoneNumber
  CallBackURL       = "$PublicBase/api/mpesa/stk-callback"
  AccountReference  = $AccountReference
  TransactionDesc   = $TransactionDesc
} | ConvertTo-Json -Compress

try {
  $stk = Invoke-WebRequest -Method POST -Uri "$BaseUrl/mpesa/stkpush/v1/processrequest" -Headers $auth -Body $body -ErrorAction Stop
  Write-Host ("STK status: {0}  x-request-id: {1}" -f $stk.StatusCode, $stk.Headers['x-request-id'])
  $stk.Content | Write-Host
} catch {
  if ($_.Exception.Response) {
    $resp = $_.Exception.Response
    Write-Host ("STK error status: {0}  x-request-id: {1}" -f $resp.StatusCode, $resp.Headers['x-request-id'])
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $raw = $sr.ReadToEnd(); $sr.Close(); Write-Host $raw
  } else { $_ | Out-String | Write-Host }
  exit 1
}
