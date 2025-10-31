param(
  [Parameter(Mandatory=$true)] [string]$ConsumerKey,
  [Parameter(Mandatory=$true)] [string]$ConsumerSecret,
  [Parameter(Mandatory=$true)] [string]$ShortCode,
  [Parameter(Mandatory=$true)] [string]$ConfirmUrl,
  [Parameter(Mandatory=$true)] [string]$ValidateUrl
)

# Wrapper that targets sandbox base URL
& "$PSScriptRoot/register-c2b.ps1" `
  -ConsumerKey $ConsumerKey `
  -ConsumerSecret $ConsumerSecret `
  -ShortCode $ShortCode `
  -ConfirmUrl $ConfirmUrl `
  -ValidateUrl $ValidateUrl `
  -BaseUrl 'https://sandbox.safaricom.co.ke'
