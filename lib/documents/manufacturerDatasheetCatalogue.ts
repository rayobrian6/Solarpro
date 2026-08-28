// ═══════════════════════════════════════════════════════════════════════════
// manufacturerDatasheetCatalogue.ts — SHIPPED manufacturer module datasheets.
//
// The same architectural move as lib/documents/manufacturerStructuralCatalogue.ts,
// for the same reason. `MODULE-EXACT-DATASHEET-PENDING` fired on every package
// whose module had no governed registry row, and its only clearance was an
// operator archiving the manufacturer's datasheet by hand, per project. But the
// Qcells Q.PEAK DUO BLK ML-G10+ datasheet is byte-for-byte the same document for
// every job in the country that uses that module. The fact is nationwide, so the
// product owns it.
//
//     operator-archived registry row  >  THIS shipped catalogue  >  nothing
//
// ── IT CHANGES NO PREDICATE ───────────────────────────────────────────────
// Each record here is projected into a `RegistryDocument` and handed to
// `evaluateModuleDatasheetApplicability` UNCHANGED. Every condition it enforces
// still applies: document class, status, archived bytes, a valid SHA-256,
// governed verification, an explicit coverage claim, an evidence LOCATION, and
// the requirement that electrical + mechanical specifications actually be
// present. A brochure still clears nothing.
//
// ── WHY VERIFICATION IS LEGITIMATE HERE ───────────────────────────────────
// registry.ts draws the line at licensed judgement: `MACHINE_VERIFIABLE_DOCUMENT_
// CLASSES` admits objective, reproducible retrieval and deliberately excludes
// every STRUCTURAL class, because a machine may establish custody but never
// licensed engineering applicability.
//
// A module datasheet sits on the admissible side of that line. "Does page 2's
// POWER CLASS table include 400 W, and does the sheet print the electrical and
// mechanical specifications?" is reading a table, not exercising judgement. The
// coverage claims below are transcribed from the named page, and the archived
// bytes hash to the recorded digest.
//
// ── THE TRAP THIS RECORD EXISTS TO AVOID ──────────────────────────────────
// Qcells publishes TWO ML-G10+ sheets whose ranges overlap at 400 W, with
// DIFFERENT numbers: the 385-405 Rev01 (Isc 11.14 / Voc 45.30) and the 395-415
// Rev06 (Isc 11.05 / Voc 45.24). The catalogue record, its datasheetUrl, the
// archived asset and this document must all be the SAME sheet or the package
// cites one document and prints another's numbers. This is the 395-415 Rev06.
//
// PURE + deterministic. No I/O, no DB, no network.
// ═══════════════════════════════════════════════════════════════════════════
import type { RegistryDocument } from './types';

export interface ManufacturerDatasheet {
  documentId: string;
  documentClass: 'module_datasheet';
  manufacturer: string;
  title: string;
  /** the manufacturer's own revision marking, from the document footer. */
  revision: string;
  documentDate: string;
  pageCount: number;
  /** catalogue equipment ids this sheet covers. THE primary identity. */
  equipmentIdsCovered: readonly string[];
  modelsCovered: readonly string[];
  productFamily: string;
  /** the document's own POWER CLASS columns. */
  wattagesCovered: readonly number[];
  explicitWattageRange: { minWatts: number; maxWatts: number };
  /** true only when the sheet actually prints the specs (a brochure is false). */
  electricalMechanicalSpecificationsPresent: boolean;
  evidence: { page: number; table: string; section: string };
  applicabilityBasis: string;
  sourceUrl: string;
  sha256: string;
  byteLength: number;
  archivedPath: string;
  retrievedAtIso: string;
  /** who established custody, and on what basis. */
  verifiedBy: string;
  verificationNotes: string;
  status: 'current' | 'superseded';
}

const QCELLS_ML_G10PLUS_395_415: ManufacturerDatasheet = {
  documentId: 'mfr-datasheet:qcells:qpeak-duo-blk-ml-g10plus:395-415:rev06',
  documentClass: 'module_datasheet',
  manufacturer: 'Q CELLS',
  title: 'Qcells Q.PEAK DUO BLK ML-G10+ SERIES Data Sheet — 395–415 Wp, 132 cells (Rev06, 2023-12)',
  revision: 'Rev06_NA',
  documentDate: '2023-12',
  pageCount: 2,
  equipmentIdsCovered: ['qcells-peak-duo-400'],
  modelsCovered: [
    'Q.PEAK DUO BLK ML-G10+ 400W',
    'Q.PEAK DUO BLK ML-G10+',
    'Q.PEAK DUO BLK ML-G10.a+',
  ],
  productFamily: 'Q.PEAK DUO BLK ML-G10+ SERIES',
  // The POWER CLASS columns the sheet prints, verbatim.
  wattagesCovered: [395, 400, 405, 410, 415],
  explicitWattageRange: { minWatts: 395, maxWatts: 415 },
  electricalMechanicalSpecificationsPresent: true,
  evidence: {
    page: 2,
    table: 'Electrical Characteristics — POWER CLASS 395 / 400 / 405 / 410 / 415',
    section: 'Electrical Characteristics + Mechanical Specification',
  },
  applicabilityBasis:
    'Page 2 prints a per-power-class table whose columns are 395, 400, 405, 410 and 415 W, and the '
    + '400 W column states Isc 11.05 A, Voc 45.24 V, Impp 10.54 A, Vmpp 37.95 V, η ≥ 20.4 %. The '
    + 'Mechanical Specification on the same page states 74.0 in × 41.1 in × 1.26 in and 48.5 lb '
    + '(22.0 kg). The selected 400 W variant is therefore covered by an explicit power class, not by a '
    + 'range parsed from a title.',
  sourceUrl: 'https://cdn.myced.com/images/Products/ZZ0000/ZZ3048/00000/ZZ304800120_DS.pdf',
  sha256: '09a921936237ba912930dbd0f149b20539c7f0831b3c52a6378c33b25a3ab99d',
  byteLength: 434408,
  archivedPath: 'public/manufacturer-assets/datasheets/Qcells_Q.PEAK_DUO_BLK_ML-G10plus_395-415_Rev06.pdf',
  retrievedAtIso: '2026-08-28',
  verifiedBy: 'solarpro:shipped-manufacturer-datasheet-catalogue',
  verificationNotes:
    'CUSTODY: retrieved 2026-08-28, archived in-repo, SHA-256 recorded and checked against the bytes. '
    + 'COVERAGE: transcribed from page 2 of the archived document — the POWER CLASS table and the '
    + 'Mechanical Specification. This is reading a published table, not licensed judgement, which is why '
    + 'a deterministic verifier may establish it; every STRUCTURAL document class remains excluded from '
    + 'machine verification (lib/documents/registry.ts MACHINE_VERIFIABLE_DOCUMENT_CLASSES).',
  status: 'current',
};

export const MANUFACTURER_DATASHEET_CATALOGUE: readonly ManufacturerDatasheet[] = [
  QCELLS_ML_G10PLUS_395_415,
];

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * The shipped datasheet covering this exact module, or null.
 *
 * Matched on the catalogue EQUIPMENT ID first — the stable identity — and on an
 * exact model string second. Never a substring: a substring match is how a
 * document came to "cover" a module it had never heard of, which is the defect
 * `moduleDocumentAuthority` was written to end.
 */
export function findManufacturerDatasheet(q: {
  equipmentId?: string | null; model?: string | null;
}): ManufacturerDatasheet | null {
  const id = norm(q.equipmentId);
  const model = norm(q.model);
  if (!id && !model) return null;
  return MANUFACTURER_DATASHEET_CATALOGUE.find(d =>
    d.status === 'current'
    && ((id && d.equipmentIdsCovered.some(x => norm(x) === id))
      || (model && d.modelsCovered.some(x => norm(x) === model)))) ?? null;
}

/**
 * Project a shipped datasheet into the `RegistryDocument` shape
 * `evaluateModuleDatasheetApplicability` already consumes, so the SAME predicate
 * is applied to a shipped document as to an operator-archived one. Nothing about
 * the evaluator changes.
 */
export function toRegistryDocumentFromCatalogue(
  d: ManufacturerDatasheet | null,
): RegistryDocument | null {
  if (!d) return null;
  return {
    id: d.documentId,
    documentClass: d.documentClass,
    manufacturerOrIssuer: d.manufacturer,
    equipmentId: d.equipmentIdsCovered[0] ?? null,
    equipmentModelApplicability: d.modelsCovered.join(' | '),
    title: d.title,
    revision: d.revision,
    documentDate: d.documentDate,
    archivedFileIdentity: d.archivedPath,
    archivedInRepo: true,
    sha256: d.sha256,
    source: d.sourceUrl,
    jurisdictionBoundary: null,
    jurisdictionAuthorityId: null,
    applicabilityNotes: d.applicabilityBasis,
    status: d.status,
    supersedesId: null,
    supersededById: null,
    extractedClaims: {
      module: {
        manufacturer: d.manufacturer,
        productFamily: d.productFamily,
        equipmentIdsCovered: [...d.equipmentIdsCovered],
        modelsCovered: [...d.modelsCovered],
        wattagesCovered: [...d.wattagesCovered],
        explicitWattageRange: { ...d.explicitWattageRange },
        electricalMechanicalSpecificationsPresent: d.electricalMechanicalSpecificationsPresent,
        evidence: { ...d.evidence },
        applicabilityBasis: d.applicabilityBasis,
      },
    },
    verificationState: 'verified',
    reviewer: null,
    verifiedBy: d.verifiedBy,
    verifiedAt: d.retrievedAtIso,
    verificationNotes: d.verificationNotes,
    createdBy: 'solarpro:shipped-catalogue',
    createdAt: d.retrievedAtIso,
    updatedAt: d.retrievedAtIso,
  } as RegistryDocument;
}
