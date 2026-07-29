// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-9 — THE ONE SITE DESIGN-LOAD SEAM (retires the renderer `?? 115` /
// `?? 0` guards).
//
// THE DEFECT (audit §2.6 "renderer wrongly deciding? Yes, weakly"): seven
// drafting sites carried their own last-resort wind/snow literals —
//     lib/drafting/sheetComposition.ts        :337 :393 :532   (`|| 115`)
//     lib/drafting/templates/fence.ts         :528 :720 :721 :1211
//     lib/drafting/templates/ground.ts        :886 :887
// Each consulted the snapshot FIRST, so the literal was documented as a
// "standalone preview guard". But the chain `snapWind(input) ?? (… || 115)`
// silently reaches 115 whenever a snapshot IS present and its environmental
// value is null — i.e. exactly on the projects where the environmental
// authority has not been established. A design value with no provenance then
// prints beside authority-verified values and is indistinguishable from them.
//
// THE FIX is not to delete the number — a drafting geometry pass needs a
// scalar. It is to make the number's BASIS explicit, resolve it in ONE place in
// the snapshot layer, and let the sheets print what they are actually using.
// After this pass the drafting layer contains no wind/snow literal at all, and
// a reader can always tell an ASCE-derived value from a code-minimum guard.
//
// Product RATINGS (a fence system's manufacturer-rated max wind/snow) are a
// different kind of number entirely and are deliberately NOT covered here.
// ═══════════════════════════════════════════════════════════════════════════

/** ASCE 7 has no risk-category-II basic wind speed below this in the continental
 *  US, so it is the honest floor when nothing else is established. It is a
 *  GUARD, never an authority, and it is always labelled as one. */
export const CODE_MINIMUM_WIND_MPH = 115;
/** A ground snow load of zero is a real value in much of the US, so it is the
 *  correct floor — but a zero that came from "nobody supplied one" must never
 *  read as a zero that came from a hazard dataset. */
export const CODE_MINIMUM_GROUND_SNOW_PSF = 0;

export type SiteLoadBasis =
  /** the snapshot's environmental-load AUTHORITY (retrieved + archived). */
  | 'environmental-authority'
  /** the snapshot's structural env block (engine value, authority state carried
   *  separately by the environmental authority record). */
  | 'snapshot-structural'
  /** an operator/compliance-entered value on the posted input. */
  | 'operator-entered'
  /** the static AHJ table row. Sourceless: no URL, no date, no hash. */
  | 'ahj-table'
  /** nothing was established — the code-minimum guard. NEVER an authority. */
  | 'code-minimum-guard';

export interface SiteDesignLoads {
  windSpeedMph: number;
  groundSnowPsf: number;
  windBasis: SiteLoadBasis;
  snowBasis: SiteLoadBasis;
  /** true ⇔ BOTH values came from an established source (not the guard). */
  established: boolean;
  /** the one sentence a sheet prints when the values are not established. */
  guardNotice: string | null;
}

const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : null;

interface SnapshotEnvLike {
  structural?: {
    env?: {
      // NOTE the EXACT field names. The audit's single highest-value defect was
      // a computed result discarded by four field-name mismatches; this seam
      // reads `StructuralEnv.groundSnowPsf` and
      // `EnvironmentalLoadAuthority.groundSnowLoadPsf`, which are genuinely
      // different names on genuinely different records.
      ultimateWindSpeedMph?: number | null;
      groundSnowPsf?: number | null;
      environmentalLoadAuthority?: {
        verificationStatus?: string | null;
        ultimateWindSpeedMph?: number | null;
        groundSnowLoadPsf?: number | null;
      } | null;
    } | null;
    loads?: { windSpeedMph?: number | null; snowPsf?: number | null } | null;
  } | null;
}

/**
 * THE resolver. Deterministic, pure, and the ONLY place a wind/snow fallback
 * number exists. Order, strongest first:
 *   1. the VERIFIED environmental-load authority on the snapshot;
 *   2. the snapshot's structural env value (engine input of record);
 *   3. an operator/compliance-entered value on the posted input;
 *   4. the static AHJ table row (sourceless — labelled as such);
 *   5. the code-minimum guard, explicitly flagged.
 */
export function resolveSiteDesignLoads(args: {
  snapshot?: SnapshotEnvLike | null;
  /** compliance.structural.wind.windSpeed / .snow — operator-entered. */
  complianceWindMph?: unknown;
  complianceSnowPsf?: unknown;
  /** project.ahjWindSpeedMph / .ahjGroundSnowPsf — the static AHJ table. */
  ahjWindMph?: unknown;
  ahjSnowPsf?: unknown;
}): SiteDesignLoads {
  const env = args.snapshot?.structural?.env ?? null;
  const auth = env?.environmentalLoadAuthority ?? null;
  const authVerified = auth?.verificationStatus === 'verified';

  let windSpeedMph: number | null = null;
  let windBasis: SiteLoadBasis = 'code-minimum-guard';
  if (authVerified && num(auth?.ultimateWindSpeedMph) != null) {
    windSpeedMph = num(auth?.ultimateWindSpeedMph); windBasis = 'environmental-authority';
  } else if (num(env?.ultimateWindSpeedMph) != null) {
    windSpeedMph = num(env?.ultimateWindSpeedMph); windBasis = 'snapshot-structural';
  } else if (num(args.snapshot?.structural?.loads?.windSpeedMph) != null) {
    windSpeedMph = num(args.snapshot?.structural?.loads?.windSpeedMph); windBasis = 'snapshot-structural';
  } else if (num(args.complianceWindMph) != null) {
    windSpeedMph = num(args.complianceWindMph); windBasis = 'operator-entered';
  } else if (num(args.ahjWindMph) != null) {
    windSpeedMph = num(args.ahjWindMph); windBasis = 'ahj-table';
  }
  if (windSpeedMph == null) { windSpeedMph = CODE_MINIMUM_WIND_MPH; windBasis = 'code-minimum-guard'; }

  let groundSnowPsf: number | null = null;
  let snowBasis: SiteLoadBasis = 'code-minimum-guard';
  if (authVerified && num(auth?.groundSnowLoadPsf) != null) {
    groundSnowPsf = num(auth?.groundSnowLoadPsf); snowBasis = 'environmental-authority';
  } else if (num(env?.groundSnowPsf) != null) {
    groundSnowPsf = num(env?.groundSnowPsf); snowBasis = 'snapshot-structural';
  } else if (num(args.snapshot?.structural?.loads?.snowPsf) != null) {
    groundSnowPsf = num(args.snapshot?.structural?.loads?.snowPsf); snowBasis = 'snapshot-structural';
  } else if (num(args.complianceSnowPsf) != null) {
    groundSnowPsf = num(args.complianceSnowPsf); snowBasis = 'operator-entered';
  } else if (num(args.ahjSnowPsf) != null) {
    groundSnowPsf = num(args.ahjSnowPsf); snowBasis = 'ahj-table';
  }
  if (groundSnowPsf == null) { groundSnowPsf = CODE_MINIMUM_GROUND_SNOW_PSF; snowBasis = 'code-minimum-guard'; }

  const guarded = windBasis === 'code-minimum-guard' || snowBasis === 'code-minimum-guard';
  return {
    windSpeedMph, groundSnowPsf, windBasis, snowBasis,
    established: !guarded,
    guardNotice: guarded
      ? 'DESIGN LOAD NOT ESTABLISHED — the value shown is the ASCE 7 code-minimum guard, not a site-specific authority. '
        + 'It is superseded automatically once the environmental load authority is retrieved and archived.'
      : null,
  };
}

/** The wind/snow inputs as they arrive on a posted PermitInput. One extractor,
 *  so no sheet re-invents the field paths (the `windSpeed` vs `windSpeedMph`
 *  vs `ahjWindSpeedMph` spread that produced the divergent chains). */
export function siteLoadInputsFrom(input: Record<string, unknown> | undefined | null): {
  snapshot: SnapshotEnvLike | null;
  complianceWindMph: unknown; complianceSnowPsf: unknown;
  ahjWindMph: unknown; ahjSnowPsf: unknown;
} {
  const i = (input ?? {}) as Record<string, unknown>;
  const p = (i.project ?? {}) as Record<string, unknown>;
  const c = (i.compliance ?? {}) as Record<string, unknown>;
  const cs = (c.structural ?? {}) as Record<string, unknown>;
  const cw = (cs.wind ?? {}) as Record<string, unknown>;
  const csnow = (cs.snow ?? {}) as Record<string, unknown>;
  return {
    snapshot: (i._snapshot as SnapshotEnvLike | undefined) ?? null,
    complianceWindMph: cw.windSpeed ?? cw.windSpeedMph,
    complianceSnowPsf: csnow.groundSnowLoad ?? csnow.groundSnowPsf ?? cs.groundSnowPsf,
    ahjWindMph: p.ahjWindSpeedMph,
    ahjSnowPsf: p.ahjGroundSnowPsf,
  };
}
