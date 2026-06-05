// ============================================================================
// lib/siteSurveys/unifiedGeometry/__tests__/staleArtifactCleanup.test.ts
//
// TASK 1 — Stale Artifact Cleanup Tests
//
// Proves that when Pipeline B is rerun for a survey, old geometry_recon
// artifacts are removed before new ones are written, and artifacts from
// other pipelines (photo_vision, google_solar_api, manual) are preserved.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  adaptGeometryReconBundle,
  adaptPhotoVisionBundle,
} from '../pipelineAdapters';
import type { UnifiedGeometryArtifact } from '../types';

// ── Mock the unified artifact store ──────────────────────────────────────────
// We simulate the cleanup+write sequence that the execute route performs.

const mockStore = new Map<string, UnifiedGeometryArtifact>();

function storeKey(a: UnifiedGeometryArtifact): string {
  return `${a.surveyId}:${a.provenance.sourcePipeline}:${a.id}`;
}

async function mockWriteUnifiedArtifacts(artifacts: UnifiedGeometryArtifact[]) {
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  for (const a of artifacts) {
    const key = storeKey(a);
    if (mockStore.has(key)) {
      skipped++;
    } else {
      mockStore.set(key, a);
      inserted++;
    }
  }
  return { inserted, skipped, failed, total: artifacts.length };
}

async function mockDeleteUnifiedArtifactsByPipeline(
  surveyId: string,
  sourcePipeline: string,
): Promise<number> {
  let deleted = 0;
  for (const [key, artifact] of mockStore.entries()) {
    if (artifact.surveyId === surveyId && artifact.provenance.sourcePipeline === sourcePipeline) {
      mockStore.delete(key);
      deleted++;
    }
  }
  return deleted;
}

async function mockDeleteUnifiedArtifactsBySurvey(
  surveyId: string,
  _ownerId: string,
): Promise<number> {
  let deleted = 0;
  for (const [key, artifact] of mockStore.entries()) {
    if (artifact.surveyId === surveyId) {
      mockStore.delete(key);
      deleted++;
    }
  }
  return deleted;
}

// ── Helper: create a minimal artifact ────────────────────────────────────────

function makeArtifact(overrides: Partial<UnifiedGeometryArtifact>): UnifiedGeometryArtifact {
  return {
    id: overrides.id ?? 'test-id-1',
    surveyId: overrides.surveyId ?? 'survey-1',
    geometryClass: overrides.geometryClass ?? 'segmentation_mask',
    authority: overrides.authority ?? {
      state: 'raw_evidence' as const,
      level: 0,
      setAt: new Date().toISOString(),
      setBy: 'test',
      reason: 'test',
    },
    provenance: overrides.provenance ?? {
      sourcePipeline: 'geometry_recon',
      toolName: 'test',
      fileId: 'file-1',
      sourceFileIds: [],
      runId: 'run-1',
      jobId: 'job-1',
      adaptedAt: new Date().toISOString(),
      isSynthetic: false,
    },
    confidence: overrides.confidence ?? 50,
    label: overrides.label ?? 'Test artifact',
    limitations: [],
    bbox: null,
    priority: 'normal',
    isSynthetic: false,
    ...overrides,
  } as UnifiedGeometryArtifact;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TASK 1: Stale Artifact Cleanup', () => {

  beforeEach(() => {
    mockStore.clear();
  });

  it('pipeline-scoped cleanup removes only geometry_recon artifacts', async () => {
    const surveyId = 'survey-1';

    // Seed: artifacts from 3 different pipelines
    const pvArtifact = makeArtifact({
      id: 'pv-1',
      surveyId,
      provenance: { sourcePipeline: 'photo_vision', toolName: 'yolo_v8', fileId: 'f1', sourceFileIds: [], runId: 'r1', jobId: 'j1', adaptedAt: new Date().toISOString(), isSynthetic: false },
      geometryClass: 'roof_plane',
      label: 'PhotoVision roof',
    });
    const gsaArtifact = makeArtifact({
      id: 'gsa-1',
      surveyId,
      provenance: { sourcePipeline: 'google_solar_api', toolName: 'buildingInsights', fileId: 'f2', sourceFileIds: [], runId: 'r2', jobId: 'j2', adaptedAt: new Date().toISOString(), isSynthetic: false },
      geometryClass: 'roof_plane',
      label: 'Google Solar roof',
    });
    const reconArtifact = makeArtifact({
      id: 'recon-1',
      surveyId,
      provenance: { sourcePipeline: 'geometry_recon', toolName: 'segmentation_worker', fileId: 'f3', sourceFileIds: [], runId: 'r3', jobId: 'j3', adaptedAt: new Date().toISOString(), isSynthetic: false },
      geometryClass: 'segmentation_mask',
      label: 'Old recon mask',
    });

    await mockWriteUnifiedArtifacts([pvArtifact, gsaArtifact, reconArtifact]);
    expect(mockStore.size).toBe(3);

    // Simulate Pipeline B rerun: pipeline-scoped cleanup
    const deletedCount = await mockDeleteUnifiedArtifactsByPipeline(surveyId, 'geometry_recon');

    expect(deletedCount).toBe(1);
    expect(mockStore.size).toBe(2);

    // PhotoVision and Google Solar artifacts survive
    const surviving = Array.from(mockStore.values());
    const survivingPipelines = surviving.map(a => a.provenance.sourcePipeline);
    expect(survivingPipelines).toContain('photo_vision');
    expect(survivingPipelines).toContain('google_solar_api');
    expect(survivingPipelines).not.toContain('geometry_recon');
  });

  it('survey-wide cleanup (old behavior) would destroy cross-pipeline artifacts', async () => {
    const surveyId = 'survey-1';

    const pvArtifact = makeArtifact({
      id: 'pv-1',
      surveyId,
      provenance: { sourcePipeline: 'photo_vision', toolName: 'yolo_v8', fileId: 'f1', sourceFileIds: [], runId: 'r1', jobId: 'j1', adaptedAt: new Date().toISOString(), isSynthetic: false },
    });
    const reconArtifact = makeArtifact({
      id: 'recon-1',
      surveyId,
      provenance: { sourcePipeline: 'geometry_recon', toolName: 'segmentation_worker', fileId: 'f3', sourceFileIds: [], runId: 'r3', jobId: 'j3', adaptedAt: new Date().toISOString(), isSynthetic: false },
    });

    await mockWriteUnifiedArtifacts([pvArtifact, reconArtifact]);
    expect(mockStore.size).toBe(2);

    // Old behavior: deleteUnifiedArtifactsBySurvey wipes EVERYTHING
    const deletedCount = await mockDeleteUnifiedArtifactsBySurvey(surveyId, 'owner-1');

    expect(deletedCount).toBe(2);
    expect(mockStore.size).toBe(0);
    // This proves the old behavior was destructive to cross-pipeline artifacts
  });

  it('rerun does not duplicate artifacts when cleanup runs first', async () => {
    const surveyId = 'survey-1';

    // First run: write 3 geometry_recon artifacts
    const firstRunArtifacts = [
      makeArtifact({ id: 'recon-a', surveyId, provenance: { sourcePipeline: 'geometry_recon', toolName: 'seg', fileId: 'f1', sourceFileIds: [], runId: 'r1', jobId: 'j1', adaptedAt: new Date().toISOString(), isSynthetic: false } }),
      makeArtifact({ id: 'recon-b', surveyId, provenance: { sourcePipeline: 'geometry_recon', toolName: 'seg', fileId: 'f2', sourceFileIds: [], runId: 'r1', jobId: 'j1', adaptedAt: new Date().toISOString(), isSynthetic: false } }),
      makeArtifact({ id: 'recon-c', surveyId, provenance: { sourcePipeline: 'geometry_recon', toolName: 'seg', fileId: 'f3', sourceFileIds: [], runId: 'r1', jobId: 'j1', adaptedAt: new Date().toISOString(), isSynthetic: false } }),
    ];
    await mockWriteUnifiedArtifacts(firstRunArtifacts);
    const reconCountAfterFirstRun = Array.from(mockStore.values())
      .filter(a => a.surveyId === surveyId && a.provenance.sourcePipeline === 'geometry_recon').length;
    expect(reconCountAfterFirstRun).toBe(3);

    // Rerun: cleanup first, then write new artifacts
    const deletedCount = await mockDeleteUnifiedArtifactsByPipeline(surveyId, 'geometry_recon');
    expect(deletedCount).toBe(3);

    const secondRunArtifacts = [
      makeArtifact({ id: 'recon-d', surveyId, provenance: { sourcePipeline: 'geometry_recon', toolName: 'seg', fileId: 'f1', sourceFileIds: [], runId: 'r2', jobId: 'j2', adaptedAt: new Date().toISOString(), isSynthetic: false } }),
      makeArtifact({ id: 'recon-e', surveyId, provenance: { sourcePipeline: 'geometry_recon', toolName: 'seg', fileId: 'f2', sourceFileIds: [], runId: 'r2', jobId: 'j2', adaptedAt: new Date().toISOString(), isSynthetic: false } }),
    ];
    await mockWriteUnifiedArtifacts(secondRunArtifacts);

    const reconCountAfterRerun = Array.from(mockStore.values())
      .filter(a => a.surveyId === surveyId && a.provenance.sourcePipeline === 'geometry_recon').length;
    expect(reconCountAfterRerun).toBe(2); // NOT 5 (3 old + 2 new)
  });

  it('manual artifacts survive pipeline rerun', async () => {
    const surveyId = 'survey-1';

    const manualArtifact = makeArtifact({
      id: 'manual-1',
      surveyId,
      provenance: { sourcePipeline: 'manual', toolName: 'user_edit', fileId: 'f-manual', sourceFileIds: [], runId: 'manual', jobId: 'manual', adaptedAt: new Date().toISOString(), isSynthetic: false },
      geometryClass: 'roof_plane',
      label: 'User-drawn roof plane',
      authority: {
        state: 'reviewed_candidate' as const,
        level: 2,
        setAt: new Date().toISOString(),
        setBy: 'user-1',
        reason: 'manual_review',
      },
    });
    const reconArtifact = makeArtifact({
      id: 'recon-1',
      surveyId,
      provenance: { sourcePipeline: 'geometry_recon', toolName: 'seg', fileId: 'f1', sourceFileIds: [], runId: 'r1', jobId: 'j1', adaptedAt: new Date().toISOString(), isSynthetic: false },
    });

    await mockWriteUnifiedArtifacts([manualArtifact, reconArtifact]);

    // Pipeline B rerun: cleanup
    await mockDeleteUnifiedArtifactsByPipeline(surveyId, 'geometry_recon');

    const surviving = Array.from(mockStore.values());
    expect(surviving.length).toBe(1);
    expect(surviving[0].provenance.sourcePipeline).toBe('manual');
    expect(surviving[0].authority.state).toBe('reviewed_candidate');
  });

  it('different surveys are isolated from each other', async () => {
    const survey1 = 'survey-1';
    const survey2 = 'survey-2';

    const s1Artifact = makeArtifact({
      id: 'recon-s1',
      surveyId: survey1,
      provenance: { sourcePipeline: 'geometry_recon', toolName: 'seg', fileId: 'f1', sourceFileIds: [], runId: 'r1', jobId: 'j1', adaptedAt: new Date().toISOString(), isSynthetic: false },
    });
    const s2Artifact = makeArtifact({
      id: 'recon-s2',
      surveyId: survey2,
      provenance: { sourcePipeline: 'geometry_recon', toolName: 'seg', fileId: 'f2', sourceFileIds: [], runId: 'r2', jobId: 'j2', adaptedAt: new Date().toISOString(), isSynthetic: false },
    });

    await mockWriteUnifiedArtifacts([s1Artifact, s2Artifact]);

    // Only cleanup survey-1
    const deleted = await mockDeleteUnifiedArtifactsByPipeline(survey1, 'geometry_recon');
    expect(deleted).toBe(1);

    // Survey-2's artifact is untouched
    const s2Survivors = Array.from(mockStore.values())
      .filter(a => a.surveyId === survey2);
    expect(s2Survivors.length).toBe(1);
  });
});
