// ═══════════════════════════════════════════════════════════════════════════
// HIERARCHICAL RELEASE-GATE MODEL (RGM §1-§4, §7-§10 — 2026-07-26)
// ───────────────────────────────────────────────────────────────────────────
// THE problem this solves: every unresolved CHILD requirement presented as an
// equal top-level blocker. "19 OPEN RELEASE BLOCKERS" misrepresents ~7
// unresolved ROOT release gates that CONTAIN those 19 requirements. All 19 are
// preserved; the root causes are presented.
//
// WHAT THIS MODULE IS: a pure, deterministic PROJECTION over the existing
// `permitReadiness.registry` (PermitReadinessBlocker records). It is NOT a
// second readiness engine:
//   • blocker codes remain THE source requirements — nothing is invented here;
//   • severity + the five permit-acceptance impact axes come from severityPolicy
//     (the single severity authority) — this module only MAPS those axes onto the
//     five RELEASE axes;
//   • domain / authorityPath / affectedSheets / explanation / resolutionAction /
//     payload / provenance PASS THROUGH from the registry record verbatim;
//   • the only NEW declarative facts are (a) which ROOT GATE a requirement code
//     belongs to, (b) its FINDING TYPE, (c) a human gate/requirement title, and
//     (d) for the electrical-closure gate, WHICH RESULT each unresolved input
//     affects. All four live in ONE table (REQUIREMENT_DECLARATIONS /
//     RELEASE_GATE_DEFINITIONS) below — no renderer-local grouping heuristics,
//     no manual requirement lists, no second blocker generator.
//
// FAIL CLOSED (RGM anti-vacuity): a registry code that is NOT in the declarative
// map lands in the UNMAPPED_REQUIREMENT gate, which is OPEN and blocks EVERY
// release axis, and `verifyNoUnmappedRequirements` FAILS. An unknown code can
// never disappear silently and can never be softened.
//
// BACK-COMPAT (§9): `permitReadiness.blockers` and `permitReadiness.registry`
// are untouched. The gate model is PROJECTED AT READ (`projectReleaseGates`),
// exactly like codeAuthorityProjection / structuralProjection /
// projectIssueStateLanguage — it is NOT stored on the snapshot, so the snapshot
// digest (computed over the whole snapshot body) does not churn and no existing
// snapshotId changes. No DB migration.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { PermitDesignSnapshot, PermitReadinessBlocker } from './types';
import { SEVERITY_POLICY, type SeverityImpact } from './severityPolicy';
import { peekSnapshot } from './read';

export const RELEASE_GATE_MODEL_VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════════════════
// §1 / §2 — canonical types
// ═══════════════════════════════════════════════════════════════════════════

/** A gate/requirement is never PASS while evidence is pending (§1). */
export type ReleaseGateStatus = 'OPEN' | 'CLEARED' | 'NOT_APPLICABLE';
export type ReleaseRequirementStatus = ReleaseGateStatus;

/** §2 finding types — the explicit technical-vs-workflow condition (§7). */
export type ReleaseFindingType =
  | 'TECHNICAL_CONFLICT'
  | 'VERIFIED_DEFICIENCY'
  | 'PENDING_SELECTION'
  | 'PENDING_DOCUMENT'
  | 'PENDING_AUTHORITY'
  | 'FIELD_VERIFICATION'
  | 'ADMINISTRATIVE_HOLD'
  | 'PROFESSIONAL_RELEASE'
  | 'ADVISORY';

/** Who resolves it. Derived (never hand-set per requirement) — see `deriveResponsibleRole`. */
export type ResponsibleRole = 'operator' | 'designer' | 'engineer-of-record' | 'admin';

/** Gate category (§1 gateCategory). */
export type ReleaseGateCategory =
  | 'ADMINISTRATIVE_CODE_AUTHORITY'
  | 'EQUIPMENT_AUTHORITY'
  | 'STRUCTURAL_AUTHORITY'
  | 'ELECTRICAL_CLOSURE'
  | 'PROCUREMENT_CLOSURE'
  | 'PROFESSIONAL_WORKFLOW'
  | 'UNMAPPED';

/** §1 release-impact axes — which release lane a gate/requirement BLOCKS. */
export interface ReleaseImpact {
  permitSubmission: boolean;
  procurement: boolean;
  engineeringReview: boolean;
  construction: boolean;
  administrativeRelease: boolean;
}

/** §1 canonical ReleaseGateResult — EXACTLY the directive field list. */
export interface ReleaseGateResult {
  gateId: string;
  gateCode: string;
  title: string;
  description: string;
  gateCategory: ReleaseGateCategory;
  status: ReleaseGateStatus;
  releaseImpact: ReleaseImpact;
  requirementCodes: string[];
  unresolvedRequirementCodes: string[];
  clearedRequirementCodes: string[];
  unresolvedCount: number;
  totalRequirementCount: number;
  primaryResolutionAction: string;
  responsibleRole: ResponsibleRole;
  evidenceReferences: string[];
  affectedSheets: string[];
  snapshotId: string;
  snapshotDigest: string;
}

/** §2 ReleaseRequirement projection per blocker code — EXACTLY the directive field list. */
export interface ReleaseRequirement {
  requirementCode: string;
  gateId: string;
  title: string;
  findingType: ReleaseFindingType;
  status: ReleaseRequirementStatus;
  severity: 'blocking' | 'warning';
  explanation: string;
  resolutionAction: string;
  responsibleRole: ResponsibleRole;
  releaseImpact: ReleaseImpact;
  authorityPath: string;
  evidenceReferences: string[];
  affectedSheets: string[];
  affectedObjects: string[];
  relatedRequirementCodes: string[];
  snapshotId: string;
  snapshotDigest: string;
}

/** §4 top-level count semantics — EXACTLY the six directive fields. */
export interface ReleaseSummary {
  openGateCount: number;
  unresolvedRequirementCount: number;
  advisoryCount: number;
  permitReady: boolean;
  procurementReady: boolean;
  engineeringReviewReady: boolean;
}

/** §8 one readiness axis: ready + the OPEN gates that block it. */
export interface ReadinessAxis {
  ready: boolean;
  openGateIds: string[];
  openGateCodes: string[];
}

/** §8 readiness axes derived from the gates' releaseImpact axes. */
export interface ReadinessAxes {
  permitSubmission: ReadinessAxis;
  procurement: ReadinessAxis;
  engineeringReview: ReadinessAxis;
  construction: ReadinessAxis;
  administrativeRelease: ReadinessAxis;
}

/**
 * §8 gate-derived QUALIFICATION of the EXISTING issue-state machine. No new
 * public issue state is introduced — `deriveIssueState` / PROJECT_ISSUE_STATES
 * stay exactly as they are. These predicates express the §8 conditions in gate
 * terms so stage 2 can DISPLAY them (and the harness can assert agreement).
 *
 * Mapping onto the existing states:
 *   designReview               → 'DESIGN DRAFT' / 'PENDING … REVIEW' family
 *                                (any gate OPEN ⇒ the package is in design review)
 *   readyForEngineeringReview  → 'PENDING ENGINEERING REVIEW' is the CORRECT
 *                                terminal state: professional release is the SOLE
 *                                open gate
 *   readyForPermitSubmission   → the GATE half of 'PERMIT-READY' / 'ISSUED FOR
 *                                PERMIT'. The digest-bound approval + seal half
 *                                remains `evaluateIssuedForPermitGate` — this
 *                                predicate never substitutes for it.
 */
export interface IssueStateGatePredicates {
  designReview: boolean;
  readyForEngineeringReview: boolean;
  readyForPermitSubmission: boolean;
  procurementReady: boolean;
  administrativeReleaseReady: boolean;
  /** the PROFESSIONAL_RELEASE gate is CLEARED / NOT_APPLICABLE. */
  professionalReleaseComplete: boolean;
}

/** The whole derived model (one deterministic projection of one registry). */
export interface ReleaseGateModel {
  modelVersion: string;
  snapshotId: string;
  snapshotDigest: string;
  gates: ReleaseGateResult[];
  requirements: ReleaseRequirement[];
  summary: ReleaseSummary;
  readinessAxes: ReadinessAxes;
  issueStatePredicates: IssueStateGatePredicates;
  /** the DECLARED canonical map (every known code → its gate + finding type). */
  requirementToGateMap: Record<string, { gateId: string; gateCode: string; findingType: ReleaseFindingType }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — THE CANONICAL GATE DEFINITIONS (Ray's exactly-seven root gates + the
// fail-closed UNMAPPED gate). ONE declarative table; nothing else groups.
// ═══════════════════════════════════════════════════════════════════════════

export interface ReleaseGateDefinition {
  gateId: string;
  gateCode: string;
  title: string;
  /** base description; gate 5 appends the per-requirement `affects` clauses. */
  description: string;
  gateCategory: ReleaseGateCategory;
}

export const RELEASE_GATE_DEFINITIONS: readonly ReleaseGateDefinition[] = [
  {
    gateId: 'RG-1',
    gateCode: 'PROJECT_AND_AHJ_AUTHORITY',
    title: 'PROJECT & AHJ AUTHORITY',
    description:
      'Project identity, legal jurisdiction, adopted code editions and production naming are not confirmed from '
      + 'official sources. These are ADMINISTRATIVE / CODE-AUTHORITY confirmations — not engineering failures: no '
      + 'calculation is wrong because of them, but the set cannot be released or accepted with unverified identity.',
    gateCategory: 'ADMINISTRATIVE_CODE_AUTHORITY',
  },
  {
    gateId: 'RG-2',
    gateCode: 'EQUIPMENT_RECONCILIATION',
    title: 'EQUIPMENT RECONCILIATION',
    description:
      'ONE equipment-reconciliation workflow: the stored module identity and the exact-wattage source document must '
      + 'agree before any sheet, schedule or BOM can claim a module of record. Operator reconciliation only — the '
      + 'engine never auto-resolves a stored-identity conflict.',
    gateCategory: 'EQUIPMENT_AUTHORITY',
  },
  {
    gateId: 'RG-3',
    gateCode: 'ENVIRONMENTAL_LOAD_AUTHORITY',
    title: 'ENVIRONMENTAL LOAD AUTHORITY',
    description:
      'The design wind speed, exposure category, risk category and ground snow load are not established from an '
      + 'archived climate-hazard source for this exact site. Operator-entered values are an OBSERVATION / OVERRIDE '
      + 'and drive the PRELIMINARY analysis — they are never verified design criteria.',
    gateCategory: 'STRUCTURAL_AUTHORITY',
  },
  {
    gateId: 'RG-4',
    gateCode: 'STRUCTURAL_ASSEMBLY_AUTHORITY',
    title: 'STRUCTURAL ASSEMBLY AUTHORITY',
    description:
      'ONE root structural gate: the framing capacity authority, the exact racking assembly selection, the '
      + 'roof-attachment fastener assembly and the capacity / applicability source documents are a single chain of '
      + 'unestablished structural authority — NOT independent unrelated failures. Capacity is NOT YET ESTABLISHED '
      + 'from a verified source; no capacity has been shown to FAIL.',
    gateCategory: 'STRUCTURAL_AUTHORITY',
  },
  {
    gateId: 'RG-5',
    gateCode: 'ELECTRICAL_FIELD_AND_CALCULATION_CLOSURE',
    title: 'ELECTRICAL FIELD & CALCULATION CLOSURE',
    description:
      'Field-measured / computed electrical inputs are still open. Each unresolved input blocks a SPECIFIC result '
      + '(below) — it does not invalidate the electrical design as a whole, and a route-length estimate does not '
      + 'block results that do not materially depend on route length.',
    gateCategory: 'ELECTRICAL_CLOSURE',
  },
  {
    gateId: 'RG-6',
    gateCode: 'QCABLE_SYSTEM_CLOSURE',
    title: 'Q-CABLE SYSTEM CLOSURE',
    description:
      'ONE root gate over the listed cable-assembly system: the ordered cable footage must reach the drawn installed '
      + 'path, and the open-air branch grounding/bonding method must be established by a verified, exactly-applicable '
      + 'manufacturer document. Separate children, one system closure.',
    gateCategory: 'PROCUREMENT_CLOSURE',
  },
  {
    gateId: 'RG-7',
    gateCode: 'PROFESSIONAL_RELEASE',
    title: 'PROFESSIONAL RELEASE',
    description:
      'WORKFLOW requirements, not engineering defects: a designer / engineer-of-record must be assigned, and an '
      + 'approved engineering-review record must cover the CURRENT snapshot digest. Derived from the ABSENCE of a '
      + 'digest-bound approval record — never from issue-state wording.',
    gateCategory: 'PROFESSIONAL_WORKFLOW',
  },
  // ── FAIL-CLOSED SINK. Never remove. ────────────────────────────────────────
  {
    gateId: 'RG-UNMAPPED',
    gateCode: 'UNMAPPED_REQUIREMENT',
    title: 'UNMAPPED RELEASE REQUIREMENT',
    description:
      'One or more ACTIVE release requirements are not assigned to a root release gate by the canonical map. The '
      + 'release-gate model cannot characterise them, so they are treated as blocking EVERY release axis until they '
      + 'are mapped. An unknown requirement is never dropped and never softened.',
    gateCategory: 'UNMAPPED',
  },
] as const;

export const UNMAPPED_GATE_ID = 'RG-UNMAPPED';

const GATE_BY_ID = new Map(RELEASE_GATE_DEFINITIONS.map(g => [g.gateId, g]));
const GATE_INDEX = new Map(RELEASE_GATE_DEFINITIONS.map((g, i) => [g.gateId, i]));

// ═══════════════════════════════════════════════════════════════════════════
// §3 / §7 — THE CANONICAL REQUIREMENT → GATE + FINDING-TYPE MAP.
//
// EVERY code the snapshot build can emit is declared here (build.ts pushes,
// structuralAuthority.collectBlockers, rackingAssembly.structuralAuthorityGaps,
// equipmentProjection.collectEquipmentDocumentBlockers, plus the two legacy
// aliases classifyBlockerDomain still recognises). A code absent from this table
// FAILS CLOSED into RG-UNMAPPED.
//
// `affects` (MANDATORY for every RG-5 child, §3 gate 5): which RESULT the
// unresolved input blocks — so a route estimate is not presented as invalidating
// calculations that do not depend on route length.
// ═══════════════════════════════════════════════════════════════════════════

export interface RequirementDeclaration {
  gateId: string;
  findingType: ReleaseFindingType;
  title: string;
  /** which result this unresolved input blocks (required for RG-5 children). */
  affects?: string;
}

export const REQUIREMENT_DECLARATIONS: Record<string, RequirementDeclaration> = {
  // ── RG-1 PROJECT_AND_AHJ_AUTHORITY (3) ────────────────────────────────────
  // Adopted editions are not established from an archived adoption ordinance —
  // an authority record is missing, no code check has failed.
  'CODE-AUTHORITY-INCOMPLETE': {
    gateId: 'RG-1', findingType: 'PENDING_AUTHORITY',
    title: 'Adopted code editions not established from an archived AHJ adoption document',
  },
  // Address / APN / municipal boundary / AHJ / fire authority are operator-posted
  // or postally inferred. Postal inference is not verification.
  'PROJECT-AUTHORITY-UNVERIFIED': {
    gateId: 'RG-1', findingType: 'PENDING_AUTHORITY',
    title: 'Project legal authority (address, APN, boundary, AHJ, fire) not verified from an official source',
  },
  // §7 MANDATED: a non-production project name is an ADMINISTRATIVE HOLD — it is
  // NOT a structural or electrical failure and must never be presented as one.
  'PROJECT-NAME-NONPRODUCTION': {
    gateId: 'RG-1', findingType: 'ADMINISTRATIVE_HOLD',
    title: 'Non-production project identity (name contains "TEST")',
  },

  // ── RG-2 EQUIPMENT_RECONCILIATION (2 + 1 advisory) ────────────────────────
  // §7 MANDATED: two stored authorities disagree about WHICH module is installed
  // ⇒ a TECHNICAL CONFLICT (not a pending document). Operator-only reconciliation.
  'EQUIPMENT-IDENTITY-CONFLICT': {
    gateId: 'RG-2', findingType: 'TECHNICAL_CONFLICT',
    title: 'Stored module identity conflicts with the fleet module of record',
  },
  // The on-file document is a family/range page — the exact-wattage source is
  // absent. A missing DOCUMENT, not a failed value.
  'MODULE-EXACT-DATASHEET-PENDING': {
    gateId: 'RG-2', findingType: 'PENDING_DOCUMENT',
    title: 'Exact-wattage module datasheet not on file (family/range page only)',
  },
  // Advisory (severityPolicy: touches no acceptance axis) — the finding type is
  // forced to ADVISORY from the registry severity, and it is counted in
  // advisoryCount, never in unresolvedRequirementCount.
  'EQUIPMENT-DOCUMENT-UNVERIFIED': {
    gateId: 'RG-2', findingType: 'ADVISORY',
    title: 'Microinverter manufacturer datasheet not archived (parameters already from the equipment record)',
  },

  // ── RG-3 ENVIRONMENTAL_LOAD_AUTHORITY (1) ─────────────────────────────────
  'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED': {
    gateId: 'RG-3', findingType: 'PENDING_AUTHORITY',
    title: 'Wind / exposure / risk / snow criteria not established from an archived climate-hazard source',
  },
  // legacy alias (subsumed by the above; classifyBlockerDomain still maps it)
  'WIND-SNOW-AUTHORITY-UNRESOLVED': {
    gateId: 'RG-3', findingType: 'PENDING_AUTHORITY',
    title: 'Wind / snow design criteria unresolved (legacy code — superseded by ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED)',
  },

  // ── RG-4 STRUCTURAL_ASSEMBLY_AUTHORITY (6 Braidon + the rest of the lane) ──
  'FRAMING-AUTHORITY-UNVERIFIED': {
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Framing CAPACITY authority not established (operator-entered geometry is observation, not capacity)',
  },
  'PENDING-RACKING-ASSEMBLY-SELECTION': {
    gateId: 'RG-4', findingType: 'PENDING_SELECTION',
    title: 'Exact racking assembly (rail / splice SKU) not selected',
  },
  'FASTENER-ASSEMBLY-UNVERIFIED': {
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Roof-attachment fastener assembly withdrawal-capacity authority not established',
  },
  // §7 MANDATED: capacity NOT YET ESTABLISHED from verified authority — a PENDING
  // DOCUMENT. Never failure wording; no capacity has been shown to be inadequate.
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED': {
    gateId: 'RG-4', findingType: 'PENDING_DOCUMENT',
    title: 'Racking capacity source document not archived — capacity not yet established',
  },
  'RACKING-CAPACITY-APPLICABILITY-GAP': {
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Archived capacity source does not cover the exact selected assembly / jurisdiction',
  },
  'EQUIPMENT-DOCUMENT-APPLICABILITY': {
    gateId: 'RG-4', findingType: 'PENDING_DOCUMENT',
    title: 'Cited manufacturer document covers a different product version than the selected mount',
  },
  // ── the remainder of the structural lane (not active on Braidon, mapped so no
  //    known code can ever reach RG-UNMAPPED) ───────────────────────────────
  'ATTACHMENT-CAPACITY-SOURCE-MISSING': {
    gateId: 'RG-4', findingType: 'PENDING_DOCUMENT',
    title: 'No published allowable attachment-capacity source resolved for the assembly',
  },
  'FASTENER-CONFIG-MISSING': {
    gateId: 'RG-4', findingType: 'PENDING_SELECTION',
    title: 'Exact fastener configuration (model / count / embedment) incomplete',
  },
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED': {
    gateId: 'RG-4', findingType: 'TECHNICAL_CONFLICT',
    title: 'Mixed-manufacturer racking assembly without documented compatibility authority',
  },
  // Standing rule: product-name topology inference is PROHIBITED — the topology
  // must be DECLARED, so this is a pending selection, never an inference gap.
  'MOUNT-TOPOLOGY-UNKNOWN': {
    gateId: 'RG-4', findingType: 'PENDING_SELECTION',
    title: 'Mounting topology not declared (neither verified rail-paired nor verified rail-less)',
  },
  'DIRECT-MOUNT-GEOMETRY-MISSING': {
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Rail-less attachment coordinates could not be derived — mount geometry authority absent',
  },
  'REACTIONS-UNTRACEABLE': {
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Module instances present but no canonical attachment objects — reactions not traceable',
  },
  'RAIL-QUANTITY-UNTRACEABLE': {
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Rail-based assembly with no canonical rail objects — rail quantities not traceable',
  },
  // A COMPUTED result exceeds a capacity: a verified engineering deficiency.
  'STRUCTURAL-UTILIZATION-EXCEEDED': {
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Structural utilization exceeded — computed demand exceeds allowable capacity',
  },
  'STRUCTURAL-BOM-RECONCILIATION-FAILED': {
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Structural BOM quantities do not reconcile with the canonical objects',
  },
  'STRUCTURAL-REACTION-RECONCILIATION-FAILED': {
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Attachment reactions do not reconcile with the applied load',
  },
  'SITE-GEOMETRY-MISSING': {
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'No canonical roof-plane geometry available',
  },
  'MODULE-DIMENSIONS-UNVERIFIED': {
    gateId: 'RG-4', findingType: 'PENDING_DOCUMENT',
    title: 'Selected module record lacks exact catalog dimensions',
  },
  'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED': {
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Ultimate-basis capacity refused as an ASD allowable — stamped report not verified',
  },
  // legacy alias for FRAMING-AUTHORITY-UNVERIFIED
  'STRUCTURAL-FRAMING-UNVERIFIED': {
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Framing unverified (legacy code — superseded by FRAMING-AUTHORITY-UNVERIFIED)',
  },

  // ── RG-5 ELECTRICAL_FIELD_AND_CALCULATION_CLOSURE (`affects` MANDATORY) ────
  // §7 MANDATED: ROUTE / FILL / TAP are FIELD_VERIFICATION conditions — a real
  // measurement is owed. They are not conflicts and not verified deficiencies.
  'ROUTE-LENGTH-ESTIMATE': {
    gateId: 'RG-5', findingType: 'FIELD_VERIFICATION',
    title: 'Run lengths are CAD-derived estimates, not routed or field-measured',
    affects:
      'Voltage-drop results and the procurement conductor / raceway FOOTAGE (length-dependent results only). '
      + 'Ampacity, OCPD sizing, terminal ratings and equipment selection do not depend on route length and are NOT '
      + 'blocked by this requirement.',
  },
  'CONDUIT-FILL-PENDING': {
    gateId: 'RG-5', findingType: 'FIELD_VERIFICATION',
    title: 'Feeder conduit fill not computed',
    affects:
      'The conduit-FILL result itself (NEC Ch.9 Table 1) and any derating that depends on it. A PENDING fill must '
      + 'never be presented as a passing zero-error result on PV-4A / PV-4B.',
  },
  'TAP-CONDUCTOR-LENGTH-PENDING': {
    gateId: 'RG-5', findingType: 'FIELD_VERIFICATION',
    title: 'Supply-side tap-conductor length not measured',
    affects:
      'The NEC 705.11(C) ≤10-ft tap-length VERIFICATION only. The tap conductor ampacity / OCPD and the '
      + 'interconnection method are established independently and are not blocked by this requirement.',
  },
  'FEEDER-RACEWAY-AUTHORITY': {
    gateId: 'RG-5', findingType: 'PENDING_SELECTION',
    title: 'Feeder raceway / conduit type not resolved on the canonical feeder segment',
    affects:
      'The feeder raceway schedule, its fill result and the raceway bonding method. Conductor ampacity and OCPD '
      + 'sizing are established independently.',
  },
  'BRANCH-RACEWAY-AUTHORITY': {
    gateId: 'RG-5', findingType: 'PENDING_AUTHORITY',
    title: 'Branch raceway model incomplete — open-air trunk and shared home-run not distinct sections',
    affects:
      'The branch-circuit grouping, the shared home-run fill / derating and any per-section wiring-method callout. '
      + 'Branch OCPD and micro-count limits are unaffected.',
  },
  'RACEWAY-SEGMENT-CONFLICT': {
    gateId: 'RG-5', findingType: 'TECHNICAL_CONFLICT',
    title: 'A single physical segment resolves to more than one raceway type / size',
    affects:
      'Every raceway-schedule row for the conflicting segment id and its fill result — one physical run must carry '
      + 'ONE raceway.',
  },

  // ── RG-6 QCABLE_SYSTEM_CLOSURE (2) ────────────────────────────────────────
  // A MEASURED shortfall (Σ geometric installed path vs drop-based procurement
  // footage) — a verified deficiency, not a pending value.
  'QCABLE-PROCUREMENT-INSUFFICIENT': {
    gateId: 'RG-6', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Ordered Q-Cable footage is SHORT of the designed-installed path',
    affects:
      'The orderable base cable quantity and the installed-path representation. Cleared ONLY by a VERIFIED listed '
      + 'cable-extension product, an alternate listed cable that envelopes the path, or a route revision.',
  },
  'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED': {
    gateId: 'RG-6', findingType: 'PENDING_AUTHORITY',
    title: 'Open-air branch grounding / bonding method not established by an exactly-applicable document',
    affects:
      'The equipment-grounding method, the NEC 250.122 / 690.43(C) conclusion and the candidate EGC quantity '
      + '(design quantity, non-orderable) — a conductor count can never establish it.',
  },

  // ── RG-7 PROFESSIONAL_RELEASE (2) ─────────────────────────────────────────
  // An unassigned role is an ADMINISTRATIVE hold on the professional lane.
  'DESIGNER-OF-RECORD-MISSING': {
    gateId: 'RG-7', findingType: 'ADMINISTRATIVE_HOLD',
    title: 'No designer / engineer-of-record assigned',
  },
  // §7 MANDATED: PROFESSIONAL_RELEASE, derived from the ABSENCE of a digest-bound
  // approval record (certification.engineeringReviewApproved / the review record
  // consumed by deriveIssueState) — NOT from issue-state wording. No circularity:
  // this requirement's existence is decided by build.ts from the certification
  // record, and this module only classifies the record it finds.
  'ENGINEERING-REVIEW-PENDING': {
    gateId: 'RG-7', findingType: 'PROFESSIONAL_RELEASE',
    title: 'No approved engineering-review record covering the current snapshot digest',
  },
};

/** The canonical declared map, in evidence form (§10). */
export function requirementToGateMap(): Record<string, { gateId: string; gateCode: string; findingType: ReleaseFindingType }> {
  const out: Record<string, { gateId: string; gateCode: string; findingType: ReleaseFindingType }> = {};
  for (const [code, d] of Object.entries(REQUIREMENT_DECLARATIONS)) {
    out[code] = { gateId: d.gateId, gateCode: GATE_BY_ID.get(d.gateId)?.gateCode ?? 'UNMAPPED_REQUIREMENT', findingType: d.findingType };
  }
  return out;
}

/** Which result an unresolved input blocks (RG-5 contract; null when undeclared). */
export function requirementAffects(code: string): string | null {
  return REQUIREMENT_DECLARATIONS[code]?.affects ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// DERIVATIONS — every value below is a pure function of the registry record.
// ═══════════════════════════════════════════════════════════════════════════

/** Fail-closed impact for a code with NO severityPolicy entry: it touches every
 *  acceptance axis (the same direction classifyBlockerSeverity fails closed in). */
const ALL_AXES: SeverityImpact = {
  safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true,
};

/** The five permit-ACCEPTANCE axes for a code, from THE severity authority. */
export function severityImpactForCode(code: string): SeverityImpact {
  return SEVERITY_POLICY[code]?.impact ?? ALL_AXES;
}

/**
 * §1 — map the five permit-ACCEPTANCE axes (severityPolicy) onto the five
 * RELEASE axes. Documented formula, applied uniformly:
 *
 *   permitSubmission      = safety | codeCompliance | engineeringApproval | permitAcceptance
 *        (a permit set needs safe, code-showable content, a stamp, and an AHJ-acceptable identity)
 *   procurement           = procurement
 *   engineeringReview     = safety | codeCompliance | engineeringApproval
 *        (the engineer cannot complete a review whose safety/code inputs are unestablished)
 *   construction          = safety | procurement
 *        (you cannot safely build it, or cannot order what builds it)
 *   administrativeRelease = findingType ∈ {ADMINISTRATIVE_HOLD, PROFESSIONAL_RELEASE}
 *        (the administrative/workflow lane: identity, naming, role assignment,
 *         professional release — NOT a technical axis, so it is derived from the
 *         declared finding type rather than the acceptance axes; this is what
 *         makes an administrative-only hold distinguishable from a procurement-
 *         only hold instead of every axis lighting up together)
 */
export function deriveReleaseImpact(impact: SeverityImpact, findingType: ReleaseFindingType): ReleaseImpact {
  return {
    permitSubmission: impact.safety || impact.codeCompliance || impact.engineeringApproval || impact.permitAcceptance,
    procurement: impact.procurement,
    engineeringReview: impact.safety || impact.codeCompliance || impact.engineeringApproval,
    construction: impact.safety || impact.procurement,
    administrativeRelease: findingType === 'ADMINISTRATIVE_HOLD' || findingType === 'PROFESSIONAL_RELEASE',
  };
}

const NO_RELEASE_IMPACT: ReleaseImpact = {
  permitSubmission: false, procurement: false, engineeringReview: false,
  construction: false, administrativeRelease: false,
};
const FULL_RELEASE_IMPACT: ReleaseImpact = {
  permitSubmission: true, procurement: true, engineeringReview: true,
  construction: true, administrativeRelease: true,
};

function orImpact(a: ReleaseImpact, b: ReleaseImpact): ReleaseImpact {
  return {
    permitSubmission: a.permitSubmission || b.permitSubmission,
    procurement: a.procurement || b.procurement,
    engineeringReview: a.engineeringReview || b.engineeringReview,
    construction: a.construction || b.construction,
    administrativeRelease: a.administrativeRelease || b.administrativeRelease,
  };
}

/**
 * §2 responsibleRole — DERIVED from (gate category, finding type). Documented
 * matrix, no per-code role list:
 *
 *   ADMINISTRATIVE_HOLD                → admin              (identity / naming / role assignment)
 *   PROFESSIONAL_RELEASE               → engineer-of-record (only the EOR can release)
 *   VERIFIED_DEFICIENCY                → engineer-of-record, EXCEPT in the
 *                                        PROCUREMENT_CLOSURE gate where the fix is a
 *                                        product selection / route revision → designer
 *   PENDING_SELECTION                  → designer           (a design selection)
 *   TECHNICAL_CONFLICT                 → operator in the EQUIPMENT_AUTHORITY gate
 *                                        (standing rule: EQUIPMENT-IDENTITY-CONFLICT is
 *                                        OPERATOR-ONLY, never auto-resolved);
 *                                        designer elsewhere (a design-model conflict)
 *   PENDING_AUTHORITY | PENDING_DOCUMENT → admin in the ADMINISTRATIVE_CODE_AUTHORITY
 *                                        gate (jurisdiction / adoption / identity records);
 *                                        operator elsewhere — archiving + verifying a
 *                                        source document through the document registry is
 *                                        the operator workflow (standing rule: operator
 *                                        ENTRY is not capacity AUTHORITY; the operator
 *                                        supplies the document, it is the document that
 *                                        establishes the authority)
 *   FIELD_VERIFICATION                 → operator           (a field measurement is owed)
 *   ADVISORY                           → operator           (surfaced, not gating)
 */
export function deriveResponsibleRole(gateCategory: ReleaseGateCategory, findingType: ReleaseFindingType): ResponsibleRole {
  switch (findingType) {
    case 'ADMINISTRATIVE_HOLD': return 'admin';
    case 'PROFESSIONAL_RELEASE': return 'engineer-of-record';
    case 'VERIFIED_DEFICIENCY': return gateCategory === 'PROCUREMENT_CLOSURE' ? 'designer' : 'engineer-of-record';
    case 'PENDING_SELECTION': return 'designer';
    case 'TECHNICAL_CONFLICT': return gateCategory === 'EQUIPMENT_AUTHORITY' ? 'operator' : 'designer';
    case 'PENDING_AUTHORITY':
    case 'PENDING_DOCUMENT': return gateCategory === 'ADMINISTRATIVE_CODE_AUTHORITY' ? 'admin' : 'operator';
    case 'FIELD_VERIFICATION': return 'operator';
    case 'ADVISORY': return 'operator';
    default: return 'operator';
  }
}

/** Precedence for choosing a gate's PRIMARY requirement (most consequential
 *  first) — drives primaryResolutionAction + the gate-level responsibleRole. */
const FINDING_PRECEDENCE: ReleaseFindingType[] = [
  'VERIFIED_DEFICIENCY', 'TECHNICAL_CONFLICT', 'PENDING_AUTHORITY', 'PENDING_DOCUMENT',
  'PENDING_SELECTION', 'FIELD_VERIFICATION', 'ADMINISTRATIVE_HOLD', 'PROFESSIONAL_RELEASE', 'ADVISORY',
];
const precedenceOf = (t: ReleaseFindingType): number => {
  const i = FINDING_PRECEDENCE.indexOf(t);
  return i < 0 ? FINDING_PRECEDENCE.length : i;
};

/** A resolution audit reference with this prefix declares the requirement NOT
 *  APPLICABLE to this project on a recorded authority (rather than resolved). */
export const NOT_APPLICABLE_AUDIT_PREFIX = 'NOT-APPLICABLE:';

/**
 * §1/§2 status from the registry record. FAIL CLOSED: `resolved: true` WITHOUT a
 * resolutionAuditRef is NOT a resolution (the registry contract is that an
 * operator workflow flips `resolved` together with an audit reference), so it
 * stays OPEN — a blocker can never be cleared by an unaudited flag.
 */
export function deriveRequirementStatus(r: Pick<PermitReadinessBlocker, 'resolved' | 'resolutionAuditRef'>): ReleaseRequirementStatus {
  if (!r.resolved) return 'OPEN';
  const ref = (r.resolutionAuditRef ?? '').trim();
  if (!ref) return 'OPEN';                                        // fail closed
  if (ref.startsWith(NOT_APPLICABLE_AUDIT_PREFIX)) return 'NOT_APPLICABLE';
  return 'CLEARED';
}

/** Evidence references — derived from the record's provenance + authorityPath +
 *  the document identifiers its structured payload actually carries. */
function deriveEvidenceReferences(r: PermitReadinessBlocker): string[] {
  const out: string[] = [];
  if (r.authorityPath) out.push(`authority:${r.authorityPath}`);
  const src = r.provenance?.source ?? null;
  const ref = r.provenance?.ref ?? null;
  if (src) out.push(ref ? `provenance:${src}#${ref}` : `provenance:${src}`);
  const p = (r.payload ?? null) as Record<string, unknown> | null;
  if (p) {
    if (typeof p.documentId === 'string' && p.documentId) out.push(`document:${p.documentId}`);
    if (typeof p.documentHash === 'string' && p.documentHash) out.push(`sha256:${p.documentHash.slice(0, 16)}`);
    if (typeof p.documentSectionOrPage === 'string' && p.documentSectionOrPage) out.push(`document-section:${p.documentSectionOrPage}`);
    if (typeof p.assemblyId === 'string' && p.assemblyId) out.push(`assembly:${p.assemblyId}`);
  }
  return dedupe(out);
}

/** Affected objects — the concrete object ids the record's payload names
 *  (`affected*` fields) plus the provenance ref. Never invented. */
function deriveAffectedObjects(r: PermitReadinessBlocker): string[] {
  const out: string[] = [];
  const p = (r.payload ?? null) as Record<string, unknown> | null;
  if (p) {
    for (const key of Object.keys(p).sort()) {
      if (!/^affected[A-Z]/.test(key)) continue;
      const v = p[key];
      if (Array.isArray(v)) for (const x of v) { if (x != null) out.push(String(x)); }
      else if (v != null && (typeof v === 'string' || typeof v === 'number')) out.push(String(v));
    }
  }
  if (r.provenance?.ref) out.push(String(r.provenance.ref));
  return dedupe(out);
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) { if (!seen.has(x)) { seen.add(x); out.push(x); } }
  return out;
}

/** Human title for a code with no declaration (UNMAPPED path only). */
function fallbackTitle(code: string): string {
  const words = code.split(/[-_]/).filter(Boolean).map(w => w.toLowerCase());
  if (!words.length) return 'Unmapped release requirement';
  return `UNMAPPED requirement: ${words.join(' ')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE derivation
// ═══════════════════════════════════════════════════════════════════════════

export interface ReleaseGateModelInput {
  /** permitReadiness.registry (ALL entries; resolved ones become CLEARED). */
  registry: readonly PermitReadinessBlocker[];
  snapshotId: string;
  snapshotDigest: string;
}

/**
 * §1-§4 / §8 — derive the whole release-gate model from ONE registry. Pure and
 * total: every registry record becomes exactly ONE requirement under exactly ONE
 * primary gate; an undeclared code lands in RG-UNMAPPED (OPEN, blocks all axes).
 *
 * NOTE on duplicate codes: the registry legitimately carries MORE THAN ONE record
 * for a code (e.g. one EQUIPMENT-IDENTITY-CONFLICT per conflicting pair, one
 * MODULE-EXACT-DATASHEET-PENDING per distinct module). Requirements are 1:1 with
 * RECORDS, so such records are never merged and never double-counted; the
 * multiset verification below is exact multiset equality, not set equality.
 */
export function deriveReleaseGateModel(input: ReleaseGateModelInput): ReleaseGateModel {
  const snapshotId = input.snapshotId ?? '';
  const snapshotDigest = input.snapshotDigest ?? '';

  // ── 1. one requirement per registry record ──────────────────────────────
  interface Row { req: ReleaseRequirement; gateIdx: number; declIdx: number; recIdx: number }
  const rows: Row[] = [];
  const declOrder = new Map<string, number>();
  Object.keys(REQUIREMENT_DECLARATIONS).forEach((c, i) => declOrder.set(c, i));

  (input.registry ?? []).forEach((r, recIdx) => {
    const decl = REQUIREMENT_DECLARATIONS[r.code] ?? null;
    const gateId = decl?.gateId ?? UNMAPPED_GATE_ID;
    const gateDef = GATE_BY_ID.get(gateId)!;
    const status = deriveRequirementStatus(r);
    // §2: an ADVISORY registry record ALWAYS carries the ADVISORY finding type —
    // the severity authority wins over the declaration (and a declared ADVISORY
    // for a blocking code is caught by validateReleaseGateMap).
    const findingType: ReleaseFindingType = r.severity === 'warning'
      ? 'ADVISORY'
      : (decl?.findingType ?? 'VERIFIED_DEFICIENCY');
    const releaseImpact = gateId === UNMAPPED_GATE_ID
      // fail closed: an unmapped requirement blocks EVERY axis, whatever its
      // severity impact says.
      ? { ...FULL_RELEASE_IMPACT }
      : findingType === 'ADVISORY'
        // an advisory affects no acceptance axis by policy ⇒ it blocks no release
        // axis. It is still listed and counted in advisoryCount.
        ? { ...NO_RELEASE_IMPACT }
        : deriveReleaseImpact(severityImpactForCode(r.code), findingType);

    rows.push({
      gateIdx: GATE_INDEX.get(gateId) ?? RELEASE_GATE_DEFINITIONS.length,
      declIdx: declOrder.get(r.code) ?? Number.MAX_SAFE_INTEGER,
      recIdx,
      req: {
        requirementCode: r.code,
        gateId,
        title: decl?.title ?? fallbackTitle(r.code),
        findingType,
        status,
        severity: r.severity,
        explanation: r.explanation,                       // pass-through
        resolutionAction: r.resolutionAction,             // pass-through
        responsibleRole: deriveResponsibleRole(gateDef.gateCategory, findingType),
        releaseImpact,
        authorityPath: r.authorityPath,                   // pass-through
        evidenceReferences: deriveEvidenceReferences(r),
        affectedSheets: [...(r.affectedSheets ?? [])],    // pass-through
        affectedObjects: deriveAffectedObjects(r),
        relatedRequirementCodes: [],                      // filled once gates are grouped
        snapshotId,
        snapshotDigest,
      },
    });
  });

  // deterministic order: gate declaration order → child declaration order → registry order
  rows.sort((a, b) => (a.gateIdx - b.gateIdx) || (a.declIdx - b.declIdx) || (a.recIdx - b.recIdx));

  // ── 2. sibling cross-references (related requirements within the SAME gate) ─
  for (const row of rows) {
    row.req.relatedRequirementCodes = dedupe(
      rows.filter(o => o.req.gateId === row.req.gateId && o !== row).map(o => o.req.requirementCode),
    ).filter(c => c !== row.req.requirementCode);
  }

  const requirements = rows.map(r => r.req);

  // ── 3. roll requirements up into gates ─────────────────────────────────────
  const gates: ReleaseGateResult[] = RELEASE_GATE_DEFINITIONS.map(def => {
    const children = requirements.filter(q => q.gateId === def.gateId);
    const open = children.filter(q => q.status === 'OPEN');
    const cleared = children.filter(q => q.status === 'CLEARED');
    const notApplicable = children.filter(q => q.status === 'NOT_APPLICABLE');

    // §1: never PASS while evidence is pending. One OPEN child opens the gate.
    const status: ReleaseGateStatus = open.length > 0
      ? 'OPEN'
      : (children.length > 0 && notApplicable.length === children.length)
        ? 'NOT_APPLICABLE'
        : 'CLEARED';

    // the gate blocks the UNION of the axes its UNRESOLVED children block.
    const releaseImpact = open.reduce<ReleaseImpact>((acc, q) => orImpact(acc, q.releaseImpact), { ...NO_RELEASE_IMPACT });

    // primary = highest-precedence OPEN child (else the first child, else none).
    const primary = [...open].sort((a, b) =>
      (precedenceOf(a.findingType) - precedenceOf(b.findingType))
      || (requirements.indexOf(a) - requirements.indexOf(b)))[0] ?? children[0] ?? null;

    // RG-5 contract: the gate EXPLAINS which result each unresolved input affects.
    const affectsLines = open
      .map(q => ({ code: q.requirementCode, affects: requirementAffects(q.requirementCode) }))
      .filter(x => !!x.affects)
      .map(x => `${x.code} affects: ${x.affects}`);
    const description = affectsLines.length
      ? `${def.description} ${affectsLines.join(' ')}`
      : def.description;

    return {
      gateId: def.gateId,
      gateCode: def.gateCode,
      title: def.title,
      description,
      gateCategory: def.gateCategory,
      status,
      releaseImpact,
      requirementCodes: children.map(q => q.requirementCode),
      unresolvedRequirementCodes: open.map(q => q.requirementCode),
      clearedRequirementCodes: cleared.map(q => q.requirementCode),
      unresolvedCount: open.length,
      totalRequirementCount: children.length,
      primaryResolutionAction: primary?.resolutionAction ?? '',
      responsibleRole: primary
        ? deriveResponsibleRole(def.gateCategory, primary.findingType)
        : deriveResponsibleRole(def.gateCategory, 'PENDING_AUTHORITY'),
      evidenceReferences: dedupe(open.flatMap(q => q.evidenceReferences)),
      affectedSheets: dedupe(open.flatMap(q => q.affectedSheets)),
      snapshotId,
      snapshotDigest,
    };
  });

  // ── 4. §8 readiness axes from the gates' release-impact axes ───────────────
  const axis = (pick: (g: ReleaseGateResult) => boolean): ReadinessAxis => {
    const blocking = gates.filter(g => g.status === 'OPEN' && pick(g));
    return { ready: blocking.length === 0, openGateIds: blocking.map(g => g.gateId), openGateCodes: blocking.map(g => g.gateCode) };
  };
  const readinessAxes: ReadinessAxes = {
    permitSubmission: axis(g => g.releaseImpact.permitSubmission),
    procurement: axis(g => g.releaseImpact.procurement),
    engineeringReview: axis(g => g.releaseImpact.engineeringReview),
    construction: axis(g => g.releaseImpact.construction),
    administrativeRelease: axis(g => g.releaseImpact.administrativeRelease),
  };

  // ── 5. §4 summary ─────────────────────────────────────────────────────────
  const openGates = gates.filter(g => g.status === 'OPEN');
  const unresolved = requirements.filter(q => q.status === 'OPEN' && q.findingType !== 'ADVISORY');
  const advisories = requirements.filter(q => q.status === 'OPEN' && q.findingType === 'ADVISORY');
  // engineeringReviewReady: nothing outside the PROFESSIONAL_RELEASE gate is open
  // — i.e. the technical + administrative package is ready to GO to the engineer.
  const engineeringReviewReady = openGates.every(g => g.gateCategory === 'PROFESSIONAL_WORKFLOW');
  const summary: ReleaseSummary = {
    openGateCount: openGates.length,
    unresolvedRequirementCount: unresolved.length,
    advisoryCount: advisories.length,
    permitReady: readinessAxes.permitSubmission.ready,
    procurementReady: readinessAxes.procurement.ready,
    engineeringReviewReady,
  };

  // ── 6. §8 gate-derived qualification of the EXISTING issue states ──────────
  const professionalGate = gates.find(g => g.gateCategory === 'PROFESSIONAL_WORKFLOW')!;
  const issueStatePredicates: IssueStateGatePredicates = {
    designReview: openGates.length > 0,
    readyForEngineeringReview: engineeringReviewReady && professionalGate.status === 'OPEN',
    readyForPermitSubmission: readinessAxes.permitSubmission.ready,
    procurementReady: readinessAxes.procurement.ready,
    administrativeReleaseReady: readinessAxes.administrativeRelease.ready,
    professionalReleaseComplete: professionalGate.status !== 'OPEN',
  };

  return {
    modelVersion: RELEASE_GATE_MODEL_VERSION,
    snapshotId, snapshotDigest,
    gates, requirements, summary, readinessAxes, issueStatePredicates,
    requirementToGateMap: requirementToGateMap(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §9 — PROJECTED-AT-READ accessors (no stored fields ⇒ no digest churn).
// ═══════════════════════════════════════════════════════════════════════════

/** THE read seam every renderer / API / harness consumes. Null-safe: an absent
 *  snapshot yields an EMPTY registry projection (all gates CLEARED, counts 0) —
 *  it never fabricates readiness for a snapshot that does not exist, because a
 *  sheet without a snapshot already fails closed in `getSnapshot`. */
export function projectReleaseGates(snap: PermitDesignSnapshot | null | undefined): ReleaseGateModel {
  return deriveReleaseGateModel({
    registry: snap?.permitReadiness?.registry ?? [],
    snapshotId: snap?.meta?.snapshotId ?? '',
    snapshotDigest: snap?.meta?.digest ?? '',
  });
}

/** Convenience: project straight from a PermitInput (renderers hold `input`). */
export function projectReleaseGatesFromInput(input: PermitInput): ReleaseGateModel {
  return projectReleaseGates(peekSnapshot(input));
}

/** §6 — the single most severe CONFIRMED conflict/deficiency among the OPEN
 *  requirements (finding-type precedence: VERIFIED_DEFICIENCY then
 *  TECHNICAL_CONFLICT, then registry order). Null when the package carries none
 *  — a package of pending authorities must NOT be given a false "conflict"
 *  headline. The cover may highlight it; it never replaces the registry. */
export function topConfirmedConflict(model: ReleaseGateModel): ReleaseRequirement | null {
  const confirmed = model.requirements.filter(q =>
    q.status === 'OPEN' && (q.findingType === 'VERIFIED_DEFICIENCY' || q.findingType === 'TECHNICAL_CONFLICT'));
  if (!confirmed.length) return null;
  return [...confirmed].sort((a, b) =>
    (precedenceOf(a.findingType) - precedenceOf(b.findingType))
    || (model.requirements.indexOf(a) - model.requirements.indexOf(b)))[0];
}

/** §4/§6 — the OPEN root gates in canonical order (what the cover numbers and
 *  what RS-1's root-gate table leads with). Never re-derived by a renderer. */
export function openReleaseGates(model: ReleaseGateModel): ReleaseGateResult[] {
  return model.gates.filter(g => g.status === 'OPEN');
}

/** §4/§6 headline text: "7 OPEN RELEASE GATES / 19 UNRESOLVED REQUIREMENTS /
 *  0 ADVISORIES / NOT FOR PERMIT SUBMISSION". Gate and requirement counts are
 *  never conflated. */
export function releaseHeadline(summary: ReleaseSummary): string {
  const g = `${summary.openGateCount} OPEN RELEASE GATE${summary.openGateCount === 1 ? '' : 'S'}`;
  const r = `${summary.unresolvedRequirementCount} UNRESOLVED REQUIREMENT${summary.unresolvedRequirementCount === 1 ? '' : 'S'}`;
  const a = `${summary.advisoryCount} ADVISOR${summary.advisoryCount === 1 ? 'Y' : 'IES'}`;
  const tail = summary.permitReady ? 'NO PERMIT-IMPACTING GATE OPEN' : 'NOT FOR PERMIT SUBMISSION';
  return `${g} / ${r} / ${a} / ${tail}`;
}

/** §4 — the PACKAGE-LEVEL count line every OTHER sheet prints above its own
 *  sheet-scoped requirement rows. A sheet states the package total in GATE
 *  semantics ("7 OPEN RELEASE GATES / 19 UNRESOLVED REQUIREMENTS") and points at
 *  RS-1 for the requirement detail — it never states "19 blockers", which
 *  misrepresents 19 children of 7 root gates as 19 independent failures. */
export function releasePackageLine(summary: ReleaseSummary): string {
  const g = `${summary.openGateCount} OPEN RELEASE GATE${summary.openGateCount === 1 ? '' : 'S'}`;
  const r = `${summary.unresolvedRequirementCount} UNRESOLVED REQUIREMENT${summary.unresolvedRequirementCount === 1 ? '' : 'S'}`;
  const a = summary.advisoryCount > 0
    ? ` / ${summary.advisoryCount} ADVISOR${summary.advisoryCount === 1 ? 'Y' : 'IES'}` : '';
  return `PACKAGE RELEASE STATUS: ${g} / ${r}${a} — SEE RS-1 FOR ALL ${summary.unresolvedRequirementCount + summary.advisoryCount} REQUIREMENTS`;
}

// ═══════════════════════════════════════════════════════════════════════════
// §10 — EVIDENCE EXPORT + INDEPENDENT VERIFICATION (reusable by the harness)
// ═══════════════════════════════════════════════════════════════════════════

export interface ReleaseGateEvidence {
  modelVersion: string;
  snapshotId: string;
  snapshotDigest: string;
  releaseSummary: ReleaseSummary;
  releaseGates: ReleaseGateResult[];
  releaseRequirements: ReleaseRequirement[];
  requirementToGateMap: Record<string, { gateId: string; gateCode: string; findingType: ReleaseFindingType }>;
  readinessAxes: ReadinessAxes;
  issueStatePredicates: IssueStateGatePredicates;
  /** the per-gate rollup table the cover / RS-1 must agree with. */
  gateRollup: { gateId: string; gateCode: string; status: ReleaseGateStatus; unresolvedCount: number; totalRequirementCount: number }[];
  headline: string;
}

/** §10 — the evidence-JSON payload for the release-gate model. */
export function exportReleaseGateEvidence(model: ReleaseGateModel): ReleaseGateEvidence {
  return {
    modelVersion: model.modelVersion,
    snapshotId: model.snapshotId,
    snapshotDigest: model.snapshotDigest,
    releaseSummary: model.summary,
    releaseGates: model.gates,
    releaseRequirements: model.requirements,
    requirementToGateMap: model.requirementToGateMap,
    readinessAxes: model.readinessAxes,
    issueStatePredicates: model.issueStatePredicates,
    gateRollup: model.gates.map(g => ({
      gateId: g.gateId, gateCode: g.gateCode, status: g.status,
      unresolvedCount: g.unresolvedCount, totalRequirementCount: g.totalRequirementCount,
    })),
    headline: releaseHeadline(model.summary),
  };
}

const multiset = (xs: string[]): string[] => [...xs].sort();

/** CHECK 1 (§10) — every ACTIVE registry code becomes exactly one requirement:
 *  exact MULTISET equality between the active registry and the OPEN requirements.
 *  Nothing lost, nothing duplicated, nothing renderer-invented. */
export function verifyRequirementMultiset(model: ReleaseGateModel, registry: readonly PermitReadinessBlocker[]): string[] {
  const errors: string[] = [];
  const activeRegistry = (registry ?? []).filter(r => deriveRequirementStatus(r) === 'OPEN');
  const openReqs = model.requirements.filter(q => q.status === 'OPEN');
  const a = multiset(activeRegistry.map(r => r.code));
  const b = multiset(openReqs.map(q => q.requirementCode));
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    errors.push(`requirement multiset ≠ active blocker multiset: registry=[${a.join(', ')}] requirements=[${b.join(', ')}]`);
  }
  // total (any status) must equal the whole registry — no record dropped at all.
  const allA = multiset((registry ?? []).map(r => r.code));
  const allB = multiset(model.requirements.map(q => q.requirementCode));
  if (JSON.stringify(allA) !== JSON.stringify(allB)) {
    errors.push(`requirement records ≠ registry records: registry=${allA.length} requirements=${allB.length}`);
  }
  return errors;
}

/** CHECK 2 (§10) — exactly ONE primary gate per requirement, and that gate lists it. */
export function verifyOnePrimaryGate(model: ReleaseGateModel): string[] {
  const errors: string[] = [];
  for (const q of model.requirements) {
    const owning = model.gates.filter(g => g.gateId === q.gateId);
    if (owning.length !== 1) {
      errors.push(`${q.requirementCode}: resolves to ${owning.length} primary gates (must be exactly 1)`);
      continue;
    }
    if (!owning[0].requirementCodes.includes(q.requirementCode)) {
      errors.push(`${q.requirementCode}: not listed by its primary gate ${owning[0].gateId}`);
    }
    const elsewhere = model.gates.filter(g => g.gateId !== q.gateId && g.requirementCodes.includes(q.requirementCode));
    if (elsewhere.length) {
      errors.push(`${q.requirementCode}: also claimed by ${elsewhere.map(g => g.gateId).join(', ')} (one primary gate only)`);
    }
  }
  return errors;
}

/** CHECK 3 (§10) — gate child counts equal their children; Σ gate children equals
 *  the requirement count; no gate/requirement count conflation. */
export function verifyGateCounts(model: ReleaseGateModel): string[] {
  const errors: string[] = [];
  let sumTotal = 0;
  let sumUnresolved = 0;
  for (const g of model.gates) {
    const children = model.requirements.filter(q => q.gateId === g.gateId);
    const open = children.filter(q => q.status === 'OPEN');
    const cleared = children.filter(q => q.status === 'CLEARED');
    const na = children.filter(q => q.status === 'NOT_APPLICABLE');
    if (g.totalRequirementCount !== children.length) {
      errors.push(`${g.gateId}: totalRequirementCount ${g.totalRequirementCount} ≠ ${children.length} children`);
    }
    if (g.unresolvedCount !== open.length) {
      errors.push(`${g.gateId}: unresolvedCount ${g.unresolvedCount} ≠ ${open.length} open children`);
    }
    if (g.unresolvedRequirementCodes.length !== open.length) {
      errors.push(`${g.gateId}: unresolvedRequirementCodes ${g.unresolvedRequirementCodes.length} ≠ ${open.length}`);
    }
    if (g.clearedRequirementCodes.length !== cleared.length) {
      errors.push(`${g.gateId}: clearedRequirementCodes ${g.clearedRequirementCodes.length} ≠ ${cleared.length}`);
    }
    if (g.requirementCodes.length !== open.length + cleared.length + na.length) {
      errors.push(`${g.gateId}: requirementCodes ${g.requirementCodes.length} ≠ open+cleared+notApplicable ${open.length + cleared.length + na.length}`);
    }
    // §1 — never PASS while evidence is pending
    if (open.length > 0 && g.status !== 'OPEN') {
      errors.push(`${g.gateId}: status ${g.status} with ${open.length} unresolved children (must be OPEN)`);
    }
    if (open.length === 0 && g.status === 'OPEN') {
      errors.push(`${g.gateId}: status OPEN with no unresolved children`);
    }
    sumTotal += g.totalRequirementCount;
    sumUnresolved += g.unresolvedCount;
  }
  if (sumTotal !== model.requirements.length) {
    errors.push(`Σ gate children ${sumTotal} ≠ requirements ${model.requirements.length}`);
  }
  const openReqs = model.requirements.filter(q => q.status === 'OPEN').length;
  if (sumUnresolved !== openReqs) {
    errors.push(`Σ gate unresolvedCount ${sumUnresolved} ≠ open requirements ${openReqs}`);
  }
  return errors;
}

/** CHECK 4 (§10 / anti-vacuity) — an UNKNOWN code fails closed AND fails the
 *  harness: the UNMAPPED gate must carry zero requirements. */
export function verifyNoUnmappedRequirements(model: ReleaseGateModel): string[] {
  const unmapped = model.requirements.filter(q => q.gateId === UNMAPPED_GATE_ID);
  if (!unmapped.length) return [];
  return [`UNMAPPED_REQUIREMENT gate holds ${unmapped.length} requirement(s): `
    + `${unmapped.map(q => q.requirementCode).join(', ')} — every active code must be declared in REQUIREMENT_DECLARATIONS`];
}

/** CHECK 5 (§4/§10) — the summary counts are exactly the gate/requirement rollup,
 *  and the readiness axes agree with the gates' release-impact axes. */
export function verifySummaryAndAxes(model: ReleaseGateModel): string[] {
  const errors: string[] = [];
  const openGates = model.gates.filter(g => g.status === 'OPEN');
  const openReqs = model.requirements.filter(q => q.status === 'OPEN' && q.findingType !== 'ADVISORY');
  const advisories = model.requirements.filter(q => q.status === 'OPEN' && q.findingType === 'ADVISORY');
  if (model.summary.openGateCount !== openGates.length) errors.push(`openGateCount ${model.summary.openGateCount} ≠ ${openGates.length}`);
  if (model.summary.unresolvedRequirementCount !== openReqs.length) errors.push(`unresolvedRequirementCount ${model.summary.unresolvedRequirementCount} ≠ ${openReqs.length}`);
  if (model.summary.advisoryCount !== advisories.length) errors.push(`advisoryCount ${model.summary.advisoryCount} ≠ ${advisories.length}`);
  const axes: (keyof ReadinessAxes)[] = ['permitSubmission', 'procurement', 'engineeringReview', 'construction', 'administrativeRelease'];
  for (const k of axes) {
    const expected = openGates.filter(g => g.releaseImpact[k as keyof ReleaseImpact]).map(g => g.gateId);
    const got = model.readinessAxes[k].openGateIds;
    if (JSON.stringify(expected) !== JSON.stringify(got)) {
      errors.push(`readinessAxes.${k}.openGateIds [${got.join(', ')}] ≠ [${expected.join(', ')}]`);
    }
    if (model.readinessAxes[k].ready !== (expected.length === 0)) {
      errors.push(`readinessAxes.${k}.ready ${model.readinessAxes[k].ready} contradicts ${expected.length} open gates`);
    }
  }
  if (model.summary.permitReady !== model.readinessAxes.permitSubmission.ready) errors.push('permitReady ≠ permitSubmission axis');
  if (model.summary.procurementReady !== model.readinessAxes.procurement.ready) errors.push('procurementReady ≠ procurement axis');
  // never mark permit-ready while any permit-impacting gate is open
  if (model.summary.permitReady && openGates.some(g => g.releaseImpact.permitSubmission)) {
    errors.push('permitReady true while a permit-impacting gate is OPEN');
  }
  return errors;
}

/** CHECK 6 (§7) — condition semantics are never mislabelled: an administrative
 *  hold / professional release is never an engineering failure, and pending
 *  authority is never a verified failure. */
export function verifyFindingTypeSemantics(model: ReleaseGateModel): string[] {
  const errors: string[] = [];
  const byCode = (code: string) => model.requirements.filter(q => q.requirementCode === code);
  for (const q of byCode('PROJECT-NAME-NONPRODUCTION')) {
    if (q.findingType !== 'ADMINISTRATIVE_HOLD') errors.push(`PROJECT-NAME-NONPRODUCTION findingType ${q.findingType} ≠ ADMINISTRATIVE_HOLD`);
  }
  for (const q of byCode('ENGINEERING-REVIEW-PENDING')) {
    if (q.findingType !== 'PROFESSIONAL_RELEASE') errors.push(`ENGINEERING-REVIEW-PENDING findingType ${q.findingType} ≠ PROFESSIONAL_RELEASE`);
  }
  for (const q of byCode('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED')) {
    if (q.findingType !== 'PENDING_DOCUMENT') errors.push(`RACKING-CAPACITY-SOURCE-NOT-ARCHIVED findingType ${q.findingType} ≠ PENDING_DOCUMENT`);
    if (q.findingType === 'VERIFIED_DEFICIENCY') errors.push('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED must never be a verified failure');
  }
  for (const q of byCode('EQUIPMENT-IDENTITY-CONFLICT')) {
    if (q.findingType !== 'TECHNICAL_CONFLICT') errors.push(`EQUIPMENT-IDENTITY-CONFLICT findingType ${q.findingType} ≠ TECHNICAL_CONFLICT`);
  }
  for (const q of model.requirements) {
    if (q.severity === 'warning' && q.findingType !== 'ADVISORY') {
      errors.push(`${q.requirementCode}: advisory severity must carry the ADVISORY finding type`);
    }
    if (q.findingType === 'ADVISORY' && q.severity !== 'warning') {
      errors.push(`${q.requirementCode}: ADVISORY finding type on a BLOCKING record`);
    }
  }
  return errors;
}

/** CHECK 7 (§10) — the derived readiness cannot contradict the EXISTING issue
 *  state machine: no gate may be open while the package claims an issued /
 *  permit-ready state. */
export function verifyIssueStateAgreement(model: ReleaseGateModel, issueState: string | null | undefined): string[] {
  const st = (issueState ?? '').toUpperCase();
  if (!st) return [];
  const claimsRelease = st === 'PERMIT-READY' || st === 'ISSUED FOR PERMIT';
  if (claimsRelease && model.summary.openGateCount > 0) {
    return [`issue state ${st} claims release while ${model.summary.openGateCount} release gate(s) are OPEN`];
  }
  return [];
}

/** Self-consistency of the DECLARATIVE map itself (documentary gate). */
export function validateReleaseGateMap(): string[] {
  const errors: string[] = [];
  for (const [code, d] of Object.entries(REQUIREMENT_DECLARATIONS)) {
    const gate = GATE_BY_ID.get(d.gateId);
    if (!gate) { errors.push(`${code}: unknown gateId ${d.gateId}`); continue; }
    if (d.gateId === UNMAPPED_GATE_ID) errors.push(`${code}: may not be declared into the fail-closed UNMAPPED gate`);
    if (!d.title.trim()) errors.push(`${code}: missing title`);
    // RG-5 contract (§3 gate 5): each child states which result it affects.
    if (gate.gateCategory === 'ELECTRICAL_CLOSURE' && !d.affects?.trim()) {
      errors.push(`${code}: an ELECTRICAL_CLOSURE requirement must declare which result it affects`);
    }
    // a code declared ADVISORY must be classified advisory by THE severity authority
    if (d.findingType === 'ADVISORY') {
      const rule = SEVERITY_POLICY[code];
      const touches = rule ? Object.values(rule.impact).some(Boolean) : true;
      if (touches) errors.push(`${code}: declared ADVISORY but the severity policy classifies it BLOCKING`);
    }
  }
  // the seven root gates + the fail-closed sink, no duplicates
  const ids = RELEASE_GATE_DEFINITIONS.map(g => g.gateId);
  if (new Set(ids).size !== ids.length) errors.push('duplicate gateId in RELEASE_GATE_DEFINITIONS');
  const roots = RELEASE_GATE_DEFINITIONS.filter(g => g.gateId !== UNMAPPED_GATE_ID);
  if (roots.length !== 7) errors.push(`expected exactly 7 root release gates, found ${roots.length}`);
  return errors;
}

/** §10 — the aggregate independent verification the harness calls. Empty ⇒ pass. */
export function verifyReleaseGateModel(
  model: ReleaseGateModel,
  registry: readonly PermitReadinessBlocker[],
  issueState?: string | null,
): string[] {
  return [
    ...validateReleaseGateMap(),
    ...verifyRequirementMultiset(model, registry),
    ...verifyOnePrimaryGate(model),
    ...verifyGateCounts(model),
    ...verifyNoUnmappedRequirements(model),
    ...verifySummaryAndAxes(model),
    ...verifyFindingTypeSemantics(model),
    ...verifyIssueStateAgreement(model, issueState ?? null),
  ];
}
