// ============================================================================
// Phase 4B: Unit tests for lib/satellite/areaComputer.ts
//
// Tests the usable roof area computation from obstructions + geometry.
// Pure function -- no mocks needed.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { computeUsableRoofArea, quickUsableAreaEstimate } from './areaComputer';
import type { Obstruction } from '../survey/v2/types';

function makeObstruction(type: Obstruction['type'], location: Obstruction['location'] = 'ridge'): Obstruction {
  return {
    id: `test_${type}_${location}`,
    type,
    location,
    notes: '',
  };
}

describe('computeUsableRoofArea', () => {
  it('returns base setback percentage when no obstructions', () => {
    const result = computeUsableRoofArea({ obstructions: [] });
    expect(result.usablePct).toBe(80); // default residential
    expect(result.confidence).toBe('low');
    expect(result.source).toBe('local_calc');
    expect(result.obstructionReductionPct).toBe(0);
  });

  it('reduces usable area for each obstruction', () => {
    const obstructions = [
      makeObstruction('chimney'),
      makeObstruction('vent_pipe'),
    ];
    const result = computeUsableRoofArea({ obstructions });
    // chimney=3 + vent_pipe=1 = 4 reduction from 80 = 76
    expect(result.usablePct).toBe(76);
    expect(result.obstructionReductionPct).toBe(4);
  });

  it('applies commercial base setback for commercial buildings', () => {
    const result = computeUsableRoofArea({
      obstructions: [],
      structureType: 'commercial',
    });
    expect(result.usablePct).toBe(75);
  });

  it('handles heavy obstructions with cap', () => {
    // Many obstructions should not reduce below 5%
    const obstructions = [
      makeObstruction('tree_shade'),  // 15
      makeObstruction('dormer'),      // 10
      makeObstruction('hvac_unit'),    // 8
      makeObstruction('skylight'),     // 4
      makeObstruction('chimney'),      // 3
      makeObstruction('other'),        // 5
      makeObstruction('antenna'),      // 2
      makeObstruction('satellite_dish'), // 2
      makeObstruction('exhaust_fan'),  // 2
      makeObstruction('solar_tube'),   // 2
    ];
    // Total reduction = 53 (under cap of 60). 80 - 53 = 27
    const result = computeUsableRoofArea({ obstructions });
    expect(result.usablePct).toBe(27);
    expect(result.obstructionReductionPct).toBe(53);
  });

  it('caps reduction at 60 points even with extreme obstructions', () => {
    // 5 tree shades = 75 raw reduction, but capped at 60
    const obstructions = [
      makeObstruction('tree_shade', 'north'),
      makeObstruction('tree_shade', 'south'),
      makeObstruction('tree_shade', 'east'),
      makeObstruction('tree_shade', 'west'),
      makeObstruction('dormer'),
      makeObstruction('hvac_unit'),
    ];
    // Raw total = 15*4 + 10 + 8 = 78, capped at 60. 80 - 60 = 20
    const result = computeUsableRoofArea({ obstructions });
    expect(result.usablePct).toBe(20);
    expect(result.obstructionReductionPct).toBe(60);
  });

  it('marks satellite-sourced obstructions with medium confidence', () => {
    const obstructions = [makeObstruction('chimney')];
    const result = computeUsableRoofArea({
      obstructions,
      obstructionsSource: 'satellite',
    });
    expect(result.source).toBe('satellite');
    expect(result.confidence).toBe('medium');
  });

  it('marks survey-sourced obstructions with high confidence', () => {
    const obstructions = [makeObstruction('chimney')];
    const result = computeUsableRoofArea({
      obstructions,
      obstructionsSource: 'survey',
    });
    expect(result.source).toBe('survey');
    expect(result.confidence).toBe('high');
  });

  it('produces clear derivation string', () => {
    const obstructions = [makeObstruction('chimney'), makeObstruction('skylight')];
    const result = computeUsableRoofArea({ obstructions });
    expect(result.derivation).toContain('Base 80%');
    expect(result.derivation).toContain('7%');  // chimney(3) + skylight(4) = 7
    expect(result.derivation).toContain('2 obstructions');
  });

  it('respects custom base setback percentage', () => {
    const result = computeUsableRoofArea({
      obstructions: [],
      baseSetbackPct: 85,
    });
    expect(result.usablePct).toBe(85);
  });

  it('never goes below 5% usable', () => {
    const result = computeUsableRoofArea({
      obstructions: [],
      baseSetbackPct: 2,
    });
    expect(result.usablePct).toBe(5);
  });
});

describe('quickUsableAreaEstimate', () => {
  it('returns residential default with low confidence', () => {
    const result = quickUsableAreaEstimate();
    expect(result.usablePct).toBe(80);
    expect(result.confidence).toBe('low');
    expect(result.source).toBe('local_calc');
  });

  it('returns commercial default for commercial buildings', () => {
    const result = quickUsableAreaEstimate('commercial');
    expect(result.usablePct).toBe(75);
  });
});

describe('mapConfidence (types.ts)', () => {
  it('maps high confidence for >= 0.75', async () => {
    const { mapConfidence } = await import('./types');
    expect(mapConfidence(0.9)).toBe('high');
    expect(mapConfidence(0.75)).toBe('high');
  });

  it('maps medium confidence for 0.45-0.74', async () => {
    const { mapConfidence } = await import('./types');
    expect(mapConfidence(0.6)).toBe('medium');
    expect(mapConfidence(0.45)).toBe('medium');
  });

  it('maps low confidence for < 0.45', async () => {
    const { mapConfidence } = await import('./types');
    expect(mapConfidence(0.3)).toBe('low');
    expect(mapConfidence(0.1)).toBe('low');
  });
});

describe('detectedToSurveyObstruction (types.ts)', () => {
  it('converts a DetectedObstruction to survey Obstruction format', async () => {
    const { detectedToSurveyObstruction } = await import('./types');
    const detected = {
      type: 'chimney' as const,
      location: 'ridge' as const,
      confidence: 0.7,
      source: 'satellite' as const,
      derivation: 'Chimney found in OSM',
    };
    const obs = detectedToSurveyObstruction(detected);
    expect(obs.type).toBe('chimney');
    expect(obs.location).toBe('ridge');
    expect(obs.id).toMatch(/^sat_/);
    expect(obs.notes).toContain('Satellite');
    expect(obs.notes).toContain('Chimney found in OSM');
  });
});
