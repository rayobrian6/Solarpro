// ============================================================================
// lib/system/optimizerMergeHint.test.ts — v47.409
//
// Unit tests for the optimizer-system merge-hint composer. Covers the
// full gating decision tree + the expected message content.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { composeOptimizerMergeHint } from './optimizerMergeHint';

describe('composeOptimizerMergeHint — v47.409 gating', () => {
  // Baseline "valid scenario" — every helper test derives from this.
  const base = {
    topology: 'optimizer' as const,
    hasCurrentExceeded: true,
    currentStringPanelCounts: [10, 10, 10, 6],  // 4 strings = 36 panels
    recommendedStringPanelCounts: [9, 9, 9, 9],  // still 4 strings, same panels
    perStringCurrentA: 15.0,
    mpptChannels: 2,
    maxInputCurrentPerMpptA: 20,
  };

  it('returns null for string topology (non-optimizer)', () => {
    const result = composeOptimizerMergeHint({
      ...base,
      topology: 'string',
      recommendedStringPanelCounts: [18, 18],  // even with merge recommendation
    });
    expect(result).toBeNull();
  });

  it('returns null for hybrid topology (non-optimizer)', () => {
    const result = composeOptimizerMergeHint({
      ...base,
      topology: 'hybrid',
      recommendedStringPanelCounts: [18, 18],
    });
    expect(result).toBeNull();
  });

  it('returns null when no current-exceeded violation', () => {
    const result = composeOptimizerMergeHint({
      ...base,
      hasCurrentExceeded: false,
      recommendedStringPanelCounts: [18, 18],
    });
    expect(result).toBeNull();
  });

  it('returns null when no recommendation provided', () => {
    const result = composeOptimizerMergeHint({
      ...base,
      recommendedStringPanelCounts: undefined,
    });
    expect(result).toBeNull();
  });

  it('returns null when recommendation is an empty array', () => {
    const result = composeOptimizerMergeHint({
      ...base,
      recommendedStringPanelCounts: [],
    });
    expect(result).toBeNull();
  });

  it('returns null when recommendation has SAME number of strings (no merge improvement)', () => {
    // 4 current → 4 recommended: redistributing doesn't reduce current.
    const result = composeOptimizerMergeHint({
      ...base,
      recommendedStringPanelCounts: [9, 9, 9, 9],
    });
    expect(result).toBeNull();
  });

  it('returns null when recommendation has MORE strings (adding strings makes current worse)', () => {
    const result = composeOptimizerMergeHint({
      ...base,
      currentStringPanelCounts: [18, 18],
      recommendedStringPanelCounts: [9, 9, 9, 9],
    });
    expect(result).toBeNull();
  });

  it('returns null when perStringCurrentA is zero or negative', () => {
    expect(
      composeOptimizerMergeHint({
        ...base,
        recommendedStringPanelCounts: [18, 18],
        perStringCurrentA: 0,
      }),
    ).toBeNull();
  });

  it('returns a hint when all preconditions met (4 strings → 2 strings)', () => {
    const result = composeOptimizerMergeHint({
      ...base,
      recommendedStringPanelCounts: [18, 18],  // 2 strings, same 36 panels
    });
    expect(result).not.toBeNull();
    expect(result).toContain('OPTIMIZER_LAYOUT_SUGGEST_MERGE');
  });
});

describe('composeOptimizerMergeHint — v47.409 content shape', () => {
  // Reproduces the production screenshot:
  //   4 strings of 10/10/10/6 on SE7600H-US (2 MPPT total × 20A)
  //   Recommendation: 2 strings of 18 panels each
  //   Per-string current cap: 15 A
  //   Expected: current 60A > capacity 40A, recommended 30A fits.
  const productionScenario = composeOptimizerMergeHint({
    topology: 'optimizer' as const,
    hasCurrentExceeded: true,
    currentStringPanelCounts: [10, 10, 10, 6],
    recommendedStringPanelCounts: [18, 18],
    perStringCurrentA: 15.0,
    mpptChannels: 2,
    maxInputCurrentPerMpptA: 20,
  });

  it('contains the violation code prefix for UI parsing', () => {
    expect(productionScenario).toContain('OPTIMIZER_LAYOUT_SUGGEST_MERGE:');
  });

  it('reports the current layout description (10/10/10/6)', () => {
    expect(productionScenario).toContain('10/10/10/6');
  });

  it('reports the recommended layout description (18/18)', () => {
    expect(productionScenario).toContain('18/18');
  });

  it('reports current total draw (60.0A) and recommended total draw (30.0A)', () => {
    expect(productionScenario).toContain('60.0A');  // 4 × 15
    expect(productionScenario).toContain('30.0A');  // 2 × 15
  });

  it('reports the MPPT channel capacity (40.0A)', () => {
    expect(productionScenario).toContain('40.0A');  // 2 ch × 20A
  });

  it('tells the user to click Apply Recommended Configuration', () => {
    expect(productionScenario).toContain('Apply Recommended Configuration');
  });

  it('explains that string length does NOT change per-string current on optimizer systems', () => {
    expect(productionScenario).toContain('string length does not change per-string current');
    expect(productionScenario).toContain('reduce the string count');
  });

  it('references the per-string current cap explicitly (15.0A regardless of length)', () => {
    // Optimizer cap is the key insight — must be stated clearly.
    expect(productionScenario).toContain('15.0A');
  });
});

describe('composeOptimizerMergeHint — v47.409 custom per-string current', () => {
  // For a hypothetical optimizer SKU rated at 10.5A (e.g. future low-Isc
  // optimizer), the hint should use the client-supplied cap consistently.
  const customSkuResult = composeOptimizerMergeHint({
    topology: 'optimizer' as const,
    hasCurrentExceeded: true,
    currentStringPanelCounts: [6, 6, 6, 6],
    recommendedStringPanelCounts: [12, 12],
    perStringCurrentA: 10.5,
    mpptChannels: 2,
    maxInputCurrentPerMpptA: 20,
  });

  it('honors a non-default perStringCurrentA in totals', () => {
    // 4 × 10.5 = 42A vs 2 × 10.5 = 21A.
    expect(customSkuResult).toContain('42.0A');
    expect(customSkuResult).toContain('21.0A');
    expect(customSkuResult).toContain('10.5A');
  });
});

describe('composeOptimizerMergeHint — v47.409 input sanitization', () => {
  // Client might send garbage in recommendedStringPanelCounts (zeroes,
  // negatives, non-numbers). Helper should filter them out before gating.
  it('filters out non-positive entries from the recommendation', () => {
    const result = composeOptimizerMergeHint({
      topology: 'optimizer',
      hasCurrentExceeded: true,
      currentStringPanelCounts: [10, 10, 10, 6],
      // After filtering [0, -1, NaN, 18] we get [18] → 1 string < 4 → hint fires.
      recommendedStringPanelCounts: [0, -1, NaN as any, 18],
      perStringCurrentA: 15.0,
      mpptChannels: 2,
      maxInputCurrentPerMpptA: 20,
    });
    expect(result).not.toBeNull();
    expect(result).toContain('18');  // cleaned recommended layout
  });

  it('returns null when every recommended entry is invalid (sanitization empties the list)', () => {
    const result = composeOptimizerMergeHint({
      topology: 'optimizer',
      hasCurrentExceeded: true,
      currentStringPanelCounts: [10, 10, 10, 6],
      recommendedStringPanelCounts: [0, -1, NaN as any],
      perStringCurrentA: 15.0,
      mpptChannels: 2,
      maxInputCurrentPerMpptA: 20,
    });
    expect(result).toBeNull();
  });
});