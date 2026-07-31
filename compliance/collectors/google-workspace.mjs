// ═══════════════════════════════════════════════════════════════════════════
// compliance/collectors/google-workspace.mjs
//
// Google Admin SDK + Reports API evidence collector. Captures
// (per SELF_BUILT_SETUP.md §2):
//   - user list with MFA enrollment, suspended status, last-login
//   - admin role assignments
//   - login-audit events (success + failure, last 7d for daily / last 90d
//     for weekly)
//   - drive-sharing audit (last 7d)
//   - token-audit (OAuth grants)
//   - failed-login spike detection (hourly)
//
// Reads:
//   GOOGLE_WORKSPACE_TOKEN    OAuth 2.0 access token with admin.directory.*
//                            and admin.reports.audit.readonly scopes.
//                            Must be minted by a service account in the
//                            Solarpro Workspace.
//   GOOGLE_WORKSPACE_CUSTOMER  the Workspace customer id ("my_customer"
//                             for the account's own data)
//
// Output (JSON):
//   compliance/evidence/google-workspace/<YYYY-MM-DD>/users-mfa.json
//   compliance/evidence/google-workspace/<YYYY-MM-DD>/admin-roles.json
//   compliance/evidence/google-workspace/<YYYY-MM-DD>/login-audit.json
//   compliance/evidence/google-workspace/<YYYY-MM-DD>/drive-sharing.json
//   compliance/evidence/google-workspace/<YYYY-MM-DD>/token-audit.json
//   compliance/evidence/google-workspace/<YYYY-MM-DD>/failed-login-spike.json
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

const ADMIN_API = 'https://admin.googleapis.com/admin/directory/v1';
const REPORTS_API = 'https://admin.googleapis.com/admin/reports/v1';

function gwHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'solarpro-compliance-collector',
  };
}

function customer() {
  return process.env.GOOGLE_WORKSPACE_CUSTOMER || 'my_customer';
}

// ── Directory API ───────────────────────────────────────────────────────

async function listUsers(token) {
  const all = [];
  let pageToken = null;
  do {
    const url =
      `${ADMIN_API}/users?customer=${encodeURIComponent(customer())}` +
      `&maxResults=500` +
      `&projection=full` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const data = await withRetry(() => apiFetch(url, { headers: gwHeaders(token) }));
    if (data?.users) all.push(...data.users);
    pageToken = data?.nextPageToken ?? null;
  } while (pageToken);
  return all;
}

async function listAdminRoles(token) {
  return withRetry(() => apiFetch(
    `${ADMIN_API}/customer/${encodeURIComponent(customer())}/roles`,
    { headers: gwHeaders(token) },
  ));
}

async function listRoleAssignments(token) {
  return withRetry(() => apiFetch(
    `${ADMIN_API}/customer/${encodeURIComponent(customer())}/roleassignments`,
    { headers: gwHeaders(token) },
  ));
}

// ── Reports API ────────────────────────────────────────────────────────

async function getLoginAudit(token, days) {
  // The login audit is a special applicationName; events are paginated.
  const all = [];
  let pageToken = null;
  const startTime = new Date(Date.now() - days * 86400_000).toISOString();
  do {
    const url =
      `${REPORTS_API}/activity/users/all/applications/login` +
      `?startTime=${encodeURIComponent(startTime)}` +
      `&maxResults=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const data = await withRetry(() => apiFetch(url, { headers: gwHeaders(token) }));
    const events = data?.items ?? [];
    all.push(...events);
    pageToken = data?.nextPageToken ?? null;
  } while (pageToken);
  return all;
}

async function getAdminAudit(token, days) {
  // Generic admin-event audit (role changes, group changes, token grants).
  const all = [];
  let pageToken = null;
  const startTime = new Date(Date.now() - days * 86400_000).toISOString();
  do {
    const url =
      `${REPORTS_API}/activity/users/all/applications/admin` +
      `?startTime=${encodeURIComponent(startTime)}` +
      `&maxResults=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const data = await withRetry(() => apiFetch(url, { headers: gwHeaders(token) }));
    const events = data?.items ?? [];
    all.push(...events);
    pageToken = data?.nextPageToken ?? null;
  } while (pageToken);
  return all;
}

async function getDriveAudit(token, days) {
  const all = [];
  let pageToken = null;
  const startTime = new Date(Date.now() - days * 86400_000).toISOString();
  do {
    const url =
      `${REPORTS_API}/activity/users/all/applications/drive` +
      `?startTime=${encodeURIComponent(startTime)}` +
      `&maxResults=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const data = await withRetry(() => apiFetch(url, { headers: gwHeaders(token) }));
    const events = data?.items ?? [];
    all.push(...events);
    pageToken = data?.nextPageToken ?? null;
  } while (pageToken);
  return all;
}

async function getTokenAudit(token, days) {
  const all = [];
  let pageToken = null;
  const startTime = new Date(Date.now() - days * 86400_000).toISOString();
  do {
    const url =
      `${REPORTS_API}/activity/users/all/applications/token` +
      `?startTime=${encodeURIComponent(startTime)}` +
      `&maxResults=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const data = await withRetry(() => apiFetch(url, { headers: gwHeaders(token) }));
    const events = data?.items ?? [];
    all.push(...events);
    pageToken = data?.nextPageToken ?? null;
  } while (pageToken);
  return all;
}

// ── Modes ──────────────────────────────────────────────────────────────

async function collectHourly(token) {
  const written = [];
  // Failed-login spike: pull last 1h of login events and count failures.
  const events = await getLoginAudit(token, 1 / 24);
  const failures = events.filter((e) => {
    const evt = e?.events?.[0];
    return evt?.type === 'login_failure' || evt?.name === 'login_failure';
  });
  written.push(writeEvidence('google-workspace', null, 'failed-login-spike.json', {
    generated_at: nowIso(),
    window_hours: 1,
    failure_count: failures.length,
    threshold: 50,
    spike: failures.length > 50,
    sample_events: failures.slice(0, 25),
  }));
  return written;
}

async function collectDaily(token) {
  const written = [];
  // 1. Users + MFA
  const users = await listUsers(token);
  written.push(writeEvidence('google-workspace', null, 'users-mfa.json', {
    generated_at: nowIso(),
    user_count: users.length,
    users: users.map((u) => ({
      id: u.id,
      primaryEmail: u.primaryEmail,
      suspended: u.suspended ?? false,
      isAdmin: u.isAdmin ?? false,
      isDelegatedAdmin: u.isDelegatedAdmin ?? false,
      twoFactorEnabled: !!(u.isEnrolledIn2Sv ?? u.isEnforcedIn2Sv),
      twoFactorEnrolled: !!u.isEnrolledIn2Sv,
      twoFactorEnforced: !!u.isEnforcedIn2Sv,
      lastLoginTime: u.lastLoginTime ?? null,
      creationTime: u.creationTime ?? null,
    })),
  }));

  // 2. Admin roles + assignments
  const [roles, assignments] = await Promise.all([
    listAdminRoles(token),
    listRoleAssignments(token),
  ]);
  written.push(writeEvidence('google-workspace', null, 'admin-roles.json', {
    generated_at: nowIso(),
    roles: roles?.items ?? [],
    assignments: assignments?.items ?? [],
  }));

  return written;
}

async function collectWeekly(token) {
  const written = await collectDaily(token);
  // 7d login audit (the daily hourly already covers failed-login; the
  // weekly report wants the full success+failure distribution).
  const login = await getLoginAudit(token, 7);
  written.push(writeEvidence('google-workspace', null, 'login-audit.json', {
    generated_at: nowIso(),
    window_days: 7,
    event_count: login.length,
    events: login.slice(0, 5000), // cap; full event log lives in Workspace
  }));
  const drive = await getDriveAudit(token, 7);
  written.push(writeEvidence('google-workspace', null, 'drive-sharing.json', {
    generated_at: nowIso(),
    window_days: 7,
    event_count: drive.length,
    events: drive.slice(0, 5000),
  }));
  const tokens = await getTokenAudit(token, 7);
  written.push(writeEvidence('google-workspace', null, 'token-audit.json', {
    generated_at: nowIso(),
    window_days: 7,
    event_count: tokens.length,
    events: tokens.slice(0, 5000),
  }));
  return written;
}

export async function collect(mode = 'daily') {
  if (getDryRun()) {
    const out = [];
    if (mode === 'hourly') {
      out.push(writeEvidence('google-workspace', null, 'failed-login-spike.json', {
        generated_at: nowIso(), dry_run: true, window_hours: 1,
        failure_count: 0, threshold: 50, spike: false, sample_events: [],
      }));
    }
    if (mode === 'daily' || mode === 'weekly') {
      out.push(writeEvidence('google-workspace', null, 'users-mfa.json', {
        generated_at: nowIso(), dry_run: true, user_count: 0, users: [],
      }));
      out.push(writeEvidence('google-workspace', null, 'admin-roles.json', {
        generated_at: nowIso(), dry_run: true, roles: [], assignments: [],
      }));
    }
    if (mode === 'weekly') {
      out.push(writeEvidence('google-workspace', null, 'login-audit.json', {
        generated_at: nowIso(), dry_run: true, window_days: 7, event_count: 0, events: [],
      }));
      out.push(writeEvidence('google-workspace', null, 'drive-sharing.json', {
        generated_at: nowIso(), dry_run: true, window_days: 7, event_count: 0, events: [],
      }));
      out.push(writeEvidence('google-workspace', null, 'token-audit.json', {
        generated_at: nowIso(), dry_run: true, window_days: 7, event_count: 0, events: [],
      }));
    }
    return out;
  }
  const token = process.env.GOOGLE_WORKSPACE_TOKEN;
  if (!token) {
    throw new Error('GOOGLE_WORKSPACE_TOKEN env var is required');
  }
  if (mode === 'hourly') return collectHourly(token);
  if (mode === 'daily') return collectDaily(token);
  if (mode === 'weekly') return collectWeekly(token);
  throw new Error(`google-workspace.mjs: unknown mode "${mode}"`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || 'daily';
  collect(mode).then(
    (paths) => console.log(JSON.stringify({ mode, written: paths }, null, 2)),
    (err) => { console.error(`google-workspace.mjs failed: ${err?.stack ?? err}`); process.exit(1); },
  );
}
