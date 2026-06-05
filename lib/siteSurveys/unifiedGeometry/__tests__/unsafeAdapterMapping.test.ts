// ============================================================================
// lib/siteSurveys/unifiedGeometry/__tests__/unsafeAdapterMapping.test.ts
//
// TASK 3 — Fix Unsafe Adapter Mappings Tests
//
// Proves that generic rectangular_region_candidate no longer maps to 'roof_plane'
// unconditionally. Only candidates with explicit roof evidence (candidateCategory
// === 'roof_context') are promoted to 'roof_plane'; all others become 'unknown'.
// Also verifies that other candidate type mappings remain unchanged.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { adaptPhotoVisionCandidate } from '../pipelineAdapters';
import type { OpenSourcePhotoVisionCandidate } from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<OpenSourcePhotoVisionCandidate> & {
    candidateType: OpenSourcePhotoVisionCandidate['candidateType'];
    candidateCategory: OpenSourcePhotoVisionCandidate['candidateCategory'];
  },
): OpenSourcePhotoVisionCandidate {
  return {
    candidateId: overrides.candidateId ?? `cand-${Math.random().toString(36).slice(2, 8)}`,
    surveyId: overrides.surveyId ?? 'survey-test-001',
    fileId: overrides.fileId ?? 'file-test-001',
    fileUrl: overrides.fileUrl ?? 'https://example.com/photo.jpg',
    filename: overrides.filename ?? 'photo.jpg',
    candidateType: overrides.candidateType,
    candidateCategory: overrides.candidateCategory,
    confidence: overrides.confidence ?? 50,
    summary: overrides.summary ?? 'test candidate',
    payload: overrides.payload ?? {},
    limitations: overrides.limitations ?? [],
    reviewStatus: 'review_required',
    nonAuthoritative: true,
    toolName: overrides.toolName ?? 'sharp_contour_512',
    toolVersion: overrides.toolVersion ?? '0.1.0',
    runHash: overrides.runHash ?? 'abc123',
    deterministicHash: overrides.deterministicHash ?? 'def456',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  } as OpenSourcePhotoVisionCandidate;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TASK 3 — Unsafe Adapter Mappings', () => {
  const surveyId = 'survey-test-001';

  it('rectangular_region_candidate WITHOUT roof_context maps to unknown', () => {
    // A generic rectangle — could be a window, door, solar panel, siding patch, etc.
    // Should NOT appear as a confident roof_plane in the overlay.
    const candidate = makeCandidate({
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'structure_context', // NOT roof_context
      confidence: 72,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('unknown');
    // Explicitly verify it is NOT 'roof_plane'
    expect(artifact.geometryClass).not.toBe('roof_plane');
  });

  it('rectangular_region_candidate WITH roof_context promotes to roof_plane', () => {
    // A rectangle with explicit roof evidence — this is a genuine roof-context detection.
    // Should be promoted to 'roof_plane' via the safety override.
    const candidate = makeCandidate({
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'roof_context',
      confidence: 85,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('roof_plane');
  });

  it('rectangular_region_candidate with electrical_context maps to unknown', () => {
    // An electrical rectangle (e.g., junction box, panel) — definitely not a roof.
    const candidate = makeCandidate({
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'electrical_context',
      confidence: 60,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('unknown');
    expect(artifact.geometryClass).not.toBe('roof_plane');
  });

  it('rectangular_region_candidate with field_context maps to unknown', () => {
    // A field-context rectangle (e.g., garden patch, ground marking) — not a roof.
    const candidate = makeCandidate({
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'field_context',
      confidence: 40,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('unknown');
    expect(artifact.geometryClass).not.toBe('roof_plane');
  });

  it('rectangular_region_candidate with quality category maps to unknown', () => {
    // A quality-related rectangle — not a roof.
    const candidate = makeCandidate({
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'quality',
      confidence: 30,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('unknown');
    expect(artifact.geometryClass).not.toBe('roof_plane');
  });

  it('roof_edge_candidate still maps to roof_line (unchanged)', () => {
    // Ensure we didn't break other candidate type mappings.
    const candidate = makeCandidate({
      candidateType: 'roof_edge_candidate',
      candidateCategory: 'roof_context',
      confidence: 78,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('roof_line');
  });

  it('dominant_line_candidate still maps to roof_line (unchanged)', () => {
    const candidate = makeCandidate({
      candidateType: 'dominant_line_candidate',
      candidateCategory: 'structure_context',
      confidence: 65,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('roof_line');
  });

  it('equipment_anchor_candidate still maps to electrical_node (unchanged)', () => {
    const candidate = makeCandidate({
      candidateType: 'equipment_anchor_candidate',
      candidateCategory: 'electrical_context',
      confidence: 55,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('electrical_node');
  });

  it('wall_anchor_candidate still maps to wall_plane (unchanged)', () => {
    const candidate = makeCandidate({
      candidateType: 'wall_anchor_candidate',
      candidateCategory: 'structure_context',
      confidence: 50,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('wall_plane');
  });

  it('obstruction_candidate still maps to obstruction (unchanged)', () => {
    const candidate = makeCandidate({
      candidateType: 'obstruction_candidate',
      candidateCategory: 'roof_context',
      confidence: 45,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('obstruction');
  });

  it('edge_map_summary still maps to unknown (unchanged)', () => {
    const candidate = makeCandidate({
      candidateType: 'edge_map_summary',
      candidateCategory: 'quality',
      confidence: 20,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('unknown');
  });

  it('unknown candidateType falls back to unknown', () => {
    // A candidate type not in PIPELINE_A_CLASS_MAP should default to 'unknown'.
    const candidate = makeCandidate({
      candidateType: 'future_hypothetical_type' as OpenSourcePhotoVisionCandidate['candidateType'],
      candidateCategory: 'roof_context',
      confidence: 80,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('unknown');
  });

  it('rectangular_region_candidate roof_context promotion produces polygon geometry', () => {
    // When promoted to roof_plane, the artifact should also get polygon geometry
    // derived from the bounding box (if a region is provided).
    const candidate = makeCandidate({
      candidateType: 'rectangular_region_candidate',
      candidateCategory: 'roof_context',
      confidence: 85,
      region: {
        bbox: { x: 100, y: 200, width: 300, height: 250 },
        area: 75000,
        label: 'roof region',
      } as any,
    });

    const artifact = adaptPhotoVisionCandidate(candidate, surveyId);

    expect(artifact.geometryClass).toBe('roof_plane');
    // Roof planes should have polygon geometry for rendering
    expect(artifact.polygon).not.toBeNull();
    expect(artifact.polygon?.vertices).toHaveLength(4);
  });
});
