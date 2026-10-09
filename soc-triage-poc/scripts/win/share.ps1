# Shares the console on the internet through a free Cloudflare quick tunnel (no account needed).
# Only a password-protected copy of the console is exposed; n8n stays private on this laptop.
. (Join-Path $PSScriptRoot 'common.ps1')
Write-Host "SOC Agentic Triage PoC - share online" -ForegroundColor White

function Stop-Quiet($p) { try { if ($p -and -not $p.HasExited) { $p.Kill() } } catch {} }
$py = Find-Python
if (-not $py) { Fail "Python not found. Run 1_SETUP.bat first." }
if (-not (N8n-Running)) { Fail "n8n is not running. Start it with 2_START.bat first, then run 3_SHARE_ONLINE.bat." }

Say "1/4 Getting Cloudflare's tunnel tool (cloudflared)"
$cf = Find-Cmd @('cloudflared.exe', 'cloudflared')
if (-not $cf) {
    foreach ($p in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", (Join-Path $Root 'tools\bin\cloudflared.exe'))) {
        if ($p -and (Test-Path $p)) { $cf = $p; break }
    }
}
if (-not $cf) {
    $bin = Join-Path $Root 'tools\bin'
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $cf = Join-Path $bin 'cloudflared.exe'
    Write-Host "   downloading from github.com/cloudflare/cloudflared (about 60 MB)..."
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cf -UseBasicParsing -ErrorAction Stop
    } catch { Fail "Could not download cloudflared ($($_.Exception.Message)). Check the internet connection, or install it with: winget install --id Cloudflare.cloudflared" }
}
Ok "cloudflared ready"

Say "2/4 Choose a password for the online console"
Write-Host "   Anyone with the link must type this password. Share it only with your evaluators."
do {
    $pw = Read-Secret "Password (at least 8 characters, hidden)"
    if ($pw.Length -lt 8) { Warn "Too short, try again." }
} while ($pw.Length -lt 8)
$env:APP_PASSWORD = $pw
$env:N8N_BASE_URL = $N8nUrl
Ok "password set for this sharing session only (not saved)"

Say "3/4 Starting the password-protected console (port 8502)"
$ui = Start-Process -FilePath $py -ArgumentList @('-m', 'streamlit', 'run', 'app.py', '--server.address', '127.0.0.1', '--server.port', '8502', '--server.headless', 'true', '--browser.gatherUsageStats', 'false') `
      -WorkingDirectory (Join-Path $Root 'ui') -WindowStyle Minimized -PassThru
$env:APP_PASSWORD = ''   # do not leave it in this window's environment
if (-not $ui) { Fail "Could not start the protected console." }
$uiUp = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try { Invoke-WebRequest -Uri 'http://127.0.0.1:8502/' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null; $uiUp = $true; break } catch {}
}
if (-not $uiUp) { Stop-Quiet $ui; Fail "The protected console did not start on port 8502 (is another copy already sharing?)." }
Ok "started"

Say "4/4 Opening the public tunnel (takes up to a minute)"
$log = Join-Path $env:TEMP 'soc_cloudflared.log'
$log2 = Join-Path $env:TEMP 'soc_cloudflared.out'
Remove-Item $log, $log2 -ErrorAction SilentlyContinue
$tun = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8502') `
       -RedirectStandardError $log -RedirectStandardOutput $log2 -WindowStyle Hidden -PassThru
if (-not $tun) { Stop-Quiet $ui; Fail "Could not start cloudflared." }
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Seconds 2; Write-Host -NoNewline '.'
    if ($tun.HasExited) { break }
    foreach ($f in @($log, $log2)) {
        if (Test-Path $f) {
            $m = Select-String -Path $f -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($m) { $url = $m.Matches[0].Value; break }
        }
    }
}
Write-Host ''
if (-not $url) {
    Stop-Quiet $tun
    Stop-Quiet $ui
    Fail "The tunnel did not start. Your network (e.g. a college firewall) may block it; try a phone hotspot. Details: $log"
}
try { Set-Clipboard -Value $url } catch {}

Write-Host "`n   Your public console link (copied to the clipboard):" -ForegroundColor Green
Write-Host "`n       $url`n" -ForegroundColor White
Write-Host "   - Works only while this window, the n8n window and the laptop stay on."
Write-Host "   - The link changes every time you share. Send it together with the password."
Write-Host "   - The n8n editor is NOT shared; it stays private on this laptop."
Read-Host "`nPress Enter to STOP sharing"

Stop-Quiet $tun
Stop-Quiet $ui
Write-Host "Sharing stopped. The public link no longer works." -ForegroundColor Yellow
Start-Sleep -Seconds 2
