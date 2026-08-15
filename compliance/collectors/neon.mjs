// ═══════════════════════════════════════════════════════════════════════════
// compliance/collectors/neon.mjs
//
// Neon REST v1 evidence collector. Captures (per SELF_BUILT_SETUP.md §2):
//   - project info
//   - branch list
//   - role grants (who can connect, with what grants) — names only, no
//     connection strings
//   - PITR window (must be ≥7 days for SOC 2)
//   - consumption metrics (read/write units, stored data)
//
// Reads:
//   NEON_API_KEY     API key (set in GitHub Actions secrets)
//   NEON_PROJECT_ID  the project id; required
//
// Output (JSON):
//   compliance/evidence/neon/<YYYY-MM-DD>/project.json
//   compliance/evidence/neon/<YYYY-MM-DD>/branches.json
//   compliance/evidence/neon/<YYYY-MM-DD>/roles.json
//   compliance/evidence/neon/<YYYY-MM-DD>/pitr.json
//   compliance/evidence/neon/<YYYY-MM-DD>/consumption.json
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

const NEON_API = 'https://console.neon.tech/api/v1';

function neonHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'solarpro-compliance-collector',
  };
}

async function getProject(token, projectId) {
  return withRetry(() => apiFetch(
    `${NEON_API}/projects/${encodeURIComponent(projectId)}`,
    { headers: neonHeaders(token) },
  ));
}

async function getBranches(token, projectId) {
  return withRetry(() => apiFetch(
    `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches`,
    { headers: neonHeaders(token) },
  ));
}

async function getRoles(token, projectId, branchId) {
  return withRetry(() => apiFetch(
    `${NEON_API}/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/roles`,
    { headers: neonHeaders(token) },
  ));
}

async function getConsumption(token, projectId) {
  return withRetry(() => apiFetch(
    `${NEON_API}/projects/${encodeURIComponent(projectId)}/consumption`,
    { headers: neonHeaders(token) },
  ));
}

async function collectDaily(token) {
  const projectId = process.env.NEON_PROJECT_ID;
  if (!projectId) {
    throw new Error('NEON_PROJECT_ID env var is required');
  }
  const written = [];

  const project = await getProject(token, projectId);
  written.push(writeEvidence('neon', null, 'project.json', {
    generated_at: nowIso(),
    project_id: projectId,
    project,
  }));

  const branches = await getBranches(token, projectId);
  const branchList = branches?.branches ?? [];
  written.push(writeEvidence('neon', null, 'branches.json', {
    generated_at: nowIso(),
    project_id: projectId,
    branch_count: branchList.length,
    branches: branchList.map((b) => ({
      id: b.id,
      name: b.name,
      primary: b.primary ?? false,
      created_at: b.created_at,
      // PITR enabled + window per branch
      pitr_enabled: !!(b.pitr_enabled ?? b?.history?.pitr_enabled),
      pitr_window_seconds: b.pitr_window ?? b?.history?.pitr_window ?? null,
    })),
  }));

  // Aggregate PITR window across branches (must be ≥7 days for SOC 2).
  const minWindow = Math.min(
    ...branchList
      .map((b) => b.pitr_window ?? b?.history?.pitr_window ?? 0)
      .filter((w) => typeof w === 'number' && w > 0),
  );
  const minWindowDays = minWindow ? Math.floor(minWindow / 86400) : 0;
  written.push(writeEvidence('neon', null, 'pitr.json', {
    generated_at: nowIso(),
    project_id: projectId,
    min_pitr_window_seconds: minWindow || null,
    min_pitr_window_days: minWindowDays,
    soc2_minimum_days: 7,
    soc2_compliant: minWindowDays >= 7,
  }));

  // Roles (one snapshot per primary branch — the one the app connects to).
  const primaryBranch = branchList.find((b) => b.primary) ?? branchList[0];
  if (primaryBranch) {
    try {
      const roles = await getRoles(token, projectId, primaryBranch.id);
      const roleList = roles?.roles ?? [];
      written.push(writeEvidence('neon', null, 'roles.json', {
        generated_at: nowIso(),
        project_id: projectId,
        branch_id: primaryBranch.id,
        branch_name: primaryBranch.name,
        role_count: roleList.length,
        roles: roleList.map((r) => ({
          // SECURITY: name + grants only. NEVER include the password /
          // connection string.
          name: r.name,
          branch_id: r.branch_id,
          protected: r.protected ?? false,
          // Permissions object is safe to emit; it does not contain secrets.
          permissions: r.permissions ?? null,
          created_at: r.created_at,
          _password_redacted: true,
        })),
      }));
    } catch (err) {
      written.push(writeEvidence('neon', null, 'roles.json', {
        generated_at: nowIso(),
        project_id: projectId,
        branch_id: primaryBranch.id,
        _error: err.message,
      }));
    }
  }

  try {
    const consumption = await getConsumption(token, projectId);
    written.push(writeEvidence('neon', null, 'consumption.json', {
      generated_at: nowIso(),
      project_id: projectId,
      consumption,
    }));
  } catch (err) {
    // Consumption is an enterprise-tier endpoint; missing is non-fatal.
    written.push(writeEvidence('neon', null, 'consumption.json', {
      generated_at: nowIso(),
      project_id: projectId,
      _note: 'consumption endpoint not available on this plan',
      _error: err.message,
    }));
  }

  return written;
}

export async function collect(mode = 'daily') {
  if (getDryRun()) {
    return [
      writeEvidence('neon', null, 'project.json', { generated_at: nowIso(), dry_run: true, project: null }),
      writeEvidence('neon', null, 'branches.json', { generated_at: nowIso(), dry_run: true, branches: [] }),
      writeEvidence('neon', null, 'roles.json', { generated_at: nowIso(), dry_run: true, roles: [] }),
      writeEvidence('neon', null, 'pitr.json', { generated_at: nowIso(), dry_run: true, min_pitr_window_days: 7, soc2_compliant: true }),
      writeEvidence('neon', null, 'consumption.json', { generated_at: nowIso(), dry_run: true }),
    ];
  }
  const token = process.env.NEON_API_KEY;
  if (!token) {
    throw new Error('NEON_API_KEY env var is required');
  }
  if (mode === 'hourly') return collectDaily(token); // no hourly-only fields; reuse
  if (mode === 'daily') return collectDaily(token);
  if (mode === 'weekly') return collectDaily(token);
  throw new Error(`neon.mjs: unknown mode "${mode}"`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || 'daily';
  collect(mode).then(
    (paths) => console.log(JSON.stringify({ mode, written: paths }, null, 2)),
    (err) => { console.error(`neon.mjs failed: ${err?.stack ?? err}`); process.exit(1); },
  );
}
