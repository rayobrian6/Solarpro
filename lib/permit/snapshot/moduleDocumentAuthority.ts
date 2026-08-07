// ═══════════════════════════════════════════════════════════════════════════
// CMDA §0 — CANONICAL MODULE DOCUMENT AUTHORITY.
//
// THE ONE ANSWER to "does the selected module's datasheet actually cover it?".
// Every gate, renderer, BOM exporter and API reads this result. Nothing
// downstream re-decides it.
//
// WHAT WAS WRONG. D8 removed *false* title-based exactness, but it left the
// question owned by evidence too weak to answer it:
//
//   • `pickVerifiedDocument` accepted a document on
//     `equipment_model_applicability LIKE '%<model>%'` — a substring match — with
//     no module-specific claim required at all.
//   • `resolveModuleDatasheetExactness` returned EXACT from the mere PRESENCE of
//     a bound document id, and everything below EXACT from regexes run over a
//     STATIC ASSET's marketing title (`385-405W`, `410W/400W`).
//   • DS-1 re-ran that same helper with no binding, so it could never see EXACT
//     and printed "Attach the exact 400 W datasheet" even where an official
//     family sheet demonstrably covers 400 W.
//
// So a document could be archived, hashed, marked verified and loosely
// model-matched, and clear the module requirement without any proof that it
// covers the selected 400 W variant. And conversely, a genuine Q CELLS
// 385–405 W family sheet that DOES cover 400 W was reported as a failure.
//
// THE RULE. Two independent questions, both of which must pass:
//
//     Is this document authentic and governed?   → verification authority
//     Does it cover the selected module?         → the module claims below
//
//     verified document  ≠  applicable module document
//
// AND ONE ROW. Identity, hash, verification and applicability must ALL come from
// the SAME registry row. Borrowing a hash from one row and a claim from another
// is how a document "covers" a module it has never heard of.
// ═══════════════════════════════════════════════════════════════════════════

import type { RegistryDocument } from '@/lib/documents/types';

/** The verdict. `EXACT_VARIANT` and `FAMILY_COVERED` both CLEAR — a family
 *  document that explicitly includes the selected variant is a real source, and
 *  demanding a single-wattage PDF instead was a false requirement. */
export type ModuleApplicabilityState =
  /** the document names this exact variant (model and/or wattage, per-variant). */
  | 'EXACT_VARIANT'
  /** the document covers a family/range that explicitly includes the selection. */
  | 'FAMILY_COVERED'
  /** the document is governed but demonstrably does NOT cover the selection. */
  | 'NOT_COVERED'
  /** a document exists but its claims cannot answer the question. NOT a failure
   *  of the module — a failure of the EVIDENCE. */
  | 'EVIDENCE_INCOMPLETE'
  /** no governed registry document at all. */
  | 'NO_DOCUMENT';

/** THE canonical result. One frozen object per distinct selected module. */
export interface ModuleDatasheetApplicabilityAuthority {
  // ── the SELECTED equipment identity (canonical equipment authority owns these)
  selectedEquipmentId: string | null;
  selectedManufacturer: string | null;
  selectedModel: string | null;
  selectedWatts: number | null;

  // ── the REGISTRY ROW being cited (document registry owns these)
  documentId: string | null;
  documentClass: string | null;
  documentTitle: string | null;
  sha256: string | null;
  archivedInRepo: boolean;
  status: string | null;

  // ── GOVERNED VERIFICATION (verification authority owns these)
  verificationState: string | null;
  verificationActor: string | null;
  verificationBasis: string | null;

  // ── THE VERDICT (this module owns it, and only this module)
  state: ModuleApplicabilityState;
  /** true ⇔ state is EXACT_VARIANT or FAMILY_COVERED. THE clearance signal. */
  clears: boolean;
  /** the document's covered range, when it states one. Never title-parsed. */
  coveredRange: { minWatts: number; maxWatts: number } | null;
  coveredWattages: number[] | null;
  coveredModels: string[] | null;
  /** where the coverage was read from, verbatim from the claims. */
  evidenceLocation: string | null;
  /** the document's own stated basis. */
  applicabilityBasis: string | null;
  /** every clearance condition that failed, named. Empty ⇔ `clears`. */
  refusals: string[];
  /** the sentence DS-1 / RS-1 print. A PROJECTION — no consumer composes its own. */
  basis: string;
}

/** The selected module, as the canonical equipment authority states it. */
export interface SelectedModuleIdentity {
  equipmentId: string | null;
  manufacturer: string | null;
  model: string | null;
  watts: number | null;
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Render the claim's evidence location as one auditable string. Null when the
 *  claims name no location at all — which is itself disqualifying. */
export function formatEvidenceLocation(
  ev: NonNullable<NonNullable<RegistryDocument['extractedClaims']>['module']>['evidence'] | null | undefined,
): string | null {
  if (!ev) return null;
  const parts: string[] = [];
  if (ev.page != null) parts.push(`page ${ev.page}`);
  if (ev.section) parts.push(`§${ev.section}`);
  if (ev.table) parts.push(`table ${ev.table}`);
  if (ev.row) parts.push(`row ${ev.row}`);
  if (ev.column) parts.push(`column ${ev.column}`);
  return parts.length ? parts.join(', ') : null;
}

/** NO DOCUMENT — the honest empty result. Exported so every caller produces the
 *  same shape rather than inventing its own null-object. */
export function noModuleDocumentAuthority(
  selected: SelectedModuleIdentity,
  reason = 'no governed module_datasheet registry document is on file for the selected module',
): ModuleDatasheetApplicabilityAuthority {
  return {
    selectedEquipmentId: selected.equipmentId, selectedManufacturer: selected.manufacturer,
    selectedModel: selected.model, selectedWatts: selected.watts,
    documentId: null, documentClass: null, documentTitle: null, sha256: null,
    archivedInRepo: false, status: null,
    verificationState: null, verificationActor: null, verificationBasis: null,
    state: 'NO_DOCUMENT', clears: false,
    coveredRange: null, coveredWattages: null, coveredModels: null,
    evidenceLocation: null, applicabilityBasis: null,
    refusals: [reason],
    basis: reason,
  };
}

/**
 * THE evaluation. Pure, total, and the ONLY place a module-applicability verdict
 * is produced.
 *
 * `doc` MUST be the same registry row whose identity, hash and verification are
 * being cited downstream — condition 9 of the clearance contract is satisfied
 * structurally, by taking ONE row, rather than by a cross-check after the fact.
 */
export function evaluateModuleDatasheetApplicability(args: {
  selected: SelectedModuleIdentity;
  document: RegistryDocument | null;
}): ModuleDatasheetApplicabilityAuthority {
  const { selected, document: doc } = args;
  if (!doc) return noModuleDocumentAuthority(selected);

  const claims = doc.extractedClaims?.module ?? null;
  const evidenceLocation = formatEvidenceLocation(claims?.evidence);
  const coveredRange = claims?.explicitWattageRange
    && Number.isFinite(claims.explicitWattageRange.minWatts)
    && Number.isFinite(claims.explicitWattageRange.maxWatts)
    ? { minWatts: claims.explicitWattageRange.minWatts, maxWatts: claims.explicitWattageRange.maxWatts }
    : null;
  const coveredWattages = claims?.wattagesCovered?.filter(n => Number.isFinite(n)) ?? null;
  const coveredModels = claims?.modelsCovered?.filter(Boolean) ?? null;

  const base = {
    selectedEquipmentId: selected.equipmentId,
    selectedManufacturer: selected.manufacturer,
    selectedModel: selected.model,
    selectedWatts: selected.watts,
    documentId: doc.id,
    documentClass: doc.documentClass,
    documentTitle: doc.title ?? null,
    sha256: doc.sha256 ?? null,
    archivedInRepo: doc.archivedInRepo === true,
    status: doc.status ?? null,
    verificationState: doc.verificationState ?? null,
    verificationActor: doc.verifiedBy ?? null,
    verificationBasis: doc.verificationNotes ?? null,
    coveredRange,
    coveredWattages: coveredWattages && coveredWattages.length ? coveredWattages : null,
    coveredModels: coveredModels && coveredModels.length ? coveredModels : null,
    evidenceLocation,
    applicabilityBasis: claims?.applicabilityBasis ?? null,
  };

  const refuse = (
    state: ModuleApplicabilityState, refusals: string[], basis: string,
  ): ModuleDatasheetApplicabilityAuthority => ({ ...base, state, clears: false, refusals, basis });

  // ── CUSTODY + GOVERNANCE (conditions 1-5) ────────────────────────────────
  // These are about the DOCUMENT, not about this module. A failure here means
  // the row cannot be cited at all, whatever its claims say.
  const custody: string[] = [];
  if (doc.documentClass !== 'module_datasheet') {
    custody.push(`the cited document is class '${doc.documentClass}', not 'module_datasheet'`);
  }
  if ((doc.status ?? '').toLowerCase() !== 'current') custody.push(`the document status is '${doc.status}', not 'current'`);
  if (doc.archivedInRepo !== true) custody.push('the document bytes are not archived');
  if (!doc.sha256 || !/^[0-9a-f]{64}$/i.test(doc.sha256)) custody.push('the document carries no valid SHA-256');
  if ((doc.verificationState ?? '') !== 'verified') {
    custody.push(`the document verification state is '${doc.verificationState ?? 'unrecorded'}', not 'verified'`);
  }
  if (!doc.verifiedBy || !String(doc.verifiedBy).trim()) {
    custody.push('the document carries no verification actor — custody is not verification');
  }
  if (!selected.equipmentId && !selected.model) {
    custody.push('the selected module identity is not established (no catalogue id and no model)');
  }
  if (custody.length) {
    return refuse('EVIDENCE_INCOMPLETE', custody,
      `the module document cannot be cited as authority: ${custody.join('; ')}`);
  }

  // ── THE APPLICABILITY CLAIMS (conditions 6-8) ────────────────────────────
  // The registry row is governed. Now — and only now — does it get asked whether
  // it covers THIS module. A document with no module claims cannot answer, and
  // "cannot answer" is EVIDENCE_INCOMPLETE, never coverage.
  if (!claims) {
    return refuse('EVIDENCE_INCOMPLETE',
      ['the document carries no structured module applicability claims'],
      'the document is governed but states no structured module coverage — a verified document is authentic, '
      + 'which is a different question from whether it covers the selected variant');
  }
  if (!evidenceLocation) {
    return refuse('EVIDENCE_INCOMPLETE',
      ['the module claims name no evidence location (page / table / row / column / section)'],
      'the document states module coverage but does not say WHERE it is stated, so the claim cannot be audited');
  }
  if (claims.electricalMechanicalSpecificationsPresent !== true) {
    return refuse('EVIDENCE_INCOMPLETE',
      ['the module claims do not assert that electrical + mechanical specifications are present'],
      'the document does not print the electrical and mechanical specifications for the covered variants');
  }

  // ── PRODUCT / FAMILY COVERAGE (condition 6) ──────────────────────────────
  // Identity first: the stable catalogue id is authoritative. A model string is
  // supporting evidence and must be an EXACT normalised equality — never the
  // substring test that let a loosely-named row claim this module.
  const idCovered = !!selected.equipmentId
    && (claims.equipmentIdsCovered ?? []).some(x => norm(x) === norm(selected.equipmentId));
  const modelCovered = !!selected.model
    && ((claims.modelsCovered ?? []).some(x => norm(x) === norm(selected.model))
      || (claims.variantsCovered ?? []).some(v => norm(v.model) === norm(selected.model)));
  const familyCovered = !!claims.productFamily && !!selected.model
    && norm(selected.model).startsWith(norm(claims.productFamily));

  if (!idCovered && !modelCovered && !familyCovered) {
    return refuse('NOT_COVERED',
      ['the document claims do not cover the selected product or family'],
      `the document covers ${claims.productFamily ?? ((claims.modelsCovered ?? []).join(', ') || 'no stated product')}`
      + `, which does not include the selected '${selected.model ?? selected.equipmentId}'`);
  }

  // ── WATTAGE COVERAGE (condition 7) ───────────────────────────────────────
  if (selected.watts == null || !Number.isFinite(selected.watts)) {
    return refuse('EVIDENCE_INCOMPLETE',
      ['the selected module wattage is not established, so coverage cannot be decided'],
      'the selected module wattage is unknown — coverage of an unknown wattage cannot be proven');
  }
  const w = selected.watts;

  // The strongest claim shape: a per-variant row naming this exact variant.
  const exactVariant = (claims.variantsCovered ?? []).find(v =>
    (v.watts === w)
    && (
      (!!selected.equipmentId && norm(v.equipmentId) === norm(selected.equipmentId))
      || (!!selected.model && norm(v.model) === norm(selected.model))
      // a variant row with no identity of its own still counts when the document
      // as a whole is already established as covering this product/family
      || (!v.model && !v.equipmentId)
    ));
  const wattInList = (claims.wattagesCovered ?? []).includes(w);
  const wattInRange = !!coveredRange && w >= coveredRange.minWatts && w <= coveredRange.maxWatts;

  if (!exactVariant && !wattInList && !wattInRange) {
    const stated = coveredRange
      ? `${coveredRange.minWatts}–${coveredRange.maxWatts} W`
      : (coveredWattages?.length ? `${coveredWattages.join(' W, ')} W` : 'no stated wattage');
    return refuse('NOT_COVERED',
      [`the document covers ${stated} and the selected module is ${w} W`],
      `the document explicitly covers ${stated}; the selected ${selected.model ?? 'module'} is ${w} W, which is not included`);
  }

  // ── CLEARED ──────────────────────────────────────────────────────────────
  // EXACT_VARIANT when the document names this variant on its own row;
  // FAMILY_COVERED when it covers it through a stated family range or list.
  // BOTH clear: a family document that explicitly includes the selection IS the
  // manufacturer's source for it, and demanding a single-wattage PDF instead was
  // a requirement SolarPro invented.
  const state: ModuleApplicabilityState = exactVariant ? 'EXACT_VARIANT' : 'FAMILY_COVERED';
  const coverageWording = exactVariant
    ? `names the ${w} W variant on its own row`
    : coveredRange
      ? `explicitly covers ${coveredRange.minWatts}–${coveredRange.maxWatts} W, which includes ${w} W`
      : `explicitly lists ${w} W among the covered wattages`;
  return {
    ...base,
    state,
    clears: true,
    refusals: [],
    basis: `registry document '${doc.id}' (${doc.title ?? 'untitled'}, SHA-256 ${String(doc.sha256).slice(0, 12)}…, `
      + `verified by ${doc.verifiedBy}) ${coverageWording} for ${selected.manufacturer ?? ''} `.replace(/\s+/g, ' ')
      + `${selected.model ?? selected.equipmentId} — ${evidenceLocation}`,
  };
}

/** The DS-1 / RS-1 headline for a state. A PROJECTION: renderers print this and
 *  never compose their own wording, which is how "Attach the exact 400 W
 *  datasheet" survived next to a document that covers 400 W. */
export const MODULE_APPLICABILITY_HEADLINE: Record<ModuleApplicabilityState, string> = {
  EXACT_VARIANT: 'OFFICIAL MODULE DATASHEET — EXACT VARIANT VERIFIED',
  FAMILY_COVERED: 'OFFICIAL MODULE DATASHEET — FAMILY COVERAGE VERIFIED',
  NOT_COVERED: 'MODULE DATASHEET DOES NOT COVER THE SELECTED MODULE',
  EVIDENCE_INCOMPLETE: 'MODULE DATASHEET APPLICABILITY EVIDENCE INCOMPLETE',
  NO_DOCUMENT: 'NO GOVERNED MODULE DATASHEET ON FILE',
};
