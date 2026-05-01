/**
 * v47.429 — RACKING ECOSYSTEM SMOKE SUITE (Stage 6)
 *
 * Guardian test suite for racking registration and brand-to-racking
 * ecosystem linkage. When you:
 *   - Add a new mounting system to mounting-hardware-db.ts
 *   - Declare recommendedRackingBrands on a BrandProfile
 *
 * these tests AUTOMATICALLY run. If ANY invariant fails, CI fails
 * and the build is blocked.
 *
 * Stages per mounting system:
 *
 *   Stage 1 — Schema integrity (required fields present & typed)
 *   Stage 2 — Plausibility (wind / snow / pitch within realistic
 *             residential-commercial ranges)
 *
 * Global invariants:
 *
 *   Global 1 — No two mounting systems share the same id
 *   Global 2 — Every BrandProfile's recommendedRackingBrands token
 *              resolves to ≥1 manufacturer in the UI-canonical DB
 *              (mirrors battery Global 2 — the "dangling token" gate)
 *   Global 3 — Every distinct manufacturer reachable via
 *              getRackingManufacturers() produces ≥1 system when
 *              resolved through resolveRackingToken() (catches
 *              matcher regressions)
 *   Global 4 — Resolver parity: the UI-facing resolveBrandEquipment()
 *              returns the same MountingSystemSpec set as our smoke
 *              helper for every racking-capable profile
 *
 * WHY THIS CLOSES THE STAGE 6 GAP:
 *   Before v47.429 the EcosystemPicker had no racking awareness.
 *   Adding recommendedRackingBrands without this suite would let
 *   dangling manufacturer tokens ship silently. Global 2 makes any
 *   dangling token a hard CI failure forever — same discipline as
 *   the v47.428 battery smoke suite.
 */
import { describe, it, expect } from 'vitest';
import { BRAND_PROFILES } from './brandProfiles';
import { resolveBrandEquipment } from './brandProfiles/resolveBrandEquipment';
import {
  getAllRackingSystems,
  getRackingManufacturers,
  getRackingCapableProfiles,
  resolveRecommendedRacking,
  resolveRackingToken,
  validateRackingFields,
  validateRackingPlausibility,
} from './rackingEcosystemSmoke.helpers';

// ══════════════════════════════════════════════════════════════════
// PER-SYSTEM STAGES
// ══════════════════════════════════════════════════════════════════

describe('v47.429 — Racking Ecosystem Smoke Suite', () => {
  const systems = getAllRackingSystems();

  describe('Stage 1 — Schema integrity', () => {
    systems.forEach(s => {
      it(`${s.id} has all required schema fields`, () => {
        const violations = validateRackingFields(s);
        expect(violations, violations.join('\n')).toEqual([]);
      });
    });

    it('registry is non-empty', () => {
      expect(systems.length).toBeGreaterThan(0);
    });
  });

  describe('Stage 2 — Wind / snow / pitch plausibility', () => {
    systems.forEach(s => {
      it(`${s.id} specs fall within residential-commercial plausibility ranges`, () => {
        const violations = validateRackingPlausibility(s);
        expect(violations, violations.join('\n')).toEqual([]);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // GLOBAL INVARIANTS
  // ══════════════════════════════════════════════════════════════════

  describe('Global 1 — No duplicate ids', () => {
    it('every mounting system id is unique', () => {
      const idCounts = new Map<string, number>();
      for (const s of systems) {
        idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
      }
      const dups = Array.from(idCounts.entries()).filter(([, n]) => n > 1);
      expect(
        dups,
        dups.map(([id, n]) => `duplicate id '${id}' appears ${n} times`).join('\n'),
      ).toEqual([]);
    });
  });

  describe('Global 2 — Every recommendedRackingBrands token resolves to ≥1 system', () => {
    // This invariant is the core guardrail. If a BrandProfile declares a
    // racking recommendation pointing at a brand we don't carry, the
    // EcosystemPicker would silently render that brand as "compatible"
    // while returning zero systems. Failing this test blocks the build.
    const rackingProfiles = getRackingCapableProfiles();

    it('at least one profile declares recommendedRackingBrands', () => {
      expect(rackingProfiles.length).toBeGreaterThan(0);
    });

    rackingProfiles.forEach(profile => {
      const tokens = profile.recommendedRackingBrands ?? [];
      tokens.forEach(token => {
        it(`${profile.id}: token '${token}' resolves to ≥1 mounting system`, () => {
          const matches = resolveRackingToken(token);
          expect(
            matches.length,
            `Token '${token}' on profile '${profile.id}' resolved to ZERO mounting systems. ` +
              `Either (a) add a system with a matching manufacturer to mounting-hardware-db.ts, ` +
              `or (b) remove the token from the profile's recommendedRackingBrands.`,
          ).toBeGreaterThan(0);
        });
      });
    });

    rackingProfiles.forEach(profile => {
      it(`${profile.id}: full recommendedRackingBrands list resolves to ≥1 distinct system`, () => {
        const resolved = resolveRecommendedRacking(profile);
        expect(
          resolved.length,
          `Profile '${profile.id}' resolved to ZERO systems from its recommendedRackingBrands.`,
        ).toBeGreaterThan(0);
      });
    });
  });

  describe('Global 3 — Every distinct manufacturer is reachable via token matcher', () => {
    // Regression gate for the token matcher in resolveBrandEquipment.ts.
    // Skip 'Generic' since no BrandProfile should recommend it by name.
    const manufacturers = getRackingManufacturers().filter(m => m !== 'Generic');

    manufacturers.forEach(mfg => {
      it(`manufacturer '${mfg}' is reachable via at least one natural token`, () => {
        // Derive a natural token by normalizing the manufacturer name with
        // the same rules as the matcher (lowercase, strip space/hyphen/underscore/!/parens).
        const token = mfg
          .toLowerCase()
          .replace(/[\s_\-!&()]/g, '')
          .replace(/[^a-z0-9]/g, '');
        const matches = resolveRackingToken(token);
        expect(
          matches.length,
          `Natural token '${token}' (derived from '${mfg}') resolved to zero systems. ` +
            `The matcher in resolveBrandEquipment.resolveRackingToken may have regressed.`,
        ).toBeGreaterThan(0);
      });
    });
  });

  describe('Global 4 — Resolver parity with UI-facing resolveBrandEquipment', () => {
    // The smoke helper and the UI resolver must produce the same set of
    // MountingSystemSpec rows for every racking-capable profile. If they
    // diverge, the UI is showing something the smoke suite isn't guarding.
    const rackingProfiles = getRackingCapableProfiles();

    rackingProfiles.forEach(profile => {
      it(`${profile.id}: resolveBrandEquipment.compatibleRacking matches smoke helper`, () => {
        const fromSmoke = resolveRecommendedRacking(profile)
          .map(s => s.id)
          .sort();
        const fromResolver = resolveBrandEquipment(profile.id)
          .compatibleRacking.map(s => s.id)
          .sort();
        expect(fromResolver).toEqual(fromSmoke);
      });
    });

    it('profiles with no recommendedRackingBrands return empty compatibleRacking', () => {
      const nonRacking = BRAND_PROFILES.filter(
        p => (p.recommendedRackingBrands?.length ?? 0) === 0,
      );
      for (const profile of nonRacking) {
        const result = resolveBrandEquipment(profile.id);
        expect(
          result.compatibleRacking.length,
          `Profile '${profile.id}' has no recommendedRackingBrands but returned ${result.compatibleRacking.length} systems`,
        ).toBe(0);
        expect(result.source.racking).toBe('none');
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // META — v47.429 coverage assertions
  // ══════════════════════════════════════════════════════════════════

  describe('Meta — v47.429 expected coverage', () => {
    it('at least 20 mounting systems are registered', () => {
      // Guard against accidental registry truncation. mounting-hardware-db
      // had 42 at v47.429 ship. Anything below 20 is almost certainly a
      // regression.
      expect(systems.length).toBeGreaterThanOrEqual(20);
    });

    it('IronRidge, Unirac, and SnapNrack are all present (core residential brands)', () => {
      const mfgs = new Set(getRackingManufacturers());
      expect(mfgs.has('IronRidge')).toBe(true);
      expect(mfgs.has('Unirac')).toBe(true);
      expect(mfgs.has('SnapNrack')).toBe(true);
    });

    it('tesla + enphase + solaredge profiles each resolve to ≥1 racking system', () => {
      for (const brandId of ['tesla', 'enphase', 'solaredge']) {
        const kit = resolveBrandEquipment(brandId);
        expect(
          kit.compatibleRacking.length,
          `${brandId} resolved zero compatible racking systems`,
        ).toBeGreaterThan(0);
      }
    });
  });
});