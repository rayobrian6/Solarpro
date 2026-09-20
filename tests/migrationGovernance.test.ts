/**
 * tests/migrationGovernance.test.ts
 *
 * AN ORPHANED MIGRATION MUST NOT BE ABLE TO EXIST SILENTLY.
 *
 * WHAT THIS CORRECTS
 * ------------------
 * It was believed that `121_app_feature_flags.sql` "sits on disk unrunnable"
 * because TARGETED_RECOVERY_ALLOWLIST stops at '120'. That reading is wrong,
 * and the distinction matters enough to pin:
 *
 *   • TARGETED_RECOVERY_ALLOWLIST is a NARROW ESCAPE HATCH. It lists the
 *     identifiers that may be executed one at a time under a bounded permit,
 *     BYPASSING the global execution window. Its own doc comment says
 *     "NOTHING else — not any historical migration, not 'all pending' — can be
 *     run through the targeted path." It is not a registry of runnable
 *     migrations.
 *   • The NORMAL path discovers migrations by scanning lib/migrations/ via
 *     discoverMigrationFiles(). Anything in that directory is visible to it.
 *
 * So 121 is runnable through the normal System Tools path and does NOT belong
 * on the allowlist — adding it would widen a recovery escape hatch for a
 * migration that needs no recovery.
 *
 * What was genuinely missing is this file: nothing asserted that every .sql on
 * disk is actually reachable by SOME path. A migration could be added, be
 * invisible to the runner, and nobody would learn until a feature silently
 * failed against a missing table — which is how the feature-flag store ended up
 * believed-orphaned in the first place.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { discoverMigrationFiles } from '@/lib/migrations/manifest';
import { TARGETED_RECOVERY_ALLOWLIST } from '@/lib/migrations/runner';
import { REGISTRY_SEQUENCE } from '@/lib/migrations/targetedRegistryDeployment';

const MIGRATIONS_DIR = join(process.cwd(), 'lib', 'migrations');
const sqlFiles = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
const manifest = discoverMigrationFiles();

/** Strip SQL comments so a word in prose cannot fail a destructive-op check. */
function sqlBody(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
}

describe('no migration can be orphaned', () => {
  it('there is at least one migration to govern', () => {
    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  it('🚨 EVERY .sql on disk is discovered by the production runner', () => {
    // This is the assertion that would have prevented the confusion. If a file
    // is added and the runner cannot see it, this fails immediately rather than
    // at 2am against a missing table.
    const discovered = new Set(manifest.files.map(f => f.filename));
    const missing = sqlFiles.filter(f => !discovered.has(f));
    expect(missing, `these .sql files exist but the runner cannot see them: ${missing.join(', ')}`).toEqual([]);
  });

  it('the runner discovers nothing that is not on disk', () => {
    const onDisk = new Set(sqlFiles);
    const phantom = manifest.files.map(f => f.filename).filter(f => !onDisk.has(f));
    expect(phantom).toEqual([]);
  });

  it('every filename carries a numeric identifier', () => {
    for (const f of sqlFiles) {
      expect(f, `${f} does not start with a numeric identifier`).toMatch(/^\d+_/);
    }
  });

  it('🚨 every file gets a UNIQUE executable identifier, duplicates included', () => {
    // Two files DO share the prefix 074:
    //   074_photo_vision_jobs_dedup_index.sql
    //   074_photo_vision_jobs_render_job_id.sql
    // That is handled, not broken — the manifest disambiguates them to 074a and
    // 074b so each remains separately addressable. The property that actually
    // matters is that no two files collapse onto ONE identifier, which would
    // make "has 074 run?" unanswerable and could execute one while recording
    // the other.
    const ids = manifest.files.map(f => f.identifier);
    expect(new Set(ids).size, `identifier collision among: ${ids.join(', ')}`).toBe(ids.length);
    expect(ids.length).toBe(sqlFiles.length);
  });

  it('shared prefixes are reported as duplicates rather than hidden', () => {
    // The manifest surfaces them so an operator can see why 074 has two cards.
    const dupPrefixes = Object.keys(manifest.duplicates ?? {});
    const prefixCounts = new Map<string, number>();
    for (const f of sqlFiles) {
      const p = f.split('_')[0];
      prefixCounts.set(p, (prefixCounts.get(p) ?? 0) + 1);
    }
    const shared = [...prefixCounts.entries()].filter(([, n]) => n > 1).map(([p]) => p);
    expect(dupPrefixes.sort()).toEqual(shared.sort());
  });
});

describe('121 specifically — the migration believed orphaned', () => {
  const FILE = '121_app_feature_flags.sql';

  it('exists on disk', () => {
    expect(sqlFiles).toContain(FILE);
  });

  it('IS discovered by the production runner — it was never orphaned', () => {
    expect(manifest.files.map(f => f.filename)).toContain(FILE);
  });

  it('is deliberately NOT on the targeted recovery allowlist', () => {
    // Correct: the allowlist is a bypass for recovery targets, not a list of
    // what may run. 121 needs no bypass.
    expect(TARGETED_RECOVERY_ALLOWLIST.has('121')).toBe(false);
  });

  it('is idempotent — safe to run twice', () => {
    const body = sqlBody(FILE);
    const creates = body.match(/CREATE\s+(TABLE|INDEX)/gi) ?? [];
    const guarded = body.match(/CREATE\s+(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS/gi) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    expect(guarded.length, 'every CREATE must be IF NOT EXISTS').toBe(creates.length);
  });

  it('is non-destructive — no DROP, DELETE, TRUNCATE or ALTER', () => {
    const body = sqlBody(FILE).toUpperCase();
    for (const op of ['DROP ', 'DELETE ', 'TRUNCATE', 'ALTER ']) {
      expect(body.includes(op), `121 must not contain ${op.trim()}`).toBe(false);
    }
  });

  it('seeds no rows — a flag nobody set must not arrive switched on', () => {
    expect(sqlBody(FILE).toUpperCase().includes('INSERT ')).toBe(false);
  });
});

describe('every migration in the governed era is non-destructive', () => {
  // The runner's policy is plain idempotent DDL. A destructive statement
  // reaching production through System Tools would be unrecoverable.
  //
  // 🚨 Scoped to identifier >= 100, the governed era. TWO historical migrations
  // predate the policy and legitimately delete rows, both de-duplicating a
  // table immediately before adding a UNIQUE constraint:
  //     003_productions_enhancements.sql   DELETE FROM productions p1 USING ...
  //     042_utility_unique_site_aliases.sql DELETE FROM utility_policies a USING ...
  // They already ran years ago and rewriting history would be worse than
  // recording it. They are named here rather than excluded silently, so the
  // exception list is visible and cannot quietly grow.
  const PRE_GOVERNANCE_DESTRUCTIVE = new Set([
    '003_productions_enhancements.sql',
    '042_utility_unique_site_aliases.sql',
  ]);
  const GOVERNED_FROM = 100;

  const DESTRUCTIVE = [
    /\bDROP\s+TABLE\b/i,
    /\bDROP\s+COLUMN\b/i,
    /\bDROP\s+DATABASE\b/i,
    /\bTRUNCATE\b/i,
    /\bDELETE\s+FROM\b/i,
  ];

  const governed = sqlFiles.filter(f => Number(f.split('_')[0]) >= GOVERNED_FROM);

  it('there are governed migrations to check', () => {
    expect(governed.length).toBeGreaterThan(0);
  });

  for (const file of governed) {
    it(`${file} performs no destructive schema operation`, () => {
      const body = sqlBody(file);
      for (const re of DESTRUCTIVE) {
        expect(re.test(body), `${file} contains ${re}`).toBe(false);
      }
    });
  }

  it('the historical exception list has not grown', () => {
    // If a pre-100 migration is ever edited to add a destructive statement, or
    // a new exception is added, this fails and forces the conversation.
    const offenders = sqlFiles
      .filter(f => Number(f.split('_')[0]) < GOVERNED_FROM)
      .filter(f => DESTRUCTIVE.some(re => re.test(sqlBody(f))));
    expect(new Set(offenders)).toEqual(PRE_GOVERNANCE_DESTRUCTIVE);
  });
});

describe('the targeted escape hatch stays in parity with its registry', () => {
  it('allowlist and REGISTRY_SEQUENCE describe the same set', () => {
    // The four gates a targeted identifier must pass can drift; this is what
    // keeps them from drifting again. 117 was unrunnable for exactly that
    // reason, with no hint to the operator that an allowlist was the cause.
    expect([...TARGETED_RECOVERY_ALLOWLIST].sort()).toEqual([...REGISTRY_SEQUENCE].sort());
  });

  it('every allowlisted identifier resolves to a real file', () => {
    const ids = new Set(sqlFiles.map(f => f.split('_')[0]));
    for (const id of TARGETED_RECOVERY_ALLOWLIST) {
      expect(ids.has(id), `allowlisted ${id} has no .sql file`).toBe(true);
    }
  });

  it('the allowlist is not treated as "everything runnable"', () => {
    // If someone ever "fixes" orphaning by dumping every identifier onto the
    // allowlist, this fails: the escape hatch must stay narrower than the
    // directory it bypasses the execution window for.
    expect(TARGETED_RECOVERY_ALLOWLIST.size).toBeLessThan(sqlFiles.length);
  });
});
