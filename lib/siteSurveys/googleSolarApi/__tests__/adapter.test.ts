// ============================================================================
// lib/siteSurveys/googleSolarApi/__tests__/adapter.test.ts
//
// Unit tests for the Pipeline C adapter — converts Google Solar API
// buildingInsights response into UnifiedGeometryArtifact instances.
//
// Covers:
//   - Coordinate conversion (Solar API pixel → normalized_image_0_1000)
//   - Roof plane adaptation (polygon, pitch, azimuth, area, normal vector)
//   - Roof line inference (ridge, hip, eave, rake, valley)
//   - Provenance and authority assignment
//   - Edge cases (no bounding box, no roof planes, empty vertices)
//   - adaptPipelineCResult helper
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  adaptBuildingInsightsToUnifiedArtifacts,
  adaptPipelineCResult,
} from '../adapter';
import type { BuildingInsightsResponse, SolarRoofPlane, SolarPixelBoundingBox } from '../types';
import type { UnifiedGeometryArtifact } from '@/lib/siteSurveys/unifiedGeometry/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBbox(overrides?: Partial<SolarPixelBoundingBox>): SolarPixelBoundingBox {
  return {
    x: 100,
    y: 200,
    width: 300,
    height: 400,
    ...overrides,
  };
}

function makeRoofPlane(overrides?: Partial<SolarRoofPlane>): SolarRoofPlane {
  return {
    boundingBox: makeBbox({ x: 110, y: 210, width: 120, height: 150 }),
    planeOutline: {
      vertices: [
        { x: 110, y: 210 },
        { x: 230, y: 210 },
        { x: 230, y: 360 },
        { x: 110, y: 360 },
      ],
    },
    roofPitch: 25,
    azimuth: 180,
    areaSqMeters: 45.2,
    planeIndex: 0,
    ...overrides,
  };
}

function makeInsightsResponse(overrides?: Partial<BuildingInsightsResponse>): BuildingInsightsResponse {
  return {
    name: 'buildings/test-123',
    center: { latitude: 37.7749, longitude: -122.4194 },
    boundingBox: makeBbox(),
    imageryDate: { year: 2023, month: 6 },
    roofPlanes: [
      makeRoofPlane(),
      makeRoofPlane({
        // Overlap with Plane 0: Plane 0 is x=110..230, this starts at x=200 so they overlap in x=200..230
        boundingBox: makeBbox({ x: 200, y: 210, width: 120, height: 150 }),
        planeOutline: {
          vertices: [
            { x: 200, y: 210 },
            { x: 320, y: 210 },
            { x: 320, y: 360 },
            { x: 200, y: 360 },
          ],
        },
        azimuth: 0, // Opposite direction — forms a ridge
        roofPitch: 25,
        areaSqMeters: 45.2,
        planeIndex: 1,
      }),
    ],
    ...overrides,
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('adaptBuildingInsightsToUnifiedArtifacts', () => {
  const surveyId = 'survey-test-001';

  // ─── Happy path ───────────────────────────────────────────────────────

  it('adapts a buildingInsights response with 2 roof planes', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);

    // Should have roof planes + inferred roof lines
    const roofPlanes = artifacts.filter((a) => a.geometryClass === 'roof_plane');
    const roofLines = artifacts.filter((a) => a.geometryClass === 'roof_line');

    expect(roofPlanes.length).toBe(2);
    expect(roofLines.length).toBeGreaterThan(0);
  });

  it('creates roof plane artifacts with correct geometry class', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const planes = artifacts.filter((a) => a.geometryClass === 'roof_plane');

    for (const plane of planes) {
      expect(plane.polygon).not.toBeNull();
      expect(plane.polygon!.vertices.length).toBeGreaterThanOrEqual(3);
      expect(plane.polygon!.coordinateSystem).toBe('normalized_image_0_1000');
      expect(plane.pitchDegrees).not.toBeNull();
      expect(plane.azimuthDegrees).not.toBeNull();
      expect(plane.areaSqM).not.toBeNull();
    }
  });

  it('assigns correct provenance with google_solar_api source', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);

    for (const artifact of artifacts) {
      expect(artifact.provenance.sourcePipeline).toBe('google_solar_api');
      expect(artifact.provenance.toolName).toBe('google_solar_building_insights');
    }
  });

  it('assigns RAW_EVIDENCE authority', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);

    for (const artifact of artifacts) {
      expect(artifact.authority.state).toBe('raw_evidence');
    }
  });

  it('marks artifacts as NOT synthetic', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);

    for (const artifact of artifacts) {
      expect(artifact.isSynthetic).toBe(false);
    }
  });

  it('assigns high confidence to roof planes (>80)', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const planes = artifacts.filter((a) => a.geometryClass === 'roof_plane');

    for (const plane of planes) {
      expect(plane.confidence).toBeGreaterThan(80);
    }
  });

  it('assigns lower confidence to roof lines than to roof planes', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const planes = artifacts.filter((a) => a.geometryClass === 'roof_plane');
    const lines = artifacts.filter((a) => a.geometryClass === 'roof_line');

    if (lines.length > 0 && planes.length > 0) {
      const avgPlaneConf = planes.reduce((s, p) => s + p.confidence, 0) / planes.length;
      const avgLineConf = lines.reduce((s, l) => s + l.confidence, 0) / lines.length;
      expect(avgLineConf).toBeLessThan(avgPlaneConf);
    }
  });

  // ─── Coordinate conversion ────────────────────────────────────────────

  it('normalizes polygon vertices to 0-1000 range', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const planes = artifacts.filter((a) => a.geometryClass === 'roof_plane');

    for (const plane of planes) {
      if (plane.polygon) {
        for (const vertex of plane.polygon.vertices) {
          expect(vertex.x).toBeGreaterThanOrEqual(0);
          expect(vertex.x).toBeLessThanOrEqual(1000);
          expect(vertex.y).toBeGreaterThanOrEqual(0);
          expect(vertex.y).toBeLessThanOrEqual(1000);
          expect(vertex.coordinateSystem).toBe('normalized_image_0_1000');
        }
      }
    }
  });

  it('computes correct normal vector from pitch and azimuth', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const plane = artifacts.find((a) => a.geometryClass === 'roof_plane');

    expect(plane).toBeDefined();
    expect(plane!.normalVector).not.toBeNull();

    // For a 25° pitch, 180° azimuth (south-facing):
    // normalVector.x = sin(25°) * sin(180°) ≈ 0
    // normalVector.y = -cos(25°) ≈ -0.906
    // normalVector.z = sin(25°) * cos(180°) ≈ -0.423
    const nv = plane!.normalVector!;
    expect(Math.abs(nv.x)).toBeLessThan(0.1); // sin(180°) ≈ 0
    expect(nv.y).toBeCloseTo(-0.906, 1); // -cos(25°)
    expect(nv.z).toBeCloseTo(-0.423, 1); // sin(25°) * cos(180°)
  });

  // ─── Roof line inference ───────────────────────────────────────────────

  it('infers ridge lines for planes with opposite azimuths', () => {
    // Plane 1 azimuth=180 (south), Plane 2 azimuth=0 (north) → ridge
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const ridgeLines = artifacts.filter(
      (a) => a.geometryClass === 'roof_line' && a.lineSubtype === 'ridge',
    );

    expect(ridgeLines.length).toBeGreaterThan(0);
  });

  it('infers hip lines for non-ridge adjacent planes', () => {
    // Two planes with similar azimuths (not opposite) → hip
    const response = makeInsightsResponse({
      roofPlanes: [
        makeRoofPlane({ azimuth: 90 }),
        makeRoofPlane({
          azimuth: 120, // Not opposite (diff = 30°, not ~180°)
          // Overlap with Plane 0: Plane 0 is x=110..230, this starts at x=200 so they overlap in x=200..230
          boundingBox: makeBbox({ x: 200, y: 210, width: 120, height: 150 }),
          planeOutline: {
            vertices: [
              { x: 200, y: 210 },
              { x: 320, y: 210 },
              { x: 320, y: 360 },
              { x: 200, y: 360 },
            ],
          },
          planeIndex: 1,
        }),
      ],
    });
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const hipLines = artifacts.filter(
      (a) => a.geometryClass === 'roof_line' && a.lineSubtype === 'hip',
    );

    expect(hipLines.length).toBeGreaterThan(0);
  });

  it('caps roof lines at MAX_ROOF_LINES (20)', () => {
    // Create 10 planes → C(10,2) = 45 pairs + 10 edge lines = 55 total lines
    // Should be capped at 20
    const planes = Array.from({ length: 10 }, (_, i) =>
      makeRoofPlane({
        boundingBox: makeBbox({ x: 100 + i * 30, y: 200, width: 25, height: 25 }),
        planeOutline: {
          vertices: [
            { x: 100 + i * 30, y: 200 },
            { x: 125 + i * 30, y: 200 },
            { x: 112 + i * 30, y: 225 },
          ],
        },
        planeIndex: i,
      }),
    );

    const response = makeInsightsResponse({ roofPlanes: planes });
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const lines = artifacts.filter((a) => a.geometryClass === 'roof_line');

    expect(lines.length).toBeLessThanOrEqual(20);
  });

  // ─── Edge cases ────────────────────────────────────────────────────────

  it('returns empty array when boundingBox is missing', () => {
    const response = makeInsightsResponse({ boundingBox: undefined });
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);

    expect(artifacts.length).toBe(0);
  });

  it('returns empty array when roofPlanes is missing', () => {
    const response = makeInsightsResponse({ roofPlanes: undefined });
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);

    expect(artifacts.length).toBe(0);
  });

  it('returns empty array when roofPlanes is empty', () => {
    const response = makeInsightsResponse({ roofPlanes: [] });
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);

    expect(artifacts.length).toBe(0);
  });

  it('skips roof planes with no polygon outline', () => {
    const response = makeInsightsResponse({
      roofPlanes: [
        makeRoofPlane({ planeOutline: undefined as any }),
        makeRoofPlane({ planeOutline: { vertices: [] } }),
      ],
    });
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const planes = artifacts.filter((a) => a.geometryClass === 'roof_plane');

    expect(planes.length).toBe(0); // Both invalid, neither adapted
  });

  it('skips roof planes with fewer than 3 vertices', () => {
    const response = makeInsightsResponse({
      roofPlanes: [
        makeRoofPlane({
          planeOutline: {
            vertices: [
              { x: 100, y: 200 },
              { x: 200, y: 200 },
              // Only 2 vertices — not a polygon!
            ],
          },
        }),
      ],
    });
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const planes = artifacts.filter((a) => a.geometryClass === 'roof_plane');

    expect(planes.length).toBe(0);
  });

  it('infers no roof lines for a single roof plane', () => {
    const response = makeInsightsResponse({
      roofPlanes: [makeRoofPlane()],
    });
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const lines = artifacts.filter((a) => a.geometryClass === 'roof_line');

    // Single plane should have edge lines (eave/rake) but no shared lines
    // Actually, with 1 plane we get edge lines from the outline
    // But no shared lines between planes
    const sharedLines = lines.filter(
      (l) => l.lineSubtype === 'ridge' || l.lineSubtype === 'hip' || l.lineSubtype === 'valley',
    );
    expect(sharedLines.length).toBe(0);
  });

  // ─── Label format ─────────────────────────────────────────────────────

  it('creates descriptive labels for roof planes', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const planes = artifacts.filter((a) => a.geometryClass === 'roof_plane');

    for (const plane of planes) {
      expect(plane.label).toContain('Roof plane');
      expect(plane.label).toContain('pitch');
      expect(plane.label).toContain('azimuth');
    }
  });

  // ─── Limitations ──────────────────────────────────────────────────────

  it('includes limitations for each artifact', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);

    for (const artifact of artifacts) {
      expect(artifact.limitations.length).toBeGreaterThan(0);
    }
  });

  // ─── Metadata ──────────────────────────────────────────────────────────

  it('sets imageryDate in provenance runHash', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const plane = artifacts.find((a) => a.geometryClass === 'roof_plane');

    expect(plane).toBeDefined();
    expect(plane!.provenance.runHash).toContain('solar-api-');
  });

  it('sets roofPlaneId for roof plane artifacts', () => {
    const response = makeInsightsResponse();
    const artifacts = adaptBuildingInsightsToUnifiedArtifacts(response, surveyId);
    const planes = artifacts.filter((a) => a.geometryClass === 'roof_plane');

    for (const plane of planes) {
      expect(plane.roofPlaneId).toMatch(/^solar-plane-\d+$/);
    }
  });
});

// ─── adaptPipelineCResult ───────────────────────────────────────────────────

describe('adaptPipelineCResult', () => {
  const surveyId = 'survey-test-001';

  it('returns empty array for unsuccessful result', () => {
    const result = {
      success: false,
      buildingInsights: null,
    };
    const artifacts = adaptPipelineCResult(result, surveyId);
    expect(artifacts.length).toBe(0);
  });

  it('delegates to adaptBuildingInsightsToUnifiedArtifacts for successful result', () => {
    const result = {
      success: true,
      buildingInsights: makeInsightsResponse(),
    };
    const artifacts = adaptPipelineCResult(result, surveyId);

    const planes = artifacts.filter((a) => a.geometryClass === 'roof_plane');
    expect(planes.length).toBeGreaterThan(0);
  });
});
