// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-1 — RESOLVER FRAMEWORK TYPES
// ───────────────────────────────────────────────────────────────────────────
// THE problem this solves (AAC directive §"Critical correction"): the engine
// DETECTS, DOCUMENTS and DISPLAYS blockers instead of RESOLVING them. The one
// async stage that existed (`resolveSnapshotAuthorityInputs`) is a document
// LOOKUP — never a derivation, never a retrieval, never a loop. This module is
// the type layer of the lifecycle that replaces it.
//
// NO DUPLICATE ABSTRACTION (audit §5): every type here EXTENDS a contract the
// codebase already has —
//   • `{ cleared, missing[], reasons[] }` is the de-facto clearance contract
//     shared by evaluateRackingCapacityClearance (rackingAssembly.ts:161),
//     evaluateCableExtensionClearance (procurementSufficiency.ts:74) and the
//     ProcurementSufficiency.clearance record. `ClearanceResult` IS that shape;
//     `RequirementResolutionState` is that shape plus the five directive fields.
//   • `SnapshotAuthorityInputs` (the async bundle threaded into the pure build)
//     LIVES here now and is re-exported from authorityInputs.ts, so the
//     lifecycle and the bundle cannot drift apart.
//   • evidence records follow the existing provenance convention
//     (`{ source, ref }` + the `authority:` / `document:` / `sha256:` reference
//     strings deriveEvidenceReferences already synthesises,
//     releaseGates.ts:695-709).
//
// FAIL-SOFT / FAIL-CLOSED DISCIPLINE is inherited verbatim from
// authorityInputs.ts: every DB read is individually guarded, a failure resolves
// to the BLOCKER-FIRING state, and "unknown" never satisfies a gate.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../../types';
import type { DigestInvalidationFact } from '../reviewCoverage';
import type { RackingCapacityDocumentEvidence } from '../rackingAssembly';
import type { FramingCapacityDocumentEvidence, FramingEngineerReviewEvidence } from '../framingAuthority';
import type { CableExtensionSolution } from '../types';
import type { QCableServiceLoopAllowance } from '../procurementSufficiency';
import type { EnvironmentalLoadSourceEvidence } from '../environmentalAuthority';
import type { GroundingDocumentEvidence } from '../groundingAuthority';
import type { CanonicalEquipmentAuthority } from './equipmentSelection';
import type { ModuleDatasheetBindingAuthority } from './datasheetBinding';
import type { ProjectPersonnelAuthority } from '@/lib/personnel/types';
import type { ProjectLegalAuthorityRecord, CodeAdoptionAuthorityRecord } from './jurisdictionAuthority';
import type { EnvironmentalRetrievalRecord } from './environmentalRetrieval';
import type { CodeAdoptionProvider } from '@/lib/providers/jurisdiction/types';
import type { PropertyIdentityProvider } from '@/lib/providers/property/types';
import type { ClimateHazardProvider } from '@/lib/providers/climateHazard/types';
import type { DocumentRetrievalProvider } from '@/lib/providers/documentRetrieval/types';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — THE FIVE RESOLUTION MODES (directive "Classification": every requirement
// carries EXACTLY ONE). Administrative holds are NOT a sixth mode: an
// administrative requirement is an OPERATOR_CONFIRMATION whose finding type is
// already ADMINISTRATIVE_HOLD in the release-gate model (releaseGates.ts:339)
// — the domain convention that exists, not a duplicate enum value.
// ═══════════════════════════════════════════════════════════════════════════

export const RESOLUTION_MODES = [
  /** deterministic from existing project data / selections / configuration / geometry. */
  'AUTO_DERIVED',
  /** authoritative public / manufacturer retrieval + archival. */
  'AUTO_RETRIEVED',
  /** genuine conflict or bounded ambiguity only (incl. administrative holds). */
  'OPERATOR_CONFIRMATION',
  /** physical conditions absent from every record and from the geometry. */
  'FIELD_VERIFICATION',
  /** licensed judgement / signature / seal / digest-bound release. */
  'PROFESSIONAL_APPROVAL',
] as const;
export type ResolutionMode = (typeof RESOLUTION_MODES)[number];

/** The two modes the lifecycle actually EXECUTES, in execution order. */
export const AUTOMATIC_MODES: readonly ResolutionMode[] = ['AUTO_DERIVED', 'AUTO_RETRIEVED'];

export function isAutomaticMode(m: ResolutionMode): boolean {
  return AUTOMATIC_MODES.includes(m);
}

export const RETRYABILITIES = ['RETRYABLE', 'NON_RETRYABLE', 'REQUIRES_INPUT'] as const;
export type Retryability = (typeof RETRYABILITIES)[number];

export const RESOLUTION_RESULTS = ['RESOLVED', 'FAILED', 'SKIPPED', 'NOT_ATTEMPTED'] as const;
export type ResolutionResult = (typeof RESOLUTION_RESULTS)[number];

// ═══════════════════════════════════════════════════════════════════════════
// §2 — THE NORMALISED CLEARANCE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

/** The de-facto contract already shared by the domain evaluators. */
export interface ClearanceResult {
  cleared: boolean;
  /** the INPUTS still missing — becomes RequirementResolutionState.requiredInputs. */
  missing: string[];
  /** why it is not cleared — becomes RequirementResolutionState.blockingReason. */
  reasons: string[];
}

export const NOT_CLEARED: ClearanceResult = Object.freeze({
  cleared: false, missing: Object.freeze([]) as unknown as string[], reasons: Object.freeze([]) as unknown as string[],
});

/**
 * Normalise the THREE variant evaluator shapes onto `ClearanceResult` (audit §5
 * Seam 2):
 *   • `{cleared, missing[], reasons[]}`      — rackingAssembly / procurementSufficiency
 *   • a bare boolean                         — environmentalSourceVerified
 *   • a record-or-null                       — resolveFramingCapacityAuthority,
 *                                              pickVerifiedDocument, every document lookup
 * NEVER invents a clear: an unrecognised shape is NOT cleared with a stated reason.
 */
export function normalizeClearance(
  raw: unknown,
  opts?: { missingWhenAbsent?: string[]; reasonWhenAbsent?: string },
): ClearanceResult {
  const missingWhenAbsent = opts?.missingWhenAbsent ?? [];
  const reasonWhenAbsent = opts?.reasonWhenAbsent ?? 'no authority resolved';
  if (raw === true) return { cleared: true, missing: [], reasons: [] };
  if (raw === false || raw == null) {
    return { cleared: false, missing: [...missingWhenAbsent], reasons: [reasonWhenAbsent] };
  }
  if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.cleared === 'boolean') {
      return {
        cleared: r.cleared,
        missing: Array.isArray(r.missing) ? r.missing.map(String) : [],
        reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [],
      };
    }
    // a resolved RECORD (document / authority) — presence IS the clearance, the
    // domain gate still re-checks applicability inside the pure build.
    return { cleared: true, missing: [], reasons: [] };
  }
  return { cleared: false, missing: [...missingWhenAbsent], reasons: [`unrecognised clearance shape: ${typeof raw}`] };
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — EVIDENCE (directive: "Failed resolution persists: resolver, inputs,
// source queried, failure reason, retryability, timestamp, minimal operator
// action". Empty evidence / truthy flags are NEVER proof.)
// ═══════════════════════════════════════════════════════════════════════════

export interface ResolutionEvidenceRecord {
  /** the resolver that produced this record (never null — evidence is authored). */
  resolverId: string;
  resolverMode: ResolutionMode;
  /** the requirement codes this attempt bears on ([] for infrastructure resolvers). */
  requirementCodes: string[];
  outcome: ResolutionResult;
  /** the lifecycle iteration the attempt ran in (1-based). */
  iteration: number;
  /** ISO timestamp of the attempt. */
  atIso: string;
  /** the exact inputs the resolver consumed (values, not just names). */
  inputs: Record<string, string | number | boolean | null>;
  /** the source actually queried (table, provider, catalog, calculation). */
  sourceQueried: string | null;
  /** provenance-convention reference strings: `document:…`, `sha256:…`,
   *  `provenance:…`, `authority:…` — the same vocabulary
   *  deriveEvidenceReferences (releaseGates.ts:695) already emits. */
  sourceRefs: string[];
  /** null on RESOLVED; the EXACT failure on FAILED (never swallowed). */
  failureReason: string | null;
  retryability: Retryability;
  /** the minimal operator action, ONLY when one is genuinely necessary. */
  operatorAction: string | null;
  /** 0..1, or null when the resolver does not express one. */
  confidence: number | null;
  /** the audit reference a CLEARING resolution must write — deriveRequirementStatus
   *  (releaseGates.ts:685) keeps `resolved: true` OPEN without one. Null unless
   *  this attempt actually cleared the requirement. */
  auditRef: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — THE PER-REQUIREMENT RESOLUTION STATE (the directive's field list, on the
// clearance contract's core).
// ═══════════════════════════════════════════════════════════════════════════

export interface RequirementResolutionState {
  requirementCode: string;
  /** the declared mode (releaseGates REQUIREMENT_DECLARATIONS). */
  resolutionMode: ResolutionMode;
  /** for SPLIT codes: the mode of the portion that legitimately REMAINS after
   *  automation (e.g. ROUTE-LENGTH-ESTIMATE = AUTO_DERIVED for geometry-derived
   *  branch segments, FIELD_VERIFICATION for the un-routed feeder/service runs). */
  residualMode: ResolutionMode | null;
  /** the DECLARED owning resolver. null ⇒ NOT YET IMPLEMENTED (a later AAC
   *  phase), which is a different fact from "attempted and unresolved". */
  resolverId: string | null;
  /** false ⇔ resolverId === null. Surfaced loudly; never silently final. */
  resolverImplemented: boolean;
  /** which campaign phase delivers the owning resolver (documentary). */
  plannedResolverPhase: string | null;
  /** every resolver that ACTUALLY ran for this code, in execution order. */
  attemptedResolverIds: string[];
  /** `missing[]` from the clearance contract. */
  requiredInputs: string[];
  resolutionEvidence: ResolutionEvidenceRecord[];
  /** 0..1 or null. */
  confidence: number | null;
  /** `reasons[]` joined — the precise, non-generic reason it is not cleared. */
  blockingReason: string | null;
  reasons: string[];
  retryability: Retryability;
  lastResolutionAttempt: string | null;
  lastResolutionResult: ResolutionResult;
  /** the clearance contract's own verdict for this code after the lifecycle. */
  cleared: boolean;
  /** the audit reference a clearing resolution wrote (deriveRequirementStatus
   *  contract). Null while unresolved. */
  resolutionAuditRef: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 — THE AUTHORITY BUNDLE (moved here from authorityInputs.ts so the runner
// and the bundle cannot drift; authorityInputs re-exports it verbatim).
// ═══════════════════════════════════════════════════════════════════════════

/** The authority inputs resolved async and threaded into the sync build. */
export interface SnapshotAuthorityInputs {
  /** VERIFIED racking-capacity document for the selected mount (or null). */
  capacityDocument: RackingCapacityDocumentEvidence | null;
  /** project jurisdiction / AHJ applicability boundary. */
  projectJurisdiction: string | null;
  /** required manufacturer documents archived. null ⇒ unresolved (DB unavailable
   *  or no matching verified document) ⇒ ISSUED-FOR-PERMIT precondition NOT
   *  satisfied. Only `true` when a verified document was actually resolved. */
  manufacturerDocumentsArchived: boolean | null;
  /** a snapshot_digest_invalidations ledger entry forces the review-coverage
   *  precondition false. Unavailable ⇒ conservative `true` (unknown must not
   *  satisfy the gate).
   *
   *  PRR §2 — LEGACY. This project-scoped boolean was `rows.length > 0`, which
   *  latched review coverage false FOREVER: nothing in the codebase ever writes
   *  `superseded_at`, so a row written by one equipment reconciliation blocked
   *  every future approval. It is retained only so a caller that supplies just
   *  the boolean still fails closed; the DECISION now reads `digestInvalidations`
   *  and scopes each row to the digest (and approval time) it actually names. */
  digestInvalidatedByLedger: boolean;
  /** PRR §2 — the ACTIVE invalidation rows themselves, so review coverage can be
   *  scoped to the digest a row names instead of "this project has ever had one".
   *  `null` ⇒ the ledger read FAILED (fail closed); `[]` ⇒ read OK, no active
   *  rows. See lib/permit/snapshot/reviewCoverage.ts#invalidationApplies. */
  digestInvalidations: DigestInvalidationFact[] | null;
  /** FRAMING-AUTHORITY GATE — the VERIFIED, project-applicable framing-capacity
   *  document (truss drawing / mfr calc / stamped analysis) or null. */
  framingCapacityDocument: FramingCapacityDocumentEvidence | null;
  /** the exact project/building applicability key the framing document must cover. */
  framingProjectApplicabilityKey: string | null;
  /** §Q — canonical Q-Cable procurement-deficit resolution solutions, each backed
   *  by a VERIFIED manufacturer document. */
  cableExtensionSolutions: CableExtensionSolution[];
  /** §Q — a DOCUMENTED Q-Cable service-loop / transition allowance. STRICTER-ONLY. */
  qcableServiceLoopAllowance: QCableServiceLoopAllowance | null;
  /** BAR §2 — the VERIFIED, project-applicable climate-hazard source. */
  environmentalSource: EnvironmentalLoadSourceEvidence | null;

  // ── AAC WS-1: the two DEAD SOCKETS the audit found (accepted by
  //    buildPermitDesignSnapshot, resolved by nobody). They are now part of the
  //    bundle so a resolver can fill them without touching the build signature.
  //    Both stay null until their owning phase lands (AAC-4 / AAC-5) — a socket
  //    is wired, NOT stubbed with an always-unresolved resolver. ──────────────
  /** GROUNDING AUTHORITY — the manufacturer document that EXPLICITLY states the
   *  open-air branch grounding/bonding method for the EXACT selected equipment.
   *  build.ts:111-117 accepts it; nothing resolved it before this wiring. */
  groundingDocumentEvidence?: GroundingDocumentEvidence | null;
  /** WS-2 — the Q-Cable field-termination authority socket (see build.ts).
   *  Omitted ⇒ the archived accessor; explicit null ⇒ refused. */
  qcableFieldTerminationAuthority?:
    import('../enphaseFieldTerminationEvidence').EnphaseFieldTerminationAuthority | null;
  /** FRAMING path B — a digest-bound engineer review of the framing capacity.
   *  build.ts:92-93 accepts both; generatePermit never passed them. */
  framingEngineerReview?: FramingEngineerReviewEvidence | null;
  framingReviewDigest?: string | null;

  // ── AAC WS-2 — the canonical selection + configuration authorities. Each is
  //    OPTIONAL and null by default, so every existing construction site of this
  //    interface keeps compiling and a run in which no store was readable
  //    produces a byte-identical snapshot. ──────────────────────────────────
  /** WS-2 — THE canonical equipment identity, its superseded history and the
   *  reconciliation (if any) that made it canonical. */
  canonicalEquipment?: CanonicalEquipmentAuthority | null;
  /** WS-2 — per-module exact-wattage datasheet coverage + the registry-binding
   *  attempt (the AUTO_DERIVED half of MODULE-EXACT-DATASHEET-PENDING). */
  moduleDatasheetBinding?: ModuleDatasheetBindingAuthority | null;
  /** WS-6 — the configured personnel roles of record (designer / preparer /
   *  reviewer resolved from configuration; EOR + approving engineer NEVER
   *  auto-populated). */
  projectPersonnel?: ProjectPersonnelAuthority | null;

  // ── AAC WS-3 / WS-4 — the RETRIEVED authority records. Each is OPTIONAL and
  //    null by default, so every existing construction site of this interface
  //    keeps compiling and a run in which no provider answered produces a
  //    byte-identical snapshot. ────────────────────────────────────────────
  /** WS-3 — the project's LEGAL identity (normalised address, parcel, county,
   *  municipal boundary) retrieved from an official source, with per-field
   *  verification states. Feeds PROJECT-AUTHORITY-UNVERIFIED. */
  projectLegalAuthority?: ProjectLegalAuthorityRecord | null;
  /** WS-3 — the ADOPTED code editions (NEC/IBC/IRC/IFC) retrieved from the AHJ
   *  registry, with source URL, retrieval timestamp, hash and confidence. Feeds
   *  CODE-AUTHORITY-INCOMPLETE. */
  codeAdoptionAuthority?: CodeAdoptionAuthorityRecord | null;
  /** WS-4 — the climate-hazard RETRIEVAL record (query inputs, returned values,
   *  datasets, override history, archival state). Its projection onto
   *  `environmentalSource` is what the existing gate inspects. */
  environmentalRetrieval?: EnvironmentalRetrievalRecord | null;

  // ── AAC WS-8 — the STRUCTURAL SEPARATION authorities. Each is OPTIONAL and
  //    null by default, so every existing construction site keeps compiling and
  //    a run in which nothing was retrieved is byte-identical. ───────────────
  /** WS-8 — the published-document RETRIEVAL record: every source attempted, the
   *  exact HTTP outcome, the content hash, the archival result, whether the
   *  document covers the SELECTED model, and the cross-reference research
   *  finding. THE evidence for the racking document requirements, cleared or not. */
  structuralDocumentRetrieval?: import('./structuralDocuments').StructuralDocumentRetrievalRecord | null;
  /** WS-8 / audit §7.7 — real `DocumentRegistryFacts` keyed
   *  `${category}:${equipmentId}`, so `evaluateDocumentApplicability` can reach
   *  the AUTHORITATIVE verdict that was unreachable while all seven call sites
   *  passed `null`. Only a VERSION-EXACT archived document contributes facts. */
  documentRegistryFacts?: Record<string, import('@/lib/manufacturer-assets-db').DocumentRegistryFacts> | null;
  /** WS-8 — the rail-selection trace: which stores were probed, whether the rail
   *  is inherent in the mount product or genuinely unselected, and the
   *  span-screened candidate list that bounds the operator's remaining pick. */
  rackingAssemblySelection?: import('./railSelection').RailSelectionVerdict | null;
  /** WS-8 — the framing retrieval ATTEMPT and its honest
   *  AUTO_RETRIEVED → PROFESSIONAL_APPROVAL mode transition. */
  framingRetrieval?: {
    resolverId: string;
    projectApplicabilityKey: string | null;
    attempted: boolean;
    sources: { documentClass: string; availability: string; reason: string }[];
    retrievalOutcome: string;
    declaredMode: string;
    residualMode: string;
    transitionBasis: string;
    operatorAction: string;
    attemptedAtIso: string;
  } | null;
  /** WS-9 — the digest-bound engineering-review coverage READ from migration
   *  116. The engine never writes it; a licensed reviewer does. */
  engineeringReview?: import('@/lib/engineeringReview/types').EngineeringReviewCoverage | null;

  /** WS-5 — the ACTIVE field route measurements READ from migration 118, one
   *  per route segment, already reduced to the deterministic selection. The
   *  engine never writes it: an operator records, an authorised verifier
   *  verifies, and this build only PROJECTS what they established.
   *
   *  Null is the honest seed — no field authority — and an unreadable store
   *  produces a bundle whose `storeUnavailable` is true rather than an empty
   *  one, because "we could not look" and "there is nothing" are different
   *  facts even though both refuse to close a requirement. */
  fieldRouteMeasurements?: import('@/lib/fieldMeasurement/resolver').FieldRouteMeasurementAuthority | null;

  /** AAC WS-1 — the lifecycle record: per-requirement resolution state + the
   *  full evidence trail. Optional so every existing construction site of this
   *  interface (scripts, harnesses, tests) keeps compiling and the snapshot
   *  digest is unchanged when no lifecycle ran. */
  resolution?: ResolutionLifecycleOutcome | null;
}

/** The bundle keys a resolver may declare as `requiredInputs` / `produces`. */
export type AuthorityBundleKey = keyof SnapshotAuthorityInputs;

// ═══════════════════════════════════════════════════════════════════════════
// §6 — RESOLVERS (REGISTERED implementations; no placeholder resolvers)
// ═══════════════════════════════════════════════════════════════════════════

/** A dependent record the lifecycle must invalidate + recompute after a
 *  resolution. Mirrors the snapshot_digest_invalidations ledger columns
 *  (migration 114) so AAC-2+ can persist these rows unchanged. */
export interface ResolutionInvalidation {
  /** ledger `scope` — e.g. 'snapshot', 'engineering_approval'. */
  scope: string;
  /** the record/authority path invalidated. */
  target: string;
  reason: string;
  invalidatedBy: string;
  atIso: string;
}

/** Guarded DB/provider read. EVERY resolver must read through this — it is the
 *  authorityInputs per-read try/catch discipline, shared. */
export type SafeDbRead = <T>(
  label: string,
  read: () => Promise<T>,
  failSoftTo: T,
) => Promise<{ value: T; ok: boolean; error: string | null }>;

/**
 * AAC WS-3 / WS-4 — THE RETRIEVAL PROVIDER BAG (the DI seam).
 *
 * Copies the AerialGeometryProvider injection pattern: production supplies the
 * live clients, a test supplies deterministic fixtures, and the resolver code is
 * IDENTICAL in both. A provider that is absent from the bag is a DIFFERENT fact
 * from a provider that answered with nothing, and the resolvers report the two
 * differently.
 */
export interface RetrievalProviders {
  /** WS-3 — adopted NEC/IBC/IRC/IFC (SunSpec / Orange Button AHJ Registry). */
  codeAdoption?: CodeAdoptionProvider | null;
  /** WS-3 — legal identity + parcel + municipal boundary (ATTOM → Census → OSM). */
  propertyIdentity?: PropertyIdentityProvider | null;
  /** WS-4 — wind / snow / seismic / elevation (ASCE 7 Hazard Tool + USGS). */
  climateHazard?: ClimateHazardProvider | null;
  /** WS-8 — published manufacturer / authority DOCUMENT retrieval (fetch, verify
   *  it is a document, hash the exact bytes). The missing half of the ingestion
   *  path the audit found (Path 8: "no fetch, no hashing, no archival"). */
  documentRetrieval?: DocumentRetrievalProvider | null;
}

export interface ResolverContext {
  input: PermitInput;
  projectId: string | null;
  /** the ACCUMULATED bundle as of this pass (read-only). A resolver reads its
   *  `requiredInputs` from here, so ordering/dependency is explicit. */
  authority: Readonly<SnapshotAuthorityInputs>;
  /** 1-based lifecycle iteration. */
  iteration: number;
  /** deterministic timestamp for the whole lifecycle run. */
  nowIso: string;
  /** the shared guarded reader (fail-soft, never throws). */
  safeDbRead: SafeDbRead;
  /** AAC WS-3 / WS-4 — the injected retrieval providers. */
  providers: RetrievalProviders;
}

export interface ResolverOutcome {
  result: ResolutionResult;
  /** the normalised clearance verdict this attempt produced. */
  clearance: ClearanceResult;
  /** the bundle patch to merge (only the keys the resolver `produces`). */
  patch?: Partial<SnapshotAuthorityInputs>;
  /** the source actually queried (table / provider / catalog / calculation). */
  sourceQueried?: string | null;
  sourceRefs?: string[];
  failureReason?: string | null;
  retryability?: Retryability;
  operatorAction?: string | null;
  confidence?: number | null;
  /** written ONLY when the attempt genuinely cleared the requirement — the
   *  deriveRequirementStatus contract (no audit ref ⇒ stays OPEN). */
  auditRef?: string | null;
  /** dependents this resolution invalidates ⇒ the lifecycle recomputes them. */
  invalidations?: ResolutionInvalidation[];
  /** extra inputs to record on the evidence record (beyond requiredInputs). */
  inputsRecorded?: Record<string, string | number | boolean | null>;
}

export interface RequirementResolver {
  /** stable, versioned id, e.g. 'racking-capacity-document@v1'. */
  id: string;
  mode: ResolutionMode;
  /** the requirement codes this resolver bears on ([] = infrastructure resolver
   *  that only feeds other resolvers, e.g. the jurisdiction key). */
  requirementCodes: string[];
  /** bundle keys this resolver READS — a change to any of them re-dirties it. */
  requiredInputs: AuthorityBundleKey[];
  /** bundle keys this resolver WRITES. */
  produces: AuthorityBundleKey[];
  /** one-line statement of what it actually does (documentary, rendered in evidence). */
  description: string;
  run(ctx: ResolverContext): Promise<ResolverOutcome>;
}

// ═══════════════════════════════════════════════════════════════════════════
// §7 — THE LIFECYCLE OUTCOME
// ═══════════════════════════════════════════════════════════════════════════

export interface ResolutionLifecycleOutcome {
  /** how many iterations ran (≤ MAX_RESOLUTION_ITERATIONS). */
  iterations: number;
  /** true when the loop reached a fixed point BEFORE the bound. A false here is
   *  a visible non-convergence, never a silent loop. */
  stabilized: boolean;
  /** the bound, recorded on the artifact so it is auditable. */
  iterationBound: number;
  /** per-requirement state, keyed by requirement code. */
  states: Record<string, RequirementResolutionState>;
  /** the full, ordered evidence trail (every attempt, resolved or failed). */
  evidence: ResolutionEvidenceRecord[];
  /** invalidations raised during the run (Seam 3 payload). */
  invalidations: ResolutionInvalidation[];
  /** ids of the resolvers that ran, in execution order (with repeats per iteration). */
  executionOrder: string[];
  /** validator output — MUST be empty. Non-empty is a framework defect. */
  invariantViolations: string[];
  startedAtIso: string;
}
