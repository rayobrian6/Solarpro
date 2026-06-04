// ============================================================================
// lib/siteSurveys/unifiedGeometry/promotion.ts
//
// Promotion Workflow — review/promotion bridge functions for transitioning
// artifacts through the unified authority states.
//
// State transitions (forward only):
//   raw_evidence → derived_review_only → reviewed_candidate → promoted_canonical → cad_safe
//
// NON-NEGOTIABLE:
//   1. Promotion always creates a NEW artifact — it never mutates the original
//   2. The original artifact remains at its current authority state forever
//   3. Mock artifacts CANNOT be promoted (blocked at every transition)
//   4. Every promotion creates a GeometryPromotionRecord for audit trail
//   5. Only promoted_canonical+ artifacts can feed the CanonicalBuildingModel
//   6. Only cad_safe artifacts can be consumed by the CAD engine
// ============================================================================

import { v4 as uuid } from 'uuid';
import {
  isValidAuthorityTransition,
  isCadConsumable,
  getAuthorityForState,
  RAW_EVIDENCE_AUTHORITY,
  DERIVED_REVIEW_ONLY_AUTHORITY,
  REVIEWED_CANDIDATE_AUTHORITY,
  PROMOTED_CANONICAL_AUTHORITY,
  CAD_SAFE_AUTHORITY,
  MOCK_ARTIFACT_AUTHORITY,
  SYNTHETIC_ARTIFACT_AUTHORITY,
  isSyntheticArtifact,
  AUTHORITY_LEVEL,
  VALID_AUTHORITY_TRANSITIONS,
} from './authority';
import type { UnifiedGeometryAuthorityState, UnifiedGeometryAuthority } from './authority';
import type {
  UnifiedGeometryArtifact,
  GeometryPromotionRecord,
} from './types';

// ---------------------------------------------------------------------------
// Phase 0 — Canonical Promotion Quality Gate (WP-4)
// ---------------------------------------------------------------------------

/**
 * Check if Phase 0 canonical geometry gate is enabled.
 * When enabled, artifacts without polygon or bbox geometry are blocked
 * from canonical promotion — they cannot feed the CanonicalBuildingModel.
 *
 * This prevents the degraded path in buildCanonicalRoofPlane() from
 * creating planes with degradedNoGeometry:true that flow into CAD.
 *
 * Controlled by PHASE0_CANONICAL_GEOMETRY_GATE environment variable.
 */
export function isPhase0CanonicalGeometryGateEnabled(): boolean {
  const val = process.env.PHASE0_CANONICAL_GEOMETRY_GATE ?? '';
  return val === 'true' || val === '1';
}

/**
 * Check if Phase 0 contradiction-aware promotion validation is enabled.
 * When enabled, artifacts with depth-class contradictions of severity
 * 'moderate' or 'major' are blocked from canonical promotion.
 *
 * Controlled by PHASE0_CONTRADICTION_PROMOTION_GATE environment variable.
 */
export function isPhase0ContradictionPromotionGateEnabled(): boolean {
  const val = process.env.PHASE0_CONTRADICTION_PROMOTION_GATE ?? '';
  return val === 'true' || val === '1';
}

/**
 * Check if Phase 0 minimum confidence threshold for canonical promotion is enabled.
 * When enabled, artifacts with confidence below the minimum threshold
 * (default 50) are blocked from canonical promotion.
 *
 * Controlled by PHASE0_CANONICAL_MIN_CONFIDENCE environment variable.
 * The threshold value is read from PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD
 * (default 50 if not set).
 */
export function isPhase0CanonicalMinConfidenceEnabled(): boolean {
  const val = process.env.PHASE0_CANONICAL_MIN_CONFIDENCE ?? '';
  return val === 'true' || val === '1';
}

/**
 * Get the minimum confidence threshold for canonical promotion.
 * Reads from PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD env var,
 * defaults to 50 if not set or invalid.
 */
export function getCanonicalMinConfidenceThreshold(): number {
  const val = process.env.PHASE0_CANONICAL_MIN_CONFIDENCE_THRESHOLD ?? '';
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 50;
}

// ─── Promotion Result ───────────────────────────────────────────────────────

/**
 * Result of a promotion action.
 * Contains both the new promoted artifact and the audit trail record.
 */
export interface PromotionResult {
  /** The newly created artifact at the higher authority state */
  promotedArtifact: UnifiedGeometryArtifact;
  /** The immutable audit trail record */
  promotionRecord: GeometryPromotionRecord;
  /** The original artifact (unchanged) */
  originalArtifact: UnifiedGeometryArtifact;
}

// ─── Promotion Error ────────────────────────────────────────────────────────

export class PromotionError extends Error {
  constructor(
    message: string,
    public readonly artifactId: string,
    public readonly fromState: UnifiedGeometryAuthorityState,
    public readonly toState: UnifiedGeometryAuthorityState,
  ) {
    super(`[PROMOTION_ERROR] ${message}`);
    this.name = 'PromotionError';
  }
}

// ─── Promotion Functions ────────────────────────────────────────────────────

/**
 * Promote an artifact from one authority state to the next.
 *
 * This is the core promotion function. It:
 *   1. Validates that the transition is legal
 *   2. Blocks mock artifacts from promotion
 *   3. Creates a new artifact at the higher authority state
 *   4. Creates an immutable GeometryPromotionRecord
 *   5. Returns both the new artifact and the audit record
 *
 * The original artifact is NEVER modified.
 */
export function promoteArtifact(
  artifact: UnifiedGeometryArtifact,
  targetState: UnifiedGeometryAuthorityState,
  promotedBy: string,
  options: {
    notes?: string;
    intelligenceValidated?: boolean;
    intelligenceWarnings?: string[];
  } = {},
): PromotionResult {
  const fromState = artifact.authority.state;

  // Guard: Mock artifacts cannot be promoted
  if (artifact.authority.mockArtifact) {
    throw new PromotionError(
      `Mock artifacts cannot be promoted. Artifact '${artifact.id}' is a mock artifact.`,
      artifact.id,
      fromState,
      targetState,
    );
  }

  // Guard: Synthetic artifacts cannot be promoted
  if (artifact.isSynthetic || isSyntheticArtifact(artifact.provenance)) {
    throw new PromotionError(
      `Synthetic artifacts cannot be promoted. Artifact '${artifact.id}' was produced by heuristic implementation, not a real ML model.`,
      artifact.id,
      fromState,
      targetState,
    );
  }

  // Guard: Validate transition is legal
  if (!isValidAuthorityTransition(fromState, targetState)) {
    throw new PromotionError(
      `Invalid authority transition: ${fromState} → ${targetState}. ` +
      `Valid transitions from ${fromState}: [${VALID_AUTHORITY_TRANSITIONS[fromState]?.join(', ') ?? 'none'}]`,
      artifact.id,
      fromState,
      targetState,
    );
  }

  // Guard: Cannot skip states (e.g., raw_evidence → promoted_canonical)
  const fromLevel = AUTHORITY_LEVEL[fromState];
  const toLevel = AUTHORITY_LEVEL[targetState];
  if (toLevel !== fromLevel + 1) {
    throw new PromotionError(
      `Cannot skip authority states: ${fromState} → ${targetState} skips ${String(toLevel - fromLevel - 1)} state(s). Promote one step at a time.`,
      artifact.id,
      fromState,
      targetState,
    );
  }

  // Guard: Rejected artifacts cannot be promoted
  if (artifact.reviewState === 'rejected') {
    throw new PromotionError(
      `Rejected artifacts cannot be promoted. Artifact '${artifact.id}' has reviewState='rejected'.`,
      artifact.id,
      fromState,
      targetState,
    );
  }

  // Create the new authority envelope
  const newAuthority: UnifiedGeometryAuthority = getAuthorityForState(targetState);

  // Create the promoted artifact (new ID, new authority, updated provenance)
  const promotedArtifact: UnifiedGeometryArtifact = {
    ...artifact,
    id: uuid(), // NEW ID — never reuse the original
    authority: newAuthority,
    provenance: {
      ...artifact.provenance,
      derivedFromArtifactIds: [...artifact.provenance.derivedFromArtifactIds, artifact.id],
      reviewedBy: promotedBy,
      reviewedAt: new Date().toISOString(),
    },
    reviewState: 'accepted',
    priority: artifact.priority,
  };

  // Create the immutable promotion record
  const promotionRecord: GeometryPromotionRecord = {
    id: uuid(),
    artifactId: promotedArtifact.id,
    fromState,
    toState: targetState,
    promotedBy,
    promotedAt: new Date().toISOString(),
    notes: options.notes ?? null,
    intelligenceValidated: options.intelligenceValidated ?? false,
    intelligenceWarnings: options.intelligenceWarnings ?? [],
  };

  return {
    promotedArtifact,
    promotionRecord,
    originalArtifact: artifact,
  };
}

// ─── Convenience Promotion Functions ────────────────────────────────────────

/**
 * Promote raw_evidence → derived_review_only.
 * Used when a raw artifact has been refined/derived into a review-only form.
 */
export function promoteToDerivedReviewOnly(
  artifact: UnifiedGeometryArtifact,
  promotedBy: string,
  options?: { notes?: string },
): PromotionResult {
  return promoteArtifact(artifact, 'derived_review_only', promotedBy, options);
}

/**
 * Promote derived_review_only → reviewed_candidate.
 * Used when a human operator has reviewed a derived artifact and not rejected it.
 */
export function promoteToReviewedCandidate(
  artifact: UnifiedGeometryArtifact,
  promotedBy: string,
  options?: { notes?: string; intelligenceValidated?: boolean; intelligenceWarnings?: string[] },
): PromotionResult {
  return promoteArtifact(artifact, 'reviewed_candidate', promotedBy, options);
}

/**
 * Promote reviewed_candidate → promoted_canonical.
 * Used when a reviewed artifact is promoted to canonical geometry.
 * This is the key transition — only promoted_canonical artifacts can feed
 * the CanonicalBuildingModel and trigger permit/BOM generation.
 */
export function promoteToCanonical(
  artifact: UnifiedGeometryArtifact,
  promotedBy: string,
  options?: { notes?: string; intelligenceValidated?: boolean; intelligenceWarnings?: string[] },
): PromotionResult {
  return promoteArtifact(artifact, 'promoted_canonical', promotedBy, options);
}

/**
 * Promote promoted_canonical → cad_safe.
 * Used when canonical geometry has been validated as CAD-consumable.
 * Only cad_safe artifacts can be consumed by the CAD engine.
 */
export function promoteToCadSafe(
  artifact: UnifiedGeometryArtifact,
  promotedBy: string,
  options?: { notes?: string; intelligenceValidated?: boolean; intelligenceWarnings?: string[] },
): PromotionResult {
  return promoteArtifact(artifact, 'cad_safe', promotedBy, options);
}

// ─── Batch Promotion ────────────────────────────────────────────────────────

/**
 * Result of promoting multiple artifacts.
 */
export interface BatchPromotionResult {
  successful: PromotionResult[];
  failed: Array<{ artifactId: string; error: PromotionError }>;
}

/**
 * Promote multiple artifacts to the same target state.
 * Errors are collected, not thrown — all artifacts are attempted.
 */
export function promoteArtifacts(
  artifacts: UnifiedGeometryArtifact[],
  targetState: UnifiedGeometryAuthorityState,
  promotedBy: string,
  options?: { notes?: string; intelligenceValidated?: boolean; intelligenceWarnings?: string[] },
): BatchPromotionResult {
  const successful: PromotionResult[] = [];
  const failed: Array<{ artifactId: string; error: PromotionError }> = [];

  for (const artifact of artifacts) {
    try {
      const result = promoteArtifact(artifact, targetState, promotedBy, options);
      successful.push(result);
    } catch (err) {
      if (err instanceof PromotionError) {
        failed.push({ artifactId: artifact.id, error: err });
      } else {
        failed.push({
          artifactId: artifact.id,
          error: new PromotionError(
            `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
            artifact.id,
            artifact.authority.state,
            targetState,
          ),
        });
      }
    }
  }

  return { successful, failed };
}

// ─── Review Action ──────────────────────────────────────────────────────────

/**
 * Review an artifact without promoting it.
 * This sets the reviewState to 'accepted' or 'rejected' and records the reviewer.
 * The authority state does NOT change — review and promotion are separate concerns.
 */
export function reviewArtifact(
  artifact: UnifiedGeometryArtifact,
  reviewedBy: string,
  decision: 'accepted' | 'rejected',
  notes?: string,
): UnifiedGeometryArtifact {
  // Cannot review mock artifacts for promotion purposes
  if (artifact.authority.mockArtifact && decision === 'accepted') {
    throw new PromotionError(
      `Cannot accept a mock artifact for promotion. Artifact '${artifact.id}' is a mock.`,
      artifact.id,
      artifact.authority.state,
      artifact.authority.state,
    );
  }

  // Cannot accept synthetic artifacts for promotion purposes
  if ((artifact.isSynthetic || isSyntheticArtifact(artifact.provenance)) && decision === 'accepted') {
    throw new PromotionError(
      `Cannot accept a synthetic artifact for promotion. Artifact '${artifact.id}' was produced by heuristic implementation, not a real ML model.`,
      artifact.id,
      artifact.authority.state,
      artifact.authority.state,
    );
  }

  return {
    ...artifact,
    reviewState: decision,
    reviewNotes: notes ?? null,
    provenance: {
      ...artifact.provenance,
      reviewedBy,
      reviewedAt: new Date().toISOString(),
    },
  };
}

// ─── Guard Functions ────────────────────────────────────────────────────────

/**
 * Assert that an artifact can be consumed by the CAD engine.
 * Throws if the artifact is not cad_safe.
 *
 * Use this as a runtime guard at every CAD input point.
 */
export function assertCadConsumable(artifact: UnifiedGeometryArtifact): void {
  if (!isCadConsumable(artifact.authority)) {
    throw new Error(
      `[CAD_INPUT_VIOLATION] Artifact '${artifact.id}' (authority=${artifact.authority.state}) ` +
      `is not CAD-consumable. Only cad_safe artifacts can feed the CAD engine. ` +
      `mockArtifact=${artifact.authority.mockArtifact}`,
    );
  }
}

/**
 * Assert that an artifact can feed the CanonicalBuildingModel.
 * Only promoted_canonical or cad_safe artifacts pass this check.
 */
export function assertCanonicalEligible(artifact: UnifiedGeometryArtifact): void {
  const level = AUTHORITY_LEVEL[artifact.authority.state];
  if (level < AUTHORITY_LEVEL.promoted_canonical) {
    throw new Error(
      `[CANONICAL_MODEL_VIOLATION] Artifact '${artifact.id}' (authority=${artifact.authority.state}) ` +
      `is not eligible for the CanonicalBuildingModel. Only promoted_canonical or cad_safe ` +
      `artifacts can feed the canonical model.`,
    );
  }
  if (artifact.authority.mockArtifact) {
    throw new Error(
      `[CANONICAL_MODEL_VIOLATION] Artifact '${artifact.id}' is a mock artifact. ` +
      `Mock artifacts cannot feed the CanonicalBuildingModel.`,
    );
  }
  if (artifact.isSynthetic || isSyntheticArtifact(artifact.provenance)) {
    throw new Error(
      `[CANONICAL_MODEL_VIOLATION] Artifact '${artifact.id}' is a synthetic artifact. ` +
      `Synthetic artifacts (produced by heuristic implementations) cannot feed the CanonicalBuildingModel. ` +
      `Await real model integration.`,
    );
  }

  // Phase 0 (P0-4.1): Geometry presence check — block artifacts with no geometry
  // from entering the canonical model. The canonical builder's degraded path
  // (degradedNoGeometry:true) creates useless planes that flow into CAD.
  // When this gate is active, those artifacts are rejected at the eligibility
  // check, making the degraded path unreachable.
  if (isPhase0CanonicalGeometryGateEnabled()) {
    const hasPolygon = artifact.polygon !== null && artifact.polygon !== undefined;
    const hasBbox = artifact.bbox !== null && artifact.bbox !== undefined;
    const hasLineSegment = artifact.lineSegment !== null && artifact.lineSegment !== undefined;
    const hasCenter = artifact.center !== null && artifact.center !== undefined;

    // Planes (roof_plane, wall_plane, consensus_plane) MUST have polygon or bbox
    if (artifact.geometryClass === 'roof_plane' || artifact.geometryClass === 'wall_plane' || artifact.geometryClass === 'consensus_plane') {
      if (!hasPolygon && !hasBbox) {
        throw new Error(
          `[CANONICAL_MODEL_VIOLATION] Artifact '${artifact.id}' (${artifact.geometryClass}) ` +
          `has no geometry (neither polygon nor bbox). Artifacts without geometry ` +
          `cannot feed the CanonicalBuildingModel — they produce degraded planes ` +
          `with fabricated geometry that contaminates CAD/permit output. ` +
          `[Phase 0 geometry gate active]`,
        );
      }
    }

    // Lines MUST have a line segment
    if (artifact.geometryClass === 'roof_line' && !hasLineSegment) {
      throw new Error(
        `[CANONICAL_MODEL_VIOLATION] Artifact '${artifact.id}' (roof_line) ` +
        `has no line segment geometry. Roof line artifacts without geometry ` +
        `cannot feed the CanonicalBuildingModel. [Phase 0 geometry gate active]`,
      );
    }

    // Obstructions and electrical nodes need at least a center point
    if ((artifact.geometryClass === 'obstruction' || artifact.geometryClass === 'electrical_node') && !hasCenter && !hasBbox) {
      throw new Error(
        `[CANONICAL_MODEL_VIOLATION] Artifact '${artifact.id}' (${artifact.geometryClass}) ` +
        `has no center point or bbox geometry. Point-based artifacts without ` +
        `geometry cannot feed the CanonicalBuildingModel. [Phase 0 geometry gate active]`,
      );
    }
  }
}

/**
 * Check if an artifact can be promoted (without throwing).
 */
export function canPromote(
  artifact: UnifiedGeometryArtifact,
  targetState: UnifiedGeometryAuthorityState,
): { canPromote: boolean; reason?: string } {
  if (artifact.authority.mockArtifact) {
    return { canPromote: false, reason: 'Mock artifacts cannot be promoted' };
  }

  if (artifact.isSynthetic || isSyntheticArtifact(artifact.provenance)) {
    return { canPromote: false, reason: 'Synthetic artifacts cannot be promoted — produced by heuristic implementation, not a real ML model' };
  }

  if (artifact.reviewState === 'rejected') {
    return { canPromote: false, reason: 'Rejected artifacts cannot be promoted' };
  }

  if (!isValidAuthorityTransition(artifact.authority.state, targetState)) {
    return { canPromote: false, reason: `Invalid transition: ${artifact.authority.state} → ${targetState}` };
  }

  const fromLevel = AUTHORITY_LEVEL[artifact.authority.state];
  const toLevel = AUTHORITY_LEVEL[targetState];
  if (toLevel !== fromLevel + 1) {
    return { canPromote: false, reason: `Cannot skip states: must promote one step at a time` };
  }

  return { canPromote: true };
}
