import { describe, it, expect } from 'vitest';
import { MOCK_HIP_ROOF_FACETS, MockAerialProvider } from '../mockProvider';
import { roofFacetsToSegmentStats, adaptRoofFacetsToWorldArtifacts } from '../facetAdapter';

const SURVEY_ID = '11111111-1111-1111-1111-111111111111';

describe('aerialGeometry facetAdapter', () => {
  it('reduces facets to RoofSegmentStats with centroid, bbox, pitch/azimuth/area', () => {
    const segs = roofFacetsToSegmentStats(MOCK_HIP_ROOF_FACETS);
    expect(segs).toHaveLength(4);
    for (const s of segs) {
      expect(s.pitchDegrees).toBe(22);
      expect(s.stats.areaMeters2).toBe(48);
      // bbox sw must be <= ne on both axes
      expect(s.boundingBox.sw.latitude).toBeLessThanOrEqual(s.boundingBox.ne.latitude);
      expect(s.boundingBox.sw.longitude).toBeLessThanOrEqual(s.boundingBox.ne.longitude);
      // centroid sits inside the bbox
      expect(s.center.latitude).toBeGreaterThanOrEqual(s.boundingBox.sw.latitude);
      expect(s.center.latitude).toBeLessThanOrEqual(s.boundingBox.ne.latitude);
    }
    expect(segs.map((s) => s.azimuthDegrees).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
  });

  it('drops facets with fewer than 3 polygon vertices', () => {
    const segs = roofFacetsToSegmentStats([
      { pitchDegrees: 20, azimuthDegrees: 180, areaSqM: 10, polygon: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }] },
      ...MOCK_HIP_ROOF_FACETS,
    ]);
    expect(segs).toHaveLength(4);
  });

  it('adapts facets into world-space roof_plane artifacts', () => {
    const artifacts = adaptRoofFacetsToWorldArtifacts(MOCK_HIP_ROOF_FACETS, SURVEY_ID, 'mock', '2026-01');
    expect(artifacts).toHaveLength(4);
    for (const a of artifacts) {
      expect(a.geometryClass).toBe('roof_plane');
      expect(a.surveyId).toBe(SURVEY_ID);
      expect(a.pitchDegrees).toBe(22);
      expect(a.areaSqM).toBe(48);
      expect(a.isSynthetic).toBe(false);
      // The authoritative world polygon must be present with a real outline.
      expect(a.worldPolygon).toBeTruthy();
      expect(a.worldPolygon!.vertices.length).toBeGreaterThanOrEqual(3);
      // Provenance rides the aerial (google_solar_api) pipeline that approve-aerial promotes.
      expect(a.provenance.sourcePipeline).toBe('google_solar_api');
    }
    expect(artifacts.map((a) => a.azimuthDegrees).sort((x, y) => (x! - y!))).toEqual([0, 90, 180, 270]);
  });

  it('returns empty for no facets', () => {
    expect(adaptRoofFacetsToWorldArtifacts([], SURVEY_ID, 'mock')).toEqual([]);
  });

  it('mock provider returns the hip-roof facets', async () => {
    const result = await new MockAerialProvider().getRoofFacets({ lat: 41.249, lng: -95.9906 });
    expect(result?.source).toBe('mock');
    expect(result?.facets).toHaveLength(4);
  });
});
