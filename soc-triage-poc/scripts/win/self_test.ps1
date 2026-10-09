# Pipeline self-test with the mock models (no API key or internet needed). Needs 2_START.bat running.
. (Join-Path $PSScriptRoot 'common.ps1')
$py = Find-Python
if (-not (N8n-Running)) { Fail "n8n is not running. Start it with 2_START.bat first." }
$env:N8N_BASE_URL = $N8nUrl
Say "Five alerts with the mock model (expect 5 x PASS)"
& $py (Join-Path $Root 'tests\e2e_n8n.py') --base $N8nUrl --model mock-model
$a = $LASTEXITCODE
Say "Human-decision rules (expect 12/12)"
& $py (Join-Path $Root 'tests\e2e_decisions.py')
$b = $LASTEXITCODE
Say "Guardrail demo: invented evidence ID (expect EXCEPTION_MANUAL_QUEUE at output_guardrail; 'FAIL' label is expected here)"
& $py (Join-Path $Root 'tests\e2e_n8n.py') ALRT-3001 --base $N8nUrl --model mock-halluc
if ($a -eq 0 -and $b -eq 0) { Write-Host "`nSelf-test passed." -ForegroundColor Green } else { Write-Host "`nSelf-test found problems (see above)." -ForegroundColor Red }
Read-Host "`nPress Enter to close"
