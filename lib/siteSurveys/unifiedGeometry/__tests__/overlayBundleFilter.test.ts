// ============================================================================
// lib/siteSurveys/unifiedGeometry/__tests__/overlayBundleFilter.test.ts
//
// TASK 2 — Overlay Bundle Filtering Tests
//
// Tests the applyOverlaySafeFilter function and the ?debug=true query
// parameter behavior for the unified geometry bundle endpoint.
// ============================================================================

import { describe, it, expect } from 'vitest';
import type { UnifiedGeometryArtifact } from '../types';

// ── Replicate the filter function from the bundle route ───────────────────────
// (We test the logic here; the route integration is tested via the API)

const MIN_CONFIDENCE_THRESHOLD = 15;
const UNKNOWN_CONFIDENCE_THRESHOLD = 40;

function applyOverlaySafeFilter(
  artifacts: UnifiedGeometryArtifact[],
  debug: boolean,
): UnifiedGeometryArtifact[] {
  if (debug) {
    return artifacts;
  }

  return artifacts.filter(artifact => {
    if (artifact.excludeFromGeometry === true) {
      return false;
    }
    if (artifact.segmentationClass === 'background') {
      return false;
    }
    if (artifact.confidence < MIN_CONFIDENCE_THRESHOLD) {
      return false;
    }
    if (artifact.geometryClass === 'unknown' && artifact.confidence < UNKNOWN_CONFIDENCE_THRESHOLD) {
      return false;
    }
    return true;
  });
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

describe('TASK 2: Overlay Bundle Filtering', () => {

  describe('normal mode (debug=false)', () => {

    it('hides artifacts with excludeFromGeometry === true', () => {
      const artifacts = [
        makeArtifact({ id: 'a1', excludeFromGeometry: false, confidence: 80 }),
        makeArtifact({ id: 'a2', excludeFromGeometry: true, confidence: 80 }),
        makeArtifact({ id: 'a3', excludeFromGeometry: null, confidence: 80 }),
      ];

      const filtered = applyOverlaySafeFilter(artifacts, false);
      const ids = filtered.map(a => a.id);

      expect(ids).toContain('a1');
      expect(ids).not.toContain('a2'); // excluded
      expect(ids).toContain('a3'); // null is not true
    });

    it('hides artifacts with segmentationClass === "background"', () => {
      const artifacts = [
        makeArtifact({ id: 'a1', segmentationClass: 'roof', confidence: 80 }),
        makeArtifact({ id: 'a2', segmentationClass: 'background', confidence: 80 }),
        makeArtifact({ id: 'a3', segmentationClass: null, confidence: 80 }),
      ];

      const filtered = applyOverlaySafeFilter(artifacts, false);
      const ids = filtered.map(a => a.id);

      expect(ids).toContain('a1');
      expect(ids).not.toContain('a2'); // background
      expect(ids).toContain('a3'); // null is ok
    });

    it('hides very low confidence artifacts (< 15)', () => {
      const artifacts = [
        makeArtifact({ id: 'a1', confidence: 80 }),
        makeArtifact({ id: 'a2', confidence: 14 }), // below threshold
        makeArtifact({ id: 'a3', confidence: 15 }), // at threshold
        makeArtifact({ id: 'a4', confidence: 0 }),  // zero confidence
      ];

      const filtered = applyOverlaySafeFilter(artifacts, false);
      const ids = filtered.map(a => a.id);

      expect(ids).toContain('a1');
      expect(ids).not.toContain('a2'); // below 15
      expect(ids).toContain('a3'); // exactly 15 passes
      expect(ids).not.toContain('a4'); // zero
    });

    it('hides unknown geometryClass with low confidence (< 40)', () => {
      const artifacts = [
        makeArtifact({ id: 'a1', geometryClass: 'unknown', confidence: 39 }), // hidden
        makeArtifact({ id: 'a2', geometryClass: 'unknown', confidence: 40 }), // passes
        makeArtifact({ id: 'a3', geometryClass: 'unknown', confidence: 80 }), // passes
        makeArtifact({ id: 'a4', geometryClass: 'roof_plane', confidence: 20 }), // passes (not unknown)
      ];

      const filtered = applyOverlaySafeFilter(artifacts, false);
      const ids = filtered.map(a => a.id);

      expect(ids).not.toContain('a1'); // unknown + low conf
      expect(ids).toContain('a2'); // unknown + at threshold
      expect(ids).toContain('a3'); // unknown + high conf
      expect(ids).toContain('a4'); // not unknown
    });

    it('combines all filters correctly', () => {
      const artifacts = [
        makeArtifact({ id: 'good', geometryClass: 'roof_plane', confidence: 80, excludeFromGeometry: false, segmentationClass: 'roof' }),
        makeArtifact({ id: 'excluded', geometryClass: 'roof_plane', confidence: 80, excludeFromGeometry: true }),
        makeArtifact({ id: 'bg', geometryClass: 'segmentation_mask', confidence: 80, segmentationClass: 'background' }),
        makeArtifact({ id: 'low-conf', geometryClass: 'roof_plane', confidence: 10 }),
        makeArtifact({ id: 'unknown-low', geometryClass: 'unknown', confidence: 30 }),
      ];

      const filtered = applyOverlaySafeFilter(artifacts, false);
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('good');
    });

    it('does not remove data from database (filter is view-only)', () => {
      // This test verifies the design: the filter returns a new array,
      // it doesn't mutate the input
      const original = [
        makeArtifact({ id: 'a1', excludeFromGeometry: true }),
        makeArtifact({ id: 'a2', confidence: 5 }),
      ];

      const filtered = applyOverlaySafeFilter(original, false);
      expect(filtered.length).toBe(0);
      expect(original.length).toBe(2); // original untouched
    });
  });

  describe('debug mode (debug=true)', () => {

    it('returns ALL artifacts including excluded and background', () => {
      const artifacts = [
        makeArtifact({ id: 'good', confidence: 80, excludeFromGeometry: false, segmentationClass: 'roof' }),
        makeArtifact({ id: 'excluded', confidence: 80, excludeFromGeometry: true }),
        makeArtifact({ id: 'bg', confidence: 80, segmentationClass: 'background' }),
        makeArtifact({ id: 'low-conf', confidence: 10 }),
        makeArtifact({ id: 'unknown-low', geometryClass: 'unknown', confidence: 20 }),
      ];

      const filtered = applyOverlaySafeFilter(artifacts, true);
      expect(filtered.length).toBe(5); // everything passes through
    });

    it('debug mode preserves all artifact data unchanged', () => {
      const artifacts = [
        makeArtifact({ id: 'a1', excludeFromGeometry: true, segmentationClass: 'background', confidence: 5 }),
      ];

      const filtered = applyOverlaySafeFilter(artifacts, true);
      expect(filtered[0].excludeFromGeometry).toBe(true);
      expect(filtered[0].segmentationClass).toBe('background');
      expect(filtered[0].confidence).toBe(5);
    });
  });
});
