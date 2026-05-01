/**
 * TOMBSTONE — Phase B1 DB Consolidation
 *
 * This file was the drift-fence CI test introduced in v47.432 Stage 8.2 to
 * enforce consistency between the two coexisting racking databases:
 *   - lib/racking-database.ts   (14 rows, structural math)
 *   - lib/mounting-hardware-db.ts (29+ rows, UI/BOM/permit metadata)
 *
 * Phase B1 (v60.4):
 *   - lib/racking-database.ts deleted
 *   - structural-engine-v3.ts now reads from lib/mounting-hardware-db.ts
 *     via lib/mounting/adapter.ts (getRackingSpecById)
 *   - The two-DB divergence problem this test was guarding against no longer
 *     exists — there is a single source of truth.
 *
 * The invariants this test enforced (manufacturer, systemType, compatibleRoofTypes
 * consistency) are now structurally impossible to violate because there is only
 * one database. The adapter normalises field names and enum values at query time
 * with console.warn('[HW MAP FALLBACK]') guards for any unmapped values.
 *
 * Do not restore this file. It has been superseded by the consolidation.
 * If cross-field consistency between adapter output and raw DB records needs
 * regression coverage, add snapshot tests in rackingEcosystemSmoke.test.ts.
 */

import { describe, it } from 'vitest';

describe('rackingDatabaseDriftGuard (tombstoned)', () => {
  it('is retired — racking-database.ts has been deleted, single DB now governs', () => {
    // Intentionally empty. The dual-DB state this guard protected against
    // has been resolved by Phase B1 consolidation.
    // See lib/mounting/adapter.ts and lib/mounting-hardware-db.ts.
  });
});