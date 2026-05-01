/**
 * v47.428 — BATTERY ECOSYSTEM SMOKE SUITE
 *
 * This is the guardian test suite for battery registration and
 * brand-to-battery ecosystem linkage. When you:
 *   - Add a new battery to BATTERIES (lib/equipment-db.ts)
 *   - Declare battery.recommendedBatteryBrands on a BrandProfile
 *
 * these tests AUTOMATICALLY run against it. If ANY invariant fails,
 * CI fails and the build is blocked.
 *
 * Stages per battery:
 *
 *   Stage 1 — Schema integrity (required fields present & typed)
 *   Stage 2 — Plausibility (capacity / power / voltage / efficiency
 *             within realistic residential-ESS ranges)
 *   Stage 3 — Chemistry allowlist
 *   Stage 4 — Warranty coverage (min 5yr, retention ≥50%)
 *   Stage 5 — Datasheet traceability (datasheetUrl present on every
 *             battery added v47.397+, i.e. with ecosystemBrand)
 *
 * Global invariants:
 *
 *   Global 1 — No two batteries share the same id
 *   Global 2 — Every battery-capable BrandProfile's
 *              recommendedBatteryBrands token resolves to ≥1 real SKU
 *   Global 3 — Every battery's ecosystemBrand (if declared) is
 *              referenced by at least one BrandProfile (catches
 *              orphan batteries nobody can actually use)
 *
 * WHY THIS CLOSES THE ECOSYSTEM GAP:
 *   Before v47.428, hybrid BrandProfiles (Solis, Tigo, Sol-Ark,
 *   Growatt, EcoFlow) declared recommendedBatteryBrands tokens
 *   (`byd`, `pylontech`, `tigo`, `eg4`, `homegrid`) but NONE of
 *   those resolved to actual SKUs in the BATTERIES registry.
 *   Global 2 makes this dangling state a hard CI failure forever.
 */
import { describe, it, expect } from 'vitest';
import { BATTERIES } from '../equipment-db';
import { BRAND_PROFILES } from './brandProfiles';
import {
  getActiveBatteries,
  getAllBatteries,
  getBatteryCapableProfiles,
  resolveRecommendedBatteries,
  indexBatteriesByEcosystemBrand,
  validateBatteryFields,
  validateBatteryPlausibility,
  validateBatteryChemistry,
  validateBatteryWarranty,
} from './batteryEcosystemSmoke.helpers';

// ═══════════════════════════════════════════════════════════════════════
// PER-BATTERY STAGES
// ═══════════════════════════════════════════════════════════════════════

describe('v47.428 — Battery Ecosystem Smoke Suite', () => {
  const batteries = getActiveBatteries();

  describe('Stage 1 — Schema integrity', () => {
    batteries.forEach(b => {
      it(`${b.id} has all required schema fields`, () => {
        const violations = validateBatteryFields(b);
        expect(violations, violations.join('\n')).toEqual([]);
      });
    });

    it('registry is non-empty', () => {
      expect(batteries.length).toBeGreaterThan(0);
    });
  });

  describe('Stage 2 — Capacity / power / voltage plausibility', () => {
    batteries.forEach(b => {
      it(`${b.id} specs fall within residential-ESS plausibility ranges`, () => {
        const violations = validateBatteryPlausibility(b);
        expect(violations, violations.join('\n')).toEqual([]);
      });
    });
  });

  describe('Stage 3 — Chemistry allowlist', () => {
    batteries.forEach(b => {
      it(`${b.id} uses an approved cell chemistry`, () => {
        const violations = validateBatteryChemistry(b);
        expect(violations, violations.join('\n')).toEqual([]);
      });
    });
  });

  describe('Stage 4 — Warranty & longevity minimums', () => {
    batteries.forEach(b => {
      it(`${b.id} warranty meets ≥5yr / ≥50% retention minimums`, () => {
        const violations = validateBatteryWarranty(b);
        expect(violations, violations.join('\n')).toEqual([]);
      });
    });
  });

  describe('Stage 5 — Datasheet traceability (ecosystem-tagged batteries)', () => {
    // Only batteries that have adopted the v47.397+ ecosystem schema are
    // held to datasheet presence. Legacy entries (no ecosystemBrand)
    // are grandfathered until they're upgraded.
    const tagged = batteries.filter(b => b.ecosystemBrand !== undefined);
    it(`at least one ecosystem-tagged battery exists`, () => {
      expect(tagged.length).toBeGreaterThan(0);
    });
    tagged.forEach(b => {
      it(`${b.id} has a datasheetUrl`, () => {
        expect(
          b.datasheetUrl,
          `battery ${b.id} is ecosystem-tagged but lacks a datasheetUrl`,
        ).toBeTruthy();
        expect(b.datasheetUrl).toMatch(/^https?:\/\//);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GLOBAL INVARIANTS
  // ═══════════════════════════════════════════════════════════════════════

  describe('Global 1 — No duplicate battery ids', () => {
    it('every battery id is unique across the registry (active + inactive)', () => {
      const all = getAllBatteries();
      const seen = new Map<string, number>();
      for (const b of all) {
        seen.set(b.id, (seen.get(b.id) ?? 0) + 1);
      }
      const dupes = Array.from(seen.entries()).filter(([, n]) => n > 1);
      expect(
        dupes,
        `duplicate battery ids: ${dupes.map(([id, n]) => `${id}×${n}`).join(', ')}`,
      ).toEqual([]);
    });
  });

  describe('Global 2 — Every BrandProfile recommendation resolves to ≥1 real battery', () => {
    const capableProfiles = getBatteryCapableProfiles();

    it(`at least one BrandProfile declares battery.capable + recommendedBatteryBrands`, () => {
      expect(capableProfiles.length).toBeGreaterThan(0);
    });

    capableProfiles.forEach(p => {
      const tokens = p.battery.recommendedBatteryBrands ?? [];
      it(
        `[${p.id}] every recommendedBatteryBrands token resolves to ≥1 SKU ` +
          `(tokens: ${tokens.join(', ')})`,
        () => {
          const idx = indexBatteriesByEcosystemBrand();
          const unresolved: string[] = [];
          for (const tok of tokens) {
            const matches = idx.get(tok) ?? [];
            if (matches.length === 0) {
              unresolved.push(tok);
            }
          }
          expect(
            unresolved,
            `[${p.id}] dangling battery brand tokens (no registered SKU): ` +
              `${unresolved.join(', ')}. ` +
              `Either add a matching battery to BATTERIES with ecosystemBrand='${unresolved[0] ?? ''}' ` +
              `or remove the token from BrandProfile '${p.id}'.`,
          ).toEqual([]);
        },
      );
    });

    capableProfiles.forEach(p => {
      it(`[${p.id}] resolves at least one recommended battery`, () => {
        const resolved = resolveRecommendedBatteries(p);
        expect(
          resolved.length,
          `BrandProfile '${p.id}' declares battery.capable: true with ` +
            `recommended brands [${(p.battery.recommendedBatteryBrands ?? []).join(', ')}], ` +
            `but NO batteries in the registry match any of those tokens.`,
        ).toBeGreaterThan(0);
      });
    });
  });

  describe('Global 3 — Every ecosystem-tagged battery is reachable from ≥1 BrandProfile', () => {
    // Aggregate every recommendedBatteryBrands token across all profiles.
    const referencedTokens = new Set<string>();
    for (const p of BRAND_PROFILES) {
      if (p.battery.capable && p.battery.recommendedBatteryBrands) {
        for (const t of p.battery.recommendedBatteryBrands) {
          referencedTokens.add(t);
        }
      }
    }

    // Note: some legacy batteries exist that predate the BrandProfile
    // recommendation system (Tesla Powerwall, Enphase IQ Battery, etc.
    // — those ecosystems use a different linkage path via the ecosystem
    // resolver). We only enforce reachability on batteries with
    // ecosystemBrand tokens that match the recommendation-style tokens
    // used by hybrid BrandProfiles.
    const recognizedHybridTokens = new Set([
      'tigo',
      'byd',
      'pylontech',
      'eg4',
      'homegrid',
      'solax',
      'pytes',
      'fortress',
      'lg-energy-solution',
      'growatt',
      'sol-ark',
    ]);

    const targetBatteries = getActiveBatteries().filter(
      b =>
        b.ecosystemBrand !== undefined &&
        recognizedHybridTokens.has(b.ecosystemBrand),
    );

    it('registry contains at least one hybrid-ecosystem battery', () => {
      expect(targetBatteries.length).toBeGreaterThan(0);
    });

    targetBatteries.forEach(b => {
      it(
        `${b.id} (ecosystemBrand='${b.ecosystemBrand}') is referenced by ≥1 BrandProfile`,
        () => {
          expect(
            referencedTokens.has(b.ecosystemBrand!),
            `Battery ${b.id} tags ecosystemBrand='${b.ecosystemBrand}' but no ` +
              `BrandProfile declares that token in recommendedBatteryBrands. ` +
              `Either add it to a profile's recommendedBatteryBrands or retag the battery.`,
          ).toBe(true);
        },
      );
    });
  });

  describe('Meta — v47.428 new battery SKUs are present', () => {
    const REQUIRED_NEW_IDS = [
      'tigo-ei-battery-10',
      'tigo-go-battery-10',
      'byd-hvm-11',
      'pylontech-force-h2-14',
      'eg4-powerpro-14',
      'homegrid-stackd-9.6',
    ] as const;

    REQUIRED_NEW_IDS.forEach(id => {
      it(`${id} exists in BATTERIES registry`, () => {
        const found = BATTERIES.find(b => b.id === id);
        expect(found, `v47.428 battery SKU missing: ${id}`).toBeTruthy();
      });
    });
  });
});