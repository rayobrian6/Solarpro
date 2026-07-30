// ═══════════════════════════════════════════════════════════════════════════
// P13 — ENPHASE IQ8 SERIES PRODUCT-GROUNDING EVIDENCE (archived, hash-bound).
//
// RETRIEVED 2026-07-30 from the OFFICIAL Enphase documentation centre through
// the repo's own document-retrieval provider (redirect-followed, content-type
// checked, byte-hashed). The archived BYTES are the evidence; the landing-page
// title and the search result are not.
//
//   requested : https://enphase.com/download/iq8-series-microinverter-installation-and-operation-manual
//   final URL : https://enphase.com/download/iq8-iq8-iq8m-iq8a-and-iq8h-microinverters-installation-and-opearation-manual
//   bytes     : 1,555,258        content-type: application/pdf
//   sha256    : 65167d4d8abd81867575a7f467b68fe0155e5b954fc0077876da2729a284208e
//   document  : IOM-00068-3.0-EN — "IQ8, IQ8+, IQ8M, IQ8A, and IQ8H
//               Microinverters INSTALLATION AND OPERATION MANUAL", May 2026,
//               "Applicable regions: North America". §8.4 is the
//               IQ8A-72-2-US specification section, so the SELECTED model is
//               explicitly in scope.
//
// THE GOVERNING PASSAGE (§2.2 Grounding considerations), verbatim:
//   "The microinverter models listed in this guide do not require grounding
//    electrode conductors (GEC), equipment grounding conductors (EGC), or
//    grounded conductors (neutral). Your Authority Having Jurisdiction (AHJ)
//    may require you to bond the mounting bracket to the racking. If so, use
//    UL 2703 hardware or star washers. The microinverter itself has a Class II
//    double-insulated rating, which includes ground fault protection (GFP)."
//
// NOTE WHAT THE MANUFACTURER ITSELF SEPARATES: the microinverter needs no EGC,
// AND racking/mounting-bracket bonding remains a distinct UL 2703 question. That
// is exactly the boundary this campaign drew — so this document may close the
// PRODUCT grounding question and may NOT close the racking bonding question.
//
// REJECTED CANDIDATES (downloaded and compared, not assumed):
//   • "…with integrated MC4 connectors" IOM (© 2024,
//     sha256 2d539df703c7293fc6f0fb61c45ebeaf586a94b0ec572fac6f91d91ad456ed2f)
//     — a DIFFERENT connector architecture. This project is the IQ/Q-Cable
//     drop-connector branch system, so that manual does not apply.
//   • IQ8MC / IQ8AC / IQ8HC / IQ8X manual — different product family (IQ8AC is
//     not IQ8A).
//   • IQ8P manual — commercial product line.
//   • IQ7 series manuals — previous generation.
//   • en-GB / en-IN regional variants — wrong geographic applicability.
// ═══════════════════════════════════════════════════════════════════════════

import type { GroundingDocumentEvidence } from './groundingAuthority';

/** SHA-256 of the archived IQ8 Series IOM bytes. The integrity anchor: if the
 *  published file changes, this no longer matches and authority must re-verify. */
export const IQ8_SERIES_IOM_SHA256 =
  '65167d4d8abd81867575a7f467b68fe0155e5b954fc0077876da2729a284208e';

export const IQ8_SERIES_IOM_DOCUMENT_ID = 'IOM-00068-3.0-EN';

/** The exact microinverter models the retrieved document lists on its cover and
 *  specifies in §8. Applicability is proven by MODEL PRESENCE, never inferred
 *  from a family name: 'IQ8AC' is a different product and is deliberately absent. */
export const IQ8_SERIES_IOM_MODELS = ['IQ8', 'IQ8+', 'IQ8M', 'IQ8A', 'IQ8H'] as const;

/** The connector architecture the document covers — the IQ/Q-Cable drop-connector
 *  branch system. The separate MC4 manual covers the other architecture. */
export const IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE = 'iq-q-cable-drop-connector';

/** Is the selected microinverter model covered by the archived document?
 *  Exact, case-insensitive model match against the document's own list. */
export function iq8SeriesDocumentCoversModel(model: string | null | undefined): boolean {
  if (!model) return false;
  const m = String(model).trim().toUpperCase();
  return (IQ8_SERIES_IOM_MODELS as readonly string[]).some(x => x.toUpperCase() === m);
}

/**
 * The archived evidence record, or null when the selected equipment is NOT
 * covered. Fail-closed by construction: a model the document does not list, or a
 * different connector architecture, yields null and the authority stays PENDING.
 *
 * @param selectedMicroModel e.g. 'IQ8A'
 * @param connectorArchitecture the project's branch cabling architecture
 */
export function enphaseProductGroundingEvidence(
  selectedMicroModel: string | null | undefined,
  connectorArchitecture: string = IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE,
): GroundingDocumentEvidence | null {
  if (!iq8SeriesDocumentCoversModel(selectedMicroModel)) return null;
  if (connectorArchitecture !== IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE) return null;
  return {
    documentId: IQ8_SERIES_IOM_DOCUMENT_ID,
    documentClass: 'manufacturer-installation-and-operation-manual',
    title: 'IQ8, IQ8+, IQ8M, IQ8A, and IQ8H Microinverters — Installation and Operation Manual',
    revision: '3.0 (May 2026)',
    documentHash: IQ8_SERIES_IOM_SHA256,
    archivedInRepo: true,
    verificationState: 'verified',
    status: 'current',
    sectionOrPage: '§2.2 Grounding considerations (p.12); §8.4 IQ8A-72-2-US specifications (p.41)',
    // The document states the method EXPLICITLY — this is not an inference from
    // conductor count, insulation or brand.
    statedGroundingMethod: 'no-additional-equipment-grounding-conductor',
    statedText:
      'The microinverter models listed in this guide do not require grounding electrode conductors (GEC), '
      + 'equipment grounding conductors (EGC), or grounded conductors (neutral). Your Authority Having '
      + 'Jurisdiction (AHJ) may require you to bond the mounting bracket to the racking. If so, use UL 2703 '
      + 'hardware or star washers. The microinverter itself has a Class II double-insulated rating, which '
      + 'includes ground fault protection (GFP).',
    equipmentClassification: 'Class II double-insulated with integrated ground-fault protection (GFP)',
    applicability: {
      // EXACT SKUs the archived document itself names — verified against the
      // parsed bytes, not against a family name:
      //   §8.4  "IQ8A-72-2-US Microinverter specifications"
      //   §6.4  "Cable model … Q-12-10-240 … 1.3 m (50") Portrait"
      //   §8    "Part number 840-00387  Model Q-12-10-240  Maximum voltage 277 VAC"
      microinverterSkus: ['IQ8-60-2-US', 'IQ8PLUS-72-2-US', 'IQ8M-72-2-US', 'IQ8A-72-2-US', 'IQ8H-240-72-2-US'],
      cableAssemblySkus: ['Q-12-10-240', 'Q-12-17-240', 'Q-12-20-200'],
      // The grounding statement is written against the MICROINVERTER + its cable
      // system and is module-agnostic; the document constrains modules only by
      // requiring PV Wire / PV Cable labelled DC leads for GFP support.
      moduleSkus: [],
      // EXPRESSLY EMPTY. §2.2 defers mounting-bracket/racking bonding to the AHJ
      // and to UL 2703 hardware, so this document cannot establish a racking
      // bonding method for any mounting system.
      mountingBondingSystems: [],
      jurisdictions: ['North America', 'NEC', 'CSA C22.1'],
      // Justified: the exact selected SKUs appear verbatim in the archived bytes.
      scope: 'exact-sku',
      productLine: 'IQ8 residential (IQ/Q-Cable drop-connector architecture)',
    },
  };
}
