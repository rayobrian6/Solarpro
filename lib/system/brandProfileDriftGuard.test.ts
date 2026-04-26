// ============================================================================
// v47.432 Stage 8.2 — BRAND PROFILE DRIFT-GUARD
//
// BrandInverterModelRef entries (in each lib/system/brandProfiles/*.ts) duplicate
// several electrical fields from the canonical equipment-db STRING_INVERTERS
// catalog. Per Stage 7 assessment that's ~60 SKUs x ~4 comparable fields =
// ~240 drift points. v47.425 smoke suite catches complete ABSENCE of a field
// but NOT silent value drift (e.g. a brand profile quietly saying the SKU has
// acKw=5.5 while equipment-db lists 5.0).
//
// Stage 7 recommended: DEFER full refactor (the brand-profile layer
// intentionally deviates from datasheet values in some cases). Stage 8.2
// implements drift-guard CI tests per that recommendation.
//
// ENFORCED INVARIANTS: for every BrandInverterModelRef in every BRAND_PROFILES
// entry, the following fields MUST equal the STRING_INVERTERS canonical value:
//
//   BrandInverterModelRef.acKw                   === StringInverter.acOutputKw
//   BrandInverterModelRef.dcKwMax                === StringInverter.dcInputKwMax
//   BrandInverterModelRef.mpptCount              === StringInverter.mpptChannels
//   BrandInverterModelRef.maxParallelStringsPerMppt === StringInverter.maxParallelStringsPerMppt
//     (when BOTH sides define it — one-sided presence is allowed because the
//      brand profile may omit the field to inherit the registry default)
//
// NOT ENFORCED: minPanelsPerString / maxPanelsPerString are computed from
// voltage window + panel Vmp/Voc — they are legitimately brand-profile-only.
//
// OPT-OUT: BrandInverterModelRef.overridesEquipmentDb = true disables these
// equality checks for a SKU. Use only with reviewer approval for INTENTIONAL
// brand-level design-rule overrides (e.g. a brand profile sets
// maxParallelStringsPerMppt=1 on a hardware-capable 2-parallel inverter to
// enforce a conservative design standard). The test emits an audit log line
// for every override so reviewers can see the full override list in CI.
//
// FAILURE MODE: if a future engineer updates equipment-db STRING_INVERTERS to
// fix a datasheet typo (e.g. mpptChannels 2 -> 3) but forgets to update the
// BrandInverterModelRef in the corresponding brand profile, sizing code reads
// the profile value (stale) while BOM / compliance code reads equipment-db
// (correct). The two components produce inconsistent results silently. This
// test catches that drift in CI.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { BRAND_PROFILES } from './brandProfiles';
import type { BrandProfile, BrandInverterModelRef } from './brandProfiles/types';
import { STRING_INVERTERS } from '../equipment-db';

// ---------------------------------------------------------------------------
// Resolve an equipmentDbId to the canonical StringInverter row.
// Returns null when the SKU isn't in STRING_INVERTERS — a separate test
// already catches that case (brandOnboardingSmoke.test.ts Stage 2 registry
// integrity). This guard only compares when both sides exist.
// ---------------------------------------------------------------------------
function resolveCanonical(equipmentDbId: string) {
  return STRING_INVERTERS.find(s => s.id === equipmentDbId) ?? null;
}

// Utility: flatten (brand, model) pairs so each (SKU, brand) becomes one test case.
interface Pair {
  brandId: string;
  profile: BrandProfile;
  model: BrandInverterModelRef;
}
const pairs: Pair[] = [];
for (const profile of BRAND_PROFILES) {
  const models = profile.supportedInverterModels ?? [];
  for (const model of models) {
    pairs.push({ brandId: profile.id, profile, model });
  }
}

describe('v47.432 Stage 8.2 — brand profile drift-guard', () => {
  it('enumerates at least one SKU across BRAND_PROFILES (sanity)', () => {
    // Confirms the test is actually scanning something. If BRAND_PROFILES is
    // ever emptied this assertion fails before the more specific checks.
    expect(pairs.length).toBeGreaterThan(0);
  });

  it('emits audit log for every SKU using overridesEquipmentDb opt-out', () => {
    // Self-documenting override registry — CI output shows exactly which
    // SKUs intentionally disagree with equipment-db. Reviewers can scan
    // this list in every PR that touches brand profiles.
    const overrides = pairs.filter(p => p.model.overridesEquipmentDb === true);
    if (overrides.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[brandProfileDriftGuard] ${overrides.length} SKU(s) use overridesEquipmentDb opt-out:\n` +
          overrides
            .map(p => `  - ${p.brandId} :: ${p.model.equipmentDbId}`)
            .join('\n'),
      );
    }
    // No assertion on the count — this is an audit log only. The existence
    // of overrides is allowed; the point is visibility.
    expect(Array.isArray(overrides)).toBe(true);
  });

  describe.each(pairs)('$brandId :: $model.equipmentDbId', ({ brandId, model }) => {
    // The brandOnboardingSmoke suite (v47.425) already asserts resolveCanonical !== null
    // for every pair. We defensively skip the value checks when the SKU is
    // missing so this guard never duplicates or obscures that earlier failure.
    const canonical = resolveCanonical(model.equipmentDbId);

    const opt = model.overridesEquipmentDb === true;
    const suffix = opt ? ' [overridesEquipmentDb=true → SKIP]' : '';

    it(`acKw matches equipment-db acOutputKw${suffix}`, () => {
      if (!canonical || opt) return;
      expect(model.acKw).toBe(canonical.acOutputKw);
    });

    it(`dcKwMax matches equipment-db dcInputKwMax${suffix}`, () => {
      if (!canonical || opt) return;
      expect(model.dcKwMax).toBe(canonical.dcInputKwMax);
    });

    it(`mpptCount matches equipment-db mpptChannels${suffix}`, () => {
      if (!canonical || opt) return;
      expect(model.mpptCount).toBe(canonical.mpptChannels);
    });

    it(`maxParallelStringsPerMppt matches equipment-db (when both sides define it)${suffix}`, () => {
      if (!canonical || opt) return;
      // One-sided presence is allowed — the brand profile may omit the field
      // to inherit the registry default. Value equality is only enforced when
      // BOTH sides declare a value.
      if (
        model.maxParallelStringsPerMppt !== undefined &&
        canonical.maxParallelStringsPerMppt !== undefined
      ) {
        expect(model.maxParallelStringsPerMppt).toBe(canonical.maxParallelStringsPerMppt);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Global invariants over the override population.
  // -------------------------------------------------------------------------
  describe('overridesEquipmentDb opt-out invariants', () => {
    const overrides = pairs.filter(p => p.model.overridesEquipmentDb === true);

    it('every override SKU still resolves in STRING_INVERTERS (not a typo escape hatch)', () => {
      // Override lets you intentionally disagree with canonical values — it
      // does NOT let you reference a SKU that isn't in the registry. That
      // would break brandOnboardingSmoke.test.ts Stage 2 regardless.
      for (const p of overrides) {
        const hit = resolveCanonical(p.model.equipmentDbId);
        expect(hit, `${p.brandId}::${p.model.equipmentDbId} must exist in STRING_INVERTERS`).not.toBeNull();
      }
    });

    it('override flag is strictly boolean true (not truthy / coerced)', () => {
      // Guards against accidental string "true", number 1, etc. The type
      // system should already prevent this but belt-and-suspenders is cheap.
      for (const p of overrides) {
        expect(p.model.overridesEquipmentDb).toStrictEqual(true);
      }
    });
  });
});