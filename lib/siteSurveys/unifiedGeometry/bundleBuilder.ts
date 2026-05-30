// ============================================================================
// lib/siteSurveys/unifiedGeometry/bundleBuilder.ts
//
// Unified Geometry Evidence Bundle Builder — the bridge between Pipeline A
// (Photo Vision) and Pipeline B (Geometry Reconstruction).
//
// This builder consumes artifacts from BOTH pipelines, adapts them into
// UnifiedGeometryArtifact instances, and assembles a cross-referenced
// UnifiedGeometryEvidenceBundle.
//
// DOWNSTREAM CONSUMERS (review workflow, CAD engine, promotion system) consume
// THIS bundle — they never touch individual pipeline types directly.
//
// NON-NEGOTIABLE:
//   - All adapted artifacts start at raw_evidence authority
//   - Mock artifacts are flagged and blocked from CAD promotion
//   - Cross-references are built from provenance data
//   - The bundle itself carries the minimum authority of its contents
// ============================================================================

import { v4 as uuid } from 'uuid';
import type {
  OpenSourcePhotoVisionCandidate,
} from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';
import type {
  GeometryReconstructionArtifact,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import type { GeometryCandidateSignal } from '@/lib/assistedEvidenceSources/geometryCandidateTypes';
import type {
  UnifiedGeometryArtifact,
  UnifiedGeometryEvidenceBundle,
  UnifiedGeometryClass,
  GeometryIntelligenceSummary,
} from './types';
import type { UnifiedGeometryAuthorityState } from './authority';
import {
  RAW_EVIDENCE_AUTHORITY,
  AUTHORITY_LEVEL,
} from './authority';
import type { UnifiedGeometryAuthority } from './authority';
import {
  adaptPhotoVisionBundle,
  adaptGeometryReconBundle,
  adaptGeometryCandidateSignal,
} from './pipelineAdapters';

// ─── Builder Configuration ──────────────────────────────────────────────────

export interface BundleBuilderConfig {
  /** Survey ID for the bundle */
  surveyId: string;
  /** Whether to include mock/test artifacts */
  includeMocks: boolean;
  /** Minimum confidence threshold (0-100). Artifacts below this are excluded. */
  minConfidence: number;
  /** Maximum number of artifacts per bundle (prevents unbounded growth) */
  maxArtifacts: number;
}

const DEFAULT_CONFIG: BundleBuilderConfig = {
  surveyId: '',
  includeMocks: true,
  minConfidence: 0,
  maxArtifacts: 10_000,
};

// ─── Bundle Builder ─────────────────────────────────────────────────────────

/**
 * Builder for UnifiedGeometryEvidenceBundle.
 *
 * Usage:
 *   const bundle = new BundleBuilder({ surveyId: 'survey-123' })
 *     .addPhotoVisionCandidates(pipelineACandidates)
 *     .addGeometryReconArtifacts(pipelineBArtifacts)
 *     .addCandidateSignals(signals, fileId, toolName, toolVersion, runHash)
 *     .build();
 */
export class BundleBuilder {
  private readonly config: BundleBuilderConfig;
  private readonly artifacts: UnifiedGeometryArtifact[] = [];

  constructor(config: Partial<BundleBuilderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!this.config.surveyId) {
      throw new Error('[BundleBuilder] surveyId is required');
    }
  }

  /**
   * Add Pipeline A (Photo Vision) candidates to the bundle.
   * Each candidate is adapted to a UnifiedGeometryArtifact at raw_evidence authority.
   */
  addPhotoVisionCandidates(candidates: OpenSourcePhotoVisionCandidate[]): this {
    const adapted = adaptPhotoVisionBundle(candidates, this.config.surveyId);
    this.pushArtifacts(adapted);
    return this;
  }

  /**
   * Add Pipeline B (Geometry Reconstruction) artifacts to the bundle.
   * Each artifact is adapted to a UnifiedGeometryArtifact at raw_evidence authority.
   */
  addGeometryReconArtifacts(artifacts: GeometryReconstructionArtifact[]): this {
    const adapted = adaptGeometryReconBundle(artifacts, this.config.surveyId);
    this.pushArtifacts(adapted);
    return this;
  }

  /**
   * Add Geometry Candidate Signals (from the boundary-constrained candidate runtime).
   * These carry very limited geometry — coarse review hints only.
   */
  addCandidateSignals(
    signals: GeometryCandidateSignal[],
    sourceFileId: string,
    toolName: string,
    toolVersion: string,
    runHash: string,
  ): this {
    const adapted = signals.map(s =>
      adaptGeometryCandidateSignal(s, this.config.surveyId, sourceFileId, toolName, toolVersion, runHash),
    );
    this.pushArtifacts(adapted);
    return this;
  }

  /**
   * Add pre-built UnifiedGeometryArtifact instances directly.
   * Useful for adding artifacts that have already been adapted or promoted.
   */
  addUnifiedArtifacts(artifacts: UnifiedGeometryArtifact[]): this {
    this.pushArtifacts(artifacts);
    return this;
  }

  /**
   * Build the final UnifiedGeometryEvidenceBundle.
   *
   * Applies filtering (minConfidence, mock exclusion), builds cross-references,
   * and computes summary statistics.
   */
  build(): UnifiedGeometryEvidenceBundle {
    // Filter artifacts
    let filtered = this.artifacts;

    if (!this.config.includeMocks) {
      filtered = filtered.filter(a => !a.authority.mockArtifact);
    }

    if (this.config.minConfidence > 0) {
      filtered = filtered.filter(a => a.confidence >= this.config.minConfidence);
    }

    // Enforce max artifacts (keep highest confidence)
    if (filtered.length > this.config.maxArtifacts) {
      filtered.sort((a, b) => b.confidence - a.confidence);
      filtered = filtered.slice(0, this.config.maxArtifacts);
    }

    // Build cross-references
    const artifactsBySourceFile = buildSourceFileIndex(filtered);
    const artifactsByGeometryClass = buildGeometryClassIndex(filtered);
    const artifactsByAuthorityState = buildAuthorityStateIndex(filtered);

    // Compute pipeline counts
    const pipelineCounts = computePipelineCounts(filtered);

    // Compute review state counts
    const reviewStateCounts = computeReviewStateCounts(filtered);

    // Bundle authority = minimum authority of all artifacts
    // (If any artifact is raw_evidence, the whole bundle is raw_evidence)
    const bundleAuthority = computeBundleAuthority(filtered);

    return {
      schemaVersion: 'unified_geometry_evidence_bundle_v1',
      surveyId: this.config.surveyId,
      artifacts: filtered,
      artifactsBySourceFile,
      artifactsByGeometryClass,
      artifactsByAuthorityState,
      pipelineCounts,
      reviewStateCounts,
      intelligenceSummary: null, // populated later by intelligence report
      authority: bundleAuthority,
      createdAt: new Date().toISOString(),
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private pushArtifacts(artifacts: UnifiedGeometryArtifact[]): void {
    for (const artifact of artifacts) {
      // Validate survey ID consistency
      if (artifact.surveyId !== this.config.surveyId) {
        throw new Error(
          `[BundleBuilder] Artifact surveyId '${artifact.surveyId}' does not match bundle surveyId '${this.config.surveyId}'. ` +
          `This is a programming error — artifacts must belong to the same survey.`,
        );
      }

      // Reject artifacts that somehow have cad_safe authority but came through
      // the builder (they should only exist after promotion)
      if (artifact.authority.state === 'cad_safe' && !artifact.authority.mockArtifact) {
        throw new Error(
          `[BundleBuilder] Artifact '${artifact.id}' has cad_safe authority but was added through the builder. ` +
          `cad_safe artifacts should only exist after the promotion workflow. This is a programming error.`,
        );
      }

      this.artifacts.push(artifact);
    }
  }
}

// ─── Cross-Reference Builders ───────────────────────────────────────────────

/**
 * Build an index of artifact IDs grouped by source file ID.
 * Source file IDs come from artifact.provenance.sourceFileIds.
 */
function buildSourceFileIndex(artifacts: UnifiedGeometryArtifact[]): Record<string, string[]> {
  const index: Record<string, string[]> = {};

  for (const artifact of artifacts) {
    for (const fileId of artifact.provenance.sourceFileIds) {
      if (!index[fileId]) {
        index[fileId] = [];
      }
      index[fileId].push(artifact.id);
    }
  }

  return index;
}

/**
 * Build an index of artifact IDs grouped by geometry class.
 */
function buildGeometryClassIndex(artifacts: UnifiedGeometryArtifact[]): Record<UnifiedGeometryClass, string[]> {
  const index: Record<string, string[]> = {};

  // Initialize all known geometry classes
  const allClasses: UnifiedGeometryClass[] = [
    'roof_plane', 'wall_plane', 'roof_line', 'obstruction', 'electrical_node',
    'segmentation_mask', 'depth_map', 'point_cloud', 'vanishing_point',
    'consensus_plane', 'ground_plane', 'unknown',
  ];
  for (const cls of allClasses) {
    index[cls] = [];
  }

  for (const artifact of artifacts) {
    if (!index[artifact.geometryClass]) {
      index[artifact.geometryClass] = [];
    }
    index[artifact.geometryClass].push(artifact.id);
  }

  return index as Record<UnifiedGeometryClass, string[]>;
}

/**
 * Build an index of artifact IDs grouped by authority state.
 */
function buildAuthorityStateIndex(artifacts: UnifiedGeometryArtifact[]): Record<UnifiedGeometryAuthorityState, string[]> {
  const index: Record<string, string[]> = {
    raw_evidence: [],
    derived_review_only: [],
    reviewed_candidate: [],
    promoted_canonical: [],
    cad_safe: [],
  };

  for (const artifact of artifacts) {
    const state = artifact.authority.state;
    if (index[state]) {
      index[state].push(artifact.id);
    }
  }

  return index as Record<UnifiedGeometryAuthorityState, string[]>;
}

// ─── Statistics ─────────────────────────────────────────────────────────────

function computePipelineCounts(artifacts: UnifiedGeometryArtifact[]): UnifiedGeometryEvidenceBundle['pipelineCounts'] {
  const counts = { photoVision: 0, geometryRecon: 0, googleSolarApi: 0, obstructionRegistration: 0, manual: 0, merged: 0, mock: 0 };

  for (const artifact of artifacts) {
    switch (artifact.provenance.sourcePipeline) {
      case 'photo_vision':            counts.photoVision++; break;
      case 'geometry_recon':          counts.geometryRecon++; break;
      case 'google_solar_api':        counts.googleSolarApi++; break;
      case 'obstruction_registration': counts.obstructionRegistration++; break;
      case 'manual':                   counts.manual++; break;
      case 'merged':                   counts.merged++; break;
      case 'mock':                     counts.mock++; break;
    }
  }

  return counts;
}

function computeReviewStateCounts(artifacts: UnifiedGeometryArtifact[]): UnifiedGeometryEvidenceBundle['reviewStateCounts'] {
  const counts = { reviewRequired: 0, accepted: 0, rejected: 0 };

  for (const artifact of artifacts) {
    switch (artifact.reviewState) {
      case 'review_required': counts.reviewRequired++; break;
      case 'accepted':        counts.accepted++; break;
      case 'rejected':        counts.rejected++; break;
    }
  }

  return counts;
}

/**
 * Compute the bundle authority.
 * The bundle authority is the MINIMUM authority of all its artifacts.
 * If any artifact is raw_evidence, the whole bundle is raw_evidence.
 * An empty bundle gets raw_evidence authority (safest default).
 */
function computeBundleAuthority(artifacts: UnifiedGeometryArtifact[]): UnifiedGeometryAuthority {
  if (artifacts.length === 0) {
    return { ...RAW_EVIDENCE_AUTHORITY };
  }

  let minLevel = Infinity;
  let minAuthority: UnifiedGeometryAuthority = { ...RAW_EVIDENCE_AUTHORITY };

  for (const artifact of artifacts) {
    const level = AUTHORITY_LEVEL[artifact.authority.state];
    if (level < minLevel) {
      minLevel = level;
      minAuthority = artifact.authority;
    }
  }

  return { ...minAuthority };
}

// ─── Convenience Factory ────────────────────────────────────────────────────

/**
 * Build a unified evidence bundle from both pipeline outputs in one call.
 *
 * This is the primary entry point for the UI/API layer to get a unified view
 * of all geometry evidence for a survey.
 */
export function buildUnifiedEvidenceBundle(
  surveyId: string,
  photoVisionCandidates: OpenSourcePhotoVisionCandidate[],
  geometryReconArtifacts: GeometryReconstructionArtifact[],
  config: Partial<BundleBuilderConfig> = {},
): UnifiedGeometryEvidenceBundle {
  return new BundleBuilder({ ...config, surveyId })
    .addPhotoVisionCandidates(photoVisionCandidates)
    .addGeometryReconArtifacts(geometryReconArtifacts)
    .build();
}
