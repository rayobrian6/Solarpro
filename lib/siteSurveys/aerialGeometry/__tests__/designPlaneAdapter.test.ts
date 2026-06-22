import { describe, it, expect } from 'vitest';
import { roofFacetsToDesignPlanes } from '../designPlaneAdapter';
import { MOCK_HIP_ROOF_FACETS } from '../mockProvider';

describe('roofFacetsToDesignPlanes', () => {
  const planes = roofFacetsToDesignPlanes(MOCK_HIP_ROOF_FACETS);

  it('produces one RoofPlane per facet in the engine shape', () => {
    expect(planes).toHaveLength(4);
    for (const p of planes) {
      expect(p.id).toMatch(/^eagleview-\d+$/);
      expect(p.vertices.length).toBeGreaterThanOrEqual(3);
      expect(p.vertices[0]).toHaveProperty('lat');
      expect(p.vertices[0]).toHaveProperty('lng');
      expect(p.source).toBe('imported');
      expect(p.pitch).toBe(22);
    }
  });

  it('carries area + computes usableArea (~75%) and a centroid', () => {
    for (const p of planes) {
      expect(p.area).toBe(48);
      expect(p.usableArea).toBeCloseTo(36, 0);
      expect(typeof p.centroidLat).toBe('number');
      expect(typeof p.centroidLng).toBe('number');
    }
  });

  it('preserves all four cardinal azimuths', () => {
    expect(planes.map((p) => p.azimuth).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
  });

  it('skips degenerate facets (<3 vertices)', () => {
    const out = roofFacetsToDesignPlanes([
      { pitchDegrees: 20, azimuthDegrees: 180, areaSqM: 5, polygon: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }] },
      ...MOCK_HIP_ROOF_FACETS,
    ]);
    expect(out).toHaveLength(4);
  });
});
