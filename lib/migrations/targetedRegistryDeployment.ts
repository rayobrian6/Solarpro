// lib/migrations/targetedRegistryDeployment.ts
//
// Read-only analysis + live verification for the TARGETED authority-registry
// deployment (migrations 113 + 114 — the W4 canonical document registry and the
// immutable equipment-reconciliation audit tables, authored 2026-07-20/21).
//
// Mirrors targetedNearmapRecovery.ts (the migration-108 scoped path): the
// historical baseline for ~27 ancient migrations is still unreviewed, and the
// global EXECUTION_ENABLED gate refuses until it is. Migrations 113/114 are pure
// additive CREATE-TABLE-only DDL — idempotent (CREATE TABLE / CREATE INDEX IF
// NOT EXISTS), non-destructive, seed NO rows, and touch NO existing table.
// Holding them hostage to a review of 2024-era schema migrations serves no
// safety purpose. This module is the read-only gate for a bounded, per-
// identifier scoped permit through the CANONICAL runner (advisory lock +
// checksum + ledger + run history + audit). It NEVER runs any other migration
// and NEVER marks the historical baseline verified.
//
// This module NEVER mutates. It:
//   1. Statically verifies each target migration creates ONLY its expected
//      table(s) via CREATE TABLE IF NOT EXISTS, is idempotent, and contains no
//      destructive/altering/data-seeding statements (no DROP/DELETE/TRUNCATE/
//      ALTER/UPDATE/INSERT/GRANT/REVOKE/RENAME/CREATE OR REPLACE).
//   2. Verifies against the LIVE database which of the expected tables are
//      present vs. absent (search_path-aware, via to_regclass) both BEFORE (to
//      decide idempotent short-circuit) and AFTER execution (to prove success).

import { neon } from '@neondatabase/serverless';

/** The exact migrations this deployment path may execute, each hardcoded to the
 *  table(s) it must create. Order is a single ceremony but the two migrations
 *  are independent (each creates standalone tables). Ray runs 113 first, then
 *  114 — each with its own confirm flow. */
export const REGISTRY_DEPLOYMENT: Record<string, { expectedTables: string[] }> = {
  '113': { expectedTables: ['manufacturer_document_registry'] },
  '114': { expectedTables: ['equipment_reconciliation_audit', 'snapshot_digest_invalidations'] },
  // AAC WS-6 (2026-07-27) — the personnel-roles store: the designer / preparer /
  // reviewer / engineer-of-record / approving-engineer roles of record. Same
  // shape of migration as 113/114 (pure additive CREATE TABLE / CREATE INDEX
  // IF NOT EXISTS, no ALTER, no seeded rows, no vendor default), so it goes
  // through the same statically-verified, identifier-scoped permit.
  '115': { expectedTables: ['personnel_roles', 'project_personnel_assignments'] },
  // AAC WS-8 / WS-9 (2026-07-27) — the digest-bound engineering-review record.
  // What makes ENGINEERING-REVIEW-PENDING clearable by a REAL licensed workflow
  // instead of being structurally unclearable. Same migration shape as 113-115
  // (pure additive CREATE TABLE / CREATE INDEX IF NOT EXISTS, no ALTER, no
  // seeded rows, and — critically — no seeded approval), so it goes through the
  // same statically-verified, identifier-scoped permit. Run AFTER 115: the
  // reviewer role vocabulary it enforces is migration 115's.
  '116': { expectedTables: ['engineering_review_records'] },
};

/** The migration identifiers this module governs, in ceremony order. */
export const REGISTRY_SEQUENCE = ['113', '114', '115', '116'] as const;

function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — cannot verify targeted registry deployment.');
  return neon(url);
}

/** Strip comments AND single-quoted string literals so keyword scans never trip
 *  on prose (the migration headers narrate the schema) or on quoted values
 *  (DEFAULT 'draft' etc). */
function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/--[^\n]*/g, ' ')           // line comments
    .replace(/'(?:[^']|'')*'/g, "''");   // string literals (incl. escaped '')
}

/** Statements a pure additive registry-creation migration must never contain.
 *  CREATE (TABLE/INDEX) is the point; SELECT is not present. DROP/DELETE/
 *  TRUNCATE/ALTER/UPDATE remove or mutate; INSERT would seed rows (these
 *  migrations create tables ONLY); the rest are schema/permission changes. Note
 *  CREATE OR REPLACE is explicitly forbidden even though bare CREATE is allowed. */
const FORBIDDEN_TOKENS = [
  'DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'UPDATE', 'INSERT',
  'GRANT', 'REVOKE', 'RENAME', 'COPY', 'VACUUM', 'CREATE OR REPLACE',
];

export interface RegistryMigrationShape {
  identifier: string;
  /** Table names created via CREATE TABLE (IF NOT EXISTS) in the file. */
  createdTables: string[];
  /** The tables the caller expects this migration to create. */
  expectedTables: string[];
  /** Every CREATE TABLE is written IF NOT EXISTS (safe to re-run). */
  idempotent: boolean;
  /** The set of created tables exactly matches the expected set. */
  tablesMatchExpected: boolean;
  /** No destructive / mutating / data-seeding statements present. */
  nonDestructive: boolean;
  /** Any forbidden tokens found (empty when non-destructive). */
  forbiddenFound: string[];
  /** True when everything the static analysis needs was parsed + consistent. */
  ok: boolean;
  /** Human-readable problems (empty when ok). */
  problems: string[];
}

/**
 * Parse a registry migration and extract the concrete deployment facts. Pure —
 * no database access. The SQL is the exact manifest content the caller read
 * server-side.
 */
export function analyzeRegistryMigration(
  identifier: string,
  sql: string,
  expectedTables: string[],
): RegistryMigrationShape {
  const problems: string[] = [];
  const body = stripCommentsAndStrings(sql);

  // Every CREATE TABLE (schema-qualified or not), whether or not IF NOT EXISTS.
  const allCreateTable = [...body.matchAll(
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[A-Za-z_][\w$]*\.)?([A-Za-z_][\w$]*)/gi,
  )].map((m) => m[1].toLowerCase());
  // Only the IF NOT EXISTS variants (idempotency proof).
  const idempotentCreateTable = [...body.matchAll(
    /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:[A-Za-z_][\w$]*\.)?([A-Za-z_][\w$]*)/gi,
  )].map((m) => m[1].toLowerCase());

  const createdTables = [...new Set(allCreateTable)];

  if (createdTables.length === 0) {
    problems.push(`Migration ${identifier} contains no CREATE TABLE statement — not the expected registry deployment.`);
  }
  const idempotent = createdTables.length > 0 && allCreateTable.length === idempotentCreateTable.length;
  if (createdTables.length > 0 && !idempotent) {
    problems.push(`Migration ${identifier} has a CREATE TABLE that is not written IF NOT EXISTS (not idempotent).`);
  }

  // Any CREATE INDEX must also be idempotent (IF NOT EXISTS) — a bare CREATE
  // INDEX would fail on a re-run.
  const bareCreateIndex = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS)/i.test(body);
  if (bareCreateIndex) {
    problems.push(`Migration ${identifier} has a CREATE INDEX that is not written IF NOT EXISTS (not idempotent).`);
  }

  const expected = expectedTables.map((t) => t.toLowerCase());
  const missingExpected = expected.filter((t) => !createdTables.includes(t));
  const unexpected = createdTables.filter((t) => !expected.includes(t));
  const tablesMatchExpected = missingExpected.length === 0 && unexpected.length === 0;
  if (missingExpected.length > 0) {
    problems.push(`Migration ${identifier} does not create expected table(s): ${missingExpected.join(', ')}.`);
  }
  if (unexpected.length > 0) {
    problems.push(`Migration ${identifier} creates unexpected table(s): ${unexpected.join(', ')}.`);
  }

  const forbiddenFound = FORBIDDEN_TOKENS.filter((tok) =>
    new RegExp(`\\b${tok.replace(/\s+/g, '\\s+')}\\b`, 'i').test(body));
  const nonDestructive = forbiddenFound.length === 0;
  if (!nonDestructive) {
    problems.push(`Migration ${identifier} contains destructive/mutating/seeding token(s): ${forbiddenFound.join(', ')}.`);
  }

  return {
    identifier,
    createdTables,
    expectedTables: expected,
    idempotent,
    tablesMatchExpected,
    nonDestructive,
    forbiddenFound,
    ok: problems.length === 0,
    problems,
  };
}

export interface TablesStateCheck {
  /** Every expected table is present. */
  allPresent: boolean;
  /** No expected table is present (a clean pre-apply state). */
  nonePresent: boolean;
  presentTables: string[];
  absentTables: string[];
}

/**
 * Read-only: which of the expected tables currently exist? search_path-aware via
 * to_regclass, so production `public` and an isolated test schema both work.
 */
export async function verifyTablesState(tables: string[]): Promise<TablesStateCheck> {
  const sql = getRawSql();
  const present: string[] = [];
  const absent: string[] = [];
  for (const t of tables) {
    const rows = (await sql`SELECT to_regclass(${t}) IS NOT NULL AS present`) as Array<{ present: boolean }>;
    if (rows[0]?.present === true) present.push(t); else absent.push(t);
  }
  return {
    allPresent: absent.length === 0 && present.length === tables.length,
    nonePresent: present.length === 0,
    presentTables: present,
    absentTables: absent,
  };
}
