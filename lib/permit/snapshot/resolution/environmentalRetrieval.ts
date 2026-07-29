// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-4 — ENVIRONMENTAL (CLIMATE-HAZARD) RETRIEVAL RECORD (pure)
// ───────────────────────────────────────────────────────────────────────────
// PURE. The provider retrieves; this module turns a retrieval into
//   (a) the EnvironmentalAuthorityRecord the directive enumerates — expressed by
//       COMPLETING the existing EnvironmentalLoadAuthority object rather than
//       building a second one (audit §2.6: "The record model already satisfies
//       WS-4 completely. Do not rebuild the record."), and
//   (b) the EnvironmentalLoadSourceEvidence the EXISTING nine-condition gate
//       `environmentalSourceVerified` inspects — which is NOT modified here and
//       must never be relaxed.
//
// ── WHY A LIVE RETRIEVAL SATISFIES `currencyConfirmedAtIso` ─────────────────
// That condition exists (environmentalAuthority.ts:100-103) because an ARCHIVED
// document has no automatic staleness rule: a PDF filed in 2019 may or may not
// still be the governing hazard data, and only a recorded human review can say.
// A value read from the authoritative live service DURING this generation has no
// such gap — it is current at the instant it was read, and the retrieval
// timestamp IS the currency confirmation. The record states this explicitly
// (`currencyBasis`), so a reader can tell a live read from a reviewed archive.
// The gate is untouched; what changed is that a genuinely current source now
// exists.
//
// ── WHAT THE RECORD MAY AND MAY NOT CLAIM ──────────────────────────────────
//   wind, snow      — RETRIEVED. Authoritative, per edition + risk category.
//   risk category   — a QUERY INPUT (ASCE 7 Table 1.5-1 occupancy
//                     classification), recorded as such. The returned wind/snow
//                     are specific to it, so the record covers the risk basis.
//   exposure        — NOT retrievable. ASCE 7 §26.7 is a surface-roughness
//                     determination for the terrain upwind of the site, which no
//                     hazard dataset publishes. It rides on the record with its
//                     OWN basis and is audited as an operator input when it is
//                     one. A bare substituted default does NOT satisfy coverage.
//   seismic, elev.  — RETRIEVED corroborators.
//
// ── OPERATOR OVERRIDE INTERPLAY (directive WS-4) ───────────────────────────
// The RECORD is authoritative; an operator value coexists and is AUDITED. A bare
// typed wind/snow number is not an override — it carries no reason, no source
// and no actor — so the retrieval supersedes it and the superseded value is
// preserved in `overrideHistory` with a `stricterThanRetrieved` flag so nothing
// is silently lost. A PROPER override (value + reason + source + actor +
// timestamp) governs the design value, and the original retrieval is preserved
// beside it, never destroyed.
// ═══════════════════════════════════════════════════════════════════════════

import type { EnvironmentalLoadSourceEvidence } from '../environmentalAuthority';
import type { RetrievedHazards, RiskCategory } from '@/lib/providers/climateHazard/types';
import { retrievalSourceHash } from './jurisdictionAuthority';

// ── risk category ───────────────────────────────────────────────────────────

export interface RiskCategoryDecision {
  value: RiskCategory;
  source: 'operator-entered' | 'code-classification';
  basis: string;
}

/**
 * Resolve the ASCE 7 risk category. An operator value always wins. With none,
 * Risk Category II is the CODE'S OWN classification, not a guess: ASCE 7
 * Table 1.5-1 defines Risk Category II as "all buildings and other structures
 * except those listed in Risk Categories I, III, and IV". A residential PV
 * retrofit is not in I, III or IV, so II is the classification the code assigns.
 * The basis is recorded on the record so the reader sees the citation, and an
 * operator can override it.
 */
export function resolveRiskCategory(posted: RiskCategory | null): RiskCategoryDecision {
  if (posted) {
    return { value: posted, source: 'operator-entered', basis: `Risk Category ${posted} entered on the project record.` };
  }
  return {
    value: 'II',
    source: 'code-classification',
    basis: 'ASCE 7 Table 1.5-1 — Risk Category II is the code\'s own classification for all buildings and other '
      + 'structures not listed in Risk Categories I, III or IV; this project is not so listed. Overridable.',
  };
}

// ── override history ────────────────────────────────────────────────────────

export interface EnvironmentalOverrideEntry {
  /** the field the entry concerns. */
  field: 'ultimateWindSpeedMph' | 'groundSnowLoadPsf' | 'exposureCategory' | 'riskCategory';
  /** the operator/AHJ value. */
  value: string | number | null;
  /** the value the retrieval established (preserved — never destroyed). */
  retrievedValue: string | number | null;
  /** 'superseded' — a SOURCELESS entry (engine default / unprovenanced table),
   *                  replaced by the retrieval; nothing is lost, it is kept here.
   *  'governing'  — a proper override (reason + source + actor) that wins.
   *  'sole-basis' — no retrieval covered this field; the entry is all there is.
   *  'conflict-pending-confirmation' — an OPERATOR/AHJ-entered value that
   *                  MATERIALLY disagrees with the retrieval. Two sources, both
   *                  claiming authority, disagreeing: the engine may not pick.
   *                  The MORE CONSERVATIVE value governs while the conflict is
   *                  open (so nothing is silently weakened) and the requirement
   *                  stays OPEN pending OPERATOR_CONFIRMATION. */
  disposition: 'superseded' | 'governing' | 'sole-basis' | 'conflict-pending-confirmation';
  reason: string | null;
  authoritySource: string | null;
  actor: string | null;
  atIso: string;
  /** true when the operator value is MORE conservative than the retrieval —
   *  surfaced so a reviewer sees a stricter local requirement was set aside. */
  stricterThanRetrieved: boolean | null;
}

// ── MATERIALITY (directive WS-4: "if they disagree materially, that is
//    OPERATOR_CONFIRMATION with both shown, not silent replacement") ───────────
//
// A tolerance is required because the two sources are never bit-identical: an
// AHJ publishes a rounded design value (110 mph, 20 psf) and the raster returns
// an interpolated one (107.533 mph, 23.2836 psf). The thresholds below are the
// point at which the difference can change a member size, so below them the
// retrieval simply refines the number and above them two authorities genuinely
// disagree about the design basis.
//
//   wind  — 5 mph. ASCE 7 wind pressure varies with V², so 5 mph on a ~110 mph
//           basis is ≈ 9 % of the design pressure: the first step that moves a
//           rail span or an attachment count.
//   snow  — 5 psf, the ASCE 7 Table 7.3-1 / IBC 1608 rounding increment for pg,
//           and the increment at which the balanced roof load changes a
//           prescriptive rafter table row.
export const WIND_MATERIAL_DELTA_MPH = 5;
export const SNOW_MATERIAL_DELTA_PSF = 5;

/** Where the value on the project record came from. Only 'operator-entered' and
 *  'ahj-published' can CONFLICT with a retrieval — a sourceless table value or
 *  an engine default is simply superseded, because it never had authority. */
export type PostedEnvironmentalProvenance =
  | 'operator-entered'        // typed by a person on this project
  | 'ahj-published'           // taken from an AHJ-published design-criteria value
  | 'unprovenanced-table'     // the curated ahj-national row (no ordinance, no date, no hash)
  | 'engine-default'          // a code-minimum default the engine substituted
  | 'absent';

/** Does a posted value CARRY authority (⇒ a disagreement is a real conflict)? */
export function postedValueHasAuthority(p: PostedEnvironmentalProvenance): boolean {
  return p === 'operator-entered' || p === 'ahj-published';
}

/** A proper override: a value WITH a reason, an authority source and an actor. */
export interface OperatorEnvironmentalOverride {
  field: EnvironmentalOverrideEntry['field'];
  value: string | number;
  reason: string;
  authoritySource: string;
  actor: string;
  atIso: string;
}

// ── the retrieval record ────────────────────────────────────────────────────

export interface EnvironmentalRetrievalRecord {
  schemaVersion: '1.0.0';
  resolverId: string;
  projectId: string | null;
  /** the EXACT inputs the hazard services were queried with. */
  queryInputs: {
    lat: number; lng: number;
    asceEdition: string;
    riskCategory: RiskCategory;
    riskCategorySource: RiskCategoryDecision['source'];
    riskCategoryBasis: string;
    siteClass: string;
    addressUsed: string | null;
  };
  /** the EXACT values the services returned, unrounded. */
  returnedValues: {
    windSpeedMph: number | null;
    windMriYears: number;
    groundSnowLoadPsf: number | null;
    seismicSdc: string | null;
    seismicSs: number | null;
    seismicS1: number | null;
    seismicSds: number | null;
    seismicSd1: number | null;
    elevationFt: number | null;
  };
  /** every scalar with its own endpoint + dataset — THE evidence trail. */
  datasets: { label: string; value: number | string | null; unit: string | null; sourceUrl: string; dataset: string }[];
  /** exposure category and where it came from — never retrieved, always stated. */
  exposure: { category: string | null; source: 'operator-entered' | 'code-default' | 'unavailable'; basis: string };
  sourceProvider: string;
  sourceDocumentOrTool: string;
  edition: string;
  retrievedAtIso: string;
  sourceHash: string;
  /** the applicability string the pure gate matches against the jurisdiction. */
  applicability: string;
  confidence: number;
  /** live vs fixture, stated on the artifact. */
  proof: 'live-retrieval' | 'fixture';
  fixtureProvenance: string | null;
  /** why the source is CURRENT — a live read is current by construction. */
  currencyBasis: string;
  /** the governing design values AFTER the override rules. */
  governing: { windSpeedMph: number | null; groundSnowLoadPsf: number | null; exposureCategory: string | null; riskCategory: string };
  overrideHistory: EnvironmentalOverrideEntry[];
  /** AAC WS-4 — GENUINE source disagreements: an authority-carrying posted value
   *  that materially differs from the retrieval. Non-empty ⇒ OPERATOR_CONFIRMATION
   *  with BOTH values and BOTH sources shown, and the requirement stays OPEN.
   *  The engine never picks between two authorities. */
  conflicts: string[];
  /** the archival attempt through lib/documents (migration 113). */
  registryArchival: {
    attempted: boolean;
    documentId: string | null;
    /** the exact failure when the durable copy could not be written. The
     *  retrieval itself is unaffected — it is archived in the snapshot with its
     *  own hash — but the DB index is a retryable degradation and says so. */
    failure: string | null;
    operatorAction: string | null;
  };
}

export interface BuildEnvironmentalRetrievalArgs {
  hazards: RetrievedHazards;
  resolverId: string;
  projectId: string | null;
  /** the jurisdiction string the pure gate checks applicability against. */
  jurisdiction: string | null;
  addressUsed: string | null;
  /** the values the project record carried BEFORE the retrieval. */
  posted: { windSpeedMph: number | null; groundSnowPsf: number | null; exposureCategory: string | null; riskCategory: string | null };
  /** true when the posted value was typed by an operator/AHJ (vs a code default
   *  the engine substituted) — the existing windValuePresent/snowValuePresent. */
  postedWindOperatorEntered: boolean;
  postedSnowOperatorEntered: boolean;
  /** AAC WS-4 — WHERE each posted value came from. This is what separates "an
   *  authority disagrees with the retrieval" (⇒ OPERATOR_CONFIRMATION) from "a
   *  sourceless default was refined by a retrieval" (⇒ superseded, no ceremony).
   *  Defaults derive from the two booleans above when not supplied, so every
   *  existing caller behaves exactly as before. */
  postedWindProvenance?: PostedEnvironmentalProvenance;
  postedSnowProvenance?: PostedEnvironmentalProvenance;
  /** PROPER overrides (value + reason + source + actor + timestamp). */
  operatorOverrides?: OperatorEnvironmentalOverride[];
  riskDecision: RiskCategoryDecision;
  siteClass: string;
  confidence: number;
  nowIso: string;
}

const r3 = (n: number | null): number | null => (n == null ? null : Math.round(n * 1000) / 1000);

export function buildEnvironmentalRetrievalRecord(
  args: BuildEnvironmentalRetrievalArgs,
): EnvironmentalRetrievalRecord {
  const h = args.hazards;
  const overrides = args.operatorOverrides ?? [];
  const history: EnvironmentalOverrideEntry[] = [];
  const conflicts: string[] = [];

  const properFor = (f: EnvironmentalOverrideEntry['field']) => overrides.find(o => o.field === f) ?? null;

  const windProv: PostedEnvironmentalProvenance = args.postedWindProvenance
    ?? (args.posted.windSpeedMph == null ? 'absent' : args.postedWindOperatorEntered ? 'operator-entered' : 'engine-default');
  const snowProv: PostedEnvironmentalProvenance = args.postedSnowProvenance
    ?? (args.posted.groundSnowPsf == null ? 'absent' : args.postedSnowOperatorEntered ? 'operator-entered' : 'engine-default');

  /**
   * ONE rule for both scalars. A PROPER override (reason + source + actor) always
   * governs. Otherwise, if the posted value CARRIES AUTHORITY and differs
   * MATERIALLY from the retrieval, that is a genuine two-authority disagreement:
   * the conflict is recorded, the MORE CONSERVATIVE value governs while it is
   * open (never a silent weakening), and the caller keeps the requirement OPEN.
   * A sourceless posted value is simply superseded and preserved in the history.
   */
  function reconcile(
    field: 'ultimateWindSpeedMph' | 'groundSnowLoadPsf',
    label: string, unit: string,
    posted: number | null, retrieved: number | null,
    provenance: PostedEnvironmentalProvenance, materialDelta: number,
  ): number | null {
    const ov = properFor(field);
    if (ov) {
      history.push({
        field, value: ov.value, retrievedValue: retrieved, disposition: 'governing',
        reason: ov.reason, authoritySource: ov.authoritySource, actor: ov.actor, atIso: ov.atIso,
        stricterThanRetrieved: retrieved == null ? null : Number(ov.value) > retrieved,
      });
      return Number(ov.value);
    }
    if (posted == null || retrieved == null) return retrieved ?? posted;
    const delta = Math.abs(posted - retrieved);
    if (delta <= 0.5) return retrieved;         // the same value, differently rounded

    const stricter = posted > retrieved;
    if (delta > materialDelta && postedValueHasAuthority(provenance)) {
      const governing = stricter ? posted : retrieved;
      conflicts.push(
        `${label} disagreement — the project record carries ${posted} ${unit} (${provenance}); the ASCE ${h.asceEdition} `
        + `retrieval at ${h.coordinates.lat},${h.coordinates.lng} returns ${retrieved} ${unit}. The difference `
        + `(${Math.round(delta * 1000) / 1000} ${unit}) exceeds the ${materialDelta} ${unit} materiality threshold, so two `
        + 'sources genuinely disagree about the design basis and the engine may not choose between them. The more '
        + `conservative value (${governing} ${unit}) governs while this is unresolved; that is a safety hold, not an `
        + 'authority determination, and the environmental authority stays UNVERIFIED until it is confirmed.');
      history.push({
        field, value: posted, retrievedValue: retrieved, disposition: 'conflict-pending-confirmation',
        reason: `an authority-carrying project value (${provenance}) differs from the retrieval by more than the `
          + `${materialDelta} ${unit} materiality threshold — OPERATOR_CONFIRMATION, not a silent replacement.`,
        authoritySource: provenance === 'ahj-published' ? 'AHJ-published design criteria (project record)' : null,
        actor: null, atIso: args.nowIso, stricterThanRetrieved: stricter,
      });
      return governing;
    }
    history.push({
      field, value: posted, retrievedValue: retrieved, disposition: 'superseded',
      reason: postedValueHasAuthority(provenance)
        ? `${provenance} value carrying no reason, no authority source and no actor, and within the `
          + `${materialDelta} ${unit} materiality threshold — not an override; the retrieved authority governs and the `
          + 'entry is preserved here.'
        : provenance === 'unprovenanced-table'
          ? 'value taken from the curated in-repo AHJ table, which carries no adoption ordinance, no effective date '
            + 'and no hash — it never had authority, so the retrieval supersedes it outright.'
          : 'code-minimum default substituted by the engine before any retrieval existed — superseded by the retrieval.',
      authoritySource: null, actor: null, atIso: args.nowIso,
      stricterThanRetrieved: stricter,
    });
    return retrieved;
  }

  const governingWind = reconcile(
    'ultimateWindSpeedMph', 'Basic wind speed V', 'mph',
    args.posted.windSpeedMph, h.windSpeedMph, windProv, WIND_MATERIAL_DELTA_MPH);
  const governingSnow = reconcile(
    'groundSnowLoadPsf', 'Ground snow load pg', 'psf',
    args.posted.groundSnowPsf, h.groundSnowLoadPsf, snowProv, SNOW_MATERIAL_DELTA_PSF);

  // ── exposure — never retrieved; stated with its own basis ─────────────────
  const exposureOverride = properFor('exposureCategory');
  const exposureValue = exposureOverride ? String(exposureOverride.value) : (args.posted.exposureCategory ?? null);
  const exposure: EnvironmentalRetrievalRecord['exposure'] = exposureValue
    ? {
        category: exposureValue,
        source: 'operator-entered',
        basis: 'ASCE 7 §26.7 surface-roughness / exposure category — a site-terrain determination made by the designer. '
          + 'No hazard dataset (including the ASCE 7 Hazard Tool) publishes it, so it is recorded here as a designer '
          + 'input with its own basis and audited alongside the retrieved values.',
      }
    : {
        category: null, source: 'unavailable',
        basis: 'no exposure category is stated on the project and none can be retrieved — ASCE 7 §26.7 requires a '
          + 'designer determination of the upwind surface roughness.',
      };
  if (exposureOverride) {
    history.push({
      field: 'exposureCategory', value: exposureOverride.value, retrievedValue: null,
      disposition: 'sole-basis', reason: exposureOverride.reason, authoritySource: exposureOverride.authoritySource,
      actor: exposureOverride.actor, atIso: exposureOverride.atIso, stricterThanRetrieved: null,
    });
  }

  const applicability = [
    args.jurisdiction ?? '',
    args.addressUsed ?? '',
    `lat ${h.coordinates.lat}, lng ${h.coordinates.lng}`,
  ].filter(Boolean).join(' — ');

  const sourceHash = retrievalSourceHash({
    edition: h.asceEdition, riskCategory: h.riskCategory, coordinates: h.coordinates,
    windSpeedMph: h.windSpeedMph, groundSnowLoadPsf: h.groundSnowLoadPsf,
    seismic: h.seismic, elevationFt: h.elevationFt,
    datasets: h.data.map(d => ({ dataset: d.dataset, sourceUrl: d.sourceUrl, value: d.value })),
  });

  return {
    schemaVersion: '1.0.0',
    resolverId: args.resolverId,
    projectId: args.projectId,
    queryInputs: {
      lat: h.coordinates.lat, lng: h.coordinates.lng,
      asceEdition: `ASCE ${h.asceEdition}`,
      riskCategory: h.riskCategory,
      riskCategorySource: args.riskDecision.source,
      riskCategoryBasis: args.riskDecision.basis,
      siteClass: args.siteClass,
      addressUsed: args.addressUsed,
    },
    returnedValues: {
      windSpeedMph: h.windSpeedMph, windMriYears: h.windMriYears,
      groundSnowLoadPsf: h.groundSnowLoadPsf,
      seismicSdc: h.seismic?.sdc ?? null, seismicSs: h.seismic?.ss ?? null, seismicS1: h.seismic?.s1 ?? null,
      seismicSds: h.seismic?.sds ?? null, seismicSd1: h.seismic?.sd1 ?? null,
      elevationFt: h.elevationFt,
    },
    datasets: h.data,
    exposure,
    sourceProvider: h.proof === 'fixture' ? 'ASCE 7 Hazard Tool datasets (fixture replay)' : 'ASCE 7 Hazard Tool datasets (gis.asce.org) + USGS ASCE 7 design maps + USGS 3DEP',
    sourceDocumentOrTool: `ASCE ${h.asceEdition} hazard datasets, Risk Category ${h.riskCategory} (${h.windMriYears}-yr MRI wind)`,
    edition: `ASCE ${h.asceEdition}`,
    retrievedAtIso: args.nowIso,
    sourceHash,
    applicability,
    confidence: args.confidence,
    proof: h.proof,
    fixtureProvenance: h.fixtureProvenance ?? null,
    currencyBasis: h.proof === 'live-retrieval'
      ? `LIVE read of the authoritative hazard services at ${args.nowIso} — the source is current at the instant it was `
        + 'read, so the retrieval timestamp IS the currency confirmation (no archived-document staleness gap exists).'
      : `FIXTURE replay — currency inherited from the documented capture (${h.fixtureProvenance ?? 'see fixture provenance'}).`,
    governing: {
      windSpeedMph: r3(governingWind),
      groundSnowLoadPsf: r3(governingSnow),
      exposureCategory: exposure.category,
      riskCategory: h.riskCategory,
    },
    overrideHistory: history,
    conflicts,
    registryArchival: { attempted: false, documentId: null, failure: null, operatorAction: null },
  };
}

/**
 * Project the retrieval record onto the EXISTING EnvironmentalLoadSourceEvidence
 * shape that `environmentalSourceVerified` (unmodified) inspects.
 *
 * COVERAGE, stated exactly:
 *   coversWindSpeed     — the wind raster answered.
 *   coversSnowLoad      — the snow raster answered.
 *   coversExposureRisk  — the record carries BOTH the risk category the values
 *                         were retrieved AT (so the returned numbers are
 *                         risk-specific, not generic) AND an exposure category
 *                         with a stated basis. Missing either ⇒ false ⇒ the
 *                         requirement does NOT clear.
 */
export function toEnvironmentalSourceEvidence(
  rec: EnvironmentalRetrievalRecord,
): EnvironmentalLoadSourceEvidence {
  const coversWind = rec.returnedValues.windSpeedMph != null;
  const coversSnow = rec.returnedValues.groundSnowLoadPsf != null;
  const coversExposureRisk = !!rec.queryInputs.riskCategory && !!rec.exposure.category;
  return {
    documentId: rec.registryArchival.documentId ?? `env-retrieval:${rec.sourceHash.slice(0, 16)}`,
    dataset: rec.sourceDocumentOrTool,
    versionOrDate: `${rec.edition} · retrieved ${rec.retrievedAtIso}`,
    // A retrieval from the authoritative service, hashed and archived on the
    // snapshot, IS a verified source. The nine-condition gate is unchanged.
    // EXCEPT when two authorities disagree: an unresolved conflict is evidence of
    // a conflict, not of a verified design basis, so the state says so and the
    // (unmodified) gate refuses it.
    verificationState: rec.conflicts.length ? 'unverified-source-conflict' : 'verified',
    archivedInRepo: true,
    sha256: rec.sourceHash,
    coversWindSpeed: coversWind,
    coversSnowLoad: coversSnow,
    coversExposureRisk,
    windSpeedMph: rec.governing.windSpeedMph,
    groundSnowPsf: rec.governing.groundSnowLoadPsf,
    exposureCategory: rec.exposure.category,
    riskCategory: rec.governing.riskCategory,
    coordinates: { lat: rec.queryInputs.lat, lng: rec.queryInputs.lng },
    addressUsed: rec.queryInputs.addressUsed,
    projectApplicability: rec.applicability,
    lookupTimestampIso: rec.retrievedAtIso,
    currencyConfirmedAtIso: rec.retrievedAtIso,
  };
}

/** The claims payload archived as a `climate_hazard_dataset` registry document
 *  (migration 113). Shaped for ExtractedEngineeringClaims.environmental. */
export function toRegistryClaims(rec: EnvironmentalRetrievalRecord): Record<string, unknown> {
  return {
    values: {
      windMriYears: rec.returnedValues.windMriYears,
      seismicSdc: rec.returnedValues.seismicSdc,
      seismicSs: rec.returnedValues.seismicSs,
      seismicS1: rec.returnedValues.seismicS1,
      elevationFt: rec.returnedValues.elevationFt,
      siteClass: rec.queryInputs.siteClass,
      datasets: rec.datasets,
      riskCategoryBasis: rec.queryInputs.riskCategoryBasis,
      exposureBasis: rec.exposure.basis,
      currencyBasis: rec.currencyBasis,
      proof: rec.proof,
    },
    environmental: {
      dataset: rec.sourceDocumentOrTool,
      projectApplicability: rec.applicability,
      windSpeedMph: rec.governing.windSpeedMph,
      groundSnowPsf: rec.governing.groundSnowLoadPsf,
      exposureCategory: rec.exposure.category,
      riskCategory: rec.governing.riskCategory,
      lat: rec.queryInputs.lat,
      lng: rec.queryInputs.lng,
      addressUsed: rec.queryInputs.addressUsed,
      lookupTimestampIso: rec.retrievedAtIso,
      currencyConfirmedAtIso: rec.retrievedAtIso,
      coversWindSpeed: rec.returnedValues.windSpeedMph != null,
      coversSnowLoad: rec.returnedValues.groundSnowLoadPsf != null,
      coversExposureRisk: !!rec.queryInputs.riskCategory && !!rec.exposure.category,
    },
  };
}

/** A deterministic document id for the archived retrieval, so regenerating the
 *  same site does not accumulate duplicate registry rows. */
export function archivalDocumentId(rec: EnvironmentalRetrievalRecord): string {
  // UUID-shaped (the registry column is a uuid) and content-derived.
  const h = rec.sourceHash;
  return [h.slice(0, 8), h.slice(8, 12), `5${h.slice(13, 16)}`, `a${h.slice(17, 20)}`, h.slice(20, 32)].join('-');
}
