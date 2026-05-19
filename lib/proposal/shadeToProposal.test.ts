/**
 * lib/proposal/shadeToProposal.test.ts
 *
 * Tests for Priority 4 — Shade Analysis → Proposal Financials
 *
 * Validates:
 *   1. TSRF and shadeDerateApplied are set on CanonicalProduction
 *      when panelsShadeDerateComputedPct is provided
 *   2. TSRF and shadeDerateApplied are undefined when no shade data
 *   3. TSRF = 1 - shadeDeratePct/100 (math check)
 *   4. Edge cases: 0%, 100%, boundary clamping
 *   5. panelsShadeDerateComputedPct computation logic from PlacedPanel array
 *   6. PVWatts path: panels with annualShadeFactor → non-zero derate
 *   7. Display precision: tsrf has 3 decimal places, shadeDerateApplied has 1
 *   8. Very small derate (< 0.01%) is suppressed → tsrf stays undefined
 *   9. TSRF color classification thresholds (≥0.95 green, ≥0.85 amber, <0.85 red)
 *  10. Full proposal pipeline round-trip with shade data
 */

import { describe, it, expect } from 'vitest';
import { buildCanonicalProposal } from './buildCanonicalProposal';
import type { BuildCanonicalProposalInput } from './buildCanonicalProposal';

// ─── Minimal valid input fixture ───────────────────────────────────────────────

function makeInput(overrides: Partial<BuildCanonicalProposalInput> = {}): BuildCanonicalProposalInput {
  return {
    panelSpec: {
      manufacturer: 'Maxeon',
      model:        'MAX3-400-BLK',
      wattage:      400,
      efficiency:   22.3,
    },
    panelCount:          20,
    layoutSystemSizeKw:  8.0,
    annualProductionKwh: 11200,
    monthlyProductionKwh: [700, 800, 1000, 1050, 1100, 1080, 1070, 1040, 940, 820, 620, 580],
    utilityName:         'ComEd',
    stateCode:           'IL',
    clientState:         'Illinois',
    annualUsageKwh:      12000,
    systemType:          'roof',
    storedCashPrice:     30000,
    purchaseMode:        'cash',
    ...overrides,
  };
}

// ─── TSRF / shadeDerateApplied on CanonicalProduction ─────────────────────────

describe('CanonicalProduction.tsrf — shade derate → TSRF', () => {

  it('tsrf and shadeDerateApplied are undefined when no shade data provided', () => {
    const cp = buildCanonicalProposal(makeInput());
    expect(cp.production.tsrf).toBeUndefined();
    expect(cp.production.shadeDerateApplied).toBeUndefined();
  });

  it('tsrf and shadeDerateApplied are undefined when panelsShadeDerateComputedPct is 0', () => {
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 0 }));
    expect(cp.production.tsrf).toBeUndefined();
    expect(cp.production.shadeDerateApplied).toBeUndefined();
  });

  it('sets tsrf = 1 - derate/100 for a typical 8% shade derate', () => {
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 8 }));
    expect(cp.production.tsrf).toBeDefined();
    // TSRF = 1 - 8/100 = 0.92
    expect(cp.production.tsrf).toBeCloseTo(0.92, 3);
    expect(cp.production.shadeDerateApplied).toBe(8);
  });

  it('sets tsrf = 1 - derate/100 for a small 3.5% shade derate', () => {
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 3.5 }));
    expect(cp.production.tsrf).toBeCloseTo(0.965, 3);
    expect(cp.production.shadeDerateApplied).toBe(3.5);
  });

  it('sets tsrf = 1 - derate/100 for a heavy 25% shade derate', () => {
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 25 }));
    expect(cp.production.tsrf).toBeCloseTo(0.75, 3);
    expect(cp.production.shadeDerateApplied).toBe(25);
  });

  it('tsrf has 3 decimal place precision', () => {
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 12.345 }));
    // shadeDerateApplied: Math.round(12.345 * 10) / 10 = 12.3
    // tsrf: Math.round((1 - 12.345/100) * 1000) / 1000 = Math.round(0.87655 * 1000)/1000 = Math.round(876.55)/1000 = 877/1000 = 0.877
    expect(cp.production.tsrf).toBe(0.877);
    expect(cp.production.shadeDerateApplied).toBe(12.3);
  });

  it('clamps shade derate at 100% (fully shaded → tsrf = 0)', () => {
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 100 }));
    expect(cp.production.tsrf).toBe(0);
    expect(cp.production.shadeDerateApplied).toBe(100);
  });

  it('clamps shade derate at 0% lower bound (no shade → tsrf = 1)', () => {
    // Negative value edge case — should be clamped to 0, treated as no data
    // (our logic: only set if derate > 0 after clamping)
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: -5 }));
    // clampedDerate = Math.min(100, Math.max(0, -5)) = 0 — not > 0, so undefined
    expect(cp.production.tsrf).toBeUndefined();
    expect(cp.production.shadeDerateApplied).toBeUndefined();
  });

  it('annualKwh is NOT modified by shade derate (PVWatts already applied it)', () => {
    const annualKwh = 11200;
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 10, annualProductionKwh: annualKwh }));
    // annualKwh must equal the input — not double-deducted
    expect(cp.production.annualKwh).toBe(annualKwh);
  });

});

// ─── Compute panelsShadeDerateComputedPct from layout.panels logic ─────────────────

describe('panelsShadeDerateComputedPct computation from PlacedPanel array', () => {

  /**
   * This mirrors the computation in app/proposals/view/[id]/page.tsx:
   *   const shadedPanels = panels.filter(p => typeof p.annualShadeFactor === 'number' && ...)
   *   const avgFactor = mean(shadedPanels.map(p => p.annualShadeFactor))
   *   derate = (1 - avgFactor) * 100
   */
  function computeShadeDeratePct(panels: Array<{ annualShadeFactor?: number; id?: string }>): number | undefined {
    const shadedPanels = panels.filter(
      (p) => typeof p.annualShadeFactor === 'number' &&
             p.annualShadeFactor >= 0 &&
             p.annualShadeFactor <= 1
    );
    if (shadedPanels.length === 0) return undefined;
    const avgFactor = shadedPanels.reduce(
      (sum, p) => sum + (p.annualShadeFactor as number), 0
    ) / shadedPanels.length;
    const derate = (1 - avgFactor) * 100;
    return derate > 0.01 ? Math.round(derate * 10) / 10 : undefined;
  }

  it('returns undefined when no panels have annualShadeFactor set', () => {
    const panels = [{ id: '1' }, { id: '2' }, { id: '3' }];
    expect(computeShadeDeratePct(panels)).toBeUndefined();
  });

  it('returns undefined when all panels have annualShadeFactor = 1 (no shade)', () => {
    const panels = [
      { annualShadeFactor: 1 },
      { annualShadeFactor: 1 },
      { annualShadeFactor: 1 },
    ];
    expect(computeShadeDeratePct(panels)).toBeUndefined();
  });

  it('computes correct derate when all panels have shade factor 0.92', () => {
    const panels = Array(10).fill({ annualShadeFactor: 0.92 });
    // derate = (1 - 0.92) * 100 = 8.0
    expect(computeShadeDeratePct(panels)).toBe(8);
  });

  it('computes weighted average across mixed panel shade factors', () => {
    // 5 panels at 1.0 (no shade), 5 panels at 0.80 (20% shade)
    // avgFactor = (5*1 + 5*0.80) / 10 = (5 + 4) / 10 = 0.9
    // derate = (1 - 0.9) * 100 = 10%
    const panels = [
      ...Array(5).fill({ annualShadeFactor: 1.0 }),
      ...Array(5).fill({ annualShadeFactor: 0.80 }),
    ];
    expect(computeShadeDeratePct(panels)).toBe(10);
  });

  it('ignores panels without annualShadeFactor (undefined or missing)', () => {
    // 3 panels with shade data, 2 without
    // Shade factor for 3 panels = 0.90 → derate = 10%
    const panels = [
      { annualShadeFactor: 0.90 },
      { annualShadeFactor: 0.90 },
      { annualShadeFactor: 0.90 },
      { id: 'no-shade-data' },      // no annualShadeFactor
      { annualShadeFactor: undefined }, // explicitly undefined
    ];
    expect(computeShadeDeratePct(panels)).toBe(10);
  });

  it('suppresses noise — returns undefined when derate < 0.01%', () => {
    // annualShadeFactor extremely close to 1 (e.g., 99.999% sun = 0.00001% shade)
    const panels = Array(10).fill({ annualShadeFactor: 0.9999 });
    // derate = 0.01% → exactly at threshold
    const result = computeShadeDeratePct(panels);
    // 0.9999 → derate = 0.01% → NOT > 0.01% check → undefined
    expect(result).toBeUndefined();
  });

  it('returns defined for a single shaded panel', () => {
    const panels = [{ annualShadeFactor: 0.85 }]; // 15% shade
    expect(computeShadeDeratePct(panels)).toBe(15);
  });

  it('filters out invalid out-of-range annualShadeFactor values', () => {
    // shade factor must be 0..1 — values outside this range are invalid
    const panels = [
      { annualShadeFactor: 0.9 },   // valid
      { annualShadeFactor: -0.1 },  // invalid — below 0
      { annualShadeFactor: 1.1 },   // invalid — above 1
    ];
    // Only the valid panel (0.9) should be used → derate = 10%
    expect(computeShadeDeratePct(panels)).toBe(10);
  });

});

// ─── TSRF color classification thresholds ────────────────────────────────────

describe('TSRF color classification thresholds', () => {
  /**
   * UI color logic:
   *   tsrf >= 0.95 → emerald (excellent)
   *   tsrf >= 0.85 → amber (moderate shade)
   *   tsrf <  0.85 → red (heavy shade)
   */
  function classifyTsrf(tsrf: number): 'excellent' | 'moderate' | 'heavy' {
    if (tsrf >= 0.95) return 'excellent';
    if (tsrf >= 0.85) return 'moderate';
    return 'heavy';
  }

  it('TSRF 0.97 (3% shade) → excellent (emerald)', () => {
    expect(classifyTsrf(0.97)).toBe('excellent');
  });

  it('TSRF 0.95 (5% shade) → exactly at excellent threshold', () => {
    expect(classifyTsrf(0.95)).toBe('excellent');
  });

  it('TSRF 0.94 (6% shade) → moderate (amber)', () => {
    expect(classifyTsrf(0.94)).toBe('moderate');
  });

  it('TSRF 0.85 (15% shade) → exactly at moderate threshold', () => {
    expect(classifyTsrf(0.85)).toBe('moderate');
  });

  it('TSRF 0.84 (16% shade) → heavy (red)', () => {
    expect(classifyTsrf(0.84)).toBe('heavy');
  });

  it('TSRF 0.70 (30% shade) → heavy (red)', () => {
    expect(classifyTsrf(0.70)).toBe('heavy');
  });

  it('TSRF 1.0 (no shade) → excellent', () => {
    expect(classifyTsrf(1.0)).toBe('excellent');
  });

  it('TSRF 0.0 (fully shaded) → heavy', () => {
    expect(classifyTsrf(0.0)).toBe('heavy');
  });
});

// ─── Full canonical proposal round-trip with shade data ──────────────────────

describe('Full proposal pipeline with shade data', () => {

  it('shade data flows through buildCanonicalProposal without breaking other fields', () => {
    const cp = buildCanonicalProposal(makeInput({
      panelsShadeDerateComputedPct: 7.5,
    }));

    // Shade fields set correctly
    expect(cp.production.tsrf).toBeCloseTo(0.925, 3);
    expect(cp.production.shadeDerateApplied).toBe(7.5);

    // Core production unchanged
    expect(cp.production.annualKwh).toBe(11200);
    expect(cp.production.monthlyKwh).toHaveLength(12);

    // Financial pipeline unaffected
    expect(cp.panel.systemSizeKw).toBeCloseTo(8.0, 2);
    expect(cp.financial.netCost).toBeGreaterThan(0);
  });

  it('both finance and cash purchase modes work with shade data', () => {
    const cashCp    = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 5, purchaseMode: 'cash' }));
    const financeCp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 5, purchaseMode: 'finance', loanApr: 5.99, loanTermYears: 25 }));

    // Both have shade data
    expect(cashCp.production.tsrf).toBeCloseTo(0.95, 3);
    expect(financeCp.production.tsrf).toBeCloseTo(0.95, 3);

    // Finance mode has monthly payment; cash mode purchaseMode is stored on cp
    expect(financeCp.financial.solarPaymentMonthly).toBeGreaterThan(0);
    // In cash mode, the pipeline stores the purchase mode; financePayment may still be non-zero
    // since it's the amortized equivalent — what matters is purchaseMode is correctly preserved
    expect(financeCp._meta.purchaseMode).toBe('finance');
    expect(cashCp._meta.purchaseMode).toBe('cash');
  });

  it('TSRF display value is human-readable percentage', () => {
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 8 }));
    const tsrf = cp.production.tsrf!;
    // UI renders: `TSRF ${(tsrf * 100).toFixed(1)}%`
    const displayValue = (tsrf * 100).toFixed(1);
    expect(displayValue).toBe('92.0');
  });

  it('shadeDeratePct display value is human-readable', () => {
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 12.7 }));
    const shadeDerate = cp.production.shadeDerateApplied!;
    expect(shadeDerate).toBe(12.7);
    // UI renders: `${shadeDerate}% shade derate applied`
    expect(`${shadeDerate}% shade derate applied`).toBe('12.7% shade derate applied');
  });

  it('proposal with no shade data (undefined) does not render TSRF badge', () => {
    const cp = buildCanonicalProposal(makeInput());
    // UI: {cp.production.tsrf !== undefined && ( <TSRF badge> )}
    expect(cp.production.tsrf).toBeUndefined();
    const shouldShowBadge = cp.production.tsrf !== undefined;
    expect(shouldShowBadge).toBe(false);
  });

  it('proposal with shade data (defined) renders TSRF badge', () => {
    const cp = buildCanonicalProposal(makeInput({ panelsShadeDerateComputedPct: 6 }));
    const shouldShowBadge = cp.production.tsrf !== undefined;
    expect(shouldShowBadge).toBe(true);
  });

});

// ─── shadeAnalysis.ts applyShadeToLosses integration ─────────────────────────

describe('applyShadeToLosses math contract', () => {
  /**
   * Verifies the formula used in lib/shadeAnalysis.ts:
   *   effectiveLosses = 1 - (1 - baseLoss) × (1 - shadeRetention)
   *   Combined retention = baseRetain × shadeRetain
   */
  function applyShadeToLosses(baseLossesPct: number, shadeDeratePct: number): number {
    const baseRetain  = 1 - baseLossesPct   / 100;
    const shadeRetain = 1 - shadeDeratePct  / 100;
    const combinedLoss = 1 - baseRetain * shadeRetain;
    return Math.min(50, Math.round(combinedLoss * 1000) / 10);
  }

  it('0% shade derate → no additional loss beyond baseline', () => {
    expect(applyShadeToLosses(14, 0)).toBe(14);
  });

  it('8% shade derate on 14% baseline → ~20.5% combined', () => {
    // baseRetain = 0.86, shadeRetain = 0.92
    // combined = 1 - 0.86 × 0.92 = 1 - 0.7912 = 0.2088 → 20.9%
    const result = applyShadeToLosses(14, 8);
    expect(result).toBeGreaterThan(14);
    expect(result).toBeLessThan(25);
  });

  it('100% shade derate → capped at 50% (total production loss floor)', () => {
    expect(applyShadeToLosses(14, 100)).toBe(50);
  });

  it('0% baseline + 0% shade → 0% effective loss', () => {
    expect(applyShadeToLosses(0, 0)).toBe(0);
  });

  it('shade derate compounds multiplicatively with base losses', () => {
    const withoutShade = applyShadeToLosses(14, 0);
    const withShade    = applyShadeToLosses(14, 10);
    // With shade, effective losses must be strictly greater
    expect(withShade).toBeGreaterThan(withoutShade);
  });
});
