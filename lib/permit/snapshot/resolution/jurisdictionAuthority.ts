// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 — PROJECT LEGAL AUTHORITY + CODE ADOPTION AUTHORITY (pure)
// ───────────────────────────────────────────────────────────────────────────
// PURE. No DB, no network, no clock. The provider does the retrieving; this
// module turns a retrieval into the two authority RECORDS the pure snapshot
// build consumes, and decides — deterministically and testably — whether each
// requirement may clear.
//
// THE TWO RULES THAT MAKE THIS NOT-INFERENCE (directive WS-3):
//   1. A field is VERIFIED only when an OFFICIAL SOURCE returned it FOR THIS
//      EXACT ADDRESS, and the record names the source, the endpoint, the
//      timestamp and the payload hash. Postal inference stays
//      'unverified-derived' exactly as before.
//   2. An adopted edition is ESTABLISHED only when a retrieval carried it.
//      The curated `ahj-national` table is admitted as a CORROBORATOR — it can
//      agree with a retrieval and raise confidence, and it can DISAGREE and
//      force OPERATOR_CONFIRMATION — but it can never, standing alone, establish
//      an edition: it has no adoption ordinance, no effective date and no hash.
//      Utility territory is never admitted at all.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { canonicalJson } from '../digest';
import type { AhjRecord } from '@/lib/jurisdictions/ahj-national';
import type { RegistryCodeAdoption } from '@/lib/jurisdictions/ahjRegistry';
import type { RetrievedPropertyIdentity } from '@/lib/providers/property/types';
import type { CodeEditionKind } from '../codeAuthority';

/** SHA-256 over the canonical JSON of a retrieval payload. THE `sourceHash` a
 *  retrieved authority record must carry (the same digest discipline the
 *  snapshot itself uses). */
export function retrievalSourceHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// §1 — PROJECT LEGAL AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════

export type LegalFieldState = 'verified' | 'unverified-derived' | 'unknown';

export interface ProjectLegalFieldRecord {
  state: LegalFieldState;
  /** the value the AUTHORITY establishes (null when unknown). */
  value: string | null;
  /** the value the project record carried, when it differs. */
  postedValue: string | null;
  /** the source that established it. */
  source: string | null;
  /** why it is in this state — always a specific sentence. */
  basis: string;
}

export interface ProjectLegalAuthorityRecord {
  schemaVersion: '1.0.0';
  /** the resolver that produced this record. */
  resolverId: string;
  /** true only when EVERY field the gate inspects is 'verified'. */
  verified: boolean;
  /** per-field states, in the shape ProjectAuthorityVerification already uses. */
  fields: {
    address: ProjectLegalFieldRecord;
    apn: ProjectLegalFieldRecord;
    municipalBoundary: ProjectLegalFieldRecord;
    ahjName: ProjectLegalFieldRecord;
    fireAuthority: ProjectLegalFieldRecord;
  };
  /** the normalized identity the retrieval established. */
  normalized: {
    address: string | null;
    county: string | null;
    stateFips: string | null;
    countyFips: string | null;
    censusTract: string | null;
    incorporatedPlace: string | null;
    countySubdivision: string | null;
    lat: number | null;
    lng: number | null;
  };
  /** the boundary determination, as a sentence a reviewer can act on. */
  boundaryEvidence: string;
  /** true = positively outside any incorporated municipality (⇒ county AHJ). */
  unincorporated: boolean | null;
  /** a genuine ambiguity the engine may not resolve. Non-empty ⇒
   *  OPERATOR_CONFIRMATION, never an engine choice. */
  confirmationRequired: string[];
  providerUsed: string;
  sourcesQueried: string[];
  retrievedAtIso: string;
  sourceHash: string;
  confidence: number;
  proof: 'live-retrieval' | 'fixture' | 'internal-registry';
  fixtureProvenance: string | null;
  /** failures inside the provider chain, kept even on success. */
  chainFailures: string[];
}

function fieldRec(
  state: LegalFieldState, value: string | null, source: string | null, basis: string, postedValue?: string | null,
): ProjectLegalFieldRecord {
  return { state, value, postedValue: postedValue ?? null, source, basis };
}

const norm = (s: string | null | undefined): string =>
  (s ?? '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Does the retrieved county corroborate the posted one? Compares on the bare
 *  name so "Madison" and "Madison County" agree. */
export function countyAgrees(posted: string | null | undefined, retrieved: string | null | undefined): boolean {
  const a = norm(posted).replace(/\s+county$/, '');
  const b = norm(retrieved).replace(/\s+county$/, '');
  return !!a && !!b && a === b;
}

export interface ProjectLegalAuthorityArgs {
  identity: RetrievedPropertyIdentity;
  posted: {
    address: string | null; city: string | null; county: string | null;
    stateCode: string | null; apn: string | null; ahjName: string | null;
  };
  /** the AHJ record the pure build resolved from the curated table, used ONLY to
   *  check that the retrieved boundary and the named AHJ are consistent. */
  ahjRecord: AhjRecord | null;
  confidence: number;
  resolverId: string;
}

/**
 * Build the project legal authority from a retrieval.
 *
 * WHAT CLEARS AND WHAT DOES NOT:
 *   address            — VERIFIED when an official geocoder MATCHED it (the
 *                        Census Bureau's own address matcher is the authority
 *                        for "this address exists and normalises to X").
 *   municipalBoundary  — VERIFIED when the place layer actually resolved, so
 *                        "inside place P" and "unincorporated" are both positive
 *                        findings. UNVERIFIED when the layer was never queried.
 *   ahjName            — VERIFIED when the retrieved boundary is CONSISTENT with
 *                        the AHJ the snapshot names (a county AHJ for an
 *                        unincorporated parcel, a city AHJ inside that city).
 *                        INCONSISTENT ⇒ confirmationRequired, never a silent flip.
 *   fireAuthority      — follows the building AHJ, as the record already models.
 *   apn                — VERIFIED only from a parcel source (ATTOM). The Census
 *                        Geocoder does not publish APNs, so with no ATTOM key the
 *                        APN stays UNKNOWN. It is never inferred and never
 *                        back-filled from the posted record.
 */
export function buildProjectLegalAuthority(args: ProjectLegalAuthorityArgs): ProjectLegalAuthorityRecord {
  const id = args.identity;
  const posted = args.posted;
  const confirmationRequired: string[] = [];

  // ── address ────────────────────────────────────────────────────────────────
  const address = id.normalizedAddress
    ? fieldRec('verified', id.normalizedAddress, id.providerUsed,
        `matched and normalised by ${id.providerUsed} for the exact posted address`, posted.address)
    : fieldRec('unverified-derived', posted.address ?? null, 'project-record',
        'no official source returned a normalised address — the posted string stands unverified', posted.address);

  // ── APN — only a parcel source may establish one ──────────────────────────
  const apn = id.parcelId
    ? fieldRec('verified', id.parcelId, id.providerUsed, `parcel identifier published by ${id.providerUsed} for this address`, posted.apn)
    : posted.apn
      ? fieldRec('unverified-derived', posted.apn, 'project-record',
          'the posted APN was not confirmed against a parcel source (no ATTOM key / no parcel record) — never inferred', posted.apn)
      : fieldRec('unknown', null, null,
          'no parcel source in the chain published an APN for this address (only ATTOM does); it is left UNKNOWN, not inferred', null);

  // ── municipal boundary ─────────────────────────────────────────────────────
  const municipalBoundary = id.boundaryLayersResolved
    ? fieldRec('verified',
        id.incorporatedPlace ?? (id.county ? `${id.county} (unincorporated${id.countySubdivision ? `, ${id.countySubdivision}` : ''})` : null),
        id.providerUsed, id.boundaryEvidence, posted.city)
    : fieldRec('unverified-derived', posted.city ?? null, 'project-record',
        'the municipal-boundary layer was not resolved — whether the parcel is inside an incorporated municipality is undetermined', posted.city);

  // ── county corroboration (a mismatch is a real conflict) ───────────────────
  if (posted.county && id.county && !countyAgrees(posted.county, id.county)) {
    confirmationRequired.push(
      `the project record says county "${posted.county}" but ${id.providerUsed} places this address in "${id.county}" — `
      + 'the county determines the AHJ, the fire authority and the code adoption, so the engine may not pick one.');
  }

  // ── AHJ / fire authority consistency ──────────────────────────────────────
  const ahjType = args.ahjRecord?.ahjType ?? null;
  const ahjName = posted.ahjName ?? args.ahjRecord?.ahjName ?? null;
  let ahjField: ProjectLegalFieldRecord;
  if (!ahjName) {
    ahjField = fieldRec('unknown', null, null, 'no AHJ is named on the project and none could be localised', null);
  } else if (!id.boundaryLayersResolved) {
    ahjField = fieldRec('unverified-derived', ahjName, 'project-record',
      'the AHJ is named but the municipal boundary was not resolved, so the naming is not corroborated by an official source', ahjName);
  } else if (id.unincorporated === true && ahjType === 'city') {
    confirmationRequired.push(
      `${id.providerUsed} places this parcel OUTSIDE any incorporated municipality (${id.countySubdivision ?? 'no place layer'}), `
      + `but the named AHJ "${ahjName}" is a CITY authority — an unincorporated parcel is normally under the county. `
      + 'Confirm which authority has jurisdiction.');
    ahjField = fieldRec('unverified-derived', ahjName, 'project-record',
      'the named city AHJ conflicts with an official unincorporated boundary determination', ahjName);
  } else if (id.unincorporated === false && ahjType === 'county'
      && id.incorporatedPlace && !norm(ahjName).includes(norm(id.incorporatedPlace))) {
    confirmationRequired.push(
      `${id.providerUsed} places this parcel INSIDE the incorporated place "${id.incorporatedPlace}", but the named AHJ `
      + `"${ahjName}" is a COUNTY authority — confirm which authority has jurisdiction.`);
    ahjField = fieldRec('unverified-derived', ahjName, 'project-record',
      'the named county AHJ conflicts with an official incorporated-place boundary determination', ahjName);
  } else {
    ahjField = fieldRec('verified', ahjName, `${id.providerUsed} boundary determination`,
      `the named AHJ is CONSISTENT with the official boundary determination: ${id.boundaryEvidence}`, ahjName);
  }
  // The fire authority derives with the building AHJ, exactly as the existing
  // ProjectAuthorityVerification models it — same state, stated as derived.
  const fireAuthority: ProjectLegalFieldRecord = {
    ...ahjField,
    basis: `fire authority derives with the building AHJ — ${ahjField.basis}`,
  };

  const fields = { address, apn, municipalBoundary, ahjName: ahjField, fireAuthority };
  // A field the project does not carry at all ('unknown') must not block: the
  // existing gate only fires on 'unverified-derived'. Same rule, kept verbatim.
  const anyUnverified = Object.values(fields).some(f => f.state === 'unverified-derived');
  const verified = !anyUnverified && confirmationRequired.length === 0;

  return {
    schemaVersion: '1.0.0',
    resolverId: args.resolverId,
    verified,
    fields,
    normalized: {
      address: id.normalizedAddress, county: id.county,
      stateFips: id.stateFips, countyFips: id.countyFips, censusTract: id.censusTract,
      incorporatedPlace: id.incorporatedPlace, countySubdivision: id.countySubdivision,
      lat: id.lat, lng: id.lng,
    },
    boundaryEvidence: id.boundaryEvidence,
    unincorporated: id.unincorporated,
    confirmationRequired,
    providerUsed: id.providerUsed,
    sourcesQueried: id.sourcesQueried,
    retrievedAtIso: id.retrievedAtIso,
    sourceHash: retrievalSourceHash({
      provider: id.providerUsed, normalizedAddress: id.normalizedAddress,
      lat: id.lat, lng: id.lng, county: id.county, stateFips: id.stateFips, countyFips: id.countyFips,
      censusTract: id.censusTract, incorporatedPlace: id.incorporatedPlace,
      countySubdivision: id.countySubdivision, parcelId: id.parcelId,
    }),
    confidence: args.confidence,
    proof: id.proof,
    fixtureProvenance: id.fixtureProvenance ?? null,
    chainFailures: id.chainFailures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 — CODE ADOPTION AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════

export interface RetrievedEdition {
  kind: CodeEditionKind;
  edition: string | null;
  /** the exact registry field the value came from, e.g. 'BuildingCode'. */
  registryField: string | null;
  /** the raw enumeration as the registry stated it, e.g. '2021IBC'. */
  raw: string | null;
  /** an independent source that AGREES (the curated table's NEC year). */
  corroboratedBy: string | null;
  /** an independent source that DISAGREES — forces OPERATOR_CONFIRMATION. */
  conflictsWith: string | null;
}

export interface CodeAdoptionAuthorityRecord {
  schemaVersion: '1.0.0';
  resolverId: string;
  ahjName: string;
  jurisdictionType: 'city' | 'county' | 'state' | 'special_district' | 'unknown';
  /** building / electrical / fire authority of record. The registry publishes one
   *  AHJ per point with all four adopted codes, so all three name that AHJ
   *  unless the registry itself splits them. */
  buildingAhj: string;
  electricalAhj: string;
  fireAhj: string;
  permitOffice: { name: string | null; phone: string | null; email: string | null; url: string | null; address: string | null };
  editions: RetrievedEdition[];
  localAmendments: string[];
  effectiveDate: string | null;
  engineeringReviewRequirements: string[];
  /** genuine source disagreement — non-empty ⇒ OPERATOR_CONFIRMATION with BOTH
   *  sources shown, never an engine pick. */
  conflicts: string[];
  sourceDocument: string;
  officialSource: string | null;
  sourceRevision: string | null;
  sourceDate: string | null;
  sourceHash: string;
  /** the machine identity recorded as `verifiedBy` on the CodeAuthorityRecord —
   *  a RETRIEVAL, explicitly attributed, never a person's name. */
  verifiedBy: string;
  retrievedAtIso: string;
  sourcesQueried: string[];
  confidence: number;
  proof: 'live-retrieval' | 'fixture' | 'internal-registry';
  fixtureProvenance: string | null;
}

export interface CodeAdoptionArgs {
  adoption: RegistryCodeAdoption;
  /** the curated in-repo record for the same jurisdiction — a CORROBORATOR ONLY. */
  corroborator: AhjRecord | null;
  /** the ASCE edition the structural engine ran under. Present on the record as
   *  an ENGINE BASIS, never as an AHJ adoption claim (the existing rule). */
  asceEngineBasis: string | null;
  confidence: number;
  resolverId: string;
  proof: 'live-retrieval' | 'fixture' | 'internal-registry';
  fixtureProvenance?: string | null;
}

/**
 * Turn a registry retrieval into the code-adoption authority record.
 *
 * CORROBORATION, NOT SUBSTITUTION: the curated table only ever carries an NEC
 * year. Where it AGREES with the retrieval, that agreement is recorded and
 * raises confidence. Where it DISAGREES, the disagreement is recorded as a
 * CONFLICT and the requirement escalates to OPERATOR_CONFIRMATION with both
 * values shown. Where the retrieval carries nothing, the curated value is NOT
 * promoted into the gap — a sourceless table can never establish an adoption.
 */
export function buildCodeAdoptionAuthority(args: CodeAdoptionArgs): CodeAdoptionAuthorityRecord {
  const a = args.adoption;
  const c = args.corroborator;
  const conflicts: string[] = [];

  const necCorroborator = c?.necVersion ?? null;
  const corroboratorLabel = c ? `ahj-national:${c.id} (${c.dataProvenance ?? 'unknown-provenance'}, curated table — corroborator only)` : null;

  const mk = (
    kind: CodeEditionKind, edition: string | null, registryField: string | null, raw: string | null,
    corroborate?: { value: string | null; label: string | null },
  ): RetrievedEdition => {
    let corroboratedBy: string | null = null;
    let conflictsWith: string | null = null;
    if (edition && corroborate?.value && corroborate.label) {
      if (corroborate.value === edition) corroboratedBy = corroborate.label;
      else {
        conflictsWith = `${corroborate.label} states ${corroborate.value}`;
        conflicts.push(
          `${kind.toUpperCase()} adoption disagreement — ${a.ahjName} registry (${a.sourceUrl}) states ${edition}; `
          + `${corroborate.label} states ${corroborate.value}. The engine may not choose between disagreeing sources.`);
      }
    }
    return { kind, edition, registryField, raw, corroboratedBy, conflictsWith };
  };

  const editions: RetrievedEdition[] = [
    mk('nec', a.editions.nec, 'ElectricCode', a.rawEditions.ElectricCode, { value: necCorroborator, label: corroboratorLabel }),
    mk('ibc', a.editions.ibc, 'BuildingCode', a.rawEditions.BuildingCode),
    mk('irc', a.editions.irc, 'ResidentialCode', a.rawEditions.ResidentialCode),
    mk('ifc', a.editions.ifc, 'FireCode', a.rawEditions.FireCode),
  ];
  // ASCE is DELIBERATELY ABSENT from the adoption record: it is the STRUCTURAL
  // ENGINE's computational basis, not an AHJ adoption claim, and buildCodeAuthority
  // already sources it that way (`asceEngineBasis`). Including it here would let a
  // registry retrieval appear to establish an adoption it never stated.
  void args.asceEngineBasis;

  const sourceHash = retrievalSourceHash({
    endpoint: a.sourceUrl, ahjName: a.ahjName, ahjId: a.ahjId, ahjCode: a.ahjCode,
    editions: a.editions, rawEditions: a.rawEditions, lastUpdated: a.lastUpdatedIso,
  });

  return {
    schemaVersion: '1.0.0',
    resolverId: args.resolverId,
    ahjName: a.ahjName,
    jurisdictionType: a.jurisdictionType,
    buildingAhj: a.ahjName,
    electricalAhj: a.ahjName,
    fireAhj: a.ahjName,
    permitOffice: a.permitOffice,
    editions,
    // The curated table's amendment list is descriptive metadata about the same
    // jurisdiction; it is carried through, attributed, and never treated as an
    // adoption edition.
    localAmendments: c?.localAmendments ?? [],
    effectiveDate: a.lastUpdatedIso,
    engineeringReviewRequirements: a.engineeringReviewRequirements,
    conflicts,
    sourceDocument: `SunSpec / Orange Button AHJ Registry record for ${a.ahjName}`
      + `${a.ahjCode ? ` (${a.ahjCode})` : ''}`,
    officialSource: a.permitOffice.url ?? a.sourceUrl,
    sourceRevision: a.ahjId,
    sourceDate: a.lastUpdatedIso,
    sourceHash,
    verifiedBy: `${args.resolverId} · ${a.sourceUrl} · retrieved ${a.retrievedAtIso}`,
    retrievedAtIso: a.retrievedAtIso,
    sourcesQueried: [a.sourceUrl],
    confidence: args.confidence,
    proof: args.proof,
    fixtureProvenance: args.fixtureProvenance ?? null,
  };
}

/** The four editions an ADOPTION must carry (ASCE is the engine basis and is
 *  sourced separately). */
export const ADOPTION_EDITION_KINDS: CodeEditionKind[] = ['nec', 'ibc', 'irc', 'ifc'];

/** Which adoption editions the retrieval did NOT establish. Non-empty ⇒
 *  CODE-AUTHORITY-INCOMPLETE stays open, with these named. */
export function missingAdoptionEditions(rec: CodeAdoptionAuthorityRecord): CodeEditionKind[] {
  return ADOPTION_EDITION_KINDS.filter(k => !rec.editions.find(e => e.kind === k)?.edition);
}
