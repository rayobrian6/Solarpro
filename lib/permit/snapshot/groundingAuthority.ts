// ═══════════════════════════════════════════════════════════════════════════
// OPEN-AIR MICRO / Q-CABLE GROUNDING AUTHORITY (2026-07-25) — the DOCUMENT-BASED
// three-outcome resolution, fail-closed.
//
// RAY'S RULING (the correction this module implements):
//   Conductor count alone is NOT manufacturer or code authority. A listed
//   TWO-conductor cable assembly feeding a double-insulated (Class II)
//   microinverter system may INTENTIONALLY require no additional equipment
//   grounding conductor — or it may require one. Only the EXACT selected
//   equipment's manufacturer documents decide. The prior pass resolved this from
//   `conductorCount === 2` and presented it as "manufacturerAuthority"; that was
//   an inference wearing an authority's label.
//
// THE THREE OUTCOMES (no fourth, no implicit default):
//   A  NO_SEPARATE_EGC_REQUIRED          — a verified, exactly-applicable document
//                                          states the listed method needs no
//                                          additional grounding conductor
//   B  SEPARATE_EGC_REQUIRED             — a verified, exactly-applicable document
//                                          states an additional EGC is required
//   C  PENDING_MANUFACTURER_AUTHORITY    — everything else (fail-closed)
//
// THE STRUCTURAL RULE (why "2-conductor ⇒ B" cannot recur):
//   `outcomeFromDocument()` is the ONLY function that returns A or B, and its
//   parameters are ONLY the document evidence + its applicability verification.
//   It never receives the conductor count, the conductor construction, the brand,
//   the insulation string or any other equipment fact — so an inference from
//   conductor count is not merely forbidden by a comment, it is UNEXPRESSIBLE in
//   the code path that selects the outcome. The equipment facts are RECORDED on
//   the result as descriptive, explicitly NON-DETERMINATIVE data.
//
// RESOLUTION SPECIFICITY (Ray §1): authority is resolved for exactly the selected
//   microinverter SKU + the selected cable-assembly SKU + the selected module SKU
//   + the selected mounting/bonding system + the project jurisdiction. A document
//   whose applicability scope is a FAMILY / SERIES / PRODUCT LINE (an IQ8 family
//   datasheet, IQ-Commercial QD-Cable guidance, a legacy Engage rule) can never
//   establish the method — `scope` must be 'exact-sku' and every selected item
//   must appear in the document's own declared applicability.
//
// SEPARATION (Ray §5): the result of this resolver applies to ONE domain — the
//   OPEN-AIR micro branch / Q-Cable section. The in-raceway home-run EGC, the
//   racking / module-frame bonding, the GEC and the service bonding are DISTINCT
//   canonical objects with their own independent bases (see
//   buildGroundingDomainGraph). Nothing here conflates them.
//
// PURE — no DB, no I/O, deterministic (digest-safe). The DB/registry resolution of
// a candidate document lives in lib/documents; this module turns resolved EVIDENCE
// into the canonical authority record and drives the single blocker
// QCABLE-GROUNDING-AUTHORITY-UNVERIFIED.
// ═══════════════════════════════════════════════════════════════════════════

/** The EXACT three outcomes. No fourth value is legal. */
export type GroundingOutcome =
  | 'NO_SEPARATE_EGC_REQUIRED'
  | 'SEPARATE_EGC_REQUIRED'
  | 'PENDING_MANUFACTURER_AUTHORITY';

/** What a manufacturer document may EXPLICITLY state about the grounding method
 *  for the open-air branch/cable section. Anything vaguer is not a statement. */
export type GroundingStatedMethod =
  | 'no-additional-equipment-grounding-conductor'
  | 'additional-equipment-grounding-conductor';

/** The blocker this authority drives when the outcome is PENDING. */
export const GROUNDING_AUTHORITY_BLOCKER_CODE = 'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED';

/** The ONE label every sheet prints while the outcome is PENDING. Never
 *  "separate EGC required", never "no EGC required", never PASS/VERIFIED. */
export const GROUNDING_PENDING_LABEL = 'GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY';

/** PPC §1 — THE label the E-1 / PV-4B / SCHED *conductor* cells print for the
 *  open-air branch section while the outcome is PENDING. It states BOTH facts a
 *  reviewer needs and asserts NOTHING: the method is pending, and no installed
 *  open-air EGC is being claimed. The previous cell derived a `#12 AWG Cu EGC …
 *  with circuit conductors` string straight off groundingObjects[].conductorSize
 *  — an INSTALLED-conductor assertion rendered on the same sheet as the PENDING
 *  prose. Never "#12 EGC", never "with circuit conductors", never PASS. */
export const GROUNDING_PENDING_BONDING_CELL_LABEL =
  'OPEN-AIR GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY / INSTALLED OPEN-AIR EGC: NOT ASSERTED';

/** PPC §1 — the non-orderable label for the CANDIDATE open-air EGC quantity while
 *  PENDING (mirrors FASTENER_NON_ORDERABLE_LABEL — the established pattern). Ray's
 *  binding wording: the quantity is a candidate, it cannot be ordered, and it is
 *  NOT part of the approved installation. */
export const GROUNDING_NON_ORDERABLE_LABEL =
  'CANDIDATE DESIGN QUANTITY — NON-ORDERABLE / NOT PART OF THE APPROVED INSTALLATION / '
  + 'PENDING EXACT MANUFACTURER AUTHORITY';

// ── the document's OWN declared applicability ────────────────────────────────

/** Exactly what the document declares its grounding statement covers. Every list
 *  is EXACT SKUs / system identifiers as printed in the document — never a family
 *  wildcard. `scope` records how the document itself frames its coverage. */
export interface GroundingApplicabilityClaim {
  microinverterSkus: string[];
  cableAssemblySkus: string[];
  moduleSkus: string[];
  mountingBondingSystems: string[];
  /** jurisdictions / code bases the statement is written against. */
  jurisdictions: string[];
  /** ONLY 'exact-sku' can establish authority for a selected SKU. */
  scope: 'exact-sku' | 'family' | 'series' | 'product-line' | 'unspecified';
  /** the product line the document belongs to ('IQ8 residential', 'IQ Commercial'…). */
  productLine: string | null;
}

/** A resolved manufacturer document that MIGHT establish the grounding method.
 *  Produced by lib/documents (RegistryDocument → this shape). Never fabricated. */
export interface GroundingDocumentEvidence {
  documentId: string;
  documentClass: string;
  title: string | null;
  revision: string | null;
  /** SHA-256 of the archived file. Required — an unhashed document is unverifiable. */
  documentHash: string | null;
  archivedInRepo: boolean;
  /** must be 'verified'. */
  verificationState: string;
  /** must be 'current' (a superseded revision cannot establish the method). */
  status: string;
  /** the EXACT section / page the grounding statement appears in. */
  sectionOrPage: string | null;
  /** the method the document EXPLICITLY states. null ⇒ it states none ⇒ PENDING. */
  statedGroundingMethod: GroundingStatedMethod | null;
  /** the statement as recorded (for the evidence artifact / citation). */
  statedText: string | null;
  /** the equipment insulation / classification the document establishes
   *  (e.g. 'Class II double-insulated'). Descriptive — never a selector. */
  equipmentClassification: string | null;
  applicability: GroundingApplicabilityClaim;
}

/** The exact selected equipment + jurisdiction the authority must cover. */
export interface GroundingSelection {
  microSku: string | null;
  cableSku: string | null;
  moduleSku: string | null;
  mountingBondingSystem: string | null;
  jurisdiction: string | null;
}

/** Equipment facts RECORDED on the result for transparency. Explicitly
 *  NON-DETERMINATIVE: none of these is passed to the outcome selector. */
export interface GroundingEquipmentFacts {
  /** e.g. 'two-wire, double-insulated (factory-connectorized)'. Catalog prose. */
  cableConductorConstruction: string | null;
  cableConductorCount: number | null;
  /** the equipment insulation class/classification IF a document establishes it;
   *  otherwise the honest 'not established' string. */
  equipmentInsulationClassification: string | null;
}

// ── applicability verification ───────────────────────────────────────────────

export interface GroundingApplicabilityVerification {
  documentPresent: boolean;
  documentVerified: boolean;
  documentCurrent: boolean;
  documentArchived: boolean;
  documentHashed: boolean;
  statesMethodExplicitly: boolean;
  sectionCited: boolean;
  scopeIsExactSku: boolean;
  microSkuExactMatch: boolean;
  cableSkuExactMatch: boolean;
  moduleCovered: boolean;
  mountingBondingCovered: boolean;
  jurisdictionCovered: boolean;
  verdict: 'applicable' | 'not-applicable' | 'no-document';
  /** every unmet condition, human-readable (rendered on RS-1 / the evidence set). */
  failures: string[];
}

const norm = (s: string | null | undefined): string =>
  (s ?? '').toString().trim().toUpperCase().replace(/\s+/g, ' ');

/** EXACT membership — no substring, no family, no prefix matching. A selected SKU
 *  is covered only when the document names that exact SKU. */
function exactlyCovers(list: string[] | null | undefined, selected: string | null | undefined): boolean {
  const sel = norm(selected);
  if (!sel) return false;                          // nothing selected ⇒ cannot verify
  return (list ?? []).some(x => norm(x) === sel);
}

/** Jurisdiction coverage: an exact jurisdiction match, or a document that
 *  explicitly declares blanket coverage of the code base it is written against.
 *  A blank jurisdiction claim never covers anything. */
function coversJurisdiction(list: string[] | null | undefined, selected: string | null | undefined): boolean {
  const sel = norm(selected);
  if (!sel) return false;
  const claims = (list ?? []).map(norm).filter(Boolean);
  if (claims.length === 0) return false;
  return claims.some(c => c === sel || c === 'ALL US NEC JURISDICTIONS');
}

/**
 * PURE: does this document actually establish the grounding method for the EXACT
 * selected equipment in the project jurisdiction? Fail-closed — every unmet
 * condition is enumerated, and a family / series / product-line document can
 * never pass (`scope` must be 'exact-sku' AND each selected item must appear).
 */
export function verifyGroundingDocumentApplicability(
  doc: GroundingDocumentEvidence | null | undefined,
  sel: GroundingSelection,
): GroundingApplicabilityVerification {
  const failures: string[] = [];
  if (!doc) {
    return {
      documentPresent: false, documentVerified: false, documentCurrent: false,
      documentArchived: false, documentHashed: false, statesMethodExplicitly: false,
      sectionCited: false, scopeIsExactSku: false, microSkuExactMatch: false,
      cableSkuExactMatch: false, moduleCovered: false, mountingBondingCovered: false,
      jurisdictionCovered: false, verdict: 'no-document',
      failures: [
        'no manufacturer document establishing the equipment grounding/bonding method for the '
        + 'open-air microinverter branch / cable-assembly section is archived and verified in this repository',
      ],
    };
  }

  const documentVerified = norm(doc.verificationState) === 'VERIFIED';
  if (!documentVerified) failures.push(`document verification state is '${doc.verificationState}', not 'verified'`);
  const documentCurrent = norm(doc.status) === 'CURRENT';
  if (!documentCurrent) failures.push(`document status is '${doc.status}', not 'current' (a superseded revision cannot establish the method)`);
  const documentArchived = doc.archivedInRepo === true;
  if (!documentArchived) failures.push('the exact document is not archived in this repository (archivedInRepo=false)');
  const documentHashed = !!doc.documentHash && doc.documentHash.trim().length >= 16;
  if (!documentHashed) failures.push('no SHA-256 recorded for the archived document');
  const statesMethodExplicitly = doc.statedGroundingMethod === 'no-additional-equipment-grounding-conductor'
    || doc.statedGroundingMethod === 'additional-equipment-grounding-conductor';
  if (!statesMethodExplicitly) failures.push('the document does not EXPLICITLY state the equipment grounding/bonding method for this section');
  const sectionCited = !!(doc.sectionOrPage && doc.sectionOrPage.trim());
  if (!sectionCited) failures.push('no exact section/page recorded for the grounding statement');

  const ap = doc.applicability;
  const scopeIsExactSku = ap?.scope === 'exact-sku';
  if (!scopeIsExactSku) {
    failures.push(
      `document applicability scope is '${ap?.scope ?? 'unspecified'}' — a family / series / product-line `
      + 'statement can never establish the method for a selected SKU (no family-level assumption)',
    );
  }
  const microSkuExactMatch = exactlyCovers(ap?.microinverterSkus, sel.microSku);
  if (!microSkuExactMatch) {
    failures.push(`the document does not explicitly cover the selected microinverter '${sel.microSku ?? '—'}' `
      + `(covers: ${(ap?.microinverterSkus ?? []).join(', ') || 'none'})`);
  }
  const cableSkuExactMatch = exactlyCovers(ap?.cableAssemblySkus, sel.cableSku);
  if (!cableSkuExactMatch) {
    failures.push(`the document does not explicitly cover the selected cable assembly '${sel.cableSku ?? '—'}' `
      + `(covers: ${(ap?.cableAssemblySkus ?? []).join(', ') || 'none'})`);
  }
  const moduleCovered = exactlyCovers(ap?.moduleSkus, sel.moduleSku);
  if (!moduleCovered) {
    failures.push(`the document does not explicitly cover the selected module '${sel.moduleSku ?? '—'}'`);
  }
  const mountingBondingCovered = exactlyCovers(ap?.mountingBondingSystems, sel.mountingBondingSystem);
  if (!mountingBondingCovered) {
    failures.push(`the document does not explicitly cover the selected mounting / bonding system '${sel.mountingBondingSystem ?? '—'}'`);
  }
  const jurisdictionCovered = coversJurisdiction(ap?.jurisdictions, sel.jurisdiction);
  if (!jurisdictionCovered) {
    failures.push(`the document's stated jurisdiction/code basis does not cover the project jurisdiction '${sel.jurisdiction ?? '—'}'`);
  }

  return {
    documentPresent: true, documentVerified, documentCurrent, documentArchived, documentHashed,
    statesMethodExplicitly, sectionCited, scopeIsExactSku,
    microSkuExactMatch, cableSkuExactMatch, moduleCovered, mountingBondingCovered, jurisdictionCovered,
    verdict: failures.length === 0 ? 'applicable' : 'not-applicable',
    failures,
  };
}

// ── THE outcome selector (the structural rule) ───────────────────────────────

/**
 * THE ONLY function that can return outcome A or B.
 *
 * Its parameters are the document evidence and its applicability verification —
 * NOTHING ELSE. No conductor count, no conductor construction, no brand, no
 * insulation string is in scope, so a conductor-count inference cannot be written
 * here without changing the signature (which the regression tests pin). Any input
 * that is not a verified, exactly-applicable document with an explicit stated
 * method resolves to C, PENDING_MANUFACTURER_AUTHORITY.
 */
export function outcomeFromDocument(
  doc: GroundingDocumentEvidence | null | undefined,
  applic: GroundingApplicabilityVerification,
): GroundingOutcome {
  if (!doc) return 'PENDING_MANUFACTURER_AUTHORITY';
  if (applic.verdict !== 'applicable') return 'PENDING_MANUFACTURER_AUTHORITY';
  switch (doc.statedGroundingMethod) {
    case 'no-additional-equipment-grounding-conductor': return 'NO_SEPARATE_EGC_REQUIRED';
    case 'additional-equipment-grounding-conductor': return 'SEPARATE_EGC_REQUIRED';
    default: return 'PENDING_MANUFACTURER_AUTHORITY';
  }
}

// ── the canonical result record ──────────────────────────────────────────────

/** Racking / module-frame bonding — a DISTINCT authority (Ray §5c). It is
 *  required regardless of the open-air cable-grounding outcome, so its hardware is
 *  never removed by outcome A. */
export interface RackingModuleBondingRequirement {
  required: boolean;
  /** the listed bonding path (UL 2703 assembly / listed jumpers + lugs). */
  method: string;
  codeBasis: string;
  /** true — it is decided independently of the open-air cable-grounding question. */
  independentOfCableGrounding: boolean;
  /** hardware stays in the BOM under every outcome. */
  hardwareRetained: boolean;
  /** the selected mounting/bonding system this applies to. */
  mountingBondingSystem: string | null;
  verificationNote: string;
}

/** THE canonical grounding-authority result for the OPEN-AIR micro / cable
 *  section. Ray's full field list; every field honest or explicitly null. */
export interface GroundingAuthorityResult {
  /** the section this result applies to — and ONLY this section (Ray §5). */
  appliesTo: 'open-air-microinverter-branch-cable-section';
  // ── the exact selected equipment the authority is resolved for (§1) ────────
  selectedMicroinverterSku: string | null;
  selectedCableAssemblySku: string | null;
  selectedModuleSku: string | null;
  selectedMountingBondingSystem: string | null;
  projectJurisdiction: string | null;
  // ── equipment facts: RECORDED, NEVER DETERMINATIVE (§2) ────────────────────
  equipmentInsulationClassification: string | null;
  cableConductorConstruction: string | null;
  cableConductorCount: number | null;
  /** the structural rule, stated on the record: conductor count can never select
   *  an outcome, and did not select this one. */
  conductorCountIsNonDeterminative: true;
  nonDeterminativeNote: string;
  // ── the method + its document (§2) ─────────────────────────────────────────
  groundingBondingMethod: string;                 // human label; 'PENDING …' under C
  statedGroundingMethod: GroundingStatedMethod | null;
  documentId: string | null;
  documentHash: string | null;
  documentTitle: string | null;
  documentRevision: string | null;
  documentClass: string | null;
  documentSectionOrPage: string | null;
  documentStatedText: string | null;
  applicabilityVerification: GroundingApplicabilityVerification;
  necBasis: string;
  rackingModuleBondingRequirement: RackingModuleBondingRequirement;
  outcome: GroundingOutcome;
  verificationStatus: 'verified-document' | 'pending-manufacturer-authority';
  // ── consequences (§3/§4) ──────────────────────────────────────────────────
  /** the ONE label the sheets print (fail-closed under C). */
  renderLabel: string;
  /** the blocker code while PENDING (null otherwise). */
  blockerCode: string | null;
  blocking: boolean;
  /** candidate conductor + quantity, populated whenever a conductor is modeled.
   *  Under B these are the ORDERABLE quantities; under C they are a PROPOSED /
   *  DESIGN QUANTITY only; under A there is no conductor row at all. */
  conductorMaterial: string | null;
  conductorSizeNecDerived: string | null;
  conductorSizingBasis: string | null;
  branchIds: string[];
  segmentIds: string[];
  pathBasis: string;
  designedInstalledFt: number | null;
  lengthProvenance: 'geometry-derived' | 'estimated' | null;
  wasteFactor: number;
  quantityFt: number | null;
  /** BOM behaviour: A ⇒ no row; B ⇒ orderable; C ⇒ non-orderable design quantity. */
  bomRowState: 'no-row' | 'orderable' | 'design-quantity-non-orderable';
  excludedFromProcurementTotals: boolean;
  /** the explanation the sheets render for the outcome (never an assertion). */
  explanation: string;
  /** what would resolve a PENDING outcome (rendered on RS-1). */
  resolutionRequirement: string;
  provenance: { source: string; note: string };
}

export interface ResolveGroundingAuthorityArgs {
  /** true only for a micro topology with modeled open-air branch conductors. */
  present: boolean;
  selection: GroundingSelection;
  equipmentFacts: GroundingEquipmentFacts;
  /** the resolved candidate document (lib/documents). null ⇒ none archived. */
  documentEvidence?: GroundingDocumentEvidence | null;
  /** NEC-derived candidate conductor (from the branch-egc grounding objects). */
  conductorMaterial: string | null;
  conductorSizeNecDerived: string | null;
  conductorSizingBasis: string | null;
  branchIds: string[];
  segmentIds: string[];
  pathBasis: string;
  designedInstalledFt: number | null;
  lengthProvenance: 'geometry-derived' | 'estimated' | null;
  wasteFactor: number;
  quantityFt: number | null;
  /** the racking/module bonding domain (independent). */
  bondingMethod?: string | null;
  bondingVerificationNote?: string | null;
}

const NON_DETERMINATIVE_NOTE =
  'The cable conductor count and conductor-construction prose are RECORDED for transparency and are '
  + 'explicitly NON-DETERMINATIVE: a listed two-conductor assembly serving a double-insulated (Class II) '
  + 'microinverter system may intentionally require no additional equipment grounding conductor. Conductor '
  + 'count alone can never select an outcome — only a verified, exactly-applicable manufacturer document can.';

const RESOLUTION_REQUIREMENT =
  'Archive and verify, through the document registry, the manufacturer installation document that '
  + 'EXPLICITLY states the equipment grounding / bonding method for the open-air branch section of the EXACT '
  + 'selected equipment (microinverter SKU + cable-assembly SKU + module SKU + mounting/bonding system) in '
  + 'this project jurisdiction: record its SHA-256, revision, current status, the exact section/page carrying '
  + 'the statement, and its own declared exact-SKU applicability. A family / series / product-line document '
  + '(an IQ8 family datasheet, IQ-Commercial QD-Cable guidance, a legacy Engage rule), a conductor-count '
  + 'inference, or an engineering opinion can never clear this.';

/**
 * Build THE canonical open-air grounding authority (pure, DB-free, digest-safe).
 *
 * The outcome comes from `outcomeFromDocument` ALONE. Equipment facts are attached
 * to the record afterwards, as description — they cannot influence the outcome.
 */
export function resolveOpenAirGroundingAuthority(
  args: ResolveGroundingAuthorityArgs,
): GroundingAuthorityResult {
  const doc = args.documentEvidence ?? null;
  const applicabilityVerification = verifyGroundingDocumentApplicability(doc, args.selection);
  // ── THE decision. Document evidence only. ─────────────────────────────────
  const outcome = outcomeFromDocument(doc, applicabilityVerification);
  const applicable = applicabilityVerification.verdict === 'applicable';

  const bonding: RackingModuleBondingRequirement = {
    required: true,
    method: args.bondingMethod
      ?? 'listed module-frame / racking bonding path (UL 2703 listed mounting assembly, or listed bonding jumpers + lugs)',
    codeBasis: 'NEC 690.43 / 250.136 (equipment bonding of module frames + racking) — evaluated on its OWN authority',
    independentOfCableGrounding: true,
    hardwareRetained: true,
    mountingBondingSystem: args.selection.mountingBondingSystem,
    verificationNote: args.bondingVerificationNote
      ?? 'The module-frame / racking bonding requirement is independent of the open-air cable-grounding question and '
        + 'is NOT resolved by this authority; its own listed-assembly verification governs (see the racking assembly authority).',
  };

  const necBasis =
    outcome === 'NO_SEPARATE_EGC_REQUIRED'
      ? 'NEC 110.3(B) + 690.43(C) / 250.134 — the equipment grounding method is the listed method the manufacturer '
        + 'instructions establish for this exact equipment; no additional grounding conductor is installed in this section.'
      : outcome === 'SEPARATE_EGC_REQUIRED'
        ? 'NEC 110.3(B) + 690.43(C), sized per NEC 250.122 — the manufacturer instructions for this exact equipment '
          + 'require an additional equipment grounding conductor run with the branch-circuit conductors.'
        : 'NEC 110.3(B) — the equipment grounding / bonding method must follow the listing and the manufacturer '
          + 'instructions for the exact installed equipment. That instruction is NOT established here, so NO NEC '
          + 'conclusion (neither a 250.122-sized additional conductor nor a 690.43(C) listed integrated method) may '
          + 'be asserted for this section.';

  const groundingBondingMethod =
    outcome === 'NO_SEPARATE_EGC_REQUIRED'
      ? 'LISTED METHOD — no additional equipment grounding conductor in the open-air branch section'
      : outcome === 'SEPARATE_EGC_REQUIRED'
        ? `ADDITIONAL EQUIPMENT GROUNDING CONDUCTOR — ${args.conductorSizeNecDerived ?? 'NEC 250.122 size'} ${args.conductorMaterial ?? 'Cu'}, open-air with each branch`
        : GROUNDING_PENDING_LABEL;

  const explanation =
    outcome === 'NO_SEPARATE_EGC_REQUIRED'
      ? `The equipment grounding method for the open-air branch section is established by ${doc?.documentId ?? 'the verified document'} `
        + `(${doc?.sectionOrPage ?? 'cited section'}) for the exact selected ${args.selection.microSku ?? 'microinverter'} + `
        + `${args.selection.cableSku ?? 'cable assembly'}: the listed method requires NO additional grounding conductor in this section. `
        + 'Module-frame and racking bonding hardware is a DISTINCT requirement and is retained.'
      : outcome === 'SEPARATE_EGC_REQUIRED'
        ? `${doc?.documentId ?? 'The verified document'} (${doc?.sectionOrPage ?? 'cited section'}) states, for the exact selected `
          + `${args.selection.microSku ?? 'microinverter'} + ${args.selection.cableSku ?? 'cable assembly'}, that an additional equipment `
          + 'grounding conductor is required in the open-air branch section; it is sized per NEC 250.122 and its length follows the '
          + 'same branch cable-path geometry as the trunk.'
        : 'The equipment grounding / bonding method for the open-air microinverter branch (cable-assembly) section is NOT ESTABLISHED. '
          + 'No manufacturer document in this repository states the method for the exact selected equipment, so NEITHER outcome may be '
          + 'asserted — not an additional grounding conductor, and not a listed no-additional-conductor method. '
          // TAC WS-18 — a SNAPSHOT explanation names the requirement CODE, never a
          // sheet: the same snapshot renders into packages with different sheet
          // sets, and this string also ships verbatim inside the machine-readable
          // evidence stamp (where the render-time reference pass cannot reach it).
          + `Any conductor quantity shown for this section is a PROPOSED / DESIGN QUANTITY only (${GROUNDING_AUTHORITY_BLOCKER_CODE}). `
          + 'This is a fail-closed state, not a finding.';

  const conductorModeled = outcome !== 'NO_SEPARATE_EGC_REQUIRED';
  const bomRowState: GroundingAuthorityResult['bomRowState'] =
    outcome === 'NO_SEPARATE_EGC_REQUIRED' ? 'no-row'
      : outcome === 'SEPARATE_EGC_REQUIRED' ? 'orderable'
        : 'design-quantity-non-orderable';

  return {
    appliesTo: 'open-air-microinverter-branch-cable-section',
    selectedMicroinverterSku: args.selection.microSku,
    selectedCableAssemblySku: args.selection.cableSku,
    selectedModuleSku: args.selection.moduleSku,
    selectedMountingBondingSystem: args.selection.mountingBondingSystem,
    projectJurisdiction: args.selection.jurisdiction,
    equipmentInsulationClassification: applicable
      ? (doc?.equipmentClassification ?? args.equipmentFacts.equipmentInsulationClassification)
      : (args.equipmentFacts.equipmentInsulationClassification
        ?? 'NOT ESTABLISHED — no verified document records the equipment insulation class / classification'),
    cableConductorConstruction: args.equipmentFacts.cableConductorConstruction,
    cableConductorCount: args.equipmentFacts.cableConductorCount,
    conductorCountIsNonDeterminative: true,
    nonDeterminativeNote: NON_DETERMINATIVE_NOTE,
    groundingBondingMethod,
    statedGroundingMethod: applicable ? (doc?.statedGroundingMethod ?? null) : null,
    documentId: applicable ? (doc?.documentId ?? null) : null,
    documentHash: applicable ? (doc?.documentHash ?? null) : null,
    documentTitle: applicable ? (doc?.title ?? null) : null,
    documentRevision: applicable ? (doc?.revision ?? null) : null,
    documentClass: applicable ? (doc?.documentClass ?? null) : null,
    documentSectionOrPage: applicable ? (doc?.sectionOrPage ?? null) : null,
    documentStatedText: applicable ? (doc?.statedText ?? null) : null,
    applicabilityVerification,
    necBasis,
    rackingModuleBondingRequirement: bonding,
    outcome,
    verificationStatus: outcome === 'PENDING_MANUFACTURER_AUTHORITY'
      ? 'pending-manufacturer-authority' : 'verified-document',
    renderLabel: groundingBondingMethod,
    blockerCode: outcome === 'PENDING_MANUFACTURER_AUTHORITY' && args.present
      ? GROUNDING_AUTHORITY_BLOCKER_CODE : null,
    blocking: outcome === 'PENDING_MANUFACTURER_AUTHORITY' && args.present,
    conductorMaterial: conductorModeled ? args.conductorMaterial : null,
    conductorSizeNecDerived: conductorModeled ? args.conductorSizeNecDerived : null,
    conductorSizingBasis: conductorModeled ? args.conductorSizingBasis : null,
    branchIds: conductorModeled ? args.branchIds : [],
    segmentIds: conductorModeled ? args.segmentIds : [],
    pathBasis: args.pathBasis,
    designedInstalledFt: conductorModeled ? args.designedInstalledFt : null,
    lengthProvenance: conductorModeled ? args.lengthProvenance : null,
    wasteFactor: args.wasteFactor,
    quantityFt: conductorModeled ? args.quantityFt : null,
    bomRowState,
    excludedFromProcurementTotals: bomRowState === 'design-quantity-non-orderable',
    explanation,
    resolutionRequirement: RESOLUTION_REQUIREMENT,
    provenance: {
      source: 'resolveOpenAirGroundingAuthority (document-based three-outcome resolution)',
      note: `outcome selected by outcomeFromDocument(document, applicability) ONLY — equipment facts are non-determinative; `
        + `document=${doc?.documentId ?? 'none'} applicability=${applicabilityVerification.verdict}`,
    },
  };
}

// ── §5 SEPARATION — the five distinct grounding/bonding domains ──────────────

/** One node of the grounding object graph: a DISTINCT authority domain with its
 *  own basis. The open-air resolver result applies to exactly one of them. */
export interface GroundingDomainNode {
  domain:
    | 'open-air-micro-branch-cable-section'
    | 'home-run-raceway-egc'
    | 'racking-module-frame-bonding'
    | 'grounding-electrode-conductor'
    | 'service-bonding';
  label: string;
  /** who decides it. */
  authority: 'manufacturer-document (this resolver)' | 'NEC (wiring method)' | 'listed-assembly (UL 2703) + NEC' | 'NEC (service/electrode)';
  required: boolean | 'pending';
  basis: string;
  /** true ONLY for the open-air section — the one domain the resolver governs. */
  governedByOpenAirGroundingResolver: boolean;
  /** the canonical snapshot objects this domain is modeled by. */
  objectRefs: string[];
  independenceNote: string;
}

export interface BuildGroundingDomainGraphArgs {
  outcome: GroundingOutcome;
  /** the open-air section's own conductor state under the current outcome. */
  openAirLabel: string;
  /** the in-raceway home-run EGC (its own independent requirement). */
  homeRunEgcSize: string | null;
  homeRunRacewayLabel: string | null;
  homeRunPresent: boolean;
  bonding: RackingModuleBondingRequirement;
  /** GEC record state (usually 'none-required' — bonded to the existing GES). */
  gecRequired: boolean;
  gecBasis: string;
}

/** Build the five-domain grounding object graph (pure). NO domain inherits the
 *  open-air outcome; each states its own basis and its independence explicitly. */
export function buildGroundingDomainGraph(args: BuildGroundingDomainGraphArgs): GroundingDomainNode[] {
  return [
    {
      domain: 'open-air-micro-branch-cable-section',
      label: `Open-air microinverter branch (listed cable assembly) — ${args.openAirLabel}`,
      authority: 'manufacturer-document (this resolver)',
      required: args.outcome === 'PENDING_MANUFACTURER_AUTHORITY' ? 'pending'
        : args.outcome === 'SEPARATE_EGC_REQUIRED',
      basis: 'NEC 110.3(B) — the listing + manufacturer instructions for the EXACT selected microinverter and cable '
        + 'assembly decide whether an additional equipment grounding conductor is installed in this section.',
      governedByOpenAirGroundingResolver: true,
      objectRefs: ['electrical.openAirGroundingAuthority', "electrical.groundingObjects[purpose='branch-egc']", 'electrical.branchCablePaths'],
      independenceNote: 'This is the ONLY domain the open-air grounding resolver governs.',
    },
    {
      domain: 'home-run-raceway-egc',
      label: args.homeRunPresent
        ? `Equipment grounding conductor inside the shared home-run raceway (${args.homeRunRacewayLabel ?? 'raceway'}) — ${args.homeRunEgcSize ?? 'NEC 250.122 size'}`
        : 'Equipment grounding conductor inside the shared home-run raceway — not modeled on this design',
      authority: 'NEC (wiring method)',
      required: args.homeRunPresent,
      basis: 'INDEPENDENTLY REQUIRED per NEC 250.118 / 250.122 with sizing from the branch OCPD: these are FIELD-INSTALLED '
        + 'conductors in a raceway (THWN-2 in PVC), i.e. in-raceway wiring-method territory. A wiring-method EGC is required '
        + 'with the circuit conductors and its basis has NOTHING to do with the double-insulation / listed-assembly question '
        + 'that governs the open-air cable section. Retained under every open-air outcome.',
      governedByOpenAirGroundingResolver: false,
      objectRefs: ["electrical.physicalRaceways[BRANCH-HOMERUN].egcGauge", "electrical.routeSegments['BRANCH_HOMERUN_RUN'].egcGauge"],
      independenceNote: 'NOT affected by the open-air grounding outcome — a raceway wiring method needs its own EGC regardless.',
    },
    {
      domain: 'racking-module-frame-bonding',
      label: `Module-frame + racking bonding — ${args.bonding.method}`,
      authority: 'listed-assembly (UL 2703) + NEC',
      required: args.bonding.required,
      basis: args.bonding.codeBasis,
      governedByOpenAirGroundingResolver: false,
      objectRefs: ['structural.rackingAssembly', 'BOM bonding hardware rows'],
      independenceNote: args.bonding.verificationNote,
    },
    {
      domain: 'grounding-electrode-conductor',
      label: 'Grounding electrode conductor (GEC)',
      authority: 'NEC (service/electrode)',
      required: args.gecRequired,
      basis: args.gecBasis,
      governedByOpenAirGroundingResolver: false,
      objectRefs: ["electrical.groundingObjects[purpose='gec']"],
      independenceNote: 'Electrode-system domain — unrelated to equipment grounding of the array branch circuits.',
    },
    {
      domain: 'service-bonding',
      label: 'Service / enclosure bonding at the point of interconnection',
      authority: 'NEC (service/electrode)',
      required: true,
      basis: 'NEC 250.24 / 250.92 / 690.47 — the interconnected equipment enclosures and the existing service bonding '
        + 'means; evaluated on the service topology objects, not on any array-side grounding question.',
      governedByOpenAirGroundingResolver: false,
      objectRefs: ['electrical.serviceTopology', "electrical.groundingObjects[purpose='raceway-bond']"],
      independenceNote: 'Service-side domain — never inherits an array-side grounding outcome.',
    },
  ];
}
