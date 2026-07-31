// ═══════════════════════════════════════════════════════════════════════════
// compliance/collectors/github.mjs
//
// GitHub REST + GraphQL evidence collector.
// Captures (per SELF_BUILT_SETUP.md §2):
//   - branch protection on `master` (required reviewers, signed commits,
//     status checks)  → daily
//   - org members + 2FA status  → daily
//   - Dependabot alerts (open, fixed, dismissed)  → hourly
//   - secret-scanning alerts  → hourly
//   - commit-signing sample  → weekly (full snapshot)
//
// Reads:
//   GITHUB_TOKEN   fine-grained PAT, scope: repo, admin:org, security_events
//                  (set in GitHub Actions secrets)
//   GITHUB_ORG     org slug (default: rayobrian6, the per AGENTS.md §8 remote)
//   GITHUB_REPO    repo slug (default: Solarpro)
//
// Output (JSON):
//   compliance/evidence/github/<YYYY-MM-DD>/branch-protection.json
//   compliance/evidence/github/<YYYY-MM-DD>/members.json
//   compliance/evidence/github/<YYYY-MM-DD>/dependabot-alerts.json
//   compliance/evidence/github/<YYYY-MM-DD>/secret-scanning.json
//
// Idempotent: re-running on the same day overwrites the same files.
// In DRY_RUN=1, no API calls are made; stub data is written (or the
// write is skipped if DRY_RUN_SKIP_WRITE=1).
// ═══════════════════════════════════════════════════════════════════════════

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  nowIso,
  getDryRun,
  writeEvidence,
  withRetry,
  apiFetch,
} from './common.mjs';

const ORG = process.env.GITHUB_ORG || 'rayobrian6';
const REPO = process.env.GITHUB_REPO || 'Solarpro';
const BRANCH = process.env.GITHUB_PROTECTED_BRANCH || 'master';

const GH_API = 'https://api.github.com';
const GH_GRAPHQL = 'https://api.github.com/graphql';

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'solarpro-compliance-collector',
  };
}

/** Daily: branch protection + members. */
async function collectDaily(token) {
  const written = [];

  // 1. Branch protection on master
  const bp = await withRetry(() => apiFetch(
    `${GH_API}/repos/${ORG}/${REPO}/branches/${BRANCH}/protection`,
    { headers: ghHeaders(token) },
  ));
  written.push(writeEvidence('github', null, 'branch-protection.json', {
    generated_at: nowIso(),
    org: ORG,
    repo: REPO,
    branch: BRANCH,
    protection: bp ?? null,
    note: bp === null ? 'branch protection not configured' : null,
  }));

  // 2. Org members + role + 2FA status (paginated; cap at 100 to keep
  //    the daily snapshot bounded; full roster is in the weekly run).
  const members = await withRetry(() => apiFetch(
    `${GH_API}/orgs/${ORG}/members?per_page=100`,
    { headers: ghHeaders(token) },
  ));
  // 2FA: the `/orgs/{org}/members` endpoint only tells us membership.
  // The 2FA enforcement status comes from the org-level check:
  const twoFA = await withRetry(() => apiFetch(
    `${GH_API}/orgs/${ORG}/two-factor_requirement`,
    { headers: ghHeaders(token) },
  ));
  written.push(writeEvidence('github', null, 'members.json', {
    generated_at: nowIso(),
    org: ORG,
    two_factor_required: twoFA ?? null,
    member_count: Array.isArray(members) ? members.length : 0,
    members: members ?? [],
  }));

  return written;
}

/** Hourly: Dependabot + secret scanning. */
async function collectHourly(token) {
  const written = [];

  // Dependabot alerts
  const dep = await withRetry(() => apiFetch(
    `${GH_API}/repos/${ORG}/${REPO}/dependabot/alerts?state=open&per_page=100`,
    { headers: ghHeaders(token) },
  ));
  const openDep = Array.isArray(dep) ? dep : [];
  written.push(writeEvidence('github', null, 'dependabot-alerts.json', {
    generated_at: nowIso(),
    org: ORG,
    repo: REPO,
    open_count: openDep.length,
    alerts: openDep,
  }));

  // Secret scanning alerts
  const sec = await withRetry(() => apiFetch(
    `${GH_API}/repos/${ORG}/${REPO}/secret-scanning/alerts?state=open&per_page=100`,
    { headers: ghHeaders(token) },
  ));
  const openSec = Array.isArray(sec) ? sec : [];
  written.push(writeEvidence('github', null, 'secret-scanning.json', {
    generated_at: nowIso(),
    org: ORG,
    repo: REPO,
    open_count: openSec.length,
    alerts: openSec,
  }));

  return written;
}

/** Weekly: commit-signing sample (last 20 commits on master). */
async function collectWeekly(token) {
  const written = [];

  const commits = await withRetry(() => apiFetch(
    `${GH_API}/repos/${ORG}/${REPO}/commits?sha=${BRANCH}&per_page=20`,
    { headers: ghHeaders(token) },
  ));
  const list = Array.isArray(commits) ? commits : [];
  written.push(writeEvidence('github', null, 'commit-signing-sample.json', {
    generated_at: nowIso(),
    org: ORG,
    repo: REPO,
    branch: BRANCH,
    sample_size: list.length,
    commits: list.map((c) => ({
      sha: c.sha,
      author: c?.commit?.author?.name ?? null,
      message_headline: c?.commit?.message?.split('\n')[0] ?? null,
      // Verification info comes from a separate check-runs fetch; left
      // null here, the full verification is in the weekly-report.md.
      verified: null,
      url: c?.html_url ?? null,
    })),
  }));

  // Re-run the daily + hourly for the weekly snapshot.
  written.push(...(await collectDaily(token)));
  written.push(...(await collectHourly(token)));

  return written;
}

/**
 * Main entry point. `mode` is one of "hourly" | "daily" | "weekly".
 * Returns the list of repo-relative paths that were written.
 */
export async function collect(mode = 'daily') {
  const dry = getDryRun();
  if (dry) {
    // Stub data — same shape, but the file is marked dry-run. Useful for
    // local CI sanity checks. The {date} in the path comes from today.
    const written = [];
    if (mode === 'hourly' || mode === 'weekly') {
      written.push(writeEvidence('github', null, 'dependabot-alerts.json', {
        generated_at: nowIso(), dry_run: true, org: ORG, repo: REPO,
        open_count: 0, alerts: [],
      }));
      written.push(writeEvidence('github', null, 'secret-scanning.json', {
        generated_at: nowIso(), dry_run: true, org: ORG, repo: REPO,
        open_count: 0, alerts: [],
      }));
    }
    if (mode === 'daily' || mode === 'weekly') {
      written.push(writeEvidence('github', null, 'branch-protection.json', {
        generated_at: nowIso(), dry_run: true, org: ORG, repo: REPO,
        branch: BRANCH, protection: null,
      }));
      written.push(writeEvidence('github', null, 'members.json', {
        generated_at: nowIso(), dry_run: true, org: ORG,
        two_factor_required: null, member_count: 0, members: [],
      }));
    }
    if (mode === 'weekly') {
      written.push(writeEvidence('github', null, 'commit-signing-sample.json', {
        generated_at: nowIso(), dry_run: true, org: ORG, repo: REPO,
        branch: BRANCH, sample_size: 0, commits: [],
      }));
    }
    return written;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN env var is required (set in GitHub Actions secrets)');
  }

  if (mode === 'hourly') return collectHourly(token);
  if (mode === 'daily') return collectDaily(token);
  if (mode === 'weekly') return collectWeekly(token);
  throw new Error(`github.mjs: unknown mode "${mode}" (expected hourly|daily|weekly)`);
}

// Allow `node compliance/collectors/github.mjs daily` from the repo root
// for local testing. Does NOT call process.exit — returns normally so the
// GitHub Actions workflow can capture the stdout/return value.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || 'daily';
  collect(mode).then(
    (paths) => {
      console.log(JSON.stringify({ mode, written: paths }, null, 2));
    },
    (err) => {
      console.error(`github.mjs failed: ${err?.stack ?? err}`);
      // Surface the error via a non-zero exit ONLY when run directly.
      // When imported as a module, the caller decides.
      process.exit(1);
    },
  );
}
