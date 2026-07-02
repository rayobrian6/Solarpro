import { describe, it, expect } from 'vitest';
import { MOCK_HIP_ROOF_FACETS, MockAerialProvider } from '../mockProvider';
import {
  roofFacetsToSegmentStats,
  roofFacetsToWorldRoofPlanes,
  adaptRoofFacetsToWorldArtifacts,
} from '../facetAdapter';
import type { RoofFacet } from '../types';

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

  it('PRESERVES the real measured polygon — a triangular facet stays a triangle (no bbox-quad reduction)', () => {
    // Each mock hip facet is a 3-vertex triangle. The whole point of using
    // EagleView/aerial geometry is that the planset draws the TRUE facet shape,
    // so the worldPolygon must keep all 3 vertices, not be padded to a 4-vertex
    // bounding-box quad.
    const artifacts = adaptRoofFacetsToWorldArtifacts(MOCK_HIP_ROOF_FACETS, SURVEY_ID, 'eagleview');
    for (const a of artifacts) {
      expect(a.worldPolygon!.vertices).toHaveLength(3);
    }
    // The exact lat/lng vertices of the south-facing facet must survive verbatim.
    const south = MOCK_HIP_ROOF_FACETS[0];
    const southArtifact = artifacts.find((a) => a.azimuthDegrees === 180)!;
    expect(southArtifact.worldPolygon!.vertices).toEqual(south.polygon);
  });

  it('carries provider-supplied edgeTypes through, and preserves a non-quad (5-vertex) outline', () => {
    const pentagon: RoofFacet = {
      pitchDegrees: 18.4,
      azimuthDegrees: 211.7,
      areaSqM: 73.21,
      polygon: [
        { lat: 41.2, lng: -95.99 },
        { lat: 41.2001, lng: -95.9899 },
        { lat: 41.2002, lng: -95.99 },
        { lat: 41.2001, lng: -95.9902 },
        { lat: 41.2, lng: -95.9901 },
      ],
      edgeTypes: ['ridge', 'hip', 'hip', 'eave', 'rake'],
    };
    const [art] = adaptRoofFacetsToWorldArtifacts([pentagon], SURVEY_ID, 'eagleview');
    expect(art.worldPolygon!.vertices).toHaveLength(5);
    expect(art.worldPolygon!.edgeTypes).toEqual(['ridge', 'hip', 'hip', 'eave', 'rake']);
    // pitch/azimuth/area rounded like the Google world-plane path
    expect(art.pitchDegrees).toBe(18.4);
    expect(art.azimuthDegrees).toBe(211.7);
    expect(art.areaSqM).toBe(73.21);
  });

  it('roofFacetsToWorldRoofPlanes drops < 3-vertex facets and keeps real polygons', () => {
    const planes = roofFacetsToWorldRoofPlanes([
      { pitchDegrees: 20, azimuthDegrees: 180, areaSqM: 10, polygon: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }] },
      ...MOCK_HIP_ROOF_FACETS,
    ]);
    expect(planes).toHaveLength(4);
    expect(planes[0].vertices).toEqual(MOCK_HIP_ROOF_FACETS[0].polygon);
    expect(planes[0].source).toBe('google_solar_api');
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
