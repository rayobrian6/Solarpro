// ═══════════════════════════════════════════════════════════════════════════
// TWO QUESTIONS, TWO AXES.
//
//     RequirementStatus   — what do we know about the rule?
//     ProvenanceIntegrity — are we truthfully describing where it came from?
//
// They are independent, and collapsing them is what let SolarPro publish
// "NEC 2020 was entered for this project by the operator" when the value was a
// hardcoded route literal. That claim was substantively plausible (2020 is a
// real NEC edition, and the correct one in much of the country) and its
// ATTRIBUTION was false. One enum cannot hold both facts, so there are two.
//
// ── WHY MISATTRIBUTED IS WORSE THAN UNKNOWN ───────────────────────────────
// UNKNOWN says "we do not know", which a plan reviewer can act on.
// MISATTRIBUTED says "we know, because X told us" when X did not. The reviewer
// has no way to detect it, and the value being numerically correct does not
// help — a permit set is a set of claims about authority, not only numbers.
// So MISATTRIBUTED blocks permit release even when the value is right.
// ═══════════════════════════════════════════════════════════════════════════

/** Is the claimed SOURCE of a value truthful? Orthogonal to whether the value
 *  itself is known, correct or adopted. */
export type ProvenanceIntegrity =
  /** the stated source really is the source, and can be cited. */
  | 'VERIFIED'
  /** a real value from a real place, with no evidence we can cite for it. */
  | 'UNPROVENANCED'
  /** a system/model default. Honest, and NOT the same as unprovenanced: a
   *  default's origin is precisely known — it is the default. */
  | 'DEFAULTED'
  /** derived from something else rather than read from a source. */
  | 'INFERRED'
  /** ⚠ the stated source is FALSE. Never releasable, whatever the value. */
  | 'MISATTRIBUTED'
  /** two sources of comparable standing disagree about the origin. */
  | 'CONFLICT'
  | 'UNKNOWN';

/** What SUBSTANTIVE thing we know about the rule. Never carries provenance. */
export type RequirementStatus =
  | 'VERIFIED'
  | 'VERIFIED_STATEWIDE'
  | 'VERIFIED_LOCAL'
  | 'PARTIAL'
  | 'MODELED_DESIGN_BASIS'
  | 'PENDING_VERIFICATION'
  | 'NOT_ADOPTED'
  | 'NOT_APPLICABLE'
  | 'CONFLICT'
  | 'UNKNOWN';

/** Where a value physically came from — NOT who legally governs it. An operator
 *  typing an NEC year does not make the operator the authority. */
export type RequirementOrigin =
  | 'operator' | 'state_dataset' | 'local_ordinance' | 'model_code'
  | 'system_default' | 'legacy_record' | 'discovered_source'
  | 'solarpro_policy' | 'manufacturer' | 'utility' | 'professional' | 'unknown';

/** Who legally governs the value — NOT where we happened to read it. */
export type RequirementAuthorityLevel =
  | 'federal' | 'state' | 'county' | 'municipality' | 'town_mcd'
  | 'independent_city' | 'consolidated_government' | 'fire_district'
  | 'utility' | 'professional' | 'manufacturer' | 'model_code'
  | 'solarpro_policy' | 'unknown';

export interface ReleaseSemantics {
  usableForDesign: boolean;
  usableForDesignReview: boolean;
  usableForPermitClaim: boolean;
  blocksPermitRelease: boolean;
}

/**
 * THE HARD INVARIANT. A material permit-dependent fact whose attribution is
 * false may never become a permit claim, and blocks release — even if the value
 * is numerically correct.
 *
 * Applied as a FILTER over whatever a caller proposes, so release semantics
 * cannot be hand-written more permissively than the provenance allows.
 */
export function applyProvenanceInvariants(
  proposed: ReleaseSemantics,
  provenanceIntegrity: ProvenanceIntegrity,
  opts: { releaseCritical?: boolean } = {},
): ReleaseSemantics {
  if (provenanceIntegrity === 'MISATTRIBUTED') {
    return {
      // Design may continue: the DESIGN is not what is false, the CLAIM is.
      usableForDesign: proposed.usableForDesign,
      // A design review that repeats the false attribution is not reviewable.
      usableForDesignReview: false,
      usableForPermitClaim: false,
      blocksPermitRelease: true,
    };
  }
  if (provenanceIntegrity === 'CONFLICT') {
    return { ...proposed, usableForPermitClaim: false, blocksPermitRelease: true };
  }
  if (provenanceIntegrity === 'UNKNOWN' || provenanceIntegrity === 'UNPROVENANCED') {
    // Honest ignorance blocks a permit CLAIM but not the design, and only holds
    // release when the fact is release-critical. Not every unknown is a blocker.
    return {
      ...proposed,
      usableForPermitClaim: false,
      blocksPermitRelease: opts.releaseCritical === true ? true : proposed.blocksPermitRelease,
    };
  }
  // DEFAULTED / INFERRED are honest but are not evidence about a jurisdiction.
  if (provenanceIntegrity === 'DEFAULTED' || provenanceIntegrity === 'INFERRED') {
    return { ...proposed, usableForPermitClaim: false };
  }
  return proposed;
}

// ── NO-UPGRADE INVARIANTS ─────────────────────────────────────────────────
// A value does not become better evidence by being copied, stored, renamed or
// re-read. Every promotion below requires NEW evidence, and these functions
// exist so that requirement is expressed in code rather than in a comment.

const PROVENANCE_RANK: Record<ProvenanceIntegrity, number> = {
  UNKNOWN: 0, MISATTRIBUTED: 0, CONFLICT: 0,
  UNPROVENANCED: 1, DEFAULTED: 1, INFERRED: 1,
  VERIFIED: 2,
};

/** True when moving `from` → `to` would claim more than the evidence supports. */
export function isIllegalProvenanceUpgrade(
  from: ProvenanceIntegrity, to: ProvenanceIntegrity, hasNewEvidence: boolean,
): boolean {
  if (hasNewEvidence) return false;
  return PROVENANCE_RANK[to] > PROVENANCE_RANK[from];
}

const STATUS_RANK: Record<RequirementStatus, number> = {
  UNKNOWN: 0, CONFLICT: 0, NOT_APPLICABLE: 0, NOT_ADOPTED: 0,
  PENDING_VERIFICATION: 1, MODELED_DESIGN_BASIS: 1, PARTIAL: 1,
  VERIFIED_STATEWIDE: 2,
  VERIFIED_LOCAL: 3, VERIFIED: 3,
};

/**
 * True when a status promotion is unsupported. The specific promotions the
 * campaign forbids all fall out of this:
 *   MODELED_DESIGN_BASIS → VERIFIED_LOCAL   (model code → AHJ adopted)
 *   VERIFIED_STATEWIDE   → VERIFIED_LOCAL   (state table → local ordinance)
 *   UNKNOWN              → anything verified
 */
export function isIllegalStatusUpgrade(
  from: RequirementStatus, to: RequirementStatus, hasNewEvidence: boolean,
): boolean {
  if (hasNewEvidence) return false;
  return STATUS_RANK[to] > STATUS_RANK[from];
}

/** An origin never confers authority by itself. An operator typing a value does
 *  not make the operator a legal authority; a state dataset holding a local
 *  field does not prove local adoption. */
export function authorityImpliedByOrigin(origin: RequirementOrigin): RequirementAuthorityLevel {
  switch (origin) {
    case 'model_code': return 'model_code';
    case 'solarpro_policy': return 'solarpro_policy';
    case 'manufacturer': return 'manufacturer';
    case 'utility': return 'utility';
    case 'professional': return 'professional';
    // Deliberately NOT mapped to an authority: reading a value somewhere is not
    // the same as that place governing it.
    case 'operator': case 'state_dataset': case 'local_ordinance':
    case 'system_default': case 'legacy_record': case 'discovered_source':
    default: return 'unknown';
  }
}
