// ============================================================================
// lib/siteSurveys/unifiedGeometry/aerialApproval.ts
//
// Operator-approval helper (Roadmap Phase 1 — survey→canonical→planset spine).
//
// Walks a raw_evidence artifact forward to promoted_canonical, one VALIDATED
// step at a time (raw_evidence → derived_review_only → reviewed_candidate →
// promoted_canonical), reusing the existing promotion functions and their
// synthetic/mock firewalls. This is the backend of the operator "approve aerial
// geometry" action — it does NOT bypass any gate; each step is a real promotion.
//
// Pure (no DB) so the walk is unit-testable. The route persists the resulting
// artifacts + promotion records and builds/persists the CanonicalBuildingModel.
// ============================================================================

import {
  promoteToDerivedReviewOnly,
  promoteToReviewedCandidate,
  promoteToCanonical,
  type PromotionResult,
} from './promotion';
import type { UnifiedGeometryArtifact } from './types';
import type { UnifiedGeometryAuthorityState } from './authority';

const STATE_ORDER: UnifiedGeometryAuthorityState[] = [
  'raw_evidence',
  'derived_review_only',
  'reviewed_candidate',
  'promoted_canonical',
  'cad_safe',
];

export interface CanonicalWalkResult {
  /** The artifact at its final (promoted_canonical or already-higher) state. */
  finalArtifact: UnifiedGeometryArtifact;
  /** One PromotionResult per step actually taken (empty if already canonical+). */
  results: PromotionResult[];
}

/**
 * Promote an artifact forward to promoted_canonical, taking only the steps
 * needed from its current state. No-op (empty results) if the artifact is
 * already promoted_canonical or cad_safe. Each step delegates to the existing
 * promotion functions, so synthetic/mock/rejected artifacts still throw.
 */
export function promoteToCanonicalChain(
  artifact: UnifiedGeometryArtifact,
  promotedBy: string,
  options?: { notes?: string; intelligenceValidated?: boolean; intelligenceWarnings?: string[] },
): CanonicalWalkResult {
  const results: PromotionResult[] = [];
  let current = artifact;

  const steps: Array<[UnifiedGeometryAuthorityState, (a: UnifiedGeometryArtifact) => PromotionResult]> = [
    ['derived_review_only', (a) => promoteToDerivedReviewOnly(a, promotedBy, options)],
    ['reviewed_candidate', (a) => promoteToReviewedCandidate(a, promotedBy, options)],
    ['promoted_canonical', (a) => promoteToCanonical(a, promotedBy, options)],
  ];

  for (const [target, promote] of steps) {
    if (STATE_ORDER.indexOf(current.authority.state) < STATE_ORDER.indexOf(target)) {
      const r = promote(current);
      results.push(r);
      current = r.promotedArtifact;
    }
  }

  return { finalArtifact: current, results };
}
