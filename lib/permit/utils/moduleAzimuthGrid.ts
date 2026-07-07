// ═══════════════════════════════════════════════════════════════
// Module-rotation regularizer for the PV-1 site plan.
//
// PV-1 draws each module rotate(azimuth). Hand-traced roof planes carry ~3°
// of azimuth noise, so opposite slopes of ONE ridge aren't exact opposites
// (Melvin: N plane 3.2° vs S plane 180.1°) and the two arrays render a few
// degrees out of parallel — the top array looks canted off the eave even
// though each array is parallel to its own plane (Ray, 2026-07-06:
// "straighter to the edge of the roof").
//
// This snaps every module's DRAW rotation to the building's principal 90°
// grid so all arrays share one orientation (parallel / antiparallel) and,
// when the building sits square to N/S/E/W (the common case), land exactly on
// the sheet axes — matching PV-2's regularized 0/180/270/90. Display-only
// tidying, same spirit as regularizeRoofPlanes; genuine off-grid azimuths
// (e.g. a 45° hip array) beyond the snap tolerance keep their real value.
// ═══════════════════════════════════════════════════════════════

/** Building axis within this many degrees of a cardinal ⇒ treat as square. */
export const AZ_CARDINAL_TOL = 6;
/** Only snap a module whose azimuth is within this of its grid point. */
export const AZ_SNAP_TOL = 10;

/**
 * Principal-axis offset in [0,90) for a set of module azimuths, or null when
 * there aren't enough. Uses a length-neutral doubled-angle (×4, period 90)
 * circular mean so 0° and 90° reinforce instead of cancel. A result within
 * AZ_CARDINAL_TOL of a cardinal collapses to exactly 0 (a near-square building
 * is treated as square; the residual is trace noise).
 */
export function computeModuleAzimuthGrid(azimuths: number[]): number | null {
  let sx = 0, sy = 0, n = 0;
  for (const az of azimuths) {
    if (!isFinite(az)) continue;
    const r4 = 4 * az * Math.PI / 180;
    sx += Math.cos(r4); sy += Math.sin(r4); n++;
  }
  if (n < 3) return null;
  let off = Math.atan2(sy, sx) / 4 * 180 / Math.PI;   // (−45, 45]
  off = ((off % 90) + 90) % 90;                        // → [0, 90)
  if (Math.min(off, 90 - off) <= AZ_CARDINAL_TOL) off = 0;
  return off;
}

/**
 * Snap one azimuth to the nearest point of the {offset + k·90} grid, but only
 * when it's within AZ_SNAP_TOL of that point — a genuinely off-grid array
 * keeps its real azimuth. `offset === null` (indeterminate grid) is a no-op.
 */
export function snapModuleAzimuth(az: number, offset: number | null): number {
  if (offset === null || !isFinite(az)) return az;
  const s = Math.round((az - offset) / 90) * 90 + offset;
  const diff = Math.abs(((s - az + 540) % 360) - 180);   // shortest angular delta
  return diff <= AZ_SNAP_TOL ? s : az;
}
