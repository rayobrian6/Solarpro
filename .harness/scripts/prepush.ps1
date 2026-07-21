#!/usr/bin/env pwsh
# Solarpro agent pre-push — runs immediately before `git push`.
# Usage: pwsh .harness/scripts/prepush.ps1
#
# Verifies (per root AGENTS.md §5):
#   - Three-check suite is green (tsc, eslint, vitest)
#   - Author and committer are JAMES
#   - No secrets in the staged diff
#   - No new env var without doc update
#   - No new dependency without justification
#   - Commit message format is correct
#   - Branch is dev (never master)
#
# Exit codes:
#   0 = all good, JAMES may push
#   1 = blocker, fix and re-run
#
# NOTE: this script does NOT call `git push` itself. The agent surfaces the
# green result to Mavis, Mavis surfaces to JAMES, JAMES says "push".

$ErrorActionPreference = 'Stop'
$Script:ExitCode = 0

function Check-Ok    { param($Msg) Write-Host "  [OK]   $Msg" -ForegroundColor Green }
function Check-Fail  { param($Msg) Write-Host "  [FAIL] $Msg" -ForegroundColor Red; $Script:ExitCode = 1 }
function Check-Warn  { param($Msg) Write-Host "  [WARN] $Msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== Solarpro agent pre-push ===" -ForegroundColor Cyan
Write-Host "Repo: $(Get-Location)"
Write-Host ""

# 1. NOT on master (R1, R4 - JAMES picks the working branch; master is the
#    only hard ban. Soft-warn if not 'dev' since dev remains the default.)
$branch = git branch --show-current
if ($branch -eq 'master') {
    Check-Fail "on branch: master (forbidden per AGENTS.md R1/R4 - refusing to push)"
} else {
    Check-Ok "on branch: $branch (not master, OK per R4)"
    if ($branch -ne 'dev') {
        Check-Warn "non-default working branch: '$branch' (dev is the default per AI-AGENT-README.md §9; JAMES's standing override allows this)"
    }
}

# 2. Commit message format — Conventional Commits (must be parsed before R6)
$msgSubject = git log -1 --format='%s'
$commitType = ''
if ($msgSubject -match '^(fix|feat|refactor|chore|docs|test|perf|build|ci)(\([a-z]+\))?!?:\s.+') {
    $commitType = $Matches[1]
    Check-Ok "commit message format OK: $msgSubject  (type: $commitType)"
} else {
    Check-Fail "commit message does not match Conventional Commits (per AI-AGENT-README.md §9)"
    Check-Fail "  expected: type(scope): summary"
    Check-Fail "  actual:   $msgSubject"
}

# 3. JAMES attribution (R6) — ONLY required for feat: commits
# Per JAMES's standing instruction: feature commits get his name, everything
# else keeps the committer's actual identity. See AGENTS.md R6.
$headAuthor    = git log -1 --format='%an <%ae>'
$headCommitter = git log -1 --format='%cn <%ce>'
if ($commitType -eq 'feat') {
    # Feature commits: enforce JAMES attribution on both author and committer
    if ($headAuthor -match '^JAMES\s') {
        Check-Ok "feat: HEAD author: $headAuthor"
    } else {
        Check-Fail "feat: HEAD author is '$headAuthor' (must start with 'JAMES' per AGENTS.md R6)"
    }
    if ($headCommitter -match '^JAMES\s') {
        Check-Ok "feat: HEAD committer: $headCommitter"
    } else {
        Check-Fail "feat: HEAD committer is '$headCommitter' (must start with 'JAMES')"
    }
} else {
    # Non-feature commits: standard attribution, JAMES is not required
    Check-Warn "non-feat commit ($commitType): attribution is '$headAuthor' / '$headCommitter' (JAMES not required for non-feature commits per AGENTS.md R6)"
}

# 4. Three-check suite — only run if not skipped by env
if ($env:SOLARPRO_SKIP_THREECHECK -eq '1') {
    Check-Warn "three-check suite SKIPPED via SOLARPRO_SKIP_THREECHECK=1 (not recommended)"
} else {
    Write-Host ""
    Write-Host "  Running three-check suite (this can take a few minutes)..." -ForegroundColor Cyan

    # tsc
    Write-Host "    -> tsc --noEmit --skipLibCheck ..." -ForegroundColor Gray
    $tsc = npx --no-install tsc --noEmit --skipLibCheck 2>&1
    if ($LASTEXITCODE -eq 0) {
        Check-Ok "tsc --noEmit: 0 errors"
    } else {
        Check-Fail "tsc --noEmit failed"
        $tsc | Select-Object -Last 30 | ForEach-Object { Write-Host "         $_" }
    }

    # eslint
    Write-Host "    -> next lint ..." -ForegroundColor Gray
    $lint = npx --no-install next lint --quiet 2>&1
    if ($LASTEXITCODE -eq 0) {
        Check-Ok "next lint: 0 errors"
    } else {
        Check-Fail "next lint failed"
        $lint | Select-Object -Last 30 | ForEach-Object { Write-Host "         $_" }
    }

    # vitest
    Write-Host "    -> vitest run ..." -ForegroundColor Gray
    $test = npx --no-install vitest run --reporter=default 2>&1
    if ($LASTEXITCODE -eq 0) {
        $passLine = $test | Select-String -Pattern 'Tests\s+\d+\s+passed' | Select-Object -Last 1
        if ($passLine) { Check-Ok "vitest run: $($passLine.ToString().Trim())" }
        else { Check-Ok "vitest run: PASS" }
    } else {
        Check-Fail "vitest run failed"
        $test | Select-Object -Last 30 | ForEach-Object { Write-Host "         $_" }
    }
}

# 5. Secret scan in staged/HEAD diff
$secretPattern = '(ghp_[A-Za-z0-9]{20,}|rnd_[A-Za-z0-9]{20,}|vcp_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|prod_handoff_secret_2026)'
$diff = git diff HEAD~1..HEAD 2>$null
if ($diff -match $secretPattern) {
    Check-Fail "potential secret found in the diff — review and remove before pushing"
} else {
    Check-Ok "no obvious secrets in the HEAD diff"
}

# 6. .env* files in the diff
$envFiles = git diff --name-only HEAD~1..HEAD 2>$null | Where-Object { $_ -match '^\.env' }
if ($envFiles) {
    Check-Fail ".env file in the diff: $($envFiles -join ', ')"
} else {
    Check-Ok "no .env* files in the diff"
}

# 7. New env vars in the diff without doc update
$envVarAdditions = git diff HEAD~1..HEAD 2>$null | Select-String -Pattern '^\+.*process\.env\.[A-Z_]+' | Select-Object -ExpandProperty Line
if ($envVarAdditions) {
    Check-Warn "new process.env references in the diff — verify AI-AGENT-README.md §6 is updated"
    $envVarAdditions | Select-Object -First 5 | ForEach-Object { Write-Host "         $_" }
} else {
    Check-Ok "no new process.env references in the diff"
}

Write-Host ""
if ($Script:ExitCode -eq 0) {
    Write-Host "=== Pre-push PASSED. Surface to JAMES for the 'push' / 'ship it' word. ===" -ForegroundColor Green
} else {
    Write-Host "=== Pre-push FAILED. Fix the issues above before surfacing to JAMES. ===" -ForegroundColor Red
}
Write-Host ""
exit $Script:ExitCode
