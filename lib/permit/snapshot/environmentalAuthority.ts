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

/** True IFF the evidence is a VERIFIED, archived, currency-reviewed climate-hazard
 *  source that covers wind + snow + exposure/risk for this project. Any missing
 *  input (no source, missing coverage, unarchived, stale/not-currency-reviewed,
 *  wrong applicability) ⇒ NOT verified (fail-closed). */
export function environmentalSourceVerified(
  e: EnvironmentalLoadSourceEvidence | null | undefined,
  projectOrAhj: string | null | undefined,
): boolean {
  if (!e) return false;
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
  const verified = environmentalSourceVerified(input.sourceEvidence, input.projectOrAhj);
  const e = input.sourceEvidence ?? null;

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
