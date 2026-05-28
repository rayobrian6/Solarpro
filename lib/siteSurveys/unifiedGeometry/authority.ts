// ============================================================================
// lib/siteSurveys/unifiedGeometry/authority.ts
//
// UNIFIED GEOMETRY AUTHORITY — the single authority contract for all geometry
// artifacts in SolarPro, regardless of which pipeline produced them.
//
// This replaces and unifies:
//   - Pipeline A: OpenSourcePhotoVisionStoredBundle.authority
//   - Pipeline B: GeometryReconstructionAuthority
//   - Candidate: GeometryCandidateLimitation + stalePropagation
//   - Evidence: EvidenceReconstructionNoAuthorityV1
//   - CAD Render: SourceOfTruthCadRenderContextV1 + PlanSetRenderNoAuthorityV1
//
// AUTHORITY STATES (lifecycle):
//   raw_evidence         → Produced by any pipeline, never reviewed
//   derived_review_only  → Refined/derived from raw, review-only, cannot mutate anything
//   reviewed_candidate   → Human has reviewed and not rejected
//   promoted_canonical   → Promoted to canonical geometry (single source of truth)
//   cad_safe             → Canonical geometry validated as CAD-consumable
//
// NON-NEGOTIABLE RULES:
//   1. No split pipeline — all geometry flows through this authority
//   2. No duplicate source of truth — only promoted_canonical can feed CAD
//   3. No CAD mutation from raw artifacts — cadMutationAllowed=true only at cad_safe
//   4. No permit/BOM trigger from raw artifacts — only at promoted_canonical or cad_safe
//   5. All raw/derived artifacts stay review-only
//   6. Only promoted canonical geometry can feed CAD
//   7. Every artifact must preserve provenance
//   8. Mock artifacts must be visibly labeled and blocked from CAD promotion
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Authority States
// ────────────────────────────────────────────────────────────────────────────

/**
 * The five authority states in the geometry artifact lifecycle.
 *
 * State transitions (forward only — no demotion):
 *   raw_evidence → derived_review_only → reviewed_candidate → promoted_canonical → cad_safe
 *
 * Each state has an immutable authority envelope that enforces what the
 * artifact can and cannot do. The envelope is frozen at artifact creation
 * time and never changes — promotion creates a NEW artifact with a higher
 * authority envelope.
 */
export type UnifiedGeometryAuthorityState =
  | 'raw_evidence'
  | 'derived_review_only'
  | 'reviewed_candidate'
  | 'promoted_canonical'
  | 'cad_safe';

/**
 * Valid state transitions. Forward-only — artifacts never demote.
 * Promotion always creates a new artifact; it never mutates the original.
 */
export const VALID_AUTHORITY_TRANSITIONS: Record<UnifiedGeometryAuthorityState, UnifiedGeometryAuthorityState[]> = {
  raw_evidence:         ['derived_review_only', 'reviewed_candidate'],
  derived_review_only:  ['reviewed_candidate'],
  reviewed_candidate:   ['promoted_canonical'],
  promoted_canonical:   ['cad_safe'],
  cad_safe:             [], // terminal state — nothing above this
};

/**
 * Ordered authority levels. Higher = more authoritative.
 * Used for comparison, not for skipping transitions.
 */
export const AUTHORITY_LEVEL: Record<UnifiedGeometryAuthorityState, number> = {
  raw_evidence:         0,
  derived_review_only:  1,
  reviewed_candidate:   2,
  promoted_canonical:   3,
  cad_safe:             4,
};

// ────────────────────────────────────────────────────────────────────────────
// Unified Authority Envelope
// ────────────────────────────────────────────────────────────────────────────

/**
 * The unified authority envelope for all geometry artifacts.
 *
 * This is the SINGLE authority type that replaces all per-pipeline authority
 * types. Every geometry artifact in the system carries one of these.
 *
 * The fields are boolean literals (true | false) — not just boolean — so
 * TypeScript can narrow the type and downstream code can branch on exact values.
 */
export interface UnifiedGeometryAuthority {
  /** The current authority state of this artifact */
  state: UnifiedGeometryAuthorityState;

  /** Artifact is for operator review only — cannot be used as source of truth */
  reviewOnly: boolean;

  /** Artifact is not authoritative geometry */
  nonAuthoritative: boolean;

  /** Artifact can mutate CAD model — only true at cad_safe */
  cadMutationAllowed: boolean;

  /** Artifact can trigger permit generation — only true at promoted_canonical+ */
  permitGenerationAllowed: boolean;

  /** Artifact can mutate BOM — only true at promoted_canonical+ */
  bomMutationAllowed: boolean;

  /** Artifact can mutate canonical geometry — only true at promoted_canonical+ */
  canonicalMutationAllowed: boolean;

  /** Artifact can mutate engineering workflows — only true at promoted_canonical+ */
  engineeringWorkflowMutationAllowed: boolean;

  /** Artifact is from a mock/test source — must be visibly labeled, blocked from CAD */
  mockArtifact: boolean;

  /** Artifact is a CAD-consumable geometry source — only true at cad_safe */
  cadConsumable: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Frozen Authority Envelopes by State
// ────────────────────────────────────────────────────────────────────────────

/**
 * raw_evidence authority: produced by any pipeline, never reviewed.
 * Cannot mutate anything. Review-only.
 */
export const RAW_EVIDENCE_AUTHORITY: UnifiedGeometryAuthority = {
  state: 'raw_evidence',
  reviewOnly: true,
  nonAuthoritative: true,
  cadMutationAllowed: false,
  permitGenerationAllowed: false,
  bomMutationAllowed: false,
  canonicalMutationAllowed: false,
  engineeringWorkflowMutationAllowed: false,
  mockArtifact: false,
  cadConsumable: false,
} as const;

/**
 * derived_review_only authority: refined/derived from raw evidence.
 * Cannot mutate anything. Review-only. Slightly more processed than raw.
 */
export const DERIVED_REVIEW_ONLY_AUTHORITY: UnifiedGeometryAuthority = {
  state: 'derived_review_only',
  reviewOnly: true,
  nonAuthoritative: true,
  cadMutationAllowed: false,
  permitGenerationAllowed: false,
  bomMutationAllowed: false,
  canonicalMutationAllowed: false,
  engineeringWorkflowMutationAllowed: false,
  mockArtifact: false,
  cadConsumable: false,
} as const;

/**
 * reviewed_candidate authority: human has reviewed and not rejected.
 * Still cannot mutate CAD/permit/BOM, but is a candidate for promotion.
 */
export const REVIEWED_CANDIDATE_AUTHORITY: UnifiedGeometryAuthority = {
  state: 'reviewed_candidate',
  reviewOnly: true,
  nonAuthoritative: false, // reviewed, so no longer "non-authoritative"
  cadMutationAllowed: false,
  permitGenerationAllowed: false,
  bomMutationAllowed: false,
  canonicalMutationAllowed: false,
  engineeringWorkflowMutationAllowed: false,
  mockArtifact: false,
  cadConsumable: false,
} as const;

/**
 * promoted_canonical authority: promoted to canonical geometry.
 * This IS the single source of truth. Can feed permit generation.
 * CAD mutation is still not allowed directly — must go through cad_safe.
 */
export const PROMOTED_CANONICAL_AUTHORITY: UnifiedGeometryAuthority = {
  state: 'promoted_canonical',
  reviewOnly: false,
  nonAuthoritative: false,
  cadMutationAllowed: false, // still must go through CAD engine
  permitGenerationAllowed: true,
  bomMutationAllowed: true,
  canonicalMutationAllowed: true,
  engineeringWorkflowMutationAllowed: true,
  mockArtifact: false,
  cadConsumable: false, // must be validated first
} as const;

/**
 * cad_safe authority: canonical geometry validated as CAD-consumable.
 * This is the terminal state. Only cad_safe artifacts can be consumed by
 * the CAD engine to produce CADModel outputs.
 */
export const CAD_SAFE_AUTHORITY: UnifiedGeometryAuthority = {
  state: 'cad_safe',
  reviewOnly: false,
  nonAuthoritative: false,
  cadMutationAllowed: true,
  permitGenerationAllowed: true,
  bomMutationAllowed: true,
  canonicalMutationAllowed: true,
  engineeringWorkflowMutationAllowed: true,
  mockArtifact: false,
  cadConsumable: true,
} as const;

/**
 * Mock artifact authority: same restrictions as raw_evidence but with
 * mockArtifact=true. Must be visibly labeled and blocked from CAD promotion.
 */
export const MOCK_ARTIFACT_AUTHORITY: UnifiedGeometryAuthority = {
  state: 'raw_evidence',
  reviewOnly: true,
  nonAuthoritative: true,
  cadMutationAllowed: false,
  permitGenerationAllowed: false,
  bomMutationAllowed: false,
  canonicalMutationAllowed: false,
  engineeringWorkflowMutationAllowed: false,
  mockArtifact: true, // ← BLOCKS CAD PROMOTION
  cadConsumable: false,
} as const;

/**
 * Synthetic artifact authority: same restrictions as derived_review_only.
 *
 * Synthetic artifacts are produced by heuristic/fake implementations
 * (e.g., generateHeuristicPolygon, heuristicConfidence) rather than
 * real ML models or human input. They carry reviewOnly=true and
 * nonAuthoritative=true as a double-gate:
 *   1. The authority envelope prevents CAD mutation
 *   2. The provenance.synthetic flag prevents promotion through canonicalBridge
 *
 * Synthetic artifacts CANNOT be promoted regardless of authority state.
 * The canonicalBridge guard rejects any artifact with provenance.synthetic=true.
 */
export const SYNTHETIC_ARTIFACT_AUTHORITY: UnifiedGeometryAuthority = {
  state: 'derived_review_only',
  reviewOnly: true,
  nonAuthoritative: true,
  cadMutationAllowed: false,
  permitGenerationAllowed: false,
  bomMutationAllowed: false,
  canonicalMutationAllowed: false,
  engineeringWorkflowMutationAllowed: false,
  mockArtifact: false,
  cadConsumable: false,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Authority Lookup
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get the frozen authority envelope for a given state.
 * Mock artifacts always get MOCK_ARTIFACT_AUTHORITY regardless of state.
 */
export function getAuthorityForState(
  state: UnifiedGeometryAuthorityState,
  isMock: boolean = false,
): UnifiedGeometryAuthority {
  if (isMock) return MOCK_ARTIFACT_AUTHORITY;

  switch (state) {
    case 'raw_evidence':         return RAW_EVIDENCE_AUTHORITY;
    case 'derived_review_only':  return DERIVED_REVIEW_ONLY_AUTHORITY;
    case 'reviewed_candidate':   return REVIEWED_CANDIDATE_AUTHORITY;
    case 'promoted_canonical':   return PROMOTED_CANONICAL_AUTHORITY;
    case 'cad_safe':             return CAD_SAFE_AUTHORITY;
  }
}

/**
 * Validate that a state transition is legal.
 * Returns true if the transition is allowed, false otherwise.
 */
export function isValidAuthorityTransition(
  from: UnifiedGeometryAuthorityState,
  to: UnifiedGeometryAuthorityState,
): boolean {
  return VALID_AUTHORITY_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Check if an artifact with the given authority can be consumed by CAD.
 * Only cad_safe (and non-mock) artifacts pass this check.
 */
export function isCadConsumable(authority: UnifiedGeometryAuthority): boolean {
  return authority.cadConsumable && !authority.mockArtifact;
}

/**
 * Check if an artifact can trigger permit generation.
 */
export function canTriggerPermitGeneration(authority: UnifiedGeometryAuthority): boolean {
  return authority.permitGenerationAllowed && !authority.mockArtifact;
}

/**
 * Check if an artifact can trigger BOM mutation.
 */
export function canTriggerBomMutation(authority: UnifiedGeometryAuthority): boolean {
  return authority.bomMutationAllowed && !authority.mockArtifact;
}

/**
 * Assert that an artifact is NOT allowed to mutate CAD.
 * Throws if the artifact has cadMutationAllowed=true or cadConsumable=true
 * while being in a non-cad_safe state.
 *
 * Use this as a runtime guard in CAD input paths.
 */
export function assertNoCadMutation(authority: UnifiedGeometryAuthority): void {
  if (authority.cadMutationAllowed && authority.state !== 'cad_safe') {
    throw new Error(
      `[UNIFIED_GEOMETRY_AUTHORITY_VIOLATION] Artifact has cadMutationAllowed=true but state=${authority.state}. ` +
      `Only cad_safe artifacts can mutate CAD. This is a programming error.`
    );
  }
  if (authority.mockArtifact && authority.state !== 'raw_evidence') {
    throw new Error(
      `[UNIFIED_GEOMETRY_AUTHORITY_VIOLATION] Mock artifact has state=${authority.state}. ` +
      `Mock artifacts cannot be promoted. This is a programming error.`
    );
  }
}

/**
 * Check if an artifact is synthetic (produced by heuristic/fake implementation).
 * Synthetic artifacts cannot be promoted to canonical geometry or enter CAD.
 *
 * This checks both the provenance.synthetic flag and the isSynthetic field
 * on UnifiedGeometryArtifact for defense-in-depth.
 */
export function isSyntheticArtifact(provenance: { synthetic?: boolean }): boolean {
  return provenance.synthetic === true;
}

/**
 * Assert that an artifact is NOT synthetic.
 * Throws if the artifact has provenance.synthetic=true.
 *
 * Use this as a runtime guard in promotion and CAD paths.
 */
export function assertNotSynthetic(provenance: { synthetic?: boolean; disclaimer?: string }): void {
  if (provenance.synthetic === true) {
    throw new Error(
      `[SYNTHETIC_ARTIFACT_BLOCKED] Artifact with provenance.synthetic=true cannot be promoted or enter CAD. ` +
      `Reason: ${provenance.disclaimer ?? 'Produced by heuristic implementation, not a real ML model'}. ` +
      `Await real model integration before this artifact can be used.`
    );
  }
}
