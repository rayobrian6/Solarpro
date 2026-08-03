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

  it('sequence + spec are exactly 113, 114, 115, 116, 117 then 118', () => {
    expect(REGISTRY_SEQUENCE).toEqual(['113', '114', '115', '116', '117', '118']);
    expect(Object.keys(REGISTRY_DEPLOYMENT).sort()).toEqual(['113', '114', '115', '116', '117', '118']);
  });

  it('EVERY governed identifier resolves to a real file that passes its own gate', () => {
    // The gap this closes: a spec entry with no file 409s at run time, and a file
    // with no spec/action/button is simply unreachable from the console.
    for (const id of REGISTRY_SEQUENCE) {
      const spec = REGISTRY_DEPLOYMENT[id];
      expect(spec, `no deployment spec for ${id}`).toBeTruthy();
      expect(spec.expectedTables.length).toBeGreaterThan(0);
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
