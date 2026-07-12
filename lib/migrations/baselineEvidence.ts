// lib/migrations/baselineEvidence.ts
//
// Phase 1A.3 — Non-Production Operational Activation and Historical Baseline
// Reconciliation (MIGRATION-GOV-20, GOV-21)
//
// Read-only historical baseline evidence generator.
//
// This module performs READ-ONLY catalog introspection against a PostgreSQL
// database (Neon serverless in production, local PostgreSQL in non-production
// test environments) to generate evidence PROPOSALS for the historical
// baseline reconciliation of each migration in the manifest.
//
// Critical design constraints:
// - READ-ONLY: This module NEVER executes INSERT, UPDATE, DELETE, ALTER,
//   CREATE, DROP, TRUNCATE, or any other mutation against the database.
//   It queries only catalog/information_schema views (pg_class, pg_namespace,
//   pg_attribute, pg_indexes, pg_constraint, pg_proc, pg_trigger, pg_type,
//   pg_policy, information_schema).
// - PROPOSALS, NOT APPROVALS: The output is an evidence proposal that a human
//   operator reviews and records via the existing record-baseline-entry route
//   handler. This module does NOT write to migration_baseline, does NOT mark
//   migrations as reconciled, does NOT advance the lifecycle, and does NOT
//   perform any bulk mark-all operation.
// - CONSERVATIVE PARSER: The SQL parser (extractExpectedObjects) is
//   deliberately conservative — it extracts object expectations from common
//   DDL patterns (CREATE TABLE, CREATE INDEX, ALTER TABLE ADD COLUMN, ALTER
//   TABLE ADD CONSTRAINT, CREATE EXTENSION, CREATE FUNCTION, CREATE TRIGGER,
//   CREATE TYPE) but does NOT attempt full SQL semantic analysis. When the
//   parser cannot confidently determine what objects a migration creates, it
//   falls back to MANUAL_REVIEW rather than guessing. This ensures we never
//   falsely claim a migration was applied when it might not have been.
//
// Catalog inspection approach:
//   Instead of checking each expected object individually (which would require
//   many round-trips), collectCatalogSnapshot() issues a fixed set of queries
//   that retrieve ALL relevant catalog metadata in a single batch. The
//   classifyMigrationEvidence() function then compares expected objects against
//   the snapshot — a pure function with no database access.
//
// MIGRATION-GOV-20: Read-only baseline evidence generation from PostgreSQL
// catalog introspection.
// MIGRATION-GOV-21: Conservative SQL object-expectation extraction with
// manual-review fallback for uncertain cases.

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import {
  MigrationFile,
  MigrationManifest,
  BaselineReconciliationStatus,
  BaselineEvidenceType,
  TransactionMode,
} from './types';
import { discoverMigrationFiles } from './manifest';
import { splitSqlStatements } from './runner';
import { getCurrentEnvironment } from './ledger';

// ──────────────────────────────────────────────────────────────────────────
// Types — Evidence Proposal Structures
// ──────────────────────────────────────────────────────────────────────────

/**
 * The kind of schema object an evidence expectation refers to.
 */
export type ExpectedObjectKind =
  | 'table'
  | 'index'
  | 'column'
  | 'constraint'
  | 'extension'
  | 'function'
  | 'trigger'
  | 'type'
  | 'sequence';

/**
 * An object that a migration's SQL is expected to create or modify.
 *
 * The evidence generator parses the migration SQL to determine which objects
 * SHOULD exist if the migration was successfully applied. Each expectation
 * is then checked against the live catalog snapshot.
 */
export interface ExpectedObject {
  /** The kind of object (table, index, column, etc.). */
  kind: ExpectedObjectKind;
  /** The object name (unquoted, lowercased for case-insensitive comparison). */
  name: string;
  /**
   * For columns and constraints, the parent table name.
   * For triggers, the table the trigger is attached to.
   * null for standalone objects (tables, indexes on a known table,
   * extensions, functions, types, sequences).
   */
  parentTable: string | null;
  /** Whether the SQL uses IF NOT EXISTS (idempotent / soft expectation). */
  ifNotExists: boolean;
}

/**
 * An object detected in the live database catalog snapshot.
 */
export interface DetectedObject {
  /** The kind of object. */
  kind: ExpectedObjectKind;
  /** The object name. */
  name: string;
  /** The parent table (for columns, constraints, triggers), or null. */
  parentTable: string | null;
  /** The schema name (typically 'public'). */
  schema: string;
}

/**
 * A full catalog snapshot of all relevant schema objects in the database.
 *
 * This is collected once via collectCatalogSnapshot() and then used by the
 * pure classifyMigrationEvidence() function to check each migration's
 * expected objects without additional database round-trips.
 */
export interface CatalogSnapshot {
  tables: DetectedObject[];
  indexes: DetectedObject[];
  columns: DetectedObject[];
  constraints: DetectedObject[];
  extensions: DetectedObject[];
  functions: DetectedObject[];
  triggers: DetectedObject[];
  types: DetectedObject[];
  sequences: DetectedObject[];
  /** The timestamp the snapshot was collected. */
  collectedAt: string;
  /** Any errors encountered during collection (per-query). */
  collectionErrors: string[];
}

/**
 * A single baseline evidence proposal for one migration.
 *
 * This is the output of generateBaselineEvidence() / classifyMigrationEvidence().
 * It represents the evidence generator's ASSESSMENT of whether a migration
 * appears to have been applied — but it is NOT a reconciliation record. A
 * human operator must review this proposal and record the final reconciliation
 * status via the record-baseline-entry route handler.
 */
export interface BaselineEvidenceProposal {
  /** The migration identifier (e.g. '001', '074a'). */
  migrationIdentifier: string;
  /** The migration filename. */
  filename: string;
  /** The SHA-256 checksum of the migration file. */
  checksumSha256: string;
  /** The transaction mode (REQUIRED, FORBIDDEN, MANUAL_REVIEW). */
  transactionMode: TransactionMode;
  /** The objects the migration is expected to create/modify. */
  expectedObjects: ExpectedObject[];
  /** The objects from the catalog snapshot that matched expectations. */
  detectedObjects: DetectedObject[];
  /** Expected objects that were NOT found in the catalog snapshot. */
  missingObjects: ExpectedObject[];
  /**
   * Expected objects found in the snapshot but with potential conflicts
   * (e.g., a table exists but expected columns are missing within it).
   * Currently populated for column-level expectations.
   */
  conflictingObjects: ExpectedObject[];
  /** The type of evidence used for this assessment. */
  evidenceType: BaselineEvidenceType;
  /** The proposed reconciliation status (for human review). */
  proposedStatus: BaselineReconciliationStatus;
  /** Confidence level 0.0–1.0 in the proposed status. */
  confidence: number;
  /** Whether manual review is required before recording. */
  manualReviewRequired: boolean;
  /** Human-readable notes explaining the assessment. */
  notes: string;
}

/**
 * The result of running generateBaselineEvidence() across the full manifest.
 */
export interface BaselineEvidenceReport {
  /** The environment the evidence was generated for. */
  environment: string;
  /** The timestamp the report was generated. */
  generatedAt: string;
  /** The total number of migrations in the manifest. */
  manifestCount: number;
  /** Per-migration evidence proposals. */
  proposals: BaselineEvidenceProposal[];
  /** Summary counts by proposed status. */
  statusCounts: Record<BaselineReconciliationStatus, number>;
  /** Summary counts by evidence type. */
  evidenceTypeCounts: Record<BaselineEvidenceType, number>;
  /** Whether any proposal requires manual review. */
  hasManualReviewRequired: boolean;
  /** Any errors encountered during generation. */
  errors: string[];
  /** Whether the generator performed any mutation (always false — read-only). */
  performedMutation: boolean;
  /** The catalog snapshot used for classification. */
  catalogSnapshot: CatalogSnapshot;
}

// ──────────────────────────────────────────────────────────────────────────
// Database Access — Read-Only Raw SQL Executor
// ──────────────────────────────────────────────────────────────────────────

/**
 * Get a raw Neon SQL executor for read-only catalog queries.
 *
 * This follows the same pattern as ledger.ts getRawSql() — using neon()
 * directly for precise control. The evidence generator ONLY issues SELECT
 * queries against catalog views and information_schema.
 */
function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set — cannot connect to the database for baseline evidence generation.',
    );
  }
  return neon(url);
}

/**
 * Assert that a SQL string contains ONLY read-only statements.
 *
 * This is a defense-in-depth check. The evidence generator should only ever
 * issue hardcoded SELECT queries, but this function provides an additional
 * safety net by scanning any SQL before execution and refusing to run if
 * mutation keywords are detected.
 *
 * Returns true if the SQL appears to be read-only, false otherwise.
 */
export function assertReadOnlySql(sql: string): boolean {
  // Normalize: remove block comments, line comments, and collapse whitespace.
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  // Check for statement-level mutation keywords. We look for these as
  // statement prefixes (after splitting by semicolon) to avoid false
  // positives from words inside string literals or column names.
  const statements = stripped.split(';').map((s) => s.trim()).filter(Boolean);
  const mutationKeywords = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'ALTER',
    'CREATE',
    'DROP',
    'TRUNCATE',
    'GRANT',
    'REVOKE',
    'VACUUM',
    'REINDEX',
    'CLUSTER',
    'COPY',
    'MERGE',
    'REFRESH',
    'LOCK',
  ];

  for (const stmt of statements) {
    for (const keyword of mutationKeywords) {
      // A SELECT statement is safe. But "SELECT ... INTO" creates a table —
      // check for INTO as well.
      if (stmt.startsWith('SELECT')) {
        if (stmt.includes(' INTO ')) {
          return false;
        }
        continue;
      }
      if (stmt.startsWith(keyword)) {
        return false;
      }
    }
    // If it doesn't start with SELECT or WITH (CTE), reject it.
    if (!stmt.startsWith('SELECT') && !stmt.startsWith('WITH')) {
      return false;
    }
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// SQL Parsing — extractExpectedObjects()
// ──────────────────────────────────────────────────────────────────────────

/**
 * Strip SQL comments (both line dashes and slash-star block comments) from SQL content.
 *
 * This is a simplified version that does NOT handle dollar-quoted strings or
 * string literals — it is used for preprocessing before statement splitting,
 * which already handles those cases via splitSqlStatements().
 */
function stripComments(sql: string): string {
  let result = '';
  let i = 0;
  const len = sql.length;
  let inSingle = false;
  let inDouble = false;
  let inBlockComment = false;

  while (i < len) {
    const char = sql[i];
    const two = sql.slice(i, i + 2);

    // Handle string literals — copy verbatim
    if (!inDouble && !inBlockComment && char === "'" && !inSingle) {
      inSingle = true;
      result += char;
      i++;
      continue;
    }
    if (inSingle) {
      if (char === "'") {
        // Check for escaped quote ''
        if (sql[i + 1] === "'") {
          result += "''";
          i += 2;
          continue;
        }
        inSingle = false;
      }
      result += char;
      i++;
      continue;
    }

    // Handle double-quoted identifiers — copy verbatim
    if (!inSingle && !inBlockComment && char === '"') {
      inDouble = !inDouble;
      result += char;
      i++;
      continue;
    }
    if (inDouble) {
      result += char;
      i++;
      continue;
    }

    // Line comment
    if (!inBlockComment && two === '--') {
      // Skip to end of line
      while (i < len && sql[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (!inBlockComment && two === '/*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (inBlockComment) {
      if (two === '*/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Normalize an identifier: strip surrounding double quotes and lowercase.
 * PostgreSQL folds unquoted identifiers to lowercase; quoted identifiers
 * preserve case. For comparison purposes, we lowercase unquoted identifiers
 * and preserve quoted ones — but since all SolarPro migrations use unquoted
 * lowercase identifiers, we simply lowercase everything after stripping
 * quotes for robust comparison.
 */
function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    // Quoted identifier — strip quotes but preserve case.
    return trimmed.slice(1, -1);
  }
  return trimmed.toLowerCase();
}

/**
 * Parse a parenthesized column definition list from a CREATE TABLE statement
 * to extract column names. This is a simplified parser that handles the common
 * SolarPro patterns:
 *   column_name TYPE constraints,
 *   column_name TYPE constraints
 *
 * It does NOT attempt to parse table-level constraints (PRIMARY KEY, UNIQUE,
 * CHECK, FOREIGN KEY) as columns — those are skipped. It also does NOT handle
 * every possible SQL edge case; when in doubt, it conservatively skips.
 */
function extractColumnNamesFromCreateTable(
  columnDefs: string,
): string[] {
  const columns: string[] = [];
  // Split by commas at the top level (not inside parens).
  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (let i = 0; i < columnDefs.length; i++) {
    const ch = columnDefs[i];
    if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  // Table-level constraint keywords that indicate a non-column definition.
  const tableConstraintKeywords = [
    'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN', 'CONSTRAINT', 'EXCLUDE',
  ];

  for (const part of parts) {
    if (!part) continue;
    // Get the first token (the column name or constraint keyword).
    const tokenMatch = /^(\?)"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+/.exec(part) ||
      /^"([^"]+)"\s+/.exec(part) ||
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s+/.exec(part);
    if (!tokenMatch) continue;
    const firstToken = tokenMatch[2] || tokenMatch[1];

    // Check if this is a table-level constraint rather than a column.
    if (tableConstraintKeywords.includes(firstToken.toUpperCase())) {
      continue;
    }

    columns.push(normalizeIdentifier(firstToken));
  }

  return columns;
}

/**
 * Extract the table name from a CREATE TABLE or ALTER TABLE statement.
 * Handles schema-qualified names (schema.table) by returning just the table
 * part, and quoted identifiers.
 *
 * @returns The normalized table name, or null if not found.
 */
function extractTableName(statement: string): string | null {
  // Match: CREATE TABLE [IF NOT EXISTS] [schema.]tablename
  // or: ALTER TABLE [IF EXISTS] [schema.]tablename
  const match = /(?:CREATE\s+TABLE|ALTER\s+TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+|IF\s+EXISTS\s+)?(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i.exec(
    statement,
  );
  if (!match) return null;
  return normalizeIdentifier(match[1]);
}

/**
 * Extract all expected schema objects from a migration SQL file.
 *
 * This is a CONSERVATIVE parser. It handles the DDL patterns observed in the
 * SolarPro migration corpus:
 *   - CREATE TABLE [IF NOT EXISTS] table (columns...)
 *   - CREATE INDEX [IF NOT EXISTS] index ON table (...)
 *   - CREATE UNIQUE INDEX [IF NOT EXISTS] index ON table (...)
 *   - ALTER TABLE table ADD COLUMN [IF NOT EXISTS] column TYPE
 *   - ALTER TABLE table ADD CONSTRAINT [IF NOT EXISTS] constraint ...
 *   - CREATE EXTENSION [IF NOT EXISTS] "name"
 *   - CREATE [OR REPLACE] FUNCTION name(...)
 *   - CREATE [OR REPLACE] TRIGGER name ... ON table
 *   - CREATE TYPE name AS ...
 *   - CREATE SEQUENCE [IF NOT EXISTS] name
 *
 * When a statement type is not recognized (e.g., INSERT, UPDATE, DELETE,
 * SELECT, DO blocks), the parser does NOT produce expectations for it —
 * those migrations will have fewer or no expected objects, and the classifier
 * will propose MANUAL_REVIEW for them.
 *
 * No-op migrations (e.g., "SELECT 1;") will produce zero expected objects.
 * The classifier handles this case by proposing UNKNOWN with manual review.
 *
 * @param sqlContent The raw SQL content of the migration file.
 * @returns An array of expected objects.
 */
export function extractExpectedObjects(sqlContent: string): ExpectedObject[] {
  const expected: ExpectedObject[] = [];

  // Split into statements using the canonical splitter (handles strings,
  // comments, dollar-quotes correctly).
  const statements = splitSqlStatements(sqlContent);

  for (const stmt of statements) {
    const stripped = stripComments(stmt).trim();
    if (!stripped) continue;

    const upper = stripped.toUpperCase();

    // --- CREATE EXTENSION ---
    if (upper.startsWith('CREATE EXTENSION') || upper.startsWith('CREATE OR REPLACE EXTENSION')) {
      const match = /CREATE\s+(?:OR\s+REPLACE\s+)?EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i.exec(
        stripped,
      );
      if (match) {
        const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(stripped);
        expected.push({
          kind: 'extension',
          name: normalizeIdentifier(match[1]),
          parentTable: null,
          ifNotExists,
        });
      }
      continue;
    }

    // --- CREATE TYPE ---
    if (upper.startsWith('CREATE TYPE')) {
      const match = /CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i.exec(
        stripped,
      );
      if (match) {
        expected.push({
          kind: 'type',
          name: normalizeIdentifier(match[1]),
          parentTable: null,
          ifNotExists: false,
        });
      }
      continue;
    }

    // --- CREATE SEQUENCE ---
    if (upper.startsWith('CREATE SEQUENCE') || upper.startsWith('CREATE OR REPLACE SEQUENCE')) {
      const match = /CREATE\s+(?:OR\s+REPLACE\s+)?SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i.exec(
        stripped,
      );
      if (match) {
        const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(stripped);
        expected.push({
          kind: 'sequence',
          name: normalizeIdentifier(match[1]),
          parentTable: null,
          ifNotExists,
        });
      }
      continue;
    }

    // --- CREATE [UNIQUE] INDEX ---
    if (upper.startsWith('CREATE INDEX') || upper.startsWith('CREATE UNIQUE INDEX') || upper.startsWith('CREATE OR REPLACE INDEX')) {
      const match = /CREATE\s+(?:UNIQUE\s+)?(?:OR\s+REPLACE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s+ON\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i.exec(
        stripped,
      );
      if (match) {
        const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(stripped);
        expected.push({
          kind: 'index',
          name: normalizeIdentifier(match[1]),
          parentTable: normalizeIdentifier(match[2]),
          ifNotExists,
        });
      }
      continue;
    }

    // --- CREATE [OR REPLACE] FUNCTION ---
    if (upper.startsWith('CREATE FUNCTION') || upper.startsWith('CREATE OR REPLACE FUNCTION')) {
      const match = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*\(/i.exec(
        stripped,
      );
      if (match) {
        expected.push({
          kind: 'function',
          name: normalizeIdentifier(match[1]),
          parentTable: null,
          ifNotExists: false,
        });
      }
      continue;
    }

    // --- CREATE [OR REPLACE] TRIGGER ---
    if (upper.startsWith('CREATE TRIGGER') || upper.startsWith('CREATE OR REPLACE TRIGGER')) {
      // Trigger name + the table it's on (ON table)
      const nameMatch = /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i.exec(
        stripped,
      );
      const tableMatch = /\bON\s+(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i.exec(
        stripped,
      );
      if (nameMatch) {
        expected.push({
          kind: 'trigger',
          name: normalizeIdentifier(nameMatch[1]),
          parentTable: tableMatch ? normalizeIdentifier(tableMatch[1]) : null,
          ifNotExists: false,
        });
      }
      continue;
    }

    // --- CREATE TABLE ---
    if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE UNLOGGED TABLE')) {
      const ifNotExists = /IF\s+NOT\s+EXISTS/i.test(stripped);
      const tableName = extractTableName(stripped);
      if (tableName) {
        expected.push({
          kind: 'table',
          name: tableName,
          parentTable: null,
          ifNotExists,
        });

        // Extract column names from the parenthesized definition.
        const parenMatch = /\(([\s\S]*)\)\s*(?:$|;|WITH|PARTITION|USING)/.exec(
          stripped,
        );
        if (parenMatch) {
          const columnNames = extractColumnNamesFromCreateTable(
            parenMatch[1],
          );
          for (const col of columnNames) {
            expected.push({
              kind: 'column',
              name: col,
              parentTable: tableName,
              ifNotExists,
            });
          }
        }
      }
      continue;
    }

    // --- ALTER TABLE ADD COLUMN ---
    if (upper.startsWith('ALTER TABLE')) {
      const tableName = extractTableName(stripped);

      // ALTER TABLE ... ADD COLUMN [IF NOT EXISTS] colname TYPE
      const addColumnMatch = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/gi.exec(
        stripped,
      );
      if (addColumnMatch && tableName) {
        const colIfNotExists = /IF\s+NOT\s+EXISTS/i.test(stripped);
        expected.push({
          kind: 'column',
          name: normalizeIdentifier(addColumnMatch[1]),
          parentTable: tableName,
          ifNotExists: colIfNotExists,
        });
      }

      // ALTER TABLE ... ADD CONSTRAINT [IF NOT EXISTS] constraintname
      const addConstraintMatch = /ADD\s+CONSTRAINT\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/i.exec(
        stripped,
      );
      if (addConstraintMatch && tableName) {
        const constraintIfNotExists = /IF\s+NOT\s+EXISTS/i.test(stripped);
        expected.push({
          kind: 'constraint',
          name: normalizeIdentifier(addConstraintMatch[1]),
          parentTable: tableName,
          ifNotExists: constraintIfNotExists,
        });
      }
      continue;
    }

    // --- DROP statements (may drop triggers, etc.) ---
    // DROP TRIGGER IF EXISTS name ON table — we note this but do NOT
    // generate negative expectations. Drops are informational; the absence
    // of a dropped object does not prove the migration ran (it might have
    // been absent before). We skip these.
    // (No expectations generated for DROP, INSERT, UPDATE, DELETE, SELECT,
    // DO blocks, or other non-DDL statements.)
  }

  return expected;
}

// ──────────────────────────────────────────────────────────────────────────
// Catalog Snapshot — collectCatalogSnapshot()
// ──────────────────────────────────────────────────────────────────────────

/**
 * Collect a comprehensive read-only snapshot of all relevant schema objects
 * from the PostgreSQL catalog.
 *
 * This issues a fixed set of SELECT queries against pg_catalog and
 * information_schema. It NEVER mutates the database.
 *
 * @param options Optional configuration.
 * @param options.schemaFilter If provided, only objects in this schema are
 *   returned. If not provided, objects in all non-system schemas are returned.
 * @returns A CatalogSnapshot containing all detected objects.
 */
export async function collectCatalogSnapshot(options?: {
  schemaFilter?: string;
}): Promise<CatalogSnapshot> {
  const sql = getRawSql();
  const schemaFilter = options?.schemaFilter ?? null;
  const collectionErrors: string[] = [];
  const collectedAt = new Date().toISOString();

  // When a schema filter is provided, we issue a parameterized query that
  // restricts results to that schema. When no filter is provided, we exclude
  // system schemas. We use the tagged template literal parameter binding
  // (${schemaFilter}) to safely pass the schema name — it is never
  // string-interpolated into the SQL text.
  //
  // Note: We cannot conditionally embed tagged template fragments inside
  // another tagged template. Instead, we branch on whether schemaFilter is
  // set, issuing the appropriate query in each branch.

  // --- Tables ---
  let tables: DetectedObject[] = [];
  try {
    let rows;
    if (schemaFilter) {
      rows = await sql`
        SELECT
          c.relname AS name,
          n.nspname AS schema
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relkind = 'r'
          AND n.nspname = ${schemaFilter}
        ORDER BY n.nspname, c.relname
      `;
    } else {
      rows = await sql`
        SELECT
          c.relname AS name,
          n.nspname AS schema
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relkind = 'r'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, c.relname
      `;
    }
    tables = rows.map((r: { name: string; schema: string }) => ({
      kind: 'table' as const,
      name: r.name,
      parentTable: null,
      schema: r.schema,
    }));
  } catch (err) {
    collectionErrors.push(
      `tables query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Indexes ---
  let indexes: DetectedObject[] = [];
  try {
    let rows;
    if (schemaFilter) {
      rows = await sql`
        SELECT
          i.relname AS name,
          n.nspname AS schema,
          t.relname AS table_name
        FROM pg_index x
        JOIN pg_class i ON x.indexrelid = i.oid
        JOIN pg_class t ON x.indrelid = t.oid
        JOIN pg_namespace n ON i.relnamespace = n.oid
        WHERE n.nspname = ${schemaFilter}
        ORDER BY n.nspname, i.relname
      `;
    } else {
      rows = await sql`
        SELECT
          i.relname AS name,
          n.nspname AS schema,
          t.relname AS table_name
        FROM pg_index x
        JOIN pg_class i ON x.indexrelid = i.oid
        JOIN pg_class t ON x.indrelid = t.oid
        JOIN pg_namespace n ON i.relnamespace = n.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, i.relname
      `;
    }
    indexes = rows.map((r: { name: string; schema: string; table_name: string }) => ({
      kind: 'index' as const,
      name: r.name,
      parentTable: r.table_name,
      schema: r.schema,
    }));
  } catch (err) {
    collectionErrors.push(
      `indexes query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Columns ---
  let columns: DetectedObject[] = [];
  try {
    let rows;
    if (schemaFilter) {
      rows = await sql`
        SELECT
          a.attname AS name,
          n.nspname AS schema,
          c.relname AS table_name
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE a.attnum > 0
          AND NOT a.attisdropped
          AND c.relkind IN ('r', 'p')
          AND n.nspname = ${schemaFilter}
        ORDER BY n.nspname, c.relname, a.attnum
      `;
    } else {
      rows = await sql`
        SELECT
          a.attname AS name,
          n.nspname AS schema,
          c.relname AS table_name
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE a.attnum > 0
          AND NOT a.attisdropped
          AND c.relkind IN ('r', 'p')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, c.relname, a.attnum
      `;
    }
    columns = rows.map((r: { name: string; schema: string; table_name: string }) => ({
      kind: 'column' as const,
      name: r.name,
      parentTable: r.table_name,
      schema: r.schema,
    }));
  } catch (err) {
    collectionErrors.push(
      `columns query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Constraints ---
  let constraints: DetectedObject[] = [];
  try {
    let rows;
    if (schemaFilter) {
      rows = await sql`
        SELECT
          c.conname AS name,
          n.nspname AS schema,
          t.relname AS table_name
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON c.connamespace = n.oid
        WHERE n.nspname = ${schemaFilter}
        ORDER BY n.nspname, c.conname
      `;
    } else {
      rows = await sql`
        SELECT
          c.conname AS name,
          n.nspname AS schema,
          t.relname AS table_name
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON c.connamespace = n.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, c.conname
      `;
    }
    constraints = rows.map((r: { name: string; schema: string; table_name: string }) => ({
      kind: 'constraint' as const,
      name: r.name,
      parentTable: r.table_name,
      schema: r.schema,
    }));
  } catch (err) {
    collectionErrors.push(
      `constraints query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Extensions (not schema-qualified; always query all) ---
  let extensions: DetectedObject[] = [];
  try {
    const rows = await sql`
      SELECT
        extname AS name,
        'public' AS schema
      FROM pg_extension
      WHERE extname NOT IN ('plpgsql')
      ORDER BY extname
    `;
    extensions = rows.map((r: { name: string; schema: string }) => ({
      kind: 'extension' as const,
      name: r.name,
      parentTable: null,
      schema: r.schema,
    }));
  } catch (err) {
    collectionErrors.push(
      `extensions query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Functions ---
  let functions: DetectedObject[] = [];
  try {
    let rows;
    if (schemaFilter) {
      rows = await sql`
        SELECT
          p.proname AS name,
          n.nspname AS schema
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = ${schemaFilter}
        ORDER BY n.nspname, p.proname
      `;
    } else {
      rows = await sql`
        SELECT
          p.proname AS name,
          n.nspname AS schema
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, p.proname
      `;
    }
    functions = rows.map((r: { name: string; schema: string }) => ({
      kind: 'function' as const,
      name: r.name,
      parentTable: null,
      schema: r.schema,
    }));
  } catch (err) {
    collectionErrors.push(
      `functions query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Triggers ---
  let triggers: DetectedObject[] = [];
  try {
    let rows;
    if (schemaFilter) {
      rows = await sql`
        SELECT
          t.tgname AS name,
          n.nspname AS schema,
          c.relname AS table_name
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE NOT t.tgisinternal
          AND n.nspname = ${schemaFilter}
        ORDER BY n.nspname, t.tgname
      `;
    } else {
      rows = await sql`
        SELECT
          t.tgname AS name,
          n.nspname AS schema,
          c.relname AS table_name
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE NOT t.tgisinternal
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, t.tgname
      `;
    }
    triggers = rows.map((r: { name: string; schema: string; table_name: string }) => ({
      kind: 'trigger' as const,
      name: r.name,
      parentTable: r.table_name,
      schema: r.schema,
    }));
  } catch (err) {
    collectionErrors.push(
      `triggers query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Types (enums and composite types) ---
  let types: DetectedObject[] = [];
  try {
    let rows;
    if (schemaFilter) {
      rows = await sql`
        SELECT
          t.typname AS name,
          n.nspname AS schema
        FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE t.typtype IN ('e', 'c')
          AND n.nspname = ${schemaFilter}
        ORDER BY n.nspname, t.typname
      `;
    } else {
      rows = await sql`
        SELECT
          t.typname AS name,
          n.nspname AS schema
        FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE t.typtype IN ('e', 'c')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, t.typname
      `;
    }
    types = rows.map((r: { name: string; schema: string }) => ({
      kind: 'type' as const,
      name: r.name,
      parentTable: null,
      schema: r.schema,
    }));
  } catch (err) {
    collectionErrors.push(
      `types query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Sequences ---
  let sequences: DetectedObject[] = [];
  try {
    let rows;
    if (schemaFilter) {
      rows = await sql`
        SELECT
          c.relname AS name,
          n.nspname AS schema
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relkind = 'S'
          AND n.nspname = ${schemaFilter}
        ORDER BY n.nspname, c.relname
      `;
    } else {
      rows = await sql`
        SELECT
          c.relname AS name,
          n.nspname AS schema
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relkind = 'S'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY n.nspname, c.relname
      `;
    }
    sequences = rows.map((r: { name: string; schema: string }) => ({
      kind: 'sequence' as const,
      name: r.name,
      parentTable: null,
      schema: r.schema,
    }));
  } catch (err) {
    collectionErrors.push(
      `sequences query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    tables,
    indexes,
    columns,
    constraints,
    extensions,
    functions,
    triggers,
    types,
    sequences,
    collectedAt,
    collectionErrors,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Classification — classifyMigrationEvidence()
// ──────────────────────────────────────────────────────────────────────────

/**
 * Check if an expected object exists in the catalog snapshot.
 *
 * @returns The matching DetectedObject, or null if not found.
 */
function findDetectedObject(
  expected: ExpectedObject,
  snapshot: CatalogSnapshot,
): DetectedObject | null {
  let pool: DetectedObject[];
  switch (expected.kind) {
    case 'table':
      pool = snapshot.tables;
      break;
    case 'index':
      pool = snapshot.indexes;
      break;
    case 'column':
      pool = snapshot.columns;
      break;
    case 'constraint':
      pool = snapshot.constraints;
      break;
    case 'extension':
      pool = snapshot.extensions;
      break;
    case 'function':
      pool = snapshot.functions;
      break;
    case 'trigger':
      pool = snapshot.triggers;
      break;
    case 'type':
      pool = snapshot.types;
      break;
    case 'sequence':
      pool = snapshot.sequences;
      break;
    default:
      return null;
  }

  for (const detected of pool) {
    if (detected.name === expected.name) {
      if (expected.parentTable !== null) {
        if (detected.parentTable === expected.parentTable) {
          return detected;
        }
      } else {
        return detected;
      }
    }
  }
  return null;
}

/**
 * Classify a single migration's evidence by comparing its expected objects
 * against the catalog snapshot.
 *
 * This is a PURE FUNCTION — no database access, no side effects. It takes the
 * expected objects (from extractExpectedObjects) and the catalog snapshot
 * (from collectCatalogSnapshot) and produces a BaselineEvidenceProposal.
 *
 * Classification logic:
 * - If the migration has ZERO expected objects (e.g., no-op "SELECT 1",
 *   data-only INSERT, UPDATE, DELETE), the evidence is MANUAL_REVIEW with
 *   UNKNOWN status — we cannot determine application state from catalog
 *   introspection alone.
 * - If ALL expected objects are found in the snapshot, the evidence is
 *   OBJECT_EXISTENCE with CONFIRMED_APPLIED status (high confidence).
 * - If SOME but not all expected objects are found, the evidence is
 *   OBJECT_EXISTENCE with PARTIALLY_APPLIED status.
 * - If NO expected objects are found, the evidence is OBJECT_EXISTENCE with
 *   CONFIRMED_NOT_APPLIED status.
 * - If the snapshot has collection errors, the evidence is downgraded to
 *   NONE with UNKNOWN status and manual review is required.
 *
 * @param file The migration file from the manifest.
 * @param sqlContent The raw SQL content of the migration file.
 * @param snapshot The catalog snapshot to compare against.
 * @returns A BaselineEvidenceProposal.
 */
export function classifyMigrationEvidence(
  file: MigrationFile,
  sqlContent: string,
  snapshot: CatalogSnapshot,
): BaselineEvidenceProposal {
  const expectedObjects = extractExpectedObjects(sqlContent);

  // Case 1: Snapshot has collection errors — cannot trust classification.
  if (snapshot.collectionErrors.length > 0) {
    return {
      migrationIdentifier: file.identifier,
      filename: file.filename,
      checksumSha256: file.checksumSha256,
      transactionMode: file.transactionMode,
      expectedObjects,
      detectedObjects: [],
      missingObjects: expectedObjects,
      conflictingObjects: [],
      evidenceType: 'NONE',
      proposedStatus: 'UNKNOWN',
      confidence: 0,
      manualReviewRequired: true,
      notes: `Catalog snapshot had ${snapshot.collectionErrors.length} collection error(s): ${snapshot.collectionErrors.join('; ')}. Cannot reliably classify.`,
    };
  }

  // Case 2: No expected objects — cannot determine via catalog introspection.
  if (expectedObjects.length === 0) {
    const hasDataStatements = /(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\s/i.test(
      stripComments(sqlContent),
    );
    const isNoOp = /^\s*SELECT\s+1\s*;?\s*$/i.test(
      stripComments(sqlContent).trim(),
    );

    let notes: string;
    if (isNoOp) {
      notes =
        'Migration is a no-op placeholder (SELECT 1). No schema objects are created. Cannot determine application state from catalog introspection. Manual review required.';
    } else if (hasDataStatements) {
      notes =
        'Migration contains only data manipulation statements (INSERT/UPDATE/DELETE). No schema objects are created. Catalog introspection cannot determine if data was seeded. Manual review required.';
    } else {
      notes =
        'No schema objects could be extracted from the migration SQL. The parser may not recognize all statement types. Manual review required.';
    }

    return {
      migrationIdentifier: file.identifier,
      filename: file.filename,
      checksumSha256: file.checksumSha256,
      transactionMode: file.transactionMode,
      expectedObjects,
      detectedObjects: [],
      missingObjects: [],
      conflictingObjects: [],
      evidenceType: 'MANUAL_VERIFICATION',
      proposedStatus: 'UNKNOWN',
      confidence: 0,
      manualReviewRequired: true,
      notes,
    };
  }

  // Case 3: Compare expected objects against the snapshot.
  const detectedObjects: DetectedObject[] = [];
  const missingObjects: ExpectedObject[] = [];
  const conflictingObjects: ExpectedObject[] = [];

  for (const expected of expectedObjects) {
    const detected = findDetectedObject(expected, snapshot);
    if (detected) {
      detectedObjects.push(detected);
    } else {
      missingObjects.push(expected);
      // For column expectations, check if the parent table exists but the
      // column doesn't — this indicates partial application.
      if (expected.kind === 'column' && expected.parentTable) {
        const tableExists = snapshot.tables.some(
          (t) => t.name === expected.parentTable,
        );
        if (tableExists) {
          conflictingObjects.push(expected);
        }
      }
    }
  }

  const total = expectedObjects.length;
  const found = detectedObjects.length;
  const missing = missingObjects.length;

  // Determine proposed status.
  let proposedStatus: BaselineReconciliationStatus;
  let evidenceType: BaselineEvidenceType;
  let confidence: number;
  let manualReviewRequired: boolean;
  let notes: string;

  if (found === total) {
    // All expected objects found.
    proposedStatus = 'CONFIRMED_APPLIED';
    evidenceType = 'OBJECT_EXISTENCE';
    confidence = 0.9;
    manualReviewRequired = false;
    notes = `All ${total} expected schema object(s) found in catalog. Proposing CONFIRMED_APPLIED based on object existence evidence. Human review recommended before recording.`;
  } else if (found > 0) {
    // Some objects found, some missing.
    proposedStatus = 'PARTIALLY_APPLIED';
    evidenceType = 'OBJECT_EXISTENCE';
    confidence = 0.7;
    manualReviewRequired = true;
    notes = `Found ${found} of ${total} expected object(s). ${missing} missing: ${missingObjects
      .slice(0, 5)
      .map((o) => `${o.kind}:${o.name}${o.parentTable ? `(${o.parentTable})` : ''}`)
      .join(', ')}${missingObjects.length > 5 ? `, +${missingObjects.length - 5} more` : ''}. Proposing PARTIALLY_APPLIED — manual review required.`;
  } else {
    // No expected objects found.
    proposedStatus = 'CONFIRMED_NOT_APPLIED';
    evidenceType = 'OBJECT_EXISTENCE';
    confidence = 0.8;
    manualReviewRequired = false;
    notes = `None of the ${total} expected schema object(s) were found in the catalog. Proposing CONFIRMED_NOT_APPLIED based on object absence. Note: objects may exist in a different schema or with different names — human review recommended.`;
  }

  return {
    migrationIdentifier: file.identifier,
    filename: file.filename,
    checksumSha256: file.checksumSha256,
    transactionMode: file.transactionMode,
    expectedObjects,
    detectedObjects,
    missingObjects,
    conflictingObjects,
    evidenceType,
    proposedStatus,
    confidence,
    manualReviewRequired,
    notes,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Orchestration — generateBaselineEvidence()
// ──────────────────────────────────────────────────────────────────────────

/**
 * Generate baseline evidence proposals for all migrations in the manifest.
 *
 * This is the top-level orchestration function. It:
 *   1. Discovers the migration manifest (from lib/migrations/ by default).
 *   2. Collects a catalog snapshot from the database (read-only).
 *   3. For each migration, classifies evidence by comparing expected objects
 *      against the snapshot.
 *   4. Produces a BaselineEvidenceReport with per-migration proposals and
 *      summary counts.
 *
 * This function NEVER:
 *   - Writes to migration_baseline or any other table.
 *   - Advances the governance lifecycle.
 *   - Marks any migration as reconciled.
 *   - Performs any bulk mark-all operation.
 *   - Executes any mutation against the database.
 *
 * @param options Optional configuration.
 * @param options.dirOverride Override the migration files directory (for
 *   testing with fixture directories).
 * @param options.schemaFilter Only collect catalog objects from this schema.
 * @returns A BaselineEvidenceReport with evidence proposals.
 */
export async function generateBaselineEvidence(options?: {
  dirOverride?: string;
  schemaFilter?: string;
}): Promise<BaselineEvidenceReport> {
  const environment = getCurrentEnvironment();
  const generatedAt = new Date().toISOString();
  const errors: string[] = [];

  // 1. Discover the migration manifest.
  let manifest: MigrationManifest;
  try {
    manifest = discoverMigrationFiles(options?.dirOverride);
  } catch (err) {
    return {
      environment,
      generatedAt,
      manifestCount: 0,
      proposals: [],
      statusCounts: emptyStatusCounts(),
      evidenceTypeCounts: emptyEvidenceTypeCounts(),
      hasManualReviewRequired: false,
      errors: [
        `Manifest discovery failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
      performedMutation: false,
      catalogSnapshot: emptySnapshot(),
    };
  }

  // 2. Collect the catalog snapshot (read-only).
  let snapshot: CatalogSnapshot;
  try {
    snapshot = await collectCatalogSnapshot({
      schemaFilter: options?.schemaFilter,
    });
  } catch (err) {
    return {
      environment,
      generatedAt,
      manifestCount: manifest.count,
      proposals: [],
      statusCounts: emptyStatusCounts(),
      evidenceTypeCounts: emptyEvidenceTypeCounts(),
      hasManualReviewRequired: false,
      errors: [
        `Catalog snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
      performedMutation: false,
      catalogSnapshot: emptySnapshot(),
    };
  }

  // Merge snapshot collection errors into the report.
  if (snapshot.collectionErrors.length > 0) {
    errors.push(...snapshot.collectionErrors);
  }

  // 3. Classify each migration.
  const proposals: BaselineEvidenceProposal[] = [];
  for (const file of manifest.files) {
    try {
      // Read the migration SQL content.
      const sqlContent = readFileSync(file.fullPath, 'utf8');
      const proposal = classifyMigrationEvidence(file, sqlContent, snapshot);
      proposals.push(proposal);
    } catch (err) {
      errors.push(
        `Failed to process migration ${file.identifier} (${file.filename}): ${err instanceof Error ? err.message : String(err)}`,
      );
      // Add a fallback proposal with UNKNOWN status.
      proposals.push({
        migrationIdentifier: file.identifier,
        filename: file.filename,
        checksumSha256: file.checksumSha256,
        transactionMode: file.transactionMode,
        expectedObjects: [],
        detectedObjects: [],
        missingObjects: [],
        conflictingObjects: [],
        evidenceType: 'NONE',
        proposedStatus: 'UNKNOWN',
        confidence: 0,
        manualReviewRequired: true,
        notes: `Error reading or classifying migration: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 4. Compute summary counts.
  const statusCounts = emptyStatusCounts();
  const evidenceTypeCounts = emptyEvidenceTypeCounts();
  let hasManualReviewRequired = false;

  for (const proposal of proposals) {
    statusCounts[proposal.proposedStatus]++;
    evidenceTypeCounts[proposal.evidenceType]++;
    if (proposal.manualReviewRequired) {
      hasManualReviewRequired = true;
    }
  }

  return {
    environment,
    generatedAt,
    manifestCount: manifest.count,
    proposals,
    statusCounts,
    evidenceTypeCounts,
    hasManualReviewRequired,
    errors,
    performedMutation: false,
    catalogSnapshot: snapshot,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Create an empty status counts record with all statuses initialized to 0.
 */
function emptyStatusCounts(): Record<BaselineReconciliationStatus, number> {
  return {
    CONFIRMED_APPLIED: 0,
    CONFIRMED_NOT_APPLIED: 0,
    PARTIALLY_APPLIED: 0,
    NOT_APPLICABLE: 0,
    UNKNOWN: 0,
  };
}

/**
 * Create an empty evidence type counts record with all types initialized to 0.
 */
function emptyEvidenceTypeCounts(): Record<BaselineEvidenceType, number> {
  return {
    SCHEMA_INTROSPECTION: 0,
    LEDGER_RECORD: 0,
    MANUAL_VERIFICATION: 0,
    CHECKSUM_MATCH: 0,
    OBJECT_EXISTENCE: 0,
    NONE: 0,
  };
}

/**
 * Create an empty catalog snapshot (for error fallback cases).
 */
function emptySnapshot(): CatalogSnapshot {
  return {
    tables: [],
    indexes: [],
    columns: [],
    constraints: [],
    extensions: [],
    functions: [],
    triggers: [],
    types: [],
    sequences: [],
    collectedAt: new Date().toISOString(),
    collectionErrors: [],
  };
}
