import { describe, it, expect } from 'vitest';
import { nearmapRoofSnapCenter } from './nearmap';

// Geometry around 3 Melvin Dr, Granite City IL (the real off-center case):
// at lat 38.7, 0.0001° lat ≈ 11.1 m and 0.0001° lng ≈ 8.7 m.
const LAT = 38.7009, LNG = -90.1487;

/** Axis-aligned rectangular "roof" ring centered on (lat,lng), half-sizes in deg. */
const rect = (lat: number, lng: number, dLat: number, dLng: number) => ({
  worldPolygon: [
    { lat: lat - dLat, lng: lng - dLng },
    { lat: lat - dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng - dLng },
    { lat: lat - dLat, lng: lng - dLng },
  ],
});

describe('nearmapRoofSnapCenter', () => {
  it('snaps to the bbox center of the roof containing the point', () => {
    // Roof centered 5 m east of the query point — point still inside it.
    const roof = rect(LAT, LNG + 0.00006, 0.00008, 0.00012);
    const r = nearmapRoofSnapCenter(LAT, LNG, [roof]);
    expect(r).not.toBeNull();
    expect(r!.contained).toBe(true);
    expect(r!.lat).toBeCloseTo(LAT, 7);
    expect(r!.lng).toBeCloseTo(LNG + 0.00006, 7);
    expect(r!.distM).toBeGreaterThan(3);
    expect(r!.distM).toBeLessThan(8);
  });

  it('prefers a containing roof over a nearer non-containing one', () => {
    const containing = rect(LAT + 0.0001, LNG, 0.0002, 0.0002);       // big, contains point
    const nearby     = rect(LAT, LNG + 0.00005, 0.00001, 0.00001);   // tiny, ~4m away, not containing
    const r = nearmapRoofSnapCenter(LAT, LNG, [nearby, containing]);
    expect(r!.contained).toBe(true);
    expect(r!.lat).toBeCloseTo(LAT + 0.0001, 7);
  });

  it('falls back to the nearest roof within maxSnapM when none contains the point', () => {
    // Street-pin scenario: home roof ~15 m east, neighbor ~40 m west.
    const home     = rect(LAT, LNG + 0.00017, 0.00008, 0.00010); // ~15m E
    const neighbor = rect(LAT, LNG - 0.00046, 0.00008, 0.00010); // ~40m W
    const r = nearmapRoofSnapCenter(LAT, LNG, [neighbor, home], { maxSnapM: 25 });
    expect(r).not.toBeNull();
    expect(r!.contained).toBe(false);
    expect(r!.lng).toBeCloseTo(LNG + 0.00017, 7);
  });

  it('returns null when every roof is beyond maxSnapM', () => {
    const far = rect(LAT + 0.0005, LNG, 0.00008, 0.00010); // ~55m N
    expect(nearmapRoofSnapCenter(LAT, LNG, [far], { maxSnapM: 25 })).toBeNull();
  });

  it('returns null for empty / degenerate input', () => {
    expect(nearmapRoofSnapCenter(LAT, LNG, [])).toBeNull();
    expect(nearmapRoofSnapCenter(LAT, LNG, [{ worldPolygon: [{ lat: LAT, lng: LNG }] }])).toBeNull();
    expect(nearmapRoofSnapCenter(LAT, LNG, [
      { worldPolygon: [{ lat: NaN, lng: LNG }, { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG }] },
    ])).toBeNull();
  });

  it('picks the nearest containing roof when two overlap the point', () => {
    const a = rect(LAT + 0.00005, LNG, 0.0002, 0.0002); // center ~5.5m N
    const b = rect(LAT + 0.00001, LNG, 0.0002, 0.0002); // center ~1.1m N — nearer
    const r = nearmapRoofSnapCenter(LAT, LNG, [a, b]);
    expect(r!.contained).toBe(true);
    expect(r!.lat).toBeCloseTo(LAT + 0.00001, 7);
  });
});
