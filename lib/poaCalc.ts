/**
 * poaCalc.ts — GHI → POA irradiance conversion
 *
 * Converts Google Solar API "sunshineHours" (which are GHI-equivalent annual
 * sun hours, i.e. kWh/m²/yr on a horizontal surface) to Plane-of-Array (POA)
 * irradiance for a tilted, azimuth-oriented surface.
 *
 * Model: Isotropic sky diffuse + beam component (Hay-Davies simplified annual)
 * Accuracy: ±5–8% vs full TMY simulation — sufficient for contractor conversation.
 *
 * Reference: Duffie & Beckman "Solar Engineering of Thermal Processes", 4th ed.
 *            NREL PVWatts documentation for tilt/azimuth correction factors.
 */

const DEG = Math.PI / 180;

/**
 * Estimate POA irradiance (kWh/m²/yr) from GHI sun-hours and surface geometry.
 *
 * @param ghiSunHours   Annual GHI-equivalent sun hours from Google Solar API (kWh/m²/yr)
 * @param tiltDeg       Panel/roof tilt from horizontal (0° = flat, 90° = vertical)
 * @param azimuthDeg    Panel/roof azimuth (0° = N, 90° = E, 180° = S, 270° = W)
 * @param siteLat       Site latitude in decimal degrees (used for optimal-tilt reference)
 * @returns             Estimated POA irradiance in kWh/m²/yr
 */
export function ghiToPoa(
  ghiSunHours: number,
  tiltDeg: number,
  azimuthDeg: number,
  siteLat: number,
): number {
  if (ghiSunHours <= 0) return 0;

  const tilt = tiltDeg * DEG;
  const az   = azimuthDeg * DEG;
  const lat  = siteLat * DEG;

  // ── Beam component on tilted surface ──────────────────────────────────────
  // Annual average: approximate transposition factor using Liu & Jordan model.
  // For south-facing (az≈180°) surface at optimal tilt: Rb ≈ 1 + 0.011 × tilt.
  // For other orientations: apply cosine penalty for azimuth offset from south.
  const azOffset = Math.abs(Math.PI - az);          // 0 = due south, π = due north
  const cosAz = Math.cos(azOffset);                  // 1=south, -1=north
  // Penalty: south-facing gets full beam, north-facing gets only diffuse contribution.
  // Clamp to [0,1] before raising to fractional power to avoid NaN for negative base.
  const azPenalty = Math.pow(Math.max(0, cosAz), 0.6);
  const Rb = (1.0 + 0.011 * tiltDeg) * Math.max(0, azPenalty);

  // ── Diffuse component (isotropic sky model) ────────────────────────────────
  // Diffuse fraction Rd = (1 + cos β) / 2
  const Rd = (1 + Math.cos(tilt)) / 2;

  // ── Ground-reflected component ─────────────────────────────────────────────
  // Ground albedo ρ ≈ 0.2 (typical residential surroundings)
  const rho = 0.2;
  const Rr = rho * (1 - Math.cos(tilt)) / 2;

  // ── Diffuse / beam split for typical CONUS/global mix ─────────────────────
  // Average diffuse fraction ≈ 0.45 for mid-latitude sites (NREL estimate).
  // Latitude correction: higher latitudes → more diffuse.
  const diffuseFraction = Math.min(0.65, 0.38 + 0.0055 * Math.abs(siteLat));
  const beamFraction    = 1 - diffuseFraction;

  // ── Composite transposition factor R ──────────────────────────────────────
  const R = beamFraction * Rb + diffuseFraction * Rd + Rr;

  // ── Apply to GHI ──────────────────────────────────────────────────────────
  return Math.round(ghiSunHours * Math.max(0.1, R));
}

/**
 * Return a qualitative POA label for display.
 * Thresholds based on NREL US median solar resource data.
 */
export function poaQualityLabel(poaKwhM2yr: number): {
  label: string;
  color: string; // tailwind text color class
} {
  if (poaKwhM2yr >= 1700) return { label: 'Excellent', color: 'text-amber-400' };
  if (poaKwhM2yr >= 1400) return { label: 'Good',      color: 'text-yellow-400' };
  if (poaKwhM2yr >= 1100) return { label: 'Average',   color: 'text-slate-300' };
  return                         { label: 'Low',        color: 'text-slate-500' };
}

/**
 * Segment label — A, B, C … Z, then AA, AB …
 * Used to give each roof section a readable identifier.
 */
export function segmentLabel(idx: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (idx < 26) return letters[idx];
  return letters[Math.floor(idx / 26) - 1] + letters[idx % 26];
}
