/**
 * TOMBSTONE — Phase B1 DB Consolidation
 *
 * This file was the regression guard for lib/racking-database.ts (14 systems,
 * structural-engine-v3.ts consumer only).
 *
 * Phase B1 (v60.4):
 *   - structural-engine-v3.ts switched to lib/mounting-hardware-db.ts via
 *     lib/mounting/adapter.ts (adaptToRackingSpec / getRackingSpecById)
 *   - lib/racking-database.ts deleted — single source of truth is now
 *     lib/mounting-hardware-db.ts (29 systems, superset)
 *
 * The structural integrity locks are now covered by:
 *   - lib/system/rackingEcosystemSmoke.test.ts (end-to-end V3 smoke)
 *   - lib/system/rackingDatabaseDriftGuard.test.ts — also retired (see that file)
 *
 * Do not restore this file. If you need structural output regression locks,
 * add cases to rackingEcosystemSmoke.test.ts against the adapter output.
 */

import { describe, it } from 'vitest';

describe('racking-database (tombstoned)', () => {
  it('is retired — see lib/mounting/adapter.ts for the replacement', () => {
    // Intentionally empty. racking-database.ts has been deleted.
    // Structural DB is now lib/mounting-hardware-db.ts + lib/mounting/adapter.ts.
  });
});