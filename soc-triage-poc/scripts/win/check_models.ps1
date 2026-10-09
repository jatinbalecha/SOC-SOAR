# Compares the models in config\soc_config.json with what your API key can actually use today.
. (Join-Path $PSScriptRoot 'common.ps1')
$cfg = Get-Content (Join-Path $Root 'config\soc_config.json') -Raw -ErrorAction Stop | ConvertFrom-Json
if (-not $env:SOC_LLM_API_KEY) { $env:SOC_LLM_API_KEY = (Read-Secret "Paste your Groq API key (hidden, not saved)").Trim() }

Say "Models your Groq key can use right now"
try {
    $groq = Invoke-RestMethod -Uri 'https://api.groq.com/openai/v1/models' -Headers @{ Authorization = "Bearer $env:SOC_LLM_API_KEY" } -TimeoutSec 30 -ErrorAction Stop
} catch { Fail "Groq refused the request ($($_.Exception.Message)). Check the key at https://console.groq.com/keys" }
$groqIds = @($groq.data | ForEach-Object { $_.id })
$groqIds | Where-Object { $_ -notmatch 'whisper|orpheus|guard|tts' } | Sort-Object | ForEach-Object { Write-Host "   $_" }

$orIds = @()
if ($cfg.models | Where-Object { "$($_.base_url)" -match 'openrouter' }) {
    try { $orIds = @((Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/models' -TimeoutSec 30 -ErrorAction Stop).data | ForEach-Object { $_.id }) }
    catch { Warn "Could not reach OpenRouter to check its model list" }
}

Say "Models in config\soc_config.json"
$bad = 0
foreach ($m in $cfg.models) {
    if ($m.id.StartsWith('mock-')) { continue }
    $isOr = "$($m.base_url)" -match 'openrouter'
    $found = if ($isOr) { $orIds -contains $m.id } else { $groqIds -contains $m.id }
    $where = if ($isOr) { 'OpenRouter' } else { 'Groq' }
    if ($found) { Ok "$($m.id)  ($where)" }
    elseif ($isOr -and $orIds.Count -eq 0) { Warn "$($m.id)  (OpenRouter, not checked)" }
    else { Write-Host "   XX  $($m.id)  ($where) NOT AVAILABLE" -ForegroundColor Red; $bad++ }
}
if ($bad -gt 0) {
    Write-Host "`nReplace each NOT AVAILABLE id in config\soc_config.json with one from the list above," -ForegroundColor Yellow
    Write-Host "then close the n8n window and run 1_SETUP.bat again." -ForegroundColor Yellow
} else { Write-Host "`nAll configured models are available." -ForegroundColor Green }
Read-Host "`nPress Enter to close"
