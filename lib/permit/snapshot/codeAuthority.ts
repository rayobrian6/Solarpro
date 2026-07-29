// ═══════════════════════════════════════════════════════════════════════════
// W4 §1 — CANONICAL AHJ + CODE-AUTHORITY RECORD
//
// THE single source for every printed code edition (NEC / IBC / IRC / IFC /
// ASCE). Ray's mandate (2026-07-21): title blocks, cover, notes, electrical
// sheets, structural sheets, labels, certificates and engineer letters must all
// print IDENTICAL editions, and every edition must come from THIS record.
//
// HONESTY CONTRACT (W4 §1, binding):
//   • No generic state default when a local AHJ governs.
//   • No silent edition inference — an unknown adoption stays `null` (never a
//     guessed year, never NEC→IFC derivation). A null edition renders PENDING on
//     the sheet and drives the CODE-AUTHORITY-INCOMPLETE permit blocker.
//   • Nothing in-repo is a verified adoption ordinance: every record is
//     `unverified` until W4-D's document registry archives the adoption document
//     and an operator verifies it. `sourceHash` is shaped as a SHA-256 registry
//     reference for that future ingestion.
//   • The planset still RENDERS for review while incomplete; only permit-ready
//     status is blocked.
// ═══════════════════════════════════════════════════════════════════════════
import type { Provenance } from './types';
import type { AhjRecord } from '@/lib/jurisdictions/ahj-national';
import {
  getAhjById, getAhjByCounty, getAhjByAddress,
} from '@/lib/jurisdictions/ahj-national';
import type { CodeAdoptionAuthorityRecord } from './resolution/jurisdictionAuthority';

export const CODE_AUTHORITY_SCHEMA_VERSION = '1.0.0';

export type CodeEditionKind = 'nec' | 'ibc' | 'irc' | 'ifc' | 'asce';
export const CODE_EDITION_KINDS: CodeEditionKind[] = ['nec', 'ibc', 'irc', 'ifc', 'asce'];

/** verified — an archived adoption document exists AND an operator confirmed it,
 *  AND every applicable edition is populated. unverified — editions are known
 *  from a record but no adoption document is archived/confirmed. incomplete —
 *  one or more applicable editions are unknown (null). */
export type CodeVerificationStatus = 'verified' | 'unverified' | 'incomplete';

/** Where an individual edition came from. `unknown` ⇒ edition MUST be null. */
export type CodeEditionSource =
  | 'ahj-record'              // resolved from the AHJ adoption record (NEC)
  | 'ahj-registry-retrieval'  // AAC WS-3 — retrieved live from the AHJ registry
  | 'structural-engine-basis' // ASCE edition the structural engine ran under
  | 'operator-entry'          // manual operator authority (future)
  | 'unknown';                // no authority — edition null, never inferred

/** One adopted code edition, individually sourced and individually honest. */
export interface CodeEdition {
  kind: CodeEditionKind;
  /** adopted edition token — '2023' (NEC/IBC/IRC/IFC) or '7-22' (ASCE). null
   *  when the jurisdiction's adoption is unknown. NEVER inferred/derived. */
  edition: string | null;
  /** display family of the standard (stable, edition-independent). */
  standard: string;
  source: CodeEditionSource;
  provenance: Provenance;
}

/** The versioned project-jurisdiction authority record (W4 §1). Every field the
 *  directive enumerates is present; unknown values are honestly null. */
export interface CodeAuthorityRecord {
  schemaVersion: string;
  // ── AHJ identity ──────────────────────────────────────────────────────────
  ahjName: string | null;
  jurisdictionType: 'city' | 'county' | 'state' | 'special_district' | 'unknown';
  stateCode: string | null;
  stateName: string | null;
  county: string | null;
  city: string | null;
  ahjRecordId: string | null;                 // ahj-national id when resolved
  utility: { name: string | null; id: string | null };
  // ── adopted editions (each individually sourced; null when unknown) ───────
  editions: Record<CodeEditionKind, CodeEdition>;
  localAmendments: string[];
  effectiveDate: string | null;
  expirationDate: string | null;              // supersession where known
  // ── sourcing / archival ───────────────────────────────────────────────────
  sourceDocument: string | null;              // adoption ordinance / official source title
  officialSource: string | null;              // URL or agency
  sourceRevision: string | null;              // rev / date of the source document
  sourceDate: string | null;
  /** SHA-256 of the archived adoption document — shaped for the W4-D document
   *  registry; null until archived. */
  sourceHash: string | null;
  // ── verification ──────────────────────────────────────────────────────────
  verificationStatus: CodeVerificationStatus;
  verifiedBy: string | null;
  verifiedAtIso: string | null;
  /** provenance of the underlying AHJ record ('curated'|'expanded'|'registry_live'). */
  recordProvenance: string | null;
  applicabilityNotes: string[];
  /** editions that are unknown (null) — drives CODE-AUTHORITY-INCOMPLETE. */
  incompleteEditions: CodeEditionKind[];
  capturedAtIso: string;
  provenance: Provenance;
}

const STANDARD_LABEL: Record<CodeEditionKind, string> = {
  nec: 'NEC (NFPA 70)',
  ibc: 'International Building Code',
  irc: 'International Residential Code',
  ifc: 'International Fire Code',
  asce: 'ASCE/SEI 7',
};

const VALID_NEC = /^(2017|2020|2023)$/;

function normalizeNecEdition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).replace(/^NEC\s+/i, '').trim();
  return VALID_NEC.test(v) ? v : null;
}

function normalizeAsceEdition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // accept 'ASCE 7-22', '7-22', 'ASCE 7-16' → '7-22' / '7-16'
  const m = String(raw).match(/7-\d{2}/);
  return m ? m[0] : null;
}

/** Resolve the best available AhjRecord from whatever identity hints the project
 *  carries (record id → county → address). Returns null when no local AHJ can be
 *  confidently localized — NEVER a "first record in the state" guess. */
export function resolveAhjRecord(hints: {
  ahjRecordId?: string | null;
  stateCode?: string | null;
  county?: string | null;
  city?: string | null;
  address?: string | null;
}): AhjRecord | null {
  if (hints.ahjRecordId) {
    const byId = getAhjById(hints.ahjRecordId);
    if (byId) return byId;
  }
  if (hints.stateCode && hints.county) {
    const byCounty = getAhjByCounty(hints.stateCode, hints.county);
    if (byCounty) return byCounty;
  }
  if (hints.address) {
    const byAddr = getAhjByAddress(hints.address, {
      stateCode: hints.stateCode ?? undefined,
      county: hints.county ?? undefined,
      city: hints.city ?? undefined,
    });
    if (byAddr) return byAddr;
  }
  return null;
}

export interface CodeAuthorityBuildArgs {
  /** the AHJ record resolved for the project (or null when unlocalized). */
  ahjRecord: AhjRecord | null;
  /** the server-enriched NEC edition carried on compliance.jurisdiction — the
   *  best-available adoption value, itself derived from the AHJ record. */
  necVersionEnriched?: string | null;
  /** display AHJ name when no full record resolved. */
  ahjNameHint?: string | null;
  stateCodeHint?: string | null;
  /** the ASCE edition the STRUCTURAL ENGINE actually ran its calculations under
   *  (structural.env.codeAuthority.asceEdition). This is a computational BASIS,
   *  not a claim of AHJ adoption — sourced as 'structural-engine-basis'. */
  asceEngineBasis?: string | null;
  utilityName?: string | null;
  utilityId?: string | null;
  capturedAtIso: string;
  /** AAC WS-3 — the RETRIEVED adopted-code authority (code-authority@v1). When
   *  present, its editions, permit office, effective date, source URL, retrieval
   *  hash and machine `verifiedBy` populate this record and the previously
   *  hardcoded nulls at :199-201 / :212-213 / :242-251 go away.
   *
   *  THE HONESTY CONTRACT IS UNCHANGED: a retrieval WITH provenance is not
   *  inference. An edition the retrieval did not carry stays null (never filled
   *  from the curated table, never derived from the NEC year), and a record with
   *  disagreeing sources arrives here with `conflicts` populated, which keeps it
   *  unverified. */
  codeAdoption?: CodeAdoptionAuthorityRecord | null;
}

/** Build THE canonical code-authority record. Populates NEC from the best real
 *  adoption authority; leaves IBC/IRC/IFC unknown (the AHJ DB does not carry
 *  them — no inference); sources ASCE from the structural engine basis. Every
 *  record is `unverified`/`incomplete` until W4-D archives an adoption document.
 */
export function buildCodeAuthority(args: CodeAuthorityBuildArgs): CodeAuthorityRecord {
  const rec = args.ahjRecord;
  // AAC WS-3 — a retrieval is admitted ONLY when it carries no unresolved source
  // conflict. A record whose sources disagree is evidence of a conflict, not an
  // adoption, and must not populate an edition.
  const adopt = args.codeAdoption && args.codeAdoption.conflicts.length === 0 ? args.codeAdoption : null;
  const adoptConflicted = !!args.codeAdoption && args.codeAdoption.conflicts.length > 0;
  const adoptFor = (k: CodeEditionKind): string | null =>
    adopt?.editions.find(e => e.kind === k)?.edition ?? null;

  const edition = (
    kind: CodeEditionKind, value: string | null, source: CodeEditionSource, prov: Provenance,
  ): CodeEdition => ({ kind, edition: value, standard: STANDARD_LABEL[kind], source, provenance: prov });

  // ── NEC: the RETRIEVAL wins; else the AHJ record / enriched jurisdiction ────
  const necRetrieved = normalizeNecEdition(adoptFor('nec'));
  const necFromRecord = normalizeNecEdition(rec?.necVersion);
  const necFromEnriched = normalizeNecEdition(args.necVersionEnriched);
  const nec = necRetrieved ?? necFromRecord ?? necFromEnriched;
  const necSource: CodeEditionSource = necRetrieved ? 'ahj-registry-retrieval' : nec ? 'ahj-record' : 'unknown';
  const necRef = necRetrieved
    ? `${adopt!.sourcesQueried[0] ?? 'ahj-registry'}#${adopt!.sourceHash.slice(0, 16)}`
    : rec ? `ahj-national:${rec.id}` : (necFromEnriched ? 'compliance.jurisdiction.necVersion' : undefined);

  // ── IBC / IRC / IFC: ONLY from a retrieval. The curated AHJ DB does not carry
  //    them and may not fill the gap; nothing is derived from the NEC year. ────
  const unknownProv: Provenance = {
    source: 'code-authority',
    note: adoptConflicted
      ? 'a code-adoption retrieval exists but its sources DISAGREE — the edition is left null pending operator confirmation (no source is preferred)'
      : 'no AHJ adoption authority for this code family — edition left null (no inference)',
  };
  const retrievedProv = (k: CodeEditionKind): Provenance => ({
    source: 'ahj-registry-retrieval',
    ref: `${adopt!.sourcesQueried[0] ?? 'ahj-registry'}#${adopt!.sourceHash.slice(0, 16)}`,
    note: `adopted ${k.toUpperCase()} edition retrieved from ${adopt!.ahjName} at ${adopt!.retrievedAtIso}`
      + `${adopt!.editions.find(e => e.kind === k)?.corroboratedBy ? ` — corroborated by ${adopt!.editions.find(e => e.kind === k)!.corroboratedBy}` : ''}`
      + `${adopt!.proof === 'fixture' ? ' [FIXTURE PROOF, not live]' : ''}`,
  });
  const kindEdition = (k: CodeEditionKind): CodeEdition => {
    const v = adoptFor(k);
    return v
      ? edition(k, v, 'ahj-registry-retrieval', retrievedProv(k))
      : edition(k, null, 'unknown', unknownProv);
  };

  // ── ASCE: the structural engine basis (computational, not adoption) ─────────
  const asce = normalizeAsceEdition(args.asceEngineBasis);
  const asceSource: CodeEditionSource = asce ? 'structural-engine-basis' : 'unknown';

  const editions: Record<CodeEditionKind, CodeEdition> = {
    nec: edition('nec', nec, necSource, nec
      ? {
          source: necRetrieved ? 'ahj-registry-retrieval' : 'ahj-national',
          ref: necRef,
          note: necRetrieved
            ? `adopted NEC edition retrieved from ${adopt!.ahjName} at ${adopt!.retrievedAtIso}`
              + `${adopt!.editions.find(e => e.kind === 'nec')?.corroboratedBy ? ` — corroborated by ${adopt!.editions.find(e => e.kind === 'nec')!.corroboratedBy}` : ''}`
            : 'adopted NEC edition — unverified (no archived adoption ordinance)',
        }
      : unknownProv),
    ibc: kindEdition('ibc'),
    irc: kindEdition('irc'),
    ifc: kindEdition('ifc'),
    asce: edition('asce', asce, asceSource, asce
      ? { source: 'structural-engine', ref: 'structural.env.codeAuthority', note: 'ASCE edition the structural engine computed under — engine basis, not an AHJ adoption claim' }
      : unknownProv),
  };

  const incompleteEditions = CODE_EDITION_KINDS.filter(k => editions[k].edition == null);

  // Verification: `verified` requires every applicable edition AND an attributed
  // verifier AND a source hash. Those two are no longer hardcoded null: a
  // RETRIEVAL supplies both — `verifiedBy` names the resolver, the endpoint and
  // the retrieval timestamp (a machine retrieval, explicitly attributed as such,
  // never a person's name), and `sourceHash` is the SHA-256 of the retrieval
  // payload. With NO retrieval they stay null and the record stays unverified,
  // exactly as before.
  const verifiedBy: string | null = adopt?.verifiedBy ?? null;
  const sourceHash: string | null = adopt?.sourceHash ?? null;
  const verificationStatus: CodeVerificationStatus =
    incompleteEditions.length > 0 ? 'incomplete'
      : (verifiedBy && sourceHash) ? 'verified'
        : 'unverified';

  const applicabilityNotes: string[] = [];
  if (!rec && !nec) {
    applicabilityNotes.push('No local AHJ could be resolved for this project — code adoption is unknown; generic state defaults are NOT applied.');
  }
  if (incompleteEditions.length > 0) {
    applicabilityNotes.push(
      `Adopted edition unknown for: ${incompleteEditions.map(k => k.toUpperCase()).join(', ')} — printed as PENDING; no edition inferred.`);
  }
  if (adoptConflicted) {
    for (const c of args.codeAdoption!.conflicts) applicabilityNotes.push(`ADOPTION SOURCE CONFLICT — ${c}`);
  }
  applicabilityNotes.push(
    adopt
      ? `Adopted editions retrieved from ${adopt.sourceDocument} (${adopt.sourcesQueried.join(', ')}) at ${adopt.retrievedAtIso}, `
        + `SHA-256 ${adopt.sourceHash.slice(0, 16)}…, confidence ${adopt.confidence}`
        + `${adopt.proof === 'fixture' ? ' — FIXTURE PROOF, not a live retrieval' : ''}.`
      : 'Adoption document not archived/verified — editions are provisional pending the document registry.');

  return {
    schemaVersion: CODE_AUTHORITY_SCHEMA_VERSION,
    ahjName: adopt?.ahjName ?? rec?.ahjName ?? args.ahjNameHint ?? null,
    jurisdictionType: adopt?.jurisdictionType ?? rec?.ahjType ?? 'unknown',
    stateCode: rec?.stateCode ?? args.stateCodeHint ?? null,
    stateName: rec?.stateName ?? null,
    county: rec?.county ?? null,
    city: rec?.city ?? null,
    ahjRecordId: rec?.id ?? null,
    utility: { name: args.utilityName ?? rec?.utilityName ?? null, id: args.utilityId ?? null },
    editions,
    localAmendments: adopt?.localAmendments ?? rec?.localAmendments ?? [],
    effectiveDate: adopt?.effectiveDate ?? null,
    expirationDate: null,
    sourceDocument: adopt?.sourceDocument ?? null,
    officialSource: adopt?.officialSource ?? rec?.website ?? null,
    sourceRevision: adopt?.sourceRevision ?? null,
    sourceDate: adopt?.sourceDate ?? null,
    sourceHash,
    verificationStatus,
    verifiedBy,
    verifiedAtIso: adopt?.retrievedAtIso ?? null,
    recordProvenance: adopt ? 'registry_live_retrieval' : (rec?.dataProvenance ?? null),
    applicabilityNotes,
    incompleteEditions,
    capturedAtIso: args.capturedAtIso,
    provenance: {
      source: 'buildCodeAuthority',
      ref: adopt ? `${adopt.resolverId}#${adopt.sourceHash.slice(0, 16)}` : rec ? `ahj-national:${rec.id}` : 'no-ahj-record',
      note: adopt
        ? `adopted editions from a ${adopt.proof} retrieval of ${adopt.ahjName}`
        : rec
          ? `resolved AHJ record (${rec.dataProvenance ?? 'unknown-provenance'})`
          : 'no localized AHJ — codes unknown',
    },
  };
}
