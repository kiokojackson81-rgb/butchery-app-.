param(
  [Parameter(Mandatory=$true)] [string]$ConsumerKey,
  [Parameter(Mandatory=$true)] [string]$ConsumerSecret,
  [Parameter(Mandatory=$true)] [string]$BusinessShortCode, # e.g. 174379 on sandbox
  [Parameter(Mandatory=$true)] [string]$CheckoutRequestID,
  [Parameter(Mandatory=$true)] [string]$Passkey
)

# Wrapper that targets sandbox base URL
& "$PSScriptRoot/stk-query.ps1" `
  -ConsumerKey $ConsumerKey `
  -ConsumerSecret $ConsumerSecret `
  -BusinessShortCode $BusinessShortCode `
  -CheckoutRequestID $CheckoutRequestID `
  -Passkey $Passkey `
  -BaseUrl 'https://sandbox.safaricom.co.ke'
