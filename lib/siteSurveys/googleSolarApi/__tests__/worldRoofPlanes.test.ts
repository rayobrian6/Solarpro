import { describe, it, expect } from 'vitest';
import {
  buildWorldRoofPlanes,
  type RoofSegmentStat,
} from '../worldRoofPlanes';

// Helper: build a roofSegmentStats-shaped segment centered at (clat,clng)
// with an approximately widthM x heightM bounding box.
function seg(
  clat: number,
  clng: number,
  opts: Partial<{
    widthM: number;
    heightM: number;
    pitch: number;
    azimuth: number;
    area: number;
    height: number;
  }> = {},
): RoofSegmentStat {
  const widthM = opts.widthM ?? 6;
  const heightM = opts.heightM ?? 4;
  const dLat = heightM / 2 / 111320;
  const dLng = widthM / 2 / (111320 * Math.cos((clat * Math.PI) / 180));
  return {
    center: { latitude: clat, longitude: clng },
    boundingBox: {
      sw: { latitude: clat - dLat, longitude: clng - dLng },
      ne: { latitude: clat + dLat, longitude: clng + dLng },
    },
    pitchDegrees: opts.pitch ?? 25,
    azimuthDegrees: opts.azimuth ?? 180,
    stats: { areaMeters2: opts.area ?? 30 },
    planeHeightAtCenterMeters: opts.height ?? 5,
  };
}

// Real project coordinates: 3 Melvin Dr, Granite City, IL
const CLAT = 38.7061678;
const CLNG = -90.0461651;

function distM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng =
    (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

describe('buildWorldRoofPlanes', () => {
  it('produces a world plane with lat/lng vertices and preserved pitch/azimuth/area', () => {
    const planes = buildWorldRoofPlanes([
      seg(CLAT, CLNG, { pitch: 25, azimuth: 180, area: 30.126 }),
    ]);

    expect(planes).toHaveLength(1);
    const p = planes[0];

    // 4-vertex lat/lng polygon, all finite and near the center
    expect(p.vertices).toHaveLength(4);
    for (const v of p.vertices) {
      expect(Number.isFinite(v.lat)).toBe(true);
      expect(Number.isFinite(v.lng)).toBe(true);
      expect(distM({ lat: CLAT, lng: CLNG }, v)).toBeLessThan(20);
    }

    // Authoritative measurements preserved (rounded as in buildRoofPlanes)
    expect(p.pitchDegrees).toBe(25);
    expect(p.azimuthDegrees).toBe(180);
    expect(p.areaSqM).toBe(30.13); // 30.126 rounded to 2dp
    expect(p.centroidLat).toBe(CLAT);
    expect(p.centroidLng).toBe(CLNG);

    // Edge types: 4 valid classifications; source tagged
    expect(p.edgeTypes).toHaveLength(4);
    for (const e of p.edgeTypes) {
      expect(['ridge', 'eave', 'rake', 'hip', 'valley']).toContain(e);
    }
    expect(p.source).toBe('google_solar_api');
    expect(p.id).toBe('solar-segment-0');
  });

  it('reconstructs a polygon scaled to the bounding box (bigger bbox → bigger polygon)', () => {
    const [small] = buildWorldRoofPlanes([seg(CLAT, CLNG, { widthM: 4, heightM: 4 })]);
    const [big] = buildWorldRoofPlanes([seg(CLAT, CLNG, { widthM: 16, heightM: 16 })]);

    const spanOf = (verts: { lat: number; lng: number }[]) =>
      Math.max(...verts.map((v) => distM({ lat: CLAT, lng: CLNG }, v)));

    expect(spanOf(big.vertices)).toBeGreaterThan(spanOf(small.vertices) * 2);
  });

  it('detects no adjacency between far-apart segments', () => {
    const planes = buildWorldRoofPlanes([
      seg(CLAT, CLNG),
      seg(CLAT + 0.01, CLNG + 0.01), // ~1.3 km away
    ]);
    expect(planes).toHaveLength(2);
    expect(planes[0].adjacentPlaneIds).toBeUndefined();
    expect(planes[1].adjacentPlaneIds).toBeUndefined();
  });

  it('handles an empty segment list', () => {
    expect(buildWorldRoofPlanes([])).toEqual([]);
  });
});
