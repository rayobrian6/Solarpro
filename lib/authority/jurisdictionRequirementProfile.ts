// ═══════════════════════════════════════════════════════════════════════════
// THE SCOPE-AWARE JURISDICTION REQUIREMENT PROFILE.
//
// One government does not necessarily govern every scope. A building permit may
// be municipal while electrical inspection is a state division and fire review
// belongs to a district whose boundaries do not follow municipal limits. The
// old model forced all of that through one flat `AHJ` string — which is why
// `buildingAhj`, `electricalAhj` and `fireAhj` were all assigned from the same
// variable and had zero production consumers.
//
// ── THREE SEPARATIONS THIS FILE EXISTS TO KEEP ────────────────────────────
// 1. PROFESSIONAL. SolarPro's review policy, the project's engineering need,
//    and a legal seal requirement are three facts, not one `peRequired`
//    boolean. SolarPro requiring review says NOTHING about whether a seal is
//    legally required — that was the false claim on every planset until N24.
// 2. FIRE. The design basis and the adoption status are separate. A modeled
//    36" pathway is usable and honest; it is not evidence of what the AHJ
//    adopted, and the two must never be stored in one field.
// 3. ORIGIN vs AUTHORITY, inherited from GovernedRequirement — where a value
//    came from is not who governs it.
// ═══════════════════════════════════════════════════════════════════════════

import type { GovernedRequirement } from './governedRequirement';
import type { RequirementAuthorityLevel } from './provenanceIntegrity';

/** A permitting scope. Each may bind to a DIFFERENT government. */
export type PermitScope =
  | 'building' | 'structural' | 'electrical' | 'fire' | 'zoning'
  | 'mechanical' | 'plumbing' | 'administrative';

/** Which government administers one scope, and on what evidence. */
export interface AuthorityBinding {
  /** stable legal-government identity — never a name. */
  legalGovernmentEntityId?: string;
  authorityLevel: RequirementAuthorityLevel;
  departmentName?: string;
  /** the delegation rule that selected it, cited by id. */
  delegationRuleId?: string;
  /** whether we hold a governed permitting record for this entity, or only know
   *  which government it is. The distinction the whole campaign turns on. */
  recordStatus: 'GOVERNED' | 'IDENTITY_ONLY' | 'MISSING' | 'UNKNOWN';
}

export interface CodeAdoption {
  edition: string | null;
  standard: string;
}

export interface ProfessionalRequirementProfile {
  /** SolarPro's OWN release policy. A real authority over SolarPro's product,
   *  and never law. Origin and authority are both `solarpro_policy`. */
  solarProReviewPolicy: GovernedRequirement<string>;
  /** whether THIS design needs engineering on its merits — a structural
   *  question, independent of any jurisdiction rule. */
  projectEngineeringNeed?: GovernedRequirement<boolean>;
  /** whether a licensed signature/seal is LEGALLY required here. Independent of
   *  both of the above, and UNKNOWN for every jurisdiction SolarPro holds. */
  legalSignatureSealRequirement?: GovernedRequirement<boolean | null>;
}

export interface FireRequirementProfile {
  /** what SolarPro designs to. May be a model-code basis. */
  designBasis: {
    accessPathwayWidthIn?: GovernedRequirement<number>;
    ridgeSetbackIn?: GovernedRequirement<number>;
    hipValleySetbackIn?: GovernedRequirement<number>;
    eaveAccess?: GovernedRequirement<string>;
    coverageExceptionThreshold?: GovernedRequirement<number>;
  };
  /** what the governing authority has actually adopted. Separate on purpose:
   *  a design basis is not an adoption, and storing them together is how a
   *  model-code constant comes to be printed as a local requirement. */
  adoption: {
    fireCodeEdition?: GovernedRequirement<CodeAdoption>;
    localAmendments?: GovernedRequirement<string>[];
    /** the fire authority may be a district, not the building AHJ. */
    authority?: AuthorityBinding;
  };
}

export interface JurisdictionRequirementProfile {
  /** the government this profile is FOR — a stable identity, never a name. */
  legalGovernmentIdentityId: string;

  /** who administers each scope. They may differ, and often do. */
  authorities: Partial<Record<PermitScope, AuthorityBinding>>;

  professional: ProfessionalRequirementProfile;

  codes: {
    nec?: GovernedRequirement<CodeAdoption>;
    ibc?: GovernedRequirement<CodeAdoption>;
    irc?: GovernedRequirement<CodeAdoption>;
    ifc?: GovernedRequirement<CodeAdoption>;
  };

  amendments: {
    electrical?: GovernedRequirement<string>[];
    building?: GovernedRequirement<string>[];
    fire?: GovernedRequirement<string>[];
  };

  electrical: {
    /** conditional by construction — a wiring method's admissibility depends on
     *  occupancy, location, wet/dry and concealment, so each carries its own
     *  applicability rather than collapsing to a boolean. */
    wiringMethods?: GovernedRequirement<string>[];
    raceways?: GovernedRequirement<string>[];
    disconnects?: GovernedRequirement<string>[];
    supplySideConnections?: GovernedRequirement<string>[];
    groundingBonding?: GovernedRequirement<string>[];
    rapidShutdown?: GovernedRequirement<string>[];
    labeling?: GovernedRequirement<string>[];
  };

  fire: FireRequirementProfile;

  building: {
    structuralReview?: GovernedRequirement<boolean>;
    designCriteria?: GovernedRequirement<string>[];
  };

  zoning: {
    setbacks?: GovernedRequirement<string>[];
    height?: GovernedRequirement<string>;
    specialUse?: GovernedRequirement<string>;
  };

  administrative: {
    permitDepartment?: GovernedRequirement<string>;
    submissionRequirements?: GovernedRequirement<string>[];
    forms?: GovernedRequirement<string>[];
    inspections?: GovernedRequirement<string>[];
  };
}

/** Every requirement in a profile, flattened — for release gating and coverage
 *  counting without each caller re-walking the shape. */
export function allRequirements(
  p: JurisdictionRequirementProfile,
): GovernedRequirement<unknown>[] {
  const out: GovernedRequirement<unknown>[] = [];
  const push = (v: unknown) => {
    if (!v) return;
    if (Array.isArray(v)) { for (const x of v) push(x); return; }
    if (typeof v === 'object' && 'provenanceIntegrity' in (v as object)) {
      out.push(v as GovernedRequirement<unknown>);
      return;
    }
    for (const x of Object.values(v as Record<string, unknown>)) push(x);
  };
  push(p.professional); push(p.codes); push(p.amendments);
  push(p.electrical); push(p.fire.designBasis); push(p.fire.adoption);
  push(p.building); push(p.zoning); push(p.administrative);
  return out;
}

/** Scopes bound to a government we hold no governed permitting record for —
 *  the input to discovery, and the honest denominator for coverage. */
export function scopesMissingGovernedRecord(
  p: JurisdictionRequirementProfile,
): PermitScope[] {
  return (Object.entries(p.authorities) as Array<[PermitScope, AuthorityBinding]>)
    .filter(([, b]) => b.recordStatus !== 'GOVERNED')
    .map(([s]) => s);
}
