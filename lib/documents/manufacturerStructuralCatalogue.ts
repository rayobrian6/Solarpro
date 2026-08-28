// ═══════════════════════════════════════════════════════════════════════════
// manufacturerStructuralCatalogue.ts — SHIPPED manufacturer structural
// documents. Product-master data, not project data.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────
// `RACKING-CAPACITY-SOURCE-NOT-ARCHIVED` fired on every Roof Tech project in the
// product, forever. Its only clearance path was an operator archiving a PE
// letter into `manufacturer_document_registry` by hand, per project.
//
// But a manufacturer's stamped PE letter is not project data. The Roof Tech
// RT-Mini II Illinois letter is byte-for-byte the same document for every
// Illinois RT-Mini II job in the country. Asking each operator to find, upload,
// hash and verify it is the same antipattern as gating a permit package on a
// phone call to each AHJ: the fact is nationwide, so SolarPro owns it.
//
// This module is the same architectural move `lib/jurisdictions/necVersions.ts`
// made for code adoption — a shipped, governed table that resolves BELOW an
// operator's own archived record:
//
//     operator-archived registry row  >  THIS shipped catalogue  >  nothing
//
// It does NOT weaken the gate. Every record here carries the identity, the
// issuing engineer's seal, the document date, the source URL, the SHA-256 of the
// archived bytes, the archived path IN THIS REPOSITORY, and the extracted
// engineering claims with the exact page each came from. That is strictly more
// than the registry ever required.
//
// ── THE BOUNDARY IT DOES NOT CROSS ───────────────────────────────────────
// `MACHINE_VERIFIABLE_DOCUMENT_CLASSES` in registry.ts says a machine may
// establish CUSTODY but never licensed engineering APPLICABILITY, and every
// structural class is deliberately excluded from it. That rule stands, and this
// module is on the correct side of it:
//
//   • Custody + extraction — "this document exists, these bytes hash to this,
//     Starling Madison Lofquist P.E. sealed it on this date, and it states these
//     allowable values on these pages" — is objective and reproducible.
//   • Applicability to a PARTICULAR ROOF — whether this building's sheathing and
//     framing meet the minimum properties the tests used — is licensed judgment,
//     and the letter itself assigns it: table notes 10 and 11, and the closing
//     paragraph, put it on the project Engineer of Record. That residual stays
//     with FRAMING-AUTHORITY-UNVERIFIED, where it belongs, and this module never
//     touches it.
//
// PURE + deterministic (digest-safe). No I/O, no DB, no network.
// ═══════════════════════════════════════════════════════════════════════════
import type { RackingCapacityDocumentEvidence } from '@/lib/permit/snapshot/rackingAssembly';

/** One tested substrate/fastener configuration and its allowable capacities. */
export interface AllowableAttachmentCapacity {
  /** the tested substrate, verbatim from the source. */
  substrate: string;
  /** the fastener count + length the row is for. */
  fastenerCount: number;
  fastenerDescription: string;
  /** ASD ALLOWABLE values, lbf. `null` where the source states none. */
  upliftLbs: number | null;
  downwardLbs: number | null;
  shearLbs: number | null;
  /** whether the fasteners reach the framing member, or land in sheathing only. */
  engagesFraming: boolean;
  /** page of the source this row is stated on. */
  sourcePage: number;
}

export interface ManufacturerSeal {
  name: string;
  credential: string;
  role: string;
}

export interface ManufacturerStructuralDocument {
  /** stable id — the clearance evidence's documentId. */
  documentId: string;
  documentClass: 'structural_pe_letter';
  /** the ENGINEERING firm that authored and sealed it (not the manufacturer). */
  issuingEntity: string;
  /** the manufacturer the letter was issued to. */
  manufacturer: string;
  sealedBy: ManufacturerSeal[];
  sealExpiry: string | null;
  firmRegistrationNo: string | null;
  title: string;
  documentDate: string;          // ISO
  jobNumber: string | null;
  pageCount: number;
  /** exact product generation(s) the letter covers. NEVER a family prefix. */
  equipmentModelApplicability: readonly string[];
  /** the jurisdiction the letter is stamped for. A US state is a CONTAINER: it
   *  covers every county/municipal AHJ inside it. */
  jurisdictionScope: { kind: 'us-state'; code: string; name: string };
  codeBasis: readonly string[];
  /** the design standards / test standards the values were derived under. */
  testBasis: readonly string[];
  /** safety factors the SOURCE applied (so nothing double-applies one). */
  safetyFactorsAppliedBySource: Record<string, number>;
  /** the fastener assembly the letter approves, verbatim in substance. */
  fastenerAssembly: {
    screwSpec: string;
    screwCountAtFraming: number;
    screwCountAtDeckOnly: number;
    lFootInterface: string;
    pilotHoleRequired: boolean;
    maxRoofCoveringLayers: number;
    installationGeometry: string;
    sourcePage: number;
  };
  /** WHAT THE LETTER SAYS ABOUT THE RAIL. This is the citation that settles
   *  whether an unpinned rail SKU can gate the ATTACHMENT capacity. */
  railInterface: {
    /** true ⇔ the letter delegates the rail to "others" rather than covering a
     *  specific rail, i.e. attachment capacity is rail-independent by design. */
    railByOthers: boolean;
    statement: string;
    sourcePage: number;
  };
  allowableCapacities: readonly AllowableAttachmentCapacity[];
  /** limits the letter places on its own applicability. */
  applicabilityLimits: readonly string[];
  /** responsibilities the letter EXPLICITLY assigns to the project Engineer of
   *  Record. These are the licensed residual — never machine-cleared. */
  engineerOfRecordResponsibilities: readonly string[];
  /** custody. */
  sourceUrl: string;
  sha256: string;
  byteLength: number;
  /** repo-relative path of the archived bytes. */
  archivedPath: string;
  retrievedAtIso: string;
  status: 'current' | 'superseded';
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOF TECH RT-MINI II — ILLINOIS, ASCE 7-16
//
// Retrieved 2026-08-28 from the manufacturer's own design portal and archived at
// public/manufacturer-assets/structural/. Every value below is transcribed from
// the named page; nothing is derived, rounded or inferred here.
//
// NOTE ON THE GENERATION. The first-generation RT-MINI has NO published stamped
// PE letter on this portal: every gen-1 URL under /Stamped-PE-Letters/ returns
// the site's SPA catch-all (HTTP 200, text/html, ~3 KB) while every RT-MINI II
// state URL returns a real application/pdf. Roof Tech's own product page states
// "We have now moved to engineering the second generation of the RT-MINI to the
// RT-MINI II." The catalogue records that supersession rather than letting a
// gen-2 document quietly satisfy a gen-1 selection.
// ═══════════════════════════════════════════════════════════════════════════
const RT_MINI_II_IL_ASCE_7_16: ManufacturerStructuralDocument = {
  documentId: 'mfr-struct:rooftech:rt-mini-ii:asce7-16:IL',
  documentClass: 'structural_pe_letter',
  issuingEntity: 'Starling Madison Lofquist, Inc. — Consulting Structural and Forensic Engineers',
  manufacturer: 'Roof Tech, Inc.',
  sealedBy: [
    { name: 'Jesse Light', credential: 'S.E., P.E.', role: 'Principal (VP) / Sr. Structural Engineer' },
    { name: 'Rusmir Begic', credential: 'P.E., M.S.E.', role: 'Associate / Licensed Professional Engineer' },
  ],
  sealExpiry: '2026-11-30',
  firmRegistrationNo: 'F 6845-452-2',
  title: 'Roof Tech RT-Mini II Mount — Structural Analysis (ASCE/SEI 7-16), Illinois',
  documentDate: '2023-03-07',
  jobNumber: 'SML Job No. 471-22',
  pageCount: 253,
  equipmentModelApplicability: ['RT-MINI II'],
  jurisdictionScope: { kind: 'us-state', code: 'IL', name: 'Illinois' },
  codeBasis: [
    'ASCE/SEI 7-16 Minimum Design Loads for Buildings and Other Structures',
    'International Building Code 2018 & 2021 Editions',
    'Aluminum Design Manual, 2015 & 2020 Editions',
  ],
  testBasis: [
    'Institute of Building Technology (IBT) report no. 2426-21007-002, project no. 34578, dated 2021-04-19',
    'IAPMO Uniform Evaluation Services EC002-2018 (Joist Hangers and Miscellaneous Connectors)',
    'ASTM D1761-2020 Standard Test Methods for Mechanical Fasteners in Wood',
    'Western Technologies Inc. job no. 2163XD260 event G260-3 (OSB, 2014-01-03) and G260-6 (plywood, 2014-05-30) — downward compression',
  ],
  safetyFactorsAppliedBySource: {
    pulloutAndShear: 3.0,
    downwardCompressionOnSheathing: 2.0,
  },
  fastenerAssembly: {
    screwSpec: 'SS304 5.0 mm x 60 mm or SS304 5.0 mm x 90 mm wood screw',
    screwCountAtFraming: 2,
    screwCountAtDeckOnly: 5,
    lFootInterface:
      'stainless steel SS304 5/16" diameter flange bolt, or 5/16" diameter bolt with 5/8" OD washer, and flange nut',
    pilotHoleRequired: false,
    maxRoofCoveringLayers: 2,
    installationGeometry:
      'the RT-Mini II is installed with its LONG DIRECTION PARALLEL to the roof framing, in accordance with '
      + "Roof Tech's Installation Manual; roof rafters or trusses at 24 in on centre maximum",
    sourcePage: 1,
  },
  railInterface: {
    railByOthers: true,
    statement:
      'An appropriately load rated "L-Foot", by others, may be attached to the RT-Mini II base with a stainless '
      + 'steel SS304 5/16" diameter flange bolt or 5/16" diameter bolt with 5/8" OD washer, and flange nut. An '
      + 'appropriately load rated rail, by others, may be attached to the "L-Foot" per the rail manufacturer\'s '
      + 'installation instructions.',
    sourcePage: 1,
  },
  allowableCapacities: [
    {
      substrate: '7/16 in thick OSB only (24/16 APA rated sheathing minimum)',
      fastenerCount: 5, fastenerDescription: '5 x 60 mm wood screws',
      upliftLbs: 113.7, downwardLbs: 258.0, shearLbs: 216.7,
      engagesFraming: false, sourcePage: 2,
    },
    {
      substrate: '15/32 in thick plywood only (32/16 APA rated sheathing minimum)',
      fastenerCount: 5, fastenerDescription: '5 x 60 mm wood screws',
      upliftLbs: 138.0, downwardLbs: 556.0, shearLbs: 228.8,
      engagesFraming: false, sourcePage: 2,
    },
    {
      substrate: '15/32 in plywood sheathing over a 2x4 DF-L #2 rafter (2x truss top chord OK by inspection)',
      fastenerCount: 2, fastenerDescription: '2 x 60 mm wood screws',
      upliftLbs: 569.9, downwardLbs: null, shearLbs: 404.4,
      engagesFraming: true, sourcePage: 2,
    },
    {
      substrate: '7/16 in OSB or 15/32 in plywood sheathing over a 2x4 DF-L #2 rafter, OFFSET position (Exhibit A2)',
      fastenerCount: 5, fastenerDescription: '5 x 60 mm wood screws',
      upliftLbs: 325.7, downwardLbs: null, shearLbs: 411.0,
      engagesFraming: false, sourcePage: 2,
    },
    {
      substrate: '15/32 in plywood sheathing over a 2x4 DF-L #2 rafter (2x truss top chord OK by inspection)',
      fastenerCount: 2, fastenerDescription: '2 x 90 mm wood screws',
      upliftLbs: 613.2, downwardLbs: null, shearLbs: 469.9,
      engagesFraming: true, sourcePage: 2,
    },
  ],
  applicabilityLimits: [
    'Building mean roof height 15 ft or 30 ft maximum, per the specific spacing table used (table note 2).',
    'Risk Category II (table note 3).',
    'Roof rafters or trusses spaced at 24 in on centre maximum (table note 11).',
    'OSB shall be 24/16 APA rated sheathing minimum, 7/16 in thick (table note 8).',
    'Plywood shall be 32/16 APA rated sheathing minimum, 15/32 in thick (table note 9).',
    'Fasteners may pass through a maximum of 2 layers of composite asphalt roof shingles, or maximum 20 gage '
      + 'metal decking provided the metal is predrilled (table note 13).',
    'Solar panel and rail dead load taken as approximately 4.0 psf (table note 5).',
    'Assumed topography flat, Kzt = 1.0 (page 2).',
    'Maximum attachment spacing is governed by the letter\'s own tables (pages 13-252) as a function of wind '
      + 'speed, roof zone, roof slope, mean roof height, module orientation and exposure.',
  ],
  engineerOfRecordResponsibilities: [
    'Sheathing shall be free of defects including, but not limited to, water damage and delamination, and MUST '
      + 'BE EVALUATED BY THE PROJECT ENGINEER OF RECORD (table note 10, page 253).',
    'Roof rafters or trusses must be EVALUATED BY THE PROJECT EOR for structural integrity and capacity as '
      + 'required by the governing jurisdiction (table note 11, page 253).',
    'It is the responsibility of the project EOR to verify that the strength of the roof framing meets the '
      + 'minimum properties used in the tests and can safely support the maximum imposed loads stated within '
      + 'this document (closing paragraph, page 253).',
    'Verification of PV module capacity to support the loads associated with the given array is the '
      + 'responsibility of the Contractor or Owner (table note 12, page 253).',
  ],
  sourceUrl: 'https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_16/RT_Mini_II_ASCE_7-16_IL.pdf',
  sha256: '73a74973091ca698521398cfaeae7bf516f6b7cffb934b37e0104f17b3535c27',
  byteLength: 11228523,
  archivedPath: 'public/manufacturer-assets/structural/RT_Mini_II_ASCE_7-16_IL.pdf',
  retrievedAtIso: '2026-08-28',
  status: 'current',
};

export const MANUFACTURER_STRUCTURAL_CATALOGUE: readonly ManufacturerStructuralDocument[] = [
  RT_MINI_II_IL_ASCE_7_16,
];

// ═══════════════════════════════════════════════════════════════════════════
// RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** The GOVERNING allowable row for a selected attachment mode. Fail-closed: the
 *  weakest row that matches the mode, because the letter's per-substrate values
 *  differ by 5x and picking the friendly one would be an invented capacity. */
export function governingAllowableRow(
  doc: ManufacturerStructuralDocument,
  opts: { engagesFraming: boolean; fastenerCount?: number | null; screwLengthMm?: number | null },
): AllowableAttachmentCapacity | null {
  const mm = opts.screwLengthMm != null && isFinite(opts.screwLengthMm)
    ? Math.round(opts.screwLengthMm) : null;
  const rows = doc.allowableCapacities.filter(r =>
    r.engagesFraming === opts.engagesFraming
    && (opts.fastenerCount == null || r.fastenerCount === opts.fastenerCount)
    // The SAME substrate + count can appear with two screw lengths (60 mm and
    // 90 mm differ by 43 lb of uplift here). Match the length the design
    // actually specifies; without one, fall through to the weakest row.
    && (mm == null || r.fastenerDescription.replace(/\s+/g, ' ').toLowerCase().includes(`${mm} mm`))
    && r.upliftLbs != null);
  const pool = rows.length > 0 ? rows : doc.allowableCapacities.filter(r =>
    r.engagesFraming === opts.engagesFraming
    && (opts.fastenerCount == null || r.fastenerCount === opts.fastenerCount)
    && r.upliftLbs != null);
  if (pool.length === 0) return null;
  // FAIL-CLOSED: the weakest matching row, never the friendliest.
  return pool.reduce((a, b) => ((b.upliftLbs as number) < (a.upliftLbs as number) ? b : a));
}

export interface CatalogueLookup {
  /** the exact mount model the DESIGN selected (post-supersession). */
  mountModel: string | null;
  /** two-letter US state code of the project's legal jurisdiction. */
  stateCode: string | null;
  /** does the design's attachment engage the framing member? */
  engagesFraming?: boolean;
  fastenerCount?: number | null;
  /** the screw LENGTH the design specifies, in mm. */
  screwLengthMm?: number | null;
}

/**
 * Find the shipped structural document covering this exact mount model in this
 * state. Exact-model match only — a family prefix never matches, so `RT-MINI II`
 * does not satisfy a selection of `RT-MINI` (and vice versa). Returns null when
 * nothing covers it; the caller then reports the gap unchanged.
 */
export function findManufacturerStructuralDocument(
  q: CatalogueLookup,
): ManufacturerStructuralDocument | null {
  const model = norm(q.mountModel);
  const state = (q.stateCode ?? '').trim().toUpperCase();
  if (!model || !state) return null;
  const hits = MANUFACTURER_STRUCTURAL_CATALOGUE.filter(d =>
    d.status === 'current'
    && d.jurisdictionScope.code === state
    && d.equipmentModelApplicability.some(m => norm(m) === model));
  return hits[0] ?? null;
}

/**
 * Project a shipped catalogue record into the clearance-evidence shape the
 * racking gate already consumes, so the gate itself is untouched and applies the
 * SAME predicate to a shipped document as to an operator-archived one.
 */
export function toRackingClearanceEvidenceFromCatalogue(
  doc: ManufacturerStructuralDocument | null,
  opts: {
    engagesFraming: boolean;
    fastenerCount?: number | null;
    screwLengthMm?: number | null;
    jurisdictionAuthorityId?: string | null;
  },
): RackingCapacityDocumentEvidence | null {
  if (!doc) return null;
  const row = governingAllowableRow(doc, opts);
  if (!row) return null;
  return {
    documentId: doc.documentId,
    documentClass: doc.documentClass,
    documentIdentity: `${doc.title} — ${doc.issuingEntity}, ${doc.documentDate} (${doc.jobNumber ?? 'no job no.'})`,
    // A SHIPPED document is verified as to CUSTODY: identity, seal, date, source
    // URL and SHA-256 of the archived bytes are all recorded and reproducible.
    // It is NOT verified as to project applicability — that residual is carried
    // by `engineerOfRecordResponsibilities` and stays with the framing gate.
    verificationState: 'verified',
    status: 'current',
    archivedInRepo: true,
    sha256: doc.sha256,
    hasStructuralCapacityClaim: true,
    exactModel: doc.equipmentModelApplicability[0] ?? null,
    fastenerModel: doc.fastenerAssembly.screwSpec,
    fastenerCount: row.fastenerCount,
    substrate: row.substrate,
    rafterDeckCondition: row.engagesFraming
      ? 'fasteners engage the framing member (rafter / truss top chord)'
      : 'deck-only attachment (fasteners land in sheathing)',
    // 90 mm screw through 15/32 in sheathing. Stated as a derivation, not a
    // bare number: the letter gives the screw length and the sheathing, not an
    // embedment, so the arithmetic has to be visible.
    embedmentIn: /90\s*mm/i.test(row.fastenerDescription) ? RT_MINI_II_90MM_EMBEDMENT_IN : null,
    // The letter DELEGATES the rail: "an appropriately load rated rail, by
    // others". That is the citation that keeps an unpinned rail SKU out of the
    // ATTACHMENT-capacity predicate — the source itself declares the attachment
    // capacity rail-independent.
    railLFootAssembly: doc.railInterface.railByOthers
      ? `L-foot per ${doc.fastenerAssembly.lFootInterface}; rail BY OTHERS, appropriately load rated (source page ${doc.railInterface.sourcePage})`
      : doc.railInterface.statement,
    loadBasis: `ASD allowable (safety factor ${doc.safetyFactorsAppliedBySource.pulloutAndShear} on pullout/shear applied by the source)`,
    adjustmentFactors: { ...doc.safetyFactorsAppliedBySource, testBasis: doc.testBasis.join('; ') },
    jurisdiction: doc.jurisdictionScope.name,
    jurisdictionAuthorityId: opts.jurisdictionAuthorityId ?? null,
    asdAllowableLbs: row.upliftLbs,
    revisionOrDate: doc.documentDate,
  };
}

/** The embedment the letter's fastener assembly implies, when a caller needs it
 *  stated: the 90 mm screw through 15/32 in sheathing. Kept as a derivation with
 *  its arithmetic visible rather than a bare number in the evidence. */
export const RT_MINI_II_90MM_EMBEDMENT_IN =
  Math.round(((90 / 25.4) - (15 / 32)) * 100) / 100;   // 90 mm screw − 15/32 in sheathing ≈ 3.07 in
