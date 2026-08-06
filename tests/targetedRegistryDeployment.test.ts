/**
 * Pure (no-database) tests for the targeted authority-registry deployment
 * verification module (lib/migrations/targetedRegistryDeployment.ts).
 *
 * These exercise analyzeRegistryMigration against the REAL migration 113/114 SQL
 * as shipped, plus synthetic destructive/non-idempotent/wrong-table inputs. No
 * PostgreSQL required — always runs.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeRegistryMigration,
  REGISTRY_DEPLOYMENT,
  REGISTRY_SEQUENCE,
} from '../lib/migrations/targetedRegistryDeployment';
import { TARGETED_RECOVERY_ALLOWLIST, isTargetedPermitValid } from '../lib/migrations/runner';
import { discoverMigrationFiles } from '../lib/migrations/manifest';

const SQL_113 = readFileSync(join(process.cwd(), 'lib', 'migrations', '113_manufacturer_document_registry.sql'), 'utf8');
const SQL_114 = readFileSync(join(process.cwd(), 'lib', 'migrations', '114_equipment_reconciliation_audit.sql'), 'utf8');
const SQL_115 = readFileSync(join(process.cwd(), 'lib', 'migrations', '115_project_personnel_roles.sql'), 'utf8');
const SQL_117 = readFileSync(join(process.cwd(), 'lib', 'migrations', '117_ahj_registry.sql'), 'utf8');
const SQL_118 = readFileSync(join(process.cwd(), 'lib', 'migrations', '118_field_route_measurements.sql'), 'utf8');
const SQL_119 = readFileSync(join(process.cwd(), 'lib', 'migrations', '119_document_jurisdiction_authority.sql'), 'utf8');

describe('targetedRegistryDeployment — static analysis (pure)', () => {
  it('accepts the real migration 113 (creates manufacturer_document_registry)', () => {
    const s = analyzeRegistryMigration('113', SQL_113, REGISTRY_DEPLOYMENT['113'].expectedTables);
    expect(s.ok).toBe(true);
    expect(s.problems).toEqual([]);
    expect(s.idempotent).toBe(true);
    expect(s.nonDestructive).toBe(true);
    expect(s.tablesMatchExpected).toBe(true);
    expect(s.createdTables).toEqual(['manufacturer_document_registry']);
    expect(s.forbiddenFound).toEqual([]);
  });

  it('accepts the real migration 114 (creates both audit tables)', () => {
    const s = analyzeRegistryMigration('114', SQL_114, REGISTRY_DEPLOYMENT['114'].expectedTables);
    expect(s.ok).toBe(true);
    expect(s.problems).toEqual([]);
    expect(s.idempotent).toBe(true);
    expect(s.nonDestructive).toBe(true);
    expect(s.tablesMatchExpected).toBe(true);
    expect(new Set(s.createdTables)).toEqual(new Set(['equipment_reconciliation_audit', 'snapshot_digest_invalidations']));
  });

  it('accepts the real migration 115 (creates both personnel tables) — AAC WS-6', () => {
    const s = analyzeRegistryMigration('115', SQL_115, REGISTRY_DEPLOYMENT['115'].expectedTables);
    expect(s.ok).toBe(true);
    expect(s.problems).toEqual([]);
    expect(s.idempotent).toBe(true);
    expect(s.nonDestructive).toBe(true);
    expect(s.tablesMatchExpected).toBe(true);
    expect(new Set(s.createdTables)).toEqual(new Set(['personnel_roles', 'project_personnel_assignments']));
    expect(s.forbiddenFound).toEqual([]);
  });

  // TAC WS-19 — migration 117 (ahj_registry) was written but had NO console card,
  // no API action and no deployment spec, so it was UNRUNNABLE: the operator saw
  // buttons for 113-116 only. These pin the whole wiring path.
  it('accepts the real migration 117 (creates ahj_registry)', () => {
    const s = analyzeRegistryMigration('117', SQL_117, REGISTRY_DEPLOYMENT['117'].expectedTables);
    expect(s.problems).toEqual([]);
    expect(s.ok).toBe(true);
    expect(s.idempotent).toBe(true);
    expect(s.nonDestructive).toBe(true);
    expect(s.tablesMatchExpected).toBe(true);
    expect(new Set(s.createdTables)).toEqual(new Set(['ahj_registry']));
    expect(s.forbiddenFound).toEqual([]);
  });

  it('117 seeds NO rows — a seeded adoption would be authority the registry did not earn', () => {
    // Strip SQL line comments (the header prose is long) before scanning.
    const body = SQL_117.split(String.fromCharCode(10)).map(l => l.replace(/--.*$/, '')).join(' ');
    expect(/\bINSERT\b/i.test(body)).toBe(false);
    expect(/\bALTER\b/i.test(body)).toBe(false);
  });

  // WS-5 — migration 118 (field_route_measurements + field_route_measurement_events).
  // Two tables on purpose: the domain audit must commit in the SAME transaction
  // as the transition it records, which the best-effort compliance audit_log
  // cannot promise. The FK columns carry NO ON-DELETE clause because the static
  // gate forbids the DELETE token — that omission is deliberate, not an oversight.
  it('accepts the real migration 118 (creates both field-measurement tables) — WS-5', () => {
    const s = analyzeRegistryMigration('118', SQL_118, REGISTRY_DEPLOYMENT['118'].expectedTables);
    expect(s.problems).toEqual([]);
    expect(s.ok).toBe(true);
    expect(s.idempotent).toBe(true);
    expect(s.nonDestructive).toBe(true);
    expect(s.tablesMatchExpected).toBe(true);
    expect(new Set(s.createdTables)).toEqual(new Set(['field_route_measurements', 'field_route_measurement_events']));
    expect(s.forbiddenFound).toEqual([]);
  });

  it('118 seeds NO rows — a seeded measurement would be field evidence nobody gathered', () => {
    const body = SQL_118.split(String.fromCharCode(10)).map(l => l.replace(/--.*$/, '')).join(' ');
    expect(/\bINSERT\b/i.test(body)).toBe(false);
    expect(/\bALTER\b/i.test(body)).toBe(false);
  });

  it('118 defaults a new measurement to REPORTED_UNVERIFIED and refuses a verified row with no verifier', () => {
    // The two storage-layer facts that make "operator entry is not authority"
    // structural rather than a code convention.
    expect(SQL_118).toContain("verification_state        TEXT NOT NULL DEFAULT 'REPORTED_UNVERIFIED'");
    expect(SQL_118).toContain('ck_frm_verified_complete');
    expect(SQL_118).toMatch(/verification_state <> 'VERIFIED'[\s\S]{0,200}verified_by_user_id IS NOT NULL/);
    expect(SQL_118).toMatch(/verification_state <> 'VERIFIED'[\s\S]{0,200}verification_mode IS NOT NULL/);
  });

  it('sequence is 107 FIRST, then 113 … 119', () => {
    // 107 leads deliberately: it repairs the durable audit path that every other
    // migration's governance event is recorded through.
    expect(REGISTRY_SEQUENCE).toEqual(['107', '113', '114', '115', '116', '117', '118', '119']);
    expect(Object.keys(REGISTRY_DEPLOYMENT).sort()).toEqual(['107', '113', '114', '115', '116', '117', '118', '119']);
  });

  it('EVERY governed identifier resolves to a real file that passes its own gate', () => {
    // The gap this closes: a spec entry with no file 409s at run time, and a file
    // with no spec/action/button is simply unreachable from the console.
    //
    // A spec must declare SOMETHING to deploy — tables or columns. 119 is the
    // first with no table, and asserting `expectedTables.length > 0` here would
    // have been the fifth gate it silently failed.
    for (const id of REGISTRY_SEQUENCE) {
      const spec = REGISTRY_DEPLOYMENT[id];
      expect(spec, `no deployment spec for ${id}`).toBeTruthy();
      const declares = spec.expectedTables.length + (spec.expectedColumns?.length ?? 0);
      expect(declares, `spec ${id} declares neither a table nor a column`).toBeGreaterThan(0);
    }
  });

  // ── THE ADD-COLUMN SHAPE (119) ────────────────────────────────────────────
  // Migration 119 was authored 2026-08-05 and reported as "created, not applied"
  // while registered in NONE of the four gates — no spec, no API action, no
  // console button, not on the runner allowlist. It could not be applied by
  // anybody. Worse, its SHAPE was inadmissible: the static verifier rejected the
  // bare token ALTER, so registering it alone would not have been enough.
  it('accepts the real migration 119 (adds ONE nullable column + a partial index)', () => {
    const spec = REGISTRY_DEPLOYMENT['119'];
    const s = analyzeRegistryMigration('119', SQL_119, spec.expectedTables, spec.expectedColumns);
    expect(s.problems).toEqual([]);
    expect(s.ok).toBe(true);
    expect(s.kind).toBe('add-column');
    expect(s.addedColumns).toEqual(['manufacturer_document_registry.jurisdiction_authority_id']);
    expect(s.columnsMatchExpected).toBe(true);
    expect(s.nonDestructive).toBe(true);
    // and it must genuinely not backfill — the four live rows keep their value
    expect(SQL_119).not.toMatch(/UPDATE/i);
    expect(SQL_119).not.toMatch(/INSERT/i);
  });

  it('refuses an ALTER that is anything other than ADD COLUMN IF NOT EXISTS', () => {
    const cols = [{ table: 'manufacturer_document_registry', column: 'x' }];
    for (const sql of [
      'ALTER TABLE manufacturer_document_registry DROP COLUMN x;',
      'ALTER TABLE manufacturer_document_registry RENAME COLUMN a TO x;',
      'ALTER TABLE manufacturer_document_registry ALTER COLUMN x TYPE INTEGER;',
      'ALTER TABLE manufacturer_document_registry ADD COLUMN x TEXT;',   // not idempotent
    ]) {
      const s = analyzeRegistryMigration('T', sql, [], cols);
      expect(s.ok, `should refuse: ${sql}`).toBe(false);
    }
  });

  it('refuses an admitted ADD COLUMN that carries a default or a constraint', () => {
    const cols = [{ table: 'manufacturer_document_registry', column: 'x' }];
    for (const clause of ["TEXT NOT NULL", "TEXT DEFAULT 'a'", 'TEXT UNIQUE', 'TEXT REFERENCES t(id)', 'TEXT PRIMARY KEY']) {
      const s = analyzeRegistryMigration('T',
        `ALTER TABLE manufacturer_document_registry ADD COLUMN IF NOT EXISTS x ${clause};`, [], cols);
      expect(s.ok, `should refuse clause: ${clause}`).toBe(false);
    }
    // the bare nullable column IS admitted — a catalog-only change
    expect(analyzeRegistryMigration('T',
      'ALTER TABLE manufacturer_document_registry ADD COLUMN IF NOT EXISTS x TEXT;', [], cols).ok).toBe(true);
  });

  it('refuses an ADD COLUMN on a table no allowlisted migration deploys', () => {
    const s = analyzeRegistryMigration('T',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin TEXT;',
      [], [{ table: 'users', column: 'is_admin' }]);
    expect(s.ok).toBe(false);
    expect(s.problems.join(' ')).toMatch(/no allowlisted migration deploys/);
  });

  // ── REACHABILITY: the half of the sentence above that was never asserted ───
  // The test above says a migration with no "spec/action/button" is unreachable
  // from the console — then only checked the SPEC. Migration 118 shipped with a
  // spec, an allowlisted action and a server handler, and NO operator button, so
  // it was executable by the system and reachable by nobody. That is the exact
  // defect class WS-5 exists to fix, reappearing one layer down in the operator
  // surface. These two assertions close it for every identifier, not just 118.
  it('EVERY governed identifier has an allowlisted API action', () => {
    const route = readFileSync(
      join(process.cwd(), 'app/api/admin/migrations/route.ts'), 'utf8');
    const missing = REGISTRY_SEQUENCE.filter(id => {
      // the action name varies per migration; the identifier is what must appear
      // inside an allowlisted `execute-…-<id>` action string.
      const re = new RegExp(`'execute-[a-z0-9-]*${id}'`);
      return !re.test(route);
    });
    expect(missing, `no allowlisted execute action for: ${missing.join(', ')}`).toEqual([]);
  });

  it('EVERY governed identifier has an operator button in the governed console', () => {
    const page = readFileSync(
      join(process.cwd(), 'app/admin/system-tools/migrations/page.tsx'), 'utf8');
    const missing = REGISTRY_SEQUENCE.filter(id => !new RegExp(`RegistryButton\\s+id="${id}"`).test(page));
    expect(missing, `no console button for migration(s): ${missing.join(', ')} — `
      + 'the migration would be executable by the system and reachable by no operator').toEqual([]);
    // and each button must name the SAME tables the deployment spec expects, so a
    // button cannot advertise something the gate would refuse.
    for (const id of REGISTRY_SEQUENCE) {
      // The window is a source-scan convenience, not a contract. 107's button
      // carries a longer label and a two-column `tables` string and legitimately
      // runs past 400 characters; a silently-empty match then made this assertion
      // read as "the button does not name its column" when the button was fine.
      const btn = page.match(new RegExp(`RegistryButton\\s+id="${id}"[\\s\\S]{0,800}?/>`))?.[0] ?? '';
      expect(btn, `could not locate the RegistryButton block for ${id}`).not.toBe('');
      for (const t of REGISTRY_DEPLOYMENT[id].expectedTables) {
        expect(btn, `button ${id} does not name expected table ${t}`).toContain(t);
      }
      // an ADD-COLUMN button must name the column it adds, for the same reason:
      // a button may not advertise something the gate would refuse.
      for (const c of REGISTRY_DEPLOYMENT[id].expectedColumns ?? []) {
        expect(btn, `button ${id} does not name expected column ${c.column}`).toContain(c.column);
      }
    }
  });

  it('does NOT trip on the word DELETE appearing inside a comment', () => {
    // 114's header prose says a snapshot "must NOT be treated as authoritative"
    // — string/comment stripping must keep the analysis clean. (Regression: a
    // naive scan would flag prose.)
    const s = analyzeRegistryMigration('114', SQL_114, REGISTRY_DEPLOYMENT['114'].expectedTables);
    expect(s.forbiddenFound).toEqual([]);
  });

  it('rejects a destructive statement (DROP)', () => {
    const bad = `CREATE TABLE IF NOT EXISTS manufacturer_document_registry (id TEXT PRIMARY KEY);\nDROP TABLE old_registry;`;
    const s = analyzeRegistryMigration('113', bad, ['manufacturer_document_registry']);
    expect(s.ok).toBe(false);
    expect(s.nonDestructive).toBe(false);
    expect(s.forbiddenFound).toContain('DROP');
  });

  it('rejects a data-seeding INSERT', () => {
    const bad = `CREATE TABLE IF NOT EXISTS equipment_reconciliation_audit (id TEXT PRIMARY KEY);\nCREATE TABLE IF NOT EXISTS snapshot_digest_invalidations (id TEXT PRIMARY KEY);\nINSERT INTO equipment_reconciliation_audit (id) VALUES ('x');`;
    const s = analyzeRegistryMigration('114', bad, ['equipment_reconciliation_audit', 'snapshot_digest_invalidations']);
    expect(s.ok).toBe(false);
    expect(s.forbiddenFound).toContain('INSERT');
  });

  it('rejects a non-idempotent CREATE TABLE (missing IF NOT EXISTS)', () => {
    const bad = `CREATE TABLE manufacturer_document_registry (id TEXT PRIMARY KEY);`;
    const s = analyzeRegistryMigration('113', bad, ['manufacturer_document_registry']);
    expect(s.ok).toBe(false);
    expect(s.idempotent).toBe(false);
  });

  it('rejects a non-idempotent CREATE INDEX (missing IF NOT EXISTS)', () => {
    const bad = `CREATE TABLE IF NOT EXISTS manufacturer_document_registry (id TEXT PRIMARY KEY, status TEXT);\nCREATE INDEX idx_x ON manufacturer_document_registry (status);`;
    const s = analyzeRegistryMigration('113', bad, ['manufacturer_document_registry']);
    expect(s.ok).toBe(false);
    expect(s.problems.some((p) => /CREATE INDEX/.test(p))).toBe(true);
  });

  it('rejects when the migration creates an unexpected table', () => {
    const bad = `CREATE TABLE IF NOT EXISTS manufacturer_document_registry (id TEXT PRIMARY KEY);\nCREATE TABLE IF NOT EXISTS something_else (id TEXT PRIMARY KEY);`;
    const s = analyzeRegistryMigration('113', bad, ['manufacturer_document_registry']);
    expect(s.ok).toBe(false);
    expect(s.tablesMatchExpected).toBe(false);
    expect(s.problems.some((p) => /unexpected table/.test(p))).toBe(true);
  });

  it('rejects when an expected table is missing', () => {
    // 114 spec expects two tables; only one created.
    const bad = `CREATE TABLE IF NOT EXISTS equipment_reconciliation_audit (id TEXT PRIMARY KEY);`;
    const s = analyzeRegistryMigration('114', bad, ['equipment_reconciliation_audit', 'snapshot_digest_invalidations']);
    expect(s.ok).toBe(false);
    expect(s.problems.some((p) => /snapshot_digest_invalidations/.test(p))).toBe(true);
  });
});

// ═══ FOUR-GATE PARITY ═══════════════════════════════════════════════
// A targeted identifier must pass FOUR independent gates to be runnable:
//   1. REGISTRY_DEPLOYMENT spec (expected tables)
//   2. a migration FILE in the canonical manifest
//   3. an API action + console button (app-level; covered by the route/page)
//   4. runner.TARGETED_RECOVERY_ALLOWLIST — the permit allowlist
// Migration 117 had 1, 2 and 3 and NOT 4. The permit was rejected, the lifecycle
// gate then refused execution, and the operator saw MIGRATION_BASELINE_REQUIRED
// — an error that says nothing about an allowlist. These tests make that
// specific drift impossible to ship again.
describe('targeted deployment — four-gate parity', () => {
  it('every governed identifier is on the runner permit allowlist', () => {
    for (const id of REGISTRY_SEQUENCE) {
      expect(TARGETED_RECOVERY_ALLOWLIST.has(id),
        `migration ${id} has a deployment spec but is NOT on TARGETED_RECOVERY_ALLOWLIST — its permit will be `
        + 'rejected and the run will fail with MIGRATION_BASELINE_REQUIRED').toBe(true);
    }
  });

  it('the allowlist holds nothing the deployment spec does not govern', () => {
    for (const id of TARGETED_RECOVERY_ALLOWLIST) {
      expect(REGISTRY_DEPLOYMENT[id], `${id} is permit-runnable but has no deployment spec / static gate`).toBeTruthy();
    }
  });

  it('every governed identifier resolves to a real file in the canonical manifest', () => {
    const manifest = discoverMigrationFiles();
    for (const id of REGISTRY_SEQUENCE) {
      expect(manifest.files.some(f => f.identifier === id), `migration ${id} is governed but absent from the manifest`).toBe(true);
    }
  });

  it('a valid permit is accepted for EVERY governed identifier', () => {
    for (const id of REGISTRY_SEQUENCE) {
      const permit = { identifier: id, issuedAtMs: Date.now(), ttlMs: 3 * 60 * 1000, reason: 'parity test' };
      expect(isTargetedPermitValid(permit, id), `permit rejected for ${id}`).toBe(true);
    }
  });

  it('a permit still cannot cross identifiers or cover an ungoverned one', () => {
    const permit = { identifier: '117', issuedAtMs: Date.now(), ttlMs: 60_000, reason: 'x' };
    expect(isTargetedPermitValid(permit, '116')).toBe(false);   // identifier mismatch
    expect(isTargetedPermitValid({ ...permit, identifier: '102' }, '102')).toBe(false); // not allowlisted
    expect(isTargetedPermitValid({ ...permit, ttlMs: 60 * 60 * 1000 }, '117')).toBe(false); // TTL over cap
    expect(isTargetedPermitValid({ ...permit, issuedAtMs: Date.now() - 120_000 }, '117')).toBe(false); // expired
  });
});
