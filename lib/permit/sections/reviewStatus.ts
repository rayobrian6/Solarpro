// ═══════════════════════════════════════════════════════════════════════════
// RS-1: REVIEW STATUS — RELEASE GATES & REQUIREMENTS
//
// RGM §5 (2026-07-26) — the sheet now LEADS with the seven-row ROOT-GATE table
// (Gate · Category · Status · Unresolved · Release Impact · Primary Resolution ·
// Responsible Role) taken VERBATIM from the canonical release-gate model
// (projectReleaseGatesFromInput ⇒ deriveReleaseGateModel over
// permitReadiness.registry). Nothing on this sheet is re-derived, re-grouped or
// re-counted by the renderer: the gate rows, their counts, their impact axes and
// their primary resolution all come from the model accessor, and the child
// REQUIREMENTS are the model's requirements grouped by their ONE primary gate.
//
// What changed and why: every unresolved CHILD requirement used to present as an
// equal top-level blocker under a DOMAIN heading, so "15 OPEN RELEASE BLOCKERS"
// read as fifteen independent engineering failures instead of seven unresolved
// ROOT gates containing fifteen requirements. Every requirement is still printed,
// with its full authority path, explanation, resolution action, affected sheets,
// evidence reference and payload detail — nothing is suppressed, softened or
// merged. Only the PRESENTATION is hierarchical.
//
// W10 (RP-D): the dedicated, dense review-status sheet that enumerates EVERY
// active release blocker from the canonical permitReadiness.registry — blocking
// AND advisory, across every authority domain (electrical, structural, code,
// project/document, equipment-identity, equipment/document, project-identity).
//
// This is the renderer surface that ends the structural-else-everything ternary
// era: the REC-405-vs-Qcells-400 equipment-identity conflict, the code /
// tap-length / conduit-fill / route-estimate / designer-blank / TEST-name
// blockers are ALL listed here with their authority path, affected sheets, a
// human explanation and the resolution action. It reads ONLY the snapshot
// registry (never a renderer-local re-derivation) so gate 14 holds: no active
// blocker is absent from the rendered registry.
//
// Referenced from the cover's SHEET INDEX (RS-1). ASCII + HTML entities only.
// ═══════════════════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import type { PermitReadinessBlocker } from '../snapshot/types';
import { titleBlock } from '../utils/titleBlock';
import { escapeH } from '../utils/drawing';
import { peekSnapshot } from '../snapshot/read';
import { projectProjectAuthorityFromInput } from '../snapshot/projectAuthorityProjection';
import {
  deriveReleaseGateModel, projectReleaseGates, releaseHeadline, requirementAffects,
  RELEASE_GATE_DEFINITIONS,
  type ReleaseFindingType, type ReleaseGateModel, type ReleaseGateResult, type ReleaseRequirement,
} from '../snapshot/releaseGates';

// §18 (closeout 2026-07-23) — RS-1 legibility floor. Core blocker text was
// 6–6.5px (≈4.9pt at 17x11) — below the readable floor for a permit reviewer.
// Every blocker's authority path + resolution action is now printed at an
// effective ≥6.5pt (8.5px) and the registry paginates onto formal RS-1.n
// continuation sheets when it no longer fits one page at the larger size.
// Core blocker text at ≥6.5pt effective (8.7px ≈ 6.53pt at 17x11 96dpi) — was
// 6–6.5px (≈4.9pt), below the readable floor. Every authority path + resolution
// action is preserved (never abbreviated) at this size; page-fit stays strict.
const RS_FONT = {
  badge: '7.5px',
  code: '8.7px',
  issue: '8.7px',
  justification: '7.6px',
  resolution: '8.7px',
  sheets: '8.2px',
  domainHdr: '9px',
  // RGM §5 — the gate table + the per-requirement authority/evidence lines are
  // NEW text on this sheet and sit at the SAME ≥6.5pt effective floor (8.5px);
  // nothing was shrunk to make the hierarchy fit (that is what RS-1.1 is for).
  gateCell: '8.7px',
  gateHdrTitle: '10px',
  authority: '8.5px',
};

function sevBadge(sev: string): string {
  const blocking = sev === 'blocking';
  const bg = blocking ? '#b91c1c' : '#b45309';
  const label = blocking ? 'BLOCKING' : 'ADVISORY';
  return `<span style="display:inline-block;background:${bg};color:#fff;font-weight:900;font-size:${RS_FONT.badge};letter-spacing:0.5px;padding:1px 4px;border-radius:2px;white-space:nowrap;">${label}</span>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PPC §2 — BLOCKER-DETAIL COMPONENT SELECTION BY CANONICAL PAYLOAD SCHEMA
//
// THE defect this replaces: there was no selection at all. `payloadBlock(r)` was
// invoked unconditionally for every registry row and its only predicate was
// "payload is a non-null object" — so the ONE hardcoded template in the codebase,
// the Q-Cable PROCUREMENT-DEFICIT template, was bolted onto every blocker that
// carried any structured payload. The grounding blocker (which has a rich, fully
// correct payload of its own) shared exactly ONE field name with that template, so
// RS-1 rendered a "DEFICIT PAYLOAD" box of em-dashes — SKU —, drop spacing —,
// deficit — ft — on a blocker that has no deficit, plus a hardcoded literal string
// "mfr-doc authority null" that read no field at all.
//
// THE RULE: the detail component is chosen by the blocker's canonical PAYLOAD
// SCHEMA, keyed on its code. A schema-less code renders the GENERIC component
// (honest key/value pairs of what the payload actually carries) — never a foreign
// template's empty fields. Fail-safe: an unmapped code ⇒ 'generic'.
// ═══════════════════════════════════════════════════════════════════════════

/** The canonical payload schemas RS-1 can render. */
export type BlockerPayloadSchema =
  /** electrical.procurementSufficiency → procurementInsufficiencyPayload() */
  | 'qcable-procurement-deficit'
  /** electrical.openAirGroundingAuthority → the grounding-authority payload */
  | 'qcable-grounding-authority'
  /** no dedicated schema — render only the fields the payload actually has. */
  | 'generic';

/**
 * Code → payload schema. EVERY code the snapshot build can push is listed
 * explicitly (documentary + testable), so adding a payload-carrying blocker
 * without giving it a component is a visible omission rather than a silent
 * mis-render. Codes with no structured payload map to 'generic'.
 */
export const BLOCKER_PAYLOAD_SCHEMA: Record<string, BlockerPayloadSchema> = {
  // ── the TWO schema-typed payloads ─────────────────────────────────────────
  'QCABLE-PROCUREMENT-INSUFFICIENT': 'qcable-procurement-deficit',
  // WS-2 scoped residuals — each is a narrow, generically-rendered fact; only
  // the broad deficit has a bespoke payload template.
  'QCABLE-STOCK-PACKAGING-UNVERIFIED': 'generic',
  'QCABLE-FIELD-CONNECTOR-SKU-MISSING': 'generic',
  'QCABLE-TERMINATOR-COMPATIBILITY-UNVERIFIED': 'generic',
  'TIGO-RSS-TRANSMITTER-UNVERIFIED': 'generic',
  'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED': 'qcable-grounding-authority',
  // ── electrical ────────────────────────────────────────────────────────────
  'ROUTE-LENGTH-ESTIMATE': 'generic',
  'FEEDER-RACEWAY-AUTHORITY': 'generic',
  'BRANCH-RACEWAY-AUTHORITY': 'generic',
  'RACEWAY-SEGMENT-CONFLICT': 'generic',
  'CONDUIT-FILL-PENDING': 'generic',
  'TAP-CONDUCTOR-LENGTH-PENDING': 'generic',
  'TAP-CONDUCTOR-LENGTH-EXCEEDED': 'generic',
  'ROUTE-LENGTH-EXCEEDS-DESIGN-BOUND': 'generic',
  // ── structural (structuralAuthority.blockers) ─────────────────────────────
  'FRAMING-AUTHORITY-UNVERIFIED': 'generic',
  'PENDING-RACKING-ASSEMBLY-SELECTION': 'generic',
  'RACKING-RAIL-CAPACITY-UNBOUNDED': 'generic',
  'FASTENER-ASSEMBLY-UNVERIFIED': 'generic',
  'FASTENER-CONFIG-MISSING': 'generic',
  'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED': 'generic',
  'ATTACHMENT-CAPACITY-SOURCE-MISSING': 'generic',
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED': 'generic',
  'MOUNT-TOPOLOGY-UNKNOWN': 'generic',
  'DIRECT-MOUNT-GEOMETRY-MISSING': 'generic',
  'REACTIONS-UNTRACEABLE': 'generic',
  'RAIL-QUANTITY-UNTRACEABLE': 'generic',
  'STRUCTURAL-UTILIZATION-EXCEEDED': 'generic',
  'STRUCTURAL-BOM-RECONCILIATION-FAILED': 'generic',
  'STRUCTURAL-REACTION-RECONCILIATION-FAILED': 'generic',
  'SITE-GEOMETRY-MISSING': 'generic',
  'MODULE-DIMENSIONS-UNVERIFIED': 'generic',
  // ── racking capacity provenance (rackingAssembly.structuralAuthorityGaps) ──
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED': 'generic',
  'RACKING-CAPACITY-APPLICABILITY-GAP': 'generic',
  'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED': 'generic',
  // ── equipment / document ──────────────────────────────────────────────────
  'EQUIPMENT-IDENTITY-CONFLICT': 'generic',
  'EQUIPMENT-DOCUMENT-APPLICABILITY': 'generic',
  'EQUIPMENT-DOCUMENT-UNVERIFIED': 'generic',
  'MODULE-EXACT-DATASHEET-PENDING': 'generic',
  // ── code / project / review ───────────────────────────────────────────────
  'CODE-AUTHORITY-INCOMPLETE': 'generic',
  'CODE-AUTHORITY-CONFLICT': 'generic',
  'PROJECT-AUTHORITY-UNVERIFIED': 'generic',
  'PROJECT-NAME-NONPRODUCTION': 'generic',
  'DESIGNER-OF-RECORD-MISSING': 'generic',
  'ENGINEERING-REVIEW-PENDING': 'generic',
  // legacy aliases still recognised by classifyBlockerDomain (RGM: the table is
  // kept in lockstep with REQUIREMENT_DECLARATIONS — a declared requirement code
  // with no payload component is an omission, and the sync is asserted by test).
  'WIND-SNOW-AUTHORITY-UNRESOLVED': 'generic',
  'STRUCTURAL-FRAMING-UNVERIFIED': 'generic',
};

/** Fail-safe accessor: an unmapped code can only ever reach the GENERIC
 *  component — it can never inherit another blocker's template. */
export function blockerPayloadSchema(code: string): BlockerPayloadSchema {
  return BLOCKER_PAYLOAD_SCHEMA[code] ?? 'generic';
}

const _pBox = (accent: string, title: string, body: string, schema: BlockerPayloadSchema): string =>
  // PPC §2 / gate 3 — the box carries the SCHEMA it was selected by, so a rendered-
  // truth harness can assert "this blocker's payload component is the one its
  // canonical schema mandates" per row, rather than inferring it from a heading.
  `<div data-blocker-payload-schema="${schema}" style="margin-top:1px;font-size:${RS_FONT.justification};line-height:1.25;color:#334155;border-left:2px solid ${accent};padding-left:4px;">`
  + `<span style="font-weight:900;color:${accent};">${title}</span> ${body}</div>`;

const _s = (v: unknown): string => escapeH(v == null || v === '' ? '—' : String(v));

/** COMPONENT — Q-Cable procurement deficit (electrical.procurementSufficiency). */
function payloadProcurementDeficit(p: Record<string, unknown>): string {
  const perBranch = Array.isArray(p.perBranchPaths)
    ? (p.perBranchPaths as Array<Record<string, unknown>>)
      .map(b => `${escapeH(String(b.branchLabel))} ${b.dropCount}d ${b.designedInstalledLengthFt ?? '—'}/${b.procurementLengthFt ?? '—'}ft`)
      .join(' · ')
    : '';
  const opts = Array.isArray(p.resolutionOptions)
    ? (p.resolutionOptions as Array<Record<string, unknown>>)
      .map(o => `${escapeH(String(o.kind))}=${o.selected ? 'SEL' : 'NOT SEL'}`).join(' · ')
    : '';
  return _pBox('#b91c1c', 'DEFICIT PAYLOAD:',
    `SKU ${_s(p.selectedQCableSku)} @ ${_s(p.connectorDropSpacingFt)}ft drop · `
    + `designed ${_s(p.totalDesignedInstalledFt)}ft + allowance ${_s(p.requiredServiceLoopAllowanceFt)}ft (${_s(p.allowanceProvenance)}) `
    + `vs procurement ${_s(p.procurementLengthFt)}ft ⇒ <span style="color:#b91c1c;font-weight:900;">deficit ${_s(p.deficitFt)} ft</span> · `
    + `branches ${escapeH(perBranch)} · affected ${escapeH((p.affectedBranchIds as unknown[] ?? []).join(', ') || '—')} · `
    // reads the FIELD (the retired template hardcoded the literal string "null")
    + `mfr-doc authority ${_s(p.manufacturerDocumentAuthority)} · status ${_s(p.verificationStatus)} · resolution: ${escapeH(opts)}`,
    'qcable-procurement-deficit');
}

/** COMPONENT — open-air grounding authority (electrical.openAirGroundingAuthority).
 *  Ray's field list: selected micro SKU, Q-Cable SKU, authority result, verification
 *  state, applicable manufacturer document, document hash, applicability, equipment
 *  classification, candidate EGC quantity + orderability, resolution action,
 *  affected segment ids. NO procurement-deficit fields. */
function payloadGroundingAuthority(p: Record<string, unknown>): string {
  const av = (p.applicabilityVerification ?? null) as {
    verdict?: string; failures?: string[];
  } | null;
  const bond = (p.rackingModuleBondingRequirement ?? null) as
    { required?: boolean; codeBasis?: string } | null;
  const hash = p.documentHash ? String(p.documentHash).slice(0, 12) : null;
  const nonOrderable = p.bomRowState === 'design-quantity-non-orderable';
  const segIds = Array.isArray(p.affectedSegmentIds)
    ? (p.affectedSegmentIds as unknown[]).join(', ')
    : Array.isArray(p.segmentIds) ? (p.segmentIds as unknown[]).join(', ')
      : Array.isArray(p.branchIds) ? (p.branchIds as unknown[]).join(', ') : '';
  return _pBox('#b45309', 'GROUNDING AUTHORITY PAYLOAD:',
    `selected micro <span class="mono">${_s(p.selectedMicroinverterSku)}</span> + cable assembly <span class="mono">${_s(p.selectedCableAssemblySku)}</span>`
    + ` (module ${_s(p.selectedModuleSku)}, mount/bonding ${_s(p.selectedMountingBondingSystem)}, jurisdiction ${_s(p.projectJurisdiction)}) · `
    + `<span style="font-weight:900;color:#b45309;">authority result ${_s(p.outcome)}</span> · verification ${_s(p.verificationStatus)} · `
    + `manufacturer document ${_s(p.documentId)}${p.documentSectionOrPage ? ` (${_s(p.documentSectionOrPage)})` : ''} · SHA-256 ${hash ? escapeH(hash) : 'NONE'} · `
    + `applicability ${_s(av?.verdict)}${av?.failures?.length ? ` — ${escapeH(String(av.failures[0]))}` : ''} · `
    + `equipment classification ${_s(p.equipmentInsulationClassification)} · `
    + `conductor construction ${_s(p.cableConductorCount)}-conductor${p.cableConductorConstruction ? ` (${_s(p.cableConductorConstruction)})` : ''} `
    + `— <strong>NON-DETERMINATIVE</strong> · `
    + `candidate EGC ${_s(p.candidateQuantityFt)} ft — <span style="font-weight:900;color:#b45309;">${nonOrderable ? 'NON-ORDERABLE (candidate design quantity, not part of the approved installation)' : escapeH(String(p.bomRowState ?? '—'))}</span> · `
    + `affected segments ${escapeH(segIds || '—')} · `
    + `module/racking bonding ${bond?.required ? 'REQUIRED — independent' : _s(bond?.required)} (${_s(bond?.codeBasis)}) · `
    + `resolution: archive + verify the exact-SKU manufacturer grounding document (see RESOLUTION ACTION)`,
    'qcable-grounding-authority');
}

// ═══════════════════════════════════════════════════════════════════════════
// D9 — RUN-ATTEMPT INSTANTS ARE OPERATIONAL DATA, NOT ARTIFACT CONTENT.
//
// The design digest already EXCLUDES resolver attempt instants from the signed
// projection, and that exclusion is correct — but RS-1 rendered them anyway, via
// payloadGeneric, which printed every primitive the payload carried. Measured on
// the live Braidon package: nine occurrences of one sub-second instant
// (`lastResolutionAttempt`), producing nine differing HTML lines out of 5201
// between two regenerations of a design that had not changed. An issued
// package's stored bytes could therefore never be compared against a re-render.
//
// The fix is at the RENDER only. The values stay in the snapshot payload and in
// audit storage — nothing is hidden and nothing about the digest changes.
//
// TWO guards, deliberately redundant:
//   1. a named key list — the fields known to carry a resolver run instant;
//   2. a VALUE-SHAPE guard — any string that is a full ISO-8601 date-TIME.
// The second is what stops the next payload field from quietly reintroducing
// this. A date-ONLY value (the jurisdiction-zone issue date convention used by
// meta.generatedAtIso) is unaffected: it has no time component.
// ═══════════════════════════════════════════════════════════════════════════

/** Payload keys that carry an operational resolver run instant. */
export const RUN_INSTANT_PAYLOAD_KEYS: readonly string[] = [
  'lastResolutionAttempt',
  'attemptedAtIso',
  'startedAtIso',
  'retrievedAtIso',
  'resolvedAtIso',
  'atIso',
];

/** An ISO-8601 value carrying a TIME component (the thing that moves per run).
 *  Date-only values (`2026-08-05`) and locale dates (`8/5/2026`) do not match. */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** True when this key/value pair is an operational run instant and must not be
 *  rendered into the issued artifact. */
export function isRunInstantPayloadEntry(key: string, value: unknown): boolean {
  if (RUN_INSTANT_PAYLOAD_KEYS.includes(key)) return true;
  return typeof value === 'string' && ISO_INSTANT_RE.test(value.trim());
}

/** COMPONENT — GENERIC. Renders ONLY the primitive fields the payload actually
 *  carries, so an unknown schema can never print another template's empty fields.
 *  Operational run instants are excluded (D9) — they remain in the payload and in
 *  audit storage, but an unchanged design must render byte-identically. */
function payloadGeneric(p: Record<string, unknown>): string {
  const pairs = Object.entries(p)
    .filter(([, v]) => v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .filter(([k, v]) => !isRunInstantPayloadEntry(k, v))
    .map(([k, v]) => `${escapeH(k)} ${escapeH(String(v))}`);
  const nested = Object.entries(p)
    .filter(([, v]) => v != null && typeof v === 'object')
    .map(([k]) => escapeH(k));
  if (!pairs.length && !nested.length) return '';
  return _pBox('#475569', 'BLOCKER PAYLOAD:',
    `${pairs.join(' · ')}${nested.length ? `${pairs.length ? ' · ' : ''}structured: ${nested.join(', ')} (see the canonical object model)` : ''}`,
    'generic');
}

/** THE dispatcher — component selected by canonical payload schema, never by
 *  "payload is an object". */
export function renderBlockerPayload(r: PermitReadinessBlocker): string {
  const p = r.payload;
  if (!p || typeof p !== 'object') return '';
  const schema = blockerPayloadSchema(r.code);
  switch (schema) {
    case 'qcable-procurement-deficit': return payloadProcurementDeficit(p);
    case 'qcable-grounding-authority': return payloadGroundingAuthority(p);
    default: return payloadGeneric(p);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RGM §5 — VISUAL TREATMENT BY FINDING TYPE (the seven treatment classes).
//
// BLACK-AND-WHITE LEGIBILITY IS THE CONTRACT (permanent gate 17): a permit set
// is printed and photocopied in monochrome, so a treatment may NEVER be carried
// by hue alone. Every class therefore differs from every other class in at least
// TWO hue-free channels — border-left STYLE (solid / double / dashed / dotted /
// groove / ridge), border-left WIDTH, fill LUMINANCE, and the chip's font
// WEIGHT / STYLE / DECORATION. The colour values only add on-screen emphasis on
// top of an already-distinguishable monochrome design.
//
// The seven classes are exactly the directive's list: root-gate hold · strong
// (technical conflicts AND verified deficiencies) · pending · field ·
// administrative · review-workflow · advisory.
// ═══════════════════════════════════════════════════════════════════════════

export type FindingTreatmentClass =
  | 'root-gate-hold' | 'strong' | 'pending' | 'field'
  | 'administrative' | 'review-workflow' | 'advisory';

export interface FindingTreatment {
  cls: FindingTreatmentClass;
  /** fill (luminance carries the class in monochrome) */
  fill: string;
  /** left rule: width + style are the primary monochrome signal */
  borderWidth: string;
  borderStyle: string;
  borderColor: string;
  /** chip typography — the secondary monochrome signal */
  chipWeight: string;
  chipStyle: string;
  chipDecoration: string;
  chipSpacing: string;
  /** ink colour for the chip text (screen emphasis only) */
  ink: string;
}

const TREATMENTS: Record<FindingTreatmentClass, FindingTreatment> = {
  // the ROOT gate rows / gate group headers — an inverted solid black band
  'root-gate-hold': {
    cls: 'root-gate-hold', fill: '#111111', borderWidth: '5px', borderStyle: 'solid', borderColor: '#000000',
    chipWeight: '900', chipStyle: 'normal', chipDecoration: 'none', chipSpacing: '0.8px', ink: '#ffffff',
  },
  // CONFIRMED conditions: a technical conflict or a verified deficiency. Heaviest
  // requirement treatment — double rule + darkest fill + underlined chip.
  strong: {
    cls: 'strong', fill: '#e4e4e4', borderWidth: '5px', borderStyle: 'double', borderColor: '#000000',
    chipWeight: '900', chipStyle: 'normal', chipDecoration: 'underline', chipSpacing: '0.5px', ink: '#7f1d1d',
  },
  // PENDING authority / document / selection — an established fact is MISSING;
  // nothing has failed. Dashed rule (an open edge), light fill.
  pending: {
    cls: 'pending', fill: '#f5f5f5', borderWidth: '3px', borderStyle: 'dashed', borderColor: '#333333',
    chipWeight: '700', chipStyle: 'normal', chipDecoration: 'none', chipSpacing: '0.3px', ink: '#7c2d12',
  },
  // FIELD VERIFICATION — a real measurement is owed. Dotted rule, white fill.
  field: {
    cls: 'field', fill: '#ffffff', borderWidth: '3px', borderStyle: 'dotted', borderColor: '#333333',
    chipWeight: '700', chipStyle: 'italic', chipDecoration: 'none', chipSpacing: '0.3px', ink: '#1e3a5f',
  },
  // ADMINISTRATIVE HOLD — identity / naming / role assignment. NOT an
  // engineering failure (§7). Grooved rule reads as a recessed administrative bar.
  administrative: {
    cls: 'administrative', fill: '#efefef', borderWidth: '4px', borderStyle: 'groove', borderColor: '#444444',
    chipWeight: '700', chipStyle: 'normal', chipDecoration: 'none', chipSpacing: '1.4px', ink: '#334155',
  },
  // PROFESSIONAL RELEASE — a workflow signature, NOT a technical defect (§7).
  'review-workflow': {
    cls: 'review-workflow', fill: '#f9f9f9', borderWidth: '4px', borderStyle: 'ridge', borderColor: '#444444',
    chipWeight: '700', chipStyle: 'italic', chipDecoration: 'none', chipSpacing: '1.4px', ink: '#3730a3',
  },
  // ADVISORY — surfaced, not gating. Lightest rule, plain italic chip.
  advisory: {
    cls: 'advisory', fill: '#fdfdfd', borderWidth: '2px', borderStyle: 'solid', borderColor: '#999999',
    chipWeight: '400', chipStyle: 'italic', chipDecoration: 'none', chipSpacing: '0px', ink: '#7c5b12',
  },
};

/** THE finding-type ⇒ treatment map (§5's seven classes). Total: an unknown
 *  finding type can only ever fall to the HEAVIEST requirement treatment, never
 *  to advisory — a condition the renderer does not recognise is never softened. */
export function findingTreatment(t: ReleaseFindingType): FindingTreatment {
  switch (t) {
    case 'TECHNICAL_CONFLICT':
    case 'VERIFIED_DEFICIENCY': return TREATMENTS.strong;
    case 'PENDING_AUTHORITY':
    case 'PENDING_DOCUMENT':
    case 'PENDING_SELECTION': return TREATMENTS.pending;
    case 'FIELD_VERIFICATION': return TREATMENTS.field;
    case 'ADMINISTRATIVE_HOLD': return TREATMENTS.administrative;
    case 'PROFESSIONAL_RELEASE': return TREATMENTS['review-workflow'];
    case 'ADVISORY': return TREATMENTS.advisory;
    default: return TREATMENTS.strong;
  }
}

export const ROOT_GATE_TREATMENT = TREATMENTS['root-gate-hold'];
/** All treatment signatures, for the black-and-white legibility gate. */
export function findingTreatmentTable(): FindingTreatment[] {
  return Object.values(TREATMENTS);
}

/** Human label for a finding type (§7 wording — never failure wording for a
 *  pending authority, never "engineering failure" for a workflow item). */
const FINDING_LABEL: Record<ReleaseFindingType, string> = {
  TECHNICAL_CONFLICT: 'TECHNICAL CONFLICT',
  VERIFIED_DEFICIENCY: 'VERIFIED DEFICIENCY',
  PENDING_SELECTION: 'PENDING SELECTION',
  PENDING_DOCUMENT: 'PENDING DOCUMENT',
  PENDING_AUTHORITY: 'PENDING AUTHORITY',
  FIELD_VERIFICATION: 'FIELD VERIFICATION',
  ADMINISTRATIVE_HOLD: 'ADMINISTRATIVE HOLD',
  PROFESSIONAL_RELEASE: 'PROFESSIONAL RELEASE',
  ADVISORY: 'ADVISORY',
};

const ROLE_LABEL: Record<string, string> = {
  operator: 'OPERATOR',
  designer: 'DESIGNER',
  'engineer-of-record': 'ENGINEER OF RECORD',
  admin: 'ADMINISTRATOR',
};

const CATEGORY_LABEL: Record<string, string> = {
  ADMINISTRATIVE_CODE_AUTHORITY: 'ADMINISTRATIVE / CODE AUTHORITY',
  EQUIPMENT_AUTHORITY: 'EQUIPMENT AUTHORITY',
  STRUCTURAL_AUTHORITY: 'STRUCTURAL AUTHORITY',
  ELECTRICAL_CLOSURE: 'ELECTRICAL CLOSURE',
  PROCUREMENT_CLOSURE: 'PROCUREMENT CLOSURE',
  PROFESSIONAL_WORKFLOW: 'PROFESSIONAL WORKFLOW',
  UNMAPPED: 'UNMAPPED (FAIL-CLOSED)',
};

/** The blocked RELEASE axes, spelled out (empty ⇒ nothing blocked). */
function impactLabel(g: ReleaseGateResult): string {
  const i = g.releaseImpact;
  const on = [
    i.permitSubmission ? 'PERMIT SUBMISSION' : '',
    i.procurement ? 'PROCUREMENT' : '',
    i.engineeringReview ? 'ENGINEERING REVIEW' : '',
    i.construction ? 'CONSTRUCTION' : '',
    i.administrativeRelease ? 'ADMINISTRATIVE RELEASE' : '',
  ].filter(Boolean);
  return on.length ? on.join(' · ') : 'NONE BLOCKED';
}

/** The gate's BASE description (the model appends the per-child `affects`
 *  clauses to gate.description; each child prints its own AFFECTS line, so the
 *  group header prints the base text once and never duplicates them). */
function gateBaseDescription(gateId: string): string {
  return RELEASE_GATE_DEFINITIONS.find(d => d.gateId === gateId)?.description ?? '';
}

const chip = (t: FindingTreatment, label: string): string =>
  `<span data-finding-treatment="${t.cls}" style="display:inline-block;margin-top:1px;font-size:7.6px;`
  + `font-weight:${t.chipWeight};font-style:${t.chipStyle};text-decoration:${t.chipDecoration};`
  + `letter-spacing:${t.chipSpacing};color:${t.ink};border-left:${t.borderWidth} ${t.borderStyle} ${t.borderColor};`
  + `padding-left:3px;background:${t.fill};white-space:nowrap;">${label}</span>`;

// ═══════════════════════════════════════════════════════════════════════════
// RGM §5 — RS-1 PAGINATION (RS-1 → RS-1.1 → …) on the EXISTING machinery.
//
// Same contract as SCHED-n / PV-4C.1: ONE deterministic page-count function
// shared by the sheet manifest (cover index + snapshot sheetIndex) and the page
// assembly, so the printed index can never disagree with the rendered pages.
//
// The gate table + the summary strip live on RS-1; the requirement GROUPS pack
// onto RS-1 and then onto RS-1.n continuation sheets. A group may split across a
// page boundary (its header reprints with "(CONTINUED)") — a 6-child structural
// gate must never be able to overflow a page.
//
// Heights are ESTIMATED from the canonical text lengths at the rendered font
// sizes and column widths (17x11 landscape, 96dpi, 1.72in title strip reserved).
// Estimates are deliberately CONSERVATIVE: the page-fit gate (H+V clipping zero)
// is what proves them, and it is run on every regenerated package.
// ═══════════════════════════════════════════════════════════════════════════

/** Printable content height (px @96dpi). MEASURED, not assumed: the geometry
 *  page-fit harness reports `page-content` clientH = 998px on this envelope
 *  (11in − 0.28in top − 0.16in bottom padding, less the title-strip row), and a
 *  44px SAFETY MARGIN is held back because the estimates below are text-length
 *  approximations of a wrapped table layout. Under-filling a page costs nothing;
 *  over-filling one clips a permit requirement. */
const RS_PAGE_H = 998 - 20;
/** `.page-content` flex gap-section (16px) + each block's 2px margin-top. */
const RS_BLOCK_GAP = 18;
/** height consumed on RS-1 by the release-status strip. */
const RS_STRIP_H = 84;
/** height consumed on a CONTINUATION sheet by its compact status line. */
const RS_CONT_HDR_H = 26;
/** height consumed by the footer provenance note (every RS sheet). */
const RS_FOOTER_H = 34;
/** the root-gate table: header + one row per DEFINED gate rendered. */
const RS_GATE_TABLE_HDR_H = 24;
const RS_GATE_ROW_H = 36;
/** a requirement group header (gate title line + base description). */
const RS_GROUP_HDR_H = 15;
const RS_LINE_H = 11;          // 8.7px text at line-height 1.22 ≈ 10.6px
const RS_SMALL_LINE_H = 10;    // 7.6px payload/justification text
const RS_DESC_LINE_H = 10;     // 7.4px gate-description text
const RS_ROW_PAD_H = 8;        // cell padding + border per requirement row
const RS_TABLE_HDR_H = 17;     // the requirement table's column header

/** chars per line, per column, at the rendered font size and column width. */
const RS_COLS = { issue: 138, resolution: 91, code: 21, sheets: 9, payload: 178, desc: 250 };

const linesFor = (s: string, perLine: number): number =>
  Math.max(1, Math.ceil((s ? s.length : 1) / perLine));

/** Estimated rendered height of ONE requirement row (with its payload box). */
function requirementRowHeight(q: ReleaseRequirement, r: PermitReadinessBlocker | null): number {
  const issue = RS_LINE_H * (
    linesFor(q.title, RS_COLS.issue)
    + linesFor(q.explanation, RS_COLS.issue)
    // authority path + evidence references share ONE wrapped block
    + linesFor(`AUTHORITY PATH: ${q.authorityPath} EVIDENCE: ${q.evidenceReferences.join(' ')}`, RS_COLS.issue));
  const affects = requirementAffects(q.requirementCode);
  const resolution = RS_LINE_H * (
    linesFor(q.resolutionAction, RS_COLS.resolution)
    + 1                                                       // RESPONSIBLE line
    + (affects ? linesFor(`AFFECTS: ${affects}`, RS_COLS.resolution) : 0));
  const code = RS_LINE_H * linesFor(q.requirementCode, RS_COLS.code) + RS_LINE_H;   // + chip
  const justification = (r?.severity === 'warning' && r.justification)
    ? RS_SMALL_LINE_H * linesFor(r.justification, RS_COLS.payload) : 0;
  const payload = r ? RS_SMALL_LINE_H * payloadLineEstimate(r) : 0;
  return Math.max(issue + justification + payload, resolution, code) + RS_ROW_PAD_H;
}

/** Estimated line count of the rendered payload detail box (0 ⇒ no payload).
 *  Measured off the ACTUAL rendered component (tags stripped), so a rich payload
 *  such as the grounding-authority box is budgeted at its real size. */
function payloadLineEstimate(r: PermitReadinessBlocker): number {
  const html = renderBlockerPayload(r);
  if (!html) return 0;
  const textLen = html.replace(/<[^>]+>/g, ' ').length;
  return Math.max(1, Math.ceil(textLen / RS_COLS.payload)) + 1;
}

interface RsBlock {
  gateId: string;
  /** the group header block (rendered once per page the group appears on). */
  headerH: number;
  rows: { q: ReleaseRequirement; r: PermitReadinessBlocker | null; h: number }[];
}

/** The paginated layout: which gate groups (and which of their rows) land on
 *  which RS sheet. ONE function — the manifest and the renderer both call it. */
export interface RsLayoutPage { blocks: { gateId: string; continued: boolean; rows: RsBlock['rows'] }[] }

export function reviewStatusLayout(
  registry: readonly PermitReadinessBlocker[],
): { pages: RsLayoutPage[]; model: ReleaseGateModel } {
  const active = (registry ?? []).filter(r => !r.resolved);
  const model = deriveReleaseGateModel({
    registry: registry ?? [], snapshotId: '', snapshotDigest: '',
  });
  // one registry RECORD per requirement, in the model's order (records are 1:1
  // with requirements, including legitimate duplicate codes).
  const used = new Set<PermitReadinessBlocker>();
  const recordFor = (q: ReleaseRequirement): PermitReadinessBlocker | null => {
    const hit = active.find(r => r.code === q.requirementCode && !used.has(r)
      && r.explanation === q.explanation);
    const fallback = hit ?? active.find(r => r.code === q.requirementCode && !used.has(r)) ?? null;
    if (fallback) used.add(fallback);
    return fallback;
  };

  const openRequirements = model.requirements.filter(q => q.status === 'OPEN');
  const blocks: RsBlock[] = [];
  for (const g of model.gates) {
    const rows = openRequirements.filter(q => q.gateId === g.gateId).map(q => {
      const r = recordFor(q);
      return { q, r, h: requirementRowHeight(q, r) };
    });
    if (!rows.length) continue;
    blocks.push({
      gateId: g.gateId,
      headerH: RS_GROUP_HDR_H + RS_DESC_LINE_H * linesFor(gateBaseDescription(g.gateId), RS_COLS.desc) + RS_TABLE_HDR_H,
      rows,
    });
  }

  const gateRows = model.gates.filter(g => g.totalRequirementCount > 0 || g.status === 'OPEN').length
    || model.gates.length;
  const firstCapacity = RS_PAGE_H
    - (RS_STRIP_H + RS_BLOCK_GAP)
    - (RS_FOOTER_H + RS_BLOCK_GAP)
    - (RS_GATE_TABLE_HDR_H + RS_GATE_ROW_H * gateRows + RS_BLOCK_GAP);
  const contCapacity = RS_PAGE_H - (RS_CONT_HDR_H + RS_BLOCK_GAP) - (RS_FOOTER_H + RS_BLOCK_GAP);

  /**
   * Greedy packing, deterministic and total: a group's header must fit together
   * with at least ONE of its rows, otherwise the group starts on a fresh page. A
   * single row taller than a whole page still renders (placed alone) — the
   * page-fit gate then reports it rather than the layout looping forever.
   *
   * `budget` scales the per-page capacity for the BALANCING pass below (1 = the
   * real printable capacity).
   */
  const pack = (budget: number): RsLayoutPage[] => {
    const out: RsLayoutPage[] = [{ blocks: [] }];
    let capacity = Math.min(firstCapacity, Math.max(120, firstCapacity * budget));
    let usedH = 0;
    const newPage = (): void => {
      out.push({ blocks: [] });
      capacity = Math.min(contCapacity, Math.max(120, contCapacity * budget));
      usedH = 0;
    };
    for (const b of blocks) {
      let i = 0;
      let continued = false;
      while (i < b.rows.length) {
        const headerH = (continued ? RS_GROUP_HDR_H + RS_TABLE_HDR_H : b.headerH) + RS_BLOCK_GAP;
        const pageIsEmpty = out[out.length - 1].blocks.length === 0;
        if (!pageIsEmpty && usedH + headerH + b.rows[i].h > capacity) { newPage(); continue; }
        const target = { gateId: b.gateId, continued, rows: [] as RsBlock['rows'] };
        out[out.length - 1].blocks.push(target);
        usedH += headerH;
        // always take at least one row so the loop strictly advances
        do {
          target.rows.push(b.rows[i]);
          usedH += b.rows[i].h;
          i++;
        } while (i < b.rows.length && usedH + b.rows[i].h <= capacity);
        if (i < b.rows.length) { newPage(); continued = true; }
      }
    }
    return out;
  };

  // ── pass 1: how many sheets does this registry genuinely need? ────────────
  const packed = pack(1);
  const need = packed.length;
  // ── pass 2 (BALANCING): spread the requirements evenly across those sheets.
  // Greedy packing fills each page to the brim and leaves the LAST sheet nearly
  // empty — on the Braidon fixture that produced a final RS sheet carrying one
  // 94px requirement group in a 998px box. Dead space on a permit sheet reads as
  // an unfinished drawing, so the same content is re-packed against a reduced
  // per-page budget, taking the SMALLEST budget that still fits in `need` sheets.
  // Page count (and therefore the sheet manifest) is decided by pass 1 and can
  // never grow here — if a budget overflows the sheet count it is rejected.
  let best = packed;
  for (const budget of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const candidate = pack(budget);
    if (candidate.length === need) { best = candidate; break; }
  }
  return { pages: best, model };
}

/** Number of RS-1 CONTINUATION sheets (0 ⇒ everything fits on RS-1). Shared by
 *  the sheet manifest and the page assembly so page count == sheet index. */
export function reviewStatusContPageCount(registry: readonly PermitReadinessBlocker[] | null | undefined): number {
  if (!registry || !registry.length) return 0;
  return Math.max(0, reviewStatusLayout(registry).pages.length - 1);
}

/** Continuation sheet ids for a registry (RS-1.1, RS-1.2, …). */
export function reviewStatusContSheetIds(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_unused, i) => `RS-1.${i + 1}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDERERS
// ═══════════════════════════════════════════════════════════════════════════

/** §5 — the SEVEN-ROW ROOT-GATE TABLE. Every cell is read from the model; not
 *  one value is re-derived, re-counted or re-worded here. */
function rootGateTable(model: ReleaseGateModel): string {
  const t = ROOT_GATE_TREATMENT;
  const rows = model.gates
    // the fail-closed UNMAPPED sink is printed ONLY when it actually holds a
    // requirement (it must never be hidden, and never padded in when empty).
    .filter(g => g.gateCategory !== 'UNMAPPED' || g.totalRequirementCount > 0)
    .map((g) => {
      const open = g.status === 'OPEN';
      return `
      <tr data-release-gate="${g.gateId}" data-release-gate-status="${g.status}" style="background:${open ? '#f4f4f4' : '#ffffff'};">
        <td style="border-left:${t.borderWidth} ${open ? t.borderStyle : 'solid'} ${open ? t.borderColor : '#999999'};font-weight:900;font-size:${RS_FONT.gateCell};line-height:1.18;">
          <span class="mono" style="font-size:7.6px;color:#444;">${g.gateId}</span><br/>${escapeH(g.title)}
        </td>
        <td style="font-size:7.8px;line-height:1.2;letter-spacing:0.3px;">${escapeH(CATEGORY_LABEL[g.gateCategory] ?? g.gateCategory)}</td>
        <td style="text-align:center;font-weight:900;font-size:${RS_FONT.gateCell};color:${open ? '#b91c1c' : '#166534'};letter-spacing:0.4px;">
          ${g.status === 'OPEN' ? 'OPEN' : g.status === 'NOT_APPLICABLE' ? 'N/A' : 'CLEARED'}
        </td>
        <td style="text-align:center;font-weight:900;font-size:11px;" data-release-gate-unresolved="${g.unresolvedCount}">
          ${g.unresolvedCount}<span style="font-size:7.4px;font-weight:700;color:#555;"> of ${g.totalRequirementCount}</span>
        </td>
        <td style="font-size:7.8px;line-height:1.2;">${escapeH(impactLabel(g))}</td>
        <td style="font-size:${RS_FONT.gateCell};line-height:1.2;color:#1e3a5f;">${escapeH(g.primaryResolutionAction || '—')}</td>
        <td style="font-size:7.8px;font-weight:900;letter-spacing:0.3px;text-align:center;line-height:1.2;">${escapeH(ROLE_LABEL[g.responsibleRole] ?? g.responsibleRole)}</td>
      </tr>`;
    }).join('');
  return `
      <div data-release-gate-table="1" style="margin-top:2px;">
        <div style="background:${t.fill};color:${t.ink};font-weight:${t.chipWeight};font-size:${RS_FONT.gateHdrTitle};letter-spacing:${t.chipSpacing};padding:1px 6px;border-left:${t.borderWidth} ${t.borderStyle} ${t.borderColor};">
          ROOT RELEASE GATES &mdash; ${model.summary.openGateCount} OPEN OF ${model.gates.filter(g => g.gateCategory !== 'UNMAPPED').length} · ${model.summary.unresolvedRequirementCount} UNRESOLVED REQUIREMENTS BELOW
        </div>
        <table class="equip-table" style="width:100%;table-layout:fixed;">
          <thead><tr>
            <th style="width:176px;text-align:left;font-size:7px;">GATE</th>
            <th style="width:106px;text-align:left;font-size:7px;">CATEGORY</th>
            <th style="width:46px;font-size:7px;">STATUS</th>
            <th style="width:66px;font-size:7px;">UNRESOLVED</th>
            <th style="width:172px;text-align:left;font-size:7px;">RELEASE IMPACT</th>
            <th style="text-align:left;font-size:7px;">PRIMARY RESOLUTION</th>
            <th style="width:106px;font-size:7px;">RESPONSIBLE ROLE</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
}

/** §5 — one CHILD REQUIREMENT row, visually classed by its finding type. */
function requirementRow(q: ReleaseRequirement, r: PermitReadinessBlocker | null): string {
  const t = findingTreatment(q.findingType);
  // §17 — an ADVISORY requirement MUST render its written justification.
  const justification = (r?.severity === 'warning' && r.justification)
    ? `<div style="margin-top:2px;font-size:${RS_FONT.justification};line-height:1.3;color:#7c5b12;"><span style="font-weight:900;">ADVISORY JUSTIFICATION:</span> ${escapeH(r.justification)}</div>`
    : '';
  // the existing per-record payload detail box, keyed by canonical payload schema
  const payload = r ? renderBlockerPayload(r) : '';
  const affects = requirementAffects(q.requirementCode);
  const evidence = q.evidenceReferences.length ? q.evidenceReferences.join(' · ') : '—';
  return `
    <tr data-release-requirement="${escapeH(q.requirementCode)}" data-finding-type="${q.findingType}"
        data-finding-treatment="${t.cls}" data-requirement-status="${q.status}" data-release-gate="${q.gateId}"
        style="background:${t.fill};">
      <td style="text-align:center;border-left:${t.borderWidth} ${t.borderStyle} ${t.borderColor};">
        <div style="font-size:7px;font-weight:900;letter-spacing:0.4px;color:#333;">${q.status}</div>
        ${sevBadge(q.severity)}
      </td>
      <!-- The CODE cell lives in a table-layout:fixed column, so nowrap made a long
           code overrun into the ISSUE column instead of widening its own cell (worst
           case ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED, 39 chars). Wrap inside the
           cell — codes break naturally at their hyphens and stay legible. -->
      <td class="mono" style="font-weight:900;font-size:${RS_FONT.code};white-space:normal;overflow-wrap:anywhere;word-break:break-word;line-height:1.15;">${escapeH(q.requirementCode)}<br/>${chip(t, FINDING_LABEL[q.findingType])}</td>
      <td style="font-size:${RS_FONT.issue};line-height:1.22;">
        <span style="font-weight:900;">${escapeH(q.title)}</span><br/>${escapeH(q.explanation)}${justification}${payload}
        <div style="margin-top:1px;font-size:${RS_FONT.authority};line-height:1.2;color:#334155;">
          <span style="font-weight:900;">AUTHORITY PATH:</span> <span class="mono">${escapeH(q.authorityPath)}</span>
          &nbsp;&middot;&nbsp; <span style="font-weight:900;">EVIDENCE:</span> <span class="mono">${escapeH(evidence)}</span>
        </div>
      </td>
      <td style="font-size:${RS_FONT.resolution};line-height:1.22;color:#1e3a5f;">
        ${escapeH(q.resolutionAction)}
        <div style="margin-top:1px;font-size:${RS_FONT.authority};font-weight:900;color:#111;">RESPONSIBLE: ${escapeH(ROLE_LABEL[q.responsibleRole] ?? q.responsibleRole)}</div>
        ${affects ? `<div style="margin-top:1px;font-size:${RS_FONT.authority};line-height:1.2;color:#334155;"><span style="font-weight:900;">AFFECTS:</span> ${escapeH(affects)}</div>` : ''}
      </td>
      <td style="font-size:${RS_FONT.sheets};line-height:1.25;color:#555;">${escapeH(q.affectedSheets.join(', ') || '—')}</td>
    </tr>`;
}

/** §5 — a gate's CHILD GROUP: the gate band + its requirement table. */
function requirementGroup(
  model: ReleaseGateModel, gateId: string, rows: RsBlock['rows'], continued: boolean,
): string {
  const g = model.gates.find(x => x.gateId === gateId);
  if (!g) return '';
  const t = ROOT_GATE_TREATMENT;
  return `
      <div data-release-gate-group="${g.gateId}" style="margin-top:2px;">
        <div style="background:${t.fill};color:${t.ink};font-weight:900;font-size:${RS_FONT.domainHdr};letter-spacing:0.7px;padding:1px 6px;border-left:${t.borderWidth} ${t.borderStyle} ${t.borderColor};">
          ${g.gateId} &mdash; ${escapeH(g.title)}${continued ? ' (CONTINUED)' : ''} &nbsp;·&nbsp; ${g.unresolvedCount} UNRESOLVED REQUIREMENT${g.unresolvedCount === 1 ? '' : 'S'} OF ${g.totalRequirementCount}
          &nbsp;·&nbsp; ${escapeH(CATEGORY_LABEL[g.gateCategory] ?? g.gateCategory)}
          &nbsp;·&nbsp; BLOCKS: ${escapeH(impactLabel(g))}
        </div>
        ${continued ? '' : `<div style="font-size:7.4px;line-height:1.25;color:#333;padding:1px 6px;border-left:2px solid #111;background:#fafafa;">${escapeH(gateBaseDescription(g.gateId))}</div>`}
        <table class="equip-table" style="width:100%;table-layout:fixed;">
          <thead><tr>
            <!-- 52px was narrower than the severity badge itself, so the badge bled
                 over the first character of the CODE cell. 66px clears BLOCKING/ADVISORY. -->
            <th style="width:66px;">STATUS</th>
            <th style="width:168px;text-align:left;">REQUIREMENT CODE / FINDING TYPE</th>
            <th style="text-align:left;">CONDITION · EXPLANATION · AUTHORITY PATH · EVIDENCE</th>
            <th style="width:30%;text-align:left;">RESOLUTION ACTION · RESPONSIBLE ROLE</th>
            <th style="width:64px;text-align:left;">SHEETS</th>
          </tr></thead>
          <tbody>${rows.map(x => requirementRow(x.q, x.r)).join('')}</tbody>
        </table>
      </div>`;
}

/** The provenance footer every RS sheet carries (source of truth + legend). */
function rsFooter(snapshotId: string): string {
  return `
      <div style="margin-top:3px;padding:2px 6px;font-size:6.3px;color:#555;line-height:1.25;border:var(--border);">
        Source: <span class="mono">permitReadiness.registry</span> on snapshot <span class="mono">${escapeH(snapshotId)}</span>,
        projected through the canonical release-gate model (root gates are a deterministic projection of the registry &mdash; no second readiness engine).
        A ROOT GATE is OPEN while ANY of its child requirements is unresolved; gate counts and requirement counts are never conflated.
        BLOCKING = prevents permit-ready / issue; ADVISORY = surfaced, not gating (each advisory carries a written justification).
        FINDING TYPES: TECHNICAL CONFLICT / VERIFIED DEFICIENCY = a confirmed condition; PENDING AUTHORITY / DOCUMENT / SELECTION = an authority is NOT YET ESTABLISHED (nothing has failed);
        FIELD VERIFICATION = a measurement is owed; ADMINISTRATIVE HOLD and PROFESSIONAL RELEASE are WORKFLOW conditions, not engineering defects.
        Equipment-identity conflicts require OPERATOR reconciliation (never auto-resolved). Full machine-readable per-attachment /
        per-segment data is retained in the canonical object model referenced on PV-4B / PV-4C / E-1 / SCHED.
      </div>`;
}

/**
 * RS-1 (contIndex undefined / 0-page) and RS-1.n (contIndex ≥ 0 ⇒ the
 * (contIndex+1)-th layout page). ONE renderer for both so a continuation sheet
 * can never drift from the primary sheet's model.
 */
export function pageReviewStatus(
  input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, contIndex?: number,
): string {
  void cad;
  const snap = peekSnapshot(input);
  const registry: PermitReadinessBlocker[] = [...(snap?.permitReadiness?.registry ?? [])];
  const active = registry.filter(r => !r.resolved);
  const pa = projectProjectAuthorityFromInput(input);
  const issueStatus = pa.issueStatus ?? 'DESIGN DRAFT';
  // THE model — projected from the snapshot (carries snapshotId/digest); the
  // layout re-derives the same model without ids purely for the page packing.
  const model = projectReleaseGates(snap);
  const layout = reviewStatusLayout(registry);
  const pageIdx = contIndex == null ? 0 : contIndex + 1;
  const layoutPage = layout.pages[pageIdx] ?? { blocks: [] };
  const isCont = pageIdx > 0;
  const sheetId = isCont ? `RS-1.${pageIdx}` : 'RS-1';

  const blockingCount = active.filter(r => r.severity === 'blocking').length;
  const advisoryCount = active.length - blockingCount;
  const ready = snap?.permitReadiness?.ready === true;
  const headline = releaseHeadline(model.summary);

  // ── §4 release-status strip (RS-1) ────────────────────────────────────────
  const strip = `
      <div data-release-status-strip="1" style="display:flex;gap:8px;align-items:stretch;margin-top:1px;">
        <div style="flex:1 1 auto;min-width:0;border:2px solid ${ready ? '#166534' : '#b91c1c'};background:${ready ? '#f0fdf4' : '#fef2f2'};padding:3px 10px;">
          <div data-release-headline="1" style="font-weight:900;font-size:13px;letter-spacing:0.6px;color:${ready ? '#166534' : '#b91c1c'};">
            ${ready ? 'CLEARED FOR ISSUE &mdash; NO OPEN RELEASE GATES' : escapeH(headline)}
          </div>
          <div style="font-size:7.5px;color:${ready ? '#166534' : '#7f1d1d'};margin-top:1px;line-height:1.25;">
            EVERY unresolved release requirement on the validated design snapshot, grouped beneath the ROOT GATE it belongs to.
            ${model.summary.openGateCount} root gate${model.summary.openGateCount === 1 ? '' : 's'} contain${model.summary.openGateCount === 1 ? 's' : ''}
            ${model.summary.unresolvedRequirementCount} unresolved requirement${model.summary.unresolvedRequirementCount === 1 ? '' : 's'} &mdash; these are NOT
            ${model.summary.unresolvedRequirementCount} unrelated engineering failures. A requirement listed here is unresolved in the current package regardless of
            any sheet that renders a passing value. Derived issue state: <strong>${escapeH(issueStatus)}</strong>.
          </div>
        </div>
        <div style="flex:0 0 292px;min-width:0;display:flex;flex-direction:column;gap:3px;justify-content:center;">
          <div style="border:2px solid #111;padding:2px 8px;display:flex;justify-content:space-between;align-items:center;background:#f4f4f4;">
            <span style="font-size:7px;font-weight:900;letter-spacing:0.4px;">OPEN RELEASE GATES</span>
            <span data-release-open-gate-count="${model.summary.openGateCount}" style="font-size:14px;font-weight:900;color:#b91c1c;">${model.summary.openGateCount}</span>
          </div>
          <div style="border:var(--border);padding:2px 8px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:7px;font-weight:700;letter-spacing:0.4px;">UNRESOLVED REQUIREMENTS</span>
            <span data-release-requirement-count="${blockingCount}" style="font-size:14px;font-weight:900;color:#b91c1c;">${blockingCount}</span>
          </div>
          <div style="border:var(--border);padding:2px 8px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:7px;font-weight:700;letter-spacing:0.4px;">ADVISORY</span>
            <span data-release-advisory-count="${advisoryCount}" style="font-size:14px;font-weight:900;color:#b45309;">${advisoryCount}</span>
          </div>
        </div>
      </div>`;

  // ── continuation status line (RS-1.n) — same counts, never re-derived ─────
  const contHeader = `
      <div data-release-status-strip="cont" style="margin-top:1px;border:2px solid #b91c1c;background:#fef2f2;padding:2px 10px;display:flex;justify-content:space-between;align-items:center;">
        <span data-release-headline="1" style="font-weight:900;font-size:11px;letter-spacing:0.5px;color:#b91c1c;">${escapeH(headline)}</span>
        <span style="font-size:7.5px;color:#7f1d1d;">CONTINUATION OF RS-1 &mdash; ROOT-GATE TABLE AND RELEASE STATUS ON RS-1
          &nbsp;·&nbsp; <span data-release-open-gate-count="${model.summary.openGateCount}">${model.summary.openGateCount}</span> OPEN GATES
          &nbsp;·&nbsp; <span data-release-requirement-count="${blockingCount}">${blockingCount}</span> UNRESOLVED REQUIREMENTS</span>
      </div>`;

  const emptyState = `
    <div style="border:2px solid #166534;background:#f0fdf4;padding:10px 14px;margin-top:8px;">
      <div style="font-weight:900;font-size:12px;color:#166534;letter-spacing:0.5px;">NO OPEN RELEASE GATES &mdash; NO UNRESOLVED RELEASE REQUIREMENTS</div>
      <div style="font-size:8px;color:#166534;margin-top:2px;">All tracked authority gaps are resolved for this snapshot. See CERT / PE-1 for the engineering review + seal status.</div>
    </div>`;

  const groups = layoutPage.blocks
    .map(b => requirementGroup(model, b.gateId, b.rows, b.continued)).join('');

  return `
  <div class="page">

    ${titleBlock(input, sheetId,
      isCont ? 'REVIEW STATUS (CONTINUED) &mdash; RELEASE REQUIREMENTS' : 'REVIEW STATUS &mdash; RELEASE GATES &amp; REQUIREMENTS',
      pageNum, totalPages)}

    <div class="page-content">

      ${isCont ? contHeader : strip}
      ${isCont ? '' : (active.length ? rootGateTable(model) : '')}
      ${active.length ? groups : emptyState}
      ${rsFooter(snap?.meta.snapshotId ?? '—')}

    </div>
  </div>`;
}

/**
 * Every RS sheet (RS-1 + RS-1.n) concatenated, in order. The package assembly
 * renders them as separate pages; this is the accessor for callers that need
 * the WHOLE review-status registry as one fragment (regression tests, evidence
 * tooling) so a requirement can never be "missing" merely because it paginated
 * onto a continuation sheet.
 */
export function renderReviewStatusSheets(input: PermitInput, cad: CADModel): string {
  const registry = peekSnapshot(input)?.permitReadiness?.registry ?? [];
  const cont = reviewStatusContPageCount(registry);
  const out = [pageReviewStatus(input, cad, 1, 1 + cont)];
  for (let i = 0; i < cont; i++) out.push(pageReviewStatus(input, cad, 2 + i, 1 + cont, i));
  return out.join('\n');
}
