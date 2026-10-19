# Sync the job-analysis skill from this repo into nanobot's live workspace.
#
# The skill file here is the source of truth. nanobot only reads from
# ~/.nanobot/workspace/skills/, so run this after every edit.
$ErrorActionPreference = "Stop"

$src = Join-Path $PSScriptRoot "..\skills\job-analysis\SKILL.md"
$dstDir = Join-Path $env:USERPROFILE ".nanobot\workspace\skills\job-analysis"

New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
Copy-Item $src $dstDir -Force

Write-Host "Installed job-analysis skill -> $dstDir" -ForegroundColor Green
