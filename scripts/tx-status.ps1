param(
  [Parameter(Mandatory=$true)] [string]$TransId,
  [string]$Initiator = $env:DARAJA_INITIATOR,
  [string]$SecurityCredential = $env:DARAJA_SECURITY_CREDENTIAL,
  [string]$PartyA = '3574813',
  [int]$IdentifierType = 4,
  [string]$BaseUrl = $env:DARAJA_BASE_URL
)

if (-not $BaseUrl) { $BaseUrl = 'https://api.safaricom.co.ke' }

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Get-AccessToken {
  param([string]$Key = $env:DARAJA_CONSUMER_KEY, [string]$Secret = $env:DARAJA_CONSUMER_SECRET)
  if (-not $Key -or -not $Secret) { throw 'Missing DARAJA_CONSUMER_KEY or DARAJA_CONSUMER_SECRET' }
  $pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$Key`:$Secret"))
  $headers = @{ Authorization = "Basic $pair" }
  $u = "$BaseUrl/oauth/v1/generate?grant_type=client_credentials"
  $r = Invoke-WebRequest -Uri $u -Headers $headers -Method GET -UseBasicParsing
  ($r.Content | ConvertFrom-Json).access_token
}

if (-not $Initiator -or -not $SecurityCredential) { Write-Host 'Missing Initiator or SecurityCredential; set DARAJA_INITIATOR and DARAJA_SECURITY_CREDENTIAL to run this.'; exit 2 }

$token = Get-AccessToken
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

$payload = @{ 
  Initiator = $Initiator;
  SecurityCredential = $SecurityCredential;
  CommandID = 'TransactionStatusQuery';
  TransactionID = $TransId;
  PartyA = $PartyA;
  IdentifierType = $IdentifierType;
  ResultURL = 'https://barakafresh.com/api/mpesa/txstatus/result';
  QueueTimeOutURL = 'https://barakafresh.com/api/mpesa/txstatus/timeout';
  Remarks = 'OK';
  Occasion = 'OK';
} | ConvertTo-Json

$u = "$BaseUrl/mpesa/transactionstatus/v1/query"
try {
  $res = Invoke-WebRequest -Method POST -Uri $u -Headers $headers -Body $payload -SkipHttpErrorCheck
  Write-Host ("HTTP {0}" -f $res.StatusCode)
  $res.Content
} catch {
  $_ | Out-String | Write-Host
  exit 1
}
