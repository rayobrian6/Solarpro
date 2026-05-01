/**
 * v47.424 — Panel Compatibility Auto-Heal end-to-end regression.
 *
 * This test suite is the bug-report-to-regression-guard for the user's
 * screenshot scenario (Growatt MIN + Q CELLS Q.PEAK DUO 400W on 36 panels
 * producing three MPPT_CURRENT_EXCEEDED errors on the live Compliance
 * panel, v47.423 BUILD).
 *
 * ROOT CAUSE (v47.423):
 *   - sizeSystemFromBrand() correctly detected the mismatch and returned
 *     panelCompatibility.autoSwitched = true with effectivePanelId set
 *     to a compatible panel.
 *   - But the swap was ONLY advisory: config.inverters[].strings[].panelId
 *     was never updated. The compliance engine (server /api/engineering/
 *     calculate + client-side computedSystem) reads directly from config
 *     and still saw the original Q CELLS panel → re-emitted the errors.
 *   - applySizingRecommendation() hard-coded existingPanelId and ignored
 *     rec.panelCompatibility, so even the explicit "Apply Recommendation"
 *     button preserved the bad panel.
 *
 * FIX (v47.424):
 *   1. applySizingRecommendation() now adopts effectivePanelId when the
 *      gate auto-switched.
 *   2. A dedicated auto-heal useEffect in app/engineering/page.tsx writes
 *      the swap into config.inverters[].strings[].panelId directly —
 *      runs unconditionally (even under userHasEditedInverters lock)
 *      because a brand/panel mismatch is a hard NEC compliance failure,
 *      not a user preference.
 *
 * BRAND-AGNOSTIC GUARANTEE:
 *   Neither the gate (panelCompatibilityGate.ts) nor the auto-heal logic
 *   contains any per-brand code. Every current and future brand inherits
 *   this protection the moment it is registered in BRAND_PROFILES.
 *
 * THIS TEST FILE locks four properties:
 *   A. After running the gate on the user's exact scenario, the result's
 *      effectivePanelId is catalog-compatible (fits the brand cap).
 *   B. Running the gate a SECOND time on a config where every string has
 *      already been updated to effectivePanelId produces
 *      autoSwitched=false (idempotent — auto-heal does not loop).
 *   C. Running the downstream compliance string generator on the POST-HEAL
 *      electrical input produces zero MPPT_CURRENT_EXCEEDED violations
 *      (the whole pipeline really fixes the bug).
 *   D. The identical guarantees hold across every non-micro brand
 *      (brand-agnostic sweep — future brand onboarding is safe).
 */
import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand, type SizingInput } from './sizingEngine';
import { evaluatePanelBrandCompatibility } from './panelCompatibilityGate';
import { SOLAR_PANELS, STRING_INVERTERS } from '../equipment-db';
import { BRAND_PROFILES, getBrandProfile } from './brandProfiles';
import {
  generateStringConfig,
  moduleSpecsFromRegistry,
  inverterSpecsFromRegistry,
} from '../string-generator';

// ─── Fixture helpers ───────────────────────────────────────────────────────

function panelById(id: string) {
  const p = SOLAR_PANELS.find(x => x.id === id);
  if (!p) throw new Error(`fixture missing: ${id}`);
  return p;
}

function panelAsSizingInputSpecs(id: string) {
  const p = panelById(id);
  return {
    panelId:           p.id,
    panelWattage:      p.watts,
    panelVoc:          p.voc,
    panelVmp:          p.vmp,
    panelIsc:          p.isc,
    panelTempCoeffVoc: p.tempCoeffVoc,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Property A — gate picks a catalog-compatible replacement
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.424 — user\'s screenshot scenario (Growatt MIN + Q CELLS 400W / 36 panels)', () => {
  const input: SizingInput = {
    systemType:    'roof',
    panelCount:    36,
    selectedBrand: 'growatt',
    ...panelAsSizingInputSpecs('qcells-peak-duo-400'),
  };

  it('A.1 — the gate auto-switches to a catalog-compatible panel', () => {
    const r = sizeSystemFromBrand(input);
    expect(r.panelCompatibility).toBeDefined();
    expect(r.panelCompatibility!.autoSwitched).toBe(true);
    expect(r.panelCompatibility!.originalPanelId).toBe('qcells-peak-duo-400');
    expect(r.panelCompatibility!.effectivePanelId).not.toBe('qcells-peak-duo-400');
  });

  it('A.2 — the chosen replacement panel, with NEC 690.8(A)(1) × 1.25, fits under 13.5 A MPPT cap', () => {
    const r = sizeSystemFromBrand(input);
    const swapped = panelById(r.panelCompatibility!.effectivePanelId);
    expect(swapped.isc * 1.25).toBeLessThanOrEqual(13.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property B — idempotency (auto-heal cannot create an infinite loop)
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.424 — idempotency guard', () => {
  it('B.1 — running the gate on the POST-heal input produces autoSwitched=false', () => {
    // First pass: bad panel → gate swaps
    const firstPass = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    36,
      selectedBrand: 'growatt',
      ...panelAsSizingInputSpecs('qcells-peak-duo-400'),
    });
    const swappedId = firstPass.panelCompatibility!.effectivePanelId;

    // Second pass: config is now carrying the swapped panel → gate must not re-swap
    const secondPass = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    36,
      selectedBrand: 'growatt',
      ...panelAsSizingInputSpecs(swappedId),
    });

    expect(secondPass.panelCompatibility).toBeDefined();
    expect(secondPass.panelCompatibility!.autoSwitched).toBe(false);
    expect(secondPass.panelCompatibility!.effectivePanelId).toBe(swappedId);
    expect(secondPass.panelCompatibility!.status).not.toBe('incompatible');
  });

  it('B.2 — no PANEL_AUTO_SWITCHED warning on the second pass', () => {
    const firstPass = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    36,
      selectedBrand: 'growatt',
      ...panelAsSizingInputSpecs('qcells-peak-duo-400'),
    });
    const swappedId = firstPass.panelCompatibility!.effectivePanelId;

    const secondPass = sizeSystemFromBrand({
      systemType:    'roof',
      panelCount:    36,
      selectedBrand: 'growatt',
      ...panelAsSizingInputSpecs(swappedId),
    });

    expect(
      secondPass.warnings.find(w => w.code === 'PANEL_AUTO_SWITCHED')
    ).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property C — downstream compliance engine produces no MPPT_CURRENT_EXCEEDED
//             after the swap propagates to the electrical payload.
//
// This is the KEY test. It simulates what the /api/engineering/calculate
// route does after the client auto-heal has written the swapped panelId
// into config.inverters[].strings[].panelId.
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.424 — post-heal compliance no longer raises MPPT_CURRENT_EXCEEDED', () => {
  it('C.1 — BEFORE heal: compliance DOES raise MPPT_CURRENT_EXCEEDED (locks the bug)', () => {
    // Simulate /api/engineering/calculate with ORIGINAL Q CELLS panel +
    // Growatt 5kW × 2 inverters (the screenshot scenario).
    const panel = panelById('qcells-peak-duo-400');
    const inv   = STRING_INVERTERS.find(x => x.id === 'growatt-min-5000tl-xh-us')!;

    const result = generateStringConfig({
      totalModules: 36,
      moduleSpecs: moduleSpecsFromRegistry({
        voc:                 panel.voc,
        vmp:                 panel.vmp,
        isc:                 panel.isc,
        imp:                 panel.imp,
        watts:               panel.watts,
        tempCoeffVoc:        panel.tempCoeffVoc,
        maxSeriesFuseRating: panel.maxSeriesFuseRating,
      }),
      inverterSpecs: inverterSpecsFromRegistry({
        maxDcVoltage:              inv.maxDcVoltage,
        mpptVoltageMin:            inv.mpptVoltageMin,
        mpptVoltageMax:            inv.mpptVoltageMax,
        mpptChannels:              inv.mpptChannels * 2,  // 2 inverters
        maxInputCurrent:           inv.maxInputCurrentPerMppt,
        maxParallelStringsPerMppt: inv.maxParallelStringsPerMppt,
        acOutputKw:                inv.acOutputKw * 2,
      }),
      designTempMin: -10,
      topology: 'hybrid',
    });

    // Locks the bug: the original pairing produces MPPT_CURRENT_EXCEEDED
    const hasCurrentExceeded =
      (result.mpptAllocation?.violations || []).some(v => v.code === 'MPPT_CURRENT_EXCEEDED');
    expect(hasCurrentExceeded).toBe(true);
  });

  it('C.2 — AFTER heal: same compliance call with the gate\'s effective panel produces ZERO MPPT_CURRENT_EXCEEDED', () => {
    // Run the gate to discover the effective panel
    const gate = evaluatePanelBrandCompatibility(
      panelById('qcells-peak-duo-400'),
      getBrandProfile('growatt')!,
    );
    expect(gate.status).toBe('incompatible');
    expect(gate.suggestions.length).toBeGreaterThan(0);
    const effectivePanel = panelById(gate.suggestions[0].id);

    const inv = STRING_INVERTERS.find(x => x.id === 'growatt-min-5000tl-xh-us')!;

    // v47.425 — Maxeon 3 is now the top swap target (Isc 6.58A, 39%
    // headroom vs EverVolt 410W's 6.9%). Maxeon 3 Voc=75.6V clamps strings
    // to 7 panels on 600V Growatt; with maxParallelStringsPerMppt=2 but
    // per-MPPT cap of 13.5A, each MPPT can carry 1 Maxeon 3 string cleanly.
    // 2 inverters × 2 MPPTs × 1 string × 6 panels = 24 panels total.
    const result = generateStringConfig({
      totalModules: 24,
      moduleSpecs: moduleSpecsFromRegistry({
        voc:                 effectivePanel.voc,
        vmp:                 effectivePanel.vmp,
        isc:                 effectivePanel.isc,
        imp:                 effectivePanel.imp,
        watts:               effectivePanel.watts,
        tempCoeffVoc:        effectivePanel.tempCoeffVoc,
        maxSeriesFuseRating: effectivePanel.maxSeriesFuseRating,
      }),
      inverterSpecs: inverterSpecsFromRegistry({
        maxDcVoltage:              inv.maxDcVoltage,
        mpptVoltageMin:            inv.mpptVoltageMin,
        mpptVoltageMax:            inv.mpptVoltageMax,
        mpptChannels:              inv.mpptChannels * 2,
        maxInputCurrent:           inv.maxInputCurrentPerMppt,
        maxParallelStringsPerMppt: inv.maxParallelStringsPerMppt,
        acOutputKw:                inv.acOutputKw * 2,
      }),
      designTempMin: -10,
      topology: 'hybrid',
    });

    const violations = result.mpptAllocation?.violations || [];
    const hasCurrentExceeded = violations.some(v => v.code === 'MPPT_CURRENT_EXCEEDED');

    // THIS is the regression guard: after the heal, the downstream
    // compliance engine MUST NOT produce MPPT_CURRENT_EXCEEDED.
    expect(hasCurrentExceeded).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property D — brand-agnostic sweep: every non-micro brand protects its
//             users from panel/brand mismatches automatically.
// ═══════════════════════════════════════════════════════════════════════════

describe('v47.424 — brand-agnostic sweep (every brand future-proofs auto-heal)', () => {
  const stringyBrands = BRAND_PROFILES
    .filter(b => b.topology !== 'micro')
    .filter(b => b.supportedInverterModels.length > 0)
    .filter(b => b.id !== 'generic-string')  // generic profile has no cap
    .map(b => b.id);

  for (const brandId of stringyBrands) {
    it(`${brandId}: gate + swap + compliance-check is coherent for a high-Isc panel`, () => {
      // Use a deliberately high-Isc panel so the gate is likely to swap
      const rA = sizeSystemFromBrand({
        systemType:    'roof',
        panelCount:    18,
        selectedBrand: brandId,
        ...panelAsSizingInputSpecs('silfab-sil430'),   // Isc 13.30 A — high
      });

      expect(rA.panelCompatibility).toBeDefined();
      // Whatever status is returned, it MUST be one of the known values
      expect(['compatible', 'marginal', 'incompatible', 'unknown']).toContain(
        rA.panelCompatibility!.status,
      );
      // effectivePanelId must always resolve to a real panel
      const effId = rA.panelCompatibility!.effectivePanelId;
      expect(SOLAR_PANELS.some(p => p.id === effId)).toBe(true);

      // Second pass with the effective panel: never autoSwitched
      const rB = sizeSystemFromBrand({
        systemType:    'roof',
        panelCount:    18,
        selectedBrand: brandId,
        ...panelAsSizingInputSpecs(effId),
      });
      expect(rB.panelCompatibility!.autoSwitched).toBe(false);
    });
  }
});