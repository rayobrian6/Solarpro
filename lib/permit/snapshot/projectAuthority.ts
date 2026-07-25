// ═══════════════════════════════════════════════════════════════════════════
// W4 §3 / §12 — CANONICAL PROJECT + COVER AUTHORITY, and the ISSUE-STATE MACHINE.
//
// THE single source for every project-facing value a cover / title-block /
// certification renderer prints: project name, customer, address, parcel/APN,
// AHJ, utility, system type, capacities, equipment summary, designer,
// contractor, engineer-review status, ISSUE STATUS, revision history, sheet
// index, governing-codes reference and general notes. Renderers read this record
// THROUGH projectAuthorityProjection.ts and hold no vendor default, no stale
// equipment, no default engineer name, no independent sheet index and no generic
// code edition of their own. Missing authority is honestly null (⇒ PENDING on
// the sheet), never fabricated.
//
// HONESTY CONTRACT (W4 §3/§12, binding):
//   • No vendor / EOR defaults ("SolarPro Engineering", "IronRidge XR100",
//     "SolarPro Engineering Engine") — a missing designer/contractor stays null.
//   • The SHEET INDEX is the ACTUAL generated manifest (buildSheetManifest),
//     passed in at snapshot-build time — never a hardcoded PERMIT_SHEET_INDEX.
//   • Governing codes are a REFERENCE to snapshot.codeAuthority (single source);
//     this record carries NO NEC/IBC/IRC/IFC/ASCE edition literal (V11).
//   • The ISSUE STATE is DERIVED (deriveIssueState) from permitReadiness blockers
//     by domain + the engineering-review record; REVIEWED / ISSUED FOR PERMIT
//     require a review that references the CURRENT snapshot digest. A digest
//     change invalidates a prior approval unless a new review covers that digest.
// ═══════════════════════════════════════════════════════════════════════════
import type { Provenance } from './types';

export const PROJECT_AUTHORITY_SCHEMA_VERSION = '1.0.0';

// ── §12 issue-state machine ──────────────────────────────────────────────────

/** The EXACT project issue states (Ray, W4 §12). No other value is legal. */
export const PROJECT_ISSUE_STATES = [
  'DESIGN DRAFT',
  'PENDING ELECTRICAL REVIEW',
  'PENDING STRUCTURAL REVIEW',
  'PENDING ENGINEERING REVIEW',
  'REVIEWED',
  'PERMIT-READY',
  'ISSUED FOR PERMIT',
  'REVISED',
] as const;
export type ProjectIssueState = (typeof PROJECT_ISSUE_STATES)[number];

/** Which authority domain a permit-readiness blocker belongs to. `review` is the
 *  engineering-review lane (not an authority gap); `other` is any unclassified
 *  authority gap and routes to the ENGINEERING catch-all. */
export type BlockerDomain =
  | 'electrical' | 'structural' | 'code' | 'equipment' | 'document' | 'review' | 'other';

/** Explicit code → domain map for the blockers build.ts and the structural /
 *  code / document authorities emit. Prefix fallbacks below catch new codes. */
const KNOWN_BLOCKER_DOMAIN: Record<string, BlockerDomain> = {
  'ROUTE-LENGTH-ESTIMATE': 'electrical',
  'FEEDER-RACEWAY-AUTHORITY': 'electrical',
  'RACEWAY-BONDING-AUTHORITY': 'electrical',
  'EQUIPMENT-IDENTITY-CONFLICT': 'equipment',
  'CODE-AUTHORITY-INCOMPLETE': 'code',
  'PROJECT-AUTHORITY-UNVERIFIED': 'document',
  'ENGINEERING-REVIEW-PENDING': 'review',
  'FRAMING-AUTHORITY-UNVERIFIED': 'structural',   // canonical (framing-authority gate)
  'STRUCTURAL-FRAMING-UNVERIFIED': 'structural',  // legacy alias (mapped for back-compat)
  'STRUCTURAL-UTILIZATION-EXCEEDED': 'structural',
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED': 'structural',
  'RACKING-CAPACITY-APPLICABILITY-GAP': 'structural',
  'DIRECT-MOUNT-GEOMETRY-MISSING': 'structural',
  // W10 (RP-D) — codes that do not lead with a domain prefix, mapped explicitly
  // so the review-status registry groups them correctly (never a generic 'other'
  // for a known-domain gap) and the empty-sheets default is avoided.
  'PENDING-RACKING-ASSEMBLY-SELECTION': 'structural',
  'FASTENER-ASSEMBLY-UNVERIFIED': 'structural',        // §13 — own fastener-authority code
  'EQUIPMENT-DOCUMENT-APPLICABILITY': 'document',       // §12 — product-version applicability gap
  'CONDUIT-FILL-PENDING': 'electrical',
  'TAP-CONDUCTOR-LENGTH-PENDING': 'electrical',
  'QCABLE-PROCUREMENT-INSUFFICIENT': 'electrical',   // §Q — procurement deficit gate
  'PROJECT-NAME-NONPRODUCTION': 'document',
  'DESIGNER-OF-RECORD-MISSING': 'document',
  'MODULE-EXACT-DATASHEET-PENDING': 'document',
  'EQUIPMENT-DOCUMENT-UNVERIFIED': 'document',
};

/** Classify one blocker code into its authority domain (pure). */
export function classifyBlockerDomain(code: string): BlockerDomain {
  const c = (code ?? '').toUpperCase();
  if (KNOWN_BLOCKER_DOMAIN[c]) return KNOWN_BLOCKER_DOMAIN[c];
  if (/REVIEW-PENDING/.test(c)) return 'review';
  if (/^CODE-/.test(c)) return 'code';
  if (/^(EQUIP|EQUIPMENT-)/.test(c)) return 'equipment';
  if (/^(DOC|DOCUMENT|MANUFACTURER-DOC|MFR-DOC)/.test(c)) return 'document';
  if (/^(STRUCT|RACK|ATTACH|DIRECT-MOUNT|FRAM|RAFTER|FENCE|PILE|WIND|SNOW)/.test(c)) return 'structural';
  if (/^(ROUTE|FEEDER|RACEWAY|CONDUCT|ELEC|SLD|INTERCONNECT|OCPD|BACKFEED)/.test(c)) return 'electrical';
  return 'other';
}

export interface IssueStateReview {
  /** the snapshot digest the engineering review actually covered */
  reviewedDigest: string;
}

export interface IssueStateContext {
  /** the design has real modules (an empty design is DESIGN DRAFT). */
  hasDesign: boolean;
  /** permitReadiness.blockers (authority gaps + the review marker). */
  blockers: { code: string }[];
  /** the approved engineering-review record (null ⇒ none). */
  review: IssueStateReview | null;
  /** the CURRENT snapshot digest (what the sheets carry). */
  currentDigest: string;
  /** the ISSUED-FOR-PERMIT gate result (all preconditions pass). */
  gatePasses: boolean;
}

export interface IssueStateResult {
  state: ProjectIssueState;
  authorityGapDomains: BlockerDomain[];   // distinct authority-gap domains (excl. 'review')
  reviewCoversCurrentDigest: boolean;
  reviewStale: boolean;                   // a review exists but for a different digest
  reason: string;
}

/** §12 — DERIVE the issue state (pure). Every branch is reachable and unit-tested.
 *
 *  Order:
 *   1. no design                        → DESIGN DRAFT
 *   2. review exists but ≠ current      → REVISED (prior approval invalidated by a
 *                                          digest change; a NEW review must cover it)
 *   3. no current review                → PENDING {ELECTRICAL|STRUCTURAL|ENGINEERING}
 *                                          from the authority-gap domains
 *   4. current review + gate passes     → ISSUED FOR PERMIT
 *   5. current review + no gaps         → PERMIT-READY
 *   6. current review + residual gaps   → REVIEWED
 */
export function deriveIssueState(ctx: IssueStateContext): IssueStateResult {
  const domains = new Set<BlockerDomain>();
  for (const b of ctx.blockers ?? []) {
    const d = classifyBlockerDomain(b.code);
    if (d !== 'review') domains.add(d);
  }
  const authorityGapDomains = [...domains];
  const reviewCoversCurrentDigest = !!ctx.review && ctx.review.reviewedDigest === ctx.currentDigest;
  const reviewStale = !!ctx.review && ctx.review.reviewedDigest !== ctx.currentDigest;

  const done = (state: ProjectIssueState, reason: string): IssueStateResult =>
    ({ state, authorityGapDomains, reviewCoversCurrentDigest, reviewStale, reason });

  if (!ctx.hasDesign) return done('DESIGN DRAFT', 'no modules in the design');

  // §12 digest invalidation: a prior approval that does not cover the current
  // digest is invalidated — the project is REVISED and requires a new review.
  if (reviewStale) {
    return done('REVISED',
      `engineering review covered digest ${ctx.review!.reviewedDigest.slice(0, 12)}… but the current snapshot digest is `
      + `${ctx.currentDigest.slice(0, 12)}… — prior approval invalidated by a design change`);
  }

  if (!reviewCoversCurrentDigest) {
    if (authorityGapDomains.length === 0) {
      return done('PENDING ENGINEERING REVIEW', 'no authority gaps — awaiting engineer sign-off on the current digest');
    }
    if (authorityGapDomains.length === 1 && domains.has('electrical')) {
      return done('PENDING ELECTRICAL REVIEW', 'only electrical authority gaps remain');
    }
    if (authorityGapDomains.length === 1 && domains.has('structural')) {
      return done('PENDING STRUCTURAL REVIEW', 'only structural authority gaps remain');
    }
    return done('PENDING ENGINEERING REVIEW',
      `authority gaps span [${authorityGapDomains.join(', ')}] — full engineering review required`);
  }

  // A review references the current digest.
  if (ctx.gatePasses) return done('ISSUED FOR PERMIT', 'review covers current digest and every ISSUED-FOR-PERMIT precondition passes');
  if (authorityGapDomains.length === 0) return done('PERMIT-READY', 'review covers current digest, no authority gaps — awaiting formal issuance / seal');
  return done('REVIEWED', `review covers current digest but authority gaps remain [${authorityGapDomains.join(', ')}]`);
}

// ── §12 ISSUED-FOR-PERMIT gate (pure; each precondition reported) ─────────────

export interface GatePrecondition {
  id: string;
  label: string;
  satisfied: boolean;
  detail: string;
}

export interface IssuedForPermitGateInput {
  /** §15(d) — project identity is production-valid: the project name does NOT
   *  contain "TEST" and a designer/engineer-of-record is present. A TEST project
   *  or a blank designer can never reach a production/issued state. */
  projectIdentityValid: boolean;
  /** every blocking snapshot validator passes (no blocking violations). */
  blockingValidatorsPass: boolean;
  /** equipment identity reconciled (no EQUIPMENT-IDENTITY-CONFLICT blocker). */
  noEquipmentIdentityConflict: boolean;
  /** code authority verified + current (codeAuthority.verificationStatus === 'verified'). */
  codeAuthorityVerified: boolean;
  /** required manufacturer documents archived. `null` ⇒ the document-registry
   *  read is a documented CLOSER HOOK (async DB) not wired here → not satisfied. */
  manufacturerDocumentsArchived: boolean | null;
  /** structural applicability established (no structural blockers; engine not
   *  engineeringReviewRequired). */
  structuralApplicabilityEstablished: boolean;
  /** the engineering review references the CURRENT snapshot digest. */
  engineerReviewCoversCurrentDigest: boolean;
  /** signature / seal requirements satisfied (engineer identity + seal on file). */
  signatureSealSatisfied: boolean;
  /** §12 ledger integration (CLOSER HOOK): a snapshot_digest_invalidations row
   *  for the current digest forces the review-coverage precondition false even if
   *  reviewedDigest matches. Defaults false until the ledger read is wired. */
  digestInvalidatedByLedger?: boolean;
}

export interface IssuedForPermitGate {
  pass: boolean;
  preconditions: GatePrecondition[];
}

/** §12 — evaluate the ISSUED-FOR-PERMIT gate as a pure function; every
 *  precondition is reported individually so the truth matrix / VAL sheet can
 *  show exactly WHY a package is (not) issuable. */
export function evaluateIssuedForPermitGate(input: IssuedForPermitGateInput): IssuedForPermitGate {
  const reviewCovers = input.engineerReviewCoversCurrentDigest && !input.digestInvalidatedByLedger;
  const docs = input.manufacturerDocumentsArchived;
  const preconditions: GatePrecondition[] = [
    { id: 'project-identity-valid', label: 'Project identity is production-valid',
      satisfied: input.projectIdentityValid,
      detail: input.projectIdentityValid ? 'project name is not a TEST project and a designer is present'
        : 'project name contains "TEST" or the designer/engineer-of-record is blank (§15d)' },
    { id: 'blocking-validators', label: 'All blocking validators pass',
      satisfied: input.blockingValidatorsPass,
      detail: input.blockingValidatorsPass ? 'no blocking snapshot violations' : 'blocking snapshot violation(s) present' },
    { id: 'equipment-identity', label: 'Equipment identity reconciled',
      satisfied: input.noEquipmentIdentityConflict,
      detail: input.noEquipmentIdentityConflict ? 'no equipment-identity conflict' : 'EQUIPMENT-IDENTITY-CONFLICT unresolved' },
    { id: 'code-authority', label: 'Code authority verified',
      satisfied: input.codeAuthorityVerified,
      detail: input.codeAuthorityVerified ? 'code authority verified + current' : 'code authority unverified / incomplete' },
    { id: 'manufacturer-documents', label: 'Required manufacturer documents archived',
      satisfied: docs === true,
      detail: docs === true ? 'required documents archived'
        : docs === false ? 'required manufacturer documents not archived'
          : 'document-registry archival state not resolved (closer hook — snapshot_digest_invalidations / documents DB)' },
    { id: 'structural-applicability', label: 'Structural applicability established',
      satisfied: input.structuralApplicabilityEstablished,
      detail: input.structuralApplicabilityEstablished ? 'structural applicability established' : 'structural applicability not established' },
    { id: 'engineer-review-current-digest', label: 'Engineer review references current digest',
      satisfied: reviewCovers,
      detail: reviewCovers ? 'approved review covers the current snapshot digest'
        : input.digestInvalidatedByLedger ? 'review invalidated by a snapshot_digest_invalidations ledger entry'
          : 'no approved review covering the current digest' },
    { id: 'signature-seal', label: 'Signature / seal satisfied',
      satisfied: input.signatureSealSatisfied,
      detail: input.signatureSealSatisfied ? 'engineer identity + seal on file' : 'signature / seal requirements not satisfied' },
  ];
  return { pass: preconditions.every(p => p.satisfied), preconditions };
}

// ── §3 project-authority record ──────────────────────────────────────────────

export interface ProjectAuthorityEquipmentSummary {
  moduleManufacturer: string | null; moduleModel: string | null; moduleWatts: number | null;
  inverterManufacturer: string | null; inverterModel: string | null; inverterType: string | null;
  mountManufacturer: string | null; mountModel: string | null;
  batteryBrand: string | null; batteryModel: string | null; batteryCount: number | null;
  combinerLabel: string | null;
}

export interface ProjectRevisionEntry {
  rev: string; description: string; date: string | null; by: string | null;
}

/** §14 — per-field legal-authority verification state.
 *   • 'verified'          — confirmed from an official source / document registry
 *                           (operator verification path). NOT fabricated here.
 *   • 'unverified-derived'— present but POSTALLY INFERRED (county/city/AHJ/fire
 *                           from ZIP) or operator-posted; NOT verification.
 *   • 'unverified'        — present, operator-posted, awaiting verification.
 *   • 'unknown'           — absent. */
export type FieldVerificationState = 'verified' | 'unverified-derived' | 'unverified' | 'unknown';

export interface ProjectAuthorityVerification {
  address: FieldVerificationState;
  apn: FieldVerificationState;
  /** county / municipal boundary (the "Madison County / Granite City" inference). */
  municipalBoundary: FieldVerificationState;
  ahjName: FieldVerificationState;
  fireAuthority: FieldVerificationState;
}

export interface ProjectAuthorityRecord {
  schemaVersion: string;
  // ── §3 identity ─────────────────────────────────────────────────────────
  projectName: string | null;
  customer: string | null;
  installationAddress: string | null;
  city: string | null; stateCode: string | null; zip: string | null;
  parcelApn: string | null;
  ahjName: string | null;
  utilityName: string | null;
  systemType: string | null;
  capacities: { dcKw: number | null; acKw: number | null; moduleCount: number | null };
  equipmentSummary: ProjectAuthorityEquipmentSummary;
  designer: string | null;
  contractor: string | null;
  issueDate: string | null;
  // ── §14 legal-authority verification (address/APN/municipal/AHJ/fire) ─────
  authorityVerification: ProjectAuthorityVerification;
  /** true when ANY project-authority field is postally-inferred / unverified —
   *  drives the PROJECT-AUTHORITY-UNVERIFIED permit-readiness blocker. */
  authorityAnyUnverified: boolean;
  // ── §12 issue state + engineer review ───────────────────────────────────
  engineerReviewStatus: string;
  issueState: ProjectIssueState;
  issueStateBasis: {
    authorityGapDomains: BlockerDomain[];
    reviewCoversCurrentDigest: boolean;
    reviewStale: boolean;
    reviewedDigest: string | null;
    reason: string;
  };
  issuedForPermitGate: IssuedForPermitGate;
  // ── §3 revision history / sheet index / codes / notes ───────────────────
  revisionHistory: ProjectRevisionEntry[];
  /** THE actual generated sheet manifest (buildSheetManifest) — never a
   *  hardcoded index. */
  sheetIndex: { id: string; title: string }[];
  /** a REFERENCE to snapshot.codeAuthority (single source) — NO edition literal. */
  governingCodesRef: { source: string; schemaVersion: string; verificationStatus: string; ahjName: string | null };
  generalNotes: string[];
  // ── provenance ───────────────────────────────────────────────────────────
  fieldProvenance: Record<string, Provenance>;
  capturedAtIso: string;
  provenance: Provenance;
}

export interface ProjectAuthorityBuildArgs {
  // identity (already-resolved primitives; NO vendor defaults injected here)
  projectName: string | null;
  customer: string | null;
  installationAddress: string | null;
  city: string | null; stateCode: string | null; zip: string | null;
  parcelApn: string | null;
  /** from the canonical code-authority record (single source for AHJ name). */
  ahjName: string | null;
  utilityName: string | null;
  systemType: string | null;
  dcKw: number | null; acKw: number | null; moduleCount: number | null;
  equipmentSummary: ProjectAuthorityEquipmentSummary;
  designer: string | null;
  contractor: string | null;
  issueDate: string | null;
  /** §14 — county / municipal boundary the address resolved to (postal-inferred
   *  unless verified). Used only to detect the "assumed from ZIP" case. */
  county?: string | null;
  /** §14 — true ONLY when project legal authority was verified from an official
   *  source / the document-registry operator path. Default (undefined/false) ⇒
   *  every present field is 'unverified-derived'. Never fabricated true here. */
  authorityVerified?: boolean;
  // sheet index (THE generated manifest) + governing-codes reference
  sheetIndex: { id: string; title: string }[];
  governingCodes: { schemaVersion: string; verificationStatus: string; ahjName: string | null };
  generalNotes: string[];
  // §12 derivation inputs
  hasDesign: boolean;
  blockers: { code: string }[];
  review: IssueStateReview | null;
  currentDigest: string;
  gateInput: IssuedForPermitGateInput;
  capturedAtIso: string;
}

/** engineer-review status label derived from the review record + digest state. */
function reviewStatusLabel(review: IssueStateReview | null, coversCurrent: boolean, stale: boolean): string {
  if (!review) return 'PENDING — no approved engineering-review record';
  if (stale) return 'STALE — prior approval invalidated by a design change (digest mismatch)';
  if (coversCurrent) return 'APPROVED — review covers the current snapshot digest';
  return 'PENDING — no approved engineering-review record';
}

/** Build THE canonical project/cover authority record + the derived issue state
 *  and ISSUED-FOR-PERMIT gate (pure). */
export function buildProjectAuthority(args: ProjectAuthorityBuildArgs): ProjectAuthorityRecord {
  const gate = evaluateIssuedForPermitGate(args.gateInput);
  const issue = deriveIssueState({
    hasDesign: args.hasDesign,
    blockers: args.blockers,
    review: args.review,
    currentDigest: args.currentDigest,
    gatePasses: gate.pass,
  });

  // Revision history: rev A description reflects the DERIVED issue state (never a
  // fabricated "ISSUED FOR PERMIT" on an unreviewed set). Missing date ⇒ null.
  const revisionHistory: ProjectRevisionEntry[] = [
    { rev: 'A', description: issue.state, date: args.issueDate ?? null, by: args.designer ?? null },
  ];

  const prov = (source: string, note?: string): Provenance => ({ source: 'buildProjectAuthority', ref: source, note });

  // §14 — per-field legal-authority verification. Verified state can ONLY come
  // from the operator/document-registry path (args.authorityVerified); postal
  // inference (county/city/AHJ/fire from ZIP) is NEVER verification.
  const _verified = args.authorityVerified === true;
  const _fieldState = (present: boolean): FieldVerificationState =>
    !present ? 'unknown' : _verified ? 'verified' : 'unverified-derived';
  const authorityVerification: ProjectAuthorityVerification = {
    address: _fieldState(!!args.installationAddress),
    apn: _fieldState(!!args.parcelApn),
    municipalBoundary: _fieldState(!!(args.county || args.city || args.stateCode)),
    ahjName: _fieldState(!!args.ahjName),
    fireAuthority: _fieldState(!!args.ahjName),   // fire authority derives with the AHJ
  };
  const authorityAnyUnverified = Object.values(authorityVerification).some(st => st === 'unverified-derived');

  return {
    schemaVersion: PROJECT_AUTHORITY_SCHEMA_VERSION,
    projectName: args.projectName ?? null,
    customer: args.customer ?? null,
    installationAddress: args.installationAddress ?? null,
    city: args.city ?? null, stateCode: args.stateCode ?? null, zip: args.zip ?? null,
    parcelApn: args.parcelApn ?? null,
    ahjName: args.ahjName ?? null,
    utilityName: args.utilityName ?? null,
    systemType: args.systemType ?? null,
    capacities: { dcKw: args.dcKw ?? null, acKw: args.acKw ?? null, moduleCount: args.moduleCount ?? null },
    equipmentSummary: args.equipmentSummary,
    designer: args.designer ?? null,
    contractor: args.contractor ?? null,
    issueDate: args.issueDate ?? null,
    authorityVerification,
    authorityAnyUnverified,
    engineerReviewStatus: reviewStatusLabel(args.review, issue.reviewCoversCurrentDigest, issue.reviewStale),
    issueState: issue.state,
    issueStateBasis: {
      authorityGapDomains: issue.authorityGapDomains,
      reviewCoversCurrentDigest: issue.reviewCoversCurrentDigest,
      reviewStale: issue.reviewStale,
      reviewedDigest: args.review?.reviewedDigest ?? null,
      reason: issue.reason,
    },
    issuedForPermitGate: gate,
    revisionHistory,
    sheetIndex: args.sheetIndex.map(s => ({ id: s.id, title: s.title })),
    governingCodesRef: {
      source: 'snapshot.codeAuthority',
      schemaVersion: args.governingCodes.schemaVersion,
      verificationStatus: args.governingCodes.verificationStatus,
      ahjName: args.governingCodes.ahjName,
    },
    generalNotes: args.generalNotes,
    fieldProvenance: {
      identity: prov('permit-route enrichment', 'project.* posted values'),
      ahj: prov('snapshot.codeAuthority', 'AHJ name single-sourced from the code-authority record'),
      utility: prov('project.utilityName'),
      equipment: prov('snapshot.equipment', 'versioned equipment records — no vendor default'),
      sheetIndex: prov('buildSheetManifest', 'the ACTUAL generated page manifest'),
      issueState: prov('deriveIssueState', issue.reason),
      governingCodes: prov('snapshot.codeAuthority', 'reference only — no edition literal (V11)'),
    },
    capturedAtIso: args.capturedAtIso,
    provenance: prov('buildProjectAuthority', 'canonical project/cover authority (W4 §3/§12)'),
  };
}
