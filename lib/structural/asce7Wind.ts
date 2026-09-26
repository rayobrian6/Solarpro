// ═══════════════════════════════════════════════════════════════════════════
// ASCE 7-22 §26/§29 — THE WIND DERIVATION, WRITTEN DOWN
//
// ── THE DEFECT ────────────────────────────────────────────────────────────
// The package published a velocity pressure and a net uplift and NOTHING ELSE.
// Across all twenty sheets there was not one occurrence of Kz, Kzt, Kd, Ke, the
// mean roof height, the enclosure classification, GCpi, or the effective wind
// area — I grepped the whole rendered set. The engineer being asked to seal it
// could not check the number they were sealing.
//
// Behind it, `getGCp()` returned a hardcoded {interior −1.5, edge −2.0,
// corner −2.5} under the comment "ASCE 7-22 Figure 29.4-7", with no dependence
// on effective wind area, panel tilt, or the array-edge factor the figure
// requires — and Figure 29.4-7 governs roofs with slopes LESS THAN 7°. The
// audited roof is 3.6:12 ≈ 16.5°, so the cited figure does not apply to it at
// all.
//
// ── WHAT THIS MODULE DOES, AND DOES NOT DO ────────────────────────────────
// It does NOT invent a coefficient set for steep roofs. It makes the derivation
// AUDITABLE: every factor carries its own basis, and the applicability limit of
// the cited figure is CHECKED rather than assumed. When the limit is exceeded
// the record says so in as many words, so a licensed reviewer accepts or
// replaces the assumption knowingly instead of inheriting it invisibly.
//
// A number a reviewer cannot reproduce is not an engineering result, however
// correct it happens to be.
// ═══════════════════════════════════════════════════════════════════════════

export type WindExposureCat = 'B' | 'C' | 'D';
export type RoofZone = 'interior' | 'edge' | 'corner';

/** The slope above which ASCE 7-22 Fig. 29.4-7 (rooftop solar) no longer governs. */
export const ROOFTOP_SOLAR_MAX_SLOPE_DEG = 7;

export interface WindFactor {
  symbol: string;
  value: number;
  basis: string;
}

export interface VelocityPressureRecord {
  /** qz, psf. */
  qzPsf: number;
  windSpeedMph: number;
  exposure: WindExposureCat;
  meanRoofHeightFt: number;
  factors: WindFactor[];
  /** the arithmetic, spelled out. */
  derivation: string;
}

/**
 * ASCE 7-22 Table 26.10-1 — velocity pressure exposure coefficient Kz (Kh).
 *
 * 🚨 THIS LADDER USED TO GO FLAT AT 40 FT, AND SO DID ITS DUPLICATE.
 *
 * Both this function and `getKz` in lib/structural-engine-v4.ts ended with a bare
 * return of the 40-ft coefficient for EVERY height above 30 ft. They agreed with
 * each other perfectly and were both wrong above 40 ft — the same shape as the
 * ambient-correction ladder that returned a flat 0.58 above 60 °C, and the same
 * lesson: two agreeing copies can both be wrong, and a value that STOPS VARYING
 * hides every disagreement inside it.
 *
 * Measured against Kz = 2.01·(z/zg)^(2/α), the published definition of this table:
 *
 *              code      ASCE      error
 *   C @ 50 ft  1.04      1.09      −4.6 %
 *   C @ 60 ft  1.04      1.13      −8.0 %
 *   B @ 60 ft  0.76      0.85      −10.6 %
 *
 * every one of them LESS conservative than the code. And qz is linear in Kz, so
 * the whole chain — net uplift, uplift per attachment, the mount count and spacing
 * on the sealed PV-4C schedule, the racking BOM's lag-bolt quantity, and the
 * MOUNT_INSUFFICIENT_CAPACITY gate — understated by the same margin.
 *
 * 🚨 AND IT WAS UNREACHABLE UNTIL TODAY. While the permit hardcoded a 15 ft
 * building this ladder was never asked about anything above 15. Teaching it to read
 * the real building height — `MEAN_ROOF_HEIGHT_MAX_FT` is 60, and the operator's own
 * control is `min=8 max=60` — is what made the flat tail live. A repair reached the
 * defect that was waiting behind it.
 *
 * The rows to 100 ft are the published table, so NOTHING at or below 40 ft changes.
 * Above the last row it falls through to the power law rather than repeating a
 * value, because a truncated ladder is exactly what this is fixing.
 */
export function velocityPressureCoefficient(heightFt: number, exposure: WindExposureCat): number {
  const h = Math.max(15, Number.isFinite(heightFt) ? heightFt : 15);

  /** Table 26.10-1 rows: [height ft, B, C, D]. */
  const TABLE: ReadonlyArray<readonly [number, number, number, number]> = [
    [15, 0.57, 0.85, 1.03],
    [20, 0.62, 0.90, 1.08],
    [25, 0.66, 0.94, 1.12],
    [30, 0.70, 0.98, 1.16],
    [40, 0.76, 1.04, 1.22],
    [50, 0.81, 1.09, 1.27],
    [60, 0.85, 1.13, 1.31],
    [70, 0.89, 1.17, 1.34],
    [80, 0.93, 1.21, 1.38],
    [90, 0.96, 1.24, 1.40],
    [100, 0.99, 1.26, 1.43],
  ];
  const col = exposure === 'B' ? 1 : exposure === 'D' ? 3 : 2;
  for (const row of TABLE) {
    if (h <= row[0]) return row[col] as number;
  }

  // Above the tabulated range: Kz = 2.01·(z/zg)^(2/α), the equation the table is
  // generated from (ASCE 7-22 §26.10.1). Continuing to rise is the point.
  const { alpha, zg } = exposure === 'B' ? { alpha: 7.0, zg: 1200 }
    : exposure === 'D' ? { alpha: 11.5, zg: 700 }
    : { alpha: 9.5, zg: 900 };
  return Math.round(2.01 * Math.pow(h / zg, 2 / alpha) * 100) / 100;
}

/**
 * qz = 0.00256 · Kz · Kzt · Kd · Ke · V²  (ASCE 7-22 Eq. 26.10-1)
 *
 * Every factor is returned with the reason it holds that value, because the
 * package used to publish only the product.
 */
export function velocityPressure(args: {
  windSpeedMph: number;
  exposure: WindExposureCat;
  meanRoofHeightFt: number;
  /** topographic factor — 1.0 unless a hill/escarpment study says otherwise. */
  Kzt?: number;
  /** directionality — 0.85 for buildings, ASCE 7-22 Table 26.6-1. */
  Kd?: number;
  /** ground elevation factor — 1.0 is the permitted conservative value. */
  Ke?: number;
}): VelocityPressureRecord {
  const V = args.windSpeedMph;
  const exposure = args.exposure;
  const h = args.meanRoofHeightFt;
  const Kz = velocityPressureCoefficient(h, exposure);
  const Kzt = args.Kzt ?? 1.0;
  const Kd = args.Kd ?? 0.85;
  const Ke = args.Ke ?? 1.0;
  const qz = 0.00256 * Kz * Kzt * Kd * Ke * V * V;

  const factors: WindFactor[] = [
    { symbol: 'Kz', value: Kz,
      basis: `ASCE 7-22 Table 26.10-1, Exposure ${exposure} at ${h.toFixed(0)} ft mean roof height` },
    { symbol: 'Kzt', value: Kzt,
      basis: Kzt === 1.0
        ? 'ASCE 7-22 §26.8 — topographic factor 1.0; no hill, ridge or escarpment is asserted for this site'
        : 'ASCE 7-22 §26.8 — site-specific topographic study' },
    { symbol: 'Kd', value: Kd, basis: 'ASCE 7-22 Table 26.6-1 — directionality, buildings' },
    { symbol: 'Ke', value: Ke,
      basis: Ke === 1.0
        ? 'ASCE 7-22 Table 26.9-1 — ground elevation factor taken as 1.0 (permitted, conservative)'
        : 'ASCE 7-22 Table 26.9-1 — site elevation' },
  ];

  return {
    qzPsf: qz, windSpeedMph: V, exposure, meanRoofHeightFt: h, factors,
    derivation: `qz = 0.00256 × Kz ${Kz.toFixed(2)} × Kzt ${Kzt.toFixed(2)} × Kd ${Kd.toFixed(2)} `
      + `× Ke ${Ke.toFixed(2)} × (${V.toFixed(0)} mph)² = ${qz.toFixed(2)} psf (ASCE 7-22 Eq. 26.10-1)`,
  };
}

export interface RooftopSolarPressureCoefficient {
  zone: RoofZone;
  uplift: number;
  downward: number;
  /** the figure/section the value is taken from. */
  basis: string;
  /** true ⇒ the cited figure's slope limit is exceeded and this is an ASSUMPTION. */
  applicabilityExceeded: boolean;
  /** stated in full when the limit is exceeded, so a reviewer sees the gap. */
  applicabilityNote: string | null;
}

/**
 * Net pressure coefficients for roof-mounted solar panels.
 *
 * ASCE 7-22 Figure 29.4-7 governs panels on flat, gable or hip roofs with slopes
 * LESS THAN 7°. Above that the figure does not apply, and panels installed
 * parallel to and close to the roof surface are evaluated with the roof's own
 * components-and-cladding coefficients (Ch. 30).
 *
 * This function does NOT invent a steep-roof coefficient set. It returns the
 * values the engine has always used and, when the slope exceeds the limit, marks
 * them as an assumption with the reason — which is a finding for the engineer of
 * record, not something to bury.
 */
export function rooftopSolarPressureCoefficient(
  zone: RoofZone, roofPitchDeg: number,
): RooftopSolarPressureCoefficient {
  const byZone: Record<RoofZone, { uplift: number; downward: number }> = {
    interior: { uplift: -1.5, downward: 1.5 },
    edge: { uplift: -2.0, downward: 2.0 },
    corner: { uplift: -2.5, downward: 2.5 },
  };
  const v = byZone[zone];
  const exceeded = Number.isFinite(roofPitchDeg) && roofPitchDeg > ROOFTOP_SOLAR_MAX_SLOPE_DEG;
  return {
    zone,
    uplift: v.uplift,
    downward: v.downward,
    basis: exceeded
      ? `zone ${zone}: GCrn = ${v.uplift.toFixed(1)} / +${v.downward.toFixed(1)} — ENGINEERING ASSUMPTION `
        + `(see applicability note)`
      : `ASCE 7-22 Fig. 29.4-7, zone ${zone}: GCrn = ${v.uplift.toFixed(1)} / +${v.downward.toFixed(1)}`,
    applicabilityExceeded: exceeded,
    applicabilityNote: exceeded
      ? `ASCE 7-22 Fig. 29.4-7 applies to roof slopes LESS THAN ${ROOFTOP_SOLAR_MAX_SLOPE_DEG}°; this roof is `
        + `${roofPitchDeg.toFixed(1)}°. The coefficients above are carried as an ENGINEERING ASSUMPTION and are not `
        + `taken from a figure that governs this geometry. For a roof of this slope, panels installed parallel to and `
        + `close to the roof surface are evaluated with the roof's own components-and-cladding coefficients (Ch. 30). `
        + `The engineer of record must accept or replace this assumption.`
      : null,
  };
}
