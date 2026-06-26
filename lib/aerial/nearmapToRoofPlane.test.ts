import { describe, it, expect } from 'vitest';
import {
  deriveAzimuthFromOutline,
  nearmapPlaneToRoofPlane,
  nearmapPlanesToRoofPlanes,
} from './nearmapToRoofPlane';
import type { NearmapRoofPlane } from './nearmap';

let n = 0;
const idGen = () => `plane-${n++}`;

// A roof whose long axis (ridge) runs roughly E–W → slope faces N/S.
// In the N hemisphere the derived default should face south (~180°).
const eastWestRidge = [
  { lat: 38.8110, lng: -89.9540 },
  { lat: 38.8110, lng: -89.9530 }, // long edge, east-west
  { lat: 38.8113, lng: -89.9530 },
  { lat: 38.8113, lng: -89.9540 },
];

describe('deriveAzimuthFromOutline', () => {
  it('picks the equator-facing (south) slope for an E–W ridge in the N hemisphere', () => {
    const az = deriveAzimuthFromOutline(eastWestRidge, 38.81);
    expect(Math.abs(az - 180)).toBeLessThan(15);
  });

  it('picks the north-facing slope in the southern hemisphere', () => {
    const az = deriveAzimuthFromOutline(eastWestRidge, -33.8);
    expect(Math.min(az, 360 - az)).toBeLessThan(15); // near 0/360
  });
});

describe('nearmapPlaneToRoofPlane', () => {
  const np: NearmapRoofPlane = {
    worldPolygon: [...eastWestRidge, eastWestRidge[0]], // closed ring
    areaSqft: 1076, // ~100 m²
    pitchDeg: 22.5,
    azimuthDeg: null,
    roofType: 'Hip',
    material: 'Shingle',
    confidence: 0.99,
    captureDate: '2026-02-27',
    source: 'nearmap_ai',
  };

  it('maps geometry, pitch, area and derives azimuth; stays unconfirmed for review', () => {
    n = 0;
    const rp = nearmapPlaneToRoofPlane(np, idGen);
    expect(rp.source).toBe('aerial_nearmap');
    expect(rp.confirmed).toBe(false);
    expect(rp.pitch).toBe(22.5);
    expect(rp.vertices.length).toBe(4);           // closing vertex stripped
    expect(rp.area).toBeGreaterThan(95);
    expect(rp.area).toBeLessThan(105);
    expect(rp.usableArea).toBeCloseTo(rp.area * 0.75, 1);
    expect(Math.abs(rp.azimuth - 180)).toBeLessThan(15);
    expect(rp.localFrame3D).toBeTruthy();         // 3D frame enrichment applied
    expect(rp.verticesLocal).toBeTruthy();        // LECS enrichment applied
  });

  it('honors a real azimuth when one is ever provided (no override)', () => {
    n = 0;
    const rp = nearmapPlaneToRoofPlane({ ...np, azimuthDeg: 95 }, idGen);
    expect(rp.azimuth).toBe(95);
  });

  it('converts a batch in order', () => {
    n = 0;
    const out = nearmapPlanesToRoofPlanes([np, np], idGen);
    expect(out).toHaveLength(2);
    expect(out[0].id).not.toBe(out[1].id);
  });
});
