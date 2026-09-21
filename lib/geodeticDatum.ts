/**
 * lib/geodeticDatum.ts — ORTHOMETRIC HEIGHTS INTO ELLIPSOIDAL ONES. ONE ANSWER.
 *
 * Google's Elevation and Solar APIs report heights above MEAN SEA LEVEL
 * (orthometric). Cesium, ECEF and Google's photorealistic 3D tiles all work in
 * heights above the WGS-84 ELLIPSOID. The difference is the geoid undulation N:
 *
 *     h_ellipsoidal  =  H_orthometric  +  N(lat, lng)
 *
 * Across the continental United States N is roughly −8 m to −35 m, so getting it
 * wrong does not tilt a roof — it moves the entire building up or down relative
 * to the mesh under it.
 *
 * 🚨 WHY THIS FILE EXISTS: THERE WERE FOUR COPIES OF THE SAME EXPRESSION.
 *
 *     SolarEngine3D  boot()                 −29 − 5·sin(lat)
 *     SolarEngine3D  twin reload            −29 − 5·sin(lat)
 *     SolarEngine3D  drawOverlays           −29 − 5·sin(lat)
 *     SolarEngine3D  the segment fill path  −29 − 5·sin(lat)
 *
 * All four agreed, which is the only reason nothing had gone wrong yet. Four
 * copies of a physical constant is four places for it to diverge, and the roof
 * datum work in this workstream exists precisely because that had already
 * happened to the module mount height — six copies, four different numbers, and
 * a 14 cm-per-reload ratchet. Same rule, applied before rather than after.
 *
 * ─── 🚨 WHAT THIS APPROXIMATION IS, AND WHAT IT IS NOT ───────────────────────
 *
 * It is a latitude-only fit. **It has no longitude term at all**, while the real
 * EGM96 geoid varies strongly with longitude across the same latitude band — the
 * Rocky Mountain and Great Plains undulations differ substantially from the
 * Mississippi valley at the same parallel. The comment that travelled with the
 * original expression claimed it is
 *
 *     "accurate to ~1-2m for CONUS, which is sufficient for panel placement"
 *
 * and **that claim has never been measured in this repository.** It is recorded
 * here as an unverified assertion, not restated as fact. Whatever its true
 * error, it enters as a uniform vertical offset between the fitted roof planes
 * and Google's photogrammetry mesh — which is one of the two open questions in
 * the roof-datum workstream, and cannot be closed without 3D tiles.
 *
 * ─── THE MEASURABLE ALTERNATIVE, AND WHY IT IS NOT USED ──────────────────────
 *
 * `Cesium.sampleTerrainMostDetailed` returns a true ellipsoidal ground height
 * and was deliberately removed ("PERF v61") because it cost 3–5 s at boot and
 * returns 0 under `EllipsoidTerrainProvider` anyway. That is a defensible
 * trade. It is recorded here so that the next person reading a 0.5 m
 * discrepancy between the panels and the mesh knows there is a measurable
 * number available, and what it costs.
 *
 * Nothing in this file is a rendering fudge. `SURFACE_OFFSET_M` (roofPlane3D)
 * and `moduleStackHeightM` (roofMountDatum) are separate facts with separate
 * homes; a datum conversion must not absorb either.
 */

/** Latitude below which the CONUS fit is not even nominally applicable. */
const FIT_LAT_MIN_DEG = 18;
/** Latitude above which the same. */
const FIT_LAT_MAX_DEG = 72;

/**
 * Geoid undulation N in metres — the height of mean sea level above the WGS-84
 * ellipsoid — from the latitude-only CONUS fit described above.
 *
 * Returns a NEGATIVE number throughout North America. A non-finite latitude
 * yields the value at 38° N rather than `NaN`, because every caller adds this
 * to a height and a `NaN` there would propagate silently into a panel position;
 * the callers that care about a missing latitude check it themselves.
 */
export function geoidUndulationM(latDeg: number): number {
  const lat = Number.isFinite(latDeg) ? latDeg : 38;
  return -29 - 5 * Math.sin(lat * Math.PI / 180);
}

/**
 * Convert a Google (orthometric, above mean sea level) height into the
 * ellipsoidal height Cesium and ECEF use.
 *
 * 🚨 An absent orthometric height is NOT zero. `0` is a real height — a coastal
 * site genuinely sits near it — so this refuses to invent one: pass a finite
 * number or handle the absence at the call site. Returning
 * `geoidUndulationM(lat)` for a missing input would place the building ~32 m
 * below the ellipsoid and look exactly like a correct answer.
 */
export function ellipsoidalFromOrthometricM(orthometricM: number, latDeg: number): number | null {
  if (!Number.isFinite(orthometricM)) return null;
  return orthometricM + geoidUndulationM(latDeg);
}

/** Is this latitude inside the band the fit was made for? Callers may log it. */
export function isWithinGeoidFitBand(latDeg: number): boolean {
  return Number.isFinite(latDeg) && latDeg >= FIT_LAT_MIN_DEG && latDeg <= FIT_LAT_MAX_DEG;
}
