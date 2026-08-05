// ═══════════════════════════════════════════════════════════════════════════
// W3 §4 — Canonical versioned racking-assembly record.
// ONE source: lib/mounting-hardware-db.ts (the structural store). Capacity is
// the ASD ALLOWABLE normalized through lib/structural/attachmentCapacity.ts.
//
// RT-MINI ruling (Ray, W3): the 600 lb ALLOWABLE in mounting-hardware-db is the
// capacity authority. The 900 lb "ultimate" entries in equipment-db /
// equipment-registry-v4 are NOT authority — the discrepancy is recorded in
// `notes`, never silently reconciled to the higher number.
//
// W3.1 §4 — STRENGTHENED PROVENANCE. The 600 lb value now carries a full
// capacityProvenance record: exact source-document identity, revision/date,
// document hash (or an honest null when the file is not archived in-repo),
// issuing entity, jurisdiction boundary, mount model, fastener pattern,
// substrate condition, adjustment factors, an asd-allowable-vs-ultimate flag,
// and an applicability assessment for the selected mixed assembly. The 900 lb
// "ultimate" records are EXPLICITLY EXCLUDED from allowable-capacity checks in
// code (resolveAsdAllowableLbs refuses an 'ultimate' basis). Where the 600 lb
// source does not cover the exact selected assembly / installation condition, a
// BLOCKING structural-authority gap is emitted rather than applying it
// generically.
//
// IN-REPO EVIDENCE (verified 2026-07-21): NO Roof Tech PE structural letter or
// datasheet PDF exists in this repository (searched docs/, public/, assets,
// _tesla_docs; only manufacturer marketing detail PNGs are present). ESR-3575 is
// a flashing / water-resistance report that Sec. 5.2 says explicitly EXCLUDES
// structural capacity. lib/data/structural/attachment-capacity-basis-research.json
// records the 600 lb value as field-referenced and "provisional … VERIFY against
// Roof Tech's current structural test report / stamped calc." Therefore the
// source documentHash is null and a blocking gap is recorded — nothing invented.
// ═══════════════════════════════════════════════════════════════════════════
import type { RackingAssemblyRecord, Provenance } from './types';
import { contentRevision } from './digest';
import type { MountingSystemSpec } from '@/lib/mounting-hardware-db';
import { allowableUpliftLbs } from '@/lib/structural/attachmentCapacity';

// ── W3.1 §4 — provenance shapes (declared locally; types.ts is not edited here) ──

export interface RackingCapacitySourceDocument {
  identity: string | null;          // exact source document identity
  revisionOrDate: string | null;    // source revision / date
  issuingEntity: string | null;     // issuing engineer / entity
  documentHash: string | null;      // sha256 of the archived file, or null when not archived
  archivedInRepo: boolean;          // whether the actual document exists in-repo
  hashNote: string;                 // honest note on why the hash is null / how derived
  url: string | null;               // referenced source URL, if any
}

export interface RackingAssemblyApplicability {
  selectedMountModel: string;
  selectedRail: string | null;
  selectedSubstrate: string | null;
  sourceCoversMount: boolean | null;
  sourceCoversRail: boolean | null;
  sourceCoversSubstrate: boolean | null;
  assessment: string;               // does the source cover mount + rails + substrate?
}

export interface RackingCapacityProvenance {
  mountModel: string;
  publishedValueLbs: number | null;
  capacityBasis: 'allowable' | 'ultimate' | 'unknown';
  /** ASD allowable resolved through resolveAsdAllowableLbs (null ⇒ refused). */
  asdAllowableLbs: number | null;
  /** true ⇒ an 'ultimate'/unset-basis value was refused for the ASD check. */
  ultimateBasisRefusedForAsd: boolean;
  sourceDocument: RackingCapacitySourceDocument;
  jurisdictionApplicabilityBoundary: string | null;
  fastenerPattern: string | null;
  substrateInstallationCondition: string | null;
  adjustmentFactors: Record<string, number | string>;
  /** Ultimate-basis records explicitly excluded from allowable-capacity calcs. */
  excludedUltimateRecords: { value: number; basis: 'ultimate'; source: string; reason: string }[];
  assemblyApplicability: RackingAssemblyApplicability;
  provenance: Provenance;
}

export interface StructuralAuthorityGap {
  code: string;
  severity: 'blocking' | 'warning';
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// D6 — ONE DOCUMENT, ONE ROLE AT A TIME.
//
// The record used to say two incompatible things at once. Its structured fields
// named ICC-ES ESR-3575 as the capacity source
//   capacitySource / datasheetSource / ul2703ListingBasis / iccEsReport
// while its own `notes[]` said ESR-3575 "is a flashing / water-resistance report
// and carries no structural value" — which is also why
// FASTENER-ASSEMBLY-UNVERIFIED fires. Prose was negating data. Any consumer
// reading the structured field (rather than parsing English) cited a document
// that the same record disqualifies.
//
// `documentRoles` is the structured statement instead. A document occupies a
// role ONLY when it actually supports that role. ESR-3575 legitimately fills the
// listing / flashing role — that is what an ICC-ES evaluation report for a
// self-flashing mount IS — and fills no other.
// ═══════════════════════════════════════════════════════════════════════════

/** The distinct authorities a racking document can carry. They are NOT
 *  interchangeable: authenticity is not applicability, and a listing report is
 *  not a structural capacity source. */
export type RackingDocumentRole =
  | 'listingFlashingBasis'
  | 'installationAuthority'
  | 'fastenerAuthority'
  | 'structuralCapacityAuthority'
  | 'ul2703BondingBasis'
  | 'projectSpecificEngineeringAuthority';

export interface RackingDocumentRoleFact {
  /** true ⇔ a document actually establishes this role for the SELECTED product. */
  established: boolean;
  /** the document identity filling the role, or null when none does. */
  documentIdentity: string | null;
  /** registry document id, when the role is filled from the registry. */
  documentId: string | null;
  /** sha256 of the archived source, when one exists. */
  documentHash: string | null;
  /** true ⇔ the source is archived (registry `archived_in_repo`). */
  archivedInRepo: boolean;
  /** why the role is (or is not) established — always a true statement. */
  basis: string;
}

export type RackingDocumentRoleAuthority = Record<RackingDocumentRole, RackingDocumentRoleFact>;

/** A role nobody fills, stated honestly. */
export function unfilledRole(basis: string): RackingDocumentRoleFact {
  return { established: false, documentIdentity: null, documentId: null, documentHash: null, archivedInRepo: false, basis };
}

// ═══════════════════════════════════════════════════════════════════════════
// W4 §9 — RT-MINI blocker clearance evidence.
//
// The two blocking gaps (RACKING-CAPACITY-SOURCE-NOT-ARCHIVED,
// RACKING-CAPACITY-APPLICABILITY-GAP) clear ONLY when the caller supplies a
// VERIFIED, CURRENT registry document whose extracted engineering claims cover
// the EXACT selected assembly + installation condition on EVERY required field.
// This shape is produced by lib/documents/registry.ts from a
// manufacturer_document_registry row; buildRackingAssembly evaluates it purely
// and deterministically (no DB access here — the async resolve happens upstream,
// keeping this module pure so the record digest stays reproducible).
//
// A generic Roof Tech brochure or flashing report (ESR-3575) is missing the
// structural capacity claim and the §9 applicability fields, so
// evaluateRackingCapacityClearance returns cleared:false with the missing fields
// enumerated — the blockers STAY. Nothing is laundered.
// ═══════════════════════════════════════════════════════════════════════════

/** Structural document classes that CAN carry an allowable-capacity authority.
 *  A datasheet / installation manual / flashing evaluation report is NOT here. */
export const STRUCTURAL_CAPACITY_DOCUMENT_CLASSES = ['structural_pe_letter', 'evaluation_report'] as const;

/** Evidence extracted from a verified registry document, evaluated against the
 *  selected assembly. Every field maps to a W4 §9 applicability requirement. */
export interface RackingCapacityDocumentEvidence {
  documentId: string | null;
  documentClass: string;                     // must be a STRUCTURAL_CAPACITY_DOCUMENT_CLASS
  documentIdentity: string | null;
  verificationState: string;                 // must be 'verified'
  status: string;                            // must be 'current'
  archivedInRepo: boolean;                    // must be true — the EXACT source archived
  sha256: string | null;                     // must be present — integrity of the archived file
  /** true only when the doc actually states a structural capacity (a flashing /
   *  water-resistance report explicitly excludes this ⇒ false). */
  hasStructuralCapacityClaim: boolean;
  // ── §9 applicability fields ──
  exactModel: string | null;                 // exact RT-MINI model the doc covers
  fastenerModel: string | null;              // fastener model
  fastenerCount: number | null;              // fastener count
  substrate: string | null;                  // substrate condition
  rafterDeckCondition: string | null;        // rafter / deck condition
  embedmentIn: number | null;                // embedment
  railLFootAssembly: string | null;          // rail / L-foot assembly covered
  loadBasis: string | null;                  // load basis (must resolve to an ASD allowable)
  adjustmentFactors: Record<string, unknown> | null; // adjustment factors
  jurisdiction: string | null;               // jurisdiction / applicability boundary
  asdAllowableLbs: number | null;            // the allowable value the doc establishes
  revisionOrDate: string | null;
}

/** The selected assembly + installation condition the evidence must cover. */
export interface RackingClearanceContext {
  mountModel: string;
  requiredSubstrate?: string | null;
  requiredRail?: string | null;
  projectJurisdiction?: string | null;
}

export interface RackingClearanceResult {
  cleared: boolean;
  missing: string[];     // required fields/conditions the evidence failed to satisfy
  reasons: string[];     // human-readable explanation per failure
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * PURE, deterministic predicate: does the supplied registry evidence establish a
 * verified allowable-capacity authority for the EXACT selected assembly and
 * installation condition? Returns cleared:false + the enumerated missing fields
 * when ANY required condition is unmet. No DB, no side effects.
 *
 * This is the single gate for clearing the RT-MINI structural blockers, and the
 * refusal path for a generic brochure / flashing report.
 */
export function evaluateRackingCapacityClearance(
  ctx: RackingClearanceContext,
  evidence: RackingCapacityDocumentEvidence | null | undefined,
): RackingClearanceResult {
  const missing: string[] = [];
  const reasons: string[] = [];
  const fail = (field: string, why: string) => { missing.push(field); reasons.push(why); };

  if (!evidence) {
    return { cleared: false, missing: ['document'], reasons: ['no verified registry document supplied for the selected assembly'] };
  }

  // ── Document must be a structural-capacity class, verified, current, archived ──
  if (!(STRUCTURAL_CAPACITY_DOCUMENT_CLASSES as readonly string[]).includes(evidence.documentClass)) {
    fail('document_class', `document class '${evidence.documentClass}' cannot carry a structural allowable capacity (a datasheet / installation manual / flashing report is not a capacity authority)`);
  }
  if (!evidence.hasStructuralCapacityClaim) {
    fail('structural_capacity_claim', 'document does not state a structural (uplift) capacity — a flashing / water-resistance report explicitly excludes structural capacity');
  }
  if (norm(evidence.verificationState) !== 'verified') {
    fail('verification_state', `document is '${evidence.verificationState}', not 'verified'`);
  }
  if (norm(evidence.status) !== 'current') {
    fail('status', `document status is '${evidence.status}', not 'current'`);
  }
  if (!evidence.archivedInRepo) {
    fail('archived_file', 'the exact source document is not archived (archivedInRepo=false)');
  }
  if (!evidence.sha256 || evidence.sha256.trim().length < 16) {
    fail('sha256', 'no SHA-256 recorded for the archived file — integrity of the source cannot be established');
  }

  // ── §9 applicability fields — every one required, and exact-model must match ──
  if (!norm(evidence.exactModel)) fail('exact_model', 'document does not identify the exact mount model');
  else if (norm(evidence.exactModel) !== norm(ctx.mountModel)) {
    fail('exact_model', `document covers '${evidence.exactModel}', not the selected mount '${ctx.mountModel}'`);
  }
  if (!norm(evidence.fastenerModel)) fail('fastener_model', 'fastener model not stated');
  if (evidence.fastenerCount == null || !(evidence.fastenerCount > 0)) fail('fastener_count', 'fastener count not stated');
  if (!norm(evidence.substrate)) fail('substrate', 'substrate condition not stated');
  else if (ctx.requiredSubstrate && norm(evidence.substrate) !== norm(ctx.requiredSubstrate)) {
    fail('substrate', `document substrate '${evidence.substrate}' does not match the selected substrate '${ctx.requiredSubstrate}'`);
  }
  if (!norm(evidence.rafterDeckCondition)) fail('rafter_deck_condition', 'rafter / deck condition not stated');
  if (evidence.embedmentIn == null || !(evidence.embedmentIn > 0)) fail('embedment', 'embedment not stated');
  if (!norm(evidence.railLFootAssembly)) fail('rail_lfoot_assembly', 'rail / L-foot assembly not covered');
  else if (ctx.requiredRail && norm(evidence.railLFootAssembly).indexOf(norm(ctx.requiredRail)) === -1 && norm(ctx.requiredRail).indexOf(norm(evidence.railLFootAssembly)) === -1) {
    fail('rail_lfoot_assembly', `document rail/L-foot assembly '${evidence.railLFootAssembly}' does not cover the selected rail '${ctx.requiredRail}'`);
  }
  if (!/allowable|asd/i.test(evidence.loadBasis ?? '')) {
    fail('load_basis', `load basis '${evidence.loadBasis ?? '(none)'}' is not an ASD allowable basis`);
  }
  if (!evidence.adjustmentFactors || Object.keys(evidence.adjustmentFactors).length === 0) {
    fail('adjustment_factors', 'adjustment factors not stated');
  }
  if (!norm(evidence.jurisdiction)) fail('jurisdiction', 'jurisdiction / applicability boundary not stated');
  else if (ctx.projectJurisdiction && norm(evidence.jurisdiction) !== norm(ctx.projectJurisdiction)) {
    fail('jurisdiction', `document jurisdiction '${evidence.jurisdiction}' is not confirmed for the project jurisdiction '${ctx.projectJurisdiction}'`);
  }
  if (evidence.asdAllowableLbs == null || !(evidence.asdAllowableLbs > 0)) {
    fail('asd_allowable_value', 'document does not establish a positive ASD allowable capacity');
  }

  return { cleared: missing.length === 0, missing, reasons };
}

/** RackingAssemblyRecord + W3.1 §4 provenance. A subtype of RackingAssemblyRecord,
 *  so it remains assignable everywhere the base record is consumed; the extra
 *  fields ride along on the immutable snapshot and are part of the record digest. */
export interface RackingAssemblyRecordExt extends RackingAssemblyRecord {
  capacityProvenance: RackingCapacityProvenance;
  structuralAuthorityGaps: StructuralAuthorityGap[];
  // ── W6 — assembly completeness toward Ray's full field list (honest nulls) ──
  /** Rail stock (splice-interval) length, or null when the rail SKU is unpinned. */
  railStockLengthIn: number | null;
  /** Where span / cantilever authority comes from, or null when unresolved. */
  spanCantileverSource: string | null;
  /** Per-element verification state so no renderer treats a PENDING assembly as
   *  permit-ready. `overall` is 'verified' only when EVERY element is verified. */
  assemblyVerification: {
    railSku: 'verified' | 'pending' | 'unverified';
    capacitySource: 'verified' | 'pending' | 'unverified';
    spanSource: 'verified' | 'pending' | 'unverified';
    fastener: 'verified' | 'pending' | 'unverified';
    overall: 'verified' | 'pending';
  };
  /** D6 — which document carries which authority, structurally. Replaces the
   *  situation where a structured field named ESR-3575 as the capacity source
   *  while the record's own prose disqualified it. */
  documentRoles: RackingDocumentRoleAuthority;
}

// ── W3.1 §4 — ASD allowable resolver (refuses 'ultimate' basis) ────────────────

export interface AsdAllowableResolution {
  allowableLbs: number | null;
  refused: boolean;
  basis: 'allowable' | 'ultimate' | 'unknown';
  reason: string;
}

/**
 * Resolve a mount capacity to a value usable as an ASD ALLOWABLE in an
 * attachment-capacity check. An 'allowable'-basis value passes through directly.
 * An 'ultimate' (mean-to-failure) basis — OR an unset basis (treated as ultimate,
 * conservative) — is REFUSED: a mean-ultimate number must not be laundered into an
 * allowable without a documented Ω from the product's own stamped structural
 * report. This enforces the W3.1 §4 exclusion of the 900 lb "ultimate" RT-MINI
 * registry entries from allowable-capacity calculations.
 */
export function resolveAsdAllowableLbs(
  capacityLbs: number | null | undefined,
  basis: 'allowable' | 'ultimate' | null | undefined,
): AsdAllowableResolution {
  if (capacityLbs == null || !Number.isFinite(capacityLbs)) {
    return { allowableLbs: null, refused: true, basis: basis ?? 'unknown', reason: 'no capacity value provided' };
  }
  if (basis === 'allowable') {
    return { allowableLbs: capacityLbs, refused: false, basis: 'allowable', reason: 'published ASD allowable used directly' };
  }
  return {
    allowableLbs: null,
    refused: true,
    basis: basis === 'ultimate' ? 'ultimate' : 'unknown',
    reason: basis === 'ultimate'
      ? 'ULTIMATE (mean-to-failure) basis REFUSED as an ASD allowable-capacity value — requires a documented Ω from a stamped structural report'
      : 'UNSET basis treated as ultimate and REFUSED as an ASD allowable-capacity value (conservative)',
  };
}

/** Options for buildRackingAssembly. `capacityDocument` is a VERIFIED registry
 *  document (resolved async upstream via lib/documents/registry.findVerifiedDocument)
 *  that may clear the RT-MINI structural blockers when it covers the exact
 *  assembly + installation condition. Omitted ⇒ legacy behaviour (blockers stay). */
export interface BuildRackingAssemblyOptions {
  capacityDocument?: RackingCapacityDocumentEvidence | null;
  projectJurisdiction?: string | null;
}

/** Build the canonical racking-assembly record from a mounting-hardware-db spec.
 *  Returns null when no mount is resolved (a missing-assembly blocker fires
 *  upstream). Pure/deterministic — with the same inputs (including no options)
 *  it produces a byte-identical record, so the digest is unchanged. */
export function buildRackingAssembly(
  system: MountingSystemSpec | null | undefined,
  opts?: BuildRackingAssemblyOptions,
): RackingAssemblyRecordExt | null {
  if (!system) return null;
  const mount = system.mount;
  const rail = system.rail ?? null;
  const hw = system.hardware;
  const mountBrand = system.manufacturer;

  const isRailBased = system.systemType === 'rail_based' || system.systemType === 'standing_seam';
  // A rail-based mount that carries NO own rail spec is paired with a COMPATIBLE
  // rail from a different manufacturer (documented in hw.railSplice).
  const mixedManufacturer = isRailBased && !rail;
  // §10 — a rail-based mount with NO own rail spec has an UNPINNED rail SKU. The
  // record must state PENDING SELECTION explicitly (never a generic "compatible /
  // or equivalent" placeholder that reads as if a rail were specified).
  const railUnpinned = isRailBased && !rail;
  const railBrand = rail ? system.manufacturer : null;
  // W6 — the explicit pending-banner language for an unpinned rail/splice SKU.
  // NO "compatible rail" / "or equivalent" / RAIL-PENDING-SELECTION raw tokens on
  // any renderer: an unpinned assembly reads as the blocked state it is.
  const RAIL_PENDING = 'PENDING RACKING ASSEMBLY SELECTION — rail/splice SKU not specified · NOT FOR PERMIT SUBMISSION';
  // Documented compatibility (hw.railSplice names the accepted rails) ⇒ supported.
  const assemblySupported = !mixedManufacturer
    || /compatible|xr100|xr1000|pegasus|unirac|sfm|equivalent/i.test(hw.railSplice ?? '');

  const notes: string[] = [];
  const isRtMini = system.id === 'rooftech-mini' || /RT-?MINI/i.test(system.model);
  if (isRtMini) {
    notes.push(
      'CAPACITY AUTHORITY = 600 lb ASD ALLOWABLE (Roof Tech RT-MINI II PE letter, 613.2 lb '
      + 'weakest standard assembly, conservative round-down). The 900 lb "ultimate" (2×450) '
      + 'entries in equipment-db / equipment-registry-v4 are NOT structural authority '
      + '(ESR-3575 is a flashing / water-resistance report and carries no structural value).');
    // D3 — this note used to assert "NOT archived in this repository". Archive
    // state is owned by manufacturer_document_registry, and the live registry
    // holds archived, hashed RT-MINI II letters. The note now states only what
    // this pure evaluation actually knows.
    notes.push(
      'W3.1 §4 — the 600 lb value is PROVISIONAL until a capacity document is resolved that covers '
      + 'the exact selected assembly. Archive state, hash and jurisdiction are properties of the '
      + 'document registry record, not of this evaluation. Applicability to the selected mixed '
      + 'assembly / project jurisdiction is UNVERIFIED — see capacityProvenance, documentRoles and '
      + 'the RACKING-CAPACITY-* structural-authority gaps.');
    // D6 — the product distinction, stated where it cannot be missed: the 613.2 lb
    // figure is published for RT-MINI II. RT-MINI is a different product, and
    // authenticating an RT-MINI II letter does not make it applicable here.
    notes.push(
      `PRODUCT DISTINCTION: the 613.2 lb figure the 600 lb round-down derives from is published for `
      + `RT-MINI II. The selected mount is ${mount.model}. A document covering RT-MINI II does NOT `
      + `establish capacity applicability to RT-MINI — authenticity is not applicability.`);
  }
  if (mixedManufacturer) {
    notes.push(
      `Mixed-manufacturer assembly: ${mountBrand} ${mount.model} mount + rail from a different manufacturer — `
      + `rail/splice SKU is PENDING SELECTION (not yet specified; NOT FOR PERMIT SUBMISSION). The mount record carries `
      + `no rail span-limit authority, so rail span / cantilever checks are UNVERIFIABLE until the exact rail SKU is pinned.`);
  }

  const publishedAllowable = allowableUpliftLbs(mount.upliftCapacityLbs, mount.capacityBasis);
  const basis: 'allowable' | 'ultimate' = mount.capacityBasis ?? 'ultimate';

  // ── W3.1 §4 — capacity provenance + structural-authority gaps ────────────────
  const asd = resolveAsdAllowableLbs(mount.upliftCapacityLbs, mount.capacityBasis);
  // SEMANTIC rail SKU for clearance / provenance matching: the exact rail model
  // when pinned, else null (unpinned) — never a placeholder string, so a verified
  // document's rail-assembly match is not defeated by a display placeholder.
  const railModel = rail?.model ?? null;
  // DISPLAY value on the record: exact SKU, or explicit PENDING SELECTION when a
  // rail-based mount carries no own rail (never "compatible / or equivalent").
  const railDisplay = rail?.model ?? (railUnpinned ? RAIL_PENDING : null);
  const installationCondition = system.compatibleRoofTypes.join(', ') || null;
  const fastenerPattern = mount.fastenersPerMount != null
    ? `${mount.fastenersPerMount}× ${hw.lagBolt ?? mount.attachmentMethod}`
    : (hw.lagBolt ?? null);

  const structuralAuthorityGaps: StructuralAuthorityGap[] = [];
  let capacityProvenance: RackingCapacityProvenance;

  // ── W4 §9 — does a supplied VERIFIED registry document clear the RT-MINI
  //    structural blockers? PURE evaluation against the exact selected assembly.
  //    No document (or a non-matching one, e.g. a brochure) ⇒ not cleared. ──
  const rtClearance: RackingClearanceResult | null = isRtMini
    ? evaluateRackingCapacityClearance(
        {
          mountModel: mount.model,
          requiredRail: railModel,
          projectJurisdiction: opts?.projectJurisdiction ?? null,
        },
        opts?.capacityDocument ?? null,
      )
    : null;
  const rtCleared = rtClearance?.cleared === true;
  /** The supplied registry document, if any. D3: every document FACT below is
   *  read from this record — never asserted by this module. */
  const _capDoc = opts?.capacityDocument ?? null;

  if (isRtMini) {
    capacityProvenance = {
      mountModel: mount.model,
      publishedValueLbs: mount.upliftCapacityLbs,
      capacityBasis: basis,
      asdAllowableLbs: asd.allowableLbs,               // 600 (basis 'allowable')
      ultimateBasisRefusedForAsd: asd.refused,          // false for the real 600 record
      // ── D3 — THE REGISTRY OWNS DOCUMENT EXISTENCE, ARCHIVE STATE AND HASH ──
      // What stood here was a block of hardcoded literals asserting, as fact,
      // that the PE structural letter is NOT archived, that its hash is null,
      // that "no PDF/datasheet file exists in this repository", and that the
      // design basis is "ASCE 7-10, Kentucky".
      //
      // The live registry contradicts every one of those. It holds TWO archived,
      // SHA-256'd RT-MINI II PE letters — and they are the ILLINOIS issues
      // (RT_Mini_II_ASCE_7-10_IL.pdf and RT_Mini_II_ASCE_7-16_IL.pdf). The
      // package was printing a false negative about its own archive, and naming
      // the wrong jurisdiction while doing it.
      //
      // These values now DERIVE from the supplied registry document. When no
      // applicable document is supplied the fallback states that no applicable
      // verified capacity document is SELECTED — a fact about the resolution —
      // and never asserts that no document exists, which is a fact about the
      // archive that this pure function is in no position to know.
      sourceDocument: _capDoc
        ? {
            identity: _capDoc.documentIdentity
              ?? `Roof Tech structural capacity document ${_capDoc.documentId ?? '(id n/a)'}`,
            revisionOrDate: _capDoc.revisionOrDate ?? (system.lastUpdated ?? null),
            issuingEntity: 'Roof Tech (registered design professional; specific PE name / license / seal not captured in-repo)',
            documentHash: _capDoc.sha256,
            archivedInRepo: _capDoc.archivedInRepo,
            hashNote: _capDoc.archivedInRepo && _capDoc.sha256
              ? `source-archived — registry document ${_capDoc.documentId ?? '(id n/a)'} (class `
                + `${_capDoc.documentClass}), SHA-256 recorded. Archive state and hash come from the `
                + `document registry, not from this module.`
              : `registry document ${_capDoc.documentId ?? '(id n/a)'} is recorded but is not archived `
                + `with a SHA-256; the cited value cannot be verified against a source of record.`,
            url: null,
          }
        : {
            identity: null,
            revisionOrDate: system.lastUpdated ?? null,
            issuingEntity: 'Roof Tech (registered design professional; specific PE name / license / seal not captured in-repo)',
            documentHash: null,
            archivedInRepo: false,
            hashNote: 'No applicable verified capacity document is currently SELECTED for this assembly. '
              + 'That is a statement about the resolution, not about the archive: this evaluation is pure '
              + 'and does not search the repository or the document registry. Whether a capacity document '
              + 'exists is answered by manufacturer_document_registry, which is the sole owner of document '
              + 'existence, archive state and hash.',
            url: null,
          },
      jurisdictionApplicabilityBoundary: _capDoc
        ? (_capDoc.jurisdiction
            ? `Document jurisdiction of record: '${_capDoc.jurisdiction}'.`
              + (rtCleared
                  ? ' Confirmed for the project jurisdiction.'
                  : ' NOT confirmed for the project jurisdiction — see the applicability gap.')
            : 'The cited document states no jurisdiction / applicability boundary — applicability to the '
              + 'project jurisdiction is UNESTABLISHED.')
        : 'No capacity document is selected, so no jurisdiction / applicability boundary is established. '
          + 'The design basis is NOT inferred from the mount catalog.',
      fastenerPattern: '2× 5/16" (8mm/M8) structural wood screw, ~3.5" (90mm) into the rafter, no pilot hole',
      substrateInstallationCondition: 'Weakest standard assembly governing the 613.2 lb allowable: '
        + '15/32" sheathing, 2×4 DF-L #2, 2 screws. Compatible roof types: '
        + (installationCondition ?? 'unspecified') + '. Self-flashing (integrated AlphaSeal/RT Butyl).',
      adjustmentFactors: {
        assumedSpeciesSpecificGravityG: 0.50,
        embedmentIn: mount.fastenerEmbedmentIn ?? 2.5,
        safetyFactorAppliedBySource: 'yes (value stated as ASD allowable)',
        impliedUltimateToAllowableRatio: 1.5,
        impliedRatioStatus: 'UNVERIFIED — inconsistent with the 3.0 documented for lag-withdrawal '
          + '(ICC-ES AC428 §3.2.5 / IronRidge FF2 certification); flagged for field verification',
      },
      excludedUltimateRecords: [{
        value: 900,
        basis: 'ultimate',
        source: 'equipment-db / equipment-registry-v4 (2×450 lb) and ICC-ES ESR-3575 (flashing report)',
        reason: 'ESR-3575 Sec. 5.2 excludes structural capacity; the 900 lb "ultimate" is not a '
          + 'structural authority and is REFUSED as an ASD allowable-capacity value (resolveAsdAllowableLbs).',
      }],
      assemblyApplicability: {
        selectedMountModel: mount.model,
        selectedRail: railModel,
        selectedSubstrate: installationCondition,
        sourceCoversMount: true,      // pad-to-rafter attachment (screw withdrawal)
        sourceCoversRail: false,      // mixed compatible rail (SKU unpinned) — span/cantilever not covered
        sourceCoversSubstrate: null,  // weakest wood assembly only; other substrates uncertain
        // D3 — the jurisdiction clause is derived, never hardcoded. The old text
        // named Kentucky; the archived letters are the Illinois issues.
        assessment: 'The 600 lb ASD allowable covers the RT-MINI pad-to-rafter attachment for the '
          + 'weakest standard wood assembly ONLY. It does NOT establish rail span/cantilever capacity '
          + `for the mixed-manufacturer paired rail (SKU unpinned)${
              _capDoc?.jurisdiction
                ? `, and the source jurisdiction ('${_capDoc.jurisdiction}') is not confirmed for the project AHJ`
                : ', and no capacity document is selected from which a jurisdiction could be confirmed'
            }. Do NOT apply generically.`,
      },
      provenance: {
        source: 'rackingAssembly.buildRackingAssembly',
        ref: system.id,
        note: 'W3.1 §4 RT-MINI capacity provenance — records only in-repo-verifiable evidence; '
          + 'the PE source document is not archived, hence documentHash null + blocking gaps.',
      },
    };
    if (!rtCleared) {
      // D3 — the message states the ACTUAL resolution outcome. It no longer
      // claims the source is "not archived in-repo": when a registry document IS
      // supplied and archived, that is said plainly, and what remains unmet is
      // the enumerated applicability, which is a different and honest failure.
      structuralAuthorityGaps.push({
        code: 'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
        severity: 'blocking',
        message: _capDoc
          ? `A capacity document is on record (${_capDoc.documentId ?? 'id n/a'}${
              _capDoc.archivedInRepo && _capDoc.sha256 ? ', archived with a SHA-256' : ', NOT archived with a SHA-256'
            }) but it does not establish a verified allowable capacity for the selected assembly.`
            + (rtClearance && rtClearance.missing.length
              ? ` Unmet: ${rtClearance.missing.join(', ')}.`
              : '')
          : 'No verified capacity document is selected for the RT-MINI attachment, so the 600 lb ASD '
            + 'allowable is not backed by a source of record. ICC-ES ESR-3575 is a flashing / '
            + 'water-resistance evaluation report and carries no structural capacity authority.',
      });
      structuralAuthorityGaps.push({
        code: 'RACKING-CAPACITY-APPLICABILITY-GAP',
        severity: 'blocking',
        message: 'The 600 lb source does not cover the exact selected assembly: the mixed-manufacturer '
          + `paired rail (SKU unpinned) span/cantilever is unverified${
              _capDoc?.jurisdiction
                ? `, and the document jurisdiction ('${_capDoc.jurisdiction}') is not confirmed for the project AHJ`
                : ', and no capacity document is selected from which a jurisdiction could be confirmed'
            }`
          + `${_capDoc?.exactModel && norm(_capDoc.exactModel) !== norm(mount.model)
              ? `. The document covers '${_capDoc.exactModel}', which is NOT the selected mount '${mount.model}'`
              : ''}`
          + '. Do not apply generically.',
      });
    } else {
      // A VERIFIED registry document covers the exact assembly + installation
      // condition on every required field. Reflect the ARCHIVED source of record.
      const doc = opts!.capacityDocument!;
      capacityProvenance.sourceDocument = {
        identity: doc.documentIdentity ?? 'Roof Tech RT-MINI structural capacity document (verified registry record)',
        revisionOrDate: doc.revisionOrDate ?? capacityProvenance.sourceDocument.revisionOrDate,
        issuingEntity: capacityProvenance.sourceDocument.issuingEntity,
        documentHash: doc.sha256,
        archivedInRepo: true,
        hashNote: `source-archived — verified registry document ${doc.documentId ?? '(id n/a)'} `
          + `(class ${doc.documentClass}); SHA-256 recorded; covers the exact selected assembly + `
          + `installation condition on all required §9 fields.`,
        url: capacityProvenance.sourceDocument.url,
      };
      capacityProvenance.jurisdictionApplicabilityBoundary =
        `Confirmed by verified registry document for jurisdiction '${doc.jurisdiction}'.`;
      capacityProvenance.assemblyApplicability = {
        ...capacityProvenance.assemblyApplicability,
        sourceCoversRail: true,
        sourceCoversSubstrate: true,
        assessment: 'CLEARED — a verified registry document covers the RT-MINI attachment, the selected '
          + 'rail/L-foot assembly, the substrate, and the project jurisdiction on all required §9 fields.',
      };
      // Replace the "not archived / provisional" note with an archived note.
      const provIdx = notes.findIndex(n => /not archived in this repository/i.test(n));
      const archivedNote = `W4 §9 — the RT-MINI structural capacity source is NOW ARCHIVED and VERIFIED `
        + `(registry document ${doc.documentId ?? ''}, SHA-256 recorded). The RACKING-CAPACITY-* blockers are cleared `
        + `because the document covers the exact assembly + installation condition.`;
      if (provIdx >= 0) notes[provIdx] = archivedNote; else notes.push(archivedNote);
    }
  } else {
    capacityProvenance = {
      mountModel: mount.model,
      publishedValueLbs: mount.upliftCapacityLbs,
      capacityBasis: basis,
      asdAllowableLbs: asd.allowableLbs,
      ultimateBasisRefusedForAsd: asd.refused,
      sourceDocument: {
        identity: system.engineeringDataSource ?? system.iccEsReport ?? null,
        revisionOrDate: system.lastUpdated ?? null,
        issuingEntity: mountBrand,
        documentHash: null,
        archivedInRepo: false,
        hashNote: 'source-document-not-archived — engineering data source referenced by label only; '
          + 'no datasheet/ESR file archived in-repo to hash.',
        url: null,
      },
      jurisdictionApplicabilityBoundary: system.iccEsReport ? `Per ${system.iccEsReport}` : null,
      fastenerPattern,
      substrateInstallationCondition: installationCondition,
      adjustmentFactors: {
        omegaUltimateToAllowable: basis === 'allowable' ? 'n/a (published allowable)' : 3.0,
        embedmentIn: mount.fastenerEmbedmentIn ?? 'n/a',
      },
      excludedUltimateRecords: [],
      assemblyApplicability: {
        selectedMountModel: mount.model,
        selectedRail: railModel,
        selectedSubstrate: installationCondition,
        sourceCoversMount: system.iccEsReport ? true : null,
        sourceCoversRail: rail ? true : (mixedManufacturer ? false : null),
        sourceCoversSubstrate: null,
        assessment: mixedManufacturer
          ? 'Mixed-manufacturer assembly — mount source does not cover the paired rail span/cantilever.'
          : 'Same-manufacturer assembly per the cited engineering source.',
      },
      provenance: {
        source: 'rackingAssembly.buildRackingAssembly',
        ref: system.id,
        note: 'W3.1 §4 capacity provenance (generic mount).',
      },
    };
    if (asd.refused) {
      structuralAuthorityGaps.push({
        code: 'RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED',
        severity: 'warning',
        message: `Mount ${mount.model} capacity is ${basis}-basis; the raw value is refused as an ASD `
          + 'allowable (resolveAsdAllowableLbs). The published allowable field applies Ω conversion; '
          + 'verify against the product stamped report before permit use.',
      });
    }
  }

  // ── W6 — per-element verification states (honest; no fabrication) ──
  const _vRailSku: 'verified' | 'pending' | 'unverified' =
    rail?.model ? 'verified' : (railUnpinned ? 'pending' : 'unverified');
  const _vCapacity: 'verified' | 'pending' | 'unverified' =
    isRtMini ? (rtCleared ? 'verified' : 'pending')
      : (publishedAllowable != null && !asd.refused ? 'verified' : 'pending');
  const _vSpan: 'verified' | 'pending' | 'unverified' =
    rail?.maxSpanIn != null ? 'verified' : 'pending';
  // TAC WS-4 — FIELD PRESENCE IS NOT VERIFICATION. This used to read 'verified'
  // whenever three literals existed in mounting-hardware-db (lagBolt +
  // fastenersPerMount + fastenerEmbedmentIn), which is how SCHED / APP-A / PE-1
  // printed "VERIFIED FASTENER ASSEMBLY · 5/16" dia · 2.5" min embedment" while
  // PV-3 — which consults the real 5-condition instruction authority — printed
  // "INSTALLATION DETAILS: NOT ESTABLISHED" on the same package. The elements
  // being present is now reported as `fastenerElementsComplete`; VERIFICATION
  // additionally requires an applicable, evidence-bearing installation
  // document, decided once in structuralProjection.projectFastenerAssembly*
  // (which owns the document test). A flashing/water-resistance evaluation
  // report (ESR-3575) is explicitly NOT fastener authority — the same rule this
  // file already applies to capacity.
  const _fastenerElementsComplete =
    !!(hw.lagBolt && mount.fastenersPerMount != null && mount.fastenerEmbedmentIn != null);
  // Element completeness alone can never be 'verified' here; the document test
  // lives in the projection, which is the ONE fastener predicate. The record
  // therefore reports the honest per-element state, and OVERALL follows it.
  const _vFastener: 'verified' | 'pending' | 'unverified' = 'pending';
  const _vOverall: 'verified' | 'pending' =
    (_vRailSku === 'verified' && _vCapacity === 'verified' && _vSpan === 'verified'
      && (_vFastener as string) === 'verified')
      ? 'verified' : 'pending';

  const base: Omit<RackingAssemblyRecordExt, 'recordRevision'> = {
    assemblyId: `assembly-${system.id}`,
    mountManufacturer: mountBrand,
    mountModel: mount.model,
    // P13 WS-4 — NO SolarPro source carries an orderable part number for either
    // the mount or the rail (mounting-hardware-db has no sku field at all), so
    // these stay null. That is a real catalogue gap and it is NOT the same fact
    // as "the mount is unselected": the mount MODEL is known and pinned above.
    mountSku: null,
    railManufacturer: railBrand,
    railModel: railDisplay,
    railSku: null,
    // ── P13 WS-4 — architecture + attachment mode, projected from the catalog ──
    // mounting-hardware-db already carried mountTopology, fastenersPerMount and
    // maxSpacingIn. Nothing downstream consumed them, so PV-1 printed a
    // deck-mount instruction this design never made and the 48" spacing had no
    // stated source. Product-name inference is PROHIBITED — every value here is
    // read from the record, never from the model string.
    architectureType: system.mountTopology === 'rail_paired' || isRailBased
      ? 'rail-paired'
      : system.mountTopology === 'rail_less' ? 'rail-less' : 'unresolved',
    architectureBasis: system.mountTopologyBasis
      ?? (isRailBased ? `mounting-hardware-db systemType='${system.systemType}'` : null),
    // The RT-MINI RAFTER condition is 2 structural wood screws; the DECK
    // condition is a 5-screw pattern with its own capacity and its own
    // manufacturer instructions. The catalog's fastenersPerMount states which
    // design this record is. A deck design must be selected explicitly and carry
    // deck-specific authority — it is never a fallback "where no rafter falls".
    attachmentMode: mount.fastenersPerMount === 2 ? 'rafter'
      : mount.fastenersPerMount === 5 ? 'structural-deck' : 'unresolved',
    attachmentModeBasis: mount.fastenersPerMount != null
      ? `mounting-hardware-db mount.fastenersPerMount=${mount.fastenersPerMount} `
        + `(${mount.fastenersPerMount === 2 ? 'rafter attachment' : mount.fastenersPerMount === 5 ? 'structural-deck attachment' : 'pattern not recognised'})`
      : null,
    fastenersPerMount: mount.fastenersPerMount ?? null,
    attachmentSpacingSourceIn: mount.maxSpacingIn ?? null,
    attachmentSpacingSource: mount.maxSpacingIn != null
      ? `mounting-hardware-db mount.maxSpacingIn=${mount.maxSpacingIn}" (manufacturer maximum)`
      : null,
    lFootOrAdapter: /l_foot/i.test(mount.attachmentMethod) ? `${mountBrand} L-Foot` : null,
    tBoltFastener: isRailBased ? 'Rail T-bolt / mount-to-rail bolt' : null,
    midClamp: hw.midClamp ?? null,
    endClamp: hw.endClamp ?? null,
    // §10 — no "or equivalent"/"compatible" placeholder: pin the splice SKU or
    // print PENDING SELECTION when the rail (and thus its splice) is unpinned.
    splice: railUnpinned ? RAIL_PENDING : (hw.railSplice ?? null),
    groundingBonding: hw.bondingHardware ?? null,
    // Not carried in mounting-hardware-db — honest gap, not fabricated.
    compatibleModuleThicknessInRange: null,
    // TAC WS-5 — `installationCondition` is the manufacturer's COMPATIBLE ROOF
    // COVERING list ('asphalt_shingle, wood_shake'), NOT a structural substrate.
    // It used to be consumed as the fastener's embedment substrate, which is how
    // the package printed "2.5" minimum embedment into asphalt_shingle,
    // wood_shake". The covering list keeps its own name; the embedment substrate
    // is the canonical structural member (attachments[].substrateMember).
    installationCondition,
    compatibleRoofCoverings: system.compatibleRoofTypes ?? [],
    rafterDeckAttachmentMethod: mount.attachmentMethod ?? null,
    fastenerElementsComplete: _fastenerElementsComplete,
    screwLagModel: hw.lagBolt ?? null,
    screwLagQtyPerMount: mount.fastenersPerMount ?? null,
    embedmentRequirementIn: mount.fastenerEmbedmentIn ?? null,
    pilotHoleRequired: /no pilot hole/i.test(system.description ?? '') ? false : null,
    publishedCapacityAllowableLbs: publishedAllowable,
    capacityBasis: mount.capacityBasis ?? 'ultimate',
    capacitySource: system.engineeringDataSource ?? null,
    datasheetRevision: system.lastUpdated ?? null,
    datasheetSource: system.iccEsReport ?? system.engineeringDataSource ?? null,
    ul2703ListingBasis: system.ul2703Listed ? (system.iccEsReport ?? 'UL 2703 listed') : null,
    iccEsReport: system.iccEsReport ?? null,
    mixedManufacturer,
    assemblySupported,
    provenance: {
      source: 'mounting-hardware-db',
      ref: system.id,
      note: 'uplift capacity = ASD allowable via attachmentCapacity (Ω=3.0 for ultimate-basis; '
        + 'unchanged for allowable-basis) — one code factor applied once',
    },
    notes,
    // ── W3.1 §4 ──
    capacityProvenance,
    structuralAuthorityGaps,
    // ── W6 completeness ──
    railStockLengthIn: rail?.spliceIntervalIn ?? null,
    spanCantileverSource: rail?.maxSpanIn != null
      ? 'mounting-hardware-db rail spec (manufacturer max span)'
      : (railUnpinned ? null : (system.iccEsReport ?? null)),
    assemblyVerification: {
      railSku: _vRailSku, capacitySource: _vCapacity, spanSource: _vSpan,
      fastener: _vFastener, overall: _vOverall,
    },
    // ── D6 — ROLES, STATED STRUCTURALLY ─────────────────────────────────────
    // ESR-3575 fills the listing / flashing role and ONLY that role. It is an
    // ICC-ES evaluation report for a self-flashing mount: that is exactly the
    // authority it carries, and Sec. 5.2 excludes structural capacity. Naming it
    // in `capacitySource` (as the legacy field still does for back-compat) was
    // the defect; this record is the authoritative statement.
    documentRoles: {
      listingFlashingBasis: system.iccEsReport
        ? {
            established: true,
            documentIdentity: system.iccEsReport,
            documentId: null,
            documentHash: null,
            archivedInRepo: false,
            basis: `${system.iccEsReport} is an ICC-ES evaluation report covering flashing / `
              + `water-resistance for this mount. This is the role it carries — and the only one.`,
          }
        : unfilledRole('no ICC-ES evaluation report is recorded for this mount'),
      installationAuthority: unfilledRole(
        'No version-exact installation document is resolved into this record. Installation authority '
        + 'is owned by manufacturer_document_registry and must cover the SELECTED product exactly.'),
      fastenerAuthority: unfilledRole(
        'No fastener-installation authority is established. An ICC-ES flashing / water-resistance '
        + 'evaluation report carries no fastener-installation authority.'),
      structuralCapacityAuthority: rtCleared && _capDoc
        ? {
            established: true,
            documentIdentity: _capDoc.documentIdentity,
            documentId: _capDoc.documentId,
            documentHash: _capDoc.sha256,
            archivedInRepo: _capDoc.archivedInRepo,
            basis: 'A verified registry document covers the exact selected assembly and installation '
              + 'condition on every required applicability field.',
          }
        : unfilledRole(
            _capDoc
              ? `The supplied capacity document does not establish capacity for the selected assembly`
                + `${rtClearance && rtClearance.missing.length ? ` (unmet: ${rtClearance.missing.join(', ')})` : ''}.`
              : 'No structural capacity authority is established for the selected assembly. '
                + `${system.iccEsReport ?? 'The ICC-ES report'} is a flashing / water-resistance `
                + 'evaluation and explicitly excludes structural capacity.'),
      ul2703BondingBasis: system.ul2703Listed
        ? {
            established: true,
            documentIdentity: system.iccEsReport ?? 'UL 2703 listed',
            documentId: null,
            documentHash: null,
            archivedInRepo: false,
            basis: 'UL 2703 listing basis for bonding/grounding of the mounting system.',
          }
        : unfilledRole('the mounting system records no UL 2703 listing'),
      projectSpecificEngineeringAuthority: unfilledRole(
        'No project-specific licensed engineering analysis is on record for this assembly.'),
    },
  };
  return { ...base, recordRevision: contentRevision(base) };
}
