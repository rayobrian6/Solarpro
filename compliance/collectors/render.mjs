// ═══════════════════════════════════════════════════════════════════════════
// compliance/collectors/render.mjs
//
// Render REST v1 evidence collector. Captures (per SELF_BUILT_SETUP.md §2):
//   - SAM2 service deploys
//   - service env-var keys (NEVER values)
//   - service events (start, stop, restart, crash)
//   - team member list with role
//
// Reads:
//   RENDER_API_KEY    API key (set in GitHub Actions secrets)
//   RENDER_OWNER_ID   team / owner id; required for the team-member endpoint
//   RENDER_SERVICE_IDS comma-separated list of service ids (default: the
//                     single SAM2 service). The collector is no-op if empty
//                     and the env var is set to literal "NONE".
//
// Output (JSON):
//   compliance/evidence/render/<YYYY-MM-DD>/deploys.json
//   compliance/evidence/render/<YYYY-MM-DD>/env-vars.json
//   compliance/evidence/render/<YYYY-MM-DD>/events.json
//   compliance/evidence/render/<YYYY-MM-DD>/members.json
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

const RENDER_API = 'https://api.render.com/v1';

function renderHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'solarpro-compliance-collector',
  };
}

function serviceIds() {
  const raw = process.env.RENDER_SERVICE_IDS ?? '';
  if (raw === 'NONE' || raw === '') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function listDeploys(token, serviceId) {
  return withRetry(() => apiFetch(
    `${RENDER_API}/services/${encodeURIComponent(serviceId)}/deploys?limit=25`,
    { headers: renderHeaders(token) },
  ));
}

async function listEvents(token, serviceId) {
  return withRetry(() => apiFetch(
    `${RENDER_API}/services/${encodeURIComponent(serviceId)}/events?limit=50`,
    { headers: renderHeaders(token) },
  ));
}

async function listEnvVars(token, serviceId) {
  return withRetry(() => apiFetch(
    `${RENDER_API}/services/${encodeURIComponent(serviceId)}/env-vars`,
    { headers: renderHeaders(token) },
  ));
}

async function listTeamMembers(token, ownerId) {
  if (!ownerId) {
    return { _note: 'no RENDER_OWNER_ID set; team-member snapshot skipped', members: [] };
  }
  return withRetry(() => apiFetch(
    `${RENDER_API}/teams/${encodeURIComponent(ownerId)}/members?limit=100`,
    { headers: renderHeaders(token) },
  ));
}

async function collectDaily(token) {
  const ownerId = process.env.RENDER_OWNER_ID || '';
  const ids = serviceIds();
  const written = [];

  const deployRows = [];
  const eventRows = [];
  const envRows = [];

  for (const sid of ids) {
    try {
      const dep = await listDeploys(token, sid);
      deployRows.push({
        serviceId: sid,
        deploys: Array.isArray(dep) ? dep : dep?.deploys ?? [],
      });
    } catch (err) {
      deployRows.push({ serviceId: sid, _error: err.message });
    }
    try {
      const ev = await listEvents(token, sid);
      eventRows.push({
        serviceId: sid,
        events: Array.isArray(ev) ? ev : ev?.events ?? [],
      });
    } catch (err) {
      eventRows.push({ serviceId: sid, _error: err.message });
    }
    try {
      const envs = await listEnvVars(token, sid);
      const list = Array.isArray(envs) ? envs : envs?.envVars ?? [];
      // SECURITY: keys only, NEVER values.
      envRows.push({
        serviceId: sid,
        keys: list.map((e) => ({ key: e.key, _value_redacted: true })),
      });
    } catch (err) {
      envRows.push({ serviceId: sid, _error: err.message });
    }
  }

  written.push(writeEvidence('render', null, 'deploys.json', {
    generated_at: nowIso(),
    service_count: ids.length,
    services: deployRows,
  }));
  written.push(writeEvidence('render', null, 'events.json', {
    generated_at: nowIso(),
    service_count: ids.length,
    services: eventRows,
  }));
  written.push(writeEvidence('render', null, 'env-vars.json', {
    generated_at: nowIso(),
    service_count: ids.length,
    _security: 'values redacted; keys only',
    services: envRows,
  }));

  try {
    const members = await listTeamMembers(token, ownerId);
    written.push(writeEvidence('render', null, 'members.json', {
      generated_at: nowIso(),
      owner_id: ownerId || null,
      ...members,
    }));
  } catch (err) {
    written.push(writeEvidence('render', null, 'members.json', {
      generated_at: nowIso(),
      owner_id: ownerId || null,
      _error: err.message,
    }));
  }

  return written;
}

export async function collect(mode = 'daily') {
  if (getDryRun()) {
    return [
      writeEvidence('render', null, 'deploys.json', { generated_at: nowIso(), dry_run: true, services: [] }),
      writeEvidence('render', null, 'events.json', { generated_at: nowIso(), dry_run: true, services: [] }),
      writeEvidence('render', null, 'env-vars.json', { generated_at: nowIso(), dry_run: true, services: [], _security: 'values redacted' }),
      writeEvidence('render', null, 'members.json', { generated_at: nowIso(), dry_run: true, members: [] }),
    ];
  }
  const token = process.env.RENDER_API_KEY;
  if (!token) {
    throw new Error('RENDER_API_KEY env var is required');
  }
  if (mode === 'hourly') return collectDaily(token); // hourly = event ping
  if (mode === 'daily') return collectDaily(token);
  if (mode === 'weekly') return collectDaily(token); // weekly is the trust center / auditor snapshot; we re-run daily
  throw new Error(`render.mjs: unknown mode "${mode}"`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || 'daily';
  collect(mode).then(
    (paths) => console.log(JSON.stringify({ mode, written: paths }, null, 2)),
    (err) => { console.error(`render.mjs failed: ${err?.stack ?? err}`); process.exit(1); },
  );
}
