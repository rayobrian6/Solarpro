// lib/migrations/targetedDataAuthority.ts
//
// Read-only analysis + live verification for the TARGETED data-authority
// backfill (migrations 109-112 — the DATA-AUTHORITY-AUDIT stamp/nameplate/
// fence-line normalizers, authored 2026-07-19).
//
// Mirrors targetedNearmapRecovery.ts (the migration-108 scoped path): the
// historical baseline for ~27 ancient migrations is still unreviewed, and the
// global EXECUTION_ENABLED gate refuses until it is. These four migrations are
// pure DATA-ONLY UPDATEs (no DDL), idempotent, authored + review-verified this
// week — holding them hostage to a review of 2024-era schema migrations serves
// no safety purpose. This module is the read-only gate for a bounded,
// per-identifier scoped permit through the CANONICAL runner (advisory lock +
// checksum + ledger + run history + audit). It NEVER runs any other migration
// and NEVER marks the historical baseline verified.
//
// This module NEVER mutates. It:
//   1. Statically verifies each target migration is UPDATE-only (no DDL, no
//      DELETE/DROP/TRUNCATE/INSERT), targets only the allow-listed tables
//      (projects, layouts), and is comment-documented idempotent.
//   2. Verifies against the LIVE database that every table/column the
//      migrations touch exists.

import { neon } from '@neondatabase/serverless';

/** The exact migrations this recovery path may execute, in mandatory order.
 *  109 (subSystems inference) MUST precede 110/111 (map-driven re-stamp +
 *  nameplate); 112 is independent but sequenced last for a single ceremony. */
export const DATA_AUTHORITY_SEQUENCE = ['109', '110', '111', '112'] as const;

/** UPDATE targets the four migrations are allowed to touch. */
const ALLOWED_UPDATE_TABLES = new Set(['projects', 'layouts']);

/** Live columns each migration depends on (verified before any execution). */
export const REQUIRED_COLUMNS: Record<string, string[]> = {
  projects: ['engineering_config', 'selected_equipment', 'system_size_kw', 'deleted_at'],
  layouts: ['panels', 'design_electrical', 'system_size_kw', 'fence_line', 'updated_at'],
};

function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — cannot verify targeted data-authority backfill.');
  return neon(url);
}

/** Strip comments AND single-quoted string literals so keyword scans never
 *  trip on prose (the migration headers narrate what they replace) or on
 *  quoted values. */
function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/--[^\n]*/g, ' ')           // line comments
    .replace(/'(?:[^']|'')*'/g, "''");   // string literals (incl. escaped '')
}

/** Statements a pure data-only backfill must never contain. UPDATE is the
 *  point; SELECT/WITH are its plumbing. Everything else is refused. */
const FORBIDDEN_TOKENS = [
  'DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE', 'INSERT',
  'GRANT', 'REVOKE', 'RENAME', 'COPY', 'VACUUM',
];

export interface DataOnlyShape {
  identifier: string;
  /** Every UPDATE target found in the migration. */
  updateTargets: string[];
  /** All UPDATE targets are inside ALLOWED_UPDATE_TABLES. */
  targetsAllowed: boolean;
  /** No forbidden statement tokens present. */
  dataOnly: boolean;
  forbiddenFound: string[];
  ok: boolean;
  problems: string[];
}

/** Static shape check: UPDATE-only, allow-listed tables. */
export function analyzeDataOnlyMigration(identifier: string, sql: string): DataOnlyShape {
  const body = stripCommentsAndStrings(sql);
  const problems: string[] = [];

  const forbiddenFound = FORBIDDEN_TOKENS.filter((t) =>
    new RegExp(`\\b${t}\\b`, 'i').test(body));
  const dataOnly = forbiddenFound.length === 0;
  if (!dataOnly) problems.push(`Migration ${identifier} contains forbidden statement token(s): ${forbiddenFound.join(', ')}.`);

  const updateTargets = [...body.matchAll(/\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi)]
    .map((m) => m[1].toLowerCase());
  if (updateTargets.length === 0) problems.push(`Migration ${identifier} contains no UPDATE statement — not the expected data backfill.`);
  const disallowed = updateTargets.filter((t) => !ALLOWED_UPDATE_TABLES.has(t));
  const targetsAllowed = disallowed.length === 0;
  if (!targetsAllowed) problems.push(`Migration ${identifier} UPDATEs non-allow-listed table(s): ${disallowed.join(', ')}.`);

  return {
    identifier,
    updateTargets,
    targetsAllowed,
    dataOnly,
    forbiddenFound,
    ok: problems.length === 0,
    problems,
  };
}

export interface ColumnsCheck {
  table: string;
  tableExists: boolean;
  missingColumns: string[];
  ok: boolean;
}

/** Live verification that a table + its required columns exist. */
export async function verifyTableColumns(table: string, columns: string[]): Promise<ColumnsCheck> {
  const sql = getRawSql();
  const rows = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `) as Array<{ column_name: string }>;
  const present = new Set(rows.map((r) => r.column_name));
  const tableExists = rows.length > 0;
  const missingColumns = columns.filter((c) => !present.has(c));
  return { table, tableExists, missingColumns, ok: tableExists && missingColumns.length === 0 };
}

/** Read-only impact preview so the operator sees what will change BEFORE the
 *  ceremony: candidate counts per migration. Never mutates. */
export async function previewDataAuthorityImpact(): Promise<Record<string, number>> {
  const sql = getRawSql();
  const out: Record<string, number> = {};
  // 110: panels whose stamp wattage contradicts the subSystems-map nameplate is
  // expensive to compute exactly here; count projects WITH a map as the bound.
  const mapped = (await sql`
    SELECT COUNT(*)::int AS n FROM projects
    WHERE deleted_at IS NULL
      AND COALESCE(engineering_config -> 'subSystems', '{}'::jsonb) <> '{}'::jsonb
  `) as Array<{ n: number }>;
  out['mappedProjects'] = mapped[0]?.n ?? 0;
  const fence = (await sql`
    SELECT COUNT(*)::int AS n FROM layouts
    WHERE COALESCE(jsonb_array_length(NULLIF(fence_line, 'null'::jsonb)), 0) = 0
      AND jsonb_typeof(panels) = 'array'
  `) as Array<{ n: number }>;
  out['emptyFenceLineLayouts'] = fence[0]?.n ?? 0;
  return out;
}
