/**
 * /api/admin/perf-diag — Performance diagnostic endpoint
 *
 * Times every step individually so we can pinpoint exactly where latency comes from.
 * Protected by requireAdminApi. Returns a breakdown of every operation with ms timings.
 *
 * Steps measured:
 *   1. JWT decode (verifyToken) — should be ~0ms (pure CPU)
 *   2. Role cache lookup — should be ~0ms (Map lookup)
 *   3. getDbWithRetry (SELECT 1 probe) — reveals Neon cold-start cost
 *   4. DB role lookup (SELECT users WHERE id) — reveals warm DB query cost
 *   5. Single DB query (SELECT 1) after warm — reveals per-query HTTP overhead
 *   6. Three sequential DB queries — measures serial query stacking
 *   7. Three parallel DB queries (Promise.all) — measures parallel query overhead
 *   8. pg_database_size — reveals catalog scan cost
 *   9. pg_statio_user_tables — reveals table stats scan cost
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { verifyToken } from '@/lib/auth';
// Import directly from db-ready to keep bundle small
import { getDbWithRetry } from '@/lib/db-ready';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

function t() { return Date.now(); }
function elapsed(start: number) { return Date.now() - start; }

export async function GET(req: NextRequest) {
  const overall = t();
  const steps: Array<{ step: string; ms: number; note?: string }> = [];

  // ── Step 1: requireAdminApi (full auth including DB lookup) ──────────────────
  const authStart = t();
  const admin = await requireAdminApi(req);
  const authMs = elapsed(authStart);
  steps.push({ step: '1_requireAdminApi', ms: authMs, note: admin ? `userId=${admin.id.slice(0,8)}` : 'FAILED' });

  if (!admin) {
    return NextResponse.json({ success: false, error: 'Forbidden', steps }, { status: 403 });
  }

  // ── Step 2: JWT decode only (no DB) ─────────────────────────────────────────
  const jwtStart = t();
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/solarpro_session=([^;]+)/);
  let jwtMs = 0;
  if (match) {
    verifyToken(match[1]);
    jwtMs = elapsed(jwtStart);
  }
  steps.push({ step: '2_jwtDecodeOnly', ms: jwtMs, note: 'pure CPU, no DB' });

  // ── Step 3: getDbWithRetry (probe SELECT 1 — warm flag check) ───────────────
  const probeStart = t();
  try {
    await getDbWithRetry();
    steps.push({ step: '3_getDbWithRetry', ms: elapsed(probeStart), note: 'warm=true → should be instant' });
  } catch (e) {
    steps.push({ step: '3_getDbWithRetry', ms: elapsed(probeStart), note: `ERROR: ${(e as Error).message}` });
  }

  // ── Step 4: get sql executor (warm — should be instant) ─────────────────────
  const sqlStart = t();
  const sql = await getDbWithRetry();
  steps.push({ step: '4_getDbReady', ms: elapsed(sqlStart), note: 'should be 0ms (warm, _instanceWarm=true)' });

  // ── Step 5: Single SELECT 1 (measures per-query HTTP overhead) ───────────────
  const q1Start = t();
  await sql`SELECT 1 AS ping`;
  steps.push({ step: '5_singleSelectOne', ms: elapsed(q1Start), note: 'one HTTP fetch to Neon' });

  // ── Step 6: Three sequential queries ────────────────────────────────────────
  const seq1Start = t();
  await sql`SELECT COUNT(*) AS cnt FROM users`;
  const seq1Ms = elapsed(seq1Start);

  const seq2Start = t();
  await sql`SELECT COUNT(*) AS cnt FROM projects`;
  const seq2Ms = elapsed(seq2Start);

  const seq3Start = t();
  await sql`SELECT COUNT(*) AS cnt FROM clients`;
  const seq3Ms = elapsed(seq3Start);

  steps.push({ step: '6a_seqQuery_users', ms: seq1Ms, note: 'serial query 1' });
  steps.push({ step: '6b_seqQuery_projects', ms: seq2Ms, note: 'serial query 2' });
  steps.push({ step: '6c_seqQuery_clients', ms: seq3Ms, note: 'serial query 3' });
  steps.push({ step: '6_seqTotal', ms: seq1Ms + seq2Ms + seq3Ms, note: 'sum of serial queries' });

  // ── Step 7: Three parallel queries (Promise.all) ─────────────────────────────
  const parStart = t();
  await Promise.all([
    sql`SELECT COUNT(*) AS cnt FROM proposals`,
    sql`SELECT COUNT(*) AS cnt FROM layouts`,
    sql`SELECT COUNT(*) AS cnt FROM project_files`,
  ]);
  steps.push({ step: '7_parallelQueries3', ms: elapsed(parStart), note: 'Promise.all of 3 queries' });

  // ── Step 8: pg_database_size (catalog scan) ──────────────────────────────────
  const dbsizeStart = t();
  const [dbSizeResult] = await Promise.all([
    sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
  ]);
  steps.push({ step: '8_pgDatabaseSize', ms: elapsed(dbsizeStart), note: `size=${dbSizeResult[0]?.size}` });

  // ── Step 9: pg_statio_user_tables (table stats — was previously serial) ──────
  const tableStart = t();
  await sql`
    SELECT relname, pg_total_relation_size(relid) AS sz
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY sz DESC
    LIMIT 5
  `;
  steps.push({ step: '9_pgStatioUserTables', ms: elapsed(tableStart), note: 'catalog scan, LIMIT 5' });

  // ── Step 10: Full health batch (all 9 queries in one Promise.all) ─────────────
  const batchStart = t();
  await Promise.all([
    sql`SELECT 1 AS ping`,
    sql`SELECT COUNT(*) AS cnt FROM users`,
    sql`SELECT COUNT(*) AS cnt FROM projects`,
    sql`SELECT COUNT(*) AS cnt FROM proposals`,
    sql`SELECT COUNT(*) AS cnt FROM layouts`,
    sql`SELECT COUNT(*) AS cnt FROM project_files`,
    sql`SELECT COUNT(*) AS cnt FROM clients`,
    sql`SELECT relname, pg_total_relation_size(relid) AS sz FROM pg_catalog.pg_statio_user_tables ORDER BY sz DESC LIMIT 5`,
    sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
  ]);
  steps.push({ step: '10_fullHealthBatch9', ms: elapsed(batchStart), note: 'all 9 health queries in Promise.all' });

  const totalMs = elapsed(overall);

  return NextResponse.json({
    success: true,
    totalMs,
    steps,
    summary: {
      authCost:       authMs,
      jwtCost:        jwtMs,
      probeWarmCost:  steps[2].ms,
      perQueryCost:   steps[4].ms,
      serial3Cost:    steps.find(s => s.step === '6_seqTotal')?.ms ?? 0,
      parallel3Cost:  steps.find(s => s.step === '7_parallelQueries3')?.ms ?? 0,
      fullBatch9Cost: steps.find(s => s.step === '10_fullHealthBatch9')?.ms ?? 0,
    },
    note: 'Run this endpoint once (cold) then immediately again (warm) to see cold-start vs warm delta',
  });
}