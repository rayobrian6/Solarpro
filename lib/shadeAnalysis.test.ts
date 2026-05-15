// lib/shadeAnalysis.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeShadeAnalysis,
  shadeFactorToColor,
  classifyShade,
  applyShadeToLosses,
  estimateShadeDerateFromSurvey,
  type PanelShadeInput,
  type ObstructionProfile,
} from './shadeAnalysis';

// ── Helpers ─────────────────────────────────────────────────────────────────
function makePanels(count: number, tilt = 20, azimuth = 180): PanelShadeInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id:      `panel-${i}`,
    tilt,
    azimuth,
    row:     Math.floor(i / 4),
    col:     i % 4,
  }));
}

// ── Core analysis ─────────────────────────────────────────────────────────────

describe('computeShadeAnalysis', () => {
  it('returns empty result for empty panels array', () => {
    const result = computeShadeAnalysis([], 33.44, -112.07);
    expect(result.panelShadeFactors).toEqual({});
    expect(result.systemShadeDeratePct).toBe(0);
    expect(result.worstPanelId).toBeNull();
    expect(result.bestPanelId).toBeNull();
  });

  it('returns shade factors for single south-facing panel', () => {
    const panels: PanelShadeInput[] = [
      { id: 'p1', tilt: 20, azimuth: 180, row: 0, col: 0 },
    ];
    const result = computeShadeAnalysis(panels, 33.44, -112.07);

    expect(result.panelShadeFactors['p1']).toBeGreaterThan(0.7);
    expect(result.panelShadeFactors['p1']).toBeLessThanOrEqual(1.0);
  });

  it('south-facing panel has higher shade factor than north-facing at same lat', () => {
    const southPanel: PanelShadeInput[] = [
      { id: 'south', tilt: 20, azimuth: 180, row: 0, col: 0 },
    ];
    const northPanel: PanelShadeInput[] = [
      { id: 'north', tilt: 20, azimuth: 0, row: 0, col: 0 },
    ];

    const southResult = computeShadeAnalysis(southPanel, 33.44, -112.07);
    const northResult = computeShadeAnalysis(northPanel, 33.44, -112.07);

    // South-facing should have significantly better solar access than north-facing
    expect(southResult.panelShadeFactors['south']).toBeGreaterThan(
      northResult.panelShadeFactors['north']
    );
  });

  it('nearby tall obstruction reduces shade factor', () => {
    const panels: PanelShadeInput[] = [
      { id: 'p1', tilt: 20, azimuth: 180, row: 0, col: 0 },
    ];

    const noObs    = computeShadeAnalysis(panels, 33.44, -112.07);
    const withObs  = computeShadeAnalysis(panels, 33.44, -112.07, {
      nearbyObstruction: [{
        heightM:    10,
        distanceM:  5,
        azimuthDeg: 180,  // due south (worst case for north-hemisphere south-facing)
      }],
    });

    // Obstruction should reduce solar access
    expect(withObs.panelShadeFactors['p1']).toBeLessThan(noObs.panelShadeFactors['p1']);
  });

  it('north-facing obstruction does not affect south-facing panel significantly', () => {
    const panels: PanelShadeInput[] = [
      { id: 'p1', tilt: 20, azimuth: 180, row: 0, col: 0 },
    ];

    const noObs   = computeShadeAnalysis(panels, 33.44, -112.07);
    const withObs = computeShadeAnalysis(panels, 33.44, -112.07, {
      nearbyObstruction: [{
        heightM:    10,
        distanceM:  5,
        azimuthDeg: 0,   // due north (doesn't block south-facing panels)
      }],
    });

    // North obstruction should have minimal effect on south-facing panel
    const diff = Math.abs(noObs.panelShadeFactors['p1'] - withObs.panelShadeFactors['p1']);
    expect(diff).toBeLessThan(0.05);
  });

  it('returns correct worst/best panel IDs', () => {
    // Panel 1: optimal south-facing; Panel 2: north-facing (worse)
    const panels: PanelShadeInput[] = [
      { id: 'good', tilt: 20, azimuth: 180, row: 0, col: 0 },
      { id: 'bad',  tilt: 20, azimuth: 0,   row: 0, col: 1 },
    ];
    const result = computeShadeAnalysis(panels, 33.44, -112.07);

    expect(result.worstPanelId).toBe('bad');
    expect(result.bestPanelId).toBe('good');
  });

  it('systemShadeDeratePct is 0..100 range', () => {
    const panels = makePanels(8);
    const result = computeShadeAnalysis(panels, 33.44, -112.07);
    expect(result.systemShadeDeratePct).toBeGreaterThanOrEqual(0);
    expect(result.systemShadeDeratePct).toBeLessThanOrEqual(100);
  });

  it('heatmapBuckets has entry for every panel', () => {
    const panels = makePanels(6);
    const result = computeShadeAnalysis(panels, 33.44, -112.07);
    expect(result.heatmapBuckets).toHaveLength(6);
    for (const bucket of result.heatmapBuckets) {
      expect(bucket.shadeFactor).toBeGreaterThanOrEqual(0);
      expect(bucket.shadeFactor).toBeLessThanOrEqual(1);
      expect(bucket.color).toMatch(/^rgb\(/);
    }
  });

  it('flat panel (tilt=0) has reasonable shade factor', () => {
    const panels: PanelShadeInput[] = [
      { id: 'flat', tilt: 0, azimuth: 180, row: 0, col: 0 },
    ];
    const result = computeShadeAnalysis(panels, 33.44, -112.07);
    // Flat panels are not optimal but still receive some direct sun
    expect(result.panelShadeFactors['flat']).toBeGreaterThan(0.3);
  });

  it('vertical fence panel (tilt=90) has lower factor than tilted', () => {
    const tiltedPanel: PanelShadeInput[] = [
      { id: 'tilted', tilt: 20, azimuth: 180, row: 0, col: 0 },
    ];
    const verticalPanel: PanelShadeInput[] = [
      { id: 'vertical', tilt: 90, azimuth: 180, row: 0, col: 0 },
    ];

    const tiltedResult  = computeShadeAnalysis(tiltedPanel,  33.44, -112.07);
    const verticalResult = computeShadeAnalysis(verticalPanel, 33.44, -112.07);

    // 20° tilt should outperform 90° vertical for south-facing in Phoenix
    expect(tiltedResult.panelShadeFactors['tilted']).toBeGreaterThan(
      verticalResult.panelShadeFactors['vertical']
    );
  });

  it('handles horizon elevations profile', () => {
    const panels: PanelShadeInput[] = [
      { id: 'p1', tilt: 20, azimuth: 180, row: 0, col: 0 },
    ];

    // Fill all azimuths with 30° horizon (heavily constrained)
    const horizonElevations = new Array(360).fill(30);

    const constrained = computeShadeAnalysis(panels, 33.44, -112.07, { horizonElevations });
    const open        = computeShadeAnalysis(panels, 33.44, -112.07);

    // Constrained horizon should reduce shade factor
    expect(constrained.panelShadeFactors['p1']).toBeLessThan(open.panelShadeFactors['p1']);
  });
});

// ── shadeFactorToColor ────────────────────────────────────────────────────────

describe('shadeFactorToColor', () => {
  it('returns red-range for factor=0', () => {
    const color = shadeFactorToColor(0);
    expect(color).toMatch(/^rgb\(/);
    const [r, g] = color.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(g); // red > green for shaded
  });

  it('returns green-range for factor=1', () => {
    const color = shadeFactorToColor(1);
    const [r, g] = color.match(/\d+/g)!.map(Number);
    expect(g).toBeGreaterThan(r); // green > red for full sun
  });

  it('clamps below 0', () => {
    expect(shadeFactorToColor(-0.5)).toEqual(shadeFactorToColor(0));
  });

  it('clamps above 1', () => {
    expect(shadeFactorToColor(1.5)).toEqual(shadeFactorToColor(1));
  });
});

// ── classifyShade ─────────────────────────────────────────────────────────────

describe('classifyShade', () => {
  it('classifies >= 0.97 as excellent', () => {
    expect(classifyShade(1.00).severity).toBe('excellent');
    expect(classifyShade(0.97).severity).toBe('excellent');
  });

  it('classifies 0.93..0.97 as good', () => {
    expect(classifyShade(0.95).severity).toBe('good');
    expect(classifyShade(0.93).severity).toBe('good');
  });

  it('classifies 0.85..0.93 as moderate', () => {
    expect(classifyShade(0.89).severity).toBe('moderate');
  });

  it('classifies 0.70..0.85 as significant', () => {
    expect(classifyShade(0.78).severity).toBe('significant');
  });

  it('classifies < 0.70 as severe', () => {
    expect(classifyShade(0.50).severity).toBe('severe');
    expect(classifyShade(0.00).severity).toBe('severe');
  });
});

// ── applyShadeToLosses ────────────────────────────────────────────────────────

describe('applyShadeToLosses', () => {
  it('returns baseLosses when shadeDeratePct is 0', () => {
    const result = applyShadeToLosses(14, 0);
    expect(result).toBeCloseTo(14, 1);
  });

  it('combined losses are greater than either alone', () => {
    const combined = applyShadeToLosses(14, 10);
    expect(combined).toBeGreaterThan(14);
    expect(combined).toBeGreaterThan(10);
  });

  it('caps at 50% max combined losses', () => {
    const capped = applyShadeToLosses(40, 40);
    expect(capped).toBeLessThanOrEqual(50);
  });

  it('14% base + 10% shade = ~22.6%', () => {
    // (1 - 0.14) × (1 - 0.10) = 0.86 × 0.90 = 0.774 → losses = 22.6%
    const combined = applyShadeToLosses(14, 10);
    expect(combined).toBeCloseTo(22.6, 1);
  });
});

// ── estimateShadeDerateFromSurvey ─────────────────────────────────────────────

describe('estimateShadeDerateFromSurvey', () => {
  it('excellent roof + no trees = minimal derate', () => {
    const derate = estimateShadeDerateFromSurvey('excellent', 'none', 20, 0);
    expect(derate).toBeLessThan(5);
  });

  it('poor roof + heavy trees = significant derate', () => {
    const derate = estimateShadeDerateFromSurvey('poor', 'heavy', 20, 0);
    expect(derate).toBeGreaterThan(25);
  });

  it('caps at 35%', () => {
    const derate = estimateShadeDerateFromSurvey('poor', 'heavy', 5, 90);
    expect(derate).toBeLessThanOrEqual(35);
  });

  it('returns higher value for east-facing than south-facing', () => {
    const south = estimateShadeDerateFromSurvey('good', 'none', 20, 0);
    const east  = estimateShadeDerateFromSurvey('good', 'none', 20, 90);
    expect(east).toBeGreaterThanOrEqual(south);
  });
});
