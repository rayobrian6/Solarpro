// lib/migrations/targetedNearmapRecovery.ts
//
// Read-only analysis + production verification for the TARGETED Nearmap recovery
// (migration 108 — the proximity index nearmap_ai_cache_lat_lng_idx that the
// fail-closed cache needs so re-renders stop re-billing the metered AI quota).
//
// This module NEVER mutates. It:
//   1. Parses migration 102 (dependency) and 108 (target) from the canonical
//      manifest — the exact SQL, server-side — and extracts the concrete facts
//      the recovery must check (target index name, its table + columns, whether
//      108 is idempotent and non-destructive, and whether 102 actually defines
//      that table + those columns).
//   2. Verifies against the LIVE database that every table/column 108 depends on
//      already exists (from 102), and that the exact index 108 creates is absent.
//
// The execution itself runs through the canonical runner under a bounded,
// 108-scoped permit (see lib/migrations/runner.ts). This module is the
// read-only gate that must pass BEFORE that runner is invoked.

import { neon } from '@neondatabase/serverless';

/** The single migration this recovery path may execute. */
export const TARGET_IDENTIFIER = '108';
/** The dependency migration that must already be applied in production. */
export const DEPENDENCY_IDENTIFIER = '102';

function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — cannot verify targeted recovery.');
  return neon(url);
}

/** Strip SQL comments so keyword scans never trip on prose in comments. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/--[^\n]*/g, ' ');        // line comments
}

/** Destructive / schema-altering keywords a pure additive index migration must
 *  not contain. INSERT/SELECT are not destructive; CREATE INDEX is expected. */
const DESTRUCTIVE_TOKENS = [
  'DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'UPDATE', 'GRANT', 'REVOKE',
  'CREATE OR REPLACE', 'RENAME',
];

export interface TargetedMigrationShape {
  /** The index 108 creates (e.g. nearmap_ai_cache_lat_lng_idx). */
  indexName: string | null;
  /** The table the index is on (e.g. nearmap_ai_cache). */
  tableName: string | null;
  /** The indexed columns (e.g. ['lat','lng']). */
  indexColumns: string[];
  /** 108 uses CREATE INDEX IF NOT EXISTS (safe to re-run). */
  idempotent: boolean;
  /** 108 contains no destructive/schema-altering statements. */
  nonDestructive: boolean;
  /** Any destructive tokens found (empty when non-destructive). */
  destructiveTokens: string[];
  /** 102 actually defines tableName. */
  dependencyDefinesTable: boolean;
  /** 102 defines every indexed column on that table. */
  dependencyDefinesColumns: boolean;
  /** True when everything the static analysis needs was parsed + consistent. */
  ok: boolean;
  /** Human-readable problems (empty when ok). */
  problems: string[];
}

/**
 * Parse migrations 102 + 108 and extract the concrete recovery facts. Pure —
 * no database access. The SQL is the exact manifest content the caller read
 * server-side.
 */
export function analyzeTargetedMigrations(sql102: string, sql108: string): TargetedMigrationShape {
  const problems: string[] = [];
  const body108 = stripSqlComments(sql108);
  const body102 = stripSqlComments(sql102);

  // Parse the CREATE INDEX in 108.
  const m = /CREATE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$]*)\s+ON\s+(?:[A-Za-z_][\w$]*\.)?([A-Za-z_][\w$]*)\s*\(([^)]*)\)/i.exec(body108);
  const indexName = m?.[1] ?? null;
  const tableName = m?.[2] ?? null;
  const indexColumns = m?.[3]
    ? m[3].split(',').map((c) => c.trim().split(/\s+/)[0].replace(/["'`]/g, '')).filter(Boolean)
    : [];

  if (!indexName) problems.push('Could not parse the CREATE INDEX statement in migration 108.');
  if (!tableName) problems.push('Could not parse the target table of migration 108.');
  if (indexColumns.length === 0) problems.push('Could not parse the indexed columns of migration 108.');

  const idempotent = /CREATE\s+INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS/i.test(body108);
  if (!idempotent) problems.push('Migration 108 is not written as CREATE INDEX IF NOT EXISTS (not idempotent).');

  const destructiveTokens = DESTRUCTIVE_TOKENS.filter((tok) =>
    new RegExp(`\\b${tok.replace(/\s+/g, '\\s+')}\\b`, 'i').test(body108),
  );
  const nonDestructive = destructiveTokens.length === 0;
  if (!nonDestructive) problems.push(`Migration 108 contains destructive/altering tokens: ${destructiveTokens.join(', ')}.`);

  // Bind the dependency to 102: it must CREATE the target table and define every
  // indexed column.
  const dependencyDefinesTable = !!tableName
    && new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:[A-Za-z_][\\w$]*\\.)?${tableName}\\b`, 'i').test(body102);
  if (tableName && !dependencyDefinesTable) problems.push(`Migration 102 does not define the table '${tableName}' that 108 indexes.`);

  const dependencyDefinesColumns = indexColumns.length > 0
    && indexColumns.every((col) => new RegExp(`\\b${col}\\b`, 'i').test(body102));
  if (indexColumns.length > 0 && !dependencyDefinesColumns) problems.push(`Migration 102 does not define all indexed columns (${indexColumns.join(', ')}).`);

  return {
    indexName, tableName, indexColumns,
    idempotent, nonDestructive, destructiveTokens,
    dependencyDefinesTable, dependencyDefinesColumns,
    ok: problems.length === 0,
    problems,
  };
}

export interface DependencyCheck {
  ok: boolean;
  tableExists: boolean;
  presentColumns: string[];
  missingColumns: string[];
}

/**
 * Verify — read-only, against the LIVE database — that the dependency table
 * exists and every required column is present. Uses to_regclass so it respects
 * the active search_path (production `public`, or an isolated test schema).
 */
export async function verifyDependencyPresent(tableName: string, columns: string[]): Promise<DependencyCheck> {
  const sql = getRawSql();
  const reg = (await sql`SELECT to_regclass(${tableName}) IS NOT NULL AS present` ) as Array<{ present: boolean }>;
  const tableExists = reg[0]?.present === true;
  if (!tableExists) {
    return { ok: false, tableExists: false, presentColumns: [], missingColumns: [...columns] };
  }
  const rows = (await sql`
    SELECT a.attname::text AS col
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(${tableName})
      AND a.attnum > 0 AND NOT a.attisdropped
  `) as Array<{ col: string }>;
  const present = new Set(rows.map((r) => r.col.toLowerCase()));
  const presentColumns = columns.filter((c) => present.has(c.toLowerCase()));
  const missingColumns = columns.filter((c) => !present.has(c.toLowerCase()));
  return { ok: missingColumns.length === 0, tableExists, presentColumns, missingColumns };
}

export interface IndexStateCheck {
  exists: boolean;
  /** When it exists, whether it indexes the expected table. */
  onExpectedTable: boolean;
}

/**
 * Read-only: does the exact index exist, and (if so) is it on the expected
 * table? search_path-aware via to_regclass.
 */
export async function verifyIndexState(indexName: string, tableName: string): Promise<IndexStateCheck> {
  const sql = getRawSql();
  const rows = (await sql`
    SELECT
      (to_regclass(${indexName}) IS NOT NULL) AS exists,
      (
        SELECT i.indrelid = to_regclass(${tableName})
        FROM pg_index i
        WHERE i.indexrelid = to_regclass(${indexName})
        LIMIT 1
      ) AS on_expected_table
  `) as Array<{ exists: boolean; on_expected_table: boolean | null }>;
  const r = rows[0];
  return { exists: r?.exists === true, onExpectedTable: r?.on_expected_table === true };
}
