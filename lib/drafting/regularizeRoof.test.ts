import { describe, it, expect } from 'vitest';
import { regularizeRoofPlanes } from './regularizeRoof';

// Synthetic hand-traced hip roof (fake-degrees, 1 unit ≈ 1 ft): a 60×30
// rectangle + straight ridge, with ±0.8 ft trace noise and facet borders that
// disagree by up to 1 ft — the real failure signature (wavy eaves, dogleg ridge).
const noisy = (x: number, n: number) => x + n;
const PLANES = [
  { // north facet (faces N): eave y=30, ridge y=15
    azimuth: 0,
    vertices: [
      { lng: noisy(0, 0.4),  lat: noisy(30, -0.5) },
      { lng: noisy(60, -0.6), lat: noisy(30, 0.7) },
      { lng: noisy(45, 0.3),  lat: noisy(15, 0.6) },
      { lng: noisy(15, -0.2), lat: noisy(15, -0.4) },
    ],
  },
  { // south facet: eave y=0, ridge y=15 (borders drawn slightly differently)
    azimuth: 180,
    vertices: [
      { lng: noisy(0, -0.3),  lat: noisy(0, 0.6) },
      { lng: noisy(15, 0.5),  lat: noisy(15, 0.3) },
      { lng: noisy(45, -0.4), lat: noisy(15, -0.5) },
      { lng: noisy(60, 0.2),  lat: noisy(0, -0.6) },
    ],
  },
  { // west hip cap
    azimuth: 270,
    vertices: [
      { lng: noisy(0, 0.1),  lat: noisy(0, 0.2) },
      { lng: noisy(0, 0.5),  lat: noisy(30, 0.1) },
      { lng: noisy(15, 0.2), lat: noisy(15, 0.5) },
    ],
  },
  { // east hip cap
    azimuth: 90,
    vertices: [
      { lng: noisy(60, -0.2), lat: noisy(30, -0.3) },
      { lng: noisy(60, 0.4),  lat: noisy(0, 0.3) },
      { lng: noisy(45, -0.1), lat: noisy(15, 0.2) },
    ],
  },
];

describe('regularizeRoofPlanes', () => {
  const out = regularizeRoofPlanes(JSON.parse(JSON.stringify(PLANES)));

  it('welds shared facet corners into identical points', () => {
    // NW corner appears on north facet (v0) and west cap (v1)
    const nw1 = out[0].vertices[0], nw2 = out[2].vertices[1];
    expect(nw1.lat).toBeCloseTo(nw2.lat, 9);
    expect(nw1.lng).toBeCloseTo(nw2.lng, 9);
    // Ridge west endpoint appears on north (v3), south (v1), and west cap (v2)
    const r1 = out[0].vertices[3], r2 = out[1].vertices[1], r3 = out[2].vertices[2];
    expect(r1.lat).toBeCloseTo(r2.lat, 9);
    expect(r1.lng).toBeCloseTo(r3.lng, 9);
  });

  it('straightens the eaves and the ridge (near-axis edges become exact)', () => {
    // north eave: both corners same lat
    expect(out[0].vertices[0].lat).toBeCloseTo(out[0].vertices[1].lat, 6);
    // south eave
    expect(out[1].vertices[0].lat).toBeCloseTo(out[1].vertices[3].lat, 6);
    // ridge: both endpoints same lat
    expect(out[0].vertices[2].lat).toBeCloseTo(out[0].vertices[3].lat, 6);
    // west rake/eave edge of the cap: vertical
    expect(out[2].vertices[0].lng).toBeCloseTo(out[2].vertices[1].lng, 6);
  });

  it('caps vertex displacement (never redraws the building)', () => {
    for (let pi = 0; pi < PLANES.length; pi++) {
      for (let vi = 0; vi < PLANES[pi].vertices.length; vi++) {
        const a = PLANES[pi].vertices[vi], b = out[pi].vertices[vi];
        const d = Math.hypot(a.lat - b.lat, a.lng - b.lng);
        expect(d, `plane ${pi} v${vi}`).toBeLessThanOrEqual(2.0 + 1e-9);
      }
    }
  });

  it('preserves plane metadata and vertex counts', () => {
    expect(out).toHaveLength(4);
    expect(out[0].azimuth).toBe(0);
    expect(out[0].vertices).toHaveLength(4);
    expect(out[2].vertices).toHaveLength(3);
  });

  it('is a no-op on already-clean geometry (within float noise)', () => {
    const clean = [{
      azimuth: 180,
      vertices: [
        { lng: 0, lat: 0 }, { lng: 40, lat: 0 }, { lng: 40, lat: 20 }, { lng: 0, lat: 20 },
      ],
    }];
    const r = regularizeRoofPlanes(JSON.parse(JSON.stringify(clean)));
    for (let vi = 0; vi < 4; vi++) {
      expect(r[0].vertices[vi].lat).toBeCloseTo(clean[0].vertices[vi].lat, 6);
      expect(r[0].vertices[vi].lng).toBeCloseTo(clean[0].vertices[vi].lng, 6);
    }
  });

  it('handles empty input', () => {
    expect(regularizeRoofPlanes([])).toEqual([]);
  });
});
