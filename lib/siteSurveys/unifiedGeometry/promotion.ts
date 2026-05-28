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
  AUTHORITY_LEVEL,
  VALID_AUTHORITY_TRANSITIONS,
} from './authority';
import type { UnifiedGeometryAuthorityState, UnifiedGeometryAuthority } from './authority';
import type {
  UnifiedGeometryArtifact,
  GeometryPromotionRecord,
} from './types';

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
