// ═══════════════════════════════════════════════════════════════════════════
// compliance/collectors/vercel.mjs
//
// Vercel REST v9 evidence collector. Captures (per SELF_BUILT_SETUP.md §2):
//   - deployment list (production + preview) for the last 24h
//   - project list (id, name, framework, updatedAt)
//   - team member list with role
//   - env-var diff (today vs. yesterday — Vercel has no env-var audit log,
//     so a daily snapshot is the closest proxy; the diff is computed at
//     read time by the weekly monitoring workflow, not here)
//
// Reads:
//   VERCEL_TOKEN     API token (set in GitHub Actions secrets)
//   VERCEL_TEAM_ID   optional; default = the token's default team
//   VERCEL_PROJECT   optional; if set, limit to a single project
//
// Output (JSON):
//   compliance/evidence/vercel/<YYYY-MM-DD>/deployments.json
//   compliance/evidence/vercel/<YYYY-MM-DD>/projects.json
//   compliance/evidence/vercel/<YYYY-MM-DD>/members.json
//   compliance/evidence/vercel/<YYYY-MM-DD>/env-vars.json
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

const VERCEL_API = 'https://api.vercel.com';

function vercelHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'solarpro-compliance-collector',
  };
}

function teamQuery(teamId) {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
}

async function listProjects(token, teamId) {
  return withRetry(() => apiFetch(
    `${VERCEL_API}/v9/projects${teamQuery(teamId)}&limit=100`,
    { headers: vercelHeaders(token) },
  ));
}

async function listDeployments(token, projectId, teamId) {
  return withRetry(() => apiFetch(
    `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}` +
    `${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''}&limit=100`,
    { headers: vercelHeaders(token) },
  ));
}

async function listEnvVars(token, projectId, teamId) {
  // Vercel returns env vars per project/environment. For SOC 2, we just
  // need the existence + key list (NOT the value). The default "production"
  // environment is what the auditor will sample.
  return withRetry(() => apiFetch(
    `${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}/env` +
    `${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`,
    { headers: vercelHeaders(token) },
  ));
}

async function listTeamMembers(token, teamId) {
  if (!teamId) {
    // No team context → call the /v1/teams endpoint as a probe. The
    // member list endpoint requires a teamId; in single-project setups
    // we skip the member snapshot and record the limitation.
    return { _note: 'no VERCEL_TEAM_ID set; team-member snapshot skipped', members: [] };
  }
  return withRetry(() => apiFetch(
    `${VERCEL_API}/v2/teams/${encodeURIComponent(teamId)}/members?limit=100`,
    { headers: vercelHeaders(token) },
  ));
}

async function collectDaily(token) {
  const teamId = process.env.VERCEL_TEAM_ID || '';
  const onlyProject = process.env.VERCEL_PROJECT || '';
  const written = [];

  const projects = await listProjects(token, teamId);
  const projList = projects?.projects ?? [];
  written.push(writeEvidence('vercel', null, 'projects.json', {
    generated_at: nowIso(),
    team_id: teamId || null,
    project_count: projList.length,
    projects: projList.map((p) => ({
      id: p.id,
      name: p.name,
      framework: p.framework,
      updatedAt: p.updatedAt,
    })),
  }));

  // Deployments: roll up across the team's projects, but cap per project
  // to the most recent 25 to keep the daily file small.
  const allDeployments = [];
  const projectFilter = onlyProject
    ? projList.filter((p) => p.name === onlyProject)
    : projList;
  for (const proj of projectFilter) {
    try {
      const deps = await listDeployments(token, proj.id, teamId);
      const list = deps?.deployments ?? [];
      allDeployments.push(...list.slice(0, 25).map((d) => ({
        uid: d.uid,
        projectId: proj.id,
        projectName: proj.name,
        state: d.state,
        target: d.target,
        url: d.url,
        createdAt: d.createdAt,
        creator: d.creator?.username ?? null,
        commit: d.meta?.githubCommitSha ?? d.meta?.gitlabCommitSha ?? null,
      })));
    } catch (err) {
      // One project's failure should not abort the rest.
      allDeployments.push({ _error: err.message, projectId: proj.id });
    }
  }
  written.push(writeEvidence('vercel', null, 'deployments.json', {
    generated_at: nowIso(),
    team_id: teamId || null,
    deployment_count: allDeployments.length,
    deployments: allDeployments,
  }));

  // Env-var snapshot — just keys, NEVER values.
  const envSnapshots = [];
  for (const proj of projectFilter) {
    try {
      const envs = await listEnvVars(token, proj.id, teamId);
      const list = envs?.envs ?? [];
      envSnapshots.push({
        projectId: proj.id,
        projectName: proj.name,
        keys: list.map((e) => ({ key: e.key, type: e.type, target: e.target })),
      });
    } catch (err) {
      envSnapshots.push({ _error: err.message, projectId: proj.id });
    }
  }
  written.push(writeEvidence('vercel', null, 'env-vars.json', {
    generated_at: nowIso(),
    team_id: teamId || null,
    _security: 'values redacted; keys + type + target only',
    envs: envSnapshots,
  }));

  // Members
  try {
    const members = await listTeamMembers(token, teamId);
    written.push(writeEvidence('vercel', null, 'members.json', {
      generated_at: nowIso(),
      team_id: teamId || null,
      ...members,
    }));
  } catch (err) {
    written.push(writeEvidence('vercel', null, 'members.json', {
      generated_at: nowIso(),
      team_id: teamId || null,
      _error: err.message,
    }));
  }

  return written;
}

async function collectWeekly(token) {
  // Weekly = daily + a 7-day deployment history per project.
  const written = await collectDaily(token);
  const teamId = process.env.VERCEL_TEAM_ID || '';
  const onlyProject = process.env.VERCEL_PROJECT || '';
  const projects = await listProjects(token, teamId);
  const projList = projects?.projects ?? [];
  const projectFilter = onlyProject
    ? projList.filter((p) => p.name === onlyProject)
    : projList;
  const allDeps = [];
  for (const proj of projectFilter) {
    try {
      const deps = await listDeployments(token, proj.id, teamId);
      const list = deps?.deployments ?? [];
      allDeps.push(...list.slice(0, 100).map((d) => ({
        uid: d.uid, projectId: proj.id, projectName: proj.name,
        state: d.state, target: d.target, createdAt: d.createdAt,
        creator: d.creator?.username ?? null,
        commit: d.meta?.githubCommitSha ?? d.meta?.gitlabCommitSha ?? null,
      })));
    } catch { /* ignore individual failures */ }
  }
  written.push(writeEvidence('vercel', null, 'deployments-7d.json', {
    generated_at: nowIso(),
    team_id: teamId || null,
    window: '7d',
    deployment_count: allDeps.length,
    deployments: allDeps,
  }));
  return written;
}

export async function collect(mode = 'daily') {
  if (getDryRun()) {
    return [
      writeEvidence('vercel', null, 'projects.json', { generated_at: nowIso(), dry_run: true, projects: [] }),
      writeEvidence('vercel', null, 'deployments.json', { generated_at: nowIso(), dry_run: true, deployments: [] }),
      writeEvidence('vercel', null, 'env-vars.json', { generated_at: nowIso(), dry_run: true, envs: [] }),
      writeEvidence('vercel', null, 'members.json', { generated_at: nowIso(), dry_run: true, members: [] }),
    ];
  }
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new Error('VERCEL_TOKEN env var is required (set in GitHub Actions secrets)');
  }
  if (mode === 'hourly') {
    // Per design doc: hourly Vercel = deployment events for the last 24h.
    // Reuse collectDaily() to keep the file set consistent. The weekly
    // monitoring workflow is what enforces the 24h boundary downstream.
    return collectDaily(token);
  }
  if (mode === 'daily') return collectDaily(token);
  if (mode === 'weekly') return collectWeekly(token);
  throw new Error(`vercel.mjs: unknown mode "${mode}"`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || 'daily';
  collect(mode).then(
    (paths) => console.log(JSON.stringify({ mode, written: paths }, null, 2)),
    (err) => { console.error(`vercel.mjs failed: ${err?.stack ?? err}`); process.exit(1); },
  );
}
