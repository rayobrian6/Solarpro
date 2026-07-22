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

const SQL_113 = readFileSync(join(process.cwd(), 'lib', 'migrations', '113_manufacturer_document_registry.sql'), 'utf8');
const SQL_114 = readFileSync(join(process.cwd(), 'lib', 'migrations', '114_equipment_reconciliation_audit.sql'), 'utf8');

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

  it('sequence + spec are exactly 113 then 114', () => {
    expect(REGISTRY_SEQUENCE).toEqual(['113', '114']);
    expect(Object.keys(REGISTRY_DEPLOYMENT).sort()).toEqual(['113', '114']);
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
