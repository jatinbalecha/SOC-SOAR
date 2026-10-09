# Starts the mock server, n8n and the Streamlit UI, each in its own window.
. (Join-Path $PSScriptRoot 'common.ps1')
Write-Host "SOC Agentic Triage PoC - start" -ForegroundColor White

$py = Find-Python; $n8n = Find-N8n
if (-not $py -or -not $n8n) { Fail "Python or n8n not found. Run 1_SETUP.bat first." }
if (N8n-Running) { Fail "n8n is already running. Close the 'SOC n8n server' window (or restart the laptop), then run 2_START.bat again." }

$cfg = Get-Content (Join-Path $Root 'config\soc_config.json') -Raw -ErrorAction Stop | ConvertFrom-Json
$hosted = @($cfg.models | Where-Object { -not $_.id.StartsWith('mock-') -and ($_.provider -eq 'openai_compat' -or $cfg.llm.provider -eq 'openai_compat') })

Say "API keys (typed input is hidden and is NOT saved anywhere)"
if ($hosted.Count -gt 0) {
    if ($env:SOC_LLM_API_KEY) { Ok "SOC_LLM_API_KEY already set in this window" }
    else {
        $k = Read-Secret "Paste your Groq API key (starts with gsk_), or just press Enter to use only the mock models"
        if ($k) { $env:SOC_LLM_API_KEY = $k.Trim(); Ok "Groq key set for this session" } else { Warn "No Groq key: only the 'Mock' models will work" }
    }
    if ($hosted | Where-Object { $_.api_key_env -eq 'OPENROUTER_API_KEY' }) {
        if (-not $env:OPENROUTER_API_KEY) {
            $k2 = Read-Secret "Optional: paste an OpenRouter key for the Llama model, or press Enter to skip"
            if ($k2) { $env:OPENROUTER_API_KEY = $k2.Trim(); Ok "OpenRouter key set for this session" }
        }
    }
}

# settings inherited by the windows started below
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false'   # lets the workflow read the API key from the environment
$env:N8N_LISTEN_ADDRESS = '127.0.0.1'        # only this laptop can reach n8n and its webhooks
$env:N8N_DIAGNOSTICS_ENABLED = 'false'
$env:N8N_PERSONALIZATION_ENABLED = 'false'
$env:MOCK_HOST = '127.0.0.1'
$env:N8N_BASE_URL = $N8nUrl
$env:SOC_N8N_CMD = $n8n
$env:SOC_PYTHON = $py

Say "Starting mock model server (for rehearsal and guardrail demos)"
Start-Process -FilePath (Join-Path $PSScriptRoot 'run_mock.cmd') -WorkingDirectory $Root -WindowStyle Minimized
Ok "started (minimised window)"

Say "Starting n8n (first start can take 1-3 minutes)"
Start-Process -FilePath (Join-Path $PSScriptRoot 'run_n8n.cmd') -WorkingDirectory $Root
$up = $false
for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Seconds 3; Write-Host -NoNewline '.'; if (N8n-Running) { $up = $true; break } }
Write-Host ''
if (-not $up) { Fail "n8n did not start within 4.5 minutes. Look at the 'SOC n8n server' window for the error." }
Ok "n8n is running at http://localhost:5678"

Say "Creating data tables (safe to repeat)"
# n8n answers its health check before it has finished activating the published workflows,
# so the webhooks can return 404 for up to a minute or two after start-up: keep retrying.
$ready = $false; $lastErr = ''
for ($i = 0; $i -lt 40; $i++) {
    try {
        Invoke-RestMethod -Method Post -Uri "$N8nUrl/webhook/soc-setup" -TimeoutSec 60 -ErrorAction Stop | Out-Null
        $ping = Invoke-RestMethod -Uri "$N8nUrl/webhook/soc-read?resource=ping" -TimeoutSec 30 -ErrorAction Stop
        if ($ping.ok) { $ready = $true; break }
    } catch { $lastErr = $_.Exception.Message }
    Write-Host -NoNewline '.'; Start-Sleep -Seconds 5
}
Write-Host ''
if (-not $ready) { Fail "n8n is running but the workflows did not answer after 3 minutes ($lastErr). Close the n8n window, run 1_SETUP.bat again, then 2_START.bat." }
Ok "tables ready, read API answering"

Say "Starting the Streamlit console"
Start-Process -FilePath (Join-Path $PSScriptRoot 'run_ui.cmd') -WorkingDirectory (Join-Path $Root 'ui')
Start-Sleep -Seconds 6
Start-Process 'http://localhost:8501'
Ok "console opening at http://localhost:8501"

Write-Host "`nAll running. Keep the 'SOC n8n server' and 'SOC Streamlit UI' windows open while you work." -ForegroundColor Green
Write-Host "n8n editor (for screenshots): http://localhost:5678  - create the owner account on first visit."
Write-Host "To stop: close those windows."
Read-Host "`nPress Enter to close this window"
