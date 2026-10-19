# Start the nanobot analysis engine (OpenAI-compatible API on 127.0.0.1:8900).
#
# nanobot runs from its own source checkout with its own venv — it is a
# separate process, not a dependency of the Next.js app.
#
# NOTE: this file must stay UTF-8 *with BOM*. Windows PowerShell 5.1 decodes an
# unmarked .ps1 as the system ANSI codepage, which mangles the non-ASCII
# characters in the default source path (nanobot源码 -> nanobot婧愮爜) and makes
# the venv look missing.
$ErrorActionPreference = "Stop"

# Override when the checkout lives elsewhere:
#   $env:NANOBOT_SOURCE = "C:\path\to\nanobot"; npm run engine
if ($env:NANOBOT_SOURCE) {
    $source = $env:NANOBOT_SOURCE
} else {
    # nano-job-tracker\agent\scripts -> ..\..\.. -> the projects root
    $root = Join-Path $PSScriptRoot "..\..\.."
    # Locate the checkout by its contents rather than by name, so a renamed or
    # non-ASCII directory still resolves.
    $found = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "nanobot\cli\commands.py") } |
        Select-Object -First 1
    if (-not $found) {
        Write-Host "Could not find a nanobot checkout under $root." -ForegroundColor Red
        Write-Host "Set NANOBOT_SOURCE to its path and retry."
        exit 1
    }
    $source = $found.FullName
}

$python = Join-Path $source ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
    Write-Host "No venv found at $python. Create it first:" -ForegroundColor Yellow
    Write-Host "  cd `"$source`""
    Write-Host "  python -m venv .venv"
    Write-Host "  .\.venv\Scripts\python.exe -m pip install -e `".[api]`""
    exit 1
}

Set-Location -LiteralPath $source
Write-Host "Starting nanobot serve on 127.0.0.1:8900 (source: $source)" -ForegroundColor Cyan
& $python -m nanobot serve
