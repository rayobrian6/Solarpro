// ═══════════════════════════════════════════════════════════════════════════
// SYNTHETIC PENDING GROUNDING FIXTURES.
//
// WHY THIS EXISTS
// Eight tests asserted "the open-air grounding outcome is PENDING" by reading
// the LIVE Braidon package. That was never the property they guard. The property
// is: *while the manufacturer authority is pending, nothing in the package may
// assert an installed open-air EGC* — the E-1 bonding cell renders the
// non-assertion label, the grounding segment carries no size and no length, the
// RS-1 payload renders the pending fields, and the sheet banners count the
// requirement. Whether THIS project happens to be pending is a fact about the
// evidence archive, not a safety property, and pinning it made the archive
// un-improvable: retrieving the real Enphase IOM-00068-3.0-EN broke eight tests
// that had nothing to do with the retrieval.
//
// So the pending state is now MANUFACTURED, precisely, here. Each fixture below
// is pending for ONE named, verifiable reason, and every other applicability
// dimension MATCHES — so a test that passes proves the pending RENDERING, and a
// specificity check that ever weakened would show up as a fixture that stopped
// being pending.
//
// NOTHING HERE WEAKENS EVIDENCE SPECIFICITY, and nothing here forces the live
// project back to pending: `groundingDocumentEvidence` is the build's existing
// authority socket, so supplying a synthetic document REPLACES the archived one
// for that one build only.
//
// Every document below is CLEARLY MARKED SYNTHETIC and can never be mistaken for
// manufacturer evidence: fake ids, fake hashes, fake titles.
// ═══════════════════════════════════════════════════════════════════════════
import {
  claimed, notApplicable, unknownCoverage,
  type GroundingDocumentEvidence,
} from '@/lib/permit/snapshot/groundingAuthority';

/** The EXACT selected equipment on the reference project. A synthetic document
 *  matches all of these except in the one dimension it is built to fail. */
export const SELECTED = {
  microSku: 'IQ8A-72-2-US',
  cableSku: 'Q-12-10-240',
  connectorArchitecture: 'iq-q-cable-drop-connector',
} as const;

type Over = Partial<GroundingDocumentEvidence> & {
  applicabilityOver?: Partial<GroundingDocumentEvidence['applicability']>;
};

/** A synthetic document that is EXACTLY APPLICABLE in every dimension — the
 *  baseline the pending fixtures each break in exactly one place. Used on its own
 *  only to prove a fixture's pendingness comes from the intended condition. */
export function syntheticApplicableDoc(over: Over = {}): GroundingDocumentEvidence {
  const { applicabilityOver, ...rest } = over;
  return {
    documentId: 'SYNTHETIC-PENDING-FIXTURE-0001',
    documentClass: 'manufacturer-installation-and-operation-manual',
    purpose: 'IQ8A_PRODUCT_GROUNDING',
    title: 'SYNTHETIC TEST DOCUMENT — NOT REAL MANUFACTURER EVIDENCE',
    revision: 'SYNTH-0',
    documentHash: 'f'.repeat(64),
    archivedInRepo: true,
    verificationState: 'verified',
    status: 'current',
    sectionOrPage: '§SYNTH-1 (synthetic)',
    statedGroundingMethod: 'no-additional-equipment-grounding-conductor',
    statedText: 'SYNTHETIC TEST TEXT — this document is a test fixture.',
    equipmentClassification: 'SYNTHETIC: Class II double-insulated',
    applicability: {
      microinverterSkus: claimed(SELECTED.microSku),
      cableAssemblySkus: claimed(SELECTED.cableSku),
      connectorArchitectures: claimed(SELECTED.connectorArchitecture),
      jurisdictions: claimed('ALL US NEC JURISDICTIONS'),
      moduleSkus: notApplicable('SYNTHETIC: module-agnostic statement.'),
      mountingBondingSystems: notApplicable('SYNTHETIC: racking bonding is a separate authority.'),
      scope: 'exact-sku',
      productLine: 'SYNTHETIC (test fixture)',
      ...applicabilityOver,
    },
    ...rest,
  };
}

/**
 * THE PENDING CONDITIONS. Each is a single, precise, named defect; everything
 * else about the document is exactly applicable, so the resulting
 * PENDING_MANUFACTURER_AUTHORITY is attributable to that one condition.
 */
export const PENDING_CONDITIONS = {
  /** The document is written for the OTHER Enphase branch architecture (the
   *  "…with integrated MC4 connectors" manual). Same micro family, different
   *  wiring system — it cannot establish the method for a Q-Cable branch. */
  wrongConnectorArchitecture: () => syntheticApplicableDoc({
    applicabilityOver: { connectorArchitectures: claimed('integrated-mc4') },
  }),
  /** The document never states which architecture it covers. */
  missingConnectorArchitecture: () => {
    const d = syntheticApplicableDoc();
    delete (d.applicability as unknown as Record<string, unknown>).connectorArchitectures;
    return d;
  },
  /** The document explicitly records that its architecture coverage is UNKNOWN. */
  unknownConnectorApplicability: () => syntheticApplicableDoc({
    applicabilityOver: {
      connectorArchitectures: unknownCoverage('SYNTHETIC: the document does not state its branch architecture.'),
    },
  }),
  /** A different microinverter — IQ8AC is not IQ8A. */
  wrongMicroSku: () => syntheticApplicableDoc({
    applicabilityOver: { microinverterSkus: claimed('IQ8AC-72-M-US') },
  }),
  /** A different cable assembly (a landscape-pitch SKU on a portrait array). */
  wrongCableSku: () => syntheticApplicableDoc({
    applicabilityOver: { cableAssemblySkus: claimed('Q-12-25-200') },
  }),
  /** A regional variant written against a different code basis. */
  wrongRegion: () => syntheticApplicableDoc({
    applicabilityOver: { jurisdictions: claimed('EUROPE — IEC 60364') },
  }),
  /** No SHA-256 recorded ⇒ the archived bytes cannot be shown to be the bytes
   *  the statement was read from. */
  missingArchivedHash: () => syntheticApplicableDoc({ documentHash: '' }),
  /** A SUPERSEDED revision can never establish a current method. */
  supersededRevision: () => syntheticApplicableDoc({
    revision: 'SYNTH-0 (superseded)', status: 'superseded',
  }),
  /** A FAMILY-level positive claim: the strongest realistic near-miss — it names
   *  the product line, not the SKU. */
  familyScopeOnly: () => syntheticApplicableDoc({
    applicabilityOver: { scope: 'family' },
  }),
} as const;

export type PendingConditionName = keyof typeof PENDING_CONDITIONS;

/** The authority bundle shape generatePermitHTML accepts. Only the grounding
 *  socket is set; every other field is read with `?.` and stays default. */
export function pendingGroundingAuthority(condition: PendingConditionName = 'wrongConnectorArchitecture') {
  return { groundingDocumentEvidence: PENDING_CONDITIONS[condition]() };
}
