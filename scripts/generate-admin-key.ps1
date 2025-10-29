param(
  [int]$Bytes = 32,
  [switch]$SetForSession,
  [switch]$SetForUser
)

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# Generate cryptographically-strong random bytes and Base64URL-encode them
$buf = New-Object byte[] $Bytes
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
$b64 = [Convert]::ToBase64String($buf)
$b64Url = $b64.TrimEnd('=') -replace '\+','-' -replace '/','_'

if ($SetForSession) {
  $env:ADMIN_API_KEY = $b64Url
}
if ($SetForUser) {
  [System.Environment]::SetEnvironmentVariable('ADMIN_API_KEY', $b64Url, 'User')
}

Write-Host 'ADMIN_API_KEY:' $b64Url
if ($SetForSession) { Write-Host 'Set ADMIN_API_KEY for current session.' }
if ($SetForUser) { Write-Host 'Persisted ADMIN_API_KEY at User scope. Restart terminals to take effect.' }
