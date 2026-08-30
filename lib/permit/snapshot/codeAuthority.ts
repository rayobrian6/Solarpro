// ═══════════════════════════════════════════════════════════════════════════
// W4 §1 — CANONICAL AHJ + CODE-AUTHORITY RECORD
//
// THE single source for every printed code edition (NEC / IBC / IRC / IFC /
// ASCE). Ray's mandate (2026-07-21): title blocks, cover, notes, electrical
// sheets, structural sheets, labels, certificates and engineer letters must all
// print IDENTICAL editions, and every edition must come from THIS record.
//
// HONESTY CONTRACT (W4 §1, binding — AMENDED 2026-08-27, see NATIONWIDE BASELINE):
//   • No silent edition inference — an unknown adoption stays `null` (never a
//     guessed year, never NEC→IFC derivation).
//   • A stated basis is not an inference. The state-level NEC adoption is
//     PUBLISHED and it may be printed, PROVIDED the sheet says it is the state
//     adoption and not this AHJ's ordinance. See `state-adoption-table`.
//
// NATIONWIDE BASELINE (2026-08-27). The rule "no generic state default when a
// local AHJ governs" was written for the case where we HAVE the local adoption
// and might override it. It was being applied to the case where we have NOTHING,
// which is not the same thing and produced "NEC PENDING" on every planset in the
// country. Closing that per-project required phoning each AHJ — unworkable for a
// national product, and not actually more honest, because the electrical
// analysis IS performed against specific NEC rules. Precedence is now:
//     archived adoption document  >  governed registry retrieval
//                                 >  STATE adoption table (labelled as such)
//                                 >  null
// A local AHJ adoption still wins outright whenever we have one. What changed is
// only what happens when we have none.
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
  // KDP WS-12 — municipal-first jurisdiction resolution.
  getAhjByCity, cityFromAddress, getAhjsByState,
} from '@/lib/jurisdictions/ahj-national';
import type { CodeAdoptionAuthorityRecord } from './resolution/jurisdictionAuthority';
import { getJurisdiction } from '@/lib/jurisdictions/necVersions';

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
  /** A value an AUTHENTICATED OPERATOR actually supplied for this project.
   *  Nothing may be classified this way without a real operator action behind
   *  it — SolarPro has no operator-attribution mechanism today, so nothing
   *  currently produces this. It is retained for when one exists. */
  | 'operator-entry'
  /** A value that arrived on `compliance.jurisdiction` with NO evidence of who
   *  put it there.
   *
   *  This class exists because the alternative was a lie. The enriched value was
   *  classified 'operator-entry' and published as "NEC <year> was entered for
   *  this project by the operator" — while the actual upstream source was a
   *  hardcoded route skeleton literal, or a client-computed state-table value,
   *  with no operator anywhere in the chain. A cross-cutting audit put the reach
   *  of that mis-attribution at 1,757 of 4,016 jurisdictions.
   *
   *  It keeps its PRECEDENCE (a project that states its edition still wins over a
   *  state default) because demoting it would change WHICH edition is chosen —
   *  a behaviour change, not a provenance fix. What it loses is the false claim
   *  that an operator said it. */
  | 'project-record-unprovenanced'
  /** A.4 — TWO OR MORE GOVERNED ADOPTION AUTHORITIES DISAGREE. Distinct from
   *  `unknown`, which claims we have nothing. Reporting a contradiction as
   *  "unknown" is a lie of omission: it sends the operator to obtain evidence
   *  they already hold two conflicting copies of. `edition` stays null — no
   *  source is preferred by recency, rank, mailing city or engine default. */
  | 'conflicting-adoption-authorities'
  /** NATIONWIDE ADOPTION BASELINE (2026-08-27). The state-level NEC adoption
   *  table (lib/jurisdictions/necVersions.ts, NFPA state adoption tracker, 51
   *  jurisdictions, with the city/county overrides the table itself carries).
   *
   *  WHY THIS TIER EXISTS. A.4 correctly stopped the curated table from being
   *  published as the AHJ's own ordinance — but it left `edition` null whenever a
   *  LIVE registry retrieval was unavailable, which is almost always. Every
   *  planset in the country therefore printed "NEC PENDING", and closing that
   *  required a phone call per jurisdiction. That does not scale to a national
   *  product, and it is not more honest: the electrical analysis is performed
   *  against specific NEC rules, so printing no edition at all misrepresents the
   *  basis the calculations actually used.
   *
   *  WHAT THIS TIER CLAIMS. Exactly what it is: the edition adopted at STATE
   *  level, named as such on the sheet, ranked BELOW a governed retrieval and
   *  below an archived adoption document, and never `verified`. It is a stated,
   *  checkable design basis a plan reviewer can correct — which is how permit
   *  sets normally declare their code basis — not an assertion about a specific
   *  AHJ's ordinance. A local amendment supersedes it, and the sheet says so. */
  | 'state-adoption-table'
  /** The code family has no adoption source we can resolve, but the design does
   *  not depend on its edition (IBC/IRC/IFC are cited as applicable codes; the
   *  structural basis is ASCE, which is stated separately). The sheet names the
   *  standard and defers the edition to the AHJ instead of printing PENDING. */
  | 'edition-per-ahj-adoption'
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
  // ── A.4 — NON-AUTHORITATIVE FALLBACK METADATA ────────────────────────────
  // The bundled ahj-national table carries an NEC year for many jurisdictions.
  // It is a curated convenience with no ordinance, no source URL and no hash,
  // and it USED TO POPULATE `edition` with `source: 'ahj-record'` — i.e. it was
  // presented as the AHJ's adopted edition. On Braidon that printed "NEC 2020",
  // a year NEITHER governed source for Madison County supports (the codified
  // ordinance says 2005; the county code official's state filing says 2023).
  //
  // Static data may inform, never adopt. It lives here, clearly separated, and
  // is NEVER promoted into `edition`.
  /** the bundled/static year, when one exists. Informational only. */
  fallbackEdition?: string | null;
  /** where the fallback came from, so it can never be mistaken for authority. */
  fallbackSource?: string | null;
  /** A.4 — every governed adoption authority seen for this family when they
   *  DISAGREE. Present only alongside `source:'conflicting-adoption-authorities'`;
   *  the reviewer sees both claims rather than a silently chosen winner. */
  conflictingClaims?: Array<{ edition: string; authority: string; ref: string | null }>;
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
  /** KDP WS-12 — HOW the record was bound + whether the site is inside an
   *  incorporated municipality. Recorded so a jurisdiction binding is auditable
   *  instead of an unexplained name on a title block, and so a change of
   *  precedence (county-first → municipal-first) leaves evidence. */
  ahjMatchMethod: AhjMatchMethod;
  incorporatedMunicipality: boolean | null;
  supersededAhjRecordId: string | null;
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

// D13 — the ASCE normalizer lives in `asceAuthority` with the decision it serves.
// An identical copy sat here, which is how one edition came to be normalized in
// two places and reported under two provenances.
import { normalizeAsce as normalizeAsceEdition } from './asceAuthority';

/** KDP WS-12 — how the bound AHJ record was reached, for the authority trace. */
export type AhjMatchMethod =
  | 'explicit-record-id'
  | 'stored-ahj-name'
  | 'incorporated-city'
  | 'county-unincorporated'
  | 'address-parse'
  /** The boundary layer DID resolve and named a governing government, and
   *  SolarPro holds no row for it. Distinct from 'unresolved', which means the
   *  geography itself is unknown. This one is a known jurisdiction and a known
   *  registry gap — the case the national registry is mostly in, holding ~4,000
   *  rows against ~19,500 municipalities. It terminates resolution: see
   *  resolveAhjRecordTraced. */
  | 'boundary-established-record-missing'
  | 'unresolved';

export interface AhjResolution {
  record: AhjRecord | null;
  matchMethod: AhjMatchMethod;
  /** true when the site sits inside an incorporated municipality that has its
   *  own AHJ record; false when the county (unincorporated) record governs. */
  incorporated: boolean | null;
  /** the alternative record the previous precedence would have chosen, when it
   *  differs — recorded so a binding change is auditable rather than silent. */
  supersededRecordId: string | null;
  /** With 'boundary-established-record-missing': the government the boundary
   *  determination named, which SolarPro has no row for. Carrying the name is
   *  the point — it is what turns a dead end into an actionable gap ("we need a
   *  record for X") and what the discovery path is given to work from. Null in
   *  every other outcome. */
  missingAuthorityFor: string | null;
  /** A stored `ahjRecordId` that was REFUSED because it names a record in a
   *  different state than the project. Recorded rather than dropped, so the
   *  rejection is auditable — a stale id is usually a symptom (a copied project,
   *  a bad import) and silently ignoring it hides that. */
  rejectedRecordId: string | null;
}

/**
 * Resolve the best available AhjRecord from the identity the project ALREADY
 * carries. Returns null when no local AHJ can be confidently localized — NEVER
 * a "first record in the state" guess.
 *
 * KDP WS-12 — PRECEDENCE IS MOST-SPECIFIC-FIRST, and it changed:
 *
 *   explicit record id → the AHJ NAME the project already stored →
 *   incorporated city → address parse → county (unincorporated)
 *
 * County used to run second, ahead of every city and ahead of the stored name.
 * On the live Braidon project that bound `il-madison-county` / "Madison County
 * Building & Zoning" to a site at 3 Melvin Dr, GRANITE CITY — while the SAME
 * input already carried `project.ahjName = "City of Granite City Building &
 * Zoning"`, `compliance.jurisdiction.ahj` with the same value, and a dataset row
 * `il-madison-granite-city`. Three independent copies of the right answer, and
 * the snapshot printed the wrong permit office.
 *
 * The county record is still exactly right for unincorporated territory, which
 * is what it describes (`city: 'Unincorporated'`), so it remains the fallback.
 */
export function resolveAhjRecordTraced(hints: {
  ahjRecordId?: string | null;
  ahjName?: string | null;
  stateCode?: string | null;
  county?: string | null;
  city?: string | null;
  address?: string | null;
  /** KDP WS-12 — the OFFICIAL municipal-boundary determination, when the resolver
   *  chain produced one. A postal city is not a jurisdiction: "GRANITE CITY, IL"
   *  is a mailing address that can sit in unincorporated Madison County. So when
   *  a boundary layer HAS been resolved it governs record selection outright —
   *  unincorporated ⇒ the county record, inside place P ⇒ P's municipal record —
   *  and the stored name / postal city may not override it. This is the same fact
   *  projectLegalAuthority already reconciles after the fact; feeding it in means
   *  the record is DERIVED from the evidence instead of being audited against it. */
  boundary?: {
    resolved: boolean;
    unincorporated: boolean | null;
    incorporatedPlace: string | null;
  } | null;
}): AhjResolution {
  const state = hints.stateCode ?? null;
  const b = hints.boundary;
  if (b?.resolved && state) {
    // Official determination present — it decides, and the trace says so.
    const _legacyB = (hints.county ? getAhjByCounty(state, hints.county) : null)?.id ?? null;
    const finish = (record: AhjRecord | null, method: AhjMatchMethod, inc: boolean | null): AhjResolution => ({
      record, matchMethod: method, incorporated: inc,
      supersededRecordId: record && _legacyB && _legacyB !== record.id ? _legacyB : null,
      missingAuthorityFor: null,
      rejectedRecordId: null,
    });
    // A KNOWN JURISDICTION WE HAVE NO ROW FOR IS A GAP, NOT A REASON TO GUESS.
    //
    // These two branches used to fall through to the hint chain when the
    // registry had no row for the government the boundary named. The hint chain
    // then tried, in order: the stored ahjName (which the permit route had
    // force-written from the mailing city), the postal city, the address parse,
    // and finally getAhjByCounty — so a parcel PROVEN to sit inside an
    // incorporated municipality was bound to the COUNTY's building department.
    // Wrong permit office, wrong fee schedule, wrong plan-check queue, on a
    // package whose geography had been resolved correctly.
    //
    // That fall-through is the whole national failure mode: SolarPro holds
    // ~4,000 rows against ~19,500 municipalities, so "the boundary resolved and
    // we have no record" is the ORDINARY case outside the covered cities, and
    // it was silently answered with a neighbouring government.
    //
    // Resolution now STOPS here, carrying the name of the authority we are
    // missing. Nothing downstream is asked to guess, and the gap is nameable.
    const missing = (name: string | null, inc: boolean | null): AhjResolution => ({
      record: null,
      matchMethod: 'boundary-established-record-missing',
      incorporated: inc,
      supersededRecordId: null,
      missingAuthorityFor: name,
      rejectedRecordId: null,
    });
    if (b.unincorporated === true) {
      const byCounty = hints.county ? getAhjByCounty(state, hints.county) : null;
      if (byCounty) return finish(byCounty, 'county-unincorporated', false);
      // Positively outside every municipality, and no county row: the COUNTY is
      // the authority and it is the one we are missing. Falling through would
      // reach getAhjByCity on the postal city and bind a municipality that has
      // been PROVEN not to contain this parcel.
      if (hints.county) return missing(`${hints.county} County, ${state}`, false);
    } else if (b.unincorporated === false && b.incorporatedPlace) {
      // Use the OFFICIAL place name, not the postal city line.
      const byPlace = getAhjByCity(state, b.incorporatedPlace);
      if (byPlace) return finish(byPlace, 'incorporated-city', true);
      return missing(`${b.incorporatedPlace}, ${state}`, true);
    }
    // Boundary resolved but it named no government we can act on (no place and
    // no county) — that is genuinely unknown geography, so the hint chain below
    // still applies.
  }
  // What the pre-WS-12 precedence would have chosen, for the audit trail.
  const _legacy = (state && hints.county ? getAhjByCounty(state, hints.county) : null)?.id ?? null;
  let _rejectedRecordId: string | null = null;
  const done = (record: AhjRecord | null, matchMethod: AhjMatchMethod): AhjResolution => ({
    record,
    matchMethod,
    incorporated: record ? (record.ahjType !== 'county' && record.city.toLowerCase() !== 'unincorporated') : null,
    supersededRecordId: record && _legacy && _legacy !== record.id ? _legacy : null,
    missingAuthorityFor: null,
    rejectedRecordId: _rejectedRecordId,
  });

  // A STORED RECORD ID IS ONLY EXPLICIT ABOUT THE RECORD, NOT ABOUT THE PROJECT.
  //
  // This bound whatever the id pointed at, with no check that the record is even
  // in the project's state. An Illinois project carrying a stale
  // 'ca-los-angeles-la' — a copied project, a bad import, an id left behind by an
  // earlier resolution — bound City of Los Angeles LADBS and labelled it
  // 'explicit-record-id', the highest-confidence method in this function. Every
  // other branch here is state-scoped; this one was not.
  //
  // Geography is the better evidence when the two disagree, so the stale id is
  // refused and the chain continues. It is carried on the result rather than
  // dropped, because a cross-state id is usually a symptom worth surfacing.
  if (hints.ahjRecordId) {
    const byId = getAhjById(hints.ahjRecordId);
    if (byId) {
      const stateAgrees = !state || !byId.stateCode
        || byId.stateCode.toUpperCase() === state.toUpperCase();
      if (stateAgrees) return done(byId, 'explicit-record-id');
      _rejectedRecordId = byId.id;
    }
  }
  // The stored AHJ NAME is an already-resolved server enrichment — the app wrote
  // it from this same dataset. Honour it before re-deriving from geography.
  if (hints.ahjName && state) {
    const target = hints.ahjName.trim().toLowerCase();
    const byName = getAhjsByState(state).find(a => a.ahjName.trim().toLowerCase() === target);
    if (byName) return done(byName, 'stored-ahj-name');
  }
  // Incorporated municipality — jurisdiction inside its own corporate limits.
  const city = hints.city ?? cityFromAddress(hints.address);
  if (state && city) {
    const byCity = getAhjByCity(state, city);
    if (byCity) return done(byCity, 'incorporated-city');
  }
  if (hints.address) {
    const byAddr = getAhjByAddress(hints.address, {
      stateCode: state ?? undefined,
      county: hints.county ?? undefined,
      city: hints.city ?? undefined,
    });
    if (byAddr) {
      return done(byAddr, byAddr.ahjType === 'county' || byAddr.city.toLowerCase() === 'unincorporated'
        ? 'county-unincorporated' : 'address-parse');
    }
  }
  // Unincorporated fallback — the county record describes exactly this case.
  if (state && hints.county) {
    const byCounty = getAhjByCounty(state, hints.county);
    if (byCounty) return done(byCounty, 'county-unincorporated');
  }
  return done(null, 'unresolved');
}

/** Back-compat surface: the record only. */
export function resolveAhjRecord(hints: Parameters<typeof resolveAhjRecordTraced>[0]): AhjRecord | null {
  return resolveAhjRecordTraced(hints).record;
}

export interface CodeAuthorityBuildArgs {
  /** the AHJ record resolved for the project (or null when unlocalized). */
  ahjRecord: AhjRecord | null;
  /** the server-enriched NEC edition carried on compliance.jurisdiction — the
   *  best-available adoption value, itself derived from the AHJ record. */
  necVersionEnriched?: string | null;
  /** display AHJ name when no full record resolved. */
  ahjNameHint?: string | null;
  /** KDP WS-12 — the traced resolution that produced `ahjRecord`, so the record
   *  carries HOW it was bound (and what the previous precedence would have
   *  picked) rather than just the resulting name. */
  ahjResolution?: AhjResolution | null;
  stateCodeHint?: string | null;
  /** the ASCE edition the STRUCTURAL ENGINE actually ran its calculations under
   *  (structural.env.codeAuthority.asceEdition). This is a computational BASIS,
   *  not a claim of AHJ adoption — sourced as 'structural-engine-basis'. */
  asceEngineBasis?: string | null;
  /** D6 — the UPSTREAM authority's own account of where `asceEngineBasis` came
   *  from (resolveAsceEditionAuthority: engine-default vs environmental-retrieval
   *  vs archived-hazard-document). Carried so the downstream note cannot state a
   *  STRONGER claim than the authority made — a compiled-in default used to
   *  arrive on the sheets described as something the engine "computed under". */
  asceBasisProvenance?: { source: string; ref: string | null; note: string } | null;
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

  // ── NEC — A.4: ONLY A GOVERNED RETRIEVAL ADOPTS ────────────────────────────
  // This used to read `necRetrieved ?? necFromRecord ?? necFromEnriched` and
  // stamp the result `source: 'ahj-record'`, so the bundled ahj-national year
  // was published as the jurisdiction's ADOPTED edition. Braidon printed
  // "NEC 2020" on that basis — a year neither governed Madison County source
  // supports (codified ordinance: 2005; the county code official's state filing:
  // 2023). Static data is now carried as fallback METADATA and can never adopt.
  const necRetrieved = normalizeNecEdition(adoptFor('nec'));
  const necFromRecord = normalizeNecEdition(rec?.necVersion);
  const necFromEnriched = normalizeNecEdition(args.necVersionEnriched);
  const necFallback = necFromRecord ?? necFromEnriched;
  const necFallbackSource = necFromRecord
    ? (rec ? `ahj-national:${rec.id}` : 'ahj-national')
    : necFromEnriched ? 'compliance.jurisdiction.necVersion' : null;

  // ── NATIONWIDE ADOPTION BASELINE ──────────────────────────────────────────
  // The state adoption table, consulted ONLY when no governed retrieval adopted.
  // getJurisdiction applies the table's own city → county → state precedence, so
  // Chicago correctly resolves 2017 inside an otherwise-2020 Illinois.
  const _stateJur = rec?.stateCode
    ? getJurisdiction(rec.stateCode, rec.county ?? undefined, rec.city ?? undefined)
    : null;
  const necFromStateTable = normalizeNecEdition(_stateJur?.necVersion);

  // Precedence: governed retrieval > explicit operator entry > state adoption > nothing.
  // An operator who states the edition for THIS jurisdiction is supplying better evidence than a
  // state default, so `necVersionEnriched` is promoted from fallback metadata to a real (still
  // unverified) source. A.4's concern was the CURATED PER-AHJ table being published as the AHJ's
  // ordinance — that table is still fallback-only and still never adopts.
  // ── PRECEDENCE, AND WHY THE ENRICHED VALUE NO LONGER OUTRANKS THE STATE ──
  // It used to be: retrieval > enriched > state table, on the reasoning that "an
  // operator who states the edition for THIS jurisdiction is supplying better
  // evidence than a state default". That reasoning is sound — for an actual
  // operator. But nothing in the chain establishes that an operator supplied it:
  // the value arrives on `compliance.jurisdiction.necVersion`, which the permit
  // route itself used to populate with a hardcoded '2020' skeleton literal. So
  // the branch promoted a DEFAULT above a published state adoption and then
  // described it as operator testimony.
  //
  // An anonymous project field is not better evidence than a state's published
  // adoption, so the state table now wins and the enriched value is used only
  // when there is nothing else — carried honestly as unprovenanced.
  // PRECEDENCE IS UNCHANGED. Only the ATTRIBUTION is corrected.
  //
  // An earlier attempt at this fix also demoted the enriched value below the
  // state table, reasoning that an anonymous project field is not better
  // evidence than a published state adoption. That is true of an anonymous
  // field — but it would also stop a project that legitimately knows its local
  // edition from stating it, which is a behaviour change rather than a
  // provenance correction, and it broke a test that sets the edition
  // deliberately. Containment must not quietly redesign precedence.
  //
  // So the value still wins where it always did. What changed is that it is no
  // longer described as something an operator said.
  const nec = necRetrieved ?? necFromEnriched ?? necFromStateTable ?? null;
  const necSource: CodeEditionSource = necRetrieved
    ? 'ahj-registry-retrieval'
    : necFromEnriched ? 'project-record-unprovenanced'
      : necFromStateTable ? 'state-adoption-table'
        : adoptConflicted ? 'conflicting-adoption-authorities' : 'unknown';
  const necRef = necRetrieved
    ? `${adopt!.sourcesQueried[0] ?? 'ahj-registry'}#${adopt!.sourceHash.slice(0, 16)}`
    : undefined;

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
  // A.4 — surface BOTH claims when governed authorities disagree, so the sheet
  // and the operator see the contradiction instead of a silently chosen winner.
  const conflictingClaimsFor = (k: CodeEditionKind) =>
    (args.codeAdoption?.conflicts ?? [])
      .filter(c => (c as { kind?: string }).kind === k)
      .map(c => {
        const x = c as unknown as Record<string, unknown>;
        return {
          edition: String(x.edition ?? x.value ?? ''),
          authority: String(x.authority ?? x.source ?? x.sourceName ?? 'unnamed authority'),
          ref: (x.ref ?? x.sourceUrl ?? null) as string | null,
        };
      })
      .filter(c => c.edition);

  // NATIONWIDE BASELINE — there is no state adoption table for the I-codes, and one must NOT be
  // invented. But an unresolved I-code edition is not a defect that should stop a package:
  // IBC/IRC/IFC are cited here as the applicable code FAMILIES, while the analysis basis that
  // actually drives numbers (ASCE) is resolved and stated separately. So the sheet names the
  // standard and DEFERS the edition to the AHJ — "IBC — EDITION PER AHJ ADOPTION" — instead of the
  // bare "IBC PENDING" that reads like missing work. The edition stays null: this is a LABELLING
  // change, never an inference.
  const perAhjProv: Provenance = {
    source: 'code-authority',
    note: 'no resolvable adoption source for this code family. The standard applies; its EDITION is '
      + 'whatever the AHJ has adopted, confirmed at plan review. No design value depends on it — the '
      + 'structural analysis basis (ASCE) is resolved and stated separately.',
  };
  const kindEdition = (k: CodeEditionKind): CodeEdition => {
    const v = adoptFor(k);
    if (v) return edition(k, v, 'ahj-registry-retrieval', retrievedProv(k));
    // A.4 — a contradiction is NOT an absence. `unknown` would tell the operator
    // to go obtain evidence they already hold two conflicting copies of.
    return adoptConflicted
      ? { ...edition(k, null, 'conflicting-adoption-authorities', unknownProv),
          conflictingClaims: conflictingClaimsFor(k) }
      : edition(k, null, 'edition-per-ahj-adoption', perAhjProv);
  };

  // ── ASCE — D13 ─────────────────────────────────────────────────────────────
  // A RETRIEVED adoption wins, exactly as it does for NEC/IBC/IRC/IFC. This
  // record previously never called `adoptFor('asce')` at all: it overwrote the
  // retrieval with the engine basis unconditionally, so a hashed AHJ adoption
  // fact for a code family the registry CAN carry was structurally unreachable —
  // the same discarded-authority shape as D4's dropped patch key.
  //
  // With no adoption, the engine basis is reported and LABELLED as a
  // computational basis. It is not an adoption claim and never says it is.
  const asceAdopted = normalizeAsceEdition(adoptFor('asce'));
  const asceBasis = normalizeAsceEdition(args.asceEngineBasis);
  const asce = asceAdopted ?? asceBasis;
  const asceSource: CodeEditionSource = asceAdopted
    ? 'ahj-registry-retrieval'
    : asceBasis ? 'structural-engine-basis' : 'unknown';

  const editions: Record<CodeEditionKind, CodeEdition> = {
    nec: {
      ...edition('nec', nec, necSource, necRetrieved
        ? {
            source: 'ahj-registry-retrieval',
            ref: necRef,
            note: `adopted NEC edition retrieved from ${adopt!.ahjName} at ${adopt!.retrievedAtIso}`
              + `${adopt!.editions.find(e => e.kind === 'nec')?.corroboratedBy ? ` — corroborated by ${adopt!.editions.find(e => e.kind === 'nec')!.corroboratedBy}` : ''}`,
          }
        : necFromEnriched
          ? {
              source: 'project-record-unprovenanced',
              note: `NEC ${necFromEnriched} is carried on the project record with NO evidence of who established it. It is NOT an operator attestation and NOT a reading of an adoption ordinance` 
                + '; it is used only because no state adoption resolved. Confirm at plan review.',
            }
        : necFromStateTable
          ? {
              source: 'state-adoption-table',
              ref: `necVersions:${rec?.stateCode ?? '??'}`,
              note: `NEC ${necFromStateTable} is the edition adopted at STATE level for `
                + `${_stateJur?.stateName ?? rec?.stateCode ?? 'this state'} (NFPA state adoption tracker). `
                + 'It is the stated design basis, NOT a verified reading of the local ordinance: a local '
                + 'amendment supersedes it. Verify with the AHJ at plan review.'
                + (adoptConflicted
                  ? ' ⚠ GOVERNED SOURCES FOR THIS AHJ DISAGREE — both claims are carried in conflictingClaims '
                    + 'and must be resolved before the local edition can be treated as established.'
                  : ''),
            }
          : adoptConflicted
            ? unknownProv
            : {
                source: 'code-authority',
                note: necFallback
                  ? `no governed NEC adoption is established for this jurisdiction. A bundled/static year (${necFallback}) `
                    + 'is carried as NON-AUTHORITATIVE fallback metadata only and is NOT the adopted edition.'
                  : 'no AHJ adoption authority for the NEC — edition left null (no inference)',
              }),
      fallbackEdition: necFallback,
      fallbackSource: necFallbackSource,
      ...(adoptConflicted ? { conflictingClaims: conflictingClaimsFor('nec') } : {}),
    },
    ibc: kindEdition('ibc'),
    irc: kindEdition('irc'),
    ifc: kindEdition('ifc'),
    // PHASE A.2 / D6 — the note must not STRENGTHEN in transit. It was a hardcoded
    // literal saying the engine "computed under" this edition, printed no matter
    // where the edition actually came from — so `engine-default` (a compiled-in
    // constant, honestly labelled upstream as a default) arrived on the sheets as
    // a computation. The upstream authority already states its own basis; carry
    // it rather than re-asserting a stronger one.
    asce: edition('asce', asce, asceSource, asceAdopted
      ? retrievedProv('asce')
      : asceBasis
        ? {
            source: args.asceBasisProvenance?.source ?? 'structural-engine',
            ref: args.asceBasisProvenance?.ref ?? 'structural.env.codeAuthority',
            note: args.asceBasisProvenance?.note
              ?? 'ASCE edition the structural engine computed under — engine basis, not an AHJ adoption claim',
          }
        : unknownProv),
  };

  // NATIONWIDE BASELINE — "incomplete" now means an edition we NEEDED and could not resolve, not
  // merely a null. An I-code family carrying `edition-per-ahj-adoption` is a DEFERRED edition: the
  // standard is cited, no design value depends on the year, and the AHJ confirms it at plan review.
  // Counting those as incomplete is what held every package in the country at "incomplete" forever.
  const incompleteEditions = CODE_EDITION_KINDS.filter(
    k => editions[k].edition == null && editions[k].source !== 'edition-per-ahj-adoption');
  /** Families whose edition is deliberately deferred to the AHJ (not a gap). */
  const deferredEditions = CODE_EDITION_KINDS.filter(
    k => editions[k].edition == null && editions[k].source === 'edition-per-ahj-adoption');

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
  // A NAMED GAP, NOT A DEAD END.
  //
  // When the boundary layer established which government has jurisdiction and
  // SolarPro simply holds no row for it, that is a different — and far more
  // actionable — state than "we could not localize this project". Say which
  // authority is missing, and say plainly that nothing was substituted for it,
  // so a reviewer reads a registry gap rather than an unexplained blank.
  const _missingFor = args.ahjResolution?.matchMethod === 'boundary-established-record-missing'
    ? args.ahjResolution.missingAuthorityFor
    : null;
  if (_missingFor) {
    applicabilityNotes.push(
      `The municipal-boundary layer places this parcel under ${_missingFor}. SolarPro holds no AHJ record `
      + 'for that authority, so its adopted codes, setbacks, fees and plan-check times are UNKNOWN. No county, '
      + 'mailing city or neighbouring jurisdiction has been substituted — the permit authority must be '
      + 'established and added to the registry before this package is released.');
  } else if (!rec && !nec) {
    applicabilityNotes.push('No local AHJ could be resolved for this project — code adoption is unknown; generic state defaults are NOT applied.');
  }
  if (incompleteEditions.length > 0) {
    applicabilityNotes.push(
      `Adopted edition unknown for: ${incompleteEditions.map(k => k.toUpperCase()).join(', ')} — printed as PENDING; no edition inferred.`);
  }
  if (deferredEditions.length > 0) {
    applicabilityNotes.push(
      `${deferredEditions.map(k => k.toUpperCase()).join(', ')}: the standard applies; the adopted EDITION is `
      + 'confirmed by the AHJ at plan review. No design value depends on it.');
  }
  if (editions.nec.source === 'state-adoption-table') {
    applicabilityNotes.push(
      `NEC ${editions.nec.edition} is the STATE-level adoption for ${_stateJur?.stateName ?? rec?.stateCode ?? 'this state'} `
      + '(NFPA state adoption tracker) and is the stated design basis. It is NOT a verified reading of this '
      + 'AHJ’s ordinance — a local amendment supersedes it; confirm at plan review.');
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
    // The stored hint is NOT consulted once the boundary has established a
    // government we hold no record for. That hint is `compliance.jurisdiction.ahj
    // ?? project.ahjName` — a value the app wrote earlier, historically from a
    // mailing-city search — so falling back to it would put a DIFFERENT
    // government's name on the document immediately after the resolver correctly
    // refused to bind that government's record. The jurisdiction is named in the
    // applicability note above instead, where it reads as the gap it is.
    ahjName: adopt?.ahjName ?? rec?.ahjName ?? (_missingFor ? null : args.ahjNameHint) ?? null,
    jurisdictionType: adopt?.jurisdictionType ?? rec?.ahjType ?? 'unknown',
    stateCode: rec?.stateCode ?? args.stateCodeHint ?? null,
    stateName: rec?.stateName ?? null,
    county: rec?.county ?? null,
    city: rec?.city ?? null,
    ahjRecordId: rec?.id ?? null,
    ahjMatchMethod: args.ahjResolution?.matchMethod ?? (rec ? 'address-parse' : 'unresolved'),
    incorporatedMunicipality: args.ahjResolution?.incorporated
      ?? (rec ? (rec.ahjType !== 'county' && rec.city.toLowerCase() !== 'unincorporated') : null),
    supersededAhjRecordId: args.ahjResolution?.supersededRecordId ?? null,
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
