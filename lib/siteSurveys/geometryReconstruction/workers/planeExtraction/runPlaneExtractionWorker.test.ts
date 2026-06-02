import { describe, expect, it } from 'vitest';

import { runPlaneExtractionWorker } from './runPlaneExtractionWorker';
import { REVIEW_ONLY_AUTHORITY, type SemanticSegmentationMask, type SegmentationClass } from '../../types';

const CS = 'normalized_image_0_1000' as const;

function makeMask(id: string, segmentationClass: SegmentationClass): SemanticSegmentationMask {
  return {
    artifactType: 'semantic_segmentation_mask',
    id,
    fileId: 'photo-1',
    segmentationClass,
    polygon: [
      { x: 100, y: 100, coordinateSystem: CS },
      { x: 500, y: 120, coordinateSystem: CS },
      { x: 520, y: 420, coordinateSystem: CS },
      { x: 120, y: 400, coordinateSystem: CS },
    ],
    confidence: 80,
    maskBounds: { x: 100, y: 100, width: 420, height: 320, coordinateSystem: CS },
    workerVersion: 'test',
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [],
  };
}

describe('runPlaneExtractionWorker structural taxonomy', () => {
  it('does not create mask-only heuristic planes by default', () => {
    const output = runPlaneExtractionWorker({
      surveyId: 'survey-1',
      masks: [makeMask('m-roof-dormer', 'dormer')],
      lines: [],
      vanishingPoints: [],
      config: {
        minConfidence: 25,
      },
    });

    expect(output.artifacts).toHaveLength(0);
  });

  it('extracts roof and wall plane candidates from expanded structural segmentation classes when explicitly allowing mask-only heuristics', () => {
    const output = runPlaneExtractionWorker({
      surveyId: 'survey-1',
      masks: [
        makeMask('m-roof-dormer', 'dormer'),
        makeMask('m-wall-siding', 'siding'),
      ],
      lines: [],
      vanishingPoints: [],
      config: {
        minConfidence: 25,
        requireSupportingLines: false,
      },
    });

    expect(output.artifacts.map((artifact) => artifact.artifactType)).toEqual(
      expect.arrayContaining(['roof_plane_candidate', 'wall_plane_candidate']),
    );
    expect(output.artifacts.find((artifact) => artifact.artifactType === 'roof_plane_candidate'))?.toMatchObject({
      sourceMaskId: 'm-roof-dormer',
    });
    expect(output.artifacts.find((artifact) => artifact.artifactType === 'wall_plane_candidate'))?.toMatchObject({
      sourceMaskId: 'm-wall-siding',
    });
  });

  it('does not treat roof obstructions as roof plane sources', () => {
    const output = runPlaneExtractionWorker({
      surveyId: 'survey-1',
      masks: [makeMask('m-obstruction-chimney', 'chimney')],
      lines: [],
      vanishingPoints: [],
      config: {
        minConfidence: 25,
        requireSupportingLines: false,
      },
    });

    expect(output.artifacts).toHaveLength(0);
  });
});
