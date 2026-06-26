// ============================================================
// Nearmap AI roof plane → Design Studio RoofPlane converter (PURE)
// ============================================================
// Bridges the Nearmap adapter output (NearmapRoofPlane: worldPolygon + pitch +
// material/type, NO azimuth) into the canonical RoofPlane shape that Design
// Studio's 3D scene, CAD engine, and permit/planset rail already consume.
//
// AZIMUTH: Nearmap's 2D AI gives pitch but not per-facet azimuth. Rather than
// fabricate a measured value, we DERIVE a sensible default from the roof outline
// geometry (slope runs perpendicular to the longest/ridge edge, biased toward the
// equator-facing side) and hand it back as confirmed:false so the operator
// reviews/sets it in the existing Roof-Planes confirm UI. This is an editable
// estimate, explicitly not presented as a Nearmap measurement.

import type { RoofPlane } from '@/types';
import { longestEdgeBearing, enrichRoofPlaneWithLECS } from '@/lib/roofGeometry';
import { enrichRoofPlaneWith3DFrame } from '@/lib/surfaceGeometry3D';
import type { NearmapRoofPlane } from '@/lib/aerial/nearmap';

const SQFT_PER_M2 = 10.7639;

/**
 * Derive a default downslope azimuth (compass deg, 0=N clockwise) from the roof
 * outline. The longest edge approximates the ridge; the slope is perpendicular
 * to it. Of the two perpendicular directions we pick the one facing closest to
 * the equator (south in the N hemisphere, north in the S) — the production-
 * favourable default the installer is most likely to confirm.
 */
export function deriveAzimuthFromOutline(
  vertices: { lat: number; lng: number }[],
  centroidLat: number,
): number {
  const ridge = longestEdgeBearing(vertices);          // [0,180)
  const a = (ridge + 90) % 360;
  const b = (ridge + 270) % 360;
  const target = centroidLat >= 0 ? 180 : 0;           // equator-facing
  const dist = (az: number) => Math.abs(((az - target + 540) % 360) - 180);
  return Math.round((dist(a) <= dist(b) ? a : b) * 10) / 10;
}

/** Strip a trailing vertex that just closes the ring (Nearmap rings are closed). */
function openRing(v: { lat: number; lng: number }[]): { lat: number; lng: number }[] {
  if (v.length > 1) {
    const f = v[0], l = v[v.length - 1];
    if (Math.abs(f.lat - l.lat) < 1e-9 && Math.abs(f.lng - l.lng) < 1e-9) return v.slice(0, -1);
  }
  return v;
}

/**
 * Convert one Nearmap AI roof plane into a fully-enriched RoofPlane (LECS + 3D
 * frame attached, same as a manually-drawn plane). confirmed:false so it routes
 * through the operator review/confirm step before it is used for permit output.
 */
export function nearmapPlaneToRoofPlane(np: NearmapRoofPlane, idGen: () => string): RoofPlane {
  const vertices = openRing(np.worldPolygon);
  const centroidLat = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length;
  const areaM2 = np.areaSqft != null ? np.areaSqft / SQFT_PER_M2 : 0;
  const azimuth = np.azimuthDeg ?? deriveAzimuthFromOutline(vertices, centroidLat);

  const base: RoofPlane = {
    id: idGen(),
    vertices,
    pitch: np.pitchDeg ?? 0,
    azimuth,
    area: Math.round(areaM2 * 100) / 100,
    usableArea: Math.round(areaM2 * 0.75 * 100) / 100,
    source: 'aerial_nearmap',
    confirmed: false,
  };
  return enrichRoofPlaneWith3DFrame(enrichRoofPlaneWithLECS(base));
}

/** Convert a batch, in detection order. */
export function nearmapPlanesToRoofPlanes(planes: NearmapRoofPlane[], idGen: () => string): RoofPlane[] {
  return planes.map(p => nearmapPlaneToRoofPlane(p, idGen));
}
