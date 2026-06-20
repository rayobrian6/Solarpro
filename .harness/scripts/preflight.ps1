#!/usr/bin/env pwsh
# Solarpro agent preflight — runs at the start of every task.
# Usage: pwsh .harness/scripts/preflight.ps1
#
# Verifies (per root AGENTS.md §4):
#   - Clean or expected working tree
#   - On a non-master working branch (JAMES picks the branch; master is banned)
#   - JAMES is configured as the git author
#   - AI-AGENT-README.md is present
#   - Remote is the canonical rayobrian6/Solarpro
#
# Exit codes:
#   0 = all good, proceed
#   1 = environment / config issue, fix and re-run

$ErrorActionPreference = 'Stop'
$Script:ExitCode = 0

function Check-Ok    { param($Msg) Write-Host "  [OK]   $Msg" -ForegroundColor Green }
function Check-Fail  { param($Msg) Write-Host "  [FAIL] $Msg" -ForegroundColor Red; $Script:ExitCode = 1 }
function Check-Warn  { param($Msg) Write-Host "  [WARN] $Msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== Solarpro agent preflight ===" -ForegroundColor Cyan
Write-Host "Repo: $(Get-Location)"
Write-Host ""

# 1. Inside a git repo
if (-not (Test-Path .git)) {
    Check-Fail "Not inside a git repository. cd to the Solarpro repo root and retry."
    exit 1
}
Check-Ok "git repository detected"

# 2. Working tree status
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Check-Ok "working tree is clean"
} else {
    Check-Warn "working tree has changes (review before proceeding):"
    git status --short | ForEach-Object { Write-Host "         $_" }
}

# 3. NOT on master (R1 + R4 — JAMES picks the working branch; master is the
#    only hard ban. Soft-warn if not 'dev' since dev remains the default.)
$branch = git branch --show-current
if ($branch -eq 'master') {
    Check-Fail "on branch: master (forbidden per AGENTS.md R1/R4 - master is the production deploy branch)"
} else {
    Check-Ok "on branch: $branch (not master, OK per R4)"
    if ($branch -ne 'dev') {
        Check-Warn "non-default working branch: '$branch' (dev is the default per AI-AGENT-README.md §9; JAMES's standing override allows this)"
    }
}

# 4. JAMES attribution (R6)
$name  = git config --get user.name
$email = git config --get user.email
if ($name -eq 'JAMES') {
    Check-Ok "git user.name = JAMES"
} else {
    Check-Fail "git user.name is '$name' (must be 'JAMES' per AGENTS.md R6)"
    Check-Fail "  fix: see .harness/secrets/james-git.env.template"
}
if ($email -and $email -notmatch 'REPLACE_WITH') {
    Check-Ok "git user.email is set: $email"
} else {
    Check-Fail "git user.email is not set or is a placeholder"
    Check-Fail "  fix: see .harness/secrets/james-git.env.template"
}

# 5. Canonical doc present
if (Test-Path AI-AGENT-README.md) {
    Check-Ok "AI-AGENT-README.md present"
} else {
    Check-Fail "AI-AGENT-README.md missing — read the canonical doc first (per AGENTS.md §1)"
}

# 6. Remote is canonical
$remote = git remote get-url origin 2>$null
if ($remote -match 'github\.com[:/]rayobrian6/Solarpro(\.git)?$') {
    Check-Ok "origin remote is rayobrian6/Solarpro"
} else {
    Check-Fail "origin remote is '$remote' (expected github.com/rayobrian6/Solarpro.git)"
}

# 7. agent rules present
if (Test-Path AGENTS.md) {
    Check-Ok "AGENTS.md present (agent standing rules)"
} else {
    Check-Fail "AGENTS.md missing - agent rules not bootstrapped"
}

# 8. canonical pointer
if (Test-Path docs/CANONICAL_RULES.md) {
    Check-Ok "docs/CANONICAL_RULES.md present (pointer file)"
} else {
    Check-Warn "docs/CANONICAL_RULES.md missing (optional but recommended)"
}

# 9. reins
$expectedReins = @(
    '.harness/reins/solarpro-implementer/AGENT.md',
    '.harness/reins/solarpro-vision/AGENT.md',
    '.harness/reins/solarpro-reviewer/AGENT.md',
    '.harness/reins/solarpro-auditor/AGENT.md'
)
foreach ($r in $expectedReins) {
    if (Test-Path $r) {
        Check-Ok "rein present: $r"
    } else {
        Check-Fail "rein missing: $r"
    }
}

Write-Host ""
if ($Script:ExitCode -eq 0) {
    Write-Host '=== Preflight PASSED. Safe to proceed. ===' -ForegroundColor Green
} else {
    Write-Host '=== Preflight FAILED. Fix the issues above before proceeding. ===' -ForegroundColor Red
    Write-Host '    See AGENTS.md (root) and .harness/ for the rules.' -ForegroundColor Red
}
Write-Host ""
exit $Script:ExitCode
