// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-8 — PUBLISHED STRUCTURAL DOCUMENT SOURCES + THE RETRIEVAL RECORD.
//
// THE AUDIT FINDING THIS CLOSES (§2.9/§2.10/§2.11, §2.12, Path 8):
//   • three requirement codes (RACKING-CAPACITY-SOURCE-NOT-ARCHIVED,
//     RACKING-CAPACITY-APPLICABILITY-GAP, FASTENER-ASSEMBLY-UNVERIFIED) collapse
//     to ONE predicate over ONE manufacturer PDF whose URL the code already
//     cites (rackingAssembly.ts capacityProvenance.sourceDocument.url);
//   • EQUIPMENT-DOCUMENT-APPLICABILITY needs a version-EXACT document for the
//     selected RT-MINI, whose URL the asset record already names in `notes`;
//   • no ingestion path existed, so both waited on an operator typing a digest.
//
// WHAT THIS MODULE IS — a declarative, brand-generic table of PUBLISHED document
// sources, plus the pure helpers that template a source for a project (state +
// adopted ASCE edition) and that turn a retrieval into registry-archival input.
// It contains NO project-specific data and NO Braidon constants: the entries are
// keyed on mounting-hardware-db catalog ids and product families.
//
// WHAT IT IS NOT — it is not a verdict. A retrieved+archived document is
// EVIDENCE. Whether it covers the selected assembly stays with the pure
// evaluators that already exist (`evaluateRackingCapacityClearance`,
// `evaluateDocumentApplicability`), and whether it is VERIFIED stays a registry
// act. The RT-MINI case proves why: every stamped PE letter Roof Tech publishes
// covers RT-MINI **II**, so retrieving one does NOT clear a selected first-
// generation RT-MINI — it converts an open research question into ONE bounded
// applicability confirmation, which is exactly the directive's goal.
// ═══════════════════════════════════════════════════════════════════════════

import type { DocumentClass } from '@/lib/documents/types';

// ── §1 · the source table ───────────────────────────────────────────────────

/** The role a published document plays in the structural authority chain. */
export type StructuralDocumentRole =
  /** the stamped structural / evaluation report that establishes ASD capacity. */
  | 'capacity'
  /** the installation manual cited as the attachment DETAIL authority. */
  | 'installation_detail';

export interface PublishedDocumentSource {
  /** stable id used in evidence refs + deterministic registry document ids. */
  sourceId: string;
  /** mounting-hardware-db catalog ids this source is declared for. */
  equipmentIds: string[];
  role: StructuralDocumentRole;
  documentClass: DocumentClass;
  issuer: string;
  /** the EXACT product the published document covers. When this differs from the
   *  selected model the applicability gap is REAL and is reported, never bridged. */
  documentProduct: string;
  title: string;
  /** URL, or a template with `{ST}` (2-letter state) / `{EDN}` (e.g. '7-16') /
   *  `{EDN_}` (e.g. '7_16') placeholders. */
  urlTemplate: string;
  /** true ⇒ `{ST}` must resolve or the source is not attemptable for this project. */
  requiresState?: boolean;
  /** the ASCE editions published, most-current first. Only used when the
   *  template carries `{EDN}`. */
  asceEditions?: string[];
  /** what the document is known to state, for the evidence record. Never a
   *  substitute for reading the archived file. */
  notes: string;
}

/**
 * ROOF TECH — the family behind the live RT-MINI blockers.
 *
 * VERIFIED LIVE 2026-07-27:
 *   • the install manuals resolve (RT-MINI 2,042,678 B; RT-MINI II 2,157,589 B);
 *   • the stamped PE letters resolve ONLY under the RT_MINI_II family path, per
 *     state AND per ASCE edition (7-10 and 7-16 both published);
 *   • the bare directory URL cited in rackingAssembly.ts answers HTTP 403, and
 *     every wrong path answers HTTP 200 text/html (a soft 404).
 * The first-generation RT-MINI has NO published stamped PE letter.
 */
export const PUBLISHED_DOCUMENT_SOURCES: readonly PublishedDocumentSource[] = [
  {
    sourceId: 'rooftech-rtmini2-pe-letter',
    equipmentIds: ['rooftech-mini', 'rooftech-mini-s', 'rooftech-mini-ii'],
    role: 'capacity',
    documentClass: 'structural_pe_letter',
    issuer: 'Roof Tech, Inc. (structural analysis by Starling Madison Lofquist, Inc.)',
    documentProduct: 'RT-MINI II',
    title: 'Roof Tech RT-Mini II Mount — Structural Analysis (PE-stamped letter, ASCE {EDN})',
    urlTemplate: 'https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_{EDN_}/RT_Mini_II_ASCE_{EDN}_{ST}.pdf',
    requiresState: true,
    asceEditions: ['7-16', '7-10'],
    notes: 'Per-state, per-ASCE-edition stamped letter. The 7-10 (KY) issue states the 613.2 lb ASD allowable uplift for '
      + '15/32" plywood over a 2x4 DF-L #2 rafter with (2) 90 mm screws that the mount record rounds down to 600 lb, '
      + 'derived with a safety factor of 3.0. It covers RT-Mini II — NOT the first-generation RT-MINI.',
  },
  {
    sourceId: 'rooftech-rtmini-install-manual',
    equipmentIds: ['rooftech-mini', 'rooftech-mini-s'],
    role: 'installation_detail',
    documentClass: 'racking_installation_manual',
    issuer: 'Roof Tech, Inc.',
    documentProduct: 'RT-MINI',
    title: 'Roof Tech RT-MINI Installation Manual (Jan 2021)',
    urlTemplate: 'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI.pdf',
    notes: 'The VERSION-EXACT installation manual for the first-generation RT-MINI (33 pp). This is the document that '
      + 'retires EQUIPMENT-DOCUMENT-APPLICABILITY at source: the on-file asset cites the RT-MINI II manual for a '
      + 'selected RT-MINI, and the correct fix is the version-exact document, not a cross-reference alias.',
  },
  {
    sourceId: 'rooftech-rtmini2-install-manual',
    equipmentIds: ['rooftech-mini-ii'],
    role: 'installation_detail',
    documentClass: 'racking_installation_manual',
    issuer: 'Roof Tech, Inc.',
    documentProduct: 'RT-MINI II',
    title: 'Roof Tech RT-MINI II Installation Manual (Jun 2025)',
    urlTemplate: 'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI-II.pdf',
    notes: 'The current-generation manual (40 pp). It contains NO statement extending its coverage to the '
      + 'first-generation RT-MINI (checked against the extracted text).',
  },
];

/**
 * THE CROSS-REFERENCE FINDING (mandated research, 2026-07-27).
 *
 * Question: does Roof Tech publish an explicit cross-reference / series
 * statement covering RT-MINI under the RT-MINI II documentation?
 *
 * Answer: NO. The manufacturer's product page states only a GENERATIONAL fact —
 * "We have now moved to engineering the second generation of the RT-MINI to the
 * RT-MINI II" — and continues to sell the RT-MINI with its own standalone,
 * still-published installation manual. Neither the RT-MINI II manual nor the
 * RT-MINI II stamped PE letter contains any statement extending coverage to the
 * first-generation product.
 *
 * Consequence, and it is the RIGHT one: no alias is fabricated. The applicability
 * gap for a selected RT-MINI is REAL, and the automation that closes it is the
 * retrieval of the VERSION-EXACT RT-MINI manual (which exists and is live), not
 * a bridge from the II documentation. The capacity leg keeps a genuine residual:
 * the only stamped capacity letter published covers RT-MINI II.
 */
export const RT_MINI_CROSS_REFERENCE_FINDING = Object.freeze({
  question: 'Does Roof Tech publish a cross-reference/series statement covering RT-MINI under the RT-MINI II documentation?',
  answer: 'NO — no citable manufacturer cross-reference exists.',
  sourcesChecked: [
    'https://roof-tech.us/pages/rt-mini',
    'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI-II.pdf',
    'https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_10/RT_Mini_II_ASCE_7-10_KY.pdf',
  ],
  manufacturerStatement: 'We have now moved to engineering the second generation of the RT-MINI to the RT-MINI II.',
  interpretation: 'A generational statement is not a coverage statement. The first-generation RT-MINI remains listed with '
    + 'its own standalone installation manual, so the II documentation may not be cited as authority for it.',
  resolution: 'Retrieve and archive the VERSION-EXACT RT-MINI installation manual (published, live) for the detail '
    + 'citation. The stamped-capacity leg has no first-generation equivalent and retains a bounded residual: either an '
    + 'operator/registry confirmation that the II letter governs the installed hardware, or a selection of RT-MINI II.',
  checkedAtIso: '2026-07-27T00:00:00.000Z',
});

// ── §2 · templating ─────────────────────────────────────────────────────────

const STATE_RE = /^[A-Z]{2}$/;

export interface SourceTemplateContext {
  /** 2-letter state code of the project. */
  stateCode: string | null;
  /** the ADOPTED ASCE edition (e.g. '7-16'), when the code authority states one. */
  asceEdition: string | null;
}

export interface AttemptableSource {
  source: PublishedDocumentSource;
  url: string;
  /** the edition this URL was templated for (null when the source has none). */
  edition: string | null;
  /** true ⇒ the edition is the project's ADOPTED edition, not a fallback probe. */
  editionIsAdopted: boolean;
}

/** Expand a source into the ordered list of URLs worth attempting. Deterministic:
 *  the adopted ASCE edition first, then the remaining published editions in
 *  declared order. Returns [] when a required key (state) is unavailable — a
 *  DIFFERENT fact from "the document does not exist". */
export function attemptableSources(
  source: PublishedDocumentSource,
  ctx: SourceTemplateContext,
): AttemptableSource[] {
  const st = (ctx.stateCode ?? '').trim().toUpperCase();
  if (source.requiresState && !STATE_RE.test(st)) return [];
  if (!source.urlTemplate.includes('{EDN}')) {
    return [{ source, url: source.urlTemplate.replace('{ST}', st), edition: null, editionIsAdopted: false }];
  }
  const published = source.asceEditions ?? [];
  const adopted = normalizeAsceEdition(ctx.asceEdition);
  const ordered = adopted && published.includes(adopted)
    ? [adopted, ...published.filter(e => e !== adopted)]
    : published;
  return ordered.map(edn => ({
    source,
    url: source.urlTemplate
      .replace('{EDN_}', edn.replace('-', '_'))
      .replace('{EDN}', edn)
      .replace('{ST}', st),
    edition: edn,
    editionIsAdopted: edn === adopted,
  }));
}

/** '7-16' | 'ASCE 7-16' | 'ASCE/SEI 7-16' | '2016' → '7-16'; else null. */
export function normalizeAsceEdition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /7\s*[-–—/]?\s*(05|10|16|22)/.exec(String(raw));
  return m ? `7-${m[1]}` : null;
}

/** The sources declared for a mount, filtered to a role. */
export function sourcesForEquipment(
  equipmentId: string | null | undefined,
  role?: StructuralDocumentRole,
): PublishedDocumentSource[] {
  if (!equipmentId) return [];
  return PUBLISHED_DOCUMENT_SOURCES.filter(s =>
    s.equipmentIds.includes(equipmentId) && (role == null || s.role === role));
}

// ── §3 · the retrieval record (snapshot evidence) ───────────────────────────

export interface DocumentRetrievalAttempt {
  sourceId: string;
  role: StructuralDocumentRole;
  documentClass: DocumentClass;
  /** the EXACT product the source covers (may differ from the selected model). */
  documentProduct: string;
  url: string;
  edition: string | null;
  editionIsAdopted: boolean;
  /** 'live-retrieval' | 'fixture-replay' | 'not-attempted'. */
  proof: 'live-retrieval' | 'fixture-replay' | 'not-attempted';
  outcome: 'RETRIEVED' | 'FAILED' | 'SKIPPED';
  httpStatus: number | null;
  contentType: string | null;
  byteLength: number | null;
  sha256: string | null;
  retrievedAtIso: string | null;
  /** the exact failure, source-qualified. Never generic. */
  failure: string | null;
  /** archival through lib/documents (migration 113). */
  archival: {
    attempted: boolean;
    documentId: string | null;
    failure: string | null;
    operatorAction: string | null;
  };
  /** true ⇔ documentProduct matches the SELECTED model exactly. When false the
   *  retrieval is real and the applicability gap is real; both are reported. */
  coversSelectedModel: boolean;
  notes: string;
}

export interface StructuralDocumentRetrievalRecord {
  resolverId: string;
  selectedEquipmentId: string | null;
  selectedModel: string | null;
  stateCode: string | null;
  adoptedAsceEdition: string | null;
  attempts: DocumentRetrievalAttempt[];
  /** the version-EXACT installation-detail document, when one was retrieved. */
  versionExactDetailDocumentId: string | null;
  /** the capacity document, when one was retrieved (may cover another version). */
  capacityDocumentId: string | null;
  /** the cross-reference research finding, carried onto the artifact so the
   *  reader sees WHY no alias was created. */
  crossReference: typeof RT_MINI_CROSS_REFERENCE_FINDING;
  /** the residual, in plain words. Empty ⇒ nothing remains for this record. */
  residual: string[];
  startedAtIso: string;
}

/** A stable, content-derived registry id so re-running the resolver UPDATES
 *  rather than duplicating (the same discipline as `archivalDocumentId`). */
export function structuralDocumentId(sourceId: string, sha256: string): string {
  return `doc-${sourceId}-${sha256.slice(0, 12)}`;
}
