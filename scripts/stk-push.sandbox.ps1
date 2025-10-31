param(
  [Parameter(Mandatory=$true)] [string]$ConsumerKey,
  [Parameter(Mandatory=$true)] [string]$ConsumerSecret,
  [Parameter(Mandatory=$true)] [string]$BusinessShortCode, # e.g. 174379 on sandbox
  [Parameter(Mandatory=$true)] [int]$Amount,
  [Parameter(Mandatory=$true)] [string]$PhoneNumber,
  [string]$TransactionType = 'CustomerPayBillOnline',
  [string]$AccountReference = 'BUTCHERY',
  [string]$TransactionDesc = 'Payment',
  [Parameter(Mandatory=$true)] [string]$Passkey,           # sandbox passkey for the shortcode
  [string]$PublicBase = 'https://barakafresh.com'
)

# Wrapper that targets sandbox base URL
& "$PSScriptRoot/stk-push.ps1" `
  -ConsumerKey $ConsumerKey `
  -ConsumerSecret $ConsumerSecret `
  -BusinessShortCode $BusinessShortCode `
  -Amount $Amount `
  -PhoneNumber $PhoneNumber `
  -TransactionType $TransactionType `
  -AccountReference $AccountReference `
  -TransactionDesc $TransactionDesc `
  -Passkey $Passkey `
  -BaseUrl 'https://sandbox.safaricom.co.ke' `
  -PublicBase $PublicBase
