# Shared helpers for the Windows scripts (dot-sourced). Works in Windows PowerShell 5.1 and PowerShell 7.
# 'Continue': in Windows PowerShell 5.1, 'Stop' turns any stderr line from n8n/npm/python into a crash.
# Every step checks $LASTEXITCODE or uses -ErrorAction Stop inside try/catch instead.
$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
$N8nUrl = 'http://127.0.0.1:5678'

function Say($msg)  { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }
function Fail($msg) {
    Write-Host "`nERROR: $msg" -ForegroundColor Red
    Read-Host "`nPress Enter to close"
    exit 1
}

function Find-Cmd([string[]]$names) {
    foreach ($n in $names) {
        $c = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c) { return $c.Source }
    }
    return $null
}

function Find-Python {
    foreach ($n in @('python', 'py', 'python3')) {
        $c = Find-Cmd @($n)
        if ($c) {   # the Microsoft Store placeholder fails the version check below
            $v = & $c --version 2>&1
            if ($LASTEXITCODE -eq 0 -and "$v" -match 'Python 3\.(\d+)') {
                if ([int]$Matches[1] -ge 10) { return $c }
            }
        }
    }
    return $null
}

function Find-N8n { return (Find-Cmd @('n8n.cmd', 'n8n')) }

function N8n-Running {
    try { $r = Invoke-WebRequest -Uri "$N8nUrl/healthz" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; return ($r.StatusCode -eq 200) }
    catch { return $false }
}

function Read-Secret([string]$prompt) {
    $s = Read-Host $prompt -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$WorkflowIds = @('socWf0Setup00001', 'socWf1Triage0001', 'socSw1LlmAgent01', 'socWf2Decision01', 'socWf3ReadApi001', 'socWf4ErrorHdl01')
