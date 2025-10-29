param(
  [Parameter(Mandatory=$true)] [string]$ConsumerKey,
  [Parameter(Mandatory=$true)] [string]$ConsumerSecret,
  [Parameter(Mandatory=$true)] [string]$ShortCode,
  [Parameter(Mandatory=$true)] [string]$ConfirmUrl,
  [Parameter(Mandatory=$true)] [string]$ValidateUrl,
  [string]$BaseUrl = 'https://api.safaricom.co.ke'
)

# Force TLS 1.2 for older hosts
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Write-Host "== Daraja PROD Register C2B (HO=$ShortCode) =="

# OAuth
$pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($ConsumerKey):$($ConsumerSecret)"))

# PowerShell 7+: use -SkipHttpErrorCheck to always get a response
try {
  $tokRes = Invoke-WebRequest -Uri "$BaseUrl/oauth/v1/generate?grant_type=client_credentials" `
    -Headers @{ Authorization = "Basic $pair" } -Method GET -SkipHttpErrorCheck
} catch {
  Write-Host "OAuth request failed before response: $_" -ForegroundColor Red
  exit 1
}

$tokStatus = $tokRes.StatusCode
$tokXid = $tokRes.Headers['x-request-id']
Write-Host ("OAuth status: {0}  x-request-id: {1}" -f $tokStatus, $tokXid)

$token = $null
try { $token = ($tokRes.Content | ConvertFrom-Json).access_token } catch {}
if (-not $token) {
  Write-Host "No access_token issued. Body:" -ForegroundColor Red
  Write-Host ($tokRes.Content)
  exit 2
}

$hdrs = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
$bodyObj = @{ ShortCode = $ShortCode; ResponseType = 'Completed'; ConfirmationURL = $ConfirmUrl; ValidationURL = $ValidateUrl }
$body = $bodyObj | ConvertTo-Json -Compress

function Invoke-Register([string]$url) {
  Write-Host "Attempting: $url"
  try {
    $res = Invoke-WebRequest -Method POST -Uri $url -Headers $hdrs -Body $body -SkipHttpErrorCheck
  } catch {
    Write-Host "Register request failed before response: $_" -ForegroundColor Red
    return $null
  }
  $xid = $res.Headers['x-request-id']
  Write-Host ("Register status: {0}  x-request-id: {1}" -f $res.StatusCode, $xid)
  Write-Host "Response body:"; Write-Host $res.Content
  return $res
}

# Prefer v2, then v1
$resV2 = Invoke-Register "$BaseUrl/mpesa/c2b/v2/registerurl"
if ($resV2 -and ($resV2.StatusCode -ge 200) -and ($resV2.StatusCode -lt 300)) { exit 0 }

$resV1 = Invoke-Register "$BaseUrl/mpesa/c2b/v1/registerurl"
if ($resV1 -and ($resV1.StatusCode -ge 200) -and ($resV1.StatusCode -lt 300)) { exit 0 }

# Non-2xx; exit non-zero for CI visibility
exit 3
