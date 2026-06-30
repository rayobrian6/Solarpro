import { describe, it, expect } from 'vitest';
import {
  mapNearmapRoofPlanes,
  aoiPolygonAround,
  fetchNearmapRoofPlanes,
  checkNearmapCoverage,
  mapNearmapObstructions,
  mapObstructionDescription,
  OBSTRUCTION_CLEARANCE_M,
  fetchNearmapObstructions,
} from './nearmap';
import type { NearmapObstructionType, NearmapObstruction } from './nearmap';

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

// ── Nearmap obstruction tests ──────────────────────────────────────────

// Sample AI Feature response with obstructions mixed in
const OBSTRUCTION_SAMPLE = {
  surveyDate: '2026-02-27',
  credits: 1,
  features: [
    {
      id: 'roof-1', description: 'Roof', confidence: 0.9,
      areaSqft: 1058,
      geometry: { type: 'Polygon', coordinates: [[[-89.9538, 38.8110], [-89.9534, 38.8110], [-89.9534, 38.8113], [-89.9538, 38.8113], [-89.9538, 38.8110]]] },
    },
    {
      id: 'vent-1', description: 'Vent', confidence: 0.85,
      geometry: { type: 'Polygon', coordinates: [[[-89.9537, 38.8111], [-89.9536, 38.8111], [-89.9536, 38.81115], [-89.9537, 38.81115], [-89.9537, 38.8111]]] },
    },
    {
      id: 'chimney-1', description: 'Residential Chimney', confidence: 0.92,
      geometry: { type: 'Polygon', coordinates: [[[-89.9535, 38.8112], [-89.9534, 38.8112], [-89.9534, 38.81125], [-89.9535, 38.81125], [-89.9535, 38.8112]]] },
    },
    {
      id: 'ac-1', description: 'A/C Condenser Unit', confidence: 0.78,
      geometry: { type: 'Polygon', coordinates: [[[-89.9533, 38.8110], [-89.9532, 38.8110], [-89.9532, 38.8111], [-89.9533, 38.8111], [-89.9533, 38.8110]]] },
    },
    {
      id: 'dish-1', description: 'Residential Satellite Dish', confidence: 0.65,
      geometry: { type: 'Polygon', coordinates: [[[-89.9531, 38.8111], [-89.9530, 38.8111], [-89.9530, 38.81112], [-89.9531, 38.81112], [-89.9531, 38.8111]]] },
    },
    {
      id: 'car-1', description: 'Car', confidence: 0.7,
      geometry: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[0,0]]] },
    },
    {
      id: 'tree-1', description: 'Tree', confidence: 0.8,
      geometry: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[0,0]]] },
    },
  ],
};

describe('mapNearmapObstructions', () => {
  it('extracts obstructions and filters out non-obstruction features', () => {
    const obs = mapNearmapObstructions(OBSTRUCTION_SAMPLE);
    // Roof, Car, Tree should be filtered out; Vent, Chimney, A/C, Dish should remain
    expect(obs.length).toBe(4);
    expect(obs.map(o => o.type)).toEqual(['vent', 'chimney', 'ac_unit', 'satellite']);
  });

  it('preserves real lat/lng geometry from Nearmap response', () => {
    const obs = mapNearmapObstructions(OBSTRUCTION_SAMPLE);
    const vent = obs.find(o => o.type === 'vent');
    expect(vent).toBeDefined();
    expect(vent!.polygon.length).toBeGreaterThanOrEqual(4);
    expect(vent!.polygon[0]).toMatchObject({ lat: 38.8111, lng: -89.9537 });
    expect(vent!.confidence).toBeCloseTo(0.85, 2);
    expect(vent!.captureDate).toBe('2026-02-27');
  });

  it('preserves original Nearmap description alongside mapped type', () => {
    const obs = mapNearmapObstructions(OBSTRUCTION_SAMPLE);
    const chimney = obs.find(o => o.type === 'chimney');
    expect(chimney!.description).toBe('Residential Chimney');
    const ac = obs.find(o => o.type === 'ac_unit');
    expect(ac!.description).toBe('A/C Condenser Unit');
  });

  it('returns [] for junk / empty input', () => {
    expect(mapNearmapObstructions(null)).toEqual([]);
    expect(mapNearmapObstructions({})).toEqual([]);
    expect(mapNearmapObstructions({ features: [{ description: 'Roof' }] })).toEqual([]);
    expect(mapNearmapObstructions({ features: [{ description: 'Car' }] })).toEqual([]);
  });
});

describe('mapObstructionDescription', () => {
  it('maps Nearmap class names to obstruction types', () => {
    expect(mapObstructionDescription('Vent')).toBe('vent');
    expect(mapObstructionDescription('Residential Chimney')).toBe('chimney');
    expect(mapObstructionDescription('A/C Condenser Unit')).toBe('ac_unit');
    expect(mapObstructionDescription('Residential Satellite Dish')).toBe('satellite');
    expect(mapObstructionDescription('Skylight')).toBe('skylight');
    expect(mapObstructionDescription('Pipe Boot')).toBe('vent');
    expect(mapObstructionDescription('Exhaust Vent')).toBe('vent');
  });

  it('maps unknown descriptions to "other"', () => {
    expect(mapObstructionDescription('Unknown Object')).toBe('other');
    expect(mapObstructionDescription('Dormer')).toBe('other');
  });
});

describe('OBSTRUCTION_CLEARANCE_M', () => {
  it('has a clearance buffer for every type', () => {
    const types: NearmapObstructionType[] = ['vent', 'chimney', 'ac_unit', 'satellite', 'skylight', 'other'];
    for (const t of types) {
      expect(OBSTRUCTION_CLEARANCE_M[t]).toBeGreaterThan(0);
    }
  });

  it('chimney has the largest clearance', () => {
    expect(OBSTRUCTION_CLEARANCE_M.chimney).toBeGreaterThan(OBSTRUCTION_CLEARANCE_M.vent);
    expect(OBSTRUCTION_CLEARANCE_M.chimney).toBeGreaterThan(OBSTRUCTION_CLEARANCE_M.ac_unit);
  });
});

describe('fetchNearmapObstructions fail-safe', () => {
  it('returns [] when NEARMAP_API_KEY is unset', async () => {
    const saved = process.env.NEARMAP_API_KEY;
    delete process.env.NEARMAP_API_KEY;
    try {
      expect(await fetchNearmapObstructions(38.81, -89.95)).toEqual([]);
    } finally {
      if (saved !== undefined) process.env.NEARMAP_API_KEY = saved;
    }
  });
});

// ── Panel exclusion by obstruction keep-out tests ──────────────────────
import {
  obstructionToKeepOutZone,
  expandPolygon,
  pointInPolygonLatLng,
  panelOverlapsKeepOut,
  filterPanelsByObstructions,
} from '../placementEngine';

describe('expandPolygon', () => {
  it('expands a square polygon outward by clearance buffer', () => {
    // Small square at ~38.81°N (IL test site)
    const sq = [
      { lat: 38.8110, lng: -89.9535 },
      { lat: 38.8110, lng: -89.9534 },
      { lat: 38.8111, lng: -89.9534 },
      { lat: 38.8111, lng: -89.9535 },
    ];
    const expanded = expandPolygon(sq, 0.3);
    expect(expanded.length).toBe(4);
    // Each vertex should be further from centroid after expansion
    const centLat = sq.reduce((s, v) => s + v.lat, 0) / 4;
    const centLng = sq.reduce((s, v) => s + v.lng, 0) / 4;
    for (let i = 0; i < 4; i++) {
      const origDist = Math.sqrt(
        ((sq[i].lng - centLng) * 111320 * Math.cos(centLat * Math.PI / 180)) ** 2 +
        ((sq[i].lat - centLat) * 111320) ** 2
      );
      const expDist = Math.sqrt(
        ((expanded[i].lng - centLng) * 111320 * Math.cos(centLat * Math.PI / 180)) ** 2 +
        ((expanded[i].lat - centLat) * 111320) ** 2
      );
      expect(expDist).toBeGreaterThan(origDist);
    }
  });

  it('returns original polygon when clearance is 0', () => {
    const sq = [
      { lat: 38.8110, lng: -89.9535 },
      { lat: 38.8111, lng: -89.9535 },
    ];
    expect(expandPolygon(sq, 0)).toBe(sq);
  });
});

describe('pointInPolygonLatLng', () => {
  const square = [
    { lat: 38.8110, lng: -89.9535 },
    { lat: 38.8110, lng: -89.9534 },
    { lat: 38.8111, lng: -89.9534 },
    { lat: 38.8111, lng: -89.9535 },
  ];

  it('returns true for a point inside the polygon', () => {
    expect(pointInPolygonLatLng(38.81105, -89.95345, square)).toBe(true);
  });

  it('returns false for a point outside the polygon', () => {
    expect(pointInPolygonLatLng(38.812, -89.95, square)).toBe(false);
  });
});

describe('panelOverlapsKeepOut + filterPanelsByObstructions', () => {
  // Create a vent obstruction at a known location
  const ventObstruction: NearmapObstruction = {
    type: 'vent',
    description: 'Vent',
    polygon: [
      { lat: 38.8110, lng: -89.9535 },
      { lat: 38.8110, lng: -89.9534 },
      { lat: 38.8111, lng: -89.9534 },
      { lat: 38.8111, lng: -89.9535 },
    ],
    confidence: 0.85,
    captureDate: '2026-02-27',
  };

  it('converts obstruction to keep-out zone with clearance buffer', () => {
    const zone = obstructionToKeepOutZone(ventObstruction);
    expect(zone.type).toBe('vent');
    expect(zone.clearanceM).toBe(OBSTRUCTION_CLEARANCE_M.vent);
    expect(zone.polygon.length).toBe(4);
  });

  it('excludes a panel that overlaps the keep-out zone', () => {
    const zone = obstructionToKeepOutZone(ventObstruction);
    // Panel centered exactly on the obstruction
    expect(panelOverlapsKeepOut(38.81105, -89.95345, [zone])).toBe(true);
  });

  it('keeps a panel that does NOT overlap any keep-out zone', () => {
    const zone = obstructionToKeepOutZone(ventObstruction);
    // Panel far away from the obstruction
    expect(panelOverlapsKeepOut(38.812, -89.95, [zone])).toBe(false);
  });

  it('filterPanelsByObstructions removes overlapping panels', () => {
    const zone = obstructionToKeepOutZone(ventObstruction);
    const panels = [
      { id: '1', lat: 38.81105, lng: -89.95345, layoutId: 'a' },  // overlaps vent
      { id: '2', lat: 38.812, lng: -89.95, layoutId: 'a' },       // safe
      { id: '3', lat: 38.81105, lng: -89.952, layoutId: 'a' },    // safe
    ];
    const filtered = filterPanelsByObstructions(panels, [zone]);
    expect(filtered.length).toBe(2);
    expect(filtered.map(p => p.id)).toEqual(['2', '3']);
  });

  it('returns all panels when no keep-out zones', () => {
    const panels = [
      { id: '1', lat: 38.811, lng: -89.953, layoutId: 'a' },
      { id: '2', lat: 38.812, lng: -89.95, layoutId: 'a' },
    ];
    expect(filterPanelsByObstructions(panels, [])).toEqual(panels);
  });
});
