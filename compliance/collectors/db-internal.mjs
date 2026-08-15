// ═══════════════════════════════════════════════════════════════════════════
// compliance/collectors/db-internal.mjs
//
// Internal Postgres (Neon) evidence collector. Captures
// (per SELF_BUILT_SETUP.md §2):
//   - audit_log table (new rows since the last hourly run) → NDJSON
//   - webhook_deliveries table (signature verification, idempotency, retry)
//   - users table summary (count by role, MFA enrolled, suspended)
//   - organizations table summary
//
// Reads:
//   DATABASE_URL  the connection string for the read-only role
//                 `compliance_ro` (created in Sprint 1). Must have SELECT
//                 on audit_log, webhook_deliveries, users, organizations.
//   DB_AUDIT_LOG_SINCE  optional ISO timestamp; if set, the hourly run
//                       only emits rows newer than this. Otherwise the
//                       hourly run pulls the last 24h; the daily run
//                       pulls everything (the file is full-state anyway,
//                       so the diff is conceptual not literal).
//
// Output (NDJSON):
//   compliance/evidence/db/<YYYY-MM-DD>/audit-log.ndjson
//   compliance/evidence/db/<YYYY-MM-DD>/webhook-deliveries.ndjson
//   compliance/evidence/db/<YYYY-MM-DD>/users-summary.json
//   compliance/evidence/db/<YYYY-MM-DD>/organizations-summary.json
//
// The audit log and webhook-deliveries are emitted as NDJSON (one row
// per line) so they can be streamed and diffed cheaply. The summaries
// are JSON.
// ═══════════════════════════════════════════════════════════════════════════

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  nowIso,
  getDryRun,
  writeEvidence,
  withRetry,
} from './common.mjs';
import pg from 'pg';

// pg is already in the repo's package.json (`"pg": "^8.20.0"`) per the
// package.json §dependencies, so no new dependency is added by this
// collector.
const { Pool } = pg;

function pool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var is required');
  return new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

async function queryRows(pool, sql, params = []) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(sql, params);
    return rows;
  } finally {
    client.release();
  }
}

async function collectHourly(pool) {
  const since = process.env.DB_AUDIT_LOG_SINCE
    ? new Date(process.env.DB_AUDIT_LOG_SINCE)
    : new Date(Date.now() - 24 * 3600_000);

  // New audit_log rows since the watermark
  const auditRows = await withRetry(
    () => queryRows(
      pool,
      `SELECT id, created_at, actor, action, target, approval_ticket,
              ip_address, user_agent, details
         FROM audit_log
        WHERE created_at >= $1
        ORDER BY created_at ASC
        LIMIT 10000`,
      [since.toISOString()],
    ),
    { retries: 2, baseDelayMs: 800 },
  );

  // New webhook_deliveries in the same window — captures signature
  // verification, idempotency, and retry outcomes.
  const webhookRows = await withRetry(
    () => queryRows(
      pool,
      `SELECT id, created_at, source, event_type, signature_verified,
              idempotency_key, attempt, status, response_code, error
         FROM webhook_deliveries
        WHERE created_at >= $1
        ORDER BY created_at ASC
        LIMIT 10000`,
      [since.toISOString()],
    ),
    { retries: 2, baseDelayMs: 800 },
  );

  return [
    writeEvidence('db', null, 'audit-log.ndjson', auditRows, { ndjson: true }),
    writeEvidence('db', null, 'webhook-deliveries.ndjson', webhookRows, { ndjson: true }),
  ];
}

async function collectDaily(pool) {
  // Daily = full-table audit-log + webhook-deliveries snapshots.
  // The hourly run already covers "new rows"; the daily run is the
  // complete state for the auditor's quarterly review.
  const allAudit = await withRetry(
    () => queryRows(
      pool,
      `SELECT id, created_at, actor, action, target, approval_ticket,
              ip_address, user_agent, details
         FROM audit_log
        ORDER BY created_at DESC
        LIMIT 100000`,
    ),
    { retries: 2, baseDelayMs: 800 },
  );
  const allWebhooks = await withRetry(
    () => queryRows(
      pool,
      `SELECT id, created_at, source, event_type, signature_verified,
              idempotency_key, attempt, status, response_code, error
         FROM webhook_deliveries
        ORDER BY created_at DESC
        LIMIT 100000`,
    ),
    { retries: 2, baseDelayMs: 800 },
  );
  const userSummary = await withRetry(
    () => queryRows(
      pool,
      `SELECT role, mfa_enrolled, suspended, COUNT(*)::int AS n
         FROM users
        GROUP BY role, mfa_enrolled, suspended
        ORDER BY role`,
    ),
    { retries: 2, baseDelayMs: 800 },
  );
  const orgSummary = await withRetry(
    () => queryRows(
      pool,
      `SELECT id, name, plan, created_at, suspended
         FROM organizations
        ORDER BY created_at DESC`,
    ),
    { retries: 2, baseDelayMs: 800 },
  );

  const written = [];
  written.push(writeEvidence('db', null, 'audit-log.ndjson', allAudit, { ndjson: true }));
  written.push(writeEvidence('db', null, 'webhook-deliveries.ndjson', allWebhooks, { ndjson: true }));
  written.push(writeEvidence('db', null, 'users-summary.json', {
    generated_at: nowIso(),
    by_role_mfa_suspended: userSummary,
  }));
  written.push(writeEvidence('db', null, 'organizations-summary.json', {
    generated_at: nowIso(),
    count: orgSummary.length,
    organizations: orgSummary,
  }));
  return written;
}

export async function collect(mode = 'hourly') {
  if (getDryRun()) {
    // Even in dry-run we emit valid NDJSON (empty array → empty file)
    // so the file shape matches what a real run would produce.
    if (mode === 'hourly') {
      return [
        writeEvidence('db', null, 'audit-log.ndjson', [], { ndjson: true }),
        writeEvidence('db', null, 'webhook-deliveries.ndjson', [], { ndjson: true }),
      ];
    }
    return [
      writeEvidence('db', null, 'audit-log.ndjson', [], { ndjson: true }),
      writeEvidence('db', null, 'webhook-deliveries.ndjson', [], { ndjson: true }),
      writeEvidence('db', null, 'users-summary.json', { generated_at: nowIso(), by_role_mfa_suspended: [] }),
      writeEvidence('db', null, 'organizations-summary.json', { generated_at: nowIso(), count: 0, organizations: [] }),
    ];
  }
  const p = pool();
  try {
    if (mode === 'hourly') return await collectHourly(p);
    if (mode === 'daily') return await collectDaily(p);
    if (mode === 'weekly') return await collectDaily(p);
    throw new Error(`db-internal.mjs: unknown mode "${mode}"`);
  } finally {
    await p.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || 'hourly';
  collect(mode).then(
    (paths) => console.log(JSON.stringify({ mode, written: paths }, null, 2)),
    (err) => { console.error(`db-internal.mjs failed: ${err?.stack ?? err}`); process.exit(1); },
  );
}
