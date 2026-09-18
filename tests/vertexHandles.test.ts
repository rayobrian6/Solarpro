/**
 * tests/vertexHandles.test.ts
 *
 * Pure-math tests for the vertex handles editor (Block / Gable / Hip / Tree).
 * The math lives in lib/3d/vertexHandlesMath.ts. No Cesium, no browser.
 *
 * Aurora parity bar: every footprint vertex is a draggable handle. Click +
 * drag → footprint updates in real time. Live dimension readout in feet.
 *
 * What this guards:
 *   - haversineApproxM is accurate at roof scale (<10km)
 *   - vertexDistanceM includes the height delta
 *   - footprintBBoxM handles edge cases (<2 vertices, 0-area)
 *   - dimensionReadoutFt matches Aurora's "41.3ft" / "12'" style
 *   - validateVertexMove rejects moves that collapse an edge below 0.5m
 *   - validateVertexMove accepts legal moves and preserves h
 *   - applyVertexMove returns a new array (immutable)
 *   - gableEaveCornersFromSpec normalizes a possibly-scrambled vertex list
 *     back to the [SW, SE, NW, NE] order the rebuild functions need
 *   - rebuildGableFaces returns 4 face polygons whose ridge is at the
 *     centroid and parallel to the long edge
 *   - rebuildHipFaces returns 4 face polygons whose ridge is set back
 *     from the short edges
 *   - adjacentVertexIndices returns the right neighbors for each shape
 *   - pickRayToLatLng converts a Cesium-shaped ray to lat/lng; returns null
 *     for sky-pointing rays
 */

import { describe, it, expect } from 'vitest';
import {
  haversineApproxM,
  vertexDistanceM,
  footprintBBoxM,
  dimensionReadoutFt,
  validateVertexMove,
  applyVertexMove,
  gableEaveCornersFromSpec,
  rebuildGableFaces,
  rebuildHipFaces,
  adjacentVertexIndices,
  pickRayToLatLng,
  MIN_EDGE_LENGTH_M,
  type VertexTargetSpec,
  type Vertex3,
} from '@/lib/3d/vertexHandlesMath';

const ALEX_LAT = 38.818;     // Alexandria VA — typical suburban address
const ALEX_LNG = -77.082;

// ── Coordinate helpers ───────────────────────────────────────────────────────

describe('vertexHandlesMath — coordinate helpers', () => {
  it('haversineApproxM is within 1% of the great-circle distance at 100m', () => {
    const mPerDegLng = 111_320 * Math.cos(ALEX_LAT * Math.PI / 180);
    const expected100m = 100 / mPerDegLng; // degrees east
    const d = haversineApproxM(ALEX_LAT, ALEX_LNG, ALEX_LAT, ALEX_LNG + expected100m);
    expect(d).toBeGreaterThan(99);
    expect(d).toBeLessThan(101);
  });

  it('haversineApproxM is within 1% of the great-circle distance at 1km', () => {
    const mPerDegLng = 111_320 * Math.cos(ALEX_LAT * Math.PI / 180);
    const expected1km = 1000 / mPerDegLng;
    const d = haversineApproxM(ALEX_LAT, ALEX_LNG, ALEX_LAT, ALEX_LNG + expected1km);
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it('haversineApproxM returns 0 for the same point', () => {
    expect(haversineApproxM(ALEX_LAT, ALEX_LNG, ALEX_LAT, ALEX_LNG)).toBe(0);
  });

  it('vertexDistanceM is purely horizontal when heights match', () => {
    const a: Vertex3 = { lat: ALEX_LAT, lng: ALEX_LNG, h: 5 };
    const b: Vertex3 = { lat: ALEX_LAT + 0.001, lng: ALEX_LNG, h: 5 };
    const d = vertexDistanceM(a, b);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('vertexDistanceM includes the height delta', () => {
    const a: Vertex3 = { lat: ALEX_LAT, lng: ALEX_LNG, h: 0 };
    const b: Vertex3 = { lat: ALEX_LAT, lng: ALEX_LNG, h: 3 };
    expect(vertexDistanceM(a, b)).toBeCloseTo(3, 5);
  });

  it('vertexDistanceM combines horizontal and vertical components', () => {
    const mPerDegLng = 111_320 * Math.cos(ALEX_LAT * Math.PI / 180);
    const a: Vertex3 = { lat: ALEX_LAT, lng: ALEX_LNG, h: 0 };
    const b: Vertex3 = { lat: ALEX_LAT, lng: ALEX_LNG + 4 / mPerDegLng, h: 3 };
    expect(vertexDistanceM(a, b)).toBeCloseTo(5, 2);
  });
});

// ── Bounding box ─────────────────────────────────────────────────────────────

describe('vertexHandlesMath — footprintBBoxM', () => {
  it('returns {0, 0} for an empty footprint', () => {
    expect(footprintBBoxM([])).toEqual({ widthM: 0, depthM: 0 });
  });

  it('returns {0, 0} for a single-vertex footprint', () => {
    expect(footprintBBoxM([{ lat: ALEX_LAT, lng: ALEX_LNG, h: 0 }])).toEqual({ widthM: 0, depthM: 0 });
  });

  it('returns the lat/lng span of a rectangular footprint', () => {
    const fp: Vertex3[] = [
      { lat: ALEX_LAT, lng: ALEX_LNG, h: 0 },
      { lat: ALEX_LAT + 0.001, lng: ALEX_LNG + 0.001, h: 0 },
    ];
    const { widthM, depthM } = footprintBBoxM(fp);
    expect(depthM).toBeGreaterThan(110);
    expect(depthM).toBeLessThan(112);
    expect(widthM).toBeGreaterThan(85);
    expect(widthM).toBeLessThan(88);
  });
});

// ── Live dimension readout ──────────────────────────────────────────────────

describe('vertexHandlesMath — dimensionReadoutFt', () => {
  it('formats small distances with 1 decimal (Aurora "41.3ft" style)', () => {
    // 12.6m = 41.34 ft → Aurora shows as "41.3ft"
    expect(dimensionReadoutFt(12.6)).toBe("41.3'");
  });

  it('formats large distances with no decimal (Aurora "120ft" style)', () => {
    // 36.58m = 120.0 ft
    expect(dimensionReadoutFt(36.58)).toBe("120'");
  });

  it('returns 0.0 for invalid input', () => {
    expect(dimensionReadoutFt(NaN)).toBe('0.0ft');
    expect(dimensionReadoutFt(-5)).toBe('0.0ft');
  });

  it('switches from 1-decimal to 0-decimal right at 100ft (~30.48m)', () => {
    expect(dimensionReadoutFt(30.0)).toBe("98.4'");    // 98.43 ft → 98.4'
    expect(dimensionReadoutFt(30.5)).toBe("100'");     // 100.07 ft → 100'
  });
});

// ── Validation / clamping ───────────────────────────────────────────────────

describe('vertexHandlesMath — validateVertexMove', () => {
  // A simple 4-vertex gable spec for the tests below.
  const gableSpec: VertexTargetSpec = {
    id: 'g-1',
    type: 'gable',
    eaveHeightM: 6,
    pitchDeg: 22,
    vertices: [
      { lat: 38.818, lng: -77.082, h: 6 }, // SW
      { lat: 38.818, lng: -77.081, h: 6 }, // SE
      { lat: 38.819, lng: -77.082, h: 6 }, // NW
      { lat: 38.819, lng: -77.081, h: 6 }, // NE
    ],
  };

  const blockSpec: VertexTargetSpec = {
    id: 'b-1',
    type: 'block',
    blockExtrudeHeightM: 6,
    vertices: [
      { lat: 38.818, lng: -77.082, h: 0 },
      { lat: 38.818, lng: -77.080, h: 0 }, // ~140m east
      { lat: 38.820, lng: -77.080, h: 0 }, // ~222m north
      { lat: 38.820, lng: -77.082, h: 0 },
    ],
  };

  it('accepts a legal move for a gable vertex', () => {
    const newLat = 38.818 - 50 / 111_320;
    const r = validateVertexMove(gableSpec, 1, newLat, -77.081);
    expect(r.accepted).toBe(true);
    expect(r.lat).toBeCloseTo(newLat, 6);
    expect(r.lng).toBeCloseTo(-77.081, 6);
  });

  it('rejects a move that collapses a gable edge below 0.5m', () => {
    const r = validateVertexMove(gableSpec, 1, gableSpec.vertices[0].lat, gableSpec.vertices[0].lng);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/min/i);
  });

  it('rejects a move with NaN lat/lng', () => {
    const r = validateVertexMove(gableSpec, 1, NaN, -77.081);
    expect(r.accepted).toBe(false);
  });

  it('rejects a move with out-of-range lat', () => {
    const r = validateVertexMove(gableSpec, 1, 95, -77.081);
    expect(r.accepted).toBe(false);
  });

  it('rejects an out-of-range vertex index', () => {
    const r = validateVertexMove(gableSpec, 99, 38.818, -77.081);
    expect(r.accepted).toBe(false);
  });

  it('accepts ANY move on a tree (no edge-length constraint)', () => {
    const treeSpec: VertexTargetSpec = {
      id: 't-1',
      type: 'tree',
      vertices: [{ lat: 38.818, lng: -77.082, h: 0 }],
    };
    const r = validateVertexMove(treeSpec, 0, 38.819, -77.081);
    expect(r.accepted).toBe(true);
  });

  it('rejects a block move that would collapse any edge below 0.5m', () => {
    const r = validateVertexMove(blockSpec, 1, blockSpec.vertices[0].lat, blockSpec.vertices[0].lng);
    expect(r.accepted).toBe(false);
  });

  it('accepts a small block move that keeps all edges > 0.5m', () => {
    const mPerDegLng = 111_320 * Math.cos(38.818 * Math.PI / 180);
    const newLng = blockSpec.vertices[1].lng + 1 / mPerDegLng;
    const r = validateVertexMove(blockSpec, 1, blockSpec.vertices[1].lat, newLng);
    expect(r.accepted).toBe(true);
  });
});

// ── Footprint mutation ──────────────────────────────────────────────────────

describe('vertexHandlesMath — applyVertexMove', () => {
  it('returns a new array with the vertex replaced', () => {
    const fp: Vertex3[] = [
      { lat: 38.818, lng: -77.082, h: 0 },
      { lat: 38.819, lng: -77.082, h: 0 },
      { lat: 38.819, lng: -77.081, h: 0 },
    ];
    const out = applyVertexMove(fp, 1, 38.820, -77.080);
    expect(out).not.toBe(fp);
    expect(out.length).toBe(3);
    expect(out[1].lat).toBe(38.820);
    expect(out[1].lng).toBe(-77.080);
    expect(out[1].h).toBe(0); // h preserved
  });

  it('preserves the h field of the moved vertex', () => {
    const fp: Vertex3[] = [
      { lat: 38.818, lng: -77.082, h: 5 },
      { lat: 38.819, lng: -77.082, h: 5 },
      { lat: 38.819, lng: -77.081, h: 5 },
    ];
    const out = applyVertexMove(fp, 0, 38.820, -77.080);
    expect(out[0].h).toBe(5);
  });

  it('handles out-of-range index gracefully (returns copy)', () => {
    const fp: Vertex3[] = [
      { lat: 38.818, lng: -77.082, h: 0 },
      { lat: 38.819, lng: -77.082, h: 0 },
      { lat: 38.819, lng: -77.081, h: 0 },
    ];
    const out = applyVertexMove(fp, 99, 38.820, -77.080);
    expect(out).toEqual(fp);
  });
});

// ── Gable eave corner normalization ──────────────────────────────────────────

describe('vertexHandlesMath — gableEaveCornersFromSpec', () => {
  it('normalizes a scrambled vertex list to [SW, SE, NW, NE] order', () => {
    const scrambled: VertexTargetSpec = {
      id: 'g-x',
      type: 'gable',
      eaveHeightM: 6,
      pitchDeg: 22,
      vertices: [
        { lat: 38.819, lng: -77.081, h: 5 },
        { lat: 38.818, lng: -77.081, h: 5 },
        { lat: 38.819, lng: -77.082, h: 5 },
        { lat: 38.818, lng: -77.082, h: 5 },
      ],
    };
    const out = gableEaveCornersFromSpec(scrambled);
    expect(out[0].lat).toBe(38.818); expect(out[0].lng).toBe(-77.082);
    expect(out[1].lat).toBe(38.818); expect(out[1].lng).toBe(-77.081);
    expect(out[2].lat).toBe(38.819); expect(out[2].lng).toBe(-77.082);
    expect(out[3].lat).toBe(38.819); expect(out[3].lng).toBe(-77.081);
  });

  it('uses the spec eaveHeightM for the h field of all 4 corners', () => {
    const spec: VertexTargetSpec = {
      id: 'g-y',
      type: 'gable',
      eaveHeightM: 8.5,
      pitchDeg: 22,
      vertices: [
        { lat: 38.818, lng: -77.082, h: 0 },
        { lat: 38.818, lng: -77.081, h: 0 },
        { lat: 38.819, lng: -77.082, h: 0 },
        { lat: 38.819, lng: -77.081, h: 0 },
      ],
    };
    const out = gableEaveCornersFromSpec(spec);
    for (const v of out) expect(v.h).toBe(8.5);
  });
});

// ── Roof rebuild ─────────────────────────────────────────────────────────────

// Long-axis fixture: 200m wide (lng) x 100m deep (lat) — longIsLng = true.
const GABLE_LAT0 = 38.818;
const GABLE_LNG0 = -77.082;
const GABLE_LAT1 = GABLE_LAT0 + 100 / 111_320;
const GABLE_LNG1 = GABLE_LNG0 + 200 / (111_320 * Math.cos(38.818 * Math.PI / 180));

const gable: VertexTargetSpec = {
  id: 'g-1',
  type: 'gable',
  eaveHeightM: 6,
  pitchDeg: 22,
  vertices: [
    { lat: GABLE_LAT0, lng: GABLE_LNG0, h: 6 },
    { lat: GABLE_LAT0, lng: GABLE_LNG1, h: 6 },
    { lat: GABLE_LAT1, lng: GABLE_LNG0, h: 6 },
    { lat: GABLE_LAT1, lng: GABLE_LNG1, h: 6 },
  ],
};

const hip: VertexTargetSpec = {
  id: 'h-1',
  type: 'hip',
  eaveHeightM: 6,
  pitchDeg: 22,
  vertices: [
    { lat: GABLE_LAT0, lng: GABLE_LNG0, h: 6 },
    { lat: GABLE_LAT0, lng: GABLE_LNG1, h: 6 },
    { lat: GABLE_LAT1, lng: GABLE_LNG0, h: 6 },
    { lat: GABLE_LAT1, lng: GABLE_LNG1, h: 6 },
  ],
};

describe('vertexHandlesMath — rebuildGableFaces', () => {
  it('returns 4 face polygons', () => {
    const f = rebuildGableFaces(gable);
    expect(f.faceA.length).toBe(4);
    expect(f.faceB.length).toBe(4);
    expect(f.endGableA.length).toBe(4);
    expect(f.endGableB.length).toBe(4);
  });

  it('places the ridge at the centroid lat (longIsLng = true)', () => {
    const f = rebuildGableFaces(gable);
    const cLat = (GABLE_LAT0 + GABLE_LAT1) / 2;
    // faceA = [sw, se, ridgeB, ridgeA] for longIsLng.
    expect(f.faceA[3].lat).toBeCloseTo(cLat, 5); // ridgeA
    expect(f.faceA[2].lat).toBeCloseTo(cLat, 5); // ridgeB
    expect(f.faceA[3].lng).toBeCloseTo(GABLE_LNG0, 4);
    expect(f.faceA[2].lng).toBeCloseTo(GABLE_LNG1, 4);
  });

  it('places the ridge above the eave at the correct rise (short=100m, pitch=22°)', () => {
    const f = rebuildGableFaces(gable);
    const ridgeA = f.faceA[3];
    const expectedRise = (100 / 2) * Math.tan((22 * Math.PI) / 180);
    const expectedHeight = 6 + expectedRise;
    expect(ridgeA.h).toBeCloseTo(expectedHeight, 0);
  });
});

describe('vertexHandlesMath — rebuildHipFaces', () => {
  it('returns 4 face polygons (2 trapezoid slopes + 2 triangle hip ends)', () => {
    const f = rebuildHipFaces(hip);
    expect(f.faceA.length).toBe(4);
    expect(f.faceB.length).toBe(4);
    expect(f.endGableA.length).toBe(3);
    expect(f.endGableB.length).toBe(3);
  });

  it('sets the ridge back from BOTH short edges (1/3 setback each side)', () => {
    const f = rebuildHipFaces(hip);
    const ridgeA = f.faceA[2];
    const ridgeB = f.faceA[3];
    const ridgeSpanLng = Math.abs(ridgeB.lng - ridgeA.lng);
    const mPerDegLng = 111_320 * Math.cos(hip.vertices[0].lat * Math.PI / 180);
    const ridgeSpanM = ridgeSpanLng * mPerDegLng;
    const longEdgeM = Math.abs(hip.vertices[3].lng - hip.vertices[0].lng) * mPerDegLng;
    const expectedRidge = longEdgeM - 2 * (100 / 3);
    expect(ridgeSpanM).toBeCloseTo(expectedRidge, 0);
  });
});

// ── Adjacency ────────────────────────────────────────────────────────────────

describe('vertexHandlesMath — adjacentVertexIndices', () => {
  it('returns all other vertex indices for a block', () => {
    const spec: VertexTargetSpec = {
      id: 'b', type: 'block',
      vertices: [
        { lat: 38.818, lng: -77.082, h: 0 },
        { lat: 38.819, lng: -77.082, h: 0 },
        { lat: 38.819, lng: -77.081, h: 0 },
        { lat: 38.818, lng: -77.081, h: 0 },
      ],
    };
    const adj = adjacentVertexIndices(spec, 0);
    expect(adj).toEqual([1, 2, 3]);
  });

  it('returns the two rectangle neighbors for a gable/hip', () => {
    const spec: VertexTargetSpec = {
      id: 'g', type: 'gable', eaveHeightM: 6, pitchDeg: 22,
      vertices: [
        { lat: 38.818, lng: -77.082, h: 6 },
        { lat: 38.818, lng: -77.081, h: 6 },
        { lat: 38.819, lng: -77.082, h: 6 },
        { lat: 38.819, lng: -77.081, h: 6 },
      ],
    };
    expect(adjacentVertexIndices(spec, 0)).toEqual([1, 3]);
    expect(adjacentVertexIndices(spec, 1)).toEqual([2, 0]);
    expect(adjacentVertexIndices(spec, 2)).toEqual([3, 1]);
    expect(adjacentVertexIndices(spec, 3)).toEqual([0, 2]);
  });

  it('returns [] for a tree', () => {
    const spec: VertexTargetSpec = {
      id: 't', type: 'tree',
      vertices: [{ lat: 38.818, lng: -77.082, h: 0 }],
    };
    expect(adjacentVertexIndices(spec, 0)).toEqual([]);
  });
});

// ── Pick ray helper ─────────────────────────────────────────────────────────

describe('vertexHandlesMath — pickRayToLatLng', () => {
  function ecef(latDeg: number, lngDeg: number, hM = 0): { x: number; y: number; z: number } {
    const R = 6_378_137 + hM;
    const lat = latDeg * Math.PI / 180;
    const lng = lngDeg * Math.PI / 180;
    return {
      x: R * Math.cos(lat) * Math.cos(lng),
      y: R * Math.cos(lat) * Math.sin(lng),
      z: R * Math.sin(lat),
    };
  }

  function rad2deg(r: number): number { return r * 180 / Math.PI; }

  it('converts a downward-pointing ray at the equator to lat=0,lng=0', () => {
    const start = ecef(0, 0, 1000);
    const ground = ecef(0, 0, 0);
    const dir = {
      x: ground.x - start.x,
      y: ground.y - start.y,
      z: ground.z - start.z,
    };
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    dir.x /= len; dir.y /= len; dir.z /= len;
    const ray = { origin: start, direction: dir };
    const cartographicFromCartesian = (c: { x: number; y: number; z: number }) => {
      const R = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
      return {
        latitude: Math.asin(c.z / R),
        longitude: Math.atan2(c.y, c.x),
        height: R - 6_378_137,
      };
    };
    const hit = pickRayToLatLng(ray, cartographicFromCartesian, rad2deg);
    expect(hit).not.toBeNull();
    expect(hit!.lat).toBeCloseTo(0, 4);
    expect(hit!.lng).toBeCloseTo(0, 4);
  });

  it('returns null for a sky-pointing ray that starts above the surface', () => {
    const start = ecef(0, 0, 1000);
    const ray = { origin: start, direction: { x: 0, y: 0, z: 1 } };
    const cartographicFromCartesian = (c: { x: number; y: number; z: number }) => ({
      latitude: 0, longitude: 0, height: 0,
    });
    const hit = pickRayToLatLng(ray, cartographicFromCartesian, rad2deg);
    expect(hit).toBeNull();
  });

  it('returns null for a malformed ray (zero direction)', () => {
    const ray = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } };
    const cartographicFromCartesian = () => ({ latitude: 0, longitude: 0, height: 0 });
    expect(pickRayToLatLng(ray, cartographicFromCartesian, rad2deg)).toBeNull();
  });

  it('returns null if cartographicFromCartesian returns null', () => {
    const start = ecef(0, 0, 1000);
    const ground = ecef(0, 0, 0);
    const dir = {
      x: ground.x - start.x,
      y: ground.y - start.y,
      z: ground.z - start.z,
    };
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    dir.x /= len; dir.y /= len; dir.z /= len;
    const ray = { origin: start, direction: dir };
    const cartographicFromCartesian = () => null as any;
    const hit = pickRayToLatLng(ray, cartographicFromCartesian, rad2deg);
    expect(hit).toBeNull();
  });
});

// ── End-to-end: vertex move triggers a sane roof rebuild ────────────────────

describe('vertexHandlesMath — full edit cycle (gable)', () => {
  it('moving an eave corner produces a new roof that respects the moved vertex', () => {
    const original: VertexTargetSpec = {
      id: 'g-1', type: 'gable', eaveHeightM: 6, pitchDeg: 22,
      vertices: [
        { lat: GABLE_LAT0, lng: GABLE_LNG0, h: 6 },
        { lat: GABLE_LAT0, lng: GABLE_LNG1, h: 6 },
        { lat: GABLE_LAT1, lng: GABLE_LNG0, h: 6 },
        { lat: GABLE_LAT1, lng: GABLE_LNG1, h: 6 },
      ],
    };

    const mPerDegLng = 111_320 * Math.cos(GABLE_LAT1 * Math.PI / 180);
    const newNELng = GABLE_LNG1 + 50 / mPerDegLng;

    const v = validateVertexMove(original, 3, GABLE_LAT1, newNELng);
    expect(v.accepted).toBe(true);

    const newVerts = applyVertexMove(original.vertices, 3, v.lat, v.lng);
    expect(newVerts[3].lng).toBeCloseTo(newNELng, 6);

    const updatedSpec: VertexTargetSpec = { ...original, vertices: newVerts };
    const faces = rebuildGableFaces(updatedSpec);
    // For longIsLng, faceB = [NW, NE, ridgeB, ridgeA]. NW=faceB[0], moved NE=faceB[1].
    const nw = faces.faceB[0];
    const ne = faces.faceB[1];
    const newEdgeLengthM = haversineApproxM(nw.lat, nw.lng, ne.lat, ne.lng);
    expect(newEdgeLengthM).toBeGreaterThan(245);
    expect(newEdgeLengthM).toBeLessThan(255);
  });
});

describe('vertexHandlesMath — MIN_EDGE_LENGTH_M exported correctly', () => {
  it('is 0.5m (matches placement guard)', () => {
    expect(MIN_EDGE_LENGTH_M).toBe(0.5);
  });
});
