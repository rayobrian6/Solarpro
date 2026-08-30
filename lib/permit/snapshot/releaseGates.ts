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
// AAC WS-1 — resolution/types is a LEAF (its own imports are all type-only), so
// this edge is safe: the lifecycle imports THIS module for the declarations and
// nothing in resolution/types imports back.
import { RESOLUTION_MODES, isAutomaticMode, type ResolutionMode } from './resolution/types';
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
/** Which lane a requirement belongs to. */
export type RequirementLane = 'design' | 'professional';

/**
 * Which lane does this requirement belong to? Fail-closed toward DESIGN: an
 * undeclared code is treated as a design requirement, because calling an unknown
 * gap "awaiting a signature" would understate it.
 */
export function requirementLane(code: string): RequirementLane {
  const d = REQUIREMENT_DECLARATIONS[code];
  if (!d) return 'design';
  if (d.findingType === 'PROFESSIONAL_RELEASE') return 'professional';
  const terminal = d.residualMode ?? d.resolutionMode;
  return terminal === 'PROFESSIONAL_APPROVAL' ? 'professional' : 'design';
}

export interface ReleaseSummary {
  openGateCount: number;
  unresolvedRequirementCount: number;
  advisoryCount: number;
  permitReady: boolean;
  procurementReady: boolean;
  engineeringReviewReady: boolean;

  // == 2026-08-29 - THE LANE SPLIT (Ray's ruling) ==========================
  // "If the remaining are ones that we can never truly fix, like the PE stamp,
  //  remove them. That is no qualifier for us. Our objective is to get this
  //  ready to be stamped."
  //
  // An unstamped engineering set is the TERMINAL state of a correct workflow -
  // it IS the product. Counting the engineer-of-record's signature as one of
  // OUR unresolved requirements said the package was deficient when it was
  // finished, and it made "2 requirements outstanding" mean the same thing
  // whether we still owed real work or owed nothing at all.
  //
  // The lane is NOT a hand-kept list: `requirementLane()` reads the declaration
  // each requirement already carries - PROFESSIONAL when its finding type is
  // PROFESSIONAL_RELEASE or its TERMINAL resolution mode is
  // PROFESSIONAL_APPROVAL, DESIGN otherwise. A new requirement lands in the
  // right lane by declaring what it is.
  //
  // NOTHING IS DELETED. The professional requirements stay in the registry,
  // stay on RS-1, still hold their gates OPEN, and still keep
  // `readyForPermitSubmission` false - an unsealed set can never print ISSUED
  // FOR PERMIT. What changed is whose scorecard they appear on.

  /** requirements SolarPro can close: data, derivation, retrieval, operator entry. */
  designRequirementCount: number;
  /** gates holding at least one open DESIGN requirement. */
  openDesignGateCount: number;
  /** requirements only a licensed professional can close. Reported, never counted
   *  against the design. */
  professionalRequirementCount: number;
  /** true iff nothing SolarPro can act on is outstanding - THE SET IS READY TO BE
   *  STAMPED. This is the number the product is judged on. */
  designComplete: boolean;
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

  // ── AAC WS-1 — THE RESOLUTION-MODE DECLARATION (additive; the release-gate
  //    projection above is unchanged by these fields). One mode per requirement,
  //    from the AAC-0 source-path audit's honest classification (§2, §4.1). ────
  /** the directive's five-class resolution mode. An ADMINISTRATIVE hold is an
   *  OPERATOR_CONFIRMATION whose findingType is already ADMINISTRATIVE_HOLD —
   *  the domain convention that exists, not a duplicate enum value. */
  resolutionMode: ResolutionMode;
  /** SPLIT codes: the mode of the portion that legitimately REMAINS after the
   *  automatic portion resolves (audit's "correct mode — split" rows). */
  residualMode?: ResolutionMode;
  /** the resolver that OWNS clearing this code TODAY. null ⇒ the owning resolver
   *  arrives in a later phase (`resolverPhase`); the lifecycle surfaces that
   *  loudly as RESOLVER-NOT-IMPLEMENTED evidence and never treats the
   *  requirement as silently final. */
  resolverId?: string | null;
  /** which AAC phase delivers the owning resolver (documentary). */
  resolverPhase?: string;
  /** WHERE the owning resolver runs. 'lifecycle' (default) = the async resolver
   *  stage in the permit route (store / provider / document reads). 'derived' =
   *  the SYNCHRONOUS design-geometry stage inside the snapshot build
   *  (resolution/derived.ts), which is the only point at which the CAD model,
   *  the canonical electrical engine result and the branch assignment exist.
   *  Both stages share the framework's clearance/evidence/audit-ref contract. */
  resolverStage?: 'lifecycle' | 'derived';
  /** WHY this mode — the audit anchor. Required (validateReleaseGateMap). */
  modeBasis: string;
  // ══ WHAT A CONSTRUCTION DRAWING SAYS ABOUT THIS REQUIREMENT ════════════
  // A sheet banner used to print the registry `explanation` verbatim. On PV-3
  // that meant ~95 words of derivation across the top of an attachment detail:
  // "GOVERNING-CANDIDATE ENVELOPE: the weakest screened candidate carries 21600
  // in-lb against a demand of 2433 in-lb (M = w·L²/8, independent of the rail
  // fitted)…", a four-product distributor shortlist, and an instruction to our
  // own drafter. None of that is something a reviewer standing at a roof can act
  // on, and the longest paragraph on the sheet belonged to an ADVISORY.
  //
  // `sheetLine` is the one line a drawing carries: CONDITION — action required.
  // The explanation, the remediation, the authority path and the evidence all
  // stay in the registry and are re-printed in full by the review record.
  //
  // It lives on the DECLARATION, not on the snapshot, so writing one is
  // digest-neutral: it can never re-date a design or void a PE's approval.
  // `validateReleaseGateMap` enforces the length, so a new requirement cannot
  // land a paragraph on a drawing again.
  sheetLine?: string;
}

/** The longest line a construction drawing may carry for one requirement.
 *  ~15 words. Beyond this it stops being a callout and becomes a paragraph. */
export const SHEET_LINE_MAX_CHARS = 110;

export const REQUIREMENT_DECLARATIONS: Record<string, RequirementDeclaration> = {
  // ── RG-1 PROJECT_AND_AHJ_AUTHORITY (3) ────────────────────────────────────
  // Adopted editions are not established from an archived adoption ordinance —
  // an authority record is missing, no code check has failed.
  'CODE-AUTHORITY-INCOMPLETE': {
    sheetLine: 'ADOPTED CODE EDITIONS UNCONFIRMED — Verify with the authority having jurisdiction.',
    gateId: 'RG-1', findingType: 'PENDING_AUTHORITY',
    title: 'Adopted code editions not established from an archived AHJ adoption document',
    resolutionMode: 'AUTO_RETRIEVED', residualMode: 'OPERATOR_CONFIRMATION',
    resolverId: 'code-authority@v1', resolverPhase: 'AAC-3 (delivered)',
    modeBasis: 'Audit §2.1 — lookupAhjFromRegistry already RETURNS BuildingCode/FireCode/ResidentialCode per lat/lng and '
      + 'mapRegistryToAhjRecord discarded them (ahjRegistry.ts:83, FIXED in AAC-3). The retrieval now carries the adopted '
      + 'editions with source URL, retrieval timestamp, SHA-256 and confidence; the curated ahj-national record is admitted '
      + 'as a CORROBORATOR only and can never establish an edition alone. OPERATOR_CONFIRMATION only for boundary conflicts '
      + '/ disagreeing sources, with both sources shown.',
  },
  // NATIONWIDE BASELINE (2026-08-27) — two GOVERNED adoption authorities disagree about the
  // adopted edition for this jurisdiction. This is the case CODE-AUTHORITY-INCOMPLETE used to
  // absorb, and the two are genuinely different: "we have nothing" is closed by resolving a
  // jurisdiction, while "we hold two contradictory ordinances" is closed only by determining which
  // one governs. The package still prints a stated basis (the state adoption) and DISCLOSES both
  // claims, so the set is reviewable — but the local edition may not be called established.
  'CODE-AUTHORITY-CONFLICT': {
    sheetLine: 'CODE ADOPTION CONTESTED — Governing ordinance edition to be confirmed.',
    gateId: 'RG-1', findingType: 'PENDING_AUTHORITY',
    title: 'Governed adoption authorities disagree on the adopted code edition',
    resolutionMode: 'OPERATOR_CONFIRMATION', residualMode: 'OPERATOR_CONFIRMATION',
    // No resolverId: the map validator correctly refuses an automatic resolver on a
    // non-automatic mode, and there IS no automatic resolution here by construction.
    modeBasis: 'No automatic resolution is admissible: preferring one governed ordinance over another by recency, '
      + 'rank or mailing city is exactly the silent-winner defect A.4 removed. Both claims are carried on the record '
      + 'and an operator determines which governs.',
  },
  // Address / APN / municipal boundary / AHJ / fire authority are operator-posted
  // or postally inferred. Postal inference is not verification.
  'PROJECT-AUTHORITY-UNVERIFIED': {
    sheetLine: 'SITE AUTHORITY PENDING — Jurisdiction and AHJ to be confirmed from official record.',
    gateId: 'RG-1', findingType: 'PENDING_AUTHORITY',
    title: 'Project legal authority (address, APN, boundary, AHJ, fire) not verified from an official source',
    resolutionMode: 'AUTO_RETRIEVED', residualMode: 'OPERATOR_CONFIRMATION',
    resolverId: 'project-authority@v1', resolverPhase: 'AAC-3 (delivered)',
    modeBasis: 'Audit §2.2 — lib/enrichment/propertyEnricher.ts (ATTOM → Census → Nominatim) existed and was simply not '
      + 'called from the permit path; AAC-3 wires it as project-authority@v1 and adds the municipal-boundary evidence the '
      + 'chain was discarding. Postal inference is still NOT verification: a field clears only when an official source '
      + 'returned it for this exact address. OPERATOR_CONFIRMATION for incorporated/unincorporated ambiguity or a '
      + 'county/AHJ disagreement.',
  },
  // §7 MANDATED: a non-production project name is an ADMINISTRATIVE HOLD — it is
  // NOT a structural or electrical failure and must never be presented as one.
  'PROJECT-NAME-NONPRODUCTION': {
    sheetLine: 'NON-PRODUCTION PROJECT IDENTITY — Not for issue under this project name.',
    gateId: 'RG-1', findingType: 'ADMINISTRATIVE_HOLD',
    title: 'Non-production project identity (name contains "TEST")',
    resolutionMode: 'OPERATOR_CONFIRMATION', resolverId: null,
    modeBasis: 'Audit §2.3 / §3.4 — ADMINISTRATIVE (the finding type already says so). The engine cannot invent a production '
      + 'name and must never rename a user project, so there is no automatic mode: one operator field edit. Re-sourcing the permit '
      + 'identity to the verified property record (§2.2) is a Ray decision, not an engine demotion.',
  },

  // ── RG-2 EQUIPMENT_RECONCILIATION (2 + 1 advisory) ────────────────────────
  // §7 MANDATED: two stored authorities disagree about WHICH module is installed
  // ⇒ a TECHNICAL CONFLICT (not a pending document). Operator-only reconciliation.
  'EQUIPMENT-IDENTITY-CONFLICT': {
    sheetLine: 'MODULE IDENTITY CONFLICT — Two stored records name different modules.',
    gateId: 'RG-2', findingType: 'TECHNICAL_CONFLICT',
    title: 'Stored module identity conflicts with the fleet module of record',
    resolutionMode: 'AUTO_DERIVED', residualMode: 'OPERATOR_CONFIRMATION',
    resolverId: 'canonical-equipment-selection@v1', resolverPhase: 'AAC-2 (delivered)',
    modeBasis: 'Audit §2.4 / WS-2 — one live fleet selection vs one stale mirror is a RANKING, not a conflict; '
      + 'reconcileEquipmentIdentity (reconcile.ts:77) already performs it and is never called from the permit path. It stays '
      + 'OPERATOR_CONFIRMATION ONLY when two genuinely EXPLICIT user selections disagree.',
  },
  // The on-file document is a family/range page — the exact-wattage source is
  // absent. A missing DOCUMENT, not a failed value.
  'MODULE-EXACT-DATASHEET-PENDING': {
    sheetLine: 'MODULE DATASHEET PENDING — No governed datasheet covers the selected module.',
    gateId: 'RG-2', findingType: 'PENDING_DOCUMENT',
    title: 'Exact-wattage module datasheet not on file (family/range page only)',
    resolutionMode: 'AUTO_DERIVED', residualMode: 'AUTO_RETRIEVED',
    resolverId: 'module-datasheet-binding@v1', resolverPhase: 'AAC-2 (derived half delivered; exact-datasheet retrieval AAC-3/AAC-5)',
    modeBasis: 'Audit §2.5 — the selected wattage is never compared against the parsed [lo,hi] range the document title '
      + 'already states (equipmentProjection.ts:186-215). Derived: the range check (delivered — a covering series sheet is now '
      + 'distinguishable from a non-covering one, and the attempted registry binding + precisely-named missing document are on '
      + 'the record). Retrieved: the registry binding naming the exact page/column.',
  },
  // Advisory (severityPolicy: touches no acceptance axis) — the finding type is
  // forced to ADVISORY from the registry severity, and it is counted in
  // advisoryCount, never in unresolvedRequirementCount.
  'EQUIPMENT-DOCUMENT-UNVERIFIED': {
    sheetLine: 'PRODUCT DOCUMENT UNVERIFIED — Manufacturer datasheet not archived.',
    gateId: 'RG-2', findingType: 'ADVISORY',
    title: 'Microinverter manufacturer datasheet not archived (parameters already from the equipment record)',
    resolutionMode: 'AUTO_RETRIEVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'Audit §2.5 note — a manufacturer datasheet archival, identical in class to the other document blockers. '
      + 'Advisory by severity policy (touches no acceptance axis); not active on Braidon.',
  },

  // ── RG-3 ENVIRONMENTAL_LOAD_AUTHORITY (1) ─────────────────────────────────
  'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED': {
    sheetLine: 'DESIGN LOADS PRELIMINARY — Site wind and snow criteria pending an archived source.',
    gateId: 'RG-3', findingType: 'PENDING_AUTHORITY',
    title: 'Wind / exposure / risk / snow criteria not established from an archived climate-hazard source',
    resolutionMode: 'AUTO_RETRIEVED',
    resolverId: 'environmental-load-authority@v1', resolverPhase: 'AAC-3 (delivered)',
    modeBasis: 'Audit §2.6 — the EnvironmentalLoadAuthority RECORD already satisfied WS-4 completely; only the retrieval + '
      + 'archival were missing. AAC-3 adds both: climate-hazard-document@v1 looks for an archived, currency-reviewed source '
      + 'first (it outranks a fresh read and is the durable cache), and environmental-load-authority@v1 otherwise retrieves '
      + 'wind / ground snow / seismic / elevation from the ASCE 7 hazard datasets + USGS, archives the retrieval, and makes '
      + 'the CALCULATED as well as the displayed values derive from the record. Operator entry remains an '
      + 'OBSERVATION/OVERRIDE and is audited beside the retrieval, never in place of it.',
  },
  // legacy alias (subsumed by the above; classifyBlockerDomain still maps it)
  'WIND-SNOW-AUTHORITY-UNRESOLVED': {
    gateId: 'RG-3', findingType: 'PENDING_AUTHORITY',
    title: 'Wind / snow design criteria unresolved (legacy code — superseded by ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED)',
    resolutionMode: 'AUTO_RETRIEVED', resolverId: null, resolverPhase: 'AAC-3',
    modeBasis: 'Legacy alias of ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED; same mode, retired emitter.',
  },

  // ── RG-4 STRUCTURAL_ASSEMBLY_AUTHORITY (6 Braidon + the rest of the lane) ──
  'FRAMING-AUTHORITY-UNVERIFIED': {
    sheetLine: 'STRUCTURAL RELEASE PENDING — Licensed review of existing framing capacity required.',
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Framing CAPACITY authority not established (operator-entered geometry is observation, not capacity)',
    resolutionMode: 'AUTO_RETRIEVED', residualMode: 'PROFESSIONAL_APPROVAL',
    resolverId: 'framing-capacity-document@v1',
    resolverPhase: 'AAC-5 (delivered — retrieval attempt + review path B wired; residual is PROFESSIONAL_APPROVAL)',
    modeBasis: 'Audit §2.7 SPLIT — (a) AUTO_RETRIEVED where a truss design drawing / manufacturer structural calc exists '
      + 'for the building (wired now); (b) an AUTO_DERIVED prescriptive IRC/AWC span tier over the captured FramingObservation '
      + 'geometry (AAC-5); (c) PROFESSIONAL_APPROVAL for a stick-framed existing residence with neither — licensed judgement, correctly.',
  },
  'PENDING-RACKING-ASSEMBLY-SELECTION': {
    sheetLine: 'RAIL PART NUMBER PENDING — Procurement item; any listed UL 2703 rail per schedule.',
    gateId: 'RG-4', findingType: 'PENDING_SELECTION',
    title: 'Exact racking assembly (rail / splice SKU) not selected',
    resolutionMode: 'AUTO_DERIVED', residualMode: 'OPERATOR_CONFIRMATION',
    resolverId: 'racking-assembly-selection@v1', resolverPhase: 'AAC-5 (delivered — split from the capacity predicate)',
    modeBasis: 'Audit §2.8 — TWO requirements wore one name and AAC-5 SPLIT them: the `_assemblyPending` leg was a pure '
      + 'duplicate of the capacity-document predicate (§2.9) and no longer emits this code, so this requirement is now the '
      + 'RAIL SELECTION alone. racking-assembly-selection@v1 probes every store a rail could live in — the project record, '
      + 'projects.selected_equipment, engineering_config.subSystems, and the mount product itself — and RESOLVES the code '
      + 'when the selected mount is a single-manufacturer railed system (the rail is inherent in the product) or is '
      + 'rail-less. For a MIXED-MANUFACTURER mount no rail exists in any store and the catalog RailSpec carries no part '
      + 'number, so the residual is a genuine design + procurement decision the engine must not fabricate '
      + '(OPERATOR_CONFIRMATION). What automation still owes, and now delivers, is that the operator never RESEARCHES: the '
      + 'resolver derives the span-screened candidate list from the mount own documented compatibility statement, so the '
      + 'remaining act is one pick from a scored shortlist.',
  },
  // GOVERNING-CANDIDATE ENVELOPE (2026-08-27) — the BLOCKING sibling of the code above. It fires
  // only when the rail bending envelope could NOT be bounded from the screened candidates, i.e.
  // the design genuinely depends on which rail is fitted. When the envelope IS bounded (the normal
  // case), PENDING-RACKING-ASSEMBLY-SELECTION fires instead and is advisory.
  'RACKING-RAIL-CAPACITY-UNBOUNDED': {
    sheetLine: 'RAIL SELECTION REQUIRED — The design depends on which rail is fitted.',
    gateId: 'RG-4', findingType: 'PENDING_SELECTION',
    title: 'Rail bending envelope not bounded — the design depends on which rail is fitted',
    resolutionMode: 'OPERATOR_CONFIRMATION', residualMode: 'OPERATOR_CONFIRMATION',
    modeBasis: 'Bending demand M = w·L²/8 is independent of the rail fitted, so a screened shortlist with published '
      + 'moment capacities normally bounds the whole design. When no such bound can be formed — no eligible candidate, '
      + 'or no published capacity — the rail is a real design decision and the engine must not fabricate one.',
  },
  'FASTENER-ASSEMBLY-UNVERIFIED': {
    sheetLine: 'ATTACHMENT FASTENER PENDING — Manufacturer withdrawal-capacity document required.',
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Roof-attachment fastener assembly withdrawal-capacity authority not established',
    resolutionMode: 'AUTO_RETRIEVED',
    resolverId: 'racking-documents@v1', resolverPhase: 'AAC-5 (delivered — the _capGated echo is deleted)',
    modeBasis: 'Audit §2.11 — the fastener assembly is ALREADY verified for the mount base (lag/screw model + count + '
      + 'embedment + the ICC-ES evaluation report); it fired purely as a `_capGated` echo of §2.9, contradicting its own '
      + 'documentation that the mount-BASE fastener is verifiable independent of the rail selection. AAC-5 deletes the echo '
      + 'term, so this code now fires ONLY when the fastener element itself is incomplete or carries no source document — '
      + 'which is what the severity policy always said it meant.',
  },
  // §7 MANDATED: capacity NOT YET ESTABLISHED from verified authority — a PENDING
  // DOCUMENT. Never failure wording; no capacity has been shown to be inadequate.
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED': {
    sheetLine: 'ATTACHMENT CAPACITY PENDING — Manufacturer capacity document not on file.',
    gateId: 'RG-4', findingType: 'PENDING_DOCUMENT',
    title: 'Racking capacity source document not archived — capacity not yet established',
    resolutionMode: 'AUTO_RETRIEVED',
    resolverId: 'racking-documents@v1', resolverPhase: 'AAC-5 (delivered — retrieval + hash + archival)',
    modeBasis: 'Audit §2.9 — ONE manufacturer PDF. racking-documents@v1 now FETCHES the published stamped letter (per state '
      + 'and per adopted ASCE edition), refuses a soft-404 HTML body, hashes the exact bytes and archives them through the '
      + 'document registry. Retrieval establishes EXISTENCE and BYTES; the pure evaluateRackingCapacityClearance predicate '
      + 'still decides whether the archived document covers the selected assembly, and the registry still decides '
      + 'verification — a fetched PDF is evidence, never a clearance.',
  },
  'RACKING-CAPACITY-APPLICABILITY-GAP': {
    sheetLine: 'ATTACHMENT CAPACITY PENDING — The document on file does not cover this assembly.',
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Archived capacity source does not cover the exact selected assembly / jurisdiction',
    resolutionMode: 'AUTO_RETRIEVED',
    resolverId: 'racking-documents@v1', resolverPhase: 'AAC-5 (delivered — genuinely re-predicated)',
    modeBasis: 'Audit §2.10 — this used to fire from the SAME single `if (!rtCleared)` as §2.9: two codes from one '
      + 'predicate. AAC-5 gives it its own. §2.9 is now ARCHIVAL (is the source document archived and hash-bound at all) '
      + 'and this code is APPLICABILITY (does the archived source cover the exact selected model, assembly and '
      + 'jurisdiction). The two are genuinely different questions, and the live manufacturer case proves it: the stamped '
      + 'letter is retrievable and archivable, and it covers the SUCCESSOR product — so archival can succeed while '
      + 'applicability legitimately remains one bounded confirmation.',
  },
  'EQUIPMENT-DOCUMENT-APPLICABILITY': {
    sheetLine: 'PRODUCT DOCUMENT VERSION GAP — The document does not cover the selected version.',
    gateId: 'RG-4', findingType: 'PENDING_DOCUMENT',
    title: 'Cited manufacturer document covers a different product version than the selected mount',
    resolutionMode: 'AUTO_RETRIEVED', resolverId: 'racking-documents@v1',
    resolverPhase: 'AAC-5 (delivered — version-exact retrieval, no fabricated alias)',
    modeBasis: 'Audit §2.12 — the on-file asset cites a NEWER-version manual for the selected mount. The research AAC-5 was '
      + 'asked to do was whether the manufacturer publishes a cross-reference bringing the older product under the newer '
      + 'document: it does NOT (only a generational marketing statement, with the older product still listed and still '
      + 'carrying its own standalone manual). So no alias is fabricated. The correct automation is delivered instead: '
      + 'racking-documents@v1 retrieves and archives the VERSION-EXACT manual, which also supplies the real '
      + 'DocumentRegistryFacts (archive + hash + status) that left the AUTHORITATIVE verdict unreachable while all seven '
      + 'call sites passed null.',
  },
  // ── the remainder of the structural lane (not active on Braidon, mapped so no
  //    known code can ever reach RG-UNMAPPED) ───────────────────────────────
  // NOTE on this block: none of these is active on Braidon. Each carries the
  // honest mode its resolution WOULD take, so no declared code can reach the
  // lifecycle without a classification (validateReleaseGateMap enforces it).
  'ATTACHMENT-CAPACITY-SOURCE-MISSING': {
    sheetLine: 'ATTACHMENT CAPACITY PENDING — No capacity source for the selected mount.',
    gateId: 'RG-4', findingType: 'PENDING_DOCUMENT',
    title: 'No published allowable attachment-capacity source resolved for the assembly',
    resolutionMode: 'AUTO_RETRIEVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'A published manufacturer capacity source — the same retrieval class as §2.9. Not active on Braidon.',
  },
  'FASTENER-CONFIG-MISSING': {
    sheetLine: 'FASTENER SCHEDULE INCOMPLETE — Specify fastener type, size and embedment.',
    gateId: 'RG-4', findingType: 'PENDING_SELECTION',
    title: 'Exact fastener configuration (model / count / embedment) incomplete',
    resolutionMode: 'AUTO_DERIVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'The mount record already carries fastener model / count / embedment (mounting-hardware-db); a gap is a '
      + 'catalog completion, not an operator question. Not active on Braidon.',
  },
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED': {
    sheetLine: 'MIXED-BRAND ASSEMBLY — Manufacturer approval of the combined assembly required.',
    gateId: 'RG-4', findingType: 'TECHNICAL_CONFLICT',
    title: 'Mixed-manufacturer racking assembly without documented compatibility authority',
    resolutionMode: 'AUTO_RETRIEVED', residualMode: 'OPERATOR_CONFIRMATION',
    resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'A documented cross-manufacturer compatibility statement is retrievable; absent one, the assembly choice is a '
      + 'genuine operator/designer decision. Not active on Braidon.',
  },
  // Standing rule: product-name topology inference is PROHIBITED — the topology
  // must be DECLARED, so this is a pending selection, never an inference gap.
  'MOUNT-TOPOLOGY-UNKNOWN': {
    sheetLine: 'MOUNT TYPE UNCONFIRMED — Rail-paired vs rail-less load path not established.',
    gateId: 'RG-4', findingType: 'PENDING_SELECTION',
    title: 'Mounting topology not declared (neither verified rail-paired nor verified rail-less)',
    resolutionMode: 'OPERATOR_CONFIRMATION', resolverId: null,
    modeBasis: 'STANDING RULE — product-name topology inference is PROHIBITED. The topology must be DECLARED, so this can '
      + 'never become an automatic mode.',
  },
  'DIRECT-MOUNT-GEOMETRY-MISSING': {
    sheetLine: 'MOUNT GEOMETRY INCOMPLETE — Attachment layout not established for this mount.',
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Rail-less attachment coordinates could not be derived — mount geometry authority absent',
    resolutionMode: 'AUTO_DERIVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'Attachment coordinates are derived from the canonical module geometry (coordinateAuthority); a gap is a '
      + 'derivation failure, not a field observation. Not active on Braidon.',
  },
  'REACTIONS-UNTRACEABLE': {
    sheetLine: 'POINT LOADS UNTRACEABLE — Attachment reactions must trace to the load case.',
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Module instances present but no canonical attachment objects — reactions not traceable',
    resolutionMode: 'AUTO_DERIVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'An internal object-model gap the engine must close from its own geometry. Not active on Braidon.',
  },
  'RAIL-QUANTITY-UNTRACEABLE': {
    sheetLine: 'RAIL QUANTITY UNTRACEABLE — The rail schedule must reconcile to the array.',
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Rail-based assembly with no canonical rail objects — rail quantities not traceable',
    resolutionMode: 'AUTO_DERIVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'An internal object-model gap the engine must close from its own geometry. Not active on Braidon.',
  },
  // A COMPUTED result exceeds a capacity: a verified engineering deficiency.
  'STRUCTURAL-UTILIZATION-EXCEEDED': {
    sheetLine: 'FRAMING OVERSTRESSED — Reinforcement or layout revision required before permit.',
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Structural utilization exceeded — computed demand exceeds allowable capacity',
    resolutionMode: 'PROFESSIONAL_APPROVAL', resolverId: null,
    modeBasis: 'A COMPUTED capacity exceedance. The engine must never auto-clear it; the resolution is a design revision '
      + 'plus licensed structural judgement.',
  },
  'STRUCTURAL-BOM-RECONCILIATION-FAILED': {
    sheetLine: 'RACKING BOM UNRECONCILED — Structural quantities disagree with the array.',
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Structural BOM quantities do not reconcile with the canonical objects',
    resolutionMode: 'AUTO_DERIVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'An internal reconciliation defect between two engine outputs — never operator work. Not active on Braidon.',
  },
  'STRUCTURAL-REACTION-RECONCILIATION-FAILED': {
    sheetLine: 'REACTIONS UNRECONCILED — Attachment loads disagree with the load case.',
    gateId: 'RG-4', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Attachment reactions do not reconcile with the applied load',
    resolutionMode: 'AUTO_DERIVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'An internal reconciliation defect between two engine outputs — never operator work. Not active on Braidon.',
  },
  'SITE-GEOMETRY-MISSING': {
    sheetLine: 'ROOF GEOMETRY INCOMPLETE — Field-verify plane dimensions and slope.',
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'No canonical roof-plane geometry available',
    resolutionMode: 'AUTO_RETRIEVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'Roof-plane geometry comes from the aerial/site-survey provider chain (Nearmap / Google Solar / EagleView), '
      + 'all already wired elsewhere in the route. Not active on Braidon.',
  },
  'MODULE-DIMENSIONS-UNVERIFIED': {
    sheetLine: 'MODULE DIMENSIONS UNVERIFIED — Confirm module size from the datasheet.',
    gateId: 'RG-4', findingType: 'PENDING_DOCUMENT',
    title: 'Selected module record lacks exact catalog dimensions',
    resolutionMode: 'AUTO_RETRIEVED', resolverId: null, resolverPhase: 'AAC-2',
    modeBasis: 'Catalog dimensions come from the module datasheet binding (the same retrieval as §2.5). Not active on Braidon.',
  },
  'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED': {
    sheetLine: 'ATTACHMENT CAPACITY PENDING — Published value is ultimate, not an ASD allowable.',
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Ultimate-basis capacity refused as an ASD allowable — stamped report not verified',
    resolutionMode: 'AUTO_RETRIEVED', resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'A stamped report stating an ASD allowable is a retrieval; an ultimate value is never silently converted. '
      + 'Not active on Braidon.',
  },
  // legacy alias for FRAMING-AUTHORITY-UNVERIFIED
  'STRUCTURAL-FRAMING-UNVERIFIED': {
    gateId: 'RG-4', findingType: 'PENDING_AUTHORITY',
    title: 'Framing unverified (legacy code — superseded by FRAMING-AUTHORITY-UNVERIFIED)',
    resolutionMode: 'AUTO_RETRIEVED', residualMode: 'PROFESSIONAL_APPROVAL',
    resolverId: null, resolverPhase: 'AAC-5',
    modeBasis: 'Legacy alias of FRAMING-AUTHORITY-UNVERIFIED; same split classification, retired emitter.',
  },

  // ── RG-5 ELECTRICAL_FIELD_AND_CALCULATION_CLOSURE (`affects` MANDATORY) ────
  // §7 MANDATED: ROUTE / FILL / TAP are FIELD_VERIFICATION conditions — a real
  // measurement is owed. They are not conflicts and not verified deficiencies.
  'ROUTE-LENGTH-ESTIMATE': {
    sheetLine: 'RUN LENGTHS ARE ESTIMATES — Field-measure the named runs before ordering conductor.',
    gateId: 'RG-5', findingType: 'FIELD_VERIFICATION',
    title: 'Run lengths are CAD-derived estimates, not routed or field-measured',
    affects:
      'Voltage-drop results and the procurement conductor / raceway FOOTAGE (length-dependent results only). '
      + 'Ampacity, OCPD sizing, terminal ratings and equipment selection do not depend on route length and are NOT '
      + 'blocked by this requirement.',
    resolutionMode: 'AUTO_DERIVED', residualMode: 'FIELD_VERIFICATION',
    resolverId: 'route-length@v1', resolverPhase: 'AAC-4 (delivered — narrowed to the un-routed residual)',
    resolverStage: 'derived',
    modeBasis: 'Audit §2.13 SPLIT — the BRANCH section IS true geometry (branchCablePaths carry lengthProvenance '
      + '"geometry-derived") and was lumped in by a hardcoded literal `cad-derived-estimate` at build.ts:394. AAC-4 sets the '
      + 'branch cable path\'s lengthSource truthfully (cad-route) and NARROWS this requirement to its honest residual: the '
      + 'feeder / home-run / service runs whose physical route is genuinely absent from the CAD model, named segment by '
      + 'segment in the blocker payload. FIELD_VERIFICATION for that residual only.',
  },
  'CONDUIT-FILL-PENDING': {
    sheetLine: 'CONDUIT FILL UNRESOLVED — NEC Ch.9 Table 1 fill not established for this raceway.',
    gateId: 'RG-5', findingType: 'FIELD_VERIFICATION',
    title: 'Feeder conduit fill not computed',
    affects:
      'The conduit-FILL result itself (NEC Ch.9 Table 1) and any derating that depends on it. A PENDING fill must '
      + 'never be presented as a passing zero-error result on PV-4A / PV-4B.',
    resolutionMode: 'AUTO_DERIVED',
    resolverId: 'conduit-fill@v1', resolverPhase: 'AAC-4 (delivered)', resolverStage: 'derived',
    modeBasis: 'Audit §2.14 — the NEC Ch.9 Table 1 calculation EXISTS AND RUNS in the permit path; its result was discarded by '
      + 'four field-name mismatches in computeSystemProjection.ts:30-32,53-58 and build.ts:401 (row `contains/segments` on a row '
      + 'that has neither; `fillPercent` vs `fillPct`; `conduitFillPercent` vs `conduitFillPct`; `passes` vs `pass`). AAC-4 fixes '
      + 'the projection seam and conduit-fill@v1 validates completeness (raceway type + trade size, conductor set, insulation, '
      + 'adopted code edition) and records the computed result as evidence. WS-7: an unexecuted calculation is never field '
      + 'verification — here it had been executed and thrown away.',
  },
  'TAP-CONDUCTOR-LENGTH-PENDING': {
    sheetLine: 'TAP SPAN UNCONSTRAINED — Locate the fused disconnect within 10 ft of the tap.',
    gateId: 'RG-5', findingType: 'PENDING_SELECTION',
    title: 'Supply-side tap span is not constrained by the design',
    affects:
      'The NEC 705.11(C) ≤10-ft tap-length rule only. The tap conductor ampacity / OCPD and the '
      + 'interconnection method are established independently and are not blocked by this requirement.',
    resolutionMode: 'AUTO_DERIVED', residualMode: 'OPERATOR_CONFIRMATION',
    resolverId: null, resolverPhase: 'delivered (tapSpanAuthority)',
    modeBasis:
      '2026-08-28 — RECLASSIFIED from FIELD_VERIFICATION. The ≤10-ft rule is a DESIGN CONSTRAINT the drawing imposes and '
      + 'the AHJ inspects, not a measurement a nationwide product waits on: on a supply-side tap the fused disconnect is '
      + 'REQUIRED beside the tap point, so its placement is decided by the designer, not discovered by a crew. The engine '
      + 'now fixes the span at the 705.11(C) maximum and the drawing carries the placement requirement, so a constrained '
      + 'design does not raise this at all. It fires only when NOTHING constrains the span — no design placement rule and '
      + 'no routed geometry — i.e. when there is no limit an inspector could check against. A span that is constrained '
      + 'and BUSTS the limit is a different, louder finding: TAP-CONDUCTOR-LENGTH-EXCEEDED.',
  },
  // A KNOWN VIOLATION IS NOT A PENDING MEASUREMENT. When the span HAS positional
  // authority (routed geometry or a field measurement) and that number exceeds
  // the 10-ft limit, the design is wrong — reporting that as "…LENGTH-PENDING"
  // made the worse outcome read quieter than the uncertain one.
  'TAP-CONDUCTOR-LENGTH-EXCEEDED': {
    sheetLine: 'TAP SPAN EXCEEDS 10 FT — Relocate the disconnect or the tap point.',
    gateId: 'RG-5', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Supply-side tap span EXCEEDS the NEC 705.11(C) 10-ft limit',
    affects:
      'The supply-side interconnection as drawn. The tap conductor ampacity / OCPD sizing is unaffected — this is a '
      + 'PLACEMENT defect: the fused AC disconnect or the tap point has to move.',
    resolutionMode: 'OPERATOR_CONFIRMATION', residualMode: 'OPERATOR_CONFIRMATION',
    resolverId: null, resolverPhase: 'delivered (tapSpanAuthority)',
    modeBasis:
      '2026-08-28 — raised ONLY from positional authority (a routed CAD geometry between the placed devices, or a field '
      + 'measurement). A heuristic route estimate never reaches this code: an estimate can neither certify nor condemn, '
      + 'and asserting a code violation from one would be the original over-claim pointed the other way.',
  },
  // A run whose OWN estimated route already exceeds the length its selected
  // conductor permits at the schedule's Vd limit. This is a KNOWN DEFICIENCY,
  // not a missing measurement, and it must never be reported as one.
  'ROUTE-LENGTH-EXCEEDS-DESIGN-BOUND': {
    sheetLine: 'RUN EXCEEDS ITS DESIGN LIMIT — Upsize the conductor or shorten the route.',
    gateId: 'RG-5', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Routed length exceeds the maximum the selected conductor permits',
    affects:
      'The named run only. Its conductor will not meet the voltage-drop limit the conductor schedule grades '
      + 'it against at the length the layout implies.',
    resolutionMode: 'OPERATOR_CONFIRMATION', residualMode: 'OPERATOR_CONFIRMATION',
    resolverId: null, resolverPhase: 'delivered (routeLengthBound)',
    modeBasis:
      '2026-08-28 \u2014 the counterpart to the design LENGTH BOUND. A run the design bounds is not an estimate, '
      + 'and its bound has a failure mode: when the indicative route already exceeds the maximum the selected '
      + 'conductor permits, the run as laid out fails its own Vd limit. Resolved by upsizing the conductor or '
      + 'shortening the route \u2014 a design change, not a field measurement.',
  },
  'FEEDER-RACEWAY-AUTHORITY': {
    sheetLine: 'FEEDER RACEWAY UNRESOLVED — Raceway type and bonding method required.',
    gateId: 'RG-5', findingType: 'PENDING_SELECTION',
    title: 'Feeder raceway / conduit type not resolved on the canonical feeder segment',
    affects:
      'The feeder raceway schedule, its fill result and the raceway bonding method. Conductor ampacity and OCPD '
      + 'sizing are established independently.',
    resolutionMode: 'AUTO_DERIVED',
    resolverId: 'raceway-authority@v1', resolverPhase: 'AAC-4 (delivered)', resolverStage: 'derived',
    modeBasis: 'The raceway type/size for the canonical feeder is deterministic from the conductor set + environment — the same '
      + 'engine that computes conduit fill. Never an operator question. raceway-authority@v1 decides it from the engine\'s own '
      + 'feeder segment and records the verdict as evidence.',
  },
  'BRANCH-RACEWAY-AUTHORITY': {
    sheetLine: 'BRANCH RACEWAY MODEL INCOMPLETE — Open-air trunk and home-run must be distinct.',
    gateId: 'RG-5', findingType: 'PENDING_AUTHORITY',
    title: 'Branch raceway model incomplete — open-air trunk and shared home-run not distinct sections',
    affects:
      'The branch-circuit grouping, the shared home-run fill / derating and any per-section wiring-method callout. '
      + 'Branch OCPD and micro-count limits are unaffected.',
    resolutionMode: 'AUTO_DERIVED',
    resolverId: 'raceway-authority@v1', resolverPhase: 'AAC-4 (delivered)', resolverStage: 'derived',
    modeBasis: 'The two physical branch sections (open-air Q-Cable trunk + shared home-run raceway) are derivable from the '
      + 'canonical layout geometry the engine already holds; raceway-authority@v1 evaluates the sectioned model (shared '
      + 'home-run raceway with a documented shared-circuit count + fill, open-air trunk not stamped in-conduit) and evidences it.',
  },
  'RACEWAY-SEGMENT-CONFLICT': {
    sheetLine: 'RACEWAY CONFLICT — One physical run resolves to two raceway types.',
    gateId: 'RG-5', findingType: 'TECHNICAL_CONFLICT',
    title: 'A single physical segment resolves to more than one raceway type / size',
    affects:
      'Every raceway-schedule row for the conflicting segment id and its fill result — one physical run must carry '
      + 'ONE raceway.',
    resolutionMode: 'AUTO_DERIVED', residualMode: 'OPERATOR_CONFIRMATION',
    resolverId: 'raceway-authority@v1', resolverPhase: 'AAC-4 (delivered)', resolverStage: 'derived',
    modeBasis: 'One physical run carries one raceway — a deterministic reconciliation of the engine\'s own segment records, '
      + 'performed and evidenced by raceway-authority@v1. OPERATOR_CONFIRMATION only when two genuinely intentional raceway '
      + 'selections disagree.',
  },

  // A TS4-A-F is a SLAVE device: it holds its module on only while it receives a
  // PLC keep-alive and outputs 0.6 V without one, so the array does not energize
  // at all. Whether an EXTERNAL transmitter is needed depends on a per-MODEL fact
  // (does this inverter carry a factory-integrated Tigo RSS transmitter) that the
  // equipment catalogue does not record, and Tigo's own certification list cannot
  // supply it: of 355 UL-PVRSS-certified rows only 43 are "Tigo Enhanced", and
  // "Enhanced" itself means an integrated transmitter OR an integrated CCA. So
  // the QUANTITY is derived and the SELECTION is unverified — a candidate row,
  // never an orderable one, and never silent.
  'TIGO-RSS-TRANSMITTER-UNVERIFIED': {
    sheetLine: 'RAPID-SHUTDOWN SIGNAL SOURCE UNCONFIRMED — Verify the keep-alive transmitter.',
    gateId: 'RG-5', findingType: 'PENDING_SELECTION',
    title: 'Rapid-shutdown keep-alive source not established for the specified TS4 devices',
    affects:
      'The rapid-shutdown signalling path and the transmitter BOM row. Module-level device COUNT and placement are '
      + 'unaffected — what is unresolved is whether an external RSS transmitter is required, or already integrated in '
      + 'the selected inverter.',
    resolutionMode: 'OPERATOR_CONFIRMATION',
    resolverId: null, resolverPhase: 'Tigo companion-hardware pass',
    modeBasis:
      'The inverter→integrated-transmitter mapping is published per MODEL on Tigo\'s UL PVRSS list and is not a fact '
      + 'the engine holds or may infer. Keying off UL PVRSS certification under-states it (355 certified vs 43 Tigo '
      + 'Enhanced), and the list\'s method column records what a system was certified WITH, not what is built in. An '
      + 'operator confirms the exact model, or an external transmitter is ordered.',
  },

  // ── RG-6 QCABLE_SYSTEM_CLOSURE — WS-2 SCOPED PROCUREMENT RESIDUALS ─────────
  // WS-2 replaced the one broad Q-Cable blocker with a scoped requirement per
  // genuinely unresolved fact. Each names ONE thing, so a missing accessory SKU
  // can never masquerade as "the whole cable procurement is unresolved".
  'QCABLE-STOCK-PACKAGING-UNVERIFIED': {
    gateId: 'RG-6', findingType: 'PENDING_DOCUMENT',
    title: 'The purchasable package for the selected Q-Cable is not established',
    affects:
      'The purchase quantity and the expected remainder. The installed per-branch allocation is unaffected — what is '
      + 'missing is the manufacturer PACKAGE (connector sections per box), without which no order quantity may be stated.',
    resolutionMode: 'AUTO_DERIVED',
    resolverId: 'qcable-procurement@v1', resolverPhase: 'WS-2 (delivered)', resolverStage: 'derived',
    modeBasis: 'The packaging is read from the cable table in the archived manufacturer manual (connector count per box). '
      + 'A cable the archived table does not list has no established purchase unit, and a footage may not be substituted '
      + 'for one.',
  },
  'QCABLE-FIELD-CONNECTOR-SKU-MISSING': {
    gateId: 'RG-6', findingType: 'PENDING_DOCUMENT',
    title: 'A required Q-Cable field-termination accessory has no established SKU',
    affects:
      'The BOM accessory lines for the field-terminated joins. The cable allocation itself is established; the join '
      + 'hardware is not.',
    resolutionMode: 'AUTO_DERIVED',
    resolverId: 'qcable-procurement@v1', resolverPhase: 'WS-2 (delivered)', resolverStage: 'derived',
    modeBasis: 'Accessory SKUs and their per-unit quantity rules are read from the archived manufacturer manual; an '
      + 'accessory the manual does not name is not established and may not be ordered.',
  },
  'QCABLE-TERMINATOR-COMPATIBILITY-UNVERIFIED': {
    gateId: 'RG-6', findingType: 'PENDING_DOCUMENT',
    title: 'Q-Cable terminator compatibility with the selected assembly is not established',
    affects: 'The branch-end terminator lines in the BOM. Cable length and allocation are unaffected.',
    resolutionMode: 'AUTO_DERIVED',
    resolverId: 'qcable-procurement@v1', resolverPhase: 'WS-2 (delivered)', resolverStage: 'derived',
    modeBasis: 'The terminator SKU and its documented per-branch-circuit quantity are read from the archived manual.',
  },
  // ── RG-6 QCABLE_SYSTEM_CLOSURE (2) ────────────────────────────────────────
  // A MEASURED shortfall (Σ geometric installed path vs drop-based procurement
  // footage) — a verified deficiency, not a pending value.
  'QCABLE-PROCUREMENT-INSUFFICIENT': {
    sheetLine: 'BRANCH CABLE SHORT — Ordered cable does not cover the routed branch length.',
    gateId: 'RG-6', findingType: 'VERIFIED_DEFICIENCY',
    title: 'Ordered Q-Cable footage is SHORT of the designed-installed path',
    affects:
      'The orderable base cable quantity and the installed-path representation. Cleared ONLY by a VERIFIED listed '
      + 'cable-extension product, an alternate listed cable that envelopes the path, or a route revision.',
    resolutionMode: 'AUTO_DERIVED',
    resolverId: 'qcable-solution@v1', resolverPhase: 'AAC-4 (delivered)', resolverStage: 'derived',
    modeBasis: 'Audit §2.16 — the engine EVALUATES the option space (the stock order as placed, a geometry-derived order '
      + 'composition of the same listed cable, every alternate listed connector pitch in the catalog, a verified listed '
      + 'extension, a cable-end relocation, a branch reassignment, and the genuine field-route residual) and produces a '
      + 'complete solution or a precise unresolved reason — never a bare deficit. qcable-topology@v1 derives the topology '
      + 'object it reasons over; cable-extension-solutions@v1 (async) contributes the registry-backed extension half.',
  },
  'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED': {
    sheetLine: 'BRANCH GROUNDING METHOD PENDING — Manufacturer bonding document required.',
    gateId: 'RG-6', findingType: 'PENDING_AUTHORITY',
    title: 'Open-air branch grounding / bonding method not established by an exactly-applicable document',
    affects:
      'The equipment-grounding method, the NEC 250.122 / 690.43(C) conclusion and the candidate EGC quantity '
      + '(design quantity, non-orderable) — a conductor count can never establish it.',
    resolutionMode: 'AUTO_RETRIEVED', residualMode: 'PROFESSIONAL_APPROVAL',
    resolverId: null, resolverPhase: 'AAC-4',
    modeBasis: 'Audit §2.17 — `opts.groundingDocumentEvidence` is a pre-shaped socket the build accepts and nobody resolved; '
      + 'AAC-1 wires the socket through the bundle, AAC-4 adds the ingestion resolver. HIGHEST RISK IN THE SET: the exact-sku '
      + 'applicability scope may be unsatisfiable if Enphase publishes only family documents — in which case retrieval fails '
      + 'HONESTLY and this becomes professional judgement. `exact-sku` is never relaxed to clear a count.',
  },

  // ── RG-7 PROFESSIONAL_RELEASE (2) ─────────────────────────────────────────
  // An unassigned role is an ADMINISTRATIVE hold on the professional lane.
  'DESIGNER-OF-RECORD-MISSING': {
    sheetLine: 'DESIGNER OF RECORD NOT ASSIGNED — Assign before issue.',
    gateId: 'RG-7', findingType: 'ADMINISTRATIVE_HOLD',
    title: 'No designer / engineer-of-record assigned',
    resolutionMode: 'AUTO_DERIVED',
    resolverId: 'project-personnel-designer@v1', resolverPhase: 'AAC-2 (delivered — requires migration 115)',
    modeBasis: 'Audit §2.18 / WS-6 — the designer is a CONFIGURATION fact; asking for it per project is exactly the "never ask '
      + 'for what the platform knows" violation. The personnel-roles store is migration 115 (no `designer` column existed in any '
      + 'prior migration); until it is run the resolver reports a RETRYABLE store-unavailable failure with the exact operator step. '
      + 'HARD BOUNDARY: a configured designer clears the DESIGNER role only — it may never fabricate an EOR, PE, signature, seal '
      + 'or digest approval (enforced by AUTO_POPULATABLE_ROLES).',
  },
  // §7 MANDATED: PROFESSIONAL_RELEASE, derived from the ABSENCE of a digest-bound
  // approval record (certification.engineeringReviewApproved / the review record
  // consumed by deriveIssueState) — NOT from issue-state wording. No circularity:
  // this requirement's existence is decided by build.ts from the certification
  // record, and this module only classifies the record it finds.
  'ENGINEERING-REVIEW-PENDING': {
    sheetLine: 'AWAITING ENGINEER-OF-RECORD REVIEW AND SEAL.',
    gateId: 'RG-7', findingType: 'PROFESSIONAL_RELEASE',
    title: 'No approved engineering-review record covering the current snapshot digest',
    resolutionMode: 'PROFESSIONAL_APPROVAL', resolverId: null,
    resolverPhase: 'AAC-5 (delivered — migration 116 makes it CLEARABLE; the mode stays PROFESSIONAL_APPROVAL forever)',
    modeBasis: 'Audit §2.19 — legitimate and permanent PROFESSIONAL_APPROVAL, and the engine must NEVER hold a resolver for '
      + 'it. The real defect was that it was structurally UNCLEARABLE: no table, no API, no UI, and '
      + 'certification.engineeringReviewApproved hardcoded false. AAC-5 builds the digest-bound record (migration 116 '
      + 'engineering_review_records plus the admin API), so a licensed engineer of record CAN clear it — bound to an exact '
      + 'snapshot digest, with a licence number and state, a stated scope, and append-only supersession. The AUTO_DERIVED '
      + 'infrastructure resolver engineering-review-record@v1 only READS that store; it claims no requirement code and can '
      + 'never approve.',
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
export function deriveResponsibleRole(
  gateCategory: ReleaseGateCategory,
  findingType: ReleaseFindingType,
  /** 2026-08-29 - THE REQUIREMENT'S OWN CODE, so responsibility can follow the
   *  authority workflow instead of a static finding-type map. Optional: absent,
   *  the map below behaves exactly as it did. */
  requirementCode?: string,
  /** did the AUTOMATIC path already run and fail? Absent ⇒ unknown. */
  automaticPathExhausted?: boolean,
): ResponsibleRole {
  // ══ RESPONSIBILITY FOLLOWS THE AUTHORITY STATE ════════════════════
    // FRAMING-AUTHORITY-UNVERIFIED declares
  //     resolutionMode: 'AUTO_RETRIEVED', residualMode: 'PROFESSIONAL_APPROVAL'
  // and RS-1 explained, in its own row, that existing framing capacity cannot be
  // established automatically and must transition to professional approval - and
  // then printed "RESPONSIBLE: OPERATOR" on that same row. An operator cannot
  // close it. Nobody but a licensed engineer can.
  //
  // `requirementLane` already reads `residualMode ?? resolutionMode` to decide
  // the lane; responsibility must read the SAME field or the scorecard and the
  // row can disagree about who is waiting. A requirement may therefore CHANGE
  // owner as its authority state advances: the automatic phase belongs to
  // whoever the finding type implies, and the residual phase belongs to the
  // terminal actor.
  //
  // Default when the attempt state is unknown: the TERMINAL owner. An OPEN
  // requirement's owner is whoever must act if nothing else closes it, and
  // naming the operator there is what produced the contradiction.
  const _d = requirementCode ? REQUIREMENT_DECLARATIONS[requirementCode] : undefined;
  const _terminal = _d ? (_d.residualMode ?? _d.resolutionMode) : undefined;
  if (_terminal === 'PROFESSIONAL_APPROVAL' && automaticPathExhausted !== false) {
    return 'engineer-of-record';
  }
  if (_terminal === 'FIELD_VERIFICATION' && automaticPathExhausted !== false) {
    return 'operator';
  }
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
  /** 2026-08-29 - the lifecycle's per-requirement attempt trail
   *  (`snapshot.resolverAttemptEvidence.byRequirement`). It is what tells the
   *  model whether a requirement's AUTOMATIC path has already run and failed, so
   *  responsibility can transition to the residual owner. Optional: absent, a
   *  requirement whose terminal mode is professional is owned by the engineer
   *  of record, which is the honest answer for an OPEN requirement either way. */
  resolverAttempts?: Record<string, { lastResolutionResult?: string; attemptCount?: number }>;
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
  /** Has the AUTOMATIC path for this requirement already run and not closed it?
   *  `undefined` when no lifecycle evidence is present — see the field doc. */
  const _automaticExhausted = (code: string): boolean | undefined => {
    const a = input.resolverAttempts?.[code];
    if (!a) return undefined;
    if ((a.attemptCount ?? 0) === 0) return false;         // not tried yet
    return a.lastResolutionResult !== 'RESOLVED';
  };

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
        responsibleRole: deriveResponsibleRole(
          gateDef.gateCategory, findingType, r.code, _automaticExhausted(r.code)),
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
        ? deriveResponsibleRole(def.gateCategory, primary.findingType,
            primary.requirementCode, _automaticExhausted(primary.requirementCode))
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
  // The lane split. `requirementLane` reads the SAME declaration table the
  // release phase reads, so the phase, the counts and the sheets can never
  // disagree about which lane a requirement is in.
  const _design = unresolved.filter(q => requirementLane(q.requirementCode) === 'design');
  const _professional = unresolved.filter(q => requirementLane(q.requirementCode) !== 'design');
  const _designGateIds = new Set(_design.map(q => q.gateId));
  const summary: ReleaseSummary = {
    openGateCount: openGates.length,
    unresolvedRequirementCount: unresolved.length,
    advisoryCount: advisories.length,
    permitReady: readinessAxes.permitSubmission.ready,
    procurementReady: readinessAxes.procurement.ready,
    engineeringReviewReady,
    designRequirementCount: _design.length,
    openDesignGateCount: _designGateIds.size,
    professionalRequirementCount: _professional.length,
    designComplete: _design.length === 0,
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
    // the lifecycle's attempt trail, so responsibility can transition off the
    // automatic actor once that path has run and not closed the requirement.
    resolverAttempts: (snap as { resolverAttemptEvidence?: {
      byRequirement?: Record<string, { lastResolutionResult?: string; attemptCount?: number }> } } | null | undefined)
      ?.resolverAttemptEvidence?.byRequirement,
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
  // 2026-08-29 - RS-1 IS THE FULL RECORD. It keeps the TOTAL, because it is the
  // one surface that must account for every requirement and a reader (or the
  // cross-surface harness) has to be able to reconcile it against the registry.
  // What it gains is the LANE SPLIT, so the same header says both "everything
  // that is open" and "what is ours". The drawings carry the design scorecard
  // (releasePackageLine); this carries the whole truth.
  const split = summary.unresolvedRequirementCount > 0
    ? ` (${summary.designRequirementCount} DESIGN / ${summary.professionalRequirementCount} ENGINEER OF RECORD)` : '';
  const done = summary.designComplete && summary.unresolvedRequirementCount > 0 ? ' — DESIGN COMPLETE' : '';
  return `${g} / ${r}${split}${done} / ${a} / ${tail}`;
}


/** §4 — the PACKAGE-LEVEL count line every OTHER sheet prints above its own
 *  sheet-scoped requirement rows. A sheet states the package total in GATE
 *  semantics ("7 OPEN RELEASE GATES / 19 UNRESOLVED REQUIREMENTS") and points at
 *  RS-1 for the requirement detail — it never states "19 blockers", which
 *  misrepresents 19 children of 7 root gates as 19 independent failures. */
export function releasePackageLine(summary: ReleaseSummary, recordRef = 'SEE RS-1'): string {
  const a = summary.advisoryCount > 0
    ? ` / ${summary.advisoryCount} ADVISOR${summary.advisoryCount === 1 ? 'Y' : 'IES'}` : '';
  // 2026-08-28 - the tail said "ALL N REQUIREMENTS" where N summed requirements
  // AND advisories, re-labelling an advisory a requirement in the same sentence
  // that had just counted it separately. ITEMS is the honest collective noun.
  const _total = summary.unresolvedRequirementCount + summary.advisoryCount;
  const _tail = _total > 0
    ? ` — ${recordRef} FOR ALL ${_total} ITEM${_total === 1 ? '' : 'S'}` : '';

  // THE DESIGN SCORECARD. A sheet states what the DESIGN still owes; the
  // engineer-of-record step is NAMED as the next step in the workflow rather
  // than counted as one of our unresolved requirements.
  if (summary.designComplete) {
    const pe = summary.professionalRequirementCount > 0
      ? ' — READY FOR ENGINEER-OF-RECORD REVIEW AND SEAL' : '';
    return `PACKAGE RELEASE STATUS: DESIGN COMPLETE — 0 OPEN DESIGN REQUIREMENTS${a}${pe}${_tail}`;
  }
  const g = `${summary.openDesignGateCount} OPEN DESIGN GATE${summary.openDesignGateCount === 1 ? '' : 'S'}`;
  const r = `${summary.designRequirementCount} UNRESOLVED DESIGN REQUIREMENT${summary.designRequirementCount === 1 ? '' : 'S'}`;
  const pe = summary.professionalRequirementCount > 0
    ? ' — THEN ENGINEER-OF-RECORD REVIEW AND SEAL' : '';
  return `PACKAGE RELEASE STATUS: ${g} / ${r}${a}${pe}${_tail}`;
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
    // ── AAC WS-1 — every declared requirement carries EXACTLY ONE resolution
    //    mode, with a stated basis. A mode without a basis is an unsupported
    //    claim; a non-automatic mode may never own an auto-resolver. ──────────
    if (!(RESOLUTION_MODES as readonly string[]).includes(d.resolutionMode)) {
      errors.push(`${code}: invalid resolutionMode ${String(d.resolutionMode)}`);
    }
    if (!d.modeBasis?.trim()) errors.push(`${code}: resolutionMode ${d.resolutionMode} declared with no modeBasis`);
    if (d.resolverId && !isAutomaticMode(d.resolutionMode)) {
      errors.push(`${code}: ${d.resolutionMode} is not an automatic mode and may not declare resolverId ${d.resolverId}`);
    }
    if (d.residualMode && !(RESOLUTION_MODES as readonly string[]).includes(d.residualMode)) {
      errors.push(`${code}: invalid residualMode ${String(d.residualMode)}`);
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
