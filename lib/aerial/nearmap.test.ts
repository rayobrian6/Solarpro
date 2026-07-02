import { describe, it, expect } from 'vitest';
import {
  mapNearmapRoofPlanes,
  aoiPolygonAround,
  fetchNearmapRoofPlanes,
  checkNearmapCoverage,
} from './nearmap';

// Trimmed real Nearmap AI Feature response shape (verified against the live eval).
const SAMPLE = {
  surveyDate: '2026-02-27',
  credits: 1,
  features: [
    {
      id: '88b08f42-aaaa', description: 'Roof', confidence: 0.9,
      areaSqft: 1058, unclippedAreaSqft: 1102,
      geometry: { type: 'Polygon', coordinates: [[[-89.9538, 38.8110], [-89.9534, 38.8110], [-89.9534, 38.8113], [-89.9538, 38.8113], [-89.9538, 38.8110]]] },
      attributes: [
        { description: 'Roof 3d attributes', has3dAttributes: true, pitch: 22.55013 },
        { description: 'Roof material', components: [
          { description: 'Shingle', ratio: 0.9, dominant: true },
          { description: 'Metal', ratio: 0.1, dominant: false },
        ] },
        { description: 'Roof types', components: [
          { description: 'Gable', ratio: 0.8, dominant: true },
          { description: 'Hip', ratio: 0.2, dominant: false },
        ] },
      ],
    },
    { id: 'car-1', description: 'Car', geometry: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[0,0]]] } },
    { id: 'flat-1', description: 'Roof', confidence: 0.99, areaSqft: 11046,
      geometry: { type: 'Polygon', coordinates: [[[-89.95,38.81],[-89.949,38.81],[-89.949,38.811],[-89.95,38.811],[-89.95,38.81]]] },
      attributes: [{ description: 'Roof 3d attributes', has3dAttributes: true, pitch: 1.6055 }] },
  ],
};

describe('mapNearmapRoofPlanes', () => {
  it('maps Roof features to roof planes with real geometry + pitch + material', () => {
    const planes = mapNearmapRoofPlanes(SAMPLE);
    expect(planes.length).toBe(2);                 // 2 roofs, the Car filtered out
    const r = planes[0];
    expect(r.worldPolygon.length).toBeGreaterThanOrEqual(4);
    expect(r.worldPolygon[0]).toMatchObject({ lat: 38.8110, lng: -89.9538 }); // [lon,lat] → {lat,lng}
    expect(r.areaSqft).toBe(1058);
    expect(r.pitchDeg).toBeCloseTo(22.6, 1);       // from Roof 3d attributes
    expect(r.material).toBe('Shingle');            // dominant
    expect(r.roofType).toBe('Gable');              // dominant
    expect(r.azimuthDeg).toBeNull();               // honest gap — not fabricated
    expect(r.source).toBe('nearmap_ai');
    expect(r.captureDate).toBe('2026-02-27');
  });

  it('captures flat-roof pitch and rounds it', () => {
    const planes = mapNearmapRoofPlanes(SAMPLE);
    expect(planes[1].pitchDeg).toBeCloseTo(1.6, 1);
  });

  it('returns [] for junk / empty input', () => {
    expect(mapNearmapRoofPlanes(null)).toEqual([]);
    expect(mapNearmapRoofPlanes({})).toEqual([]);
    expect(mapNearmapRoofPlanes({ features: [{ description: 'Tree' }] })).toEqual([]);
  });
});

describe('aoiPolygonAround', () => {
  it('builds a closed lon,lat ring around a point', () => {
    const poly = aoiPolygonAround(38.81, -89.95, 40);
    const nums = poly.split(',').map(Number);
    expect(nums.length).toBe(10);                  // 5 points × (lon,lat)
    expect(nums[0]).toBeCloseTo(nums[8], 6);       // ring closed (first == last)
    expect(nums[1]).toBeCloseTo(nums[9], 6);
  });
});

describe('fail-safe with no API key', () => {
  it('fetch returns [] and coverage returns null when NEARMAP_API_KEY is unset', async () => {
    const saved = process.env.NEARMAP_API_KEY;
    delete process.env.NEARMAP_API_KEY;
    try {
      expect(await fetchNearmapRoofPlanes(38.81, -89.95)).toEqual([]);
      expect(await checkNearmapCoverage(38.81, -89.95)).toBeNull();
    } finally {
      if (saved !== undefined) process.env.NEARMAP_API_KEY = saved;
    }
  });
});
