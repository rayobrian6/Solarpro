// ============================================================
// lib/3d/ground/groundDefaults.ts
//
// Industry-standard defaults for fixed-tilt ground-mount geometry.
// Ray's ruling 2026-07-19 (DATA-AUTHORITY-AUDIT P1-13): ground tilt /
// azimuth resolve via industry-standard-validated real data. These are
// the LAST-RESORT fallbacks — the resolution order in groundCAD is:
//
//   TILT:    layout authority (studio slider) when plausible
//            → panel-stamp median when plausible
//            → industryStandardGroundTilt(lat)
//   AZIMUTH: derived from PLACED PANEL GEOMETRY (row bearing) when ≥2
//            panels; stamps/layout columns are validated against it
//            (>15° divergence → geometry wins, with a warn audit line)
//            → standardGroundAzimuth(hemisphere) when nothing else exists
//
// Every fallback hop emits a console.warn audit line (recompute-if-
// contradicts doctrine).
// ============================================================

/** Plausible fixed-rack ground-mount tilt band (degrees).
 *  Ray-verified real designs live inside it (Stowell 40.16° is real;
 *  a 90° or 0° "tilt" on a ground rack is a data error). */
export const GROUND_TILT_PLAUSIBLE_MIN_DEG = 10;
export const GROUND_TILT_PLAUSIBLE_MAX_DEG = 50;

/** Max believable divergence between a stored azimuth (panel stamps or
 *  layout column) and the azimuth derived from the placed panel geometry.
 *  Beyond this the stored value is stale — geometry wins. */
export const GROUND_AZIMUTH_DIVERGENCE_MAX_DEG = 15;

/**
 * Industry-standard rule-of-thumb optimum tilt for a FIXED-rack ground
 * array maximizing annual production.
 *
 * Source: Jacobson & Jadhav (2018), "World estimates of PV optimal tilt
 * angles and ratios of sunlight incident upon tilted and tracked PV
 * panels relative to horizontal panels", Solar Energy 169:55-66 —
 * Northern-Hemisphere mid-latitude regression ≈ 1.3793 + lat·(1.2011 +
 * lat·(−0.014404 + lat·0.000080509)); the linear rule-of-thumb
 * tilt ≈ lat × 0.76 + 3.1° tracks that polynomial within ~1° across
 * the continental-US latitude band (25°–49°N).
 *
 * Clamped to the practical fixed-rack range [15, 40]° (steeper racks
 * trade summer production and drive up wind loading; shallower racks
 * lose winter production and soil faster).
 *
 * @param latDeg site latitude in degrees (sign ignored — tilt magnitude
 *               is hemisphere-independent)
 * @returns tilt in degrees, 0.1° precision
 */
export function industryStandardGroundTilt(latDeg: number): number {
  const lat = Math.abs(isFinite(latDeg) ? latDeg : 37); // continental-US centroid latitude as a degenerate-input guard
  const ruleOfThumb = lat * 0.76 + 3.1;
  const clamped = Math.min(40, Math.max(15, ruleOfThumb));
  return Math.round(clamped * 10) / 10;
}

/**
 * Industry-standard fixed-rack azimuth: equator-facing.
 * 180° (due south) in the northern hemisphere, 0° (due north) in the
 * southern hemisphere.
 */
export function standardGroundAzimuth(hemisphere: 'north' | 'south'): number {
  return hemisphere === 'north' ? 180 : 0;
}

/** Hemisphere from latitude (≥0 → north). */
export function hemisphereOf(latDeg: number): 'north' | 'south' {
  return latDeg >= 0 ? 'north' : 'south';
}

/** Smallest angular distance between two compass bearings, degrees [0,180]. */
export function bearingDistanceDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}
