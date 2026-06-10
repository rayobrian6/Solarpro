import { describe, it, expect } from 'vitest';
import {
  canonicalToPermitRoofPlanes,
  isCanonicalUsableForPlanset,
} from '../canonicalToPermit';
import { getAuthorityForState } from '../authority';
import type { UnifiedGeometryAuthorityState } from '../authority';
import type { CanonicalBuildingModel, CanonicalRoofPlane } from '../types';

function roofPlane(overrides: Partial<CanonicalRoofPlane> = {}): CanonicalRoofPlane {
  return {
    id: overrides.id ?? 'rp-1',
    worldPolygon:
      'worldPolygon' in overrides
        ? overrides.worldPolygon
        : {
            vertices: [
              { lat: 38.7062, lng: -90.0463 },
              { lat: 38.7063, lng: -90.0461 },
              { lat: 38.7061, lng: -90.046 },
              { lat: 38.706, lng: -90.0462 },
            ],
            edgeTypes: ['ridge', 'rake', 'eave', 'rake'],
          },
    degradedNoGeometry: overrides.degradedNoGeometry ?? false,
    pitchDegrees: overrides.pitchDegrees ?? 25,
    azimuthDegrees: overrides.azimuthDegrees ?? 180,
    areaSqM: overrides.areaSqM ?? 30.13,
    normalVector: { x: 0, y: 0, z: 1 },
    sourceArtifactId: 'art-1',
    setbackDefaults: { eaveM: 0.35, ridgeM: 0.15, rakeM: 0.2 },
    ...overrides,
  };
}

function model(
  state: UnifiedGeometryAuthorityState,
  roofPlanes: CanonicalRoofPlane[],
): CanonicalBuildingModel {
  return {
    schemaVersion: 'canonical_building_model_v1',
    surveyId: 'survey-1',
    authority: getAuthorityForState(state),
    roofPlanes,
    wallPlanes: [],
    obstructions: [],
    electricalNodes: [],
    structuralLines: [],
    metadata: {} as CanonicalBuildingModel['metadata'],
    provenance: {
      artifactIds: [],
      promotionRecordIds: [],
      builtAt: '2026-06-06T00:00:00.000Z',
      builtBy: 'automated',
    },
  };
}

describe('isCanonicalUsableForPlanset (authority gate / fallback guarantee)', () => {
  it('accepts only promoted_canonical and cad_safe', () => {
    expect(isCanonicalUsableForPlanset(model('promoted_canonical', [roofPlane()]))).toBe(true);
    expect(isCanonicalUsableForPlanset(model('cad_safe', [roofPlane()]))).toBe(true);
  });

  it('rejects null and all review-only states (so the route falls back safely)', () => {
    expect(isCanonicalUsableForPlanset(null)).toBe(false);
    expect(isCanonicalUsableForPlanset(undefined)).toBe(false);
    for (const s of ['raw_evidence', 'derived_review_only', 'reviewed_candidate'] as const) {
      expect(isCanonicalUsableForPlanset(model(s, [roofPlane()]))).toBe(false);
    }
  });
});

describe('canonicalToPermitRoofPlanes', () => {
  it('maps authoritative world planes to permit roofPlanes (lat/lng + pitch/azimuth/area)', () => {
    const planes = canonicalToPermitRoofPlanes(
      model('promoted_canonical', [
        roofPlane({ id: 'rp-a' }),
        roofPlane({ id: 'rp-b', pitchDegrees: 18, azimuthDegrees: 90, areaSqM: 22.5 }),
      ]),
    );

    expect(planes).toHaveLength(2);
    expect(planes[0]).toMatchObject({
      id: 'rp-a',
      pitch: 25,
      azimuth: 180,
      area: 30.13,
      source: 'aerial',
      confirmed: true,
      edgeTypes: ['ridge', 'rake', 'eave', 'rake'],
    });
    expect(planes[0].vertices).toHaveLength(4);
    expect(planes[1]).toMatchObject({ id: 'rp-b', pitch: 18, azimuth: 90, area: 22.5 });
  });

  it('drops degraded planes and planes without a usable worldPolygon', () => {
    const planes = canonicalToPermitRoofPlanes(
      model('promoted_canonical', [
        roofPlane({ id: 'good' }),
        roofPlane({ id: 'degraded', degradedNoGeometry: true }),
        roofPlane({ id: 'noworld', worldPolygon: undefined }),
        roofPlane({
          id: 'too-few-verts',
          worldPolygon: { vertices: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] },
        }),
      ]),
    );

    expect(planes.map((p) => p.id)).toEqual(['good']);
  });

  it('returns [] when there are no usable planes (caller keeps existing geometry)', () => {
    expect(
      canonicalToPermitRoofPlanes(
        model('promoted_canonical', [roofPlane({ degradedNoGeometry: true })]),
      ),
    ).toEqual([]);
  });
});
