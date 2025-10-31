param(
  [Parameter(Mandatory=$true)] [string]$AdminKey,
  [string]$TransId = '',
  [int]$WaitSeconds = 0,
  [string]$BaseUrl = 'https://barakafresh.com'
)

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Get-Once {
  param([string]$Tid)
  $qs = if ($Tid) { "?transId=$([Uri]::EscapeDataString($Tid))" } else { '' }
  $u = "$BaseUrl/api/admin/txstatus/by-transid$qs"
  $headers = @{ 'x-admin-key' = $AdminKey }
  try {
    $res = Invoke-WebRequest -Method GET -Uri $u -Headers $headers -SkipHttpErrorCheck
    if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
      try { return ($res.Content | ConvertFrom-Json) } catch { return $res.Content }
    } else { return $null }
  } catch { return $null }
}

if ($WaitSeconds -le 0) {
  $r = Get-Once -Tid $TransId
  if ($r) { $r | ConvertTo-Json -Depth 12 } else { Write-Host '{"ok":false,"error":"no data"}' }
  exit 0
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  $r = Get-Once -Tid $TransId
  if ($r -and $r.ok -and $r.data -and $r.data.count -gt 0) { $r | ConvertTo-Json -Depth 12; exit 0 }
  Start-Sleep -Seconds 3
}
Write-Host '{"ok":false,"error":"timeout"}'
exit 1
