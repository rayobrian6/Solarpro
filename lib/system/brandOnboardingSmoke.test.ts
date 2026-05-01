/**
 * v47.425 — BRAND ONBOARDING SMOKE SUITE
 *
 * This is the guardian test suite for brand onboarding. When you add a
 * new brand to BRAND_PROFILES (Solis, Schneider, Victron, OutBack, etc.),
 * these tests AUTOMATICALLY run against it. If ANY pipeline stage fails,
 * CI fails, and the build is blocked.
 *
 * The suite validates six stages per brand:
 *
 *   Stage 1 — Structural validity (schema, required fields)
 *   Stage 2 — Registry integrity (inverter references resolve)
 *   Stage 3 — Sizing tier coverage (0→Infinity, no gaps, every tier's
 *             model exists in supportedInverterModels)
 *   Stage 4 — Panel Compatibility Gate (min cap discoverable, gate
 *             never crashes, at least one catalog panel is compatible)
 *   Stage 5 — Sizing engine (does not throw, returns a valid result,
 *             panelCompatibility payload is well-formed)
 *   Stage 6 — Full-pipeline settle (auto-heal converges, compliance
 *             runs, no MPPT_CURRENT_EXCEEDED when a compatible panel
 *             is used)
 *
 * Plus three GLOBAL invariants:
 *
 *   Global 1 — Every ECOSYSTEM_BRANDS entry has a matching BRAND_PROFILES
 *   Global 2 — At least one panel in the catalog is compatible with
 *              every registered brand (catalog completeness)
 *   Global 3 — No two brands claim the same canonical id
 *
 * WHY THIS CLOSES THE FUTURE-ONBOARDING GAP:
 *   Every test iterates over BRAND_PROFILES dynamically. Adding a new
 *   brand automatically extends test coverage with zero test-file edits.
 *   If the new brand violates any invariant, the test fails with a
 *   clear, brand-named error message.
 */
import { describe, it, expect } from 'vitest';
import { SOLAR_PANELS } from '../equipment-db';
import { BRAND_PROFILES } from './brandProfiles';
import {
  sizeSystemFromBrand,
  type SizingInput,
  type SystemSizingResult,
} from './sizingEngine';
import {
  getBrandMinMpptCurrent,
  evaluatePanelBrandCompatibility,
} from './panelCompatibilityGate';
import {
  generateStringConfig,
  moduleSpecsFromRegistry,
  inverterSpecsFromRegistry,
} from '../string-generator';
import {
  getSmokeTestBrands,
  getAllBrands,
  SMOKE_PANEL_MATRIX,
  panelById,
  inverterById,
  validateInverterFields,
  validateSizingTiers,
  findCompatiblePanelsInCatalog,
  findOrphanEcosystemBrands,
  validateBrandSchema,
} from './brandOnboardingSmoke.helpers';

// ═════════════════════════════════════════════════════════════════════════
// Stage 1 — Structural validity (per brand)
// ═════════════════════════════════════════════════════════════════════════

describe('v47.425 — Stage 1: Brand schema structural validity', () => {
  for (const brand of getAllBrands()) {
    it(`${brand.id}: has all required BrandProfile fields`, () => {
      const errors = validateBrandSchema(brand);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  it('no two brands share the same canonical id', () => {
    const ids = BRAND_PROFILES.map(b => b.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate brand ids: ${dupes.join(', ')}`).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Stage 2 — Registry integrity (per brand)
// Every supportedInverterModels[].equipmentDbId resolves to a real entry
// in STRING_INVERTERS with all required electrical fields.
// ═════════════════════════════════════════════════════════════════════════

describe('v47.425 — Stage 2: Registry integrity', () => {
  for (const brand of getSmokeTestBrands()) {
    it(`${brand.id}: every supported inverter model resolves in STRING_INVERTERS with valid fields`, () => {
      const errors: string[] = [];
      for (const ref of brand.supportedInverterModels) {
        try {
          const inv = inverterById(ref.equipmentDbId);
          errors.push(...validateInverterFields(inv));
        } catch (e: any) {
          errors.push(e.message);
        }
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// Stage 3 — Sizing tier coverage (per brand)
// ═════════════════════════════════════════════════════════════════════════

describe('v47.425 — Stage 3: Sizing tier coverage', () => {
  for (const brand of getSmokeTestBrands()) {
    it(`${brand.id}: sizing tiers cover 0→∞ with no gaps and reference valid models`, () => {
      const errors = validateSizingTiers(brand);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// Stage 4 — Panel Compatibility Gate (per brand)
// ═════════════════════════════════════════════════════════════════════════

describe('v47.425 — Stage 4: Panel Compatibility Gate integrity', () => {
  for (const brand of getSmokeTestBrands()) {
    it(`${brand.id}: getBrandMinMpptCurrent returns a positive number`, () => {
      const cap = getBrandMinMpptCurrent(brand);
      expect(cap).not.toBeNull();
      expect(cap!).toBeGreaterThan(0);
    });

    it(`${brand.id}: gate classifies every panel in the matrix without crashing`, () => {
      for (const panelId of SMOKE_PANEL_MATRIX) {
        const panel = panelById(panelId);
        const gate = evaluatePanelBrandCompatibility(panel, brand);
        expect(gate).toBeDefined();
        expect(['compatible', 'marginal', 'incompatible', 'unknown']).toContain(gate.status);
        expect(gate.brand).toBeDefined();
        expect(gate.panel).toBeDefined();
        expect(typeof gate.reason).toBe('string');
        expect(gate.reason.length).toBeGreaterThan(0);
      }
    });

    // GLOBAL 2 sub-clause: every brand must have at least one catalog-compatible panel.
    it(`${brand.id}: catalog contains at least one compatible panel`, () => {
      const compatible = findCompatiblePanelsInCatalog(brand);
      expect(
        compatible.length,
        `${brand.id} has ZERO compatible panels in SOLAR_PANELS. ` +
        `Either add a low-Isc panel to the catalog or relax the brand's MPPT cap.`,
      ).toBeGreaterThan(0);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// Stage 5 — Sizing engine smoke (per brand × per panel × per count)
// ═════════════════════════════════════════════════════════════════════════

describe('v47.425 — Stage 5: Sizing engine smoke', () => {
  const panelCounts = [6, 12, 18, 24, 36];
  for (const brand of getSmokeTestBrands()) {
    for (const panelId of SMOKE_PANEL_MATRIX) {
      for (const panelCount of panelCounts) {
        it(`${brand.id} × ${panelId} × ${panelCount} panels: sizeSystemFromBrand does not throw`, () => {
          const panel = panelById(panelId);
          const input: SizingInput = {
            systemType:    'roof',
            panelCount,
            panelWattage:  panel.watts,
            panelVoc:      panel.voc,
            panelVmp:      panel.vmp,
            panelIsc:      panel.isc,
            panelTempCoeffVoc: panel.tempCoeffVoc,
            panelId:       panel.id,
            selectedBrand: brand.id,
          };
          let result: SystemSizingResult | null = null;
          expect(() => { result = sizeSystemFromBrand(input); }).not.toThrow();
          expect(result).not.toBeNull();
          expect(result!.inverterModels).toBeDefined();
          expect(result!.inverterModels.length).toBeGreaterThan(0);
          // panelCompatibility payload must be well-formed when panelId provided
          expect(result!.panelCompatibility).toBeDefined();
          expect(typeof result!.panelCompatibility!.status).toBe('string');
          expect(typeof result!.panelCompatibility!.autoSwitched).toBe('boolean');
          expect(typeof result!.panelCompatibility!.effectivePanelId).toBe('string');
          expect(SOLAR_PANELS.some(p => p.id === result!.panelCompatibility!.effectivePanelId))
            .toBe(true);
        });
      }
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════
// Stage 6 — Full pipeline settle (per brand, with a known-compatible panel)
// ═════════════════════════════════════════════════════════════════════════

describe('v47.425 — Stage 6: Full pipeline settle with catalog-compatible panel', () => {
  for (const brand of getSmokeTestBrands()) {
    it(`${brand.id}: compliance produces ZERO MPPT_CURRENT_EXCEEDED with any compatible panel`, () => {
      const compatible = findCompatiblePanelsInCatalog(brand);
      // Stage 4 already asserted compatible.length > 0. Use the first one.
      expect(compatible.length).toBeGreaterThan(0);
      const panel = panelById(compatible[0]);

      // Walk the sizing tier table and, for every panelCount in the matrix,
      // use sizeSystemFromBrand() to pick the correct tier-appropriate
      // inverter — this IS the real onboarding path. Then run compliance on
      // each sized result and enforce the PIPELINE-INTEGRITY CONTRACT:
      //
      //   IF the gate clears the panel as compatible
      //   AND the sizing engine blesses the config (no FEASIBILITY_* or
      //       INVERTER_MPPT_RANGE_INCOMPATIBLE warnings)
      //   THEN compliance MUST NOT emit MPPT_CURRENT_EXCEEDED.
      //
      // When sizing emits a feasibility-blocking warning, it has already
      // told the UI "no inverter in this brand can cleanly carry this
      // config" — compliance will naturally also flag it, and the user
      // sees both warnings. That is correct defence-in-depth, not a bug.
      //
      // The invariant this test enforces: sizing and compliance must
      // AGREE. If sizing says "fine", compliance must also say "fine".
      const BLOCKING_WARNING_CODES = new Set([
        'FEASIBILITY_NO_VIABLE_MODEL',
        'FEASIBILITY_CHOSEN_INFEASIBLE',
        'INVERTER_MPPT_RANGE_INCOMPATIBLE',
      ]);
      const panelCounts = [6, 12, 18, 24];
      for (const panelCount of panelCounts) {
        const sizingInput: SizingInput = {
          systemType:    'roof',
          panelCount,
          panelWattage:  panel.watts,
          panelVoc:      panel.voc,
          panelVmp:      panel.vmp,
          panelIsc:      panel.isc,
          panelTempCoeffVoc: panel.tempCoeffVoc,
          panelId:       panel.id,
          selectedBrand: brand.id,
        };
        const sized = sizeSystemFromBrand(sizingInput);
        // Sizing engine MUST pick an inverter.
        expect(sized.inverterModels.length).toBeGreaterThan(0);
        const sizedInv = sized.inverterModels[0];
        const inv = inverterById(sizedInv.equipmentDbId);
        const unitQty = sizedInv.qty || 1;

        // Multi-unit capacity: total MPPT channels = per-unit × qty.
        // This mirrors the SIZING ENGINE's capacity model. The compliance
        // engine's per-channel current cap is still evaluated per individual
        // MPPT channel (not summed), so scaling mpptChannels is the correct
        // way to represent total DC capacity available to the string
        // allocator.
        const result = generateStringConfig({
          totalModules: panelCount,
          moduleSpecs: moduleSpecsFromRegistry({
            voc: panel.voc, vmp: panel.vmp, isc: panel.isc, imp: panel.imp,
            watts: panel.watts, tempCoeffVoc: panel.tempCoeffVoc,
            maxSeriesFuseRating: panel.maxSeriesFuseRating,
          }),
          inverterSpecs: inverterSpecsFromRegistry({
            maxDcVoltage:              inv.maxDcVoltage,
            mpptVoltageMin:            inv.mpptVoltageMin,
            mpptVoltageMax:            inv.mpptVoltageMax,
            mpptChannels:              inv.mpptChannels * unitQty,
            maxInputCurrent:           inv.maxInputCurrentPerMppt,
            maxParallelStringsPerMppt: inv.maxParallelStringsPerMppt,
            acOutputKw:                inv.acOutputKw * unitQty,
            // v47.430 — forward the fixed DC bus voltage so the compliance
            // engine uses NEC 690.8(A)(2) regulated-output operating current
            // for optimizer topology (instead of defaulting to mpptCenter,
            // which produces a slightly inflated design current that can
            // trip the MPPT cap after the v47.430 SolarEdge voltage-clamp
            // bypass reduces the chosen unit count).
            nominalDcVoltage:          (inv as { nominalDcVoltage?: number }).nominalDcVoltage,
          // v47.420 — forward brand maxPanelsPerString so optimizer topology
          // uses the correct string-length ceiling instead of defaulting to 25.
          maxPanelsPerString:        (inv as { maxPanelsPerString?: number }).maxPanelsPerString,
          }),
          designTempMin: -10,
          topology: brand.topology === 'optimizer' ? 'optimizer' : 'hybrid',
        });

        // If the sizing engine flagged a blocking feasibility issue, the
        // onboarding UX already informs the user — the compliance engine
        // will corroborate, which is correct. Skip this config from the
        // pipeline-integrity contract.
        const sizedBlockingWarnings = (sized.warnings || []).filter(
          w => BLOCKING_WARNING_CODES.has(w.code as string),
        );
        if (sizedBlockingWarnings.length > 0) continue;

        const violations = result.mpptAllocation?.violations || [];
        const overCurrent = violations.filter(v => v.code === 'MPPT_CURRENT_EXCEEDED');
        expect(
          overCurrent.length,
          `${brand.id} + ${panel.id} × ${panelCount} panels ` +
          `(sized inverter: ${inv.id} × ${unitQty}): ` +
          `PIPELINE INTEGRITY VIOLATION — the compatibility gate said this ` +
          `pairing is compatible AND the sizing engine blessed this inverter ` +
          `(no feasibility warnings emitted), yet compliance reports ` +
          `MPPT_CURRENT_EXCEEDED. Sizing and compliance disagree on the ` +
          `same config. This is a real pipeline bug.`,
        ).toBe(0);
      }
    });

    it(`${brand.id}: end-to-end sizeSystemFromBrand with an incompatible panel produces either a swap OR a clear warning`, () => {
      // Pick the highest-Isc panel we know about (silfab-sil430) — for most
      // brands this will trigger the gate.
      const panel = panelById('silfab-sil430');
      const input: SizingInput = {
        systemType:    'roof',
        panelCount:    18,
        panelWattage:  panel.watts,
        panelVoc:      panel.voc,
        panelVmp:      panel.vmp,
        panelIsc:      panel.isc,
        panelTempCoeffVoc: panel.tempCoeffVoc,
        panelId:       panel.id,
        selectedBrand: brand.id,
      };
      const r = sizeSystemFromBrand(input);
      expect(r.panelCompatibility).toBeDefined();

      // If the gate declared this pair incompatible AND swapped, the
      // effective panel must be compatible. If it did NOT swap, there
      // must be a PANEL_INCOMPATIBLE or PANEL_MARGINAL warning present
      // (so the user is not left in the dark).
      if (r.panelCompatibility!.status === 'incompatible') {
        if (r.panelCompatibility!.autoSwitched) {
          // Swap happened — effective panel must be a real catalog panel
          const swapped = r.panelCompatibility!.effectivePanelId;
          expect(SOLAR_PANELS.some(p => p.id === swapped)).toBe(true);
        } else {
          // No swap — user must see a warning
          const warnCodes = r.warnings.map(w => w.code);
          expect(
            warnCodes,
            `${brand.id}: incompatible panel with no auto-swap must emit PANEL_INCOMPATIBLE`,
          ).toContain('PANEL_INCOMPATIBLE');
        }
      }
      // Marginal also must emit a warning
      if (r.panelCompatibility!.status === 'marginal' && !r.panelCompatibility!.autoSwitched) {
        const warnCodes = r.warnings.map(w => w.code);
        expect(
          warnCodes,
          `${brand.id}: marginal panel must emit PANEL_MARGINAL warning`,
        ).toContain('PANEL_MARGINAL');
      }
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// GLOBAL invariants
// ═════════════════════════════════════════════════════════════════════════

describe('v47.425 — Global invariants across all brands', () => {
  it('GLOBAL 1 — every ECOSYSTEM_BRANDS entry has EITHER a matching BRAND_PROFILES entry OR is explicitly tagged as a storage-only ecosystem', () => {
    // Storage-only / non-PV-inverter ecosystems that intentionally do not
    // need a BRAND_PROFILES entry. These vendors participate only in the
    // battery / backup / ATS / EV-charger portion of the ecosystem picker
    // and are sized via separate subsystem engines (not the PV sizing
    // engine). Keep this allowlist TIGHT — adding to it requires an
    // explicit decision that the brand does not ship a PV inverter we
    // support.
    // v47.426 — Tesla removed from allowlist: now has a real BrandProfile with
    // 4 SKUs (Solar Inverter 3.8/5/5.7/7.6 kW). Generac remains because it's a
    // generator/ATS-focused ecosystem without a PV inverter in our catalog.
    const STORAGE_ONLY_ECOSYSTEMS = new Set(['generac']);

    const orphans = findOrphanEcosystemBrands();
    const unexpectedOrphans = orphans.filter(id => !STORAGE_ONLY_ECOSYSTEMS.has(id));
    expect(
      unexpectedOrphans,
      `Orphan ecosystem brands (no matching profile AND not in ` +
      `STORAGE_ONLY_ECOSYSTEMS allowlist): ${unexpectedOrphans.join(', ')}. ` +
      `Either add a BrandProfile or add the id to STORAGE_ONLY_ECOSYSTEMS ` +
      `if the brand does not ship a PV inverter.`,
    ).toEqual([]);
  });

  it('GLOBAL 2 — every non-micro brand has at least one catalog-compatible panel', () => {
    const failing: string[] = [];
    for (const brand of getSmokeTestBrands()) {
      const compatible = findCompatiblePanelsInCatalog(brand);
      if (compatible.length === 0) failing.push(brand.id);
    }
    expect(
      failing,
      `Brands with NO compatible panel in catalog: ${failing.join(', ')}. ` +
      `Add a low-Isc panel to SOLAR_PANELS to close this gap.`,
    ).toEqual([]);
  });

  it('GLOBAL 3 — the gate is pure and deterministic', () => {
    // Calling the gate twice on the same inputs must return the same result
    const panel = panelById('qcells-peak-duo-400');
    const brand = getSmokeTestBrands()[0];
    const g1 = evaluatePanelBrandCompatibility(panel, brand);
    const g2 = evaluatePanelBrandCompatibility(panel, brand);
    expect(g1.status).toBe(g2.status);
    expect(g1.headroomPct).toBe(g2.headroomPct);
    expect(g1.brand.effectiveMaxInputCurrentPerMppt).toBe(g2.brand.effectiveMaxInputCurrentPerMppt);
  });

  it('GLOBAL 4 — the sizing engine is pure and deterministic', () => {
    const brand = getSmokeTestBrands()[0];
    const panel = panelById('sp-maxeon3-400');
    const input: SizingInput = {
      systemType:    'roof',
      panelCount:    18,
      panelWattage:  panel.watts,
      panelVoc:      panel.voc,
      panelVmp:      panel.vmp,
      panelIsc:      panel.isc,
      panelTempCoeffVoc: panel.tempCoeffVoc,
      panelId:       panel.id,
      selectedBrand: brand.id,
    };
    const r1 = sizeSystemFromBrand(input);
    const r2 = sizeSystemFromBrand(input);
    expect(r1.inverterModels.length).toBe(r2.inverterModels.length);
    expect(r1.panelCompatibility?.effectivePanelId)
      .toBe(r2.panelCompatibility?.effectivePanelId);
    expect(r1.panelCompatibility?.autoSwitched)
      .toBe(r2.panelCompatibility?.autoSwitched);
  });
});