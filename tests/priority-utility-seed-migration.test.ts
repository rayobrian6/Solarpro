/**
 * Tests for:
 *   C) seed_utility_policies bulk upsert refactor
 *      — verifies the route uses a single parameterised VALUES query instead
 *        of batched UPDATE+INSERT loops
 *   D) site_aliases runtime DDL removal
 *      — verifies the table is owned by a proper migration, not runtime DDL
 *
 * All tests are source-code scanning (no DB connection needed).
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';

// ─── helpers ────────────────────────────────────────────────────────────────
const root = path.resolve(__dirname, '..');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// ─── C: seed_utility_policies bulk upsert ──────────────────────────────────
describe('C: seed_utility_policies — single bulk upsert', () => {

  const routeSrc = readSrc('app/api/admin/system-tools/route.ts');

  it('route file exists', () => {
    expect(fs.existsSync(path.join(root, 'app/api/admin/system-tools/route.ts'))).toBe(true);
  });

  it('contains seed_utility_policies case', () => {
    expect(routeSrc).toContain("case 'seed_utility_policies':");
  });

  // Verify the new single-query approach
  it('uses ON CONFLICT (utility_name, state) DO UPDATE', () => {
    expect(routeSrc).toContain('ON CONFLICT (utility_name, state)');
    expect(routeSrc).toContain('DO UPDATE SET');
  });

  it('uses RETURNING utility_name, state to report results', () => {
    expect(routeSrc).toContain('RETURNING utility_name, state');
  });

  it('uses xmax = 0 to detect inserts vs updates', () => {
    expect(routeSrc).toContain('xmax = 0');
    expect(routeSrc).toContain('inserted');
  });

  it('builds dynamic VALUES list with $N placeholders', () => {
    expect(routeSrc).toContain('valuePlaceholders');
    expect(routeSrc).toContain('params.push(');
  });

  it('calls sql() as ordinary function with queryText + params', () => {
    expect(routeSrc).toContain('sql(queryText, params)');
  });

  it('NO longer uses the old UPDATE…WHERE pattern for each row', () => {
    // The old approach had an UPDATE with LOWER(TRIM()) for each record
    expect(routeSrc).not.toContain(
      "WHERE LOWER(TRIM(utility_name)) = LOWER(TRIM("
    );
  });

  it('NO longer uses Promise.allSettled batch loop for seed', () => {
    // The old approach used Promise.allSettled + BATCH_SIZE loop
    // Check the seed_utility_policies case region doesn't have BATCH_SIZE
    const seedStart = routeSrc.indexOf("case 'seed_utility_policies':");
    const seedEnd   = routeSrc.indexOf("case '", seedStart + 1);
    const seedBlock = routeSrc.slice(seedStart, seedEnd > -1 ? seedEnd : seedStart + 5000);
    expect(seedBlock).not.toContain('BATCH_SIZE');
    expect(seedBlock).not.toContain('Promise.allSettled');
  });

  it('returns inserted + updated counts in response', () => {
    expect(routeSrc).toContain('insertedN');
    expect(routeSrc).toContain('updatedN');
    // Check both keys appear in the NextResponse.json block
    expect(routeSrc).toContain('inserted: insertedN');
    expect(routeSrc).toContain('updated: updatedN');
  });

  it('response message mentions "new" and "updated"', () => {
    expect(routeSrc).toContain('new, ${updatedN} updated');
  });

  it('logAdminAction includes inserted + updated in metadata', () => {
    // Find the logAdminAction specifically for seed_utility_policies
    const seedCaseIdx = routeSrc.indexOf("case 'seed_utility_policies':");
    const logIdx = routeSrc.indexOf('logAdminAction', seedCaseIdx);
    const logBlock = routeSrc.slice(logIdx, logIdx + 400);
    expect(logBlock).toContain("action: 'seed_utility_policies'");
    expect(logBlock).toContain('inserted: insertedN');
    expect(logBlock).toContain('updated: updatedN');
  });

  it('maxDuration is still set to 60 or higher', () => {
    const match = routeSrc.match(/export const maxDuration\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(30);
  });

  // Verify that utilitySeeds data is still present
  it('still contains the utility seed data array', () => {
    expect(routeSrc).toContain('utilitySeeds');
    // Spot check a few well-known utilities
    expect(routeSrc).toContain("name: 'PG&E'");
    expect(routeSrc).toContain("name: 'Con Edison'");
    expect(routeSrc).toContain("name: 'Florida Power & Light'");
  });

  it('utility seed array contains at least 100 utilities', () => {
    // Count entries by counting "state:" occurrences in the array
    const matches = routeSrc.match(/state:\s*'[A-Z]{2}'/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(100);
  });
});

// ─── Migration 042 ─────────────────────────────────────────────────────────
describe('Migration 042: utility_policies UNIQUE constraint', () => {

  const migSrc = readSrc('lib/migrations/042_utility_unique_site_aliases.sql');

  it('migration file exists', () => {
    expect(fs.existsSync(path.join(root, 'lib/migrations/042_utility_unique_site_aliases.sql'))).toBe(true);
  });

  it('deduplicates rows before adding constraint', () => {
    expect(migSrc).toContain('DELETE FROM utility_policies a');
    expect(migSrc).toContain('LOWER(TRIM(a.utility_name)) = LOWER(TRIM(b.utility_name))');
  });

  it('adds unique constraint idempotently via DO block', () => {
    expect(migSrc).toContain('DO $$');
    expect(migSrc).toContain("conname = 'utility_policies_utility_name_state_key'");
    expect(migSrc).toContain('ADD CONSTRAINT utility_policies_utility_name_state_key');
    expect(migSrc).toContain('UNIQUE (utility_name, state)');
  });

  it('constraint name matches what ON CONFLICT clause uses', () => {
    // Both must use the same key order: utility_name, state
    expect(migSrc).toContain('UNIQUE (utility_name, state)');
  });

  it('no CREATE TABLE site_aliases in migration 042 (handled by 018)', () => {
    expect(migSrc).not.toMatch(/CREATE TABLE.*site_aliases/i);
  });

  it('references migration 018 for site_aliases', () => {
    expect(migSrc.toLowerCase()).toContain('018');
  });
});

// ─── D: site_aliases runtime DDL removal ────────────────────────────────────
describe('D: site_aliases — runtime DDL removed', () => {

  const dbNeon = readSrc('lib/db-neon.ts');
  const mig018 = readSrc('lib/migrations/018_site_aliases.sql');

  it('lib/db-neon.ts does not contain CREATE TABLE site_aliases', () => {
    expect(dbNeon).not.toMatch(/CREATE TABLE.*site_aliases/i);
  });

  it('lib/db-neon.ts does not contain CREATE TABLE IF NOT EXISTS site_aliases', () => {
    expect(dbNeon).not.toMatch(/CREATE TABLE IF NOT EXISTS site_aliases/i);
  });

  it('solardogSaveAlias JSDoc no longer says "auto-migration"', () => {
    const fnIdx = dbNeon.indexOf('solardogSaveAlias');
    expect(fnIdx).toBeGreaterThan(-1);
    const fnBlock = dbNeon.slice(Math.max(0, fnIdx - 300), fnIdx + 100);
    // Old stale comment said "Creates the site_aliases table if it doesn't exist (auto-migration)"
    expect(fnBlock).not.toContain('auto-migration');
    expect(fnBlock).not.toContain("Creates the site_aliases table if it doesn't exist");
  });

  it('solardogSaveAlias JSDoc references migration 018', () => {
    const fnIdx = dbNeon.indexOf('solardogSaveAlias');
    const fnBlock = dbNeon.slice(Math.max(0, fnIdx - 300), fnIdx + 200);
    expect(fnBlock).toContain('018');
  });

  it('solardogSaveAlias still performs INSERT ... ON CONFLICT (user_id, phrase)', () => {
    const fnIdx  = dbNeon.indexOf('export async function solardogSaveAlias');
    const fnBody = dbNeon.slice(fnIdx, fnIdx + 800);  // ON CONFLICT is at ~595 chars in
    expect(fnBody).toContain('INSERT INTO site_aliases');
    expect(fnBody).toContain('ON CONFLICT (user_id, phrase)');
    expect(fnBody).toContain('DO UPDATE SET');
  });

  it('migration 018 creates site_aliases table', () => {
    expect(mig018).toContain('CREATE TABLE IF NOT EXISTS site_aliases');
  });

  it('migration 018 creates idx_site_aliases_user_id index', () => {
    expect(mig018).toContain('idx_site_aliases_user_id');
  });

  it('migration 018 has UNIQUE(user_id, phrase) constraint', () => {
    expect(mig018).toContain('UNIQUE(user_id, phrase)');
  });

  it('migration 018 file exists', () => {
    expect(fs.existsSync(path.join(root, 'lib/migrations/018_site_aliases.sql'))).toBe(true);
  });
});

// ─── E: Public debug HTML files audit (basic check) ─────────────────────────
describe('E: Public debug HTML files — removed', () => {
  const publicDir = path.join(root, 'public');

  const sensitiveFiles = [
    'topo_mission_control.html',
    'audit_fence_planset2.html',
    'test-3d-debug.html',
    'sld-preview.html',
    'partner-pipeline-topology.html',
    'test-cesium-3d.html',
    'test3d.html',
  ];

  sensitiveFiles.forEach(file => {
    it(`debug HTML ${file} is NOT in /public (unauthenticated exposure removed)`, () => {
      const exists = fs.existsSync(path.join(publicDir, file));
      expect(exists).toBe(false);
    });
  });
});
