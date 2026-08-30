// ═══════════════════════════════════════════════════════════════════════════
// THE CANONICAL CONTRACT FOR A JURISDICTION-DEPENDENT FACT.
//
// Every material permit claim must be able to answer, in one object:
//
//     what is the requirement?          value
//     what do we know about it?         status
//     is our story about it true?       provenanceIntegrity
//     where did the value come from?    origin
//     who legally governs it?           authority
//     when does it apply?               applicability
//     what proves it?                   evidence
//     has it been locally amended?      amendmentStatus
//     what may we do with it?           releaseSemantics
//
// ── WHY ORIGIN AND AUTHORITY ARE BOTH HERE ────────────────────────────────
// They answer different questions and they routinely differ. An operator typing
// an NEC year has origin=operator and authority=unknown. A state dataset has
// origin=state_dataset and an authority that must be established separately —
// reading a value out of a table is not the table governing it.
//
// ── WHY APPLICABILITY IS NOT OPTIONAL IN SPIRIT ───────────────────────────
// The NM-B case: "is Romex allowed" has no answer. The real rule is conditional
// on occupancy, location, wet/dry, concealed/exposed and the code edition. A
// boolean would have to lie about at least one of those, so the contract
// carries conditions rather than collapsing them.
// ═══════════════════════════════════════════════════════════════════════════

import {
  applyProvenanceInvariants,
  type ProvenanceIntegrity, type RequirementStatus, type RequirementOrigin,
  type RequirementAuthorityLevel, type ReleaseSemantics,
} from './provenanceIntegrity';

export type { ProvenanceIntegrity, RequirementStatus, RequirementOrigin, RequirementAuthorityLevel };

export interface RequirementEvidence {
  sourceType: string;
  sourceTitle: string;
  sourceUrl?: string;
  documentId?: string;
  section?: string;
  page?: string;
  adoptedDate?: string;
  effectiveDate?: string;
  retrievedAt?: string;
}

export interface RequirementConflict {
  sourceA: string;
  sourceB: string;
  description: string;
}

export type AmendmentStatus =
  | 'VERIFIED_NONE'      // checked, and there is no local amendment
  | 'VERIFIED_PRESENT'   // checked, and one exists
  | 'NOT_CHECKED'        // ⚠ honest: nobody looked
  | 'UNKNOWN';

export interface GovernedRequirement<T> {
  value: T;

  /** what we know about the rule. */
  status: RequirementStatus;
  /** whether our account of where it came from is true. Orthogonal to status. */
  provenanceIntegrity: ProvenanceIntegrity;

  origin: { type: RequirementOrigin; sourceId?: string };

  authority: {
    entityId?: string;
    authorityLevel: RequirementAuthorityLevel;
    scope: string;
    departmentName?: string;
  };

  /** the conditions under which the value applies. A rule without its
   *  conditions is a different rule. */
  applicability: {
    geography?: string;
    occupancy?: string;
    constructionType?: string;
    systemType?: string;
    installationLocation?: string;
    wetOrDry?: string;
    concealedOrExposed?: string;
    thresholds?: Record<string, string | number | boolean>;
    conditions?: string[];
  };

  evidence: RequirementEvidence[];
  amendmentStatus?: AmendmentStatus;
  releaseSemantics: ReleaseSemantics;
  conflicts?: RequirementConflict[];
}

/**
 * Build a requirement with the invariants ENFORCED rather than trusted.
 *
 * Release semantics are not accepted as given: they are filtered through the
 * provenance rules, so a caller cannot construct a MISATTRIBUTED fact that
 * claims to be permit-ready. Evidence is also checked against the claim — a
 * VERIFIED provenance with an empty evidence array is a contradiction, and this
 * refuses it rather than storing it.
 */
export function governedRequirement<T>(input: {
  value: T;
  status: RequirementStatus;
  provenanceIntegrity: ProvenanceIntegrity;
  origin: { type: RequirementOrigin; sourceId?: string };
  authority: GovernedRequirement<T>['authority'];
  applicability?: GovernedRequirement<T>['applicability'];
  evidence?: RequirementEvidence[];
  amendmentStatus?: AmendmentStatus;
  releaseSemantics?: Partial<ReleaseSemantics>;
  releaseCritical?: boolean;
  conflicts?: RequirementConflict[];
}): GovernedRequirement<T> {
  const evidence = input.evidence ?? [];

  // A VERIFIED provenance means "the stated source really is the source, and can
  // be cited". With nothing to cite, that is not verification — it is a claim.
  // The one exception is a self-describing origin: the model code IS the source
  // of a model-code value, and SolarPro policy IS the source of its own policy.
  const SELF_EVIDENT: RequirementOrigin[] = ['model_code', 'solarpro_policy', 'system_default'];
  if (input.provenanceIntegrity === 'VERIFIED'
    && evidence.length === 0
    && !SELF_EVIDENT.includes(input.origin.type)) {
    throw new Error(
      `refusing to build a VERIFIED requirement with no evidence (origin=${input.origin.type}, `
      + `scope=${input.authority.scope}). Verification requires something citable; without it the `
      + 'honest classifications are UNPROVENANCED or DEFAULTED.');
  }

  const proposed: ReleaseSemantics = {
    usableForDesign: input.releaseSemantics?.usableForDesign ?? true,
    usableForDesignReview: input.releaseSemantics?.usableForDesignReview ?? true,
    usableForPermitClaim: input.releaseSemantics?.usableForPermitClaim ?? false,
    blocksPermitRelease: input.releaseSemantics?.blocksPermitRelease ?? false,
  };

  return {
    value: input.value,
    status: input.status,
    provenanceIntegrity: input.provenanceIntegrity,
    origin: input.origin,
    authority: input.authority,
    applicability: input.applicability ?? {},
    evidence,
    amendmentStatus: input.amendmentStatus ?? 'NOT_CHECKED',
    releaseSemantics: applyProvenanceInvariants(
      proposed, input.provenanceIntegrity, { releaseCritical: input.releaseCritical }),
    conflicts: input.conflicts,
  };
}

/** May this requirement appear on a permit set as a statement about authority? */
export function isPermitClaimable(r: GovernedRequirement<unknown>): boolean {
  return r.releaseSemantics.usableForPermitClaim;
}

/** Facts that must be resolved before a package is permit-released. */
export function blockingRequirements(
  rs: GovernedRequirement<unknown>[],
): GovernedRequirement<unknown>[] {
  return rs.filter(r => r.releaseSemantics.blocksPermitRelease);
}
