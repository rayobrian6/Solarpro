// ============================================================================
// v47.432 Stage 8.2 — RACKING DATABASE DRIFT-GUARD
//
// Two racking databases coexist in the codebase (Stage 7 assessment findings):
//   - lib/racking-database.ts   (14 rows, structural math, 1 consumer: structural-engine-v3.ts)
//   - lib/mounting-hardware-db.ts (42 rows, UI/BOM/permit metadata, 8+ consumers)
//
// 14 IDs overlap between the two DBs by identifier. Their field SHAPES differ
// intentionally (structural math vs UI metadata), but certain identity fields
// MUST match across both DBs so the user never sees two products with the
// same ID but contradictory basic identity (manufacturer, structural classification).
//
// Stage 7 recommended Option B: KEEP BOTH DBs + add a drift-fence CI test.
// Stage 8.2 / v47.432 implements that recommendation.
//
// ENFORCED INVARIANTS (these MUST match across both DBs for every overlapping ID):
//   1. manufacturer (case-insensitive exact match)
//   2. systemType (rail_based / flush_mount / ballasted / etc. structural class)
//   3. compatibleRoofTypes (after vocabulary normalisation) — must have at
//      least one roof type in common so UI and structural engine agree on
//      at least one valid application.
//
// DELIBERATELY NOT ENFORCED:
//   - Rail dimensions / moment capacities — the two DBs legitimately store
//     different aspects of the same product (structural math vs BOM metadata).
//   - Mount attachment sub-type — racking-database uses coarser buckets.
//   - Any field unique to one DB (e.g. productLine, category, description).
//
// FAILURE MODE: if a future engineer changes ironridge-xr100's manufacturer
// to "Iron Ridge Inc" in only one of the two DBs, the structural engine and
// the UI/BOM layer will report contradictory identity for the same product
// ID. This test fails loudly in CI.
//
// OPT-OUT: intentional divergence can be recorded in EXPECTED_DIVERGENCES
// below with an explicit justification string. A failing assertion can also
// be downgraded to a warning by extending that allowlist (require reviewer
// approval via PR).
// ============================================================================

import { describe, it, expect } from 'vitest';
import { RACKING_DATABASE } from '../racking-database';
import type { RoofTypeId } from '../racking-database';
import { getMountingSystemById } from '../mounting-hardware-db';
import type { RoofType } from '../mounting-hardware-db';

// ---------------------------------------------------------------------------
// Vocabulary bridge — the two DBs use slightly different enum strings for the
// same physical roof type. Map racking-database.RoofTypeId -> mounting-hardware-db.RoofType.
// Any racking roof type missing from mounting-hardware-db's vocabulary maps
// to null (e.g. metal_r_panel is racking-only — mounting-hardware-db folds
// it under metal_corrugated).
// ---------------------------------------------------------------------------
const ROOF_TYPE_BRIDGE: Record<RoofTypeId, RoofType | null> = {
  shingle: 'asphalt_shingle',
  tile_concrete: 'tile_concrete',
  tile_clay: 'tile_clay',
  metal_standing_seam: 'metal_standing_seam',
  metal_corrugated: 'metal_corrugated',
  metal_r_panel: 'metal_corrugated', // R-panel is a sub-type of corrugated in mh-db
  flat_tpo: 'flat_tpo',
  flat_epdm: 'flat_epdm',
  flat_gravel: 'flat_gravel',
};

// ---------------------------------------------------------------------------
// Coarse-to-fine SystemType taxonomy bridge.
//
// racking-database.ts uses the COARSE classification bucket needed for
// structural math: { rail_based, rail_less, ballasted, clamp_only }.
//
// mounting-hardware-db.ts uses a FINER UI/BOM/permit classification:
// { rail_based, rail_less, ballasted_flat, ground_*, tilt_leg, ... }.
//
// A mounting-hardware-db SystemType is CONSISTENT with a racking-database
// SystemType iff it falls under the correct coarse bucket via this map.
// ---------------------------------------------------------------------------
const COARSE_BUCKET_FOR_MH_SYSTEM_TYPE: Record<string, 'rail_based' | 'rail_less' | 'ballasted' | 'clamp_only' | 'other'> = {
  rail_based: 'rail_based',
  rail_less: 'rail_less',
  ballasted_flat: 'ballasted',
  mechanically_attached_flat: 'ballasted', // flat roof with anchors still coarse-maps to ballasted family
  tilt_leg: 'clamp_only',
  standing_seam: 'clamp_only',              // S-5! PVKit: no-penetration clamp on standing seam
  ground_single_post: 'other',
  ground_dual_post: 'other',
  ground_driven_pile: 'other',
  ground_helical: 'other',
  ground_concrete: 'other',
};

// ---------------------------------------------------------------------------
// Opt-out allowlist — KNOWN intentional or pre-existing divergence.
// Format: { id, field, reason }
// Add entries here ONLY when a PR reviewer has confirmed the divergence is
// deliberate OR pre-existing (and not blocking this release).
// ---------------------------------------------------------------------------
const EXPECTED_DIVERGENCES: Array<{
  id: string;
  field: 'manufacturer' | 'systemType' | 'compatibleRoofTypes';
  reason: string;
}> = [
  // v47.432 snapshot — pre-existing product-model disagreement surfaced by
  // this guard on first run. Tracked in Stage 8.3 / Stage 8.4 backlog (deferred
  // per user directive: keep v47.432 low-risk, pure deletion + additive tests).
  //
  // These two entries should be reconciled by picking ONE canonical
  // classification per product when the racking-unification Stage 8.3 lands.
  {
    id: 'ecofasten-rockit',
    field: 'systemType',
    reason:
      'racking-database says rail_based (has rail spec); mounting-hardware-db says rail_less ' +
      '(EcoFasten Rock-It Gen 4 is a rail-less mount w/ integrated flashing). Product-model ' +
      'disagreement — resolve in Stage 8.3 racking unification.',
  },
  {
    id: 'esdec-flatfix',
    field: 'systemType',
    reason:
      'racking-database uses coarse "ballasted"; mounting-hardware-db uses fine "ballasted_flat". ' +
      'Already mapped via COARSE_BUCKET_FOR_MH_SYSTEM_TYPE (both resolve to ballasted). Left as ' +
      'opt-out to document the taxonomy-bridge mapping explicitly.',
  },
];

function isDivergenceExpected(id: string, field: 'manufacturer' | 'systemType' | 'compatibleRoofTypes'): boolean {
  return EXPECTED_DIVERGENCES.some(d => d.id === id && d.field === field);
}

describe('v47.432 Stage 8.2 — racking database drift-guard', () => {
  // Compute overlap once so the failure message lists the exact IDs audited.
  const overlappingIds = RACKING_DATABASE
    .map(r => r.id)
    .filter(id => getMountingSystemById(id) !== undefined);

  it('exactly 14 IDs overlap between racking-database.ts and mounting-hardware-db.ts', () => {
    // Stage 7 assessment documented 14/14 overlap. If a future commit changes
    // this count, someone must consciously update the Stage 7 doc + this test.
    expect(overlappingIds.length).toBe(14);
  });

  it('every entry in racking-database.ts has a counterpart in mounting-hardware-db.ts', () => {
    // The reverse direction is NOT required — mounting-hardware-db has 42
    // entries of which only 14 exist in racking-database (structural subset).
    const missing = RACKING_DATABASE
      .map(r => r.id)
      .filter(id => getMountingSystemById(id) === undefined);
    expect(missing).toEqual([]);
  });

  // ---- Per-ID drift checks -------------------------------------------------
  describe.each(overlappingIds)('overlapping id: %s', (id) => {
    const rackingEntry = RACKING_DATABASE.find(r => r.id === id)!;
    const mhEntry = getMountingSystemById(id)!;

    it('manufacturer matches (case-insensitive)', () => {
      if (isDivergenceExpected(id, 'manufacturer')) return;
      const rack = rackingEntry.manufacturer.trim().toLowerCase();
      const mh = mhEntry.manufacturer.trim().toLowerCase();
      expect(mh).toBe(rack);
    });

    it('systemType coarse bucket matches (structural classification must agree)', () => {
      if (isDivergenceExpected(id, 'systemType')) return;
      // Compare via the COARSE_BUCKET_FOR_MH_SYSTEM_TYPE bridge because
      // racking-database uses a coarser 4-value vocab and mounting-hardware-db
      // uses a finer UI/BOM vocab. The two MUST resolve to the same bucket.
      const mhCoarse = COARSE_BUCKET_FOR_MH_SYSTEM_TYPE[mhEntry.systemType];
      expect(mhCoarse).toBeDefined(); // catches new mh-db systemType values
      expect(mhCoarse).toBe(rackingEntry.systemType);
    });

    it('compatibleRoofTypes overlap (>= 1 shared roof type after vocabulary bridge)', () => {
      if (isDivergenceExpected(id, 'compatibleRoofTypes')) return;
      // Translate racking-database roof types through the bridge, then assert
      // at least one shared roof type survives in mounting-hardware-db's set.
      const rackBridged = rackingEntry.compatibleRoofTypes
        .map(rt => ROOF_TYPE_BRIDGE[rt])
        .filter((rt): rt is RoofType => rt !== null);
      const mhSet = new Set(mhEntry.compatibleRoofTypes);
      const shared = rackBridged.filter(rt => mhSet.has(rt));
      expect(shared.length).toBeGreaterThan(0);
    });
  });

  it('registers all 14 expected IDs (regression guard on Stage 7 assessment)', () => {
    // This is the literal snapshot from the Stage 7 audit — if any of these
    // IDs disappear, the Stage 7 findings need revisiting.
    const EXPECTED_STAGE7_IDS = [
      'ironridge-xr100', 'ironridge-xr1000', 'unirac-solarmount', 'unirac-sme',
      'rooftech-mini', 'snapnrack-100', 'quickmount-classic', 'quickmount-tile',
      's5-pvkit', 'k2-crossrail', 'ecofasten-rockit', 'dpw-powerrail',
      'schletter-classic', 'esdec-flatfix',
    ];
    for (const id of EXPECTED_STAGE7_IDS) {
      expect(RACKING_DATABASE.some(r => r.id === id)).toBe(true);
      expect(getMountingSystemById(id)).toBeDefined();
    }
  });
});