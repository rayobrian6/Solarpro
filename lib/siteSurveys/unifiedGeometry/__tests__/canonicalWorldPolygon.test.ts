import { describe, it, expect } from 'vitest';
import { buildCanonicalModel } from '..';
import { getAuthorityForState } from '../authority';
import { rowToCanonicalModel, type CanonicalModelRow } from '../canonicalModelStore';
import type {
  UnifiedGeometryArtifact,
  WorldRoofPolygon,
  CanonicalBuildingModel,
} from '../types';

const SURVEY = 'survey-world-001';

const WORLD: WorldRoofPolygon = {
  vertices: [
    { lat: 38.7062, lng: -90.0463 },
    { lat: 38.7063, lng: -90.0461 },
    { lat: 38.7061, lng: -90.046 },
    { lat: 38.706, lng: -90.0462 },
  ],
  edgeTypes: ['ridge', 'rake', 'eave', 'rake'],
};

/** A promoted_canonical roof_plane artifact (full UnifiedGeometryArtifact). */
function makeRoofPlane(
  overrides: Partial<UnifiedGeometryArtifact> = {},
): UnifiedGeometryArtifact {
  return {
    id: overrides.id ?? 'roof-art-001',
    surveyId: overrides.surveyId ?? SURVEY,
    geometryClass: 'roof_plane',
    authority: overrides.authority ?? getAuthorityForState('promoted_canonical'),
    provenance: overrides.provenance ?? {
      sourcePipeline: 'google_solar_api',
      toolName: 'google-solar-api',
      toolVersion: '1.0.0',
      runHash: 'hash-world-001',
      sourceFileIds: [],
      derivedFromArtifactIds: [],
      createdAt: '2026-06-06T00:00:00.000Z',
      reviewedBy: 'operator-001',
      reviewedAt: '2026-06-06T00:00:00.000Z',
      workerVersion: null,
    },
    confidence: overrides.confidence ?? 92,
    label: 'Roof plane',
    limitations: [],
    bbox: null,
    polygon: overrides.polygon ?? null,
    worldPolygon: 'worldPolygon' in overrides ? overrides.worldPolygon : WORLD,
    lineSegment: null,
    center: null,
    planeType: 'roof_plane',
    pitchDegrees: overrides.pitchDegrees ?? 25,
    azimuthDegrees: overrides.azimuthDegrees ?? 180,
    normalVector: null,
    areaSqM: overrides.areaSqM ?? 30.13,
    inlierCount: null,
    totalPoints: null,
    lineSubtype: null,
    estimatedLengthM: null,
    obstructionSubtype: null,
    radiusM: null,
    setbackM: null,
    heightFt: null,
    roofPlaneId: null,
    cadImpact: null,
    electricalSubtype: null,
    story: null,
    isPrimaryInterconnect: null,
    depthResolution: null,
    depthMetric: null,
    consensusPhotoCount: null,
    segmentationClass: null,
    reviewState: 'reviewed',
    reviewNotes: null,
    priority: 'medium',
    stageTimings: null,
  } as UnifiedGeometryArtifact;
}

describe('CanonicalBuildingModel — worldPolygon (Phase 1 spine)', () => {
  it('carries an artifact worldPolygon (lat/lng + pitch/azimuth/area) into the canonical roof plane', () => {
    const model = buildCanonicalModel(SURVEY, [makeRoofPlane()], []);

    expect(model.roofPlanes).toHaveLength(1);
    const rp = model.roofPlanes[0];
    expect(rp.worldPolygon).toEqual(WORLD);
    expect(rp.pitchDegrees).toBe(25);
    expect(rp.azimuthDegrees).toBe(180);
    expect(rp.areaSqM).toBe(30.13);
    // A plane that carries authoritative world geometry is NOT degraded, even
    // without an image-space polygon.
    expect(rp.degradedNoGeometry).toBe(false);
  });

  it('marks a roof plane degraded when it has neither image polygon nor worldPolygon', () => {
    const model = buildCanonicalModel(SURVEY, [
      makeRoofPlane({ id: 'roof-art-002', worldPolygon: null, polygon: null }),
    ], []);

    expect(model.roofPlanes[0].degradedNoGeometry).toBe(true);
    expect(model.roofPlanes[0].worldPolygon).toBeUndefined();
  });
});

describe('canonicalModelStore.rowToCanonicalModel', () => {
  it('round-trips a model through JSONB serialization', () => {
    const model = buildCanonicalModel(SURVEY, [makeRoofPlane()], []);

    // Simulate the Neon JSONB write→read cycle (object → string → parsed object)
    const jsonbParsed = JSON.parse(JSON.stringify(model)) as CanonicalBuildingModel;
    const row: CanonicalModelRow = {
      survey_id: model.surveyId,
      schema_version: model.schemaVersion,
      authority_state: model.authority.state,
      roof_plane_count: model.roofPlanes.length,
      model: jsonbParsed,
      built_by: model.provenance.builtBy,
      built_at: '2026-06-06T00:00:00.000Z',
      updated_at: '2026-06-06T00:00:00.000Z',
    };

    const restored = rowToCanonicalModel(row);
    expect(restored.surveyId).toBe(SURVEY);
    expect(restored.roofPlanes).toHaveLength(1);
    expect(restored.roofPlanes[0].worldPolygon).toEqual(WORLD);
    expect(restored).toEqual(jsonbParsed);
  });
});
