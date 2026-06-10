import { describe, it, expect } from 'vitest';
import { promoteToCanonicalChain } from '../aerialApproval';
import { adaptSolarRoofSegmentsToWorldArtifacts } from '../../googleSolarApi/adapter';
import type { RoofSegmentStat } from '../../googleSolarApi/worldRoofPlanes';

const seg: RoofSegmentStat = {
  center: { latitude: 38.7062, longitude: -90.0462 },
  boundingBox: {
    sw: { latitude: 38.70602, longitude: -90.04658 },
    ne: { latitude: 38.70638, longitude: -90.04582 },
  },
  pitchDegrees: 25,
  azimuthDegrees: 180,
  stats: { areaMeters2: 30 },
  planeHeightAtCenterMeters: 5,
};

describe('promoteToCanonicalChain', () => {
  it('walks a fresh aerial roof_plane artifact raw_evidence → promoted_canonical in 3 steps', () => {
    const [artifact] = adaptSolarRoofSegmentsToWorldArtifacts([seg], 'survey-1', 'buildings/1');
    expect(artifact.authority.state).toBe('raw_evidence');

    const { finalArtifact, results } = promoteToCanonicalChain(artifact, 'operator-1');

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.promotedArtifact.authority.state)).toEqual([
      'derived_review_only',
      'reviewed_candidate',
      'promoted_canonical',
    ]);
    expect(finalArtifact.authority.state).toBe('promoted_canonical');
    // Authoritative geometry survives the promotion chain
    expect(finalArtifact.worldPolygon?.vertices).toHaveLength(4);
    expect(finalArtifact.pitchDegrees).toBe(25);
    // Provenance chain links back to the original raw artifact
    expect(finalArtifact.provenance.derivedFromArtifactIds.length).toBeGreaterThan(0);
  });

  it('is a no-op when the artifact is already promoted_canonical', () => {
    const [artifact] = adaptSolarRoofSegmentsToWorldArtifacts([seg], 'survey-1');
    const once = promoteToCanonicalChain(artifact, 'operator-1');
    const twice = promoteToCanonicalChain(once.finalArtifact, 'operator-1');

    expect(twice.results).toHaveLength(0);
    expect(twice.finalArtifact.authority.state).toBe('promoted_canonical');
  });
});
