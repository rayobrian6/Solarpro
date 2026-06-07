// Priority 4 — Commit D: artifacts associate to ALL their source photos.
import { describe, it, expect } from 'vitest';
import { buildFilesWithUnifiedArtifacts } from '@/components/UnifiedGeometryOverlayRenderer';
import type { UnifiedGeometryArtifact } from '../types';

function artifact(id: string, geometryClass: string, sourceFileIds: string[]): UnifiedGeometryArtifact {
  // Only fields the grouping reads are needed; cast through unknown for the rest.
  return { id, geometryClass, provenance: { sourceFileIds } } as unknown as UnifiedGeometryArtifact;
}

const surveyFiles = [
  { id: 'A', fileUrl: 'a.jpg', filename: 'a.jpg' },
  { id: 'B', fileUrl: 'b.jpg', filename: 'b.jpg' },
];

describe('buildFilesWithUnifiedArtifacts — multi-source grouping (Commit D)', () => {
  it('a multi-source consensus plane appears on every source photo', () => {
    const consensus = artifact('c1', 'consensus_plane', ['A', 'B']);
    const groups = buildFilesWithUnifiedArtifacts([consensus], surveyFiles);
    const a = groups.find((g) => g.fileId === 'A');
    const b = groups.find((g) => g.fileId === 'B');
    expect(a?.artifacts.some((x) => x.id === 'c1')).toBe(true);
    expect(b?.artifacts.some((x) => x.id === 'c1')).toBe(true);
  });

  it('a single-source artifact appears only on its source photo, not others', () => {
    const mask = artifact('m1', 'segmentation_mask', ['A']);
    const groups = buildFilesWithUnifiedArtifacts([mask], surveyFiles);
    const a = groups.find((g) => g.fileId === 'A');
    const b = groups.find((g) => g.fileId === 'B');
    expect(a?.artifacts.some((x) => x.id === 'm1')).toBe(true);
    expect(b).toBeUndefined(); // no group B created for an A-only artifact
  });

  it('ignores source ids that are not real survey files (no phantom groups)', () => {
    const planeWithPhantom = artifact('p1', 'roof_plane', ['A', 'ZZZ']);
    const groups = buildFilesWithUnifiedArtifacts([planeWithPhantom], surveyFiles);
    expect(groups.map((g) => g.fileId).sort()).toEqual(['A']);
    expect(groups[0].artifacts.some((x) => x.id === 'p1')).toBe(true);
  });

  it('truly survey-level artifacts (no source ids) distribute to all photo groups', () => {
    const mask = artifact('m1', 'segmentation_mask', ['A']);
    const surveyLevel = artifact('s1', 'consensus_plane', []);
    const groups = buildFilesWithUnifiedArtifacts([mask, surveyLevel], surveyFiles);
    const a = groups.find((g) => g.fileId === 'A');
    expect(a?.artifacts.some((x) => x.id === 's1')).toBe(true);
  });
});
