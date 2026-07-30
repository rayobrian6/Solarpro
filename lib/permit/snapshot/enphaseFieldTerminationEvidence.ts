// ═══════════════════════════════════════════════════════════════════════════
// WS-2B — ENPHASE IQ CABLE FIELD-TERMINATION & ACCESSORY AUTHORITY.
//
// READ FROM THE SAME ARCHIVED, HASH-BOUND BYTES the IQ8A product-grounding
// closure used: IOM-00068-3.0-EN, "IQ8, IQ8+, IQ8M, IQ8A, and IQ8H
// Microinverters — Installation and Operation Manual", Revision 3.0, May 2026,
// Applicable regions: North America, sha256
// 65167d4d8abd81867575a7f467b68fe0155e5b954fc0077876da2729a284208e.
//
// No new retrieval was needed: the manual this project already relies on for the
// grounding method is also the manual that documents how the IQ Cable is cut,
// terminated, spliced, capped and supported, and it enumerates the accessory
// SKUs and the cable packaging.
//
// ── THE FINDING THAT GOVERNS WS-2 ─────────────────────────────────────────────
// The catalog carries a raw-cable stock entry `Q-12-RAW-300`, described as
// "300 m of 12 AWG cable with NO connectors", sourced to a datasheet string with
// no archived bytes and no hash. That SKU appears NOWHERE in the archived
// official evidence:
//
//   • §3.1 "Items you will need" enumerates Q-CLIP-100, Q-SEAL-10, Q-TERM-10,
//     Q-DISC-10, Q-CONN-10M, Q-CONN-10F, and the IQ Cable table.
//   • §6.5 "IQ Cable accessories" enumerates the same accessory set.
//   • The cable table lists THREE listed cables (Q-12-10-240, Q-12-17-240,
//     Q-12-20-200) with their connector-count-per-box packaging.
//   • The words bulk / raw / reel / spool do not occur.
//
// So a raw-stock purchase is NOT the manufacturer's documented method, and this
// module does not establish one. What the manual DOES establish, verbatim, is
// that the LISTED CABLE ITSELF is cut to length and joined with a field-wireable
// connector pair. That is the method the procurement resolution must buy for.
//
// Nothing here is inferred from a product name, a reseller listing or a search
// result. Every field below carries the sentence it was read from.
// ═══════════════════════════════════════════════════════════════════════════

import {
  claimed, notApplicable,
  type GroundingDocumentEvidence,
} from './groundingAuthority';
import {
  IQ8_SERIES_IOM_SHA256, IQ8_SERIES_IOM_DOCUMENT_ID,
  IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE,
  iq8SeriesDocumentCoversModel,
} from './enphaseProductGroundingEvidence';

export const FIELD_TERMINATION_DOCUMENT_ID = IQ8_SERIES_IOM_DOCUMENT_ID;
export const FIELD_TERMINATION_SHA256 = IQ8_SERIES_IOM_SHA256;

/** A single established fact + the exact sentence it was read from. */
export interface TerminationFact<T> {
  value: T;
  sectionOrPage: string;
  quote: string;
}

const fact = <T,>(value: T, sectionOrPage: string, quote: string): TerminationFact<T> =>
  ({ value, sectionOrPage, quote });

/** One listed cable variant AS THE MANUAL PACKAGES IT. The packaging is the
 *  purchase unit — a connector-count-per-box, never a footage the SKU name
 *  happens to contain. */
export interface ListedCablePackaging {
  sku: string;
  connectorSpacing: string;
  moduleOrientation: string;
  connectorsPerBox: number;
}

export interface EnphaseFieldTerminationAuthority {
  documentId: string;
  documentSha256: string;
  documentRevision: string;
  region: string;
  archivedInRepo: boolean;
  verificationState: 'verified';
  status: 'current';

  /** the listed cables the manual itself tables, with their packaging. */
  listedCablePackaging: TerminationFact<ListedCablePackaging[]>;
  /** cutting the listed cable to length is the documented layout step. */
  cutToLengthPermitted: TerminationFact<boolean>;
  /** the documented method for joining a cut end / transitioning cable types. */
  fieldWireableConnectorPair: TerminationFact<{ maleSku: string; femaleSku: string }>;
  /** terminator SKU + the documented per-branch quantity + cut-end treatment. */
  terminator: TerminationFact<{ sku: string; perBranchCircuit: number; coversCutEnds: boolean }>;
  /** sealing cap SKU + the documented per-unused-connector quantity. */
  sealingCap: TerminationFact<{ sku: string; perUnusedConnector: number }>;
  /** cable clip SKU + the documented maximum support spacing. */
  cableSupport: TerminationFact<{ sku: string; maxSupportSpacingFt: number }>;
  /** the documented minimum loop diameter for dressed excess cable. */
  minimumLoopDiameterIn: TerminationFact<number>;
  /** the manual publishes NO slack/service-loop allowance NUMBER — only the
   *  instruction to allow extra. Recorded so the allowance stays 0 and honest. */
  slackAllowanceGoverned: TerminationFact<boolean>;
  /** EXPLICIT NEGATIVE: no bulk / raw / reel cable stock product is documented. */
  rawCableStockEstablished: TerminationFact<boolean>;
  /** the junction box is named as a generic "other item", not an Enphase SKU. */
  junctionBoxIsManufacturerAccessory: TerminationFact<boolean>;
}

/**
 * The archived authority, or null when the selected equipment is not covered.
 * Fail-closed on exactly the dimensions the P13 contract already established:
 * the exact micro model, and the connector architecture.
 */
export function enphaseFieldTerminationAuthority(
  selectedMicroModel: string | null | undefined,
  connectorArchitecture: string | null | undefined,
): EnphaseFieldTerminationAuthority | null {
  if (!iq8SeriesDocumentCoversModel(selectedMicroModel)) return null;
  if (connectorArchitecture !== IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE) return null;
  return {
    documentId: FIELD_TERMINATION_DOCUMENT_ID,
    documentSha256: FIELD_TERMINATION_SHA256,
    documentRevision: '3.0 (May 2026)',
    region: 'North America',
    archivedInRepo: true,
    verificationState: 'verified',
    status: 'current',

    listedCablePackaging: fact(
      [
        { sku: 'Q-12-10-240', connectorSpacing: '1.3 m', moduleOrientation: 'Portrait', connectorsPerBox: 240 },
        { sku: 'Q-12-17-240', connectorSpacing: '2.0 m', moduleOrientation: 'Landscape (60-cell)', connectorsPerBox: 240 },
        { sku: 'Q-12-20-200', connectorSpacing: '2.3 m', moduleOrientation: 'Landscape (72-cell)', connectorsPerBox: 200 },
      ],
      '§3.1 Items you will need — IQ Cable table',
      'Cable model / Connector spacing / PV module orientation / Connector count per box: '
      + 'Q-12-10-240 1.3 m Portrait 240; Q-12-17-240 2.0 m Landscape (60-cell) 240; '
      + 'Q-12-20-200 2.3 m Landscape (72-cell) 200',
    ),

    cutToLengthPermitted: fact(true, '§4.4 Install the IQ Cable, step 4',
      'Cut each segment of cable to meet your planned needs.'),

    fieldWireableConnectorPair: fact(
      { maleSku: 'Q-CONN-10M', femaleSku: 'Q-CONN-10F' },
      '§6.4 (cable-type transitions) + §6.5 IQ Cable accessories',
      'To transition between cable types, install an IQ Field Wireable Connector pair. … '
      + 'IQ Field Wireable Connector (male): (Q-CONN-10M) Make connections from any field wireable '
      + 'female connector. IQ Field Wireable Connector (female): (Q-CONN-10F) Make connections from '
      + 'any IQ Cable open connector or field wireable male connector.',
    ),

    terminator: fact(
      { sku: 'Q-TERM-10', perBranchCircuit: 2, coversCutEnds: true },
      '§3.1 Items you will need + §6.5 IQ Cable accessories',
      'IQ Terminator (Q-TERM-10) typically two needed per branch circuit … '
      + 'IQ Terminator: (Q-TERM-10) Terminator cap for cut cable ends.',
    ),

    sealingCap: fact(
      { sku: 'Q-SEAL-10', perUnusedConnector: 1 },
      '§6.5 IQ Cable accessories',
      'IQ Sealing Caps (female): (Q-SEAL-10) One needed to cover each unused connector on the cabling.',
    ),

    cableSupport: fact(
      { sku: 'Q-CLIP-100', maxSupportSpacingFt: 6 },
      '§6.4 + §6.5 IQ Cable accessories',
      'IQ Cable Clips: (Q-CLIP-100) Used to fasten cabling to the racking or to secure looped '
      + 'cabling. … Provide support for the IQ Cable every 1.8 m (6 ft).',
    ),

    minimumLoopDiameterIn: fact(4.75, '§4.5 / §6.4',
      'Do not form loops smaller than 12 cm (4.75") in diameter.'),

    // The manual instructs the installer to allow extra length but publishes NO
    // number, so no allowance is governed and the gate's allowance stays 0.
    slackAllowanceGoverned: fact(false, '§4.4 Install the IQ Cable, step 1',
      'Allow extra length for slack, cable turns, and any obstructions. '
      + '(No slack allowance VALUE is published; the instruction is qualitative.)'),

    // THE EXPLICIT NEGATIVE. Recorded as a fact so a future dataset that DOES
    // publish a bulk stock product forces a deliberate update rather than
    // silently re-enabling the unprovenanced catalog SKU.
    rawCableStockEstablished: fact(false,
      '§3.1 Items you will need + §6.5 IQ Cable accessories + §7 Replacement parts and cabling',
      'The archived manual tables the listed IQ Cable variants and enumerates the IQ Cable '
      + 'accessories, and names NO bulk / raw / reel / spool cable stock product. The documented way '
      + 'to obtain a cable segment of an arbitrary length is to CUT the listed cable and terminate it '
      + 'with a field-wireable connector pair.',
    ),

    junctionBoxIsManufacturerAccessory: fact(false, '§3.2 Other items',
      'The AC junction box is listed under "Other items" alongside screwdrivers, wire cutters and '
      + 'a voltmeter — it is a generic electrical component, not an Enphase accessory with a SKU.',
    ),
  };
}

/**
 * The same authority expressed as a GroundingDocumentEvidence-shaped record so
 * the existing five-factor specificity verifier can test it against the selected
 * equipment. `purpose: 'QCABLE_INSTALLATION'` scopes the required dimensions to
 * cable SKU + connector architecture + jurisdiction (see REQUIRED_DIMENSIONS) —
 * this document establishes an INSTALLATION method, and it is not, and does not
 * claim to be, evidence about a racking system.
 */
export function enphaseFieldTerminationEvidence(
  selectedMicroModel: string | null | undefined,
  connectorArchitecture: string | null | undefined,
): GroundingDocumentEvidence | null {
  const a = enphaseFieldTerminationAuthority(selectedMicroModel, connectorArchitecture);
  if (!a) return null;
  return {
    documentId: a.documentId,
    documentClass: 'manufacturer-installation-and-operation-manual',
    purpose: 'QCABLE_INSTALLATION',
    title: 'IQ8, IQ8+, IQ8M, IQ8A, and IQ8H Microinverters — Installation and Operation Manual',
    revision: a.documentRevision,
    documentHash: a.documentSha256,
    archivedInRepo: true,
    verificationState: 'verified',
    status: 'current',
    sectionOrPage: '§3.1 Items you will need; §4.4 Install the IQ Cable; §6.4–§6.5 IQ Cable accessories',
    statedGroundingMethod: 'no-additional-equipment-grounding-conductor',
    statedText: a.cutToLengthPermitted.quote + ' ' + a.fieldWireableConnectorPair.quote,
    equipmentClassification: 'Class II double-insulated with integrated ground-fault protection (GFP)',
    applicability: {
      microinverterSkus: claimed('IQ8-60-2-US', 'IQ8PLUS-72-2-US', 'IQ8M-72-2-US', 'IQ8A-72-2-US', 'IQ8H-240-72-2-US'),
      cableAssemblySkus: claimed(...a.listedCablePackaging.value.map(c => c.sku)),
      connectorArchitectures: claimed(IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE),
      jurisdictions: claimed('ALL US NEC JURISDICTIONS', 'North America', 'NEC', 'CSA C22.1'),
      moduleSkus: notApplicable(
        'The cable installation and termination method is module-agnostic.'),
      mountingBondingSystems: notApplicable(
        'This evidence establishes the IQ Cable installation / field-termination method. Racking '
        + 'bonding is a separate authority (UL 2703 mounting hardware) and is untouched by it.'),
      scope: 'exact-sku',
      productLine: 'IQ8 residential (IQ/Q-Cable drop-connector architecture)',
    },
  };
}
