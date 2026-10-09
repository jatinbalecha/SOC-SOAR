# Model comparison. Needs 2_START.bat running. Extra arguments are passed through, e.g. --models openai/gpt-oss-20b --append
. (Join-Path $PSScriptRoot 'common.ps1')
$py = Find-Python
if (-not $py) { Fail "Python not found. Run 1_SETUP.bat first." }
if (-not (N8n-Running)) { Fail "n8n is not running. Start it with 2_START.bat first (and enter your API key there)." }
Write-Host "Running the benchmark: every non-optional model x 5 alerts x 3 repeats, 30 s pause between runs." -ForegroundColor White
Write-Host "Expect 1-3 hours on free API tiers. Results are saved after every run, so stopping early keeps what is done.`n"
& $py (Join-Path $Root 'benchmark\run_benchmark.py') --base $N8nUrl --repeats 3 --pause 30 @args
Write-Host "`nResults: benchmark\results\  (open the 'Model comparison' page in the console)" -ForegroundColor Green
Read-Host "`nPress Enter to close"
