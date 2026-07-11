/**
 * POST /api/admin/prospects/seed
 *
 * "Dispatch the scouts" — bootstraps the installer_prospects table and loads the
 * batch-1 seed WITHOUT the System Tools migration runner (whose ';' splitter
 * choked on the seed). Reads the real migration files (092 schema, 093 seed) and
 * executes them directly via the neon driver: 092 statement-by-statement,
 * 093 as a single INSERT. Idempotent — safe to click repeatedly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 1A.1 — Migration Governance (MIGRATION-GOV-07)
 *
 * This route is a NON-CANONICAL migration execution path: it reads numbered
 * migration SQL files (092_installer_prospects.sql, 093_seed_installer_prospects_batch1.sql)
 * directly from disk and executes them via the neon driver without passing
 * through the canonical migration governance system (lib/migrations/runner.ts),
 * which provides the schema_migrations ledger, mandatory SHA-256 checksums,
 * transactional execution, advisory locks, environment-aware authorization,
 * fresh TOTP verification, and audit event emission.
 *
 * This route is now gated behind the MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED
 * feature flag (default: disabled). When invoked with the flag disabled, it
 * emits a deprecation audit event and returns a deprecation notice directing the
 * operator to the canonical API at /api/admin/migrations. The file is NOT
 * deleted in Phase 1A.1 (per spec: restrict/wrap, don't delete unless
 * demonstrably safe). To re-enable this legacy path (NOT recommended), set
 * MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED=true.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";
import { requireAdminApi } from "@/lib/adminAuth";
import { rateLimitGuard } from '@/lib/rateLimitGuard';

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.substring(0, i);
    })
    .join("\n");
}

export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'admin');
  if (rlGuard.blocked) return rlGuard.response;

  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MIGRATION-GOV-07: Gate this non-canonical migration execution path.
  //
  // This route executes numbered migration SQL files directly, bypassing the
  // canonical governance system. It is gated behind a feature flag (default:
  // disabled) so that it cannot be used to alter the database schema without
  // going through the governed path. When disabled, emit a deprecation audit
  // event and return 423 Locked with a pointer to the canonical API.
  // ─────────────────────────────────────────────────────────────────────────────
  const legacyProspectsSeedEnabled = process.env.MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED === 'true';
  if (!legacyProspectsSeedEnabled) {
    // Emit deprecation audit event for observability.
    console.log(JSON.stringify({
      level: 'audit',
      type: 'migration.legacy.invoked',
      timestamp: new Date().toISOString(),
      actorType: 'human',
      actorId: admin.id,
      environment: (process.env.VERCEL_ENV || process.env.NODE_ENV || 'development').toLowerCase(),
      executionId: null,
      migrationIdentifier: null,
      filename: null,
      details: {
        legacyRunner: 'app/api/admin/prospects/seed/route.ts',
        reason: 'Legacy prospects-seed migration execution path invoked while disabled by default (Phase 1A.1 governance).',
        canonicalPath: '/api/admin/migrations',
      },
    }));
    return NextResponse.json({
      success: false,
      error: 'This legacy migration execution path is deprecated and disabled by default (Phase 1A.1 Migration Governance). ' +
        'Use the canonical migration API at /api/admin/migrations instead. ' +
        'To re-enable this legacy path (NOT recommended), set MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED=true.',
      canonicalPath: '/api/admin/migrations',
    }, { status: 423 }); // 423 Locked
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ success: false, error: "DATABASE_URL not set" }, { status: 500 });
  }

  const sql = neon(dbUrl);
  const dir = path.join(process.cwd(), "lib", "migrations");
  const errors: string[] = [];

  try {
    // 1) Ensure schema (092) — multi-statement, split on ';' (no string-literal ';')
    const schemaSql = stripSqlComments(
      fs.readFileSync(path.join(dir, "092_installer_prospects.sql"), "utf-8"),
    );
    for (const stmt of schemaSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      try {
        await sql(stmt, []);
      } catch (e) {
        const msg = (e as Error).message || "";
        if (!msg.includes("already exists")) errors.push(msg);
      }
    }

    // 2) Load the seed (093) — one INSERT statement, run whole
    const seedRaw = stripSqlComments(
      fs.readFileSync(path.join(dir, "093_seed_installer_prospects_batch1.sql"), "utf-8"),
    ).trim().replace(/;\s*$/, "");
    if (seedRaw) {
      await sql(seedRaw, []);
    }

    // 3) Report the new total
    const rows = await sql("SELECT COUNT(*)::int AS total FROM installer_prospects", []);
    const total = (rows[0] as { total: number })?.total ?? 0;

    return NextResponse.json({
      success: errors.length === 0,
      total,
      ...(errors.length ? { errors } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Seed failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
