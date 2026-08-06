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
/** What a targeted migration is permitted to do, and to what.
 *
 *  TWO SHAPES, both equally narrow:
 *   • CREATE-TABLE — `expectedTables` names the tables it creates, and it may
 *     create nothing else.
 *   • ADD-COLUMN  — `expectedColumns` names the columns it adds to an ALREADY
 *     DEPLOYED table, and it may add nothing else and alter nothing else.
 *
 *  WHY THE SECOND SHAPE EXISTS (2026-08-06). Migration 119 adds one nullable
 *  column to `manufacturer_document_registry` and one partial index. It is
 *  additive, idempotent (`ADD COLUMN IF NOT EXISTS`), touches no row, and
 *  explicitly refuses to backfill — every property this gate exists to require.
 *  It was nevertheless UNRUNNABLE: the static verifier rejected the bare token
 *  `ALTER`, `REGISTRY_DEPLOYMENT` had no way to express "a column, not a table",
 *  and the identifier was absent from all four gates. So a migration was written,
 *  committed and reported as "created, not applied" that the operator had no path
 *  to apply at all.
 *
 *  The gate's INTENT was always "pure additive, idempotent, non-destructive,
 *  seeds nothing". `CREATE TABLE only` was how that intent happened to be
 *  implemented, because until now it was all that had been needed. The admission
 *  below is written to the intent, and it is narrower than the token ban it
 *  replaces: an `ALTER` is admitted ONLY as `ADD COLUMN IF NOT EXISTS`, ONLY on a
 *  table another allowlisted migration created, and ONLY with no column
 *  constraint of any kind (see ALTER_SUBCOMMAND_BAN). Every other ALTER — DROP
 *  COLUMN, RENAME, TYPE, SET, a DEFAULT, a constraint — is still refused. */
export interface RegistryDeploymentSpec {
  /** Tables this migration CREATEs. Empty for an ADD-COLUMN migration. */
  expectedTables: string[];
  /** Columns this migration ADDs. Absent/empty for a CREATE-TABLE migration. */
  expectedColumns?: Array<{ table: string; column: string }>;
  /** A PRE-EXISTING table this migration may alter, one no allowlisted migration
   *  created. Declaring it is a deliberate, reviewable act: the default rule is
   *  that this path may only alter tables it deployed itself, and 107's target
   *  (`audit_log`, from migration 100) predates the whole registry. Naming it
   *  here keeps that exception explicit and per-migration instead of widening
   *  the rule for everything. */
  altersPreexistingTables?: string[];
}

export const REGISTRY_DEPLOYMENT: Record<string, RegistryDeploymentSpec> = {
  // 2026-07-12 / ADR-013 T-08 — the org-context columns on audit_log, and the
  // most consequential entry in this table.
  //
  // WHY IT IS HERE. Commit d479cbda added `actor_organization_id` /
  // `resource_owner_organization_id` to lib/auditLog.ts's INSERT together with
  // this migration. The migration was never applied: it predates 108, so it sits
  // in the ~27-migration historical baseline the global execution gate refuses,
  // and nothing ever brought it through the targeted path. From that commit on,
  // every audit write from that code inserted 17 columns into a 16-column table
  // and PostgreSQL refused it — so the tamper-evident audit trail recorded
  // NOTHING from the dev deployment, including the governance events for
  // migrations 113 and 119. It surfaced only as `AUDIT_PERSISTENCE_FAILED` with
  // no stated cause.
  //
  // Production (master) still runs the pre-d479cbda writer, which is the only
  // reason auth events kept landing. Merging dev to master WITHOUT this
  // migration would take the whole audit_log dark — the SOC 2 CC7.2 / ISO 27001
  // A.12.4 control, silently.
  //
  // Same additive shape as 119: two `ADD COLUMN IF NOT EXISTS`, two
  // `CREATE INDEX IF NOT EXISTS`, two COMMENTs, no row written and no backfill.
  // Its target predates the registry, so `altersPreexistingTables` names it
  // explicitly rather than the gate quietly permitting any table.
  '107': {
    expectedTables: [],
    expectedColumns: [
      { table: 'audit_log', column: 'actor_organization_id' },
      { table: 'audit_log', column: 'resource_owner_organization_id' },
    ],
    altersPreexistingTables: ['audit_log'],
  },
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
  // TAC WS-19 (2026-07-29) — SolarPro's OWN central AHJ / adopted-code registry.
  // The "AHJ registry" the app serves today is the bundled TypeScript table
  // lib/jurisdictions/ahj-national.ts: ~4,000 records that carry an NEC year and
  // NOTHING ELSE — no IBC/IRC/IFC adoption, no effective dates, no source URLs,
  // no hashes — so it can never clear CODE-AUTHORITY-INCOMPLETE, and the only
  // other provider was an EXTERNAL registry behind AHJ_REGISTRY_TOKEN. This table
  // makes SolarPro's own Neon registry the first provider consulted and retains
  // retrievals + governed operator verifications centrally (research once →
  // retain → version with evidence → reuse for every project in that AHJ).
  //
  // Same migration shape as 113-116: pure additive CREATE TABLE / CREATE INDEX
  // IF NOT EXISTS, no ALTER, no DO block, no seeded rows and — critically — no
  // seeded ADOPTION (a copied in-code row is retained as
  // provenance='seeded-unprovenanced', which the provider REFUSES to serve as
  // authority). So it goes through the same statically-verified,
  // identifier-scoped permit. Independent of 113-116; order does not matter.
  '117': { expectedTables: ['ahj_registry'] },
  // WS-5 (2026-08-02) — field_route_measurements + field_route_measurement_events:
  // the PRODUCER that the 'field-verified' route-length state never had. WS-5
  // part 1 taught the model to SAY field-verified; nothing could make it say so,
  // so ROUTE-LENGTH-ESTIMATE was structurally unclosable. Two tables because the
  // domain audit must commit in the SAME transaction as the state transition it
  // records (the compliance audit_log is best-effort by design and swallows its
  // own write failure, so it cannot be the durable record of a domain change).
  //
  // Same migration shape as 113-117: pure additive CREATE TABLE / CREATE INDEX
  // IF NOT EXISTS, no ALTER, no DO block, no seeded rows and — critically — no
  // seeded MEASUREMENT and no path from configuration to a verified length. The
  // foreign keys carry no ON-DELETE clause because the static gate below forbids
  // the DELETE token outright. Independent of 113-117; order does not matter.
  '118': { expectedTables: ['field_route_measurements', 'field_route_measurement_events'] },
  // D4 (2026-08-05) — jurisdiction_authority_id on manufacturer_document_registry:
  // the STABLE legal-AHJ identity beside the free-text display name, so document
  // applicability stops being decided by comparing two prose strings (a check an
  // ampersand could defeat). The FIRST migration here that is not a CREATE TABLE.
  //
  // It adds ONE nullable column and ONE partial index, both IF NOT EXISTS, and
  // it deliberately does NOT backfill the four existing rows: their stored
  // jurisdiction is wrong, and correcting it is a governed data act with its own
  // before/after capture, not a silent side effect of a schema change. They keep
  // the column NULL, which the resolver reads as "identity unknown, fall back to
  // normalised-name comparison" — exactly today's behaviour. Nothing regresses
  // and nothing is quietly repaired.
  //
  // Its target table is created by 113, which is on this same allowlist — the
  // ADD-COLUMN admission requires that, so this path can never alter a table
  // nothing here deployed.
  '119': {
    expectedTables: [],
    expectedColumns: [{ table: 'manufacturer_document_registry', column: 'jurisdiction_authority_id' }],
  },
};

/** The migration identifiers this module governs, in ceremony order.
 *  107 is FIRST, deliberately: it repairs the durable audit path that every
 *  other migration's governance event is recorded through, so running it first
 *  means the rest are actually auditable. 119 is last because its target table
 *  is 113's. */
export const REGISTRY_SEQUENCE = ['107', '113', '114', '115', '116', '117', '118', '119'] as const;

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

/** The ADD-COLUMN shape's token ban: the same list, minus the one token this
 *  shape exists to admit. `ALTER` is not waved through — every ALTER statement
 *  must additionally match ADD_COLUMN_STMT below, and nothing else. */
const FORBIDDEN_TOKENS_ADD_COLUMN = FORBIDDEN_TOKENS.filter(t => t !== 'ALTER');

/** THE only ALTER statement form this module will ever admit:
 *      ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <column> <type>;
 *  Schema qualification is allowed on the table. The type is captured so the
 *  ban below can be applied to it. */
const ADD_COLUMN_STMT =
  /^\s*ALTER\s+TABLE\s+(?:[A-Za-z_][\w$]*\.)?([A-Za-z_][\w$]*)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][\w$]*)\s+([^;]*)$/i;

/** Forbidden inside an admitted ADD COLUMN's type clause.
 *
 *  A bare nullable column with no default is a catalog-only change: PostgreSQL
 *  does not rewrite the table and no existing row is touched. Each of these
 *  would break one of those properties or reach beyond the column —
 *  NOT NULL fails on a non-empty table, DEFAULT/GENERATED/IDENTITY write values
 *  into every existing row, and a constraint or reference changes what other
 *  tables may contain. None of them is needed by an additive identity column,
 *  and a migration that wants one is not this shape. */
const ALTER_SUBCOMMAND_BAN = [
  'NOT NULL', 'DEFAULT', 'GENERATED', 'IDENTITY', 'PRIMARY KEY',
  'UNIQUE', 'REFERENCES', 'CHECK', 'CONSTRAINT', 'COLLATE', 'USING',
];

export interface RegistryMigrationShape {
  identifier: string;
  /** Which narrow shape this migration was analysed as. */
  kind: 'create-table' | 'add-column';
  /** Table names created via CREATE TABLE (IF NOT EXISTS) in the file. */
  createdTables: string[];
  /** The tables the caller expects this migration to create. */
  expectedTables: string[];
  /** `table.column` pairs added via ALTER TABLE … ADD COLUMN IF NOT EXISTS. */
  addedColumns: string[];
  /** The `table.column` pairs the caller expects this migration to add. */
  expectedColumns: string[];
  /** The added columns exactly match the expected set. */
  columnsMatchExpected: boolean;
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
  /** ADD-COLUMN shape only. Omitted ⇒ the CREATE-TABLE shape, unchanged. */
  expectedColumns?: Array<{ table: string; column: string }>,
  /** Tables another allowlisted migration creates. An ADD COLUMN is admitted
   *  only against one of these, so this path can never alter a table it did not
   *  deploy. Omitted ⇒ derived from REGISTRY_DEPLOYMENT. */
  deployedTables?: string[],
  /** PRE-EXISTING tables this specific migration declared it may alter. */
  altersPreexistingTables?: string[],
): RegistryMigrationShape {
  const problems: string[] = [];
  const body = stripCommentsAndStrings(sql);

  // ── THE ADD-COLUMN SHAPE ────────────────────────────────────────────────
  if (expectedColumns && expectedColumns.length > 0) {
    return analyzeAddColumnMigration(identifier, body, expectedColumns, deployedTables, problems, altersPreexistingTables);
  }

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
    kind: 'create-table',
    createdTables,
    expectedTables: expected,
    addedColumns: [],
    expectedColumns: [],
    columnsMatchExpected: true,
    idempotent,
    tablesMatchExpected,
    nonDestructive,
    forbiddenFound,
    ok: problems.length === 0,
    problems,
  };
}

/** Every table any allowlisted CREATE-TABLE migration deploys — the only tables
 *  an ADD COLUMN here may target. */
export function deployedRegistryTables(): string[] {
  return [...new Set(
    Object.values(REGISTRY_DEPLOYMENT).flatMap(s => s.expectedTables.map(t => t.toLowerCase())),
  )];
}

/**
 * THE ADD-COLUMN analysis. Narrower than the CREATE-TABLE one, not looser:
 * every ALTER statement in the file must match ADD_COLUMN_STMT exactly, target a
 * table this module deploys, carry no constraint or default, and add exactly the
 * expected columns. Anything else — a second ALTER form, an unexpected column, a
 * CREATE TABLE, a bare CREATE INDEX — is a problem.
 */
function analyzeAddColumnMigration(
  identifier: string,
  body: string,
  expectedColumns: Array<{ table: string; column: string }>,
  deployedTables: string[] | undefined,
  problems: string[],
  altersPreexistingTables?: string[],
): RegistryMigrationShape {
  // The default set is what this path deployed itself. A migration may add a
  // PRE-EXISTING table only by declaring it in its own spec — an explicit,
  // reviewable exception rather than a blanket widening.
  const deployed = new Set([
    ...(deployedTables ?? deployedRegistryTables()),
    ...(altersPreexistingTables ?? []),
  ].map(t => t.toLowerCase()));
  const expected = expectedColumns.map(c => `${c.table.toLowerCase()}.${c.column.toLowerCase()}`);

  // Statement-by-statement, so a second ALTER cannot hide behind a first.
  const statements = body.split(';').filter(s => s.trim());
  const addedColumns: string[] = [];
  let idempotent = true;

  for (const stmt of statements) {
    if (!/\bALTER\b/i.test(stmt)) continue;
    const m = stmt.match(ADD_COLUMN_STMT);
    if (!m) {
      idempotent = false;
      problems.push(
        `Migration ${identifier} contains an ALTER that is not a bare `
        + `'ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <c> <type>': ${stmt.trim().replace(/\s+/g, ' ').slice(0, 120)}`);
      continue;
    }
    const [, table, column, typeClause] = m;
    if (!deployed.has(table.toLowerCase())) {
      problems.push(
        `Migration ${identifier} adds a column to '${table}', which no allowlisted migration deploys. `
        + 'This path may only alter tables it created, or one its spec names explicitly.');
    }
    const banned = ALTER_SUBCOMMAND_BAN.filter(tok =>
      new RegExp(`\\b${tok.replace(/\s+/g, '\\s+')}\\b`, 'i').test(typeClause));
    if (banned.length) {
      problems.push(
        `Migration ${identifier} adds '${table}.${column}' with disallowed clause(s): ${banned.join(', ')}. `
        + 'An admitted column is nullable with no default, so no existing row is written and no table is rewritten.');
    }
    addedColumns.push(`${table.toLowerCase()}.${column.toLowerCase()}`);
  }

  if (addedColumns.length === 0) {
    problems.push(`Migration ${identifier} adds no column — not the expected additive-column deployment.`);
  }

  // A column migration creates no table.
  if (/\bCREATE\s+TABLE\b/i.test(body)) {
    problems.push(`Migration ${identifier} is declared as an additive-column migration but contains CREATE TABLE.`);
  }
  // Same idempotency rule for indexes as the other shape.
  if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS)/i.test(body)) {
    problems.push(`Migration ${identifier} has a CREATE INDEX that is not written IF NOT EXISTS (not idempotent).`);
  }

  const missing = expected.filter(c => !addedColumns.includes(c));
  const unexpected = addedColumns.filter(c => !expected.includes(c));
  if (missing.length) problems.push(`Migration ${identifier} does not add expected column(s): ${missing.join(', ')}.`);
  if (unexpected.length) problems.push(`Migration ${identifier} adds unexpected column(s): ${unexpected.join(', ')}.`);

  const forbiddenFound = FORBIDDEN_TOKENS_ADD_COLUMN.filter(tok =>
    new RegExp(`\\b${tok.replace(/\s+/g, '\\s+')}\\b`, 'i').test(body));
  const nonDestructive = forbiddenFound.length === 0;
  if (!nonDestructive) {
    problems.push(`Migration ${identifier} contains destructive/mutating/seeding token(s): ${forbiddenFound.join(', ')}.`);
  }

  return {
    identifier,
    kind: 'add-column',
    createdTables: [],
    expectedTables: [],
    addedColumns: [...new Set(addedColumns)],
    expectedColumns: expected,
    columnsMatchExpected: missing.length === 0 && unexpected.length === 0,
    idempotent: idempotent && problems.length === 0,
    tablesMatchExpected: true,
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

export interface ColumnsStateCheck {
  allPresent: boolean;
  nonePresent: boolean;
  presentColumns: string[];
  absentColumns: string[];
  /** Columns whose TABLE does not exist — a different failure from "the column
   *  is missing", and the one that means a prerequisite migration has not run. */
  missingTables: string[];
}

/** The ADD-COLUMN counterpart of `verifyTablesState`. Read-only.
 *
 *  It reports a missing TABLE separately from a missing COLUMN, because those
 *  call for different actions: the first means the prerequisite CREATE-TABLE
 *  migration has not been run, and applying this one would fail. */
export async function verifyColumnsState(
  columns: Array<{ table: string; column: string }>,
): Promise<ColumnsStateCheck> {
  const sql = getRawSql();
  const present: string[] = [];
  const absent: string[] = [];
  const missingTables: string[] = [];
  for (const c of columns) {
    const key = `${c.table}.${c.column}`;
    const t = (await sql`SELECT to_regclass(${c.table}) IS NOT NULL AS present`) as Array<{ present: boolean }>;
    if (t[0]?.present !== true) { missingTables.push(c.table); absent.push(key); continue; }
    const rows = (await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = ${c.table} AND column_name = ${c.column}
      LIMIT 1
    `) as unknown[];
    if (rows.length > 0) present.push(key); else absent.push(key);
  }
  return {
    allPresent: absent.length === 0 && present.length === columns.length,
    nonePresent: present.length === 0,
    presentColumns: present,
    absentColumns: absent,
    missingTables: [...new Set(missingTables)],
  };
}
