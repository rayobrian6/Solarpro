import { describe, expect, it } from 'vitest';
import { roofCAD } from '@/lib/cad/roof/roofCAD';
import type { CanonicalBridgeResult } from '@/lib/cad/canonicalBridge';
import type { PermitInputShape } from '@/lib/drafting/permitInputShape';

// ─────────────────────────────────────────────────────────────────────────────
// Regression: the canonical (production) roof path must draw the user's REAL
// design panel positions, not a synthetic grid tiled over the roof polygon.
//
// Before the fix, roofCAD's canonical branch called appendCADRoofPlaneFromLocal
// without the real gpsPanels, so it ALWAYS grid-generated modules — the planset
// "re-derived a generic box and dropped modules onto it". This test feeds a
// canonical roof plane (local-meter polygon) plus real panel GPS that projects
// inside it, and asserts the output panels are the real ones.
// ─────────────────────────────────────────────────────────────────────────────

// Exact inverse of lib/cad/geometry.ts latLngToXY (same constants).
const EARTH_RADIUS_M = 6_378_137;
const DEG_TO_RAD = Math.PI / 180;
function localToLatLng(x: number, y: number, originLat: number, originLng: number) {
  const cosLat = Math.cos(originLat * DEG_TO_RAD);
  return {
    lat: originLat + (y / EARTH_RADIUS_M) / DEG_TO_RAD,
    lng: originLng + (x / (cosLat * EARTH_RADIUS_M)) / DEG_TO_RAD,
  };
}

const ORIGIN_LAT = 38.7009;
const ORIGIN_LNG = -90.1487;

// A 12m × 8m rectangular roof plane in CAD local meters.
const PLANE_POLYGON = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 8 },
  { x: 0, y: 8 },
];

function makeBridge(): CanonicalBridgeResult {
  return {
    roofPlanes: [
      {
        id: 'plane-A',
        polygon: PLANE_POLYGON,
        pitch: 18.43,
        azimuth: 180,
        areaSqM: 96,
        setbacks: { eaveM: 0.45, ridgeM: 0.45, rakeM: 0.45 },
        sourceArtifactId: 'artifact-1',
      },
    ],
    obstructions: [],
    electricalNodes: [],
    log: [],
    roofPlanesConverted: 1,
    roofPlanesSkipped: 0,
    obstructionsConverted: 0,
    electricalNodesConverted: 0,
    obstructionsSkipped: 0,
    electricalNodesSkipped: 0,
    originLat: ORIGIN_LAT,
    originLng: ORIGIN_LNG,
  };
}

// Three real panel centers (local meters) — distinct, clearly inside the plane.
const REAL_CENTERS = [
  { x: 3, y: 4 },
  { x: 6, y: 4 },
  { x: 9, y: 4 },
];

function makeInput(panelPositions: unknown[]): PermitInputShape {
  return {
    project: {
      systemType: 'roof',
      panelLengthIn: 66,
      panelWidthIn: 40,
      panelPositions,
    },
    system: { totalPanels: panelPositions.length, totalDcKw: 0, inverters: [] },
    _canonicalCADBridge: makeBridge(),
  } as unknown as PermitInputShape;
}

describe('roofCAD canonical path — real panel positions', () => {
  it('places the real design panels (GPS), not a synthetic grid', () => {
    const panelPositions = REAL_CENTERS.map((c, i) => {
      const { lat, lng } = localToLatLng(c.x, c.y, ORIGIN_LAT, ORIGIN_LNG);
      return { id: `real-${i}`, lat, lng, orientation: 'portrait', row: 0, col: i };
    });

    const model = roofCAD(makeInput(panelPositions));

    expect(model.roof?.planes).toHaveLength(1);
    const panels = model.roof!.planes[0].panels;

    // Exactly the three real panels — a grid would tile ~40+ modules.
    expect(panels).toHaveLength(3);

    // Ids are the design's panel ids, not generated grid ids (`plane-A-r0-c0`).
    expect(panels.map(p => p.id).sort()).toEqual(['real-0', 'real-1', 'real-2']);

    // Each panel center (stored top-left + half size) matches the real position.
    const centers = panels
      .map(p => ({ x: p.x + p.widthM / 2, y: p.y + p.heightM / 2 }))
      .sort((a, b) => a.x - b.x);
    centers.forEach((c, i) => {
      expect(c.x).toBeCloseTo(REAL_CENTERS[i].x, 2);
      expect(c.y).toBeCloseTo(REAL_CENTERS[i].y, 2);
    });
  });

  it('falls back to a generated grid when the design carries no panels', () => {
    const model = roofCAD(makeInput([]));

    const panels = model.roof!.planes[0].panels;
    // The grid fills the 12×8 plane with many portrait modules.
    expect(panels.length).toBeGreaterThan(3);
    // Generated ids follow the `${planeId}-r{row}-c{col}` convention.
    expect(panels.every(p => p.id.startsWith('plane-A-r'))).toBe(true);
  });
});

describe('roofCAD no-roofPlane path — real panels without roof polygons', () => {
  function makeInputNoPlane(panelPositions: unknown[]): PermitInputShape {
    // No _canonicalCADBridge and no project.roofPlanes — the old code drew a
    // generic box + regenerated grid; now it must draw the real array.
    return {
      project: { systemType: 'roof', panelLengthIn: 66, panelWidthIn: 40, panelPositions },
      system: { totalPanels: panelPositions.length, totalDcKw: 0, inverters: [] },
    } as unknown as PermitInputShape;
  }

  it('draws the real panel positions and derives a footprint from them', () => {
    // Origin is the first panel (roofCAD falls back to rawPanels[0] for origin).
    const centers = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }];
    const panelPositions = centers.map((c, i) => {
      const { lat, lng } = localToLatLng(c.x, c.y, ORIGIN_LAT, ORIGIN_LNG);
      return { id: `np-${i}`, lat, lng, orientation: 'portrait', row: 0, col: i };
    });

    const model = roofCAD(makeInputNoPlane(panelPositions));

    expect(model.roof?.planes).toHaveLength(1);
    const plane = model.roof!.planes[0];
    expect(plane.id).toBe('array');

    const panels = plane.panels;
    expect(panels).toHaveLength(3);
    expect(panels.map(p => p.id).sort()).toEqual(['np-0', 'np-1', 'np-2']);
    // Real ids — not 'schematic-r0-c0' grid ids.
    expect(panels.some(p => p.id.startsWith('schematic-'))).toBe(false);
  });

  it('still uses the synthetic schematic when there are no panels at all', () => {
    const model = roofCAD(makeInputNoPlane([]));
    const plane = model.roof!.planes[0];
    expect(plane.id).toBe('schematic');
    expect(plane.panels.length).toBeGreaterThan(0);
  });
});
