import { describe, expect, it } from 'vitest';

import { runMultiViewFusion } from './runMultiViewFusion';
import { REVIEW_ONLY_AUTHORITY, type RoofPlaneCandidate } from '../../types';

const CS = 'normalized_image_0_1000' as const;

const DEFAULT_POLYGON: RoofPlaneCandidate['polygon'] = [
  { x: 100, y: 100, coordinateSystem: CS },
  { x: 500, y: 100, coordinateSystem: CS },
  { x: 500, y: 400, coordinateSystem: CS },
  { x: 100, y: 400, coordinateSystem: CS },
];

const DEFAULT_REGION: RoofPlaneCandidate['region'] = {
  x: 100,
  y: 100,
  width: 400,
  height: 300,
  coordinateSystem: CS,
};

function makeRoofPlane(
  fileId: string,
  polygon: RoofPlaneCandidate['polygon'] | null = DEFAULT_POLYGON,
  region: RoofPlaneCandidate['region'] | null = DEFAULT_REGION,
): RoofPlaneCandidate {
  return {
    artifactType: 'roof_plane_candidate',
    normal: [0.1, 0.2, 0.97],
    d: -0.5,
    inlierCount: 10,
    totalPoints: 20,
    region: region ?? undefined,
    polygon: polygon ?? undefined,
    sourceMaskId: `mask-${fileId}`,
    fileId,
    slopeDegrees: 20,
    aspectDegrees: 180,
    associatedLineIds: ['line-1'],
    confidence: 80,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [],
  };
}

describe('runMultiViewFusion geometry safety', () => {
  it('does not create consensus from one photo by default', () => {
    const result = runMultiViewFusion({
      surveyId: 'survey-1',
      perPhotoArtifacts: [{
        fileId: 'photo-1',
        roofPlanes: [makeRoofPlane('photo-1')],
        wallPlanes: [],
        masks: [],
        lines: [],
        vanishingPoints: [],
      }],
    });

    expect(result.artifacts).toHaveLength(0);
  });

  it('rejects candidates with no real polygon instead of emitting a fallback square', () => {
    const result = runMultiViewFusion({
      surveyId: 'survey-1',
      perPhotoArtifacts: [
        {
          fileId: 'photo-1',
          roofPlanes: [makeRoofPlane('photo-1', null, null)],
          wallPlanes: [],
          masks: [],
          lines: [],
          vanishingPoints: [],
        },
        {
          fileId: 'photo-2',
          roofPlanes: [makeRoofPlane('photo-2', null, null)],
          wallPlanes: [],
          masks: [],
          lines: [],
          vanishingPoints: [],
        },
      ],
      config: { minConsensusCount: 2 },
    });

    expect(result.artifacts).toHaveLength(0);
  });

  it('creates consensus only when two distinct photos provide overlapping real polygons', () => {
    const result = runMultiViewFusion({
      surveyId: 'survey-1',
      perPhotoArtifacts: [
        {
          fileId: 'photo-1',
          roofPlanes: [makeRoofPlane('photo-1')],
          wallPlanes: [],
          masks: [],
          lines: [],
          vanishingPoints: [],
        },
        {
          fileId: 'photo-2',
          roofPlanes: [makeRoofPlane('photo-2')],
          wallPlanes: [],
          masks: [],
          lines: [],
          vanishingPoints: [],
        },
      ],
      config: { minConsensusCount: 2 },
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      artifactType: 'consensus_plane_candidate',
      consensusPhotoCount: 2,
    });
    expect(result.artifacts[0].polygon).not.toEqual([
      { x: 400, y: 400, coordinateSystem: CS },
      { x: 600, y: 400, coordinateSystem: CS },
      { x: 600, y: 600, coordinateSystem: CS },
      { x: 400, y: 600, coordinateSystem: CS },
    ]);
  });
});
