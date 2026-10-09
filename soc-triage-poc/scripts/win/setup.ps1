# One-time setup (re-run after changing config\soc_config.json). No Docker, no Ollama.
. (Join-Path $PSScriptRoot 'common.ps1')
Write-Host "SOC Agentic Triage PoC - setup" -ForegroundColor White

Say "1/6 Checking Node.js (needs 24 or newer)"
$node = Find-Cmd @('node')
if (-not $node) { Fail "Node.js not found. Install Node.js 24 LTS from https://nodejs.org, then close this window and run 1_SETUP.bat again." }
$nv = (& $node --version).Trim().TrimStart('v')
if ([int]($nv.Split('.')[0]) -lt 24) { Fail "Node.js $nv found, but n8n 2.41.3 needs version 24 or newer. Install Node.js 24 LTS from https://nodejs.org." }
Ok "Node.js $nv"

Say "2/6 Checking Python (needs 3.10 or newer)"
$py = Find-Python
if (-not $py) { Fail "Python 3.10+ not found. Install it from https://python.org (tick 'Add python.exe to PATH'), then run 1_SETUP.bat again." }
Ok (& $py --version 2>&1)

Say "3/6 Installing Python libraries (streamlit, requests, pandas, flask)"
& $py -m pip install --disable-pip-version-check --quiet -r (Join-Path $Root 'ui\requirements.txt') flask
if ($LASTEXITCODE -ne 0) { Fail "pip could not install the libraries. Check your internet connection and run again." }
Ok "Python libraries installed"

Say "4/6 Installing n8n 2.41.3 (first time takes 5-10 minutes; warnings are normal)"
$n8n = Find-N8n
$have = ''
if ($n8n) { $have = "$(& $n8n --version)".Trim() }
if ($have -match '^2\.41\.3') { Ok "n8n $have already installed" }
else {
    $npm = Find-Cmd @('npm.cmd', 'npm')
    if (-not $npm) { Fail "npm not found. Reinstall Node.js 24 LTS from https://nodejs.org." }
    & $npm install -g n8n@2.41.3 --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { Fail "n8n installation failed. Send the error lines above (those with ERR!) for help." }
    $prefix = (& $npm prefix -g).Trim()
    $n8n = Find-N8n
    if (-not $n8n) { foreach ($p in @((Join-Path $prefix 'n8n.cmd'), (Join-Path $prefix 'bin/n8n'))) { if (Test-Path $p) { $n8n = $p } } }
    if (-not $n8n) { Fail "n8n installed but its command was not found. Close this window, open a new one and run 1_SETUP.bat again." }
    Ok "n8n $("$(& $n8n --version)".Trim()) installed"
}

if (N8n-Running) { Fail "n8n is already running. Close the 'SOC n8n server' window first, then run 1_SETUP.bat again." }

Say "5/6 Building workflows from config\soc_config.json"
& $node (Join-Path $Root 'tools\build_workflows.js')
if ($LASTEXITCODE -ne 0) { Fail "Workflow build failed (see message above). Usually a typing error in config\soc_config.json." }

Say "6/6 Importing and publishing workflows into n8n"
$env:N8N_DIAGNOSTICS_ENABLED = 'false'
& $n8n import:workflow --separate "--input=$(Join-Path $Root 'n8n\workflows')"
if ($LASTEXITCODE -ne 0) { Fail "Workflow import failed (see message above)." }
foreach ($id in $WorkflowIds) {
    $null = & $n8n publish:workflow "--id=$id"
    if ($LASTEXITCODE -ne 0) { Fail "Could not publish workflow $id." }
}
Ok "7 workflows imported, 6 published"

Write-Host "`nSetup complete. Next: double-click 2_START.bat" -ForegroundColor Green
Read-Host "`nPress Enter to close"
