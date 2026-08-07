// lib/documents/types.ts
// W4 §8 — Canonical manufacturer/authority document registry TYPES.
//
// Mirrors the manufacturer_document_registry table (migration 113). These types
// are pure (no DB import) so they can be consumed by engines, tests, and the
// resolver alike.

/** Every §8 document class. The registry must be able to hold ALL of these. */
export const DOCUMENT_CLASSES = [
  'module_datasheet',
  'inverter_datasheet',
  'microinverter_datasheet',
  'combiner_documentation',
  'racking_installation_manual',
  'structural_pe_letter',
  'evaluation_report',
  'ul_listing',
  'utility_requirements',
  'ahj_code_adoption',
  // FRAMING-AUTHORITY GATE (2026-07-23) — the ONLY document classes that can
  // construct a FramingCapacityAuthority (existing framing capacity). A generic
  // BCSI screening table is NOT one of these.
  'truss_design_drawing',
  'manufacturer_structural_calc',
  'stamped_structural_analysis',
  // BAR §2 (2026-07-25) — the ONLY document class that can construct a VERIFIED
  // EnvironmentalLoadAuthority (design wind speed / exposure / risk category /
  // ground snow load): an archived ASCE 7 Hazard-Tool report, an AHJ climate
  // ordinance/table, or an equivalent authoritative climate-hazard dataset
  // extract. An operator-typed wind/snow number is NOT one of these.
  'climate_hazard_dataset',
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

export const VERIFICATION_STATES = ['unverified', 'in_review', 'verified', 'rejected'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const DOCUMENT_STATUSES = ['current', 'superseded', 'draft', 'withdrawn'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Structured extracted engineering claims. `structural` carries the W4 §9
 * applicability field set required to clear the RT-MINI blockers. Other claim
 * shapes (electrical, listing, etc.) can be added over time; the resolver only
 * requires the fields relevant to the requested criteria.
 */
export interface ExtractedEngineeringClaims {
  /** Free-form claim key/values (e.g. { maxSystemVoltageV: 600 }). */
  values?: Record<string, unknown>;
  /** ═══ CMDA — THE MODULE APPLICABILITY CLAIMS ═══════════════════════════
   *
   *  THE ONLY source that may establish that a datasheet covers the SELECTED
   *  module. Nothing else qualifies: not the marketing title, not the filename,
   *  not `equipment_model_applicability` substring matching, not a static
   *  asset's "385-405W" title, and not `verification_state='verified'` — a
   *  verified document is AUTHENTIC, which is a different question from whether
   *  it covers this 400 W variant.
   *
   *  These are the document's OWN statements, read off the document and recorded
   *  with the location they were read from. Nothing here may be back-filled from
   *  the equipment catalogue or from the selection being evaluated: that would
   *  make the document agree with the selection by construction.
   *
   *  Stored in the existing `extracted_claims` JSON column (migration 113) —
   *  this shape carries no database change.
   */
  module?: {
    /** the manufacturer the document itself names. */
    manufacturer?: string | null;
    /** e.g. 'Q.PEAK DUO BLK ML-G10+'. */
    productFamily?: string | null;
    /** stable catalogue ids the document covers. THE primary identity. */
    equipmentIdsCovered?: string[];
    /** full model strings the document covers. Supporting evidence only. */
    modelsCovered?: string[];
    /** the per-variant table the document prints. The strongest claim shape. */
    variantsCovered?: Array<{ model?: string | null; watts?: number | null; equipmentId?: string | null }>;
    /** discrete wattages the document covers. */
    wattagesCovered?: number[];
    /** an explicit, document-stated range (NOT parsed from a title). */
    explicitWattageRange?: { minWatts: number; maxWatts: number } | null;
    /** true only when the document actually prints the electrical + mechanical
     *  specifications for the covered variants. A brochure sets this false. */
    electricalMechanicalSpecificationsPresent?: boolean;
    /** WHERE in the document the coverage was read. Required — a claim with no
     *  location is unauditable and cannot clear the requirement. */
    evidence?: {
      page?: number | null;
      table?: string | null;
      row?: string | null;
      column?: string | null;
      section?: string | null;
    } | null;
    /** the human-readable basis a reviewer can check the claim against. */
    applicabilityBasis?: string | null;
  };
  /** §9 structural applicability claims — required for a racking capacity clear. */
  structural?: {
    exactModel?: string | null;
    fastenerModel?: string | null;
    fastenerCount?: number | null;
    substrate?: string | null;
    rafterDeckCondition?: string | null;
    embedmentIn?: number | null;
    railLFootAssembly?: string | null;
    /** Must resolve to an ASD allowable (e.g. "ASD allowable"). */
    loadBasis?: string | null;
    adjustmentFactors?: Record<string, unknown> | null;
    jurisdiction?: string | null;
    asdAllowableLbs?: number | null;
    /** true only when the doc actually STATES a structural (uplift) capacity.
     *  A flashing / water-resistance report sets this false. */
    hasStructuralCapacityClaim?: boolean;
  };
  /** FRAMING-AUTHORITY GATE §9 framing-capacity applicability claims — required
   *  for an existing-framing capacity clear (truss drawing / mfr calc / stamped). */
  framing?: {
    /** the exact project/building this document is applicable to. */
    projectApplicability?: string | null;
    memberOrTrussIdentity?: string | null;
    designLoads?: string | null;
    allowableCapacities?: string | null;
    bearingConditions?: string | null;
    deflectionLimits?: string | null;
    engineerOrManufacturerVerification?: string | null;
    /** true only when the doc actually STATES a framing (member/truss) capacity.
     *  A roof-covering / flashing report sets this false. */
    hasFramingCapacityClaim?: boolean;
  };
  /** BAR §2 environmental (climate-hazard) claims — required to construct a
   *  VERIFIED EnvironmentalLoadAuthority. Every field is the archived source's
   *  OWN statement; nothing here may be back-filled from an operator entry. */
  environmental?: {
    /** e.g. 'ASCE 7 Hazard Tool', 'AHJ climate ordinance table' */
    dataset?: string | null;
    /** the exact project/building/jurisdiction the extract was pulled for. */
    projectApplicability?: string | null;
    windSpeedMph?: number | null;
    groundSnowPsf?: number | null;
    exposureCategory?: string | null;
    riskCategory?: string | null;
    lat?: number | null;
    lng?: number | null;
    addressUsed?: string | null;
    /** when the hazard lookup was performed. */
    lookupTimestampIso?: string | null;
    /** an EXPLICIT currency review — no automatic staleness rule exists for an
     *  archived climate-hazard extract, so verification requires this. */
    currencyConfirmedAtIso?: string | null;
    coversWindSpeed?: boolean;
    coversSnowLoad?: boolean;
    coversExposureRisk?: boolean;
  };
}

/** A single registry document record (canonical, versioned). */
export interface RegistryDocument {
  id: string;
  documentClass: DocumentClass;
  manufacturerOrIssuer: string;
  equipmentId: string | null;
  equipmentModelApplicability: string | null;
  title: string;
  revision: string | null;
  documentDate: string | null;
  archivedFileIdentity: string | null;
  archivedInRepo: boolean;
  sha256: string | null;
  source: string | null;
  jurisdictionBoundary: string | null;
  /** D4 — STABLE legal-AHJ identity (ahj_registry record id). THE key for
   *  jurisdiction applicability; jurisdictionBoundary is the display name.
   *  NULL on rows written before migration 119, and optional on the type so a
   *  pre-119 read model still satisfies it. `rowToDocument` always populates it. */
  jurisdictionAuthorityId?: string | null;
  applicabilityNotes: string | null;
  status: DocumentStatus;
  supersedesId: string | null;
  supersededById: string | null;
  extractedClaims: ExtractedEngineeringClaims | null;
  verificationState: VerificationState;
  reviewer: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Criteria for findVerifiedDocument. Only VERIFIED + CURRENT documents that
 *  cover the exact equipment (+ optional installation condition) resolve. */
export interface DocumentResolverCriteria {
  documentClass: DocumentClass | DocumentClass[];
  equipmentId?: string | null;
  equipmentModel?: string | null;
  /** When set, the document's structural.jurisdiction must match. */
  jurisdiction?: string | null;
  /** When set, require structural claims (racking capacity path). */
  requireStructuralCapacity?: boolean;
  /** When set, require framing-capacity claims (framing-authority gate path). */
  requireFramingCapacity?: boolean;
  /** BAR §2 — when set, require climate-hazard (environmental) claims covering
   *  wind + snow + exposure/risk with an explicit currency review. */
  requireEnvironmentalHazard?: boolean;
  /** the exact project/building applicability the framing document must cover. */
  projectApplicabilityKey?: string | null;
  /** CMDA — the SELECTED module wattage the document must be proven to cover.
   *  Supplied alongside `requireModuleDatasheetCoverage`; on its own it filters
   *  nothing, because a wattage is a question, not a permission. */
  selectedWatts?: number | null;
  /** CMDA — when set, a module_datasheet must carry structured module claims
   *  that cover the selected product AND the selected wattage, with an evidence
   *  location. Model-substring matching is explicitly NOT sufficient under this
   *  flag: `equipment_model_applicability LIKE '%<model>%'` is how a loosely
   *  named row came to speak for a module it had never been checked against. */
  requireModuleDatasheetCoverage?: boolean;
}

export function isDocumentClass(x: unknown): x is DocumentClass {
  return typeof x === 'string' && (DOCUMENT_CLASSES as readonly string[]).includes(x);
}
export function isVerificationState(x: unknown): x is VerificationState {
  return typeof x === 'string' && (VERIFICATION_STATES as readonly string[]).includes(x);
}
export function isDocumentStatus(x: unknown): x is DocumentStatus {
  return typeof x === 'string' && (DOCUMENT_STATUSES as readonly string[]).includes(x);
}
