// ═══════════════════════════════════════════════════════════════════════════
// ENVIRONMENTAL LOAD AUTHORITY (BAR §2, 2026-07-25) — the OBSERVATION-vs-VERIFIED
// split for wind / snow / exposure / risk, mirroring the framing-authority gate.
//
// Ray's ruling (docs/BLOCKER-AUTHORITY-RECONCILIATION-DIRECTIVE.md §2): an
// operator-entered / AHJ-typed design wind speed, exposure, risk category, or
// ground snow load is an OBSERVATION / OVERRIDE — it may drive the PRELIMINARY
// analysis but can NEVER be presented as VERIFIED design criteria without an
// archived provenance source (ASCE 7 Hazard-Tool report / AHJ climate ordinance)
// covering the exact project, whose currency has been reviewed. A generic code-
// minimum default is PRELIMINARY only.
//
// Pure — no DB. The DB/registry resolution (findVerifiedDocument for a climate-
// hazard source) lives in lib/documents; this module turns the resolved EVIDENCE
// into the canonical authority record + drives the single blocker
// ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED.
// ═══════════════════════════════════════════════════════════════════════════
import type {
  EnvironmentalLoadAuthority, EnvironmentalLoadBasis, EnvironmentalVerificationStatus,
  Provenance,
} from './types';
import type { EnvironmentalRetrievalRecord } from './resolution/environmentalRetrieval';

/** Evidence for the ARCHIVED-SOURCE path — the shape lib/documents projects from a
 *  resolved climate-hazard RegistryDocument. A verified record clears the blocker. */
export interface EnvironmentalLoadSourceEvidence {
  documentId: string;
  dataset: string | null;                  // e.g. 'ASCE 7 Hazard Tool', 'AHJ climate ordinance'
  versionOrDate: string | null;
  verificationState: string;               // must be 'verified'
  archivedInRepo: boolean;                 // must be true
  sha256: string | null;                   // must be present
  coversWindSpeed: boolean;
  coversSnowLoad: boolean;
  coversExposureRisk: boolean;
  /** Post-AAC seismic repair — the archived climate-hazard dataset MAY also
   *  carry the USGS seismic results (SDC / Ss / S1 at the queried site class).
   *  Optional and additive: the nine-condition wind/snow verification gate is
   *  UNCHANGED (seismic coverage never clears or blocks the environmental
   *  requirement); these fields only feed resolveSeismicAuthority so the ONE
   *  canonical seismic result can cite a verified archived source instead of a
   *  hardcoded default or an unprovenanced table row. */
  coversSeismic?: boolean;
  seismicSdc?: string | null;
  seismicSs?: number | null;
  seismicS1?: number | null;
  seismicSiteClass?: string | null;
  windSpeedMph: number | null;
  groundSnowPsf: number | null;
  exposureCategory: string | null;
  riskCategory: string | null;
  coordinates: { lat: number | null; lng: number | null } | null;
  addressUsed: string | null;
  projectApplicability: string | null;
  lookupTimestampIso: string | null;
  /** an explicit currency review — verification REQUIRES currency review because
   *  no automatic staleness rule exists for archived climate-hazard sources. A
   *  source whose recorded date is present but whose currency was never reviewed
   *  is treated as STALE ⇒ unverified (the recorded-date pathway). */
  currencyConfirmedAtIso: string | null;
}

export interface EnvironmentalLoadAuthorityInput {
  windSpeedMph: number | null;
  exposureCategory: string | null;
  riskCategory: string | null;
  groundSnowPsf: number | null;
  /** the operator / AHJ typed the value (vs a code-minimum default we substituted).
   *  Operator entry is an OBSERVATION/OVERRIDE — never verification. */
  windOperatorEntered: boolean;
  snowOperatorEntered: boolean;
  coordinates: { lat: number | null; lng: number | null } | null;
  addressUsed: string | null;
  projectOrAhj: string | null;
  /** async-resolved verified climate-hazard source (lib/documents). null ⇒ none
   *  archived ⇒ ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED fires (the honest live
   *  outcome). */
  sourceEvidence?: EnvironmentalLoadSourceEvidence | null;
  capturedAtIso: string | null;
  /** AAC WS-4 — the full retrieval record (query inputs, returned values,
   *  datasets, override history, archival state). Present ONLY when a live/fixture
   *  hazard retrieval produced the source evidence; a registry-document source
   *  leaves it null and the record is byte-identical to before. */
  retrievalRecord?: EnvironmentalRetrievalRecord | null;
}

const numOrNull = (n: number | null | undefined): number | null =>
  n == null || !isFinite(Number(n)) ? null : Number(n);
const strOrNull = (s: string | null | undefined): string | null => {
  const v = (s ?? '').toString().trim();
  return v && v.toLowerCase() !== 'unknown' ? v : null;
};

function applicabilityCovers(docApplic: string | null, key: string | null | undefined): boolean {
  if (!key) return !!docApplic;              // must at least carry explicit applicability
  if (!docApplic) return false;
  return docApplic.toLowerCase().includes(String(key).toLowerCase());
}

/**
 * AAC WS-4 — THE COORDINATE-INVALIDATION TOLERANCE, in degrees.
 *
 * A hazard authority is retrieved FOR A POINT. If the project's coordinates move
 * away from the point the source was retrieved at, the source no longer covers
 * the site and the authority is INVALIDATED — this is the directive's mandated
 * "a coordinate change invalidates the record".
 *
 * 0.001° ≈ 110 m at this latitude. The justification for a tolerance rather than
 * exact equality: the ASCE 7 hazard rasters are ~1 km cells and both the USGS
 * seismic and elevation services are point services on the same order, so a
 * sub-cell coordinate refinement (the aerial pipeline's house-centre correction)
 * cannot change the retrieved values. Anything larger is a different site.
 */
export const ENVIRONMENTAL_COORDINATE_TOLERANCE_DEG = 0.001;

/** Does an archived/retrieved source still cover THESE coordinates? Unknown on
 *  either side ⇒ the coordinate test is not applicable and applicability alone
 *  governs (the pre-AAC behaviour for documents that carry no coordinates). */
export function environmentalCoordinatesCover(
  evidence: { lat: number | null; lng: number | null } | null | undefined,
  project: { lat: number | null; lng: number | null } | null | undefined,
): boolean {
  const eLat = numOrNull(evidence?.lat), eLng = numOrNull(evidence?.lng);
  const pLat = numOrNull(project?.lat), pLng = numOrNull(project?.lng);
  if (eLat == null || eLng == null || pLat == null || pLng == null) return true;
  return Math.abs(eLat - pLat) <= ENVIRONMENTAL_COORDINATE_TOLERANCE_DEG
    && Math.abs(eLng - pLng) <= ENVIRONMENTAL_COORDINATE_TOLERANCE_DEG;
}

/** True IFF the evidence is a VERIFIED, archived, currency-reviewed climate-hazard
 *  source that covers wind + snow + exposure/risk for this project, AT THIS
 *  PROJECT'S COORDINATES. Any missing input (no source, missing coverage,
 *  unarchived, stale/not-currency-reviewed, wrong applicability, coordinates
 *  moved) ⇒ NOT verified (fail-closed). */
export function environmentalSourceVerified(
  e: EnvironmentalLoadSourceEvidence | null | undefined,
  projectOrAhj: string | null | undefined,
  projectCoordinates?: { lat: number | null; lng: number | null } | null,
): boolean {
  if (!e) return false;
  // AAC WS-4 — a source retrieved for a DIFFERENT point does not cover this
  // site. Omitting the argument keeps the pre-AAC behaviour exactly.
  if (projectCoordinates !== undefined && !environmentalCoordinatesCover(e.coordinates, projectCoordinates)) return false;
  return e.verificationState === 'verified'
    && e.archivedInRepo === true
    && !!e.sha256
    && e.coversWindSpeed === true
    && e.coversSnowLoad === true
    && e.coversExposureRisk === true
    && numOrNull(e.windSpeedMph) != null
    && numOrNull(e.groundSnowPsf) != null
    && applicabilityCovers(e.projectApplicability, projectOrAhj)
    // staleness: no automatic currency rule exists, so verification requires a
    // recorded currency review. A source with a date but no currency confirmation
    // is STALE ⇒ unverified.
    && !!e.currencyConfirmedAtIso;
}

// ═══════════════════════════════════════════════════════════════════════════
// Post-AAC seismic repair — THE canonical resolved seismic result.
//
// The B-vs-D contradiction had four independent sources of "the" SDC: the
// unprovenanced ahj-national table row (route fill — retired), the resolver's
// dead write to `seismicDesignCategory` (a field nothing read), the hardcoded
// `|| 'D'` canonical fallback, and the fixtures' compliance `'B'`. This
// function is now the ONE resolution: a live/fixture retrieval record wins,
// then a VERIFIED archived climate-hazard document that carries seismic
// claims. Anything else ⇒ NOT ESTABLISHED (the sheets print PENDING; nothing
// substitutes 'B' or 'D'). The environmental wind/snow verification gate is
// unchanged — this is a projection, not a new requirement.
// ═══════════════════════════════════════════════════════════════════════════
export interface SeismicAuthorityResult {
  established: boolean;
  sdc: string | null;
  ss: number | null;
  s1: number | null;
  siteClass: string | null;
  /** where the resolved value came from — 'hazard-retrieval' (the live/fixture
   *  USGS/ASCE run) or 'archived-climate-document' (verified registry doc). */
  source: 'hazard-retrieval' | 'archived-climate-document' | null;
  /** the citable evidence ref: retrieval source-hash or registry document id. */
  sourceRef: string | null;
  sha256: string | null;
}

export function resolveSeismicAuthority(args: {
  retrievalSeismic?: {
    seismicSdc: string | null; seismicSs: number | null; seismicS1: number | null;
    siteClass?: string | null; sourceHash?: string | null;
  } | null;
  sourceEvidence?: EnvironmentalLoadSourceEvidence | null;
}): SeismicAuthorityResult {
  const r = args.retrievalSeismic;
  if (r?.seismicSdc) {
    return {
      established: true, sdc: r.seismicSdc, ss: numOrNull(r.seismicSs), s1: numOrNull(r.seismicS1),
      siteClass: strOrNull(r.siteClass ?? null), source: 'hazard-retrieval',
      sourceRef: r.sourceHash ? `env-retrieval:${r.sourceHash.slice(0, 16)}` : 'env-retrieval',
      sha256: r.sourceHash ?? null,
    };
  }
  const e = args.sourceEvidence;
  // The archived path demands the SAME custody the wind/snow gate demands —
  // verified + archived + hashed — plus an actual seismic claim on the document.
  if (e && e.verificationState === 'verified' && e.archivedInRepo === true && !!e.sha256
      && e.coversSeismic === true && e.seismicSdc) {
    return {
      established: true, sdc: e.seismicSdc, ss: numOrNull(e.seismicSs ?? null), s1: numOrNull(e.seismicS1 ?? null),
      siteClass: strOrNull(e.seismicSiteClass ?? null), source: 'archived-climate-document',
      sourceRef: e.documentId, sha256: e.sha256,
    };
  }
  return { established: false, sdc: null, ss: null, s1: null, siteClass: null, source: null, sourceRef: null, sha256: null };
}

/** Per-field basis: verified source wins; else operator entry is an override; else
 *  a present value is a code-minimum default (preliminary); else unavailable. */
function basisFor(
  valuePresent: boolean, operatorEntered: boolean, verified: boolean,
): EnvironmentalLoadBasis {
  if (!valuePresent) return 'unavailable';
  if (verified) return 'verified-source';
  return operatorEntered ? 'operator-entered' : 'code-minimum-default';
}

/**
 * Build THE canonical environmental load authority (pure, testable without a DB).
 * The values ALWAYS populate (they drive the preliminary analysis); what changes
 * is their BASIS + the record's `verificationStatus`. Verified ONLY via a verified,
 * archived, currency-reviewed source covering wind+snow+exposure/risk for the
 * project — never from a bare operator entry or a code default.
 */
export function buildEnvironmentalLoadAuthority(
  input: EnvironmentalLoadAuthorityInput,
): EnvironmentalLoadAuthority {
  const wind = numOrNull(input.windSpeedMph);
  const snow = numOrNull(input.groundSnowPsf);
  const exposure = strOrNull(input.exposureCategory);
  const risk = strOrNull(input.riskCategory);
  // AAC WS-4 — the coordinate test is applied HERE (the record knows the
  // project's coordinates), so an archived/retrieved source whose point has
  // moved can no longer verify this project.
  const verified = environmentalSourceVerified(input.sourceEvidence, input.projectOrAhj, input.coordinates);
  const e = input.sourceEvidence ?? null;
  // The retrieval detail rides only when the source evidence it produced is the
  // one that VERIFIED the record — a retrieval that failed the gate must not
  // decorate an unverified record with retrieval fields.
  const r = verified ? (input.retrievalRecord ?? null) : null;

  const windSpeedBasis = basisFor(wind != null, input.windOperatorEntered, verified);
  const snowLoadBasis = basisFor(snow != null, input.snowOperatorEntered, verified);

  // operator overrides = every present field posted WITHOUT a verified source.
  const operatorOverrides: string[] = [];
  if (!verified) {
    if (wind != null && input.windOperatorEntered) operatorOverrides.push('ultimateWindSpeedMph');
    if (snow != null && input.snowOperatorEntered) operatorOverrides.push('groundSnowLoadPsf');
    if (exposure && input.windOperatorEntered) operatorOverrides.push('exposureCategory');
    if (risk && input.windOperatorEntered) operatorOverrides.push('riskCategory');
  }

  const anyValue = wind != null || snow != null || !!exposure || !!risk;
  const verificationStatus: EnvironmentalVerificationStatus =
    verified ? 'verified' : anyValue ? 'unverified' : 'unknown';

  const note = verified
    ? `verified + archived climate-hazard source (${e?.documentId}) covering ${e?.projectApplicability ?? 'the project'} — currency reviewed`
    : anyValue
      ? 'environmental design values are OPERATOR-ENTERED / code-minimum defaults — OBSERVATION/OVERRIDE only, NOT verified design criteria (no archived, currency-reviewed climate-hazard source). Values drive the PRELIMINARY analysis; a verified source is required before permit submission.'
      : 'no environmental design values and no verified source';

  return {
    ultimateWindSpeedMph: verified ? (numOrNull(e?.windSpeedMph) ?? wind) : wind,
    windSpeedBasis,
    riskCategory: verified ? (strOrNull(e?.riskCategory) ?? risk) : risk,
    exposureCategory: verified ? (strOrNull(e?.exposureCategory) ?? exposure) : exposure,
    groundSnowLoadPsf: verified ? (numOrNull(e?.groundSnowPsf) ?? snow) : snow,
    snowLoadBasis,
    snowLoadSource: verified ? (e?.dataset ?? e?.documentId ?? null) : null,
    coordinates: input.coordinates ?? (verified ? (e?.coordinates ?? null) : null),
    addressUsed: input.addressUsed ?? (verified ? (e?.addressUsed ?? null) : null),
    sourceDocumentId: verified ? (e?.documentId ?? null) : null,
    sourceDataset: verified ? (e?.dataset ?? null) : null,
    sourceVersionOrDate: verified ? (e?.versionOrDate ?? null) : null,
    lookupTimestampIso: verified ? (e?.lookupTimestampIso ?? null) : null,
    operatorOverrides,
    verificationStatus,
    projectOrAhj: strOrNull(input.projectOrAhj),
    evidenceRef: verified ? (e?.sha256 ? `${e?.documentId}#${e?.sha256.slice(0, 12)}` : (e?.documentId ?? null)) : null,
    provenance: { source: 'environmental-load authority gate (BAR §2)', note },
    // AAC WS-4 — the retrieval detail, ADDITIVE and omitted entirely when no
    // retrieval ran (canonicalJson drops undefined ⇒ digest unchanged).
    ...(r
      ? {
          sourceHash: r.sourceHash,
          confidence: r.confidence,
          queryInputs: r.queryInputs,
          returnedValues: r.returnedValues,
          overrideHistory: r.overrideHistory,
          currencyBasis: r.currencyBasis,
          retrievalProof: r.proof,
          archivedDocumentId: r.registryArchival.documentId,
        }
      : {}),
  } satisfies EnvironmentalLoadAuthority;
}

// ── render helpers (mirror observedFramingLine / observedSourceLabel) ──────────

/** Human basis label for one environmental value, e.g. "OPERATOR-ENTERED",
 *  "VERIFIED SOURCE", "CODE-MINIMUM DEFAULT". */
export function environmentalBasisLabel(basis: EnvironmentalLoadBasis): string {
  switch (basis) {
    case 'verified-source': return 'VERIFIED SOURCE';
    case 'operator-entered': return 'OPERATOR-ENTERED';
    case 'code-minimum-default': return 'CODE-MINIMUM DEFAULT';
    default: return 'NOT PROVIDED';
  }
}

/** §2 — the COMPACT state tag printed inline beside a wind/snow design value on a
 *  dense calculation sheet (PV-4C), where a full source row does not fit. Carries
 *  the same basis + verification truth as environmentalSourceLabel, shortened. */
export function environmentalStateTag(auth: EnvironmentalLoadAuthority | null | undefined): string {
  if (!auth || auth.verificationStatus === 'unknown') return 'NOT PROVIDED / NOT VERIFIED';
  if (auth.verificationStatus === 'verified') return 'VERIFIED SOURCE';
  return auth.windSpeedBasis === 'operator-entered' || auth.snowLoadBasis === 'operator-entered'
    ? 'OPERATOR-ENTERED / NOT VERIFIED'
    : 'CODE DEFAULT / NOT VERIFIED';
}

/** The provenance / verification line every sheet prints under the wind/snow
 *  design criteria — mirrors observedSourceLabel. e.g.
 *  "SOURCE: OPERATOR-ENTERED — NOT VERIFIED" or
 *  "SOURCE: ASCE 7 Hazard Tool (2022) — VERIFIED". */
export function environmentalSourceLabel(auth: EnvironmentalLoadAuthority | null | undefined): string {
  if (!auth || auth.verificationStatus === 'unknown') return 'SOURCE: NOT PROVIDED — NOT VERIFIED';
  if (auth.verificationStatus === 'verified') {
    const src = auth.sourceDataset ?? auth.sourceDocumentId ?? 'archived source';
    const ver = auth.sourceVersionOrDate ? ` (${auth.sourceVersionOrDate})` : '';
    return `SOURCE: ${src}${ver} — VERIFIED`;
  }
  // unverified: name the dominant basis (operator-entered wins over default).
  const basis = auth.windSpeedBasis === 'operator-entered' || auth.snowLoadBasis === 'operator-entered'
    ? 'OPERATOR-ENTERED'
    : 'CODE-MINIMUM DEFAULT';
  return `SOURCE: ${basis} — NOT VERIFIED`;
}
