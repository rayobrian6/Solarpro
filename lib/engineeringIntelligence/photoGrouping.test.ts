import { describe, expect, it } from 'vitest';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { buildSurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';
import { buildCADReadinessMetadata } from './cadReadiness';
import { buildDeterministicPhotoGrouping } from './photoGrouping';

const generatedAt = '2025-01-01T00:00:00.000Z';

function survey(overrides: Partial<SiteSurvey> = {}): SiteSurvey {
  return {
    id: 'survey-grouping-1',
    clientId: 'client-1',
    projectId: 'project-grouping-1',
    createdBy: 'user-1',
    createdAt: '2024-12-31T20:00:00.000Z',
    updatedAt: '2024-12-31T21:00:00.000Z',
    status: 'completed',
    source: 'project_handoff',
    addressSnapshot: '123 Deterministic Way',
    surveyData: {},
    inspectorName: 'Field Tech',
    notes: 'Deterministic grouping fixture.',
    externalSurveyId: null,
    deliveryId: null,
    ...overrides,
  };
}

function file(id: string, label: string, createdAt: string, filename = `${label}.jpg`): SiteSurveyFile {
  return {
    id,
    surveyId: 'survey-grouping-1',
    fileUrl: `https://example.test/${id}.jpg`,
    fileType: 'photo',
    label,
    filename,
    mimeType: 'image/jpeg',
    createdAt,
  };
}

function groupingFor(files: SiteSurveyFile[], surveyOverrides: Partial<SiteSurvey> = {}) {
  const sourceSurvey = survey(surveyOverrides);
  const manifest = buildSurveyEvidenceManifest({ survey: sourceSurvey, files, generatedAt });
  const readiness = buildCADReadinessMetadata({ projectId: sourceSurvey.projectId ?? 'project-grouping-1', surveyId: sourceSurvey.id, canonicalManifest: manifest });
  return buildDeterministicPhotoGrouping({
    projectId: sourceSurvey.projectId,
    survey: sourceSurvey,
    canonicalManifest: manifest,
    readinessFlags: readiness.flags,
    generatedAt,
  });
}

describe('deterministic photo grouping', () => {
  it('preserves sparse exterior-only surveys without fabricating electrical, trench, or detached evidence', () => {
    const grouping = groupingFor([
      file('overview-1', 'site_overview', '2024-12-31T20:01:00.000Z'),
      file('roof-1', 'roof_overview', '2024-12-31T20:02:00.000Z'),
      file('roof-2', 'roof_edge', '2024-12-31T20:03:00.000Z'),
    ]);

    expect(grouping.source).toBe('canonical_manifest_metadata');
    expect(grouping.surveyTraversalOrder.map(item => item.category)).toEqual(['overview', 'roof_plane', 'roof_edge']);
    expect(grouping.roofSideCandidateGroups.length).toBeGreaterThan(0);
    expect(grouping.electricalEvidenceGroups).toEqual([]);
    expect(grouping.utilityEvidenceGroups).toEqual([]);
    expect(grouping.detachedStructureGroups).toEqual([]);
    expect(grouping.groundMountCandidateGroups).toEqual([]);
    expect(grouping.groupedCADReadiness.find(context => context.contextId === 'grouped-readiness:trench-path-continuity')?.status).toBe('blocked');
    expect(grouping.deterministicNotes.join(' ')).toContain('Sparse exterior-only surveys remain partial/blocked');
  });

  it('detects interrupted traversal ordering, duplicate timestamps, and stable reruns deterministically', () => {
    const files = [
      file('roof-a', 'roof_overview', '2024-12-31T20:01:00.000Z', '001-roof.jpg'),
      file('roof-b', 'roof_edge', '2024-12-31T20:01:00.000Z', '002-roof-edge.jpg'),
      file('meter-a', 'utility_meter', '2024-12-31T20:20:00.000Z', '003-meter.jpg'),
      file('panel-a', 'main_panel', '2024-12-31T20:21:00.000Z', '004-panel.jpg'),
      file('roof-c', 'roof_surface', '2024-12-31T20:36:00.000Z', '005-roof-return.jpg'),
    ];

    const first = groupingFor(files);
    const second = groupingFor([...files].reverse());

    expect(first.surveyTraversalOrder.map(item => item.filename)).toEqual(second.surveyTraversalOrder.map(item => item.filename));
    expect(first.surveyTraversalOrder.map(item => item.category)).toEqual(second.surveyTraversalOrder.map(item => item.category));
    expect(first.evidenceClusters.map(cluster => `${cluster.clusterType}:${cluster.sequenceStart}-${cluster.sequenceEnd}`)).toEqual(second.evidenceClusters.map(cluster => `${cluster.clusterType}:${cluster.sequenceStart}-${cluster.sequenceEnd}`));
    expect(first.sequenceBreakpoints.map(point => point.reason).join(' | ')).toContain('duplicate timestamp tie resolved');
    expect(first.sequenceBreakpoints.map(point => point.reason).join(' | ')).toContain('timestamp gap 19.0 minutes');
    expect(first.sequenceBreakpoints.map(point => point.reason).join(' | ')).toContain('category transition roof_side_candidate to utility_evidence');
    expect(first.roofSideCandidateGroups.length).toBeGreaterThanOrEqual(2);
    expect(first.utilityEvidenceGroups.length).toBe(1);
    expect(first.electricalEvidenceGroups.length).toBe(1);
  });

  it('groups roof, utility, detached-structure, and trench candidates only from explicit metadata categories', () => {
    const grouping = groupingFor([
      file('roof-a', 'roof_overview', '2024-12-31T20:01:00.000Z'),
      file('roof-b', 'roof_surface', '2024-12-31T20:02:00.000Z'),
      file('utility-a', 'utility_connection', '2024-12-31T20:03:00.000Z'),
      file('detached-a', 'detached_garage', '2024-12-31T20:04:00.000Z'),
      file('trench-a', 'trench_path', '2024-12-31T20:05:00.000Z'),
    ]);

    expect(grouping.roofSideCandidateGroups.flatMap(group => group.categories)).toEqual(expect.arrayContaining(['roof_plane', 'roof_surface']));
    expect(grouping.utilityEvidenceGroups.flatMap(group => group.categories)).toContain('utility_connection');
    expect(grouping.detachedStructureGroups.flatMap(group => group.categories)).toContain('detached_structures');
    expect(grouping.groundMountCandidateGroups.flatMap(group => group.categories)).toContain('trench_path');
    expect(grouping.electricalEvidenceGroups).toEqual([]);
    expect(grouping.groupedCADReadiness.find(context => context.contextId === 'grouped-readiness:roof-side-continuity')?.supportingClusterIds.length).toBeGreaterThan(0);
    expect(grouping.groupedCADReadiness.find(context => context.contextId === 'grouped-readiness:trench-path-continuity')?.supportingClusterIds.length).toBeGreaterThan(0);
  });

  it('uses payload upload metadata as an allowed deterministic fallback when file timestamps tie', () => {
    const sourceSurvey = survey({
      surveyData: {
        photos: [
          { url: 'https://example.test/panel-a.jpg', category: 'main_panel', createdAt: '2024-12-31T20:05:00.000Z' },
          { url: 'https://example.test/meter-a.jpg', category: 'utility_meter', createdAt: '2024-12-31T20:04:00.000Z' },
        ],
      },
    });
    const files = [
      file('panel-a', 'main_panel', '2024-12-31T20:01:00.000Z', 'z-panel.jpg'),
      file('meter-a', 'utility_meter', '2024-12-31T20:01:00.000Z', 'a-meter.jpg'),
    ];
    const manifest = buildSurveyEvidenceManifest({ survey: sourceSurvey, files, generatedAt });
    const grouping = buildDeterministicPhotoGrouping({ projectId: sourceSurvey.projectId, survey: sourceSurvey, canonicalManifest: manifest, generatedAt });

    expect(grouping.surveyTraversalOrder.map(item => item.uploadTimestamp)).toEqual(['2024-12-31T20:04:00.000Z', '2024-12-31T20:05:00.000Z']);
    expect(grouping.surveyTraversalOrder.map(item => item.category)).toEqual(['meter', 'main_service_panel']);
    expect(grouping.prohibitedRuntimeBehavior).toEqual(expect.arrayContaining(['no OCR', 'no OpenCV', 'no CAD generation', 'no autonomous engineering decisions']));
  });
});
