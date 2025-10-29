param(
  [Parameter(Mandatory=$true)] [string]$AdminKey,
  [string]$BaseUrl = 'https://barakafresh.com'
)

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$u = "$BaseUrl/api/admin/payments/recent"
$headers = @{ 'x-admin-key' = $AdminKey }

try {
  $res = Invoke-WebRequest -Method GET -Uri $u -Headers $headers -SkipHttpErrorCheck
  if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
    try { ($res.Content | ConvertFrom-Json) | ConvertTo-Json -Depth 8 } catch { Write-Host $res.Content }
  } else {
    Write-Host ("Status: {0}" -f $res.StatusCode)
    Write-Host $res.Content
    exit 1
  }
} catch {
  $_ | Out-String | Write-Host
  exit 1
}
