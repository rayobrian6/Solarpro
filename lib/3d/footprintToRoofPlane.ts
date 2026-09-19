/**
 * lib/3d/footprintToRoofPlane.ts
 *
 * THE 2D → 3D BRIDGE. Turn a flat traced outline into a real pitched roof face.
 *
 * WHY THIS EXISTS
 * ---------------
 * Solarpro's roof-face tools (Mark Plane, Custom Array) pick roof corners off
 * Google Photorealistic 3D Tiles and derive the plane's normal — and therefore
 * its pitch and azimuth — from the picked ELEVATIONS. That works beautifully
 * where there is 3D coverage, and not at all where there isn't: every click
 * lands on the WGS84 ellipsoid at h=0, the Newell normal points straight up,
 * and you get a flat plane with an arbitrary grid direction. Rather than fix
 * that, v62 closed the door: both tools refuse to open without a tileset and
 * tell the installer to "pick an address in a 3D-covered region".
 *
 * Aurora and SolarGraph don't need elevation, because they don't measure the
 * slope — they take it from the user and derive everything else from the
 * traced shape. That is what this module does:
 *
 *      flat outline (lat/lng, no heights) + pitch + azimuth
 *          → synthesize a height for every vertex
 *          → a genuinely tilted 3D polygon
 *          → buildRoofPlane3D → a complete RoofPlane
 *
 * The result is indistinguishable downstream from a plane traced on 3D tiles:
 * same type, same frame, same panel-placement grid, same planset consumption.
 *
 * PROVENANCE OF THE MATH
 * ----------------------
 * This is a generalization of `segmentToRoofPlane3D`, which already lives
 * inside SolarEngine3D.tsx and already runs — correctly — on every Auto Fill,
 * converting Google Solar's roof segments (a 2D convex hull plus pitch and
 * azimuth, no elevation) into tilted RoofPlanes. The math was never the gap.
 * It was hardwired to one caller and unreachable from a hand trace.
 *
 * WHY THE AREA COMES OUT RIGHT (the subtle part)
 * -----------------------------------------------
 * A traced outline is the PLAN VIEW of a roof face, not the face itself. The
 * face is longer up the slope by 1/cos(pitch) — on a 39° roof that is 29% more
 * area, and therefore 29% more panels. We get this right for free by lifting
 * the vertices BEFORE fitting the plane: a vertex `d` metres downslope is
 * placed at z = -d·tan(p), so its 3D distance from the anchor is
 *   √(d² + d²tan²p) = d·√(1 + tan²p) = d/cos(p)
 * which is exactly the slope distance. buildRoofPlane3D then measures area in
 * the tilted plane's own UV frame, so it reports true roof area. Lifting AFTER
 * fitting, or tilting a flat polygon in place, would silently under-count.
 *
 * ANCHORING
 * ---------
 * segmentToRoofPlane3D anchors at the face CENTRE, because Google gives it a
 * centre height. A person tracing a roof knows the EAVE height ("the gutter is
 * about 10 feet up"), not the centre height, so this anchors at the eave: the
 * most-downslope vertex sits at `eaveHeightM` above ground and everything else
 * rises from there. Same geometry, an input a human can actually answer.
 */

import type { RoofPlane } from '@/types';
import {
  buildRoofPlane3D,
  computePlaneFromPoints3D,
  latLngToECEF,
  type Cart3,
  type Plane3DFrame,
} from '@/lib/roofPlane3D';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;

/** Slope description supplied by the user (or inferred) rather than measured. */
export interface FootprintSlope {
  /** Roof pitch in degrees from horizontal. 0 = flat. */
  pitchDeg: number;
  /** Downslope compass bearing, 0 = N, clockwise. The direction water runs. */
  azimuthDeg: number;
  /** Height of the LOWEST (eave) edge above local ground, metres. */
  eaveHeightM: number;
  /** Local ground elevation, metres. Pass the viewer's resolved ground elev. */
  groundElevM: number;
}

export interface FootprintPlaneResult {
  plane: RoofPlane;
  /**
   * The fitted frame for the LIFTED points — the same object
   * `computePlaneFromPoints3D` returns on the 3D-tiles path, so the caller
   * renders, maps and fills a footprint-built face through exactly the same
   * code as a mesh-picked one. Computing it here rather than at the call site
   * keeps every bit of geometry inside the tested module.
   */
  frame: Plane3DFrame;
  /** The lifted ECEF points the plane was fitted to, in traced order. */
  liftedPts: Cart3[];
  /**
   * The eave direction as an ENU unit vector {x: east, y: north}. The panel
   * grid uses this as `customDir` so columns run along the eave instead of
   * along whatever edge the most-horizontal-edge heuristic happened to pick —
   * the difference between a tidy array and "panels sideways" on an irregular
   * traced polygon.
   */
  eaveDirENU: { x: number; y: number };
  /** True plane-of-roof area in m², i.e. footprint area / cos(pitch). */
  slopeAreaM2: number;
}

/**
 * Build a face that runs from its own eave UP TO A GIVEN RIDGE LINE AT A GIVEN
 * HEIGHT — the shared-ridge construction.
 *
 * 🚨 WHY THIS EXISTS, AND WHY roofPlaneFromFootprint IS NOT ENOUGH
 * ----------------------------------------------------------------
 * roofPlaneFromFootprint builds each face INDEPENDENTLY: own eave, own pitch,
 * own traced depth. Give two faces the same pitch and different depths — which
 * is what you always get from eyeballed clicks on blurry imagery — and they
 * reach DIFFERENT ridge heights. The roof cannot close. The halves look
 * mismatched, the ridge sits at two heights at once, and the relative height of
 * the two slopes is simply wrong. That is exactly what Ray reported: "these
 * specific roof planes need to be uniform but they are not... I think the
 * relative height and pitch are wrong".
 *
 * A real roof has ONE ridge at ONE height. So the ridge wins, and each face's
 * effective pitch follows from its own depth:
 *
 *     effectivePitch_face = atan( (ridgeHeight - eaveHeight) / depth_face )
 *
 * The deeper half comes out shallower, the shallower half steeper, and they
 * meet exactly. That is not a fudge — it is how an asymmetric roof (a saltbox)
 * genuinely works, and it is the honest reading of an asymmetric trace. The
 * alternative, forcing equal pitch, can only close by moving the user's traced
 * corners, which is not this function's business.
 *
 * @param outline      Traced corners, lat/lng, open ring.
 * @param ridgeA/B     The two ends of the shared ridge, lat/lng.
 * @param ridgeHeightM Ridge height above local ground.
 * @param eaveHeightM  Eave height above local ground.
 * @param groundElevM  Local ground elevation.
 */
export function roofPlaneFromFootprintAndRidge(
  outline: readonly { lat: number; lng: number }[],
  ridgeA: { lat: number; lng: number },
  ridgeB: { lat: number; lng: number },
  opts: { ridgeHeightM: number; eaveHeightM: number; groundElevM: number },
): FootprintPlaneResult | null {
  if (!outline || outline.length < 3) return null;
  const { ridgeHeightM, eaveHeightM, groundElevM } = opts;
  if (![ridgeHeightM, eaveHeightM, groundElevM].every(isFinite)) return null;
  if (!(ridgeHeightM >= eaveHeightM)) return null; // a ridge below its eave is not a roof

  let sumLat = 0, sumLng = 0;
  for (const v of outline) {
    if (!isFinite(v.lat) || !isFinite(v.lng)) return null;
    sumLat += v.lat; sumLng += v.lng;
  }
  const cLat = sumLat / outline.length;
  const cosLat = Math.cos(cLat * DEG);
  const mLng = M_PER_DEG_LAT * (cosLat > 0.01 ? cosLat : 1);

  // Ridge as a line in local metres, measured from ridgeA.
  const toLocal = (v: { lat: number; lng: number }) => ({
    e: (v.lng - ridgeA.lng) * mLng,
    n: (v.lat - ridgeA.lat) * M_PER_DEG_LAT,
  });
  const rb = toLocal(ridgeB);
  const rMag = Math.hypot(rb.e, rb.n);
  if (!(rMag > 0.5)) return null; // a ridge shorter than half a metre is a mis-click
  const re = rb.e / rMag, rn = rb.n / rMag;

  // Perpendicular distance of every vertex from the ridge LINE (signed, then
  // taken as magnitude — the face lies entirely on one side).
  const perp: number[] = [];
  let maxPerp = 0;
  for (const v of outline) {
    const p = toLocal(v);
    const along = p.e * re + p.n * rn;
    const d = Math.hypot(p.e - along * re, p.n - along * rn);
    perp.push(d);
    if (d > maxPerp) maxPerp = d;
  }
  if (!(maxPerp > 0.5)) return null; // degenerate: the whole face sits on the ridge

  // Linear fall from the ridge to the furthest (eave) vertex. Linear in
  // perpendicular distance IS a plane, so the face stays coplanar.
  const fall = (ridgeHeightM - eaveHeightM) / maxPerp;
  const baseH = groundElevM + ridgeHeightM;
  const pts3D = outline.map((v, i) => latLngToECEF(v.lat, v.lng, baseH - perp[i] * fall));

  let plane: RoofPlane;
  let frame: Plane3DFrame;
  try {
    frame = computePlaneFromPoints3D(pts3D);
    plane = buildRoofPlane3D(pts3D);
  } catch {
    return null;
  }

  // Downslope is perpendicular to the ridge, pointing away from it toward the
  // face's own centroid — the same rule the shared-edge azimuth derivation uses.
  const cMid = toLocal({ lat: cLat, lng: sumLng / outline.length });
  const alongC = cMid.e * re + cMid.n * rn;
  const de = cMid.e - alongC * re, dn = cMid.n - alongC * rn;
  const dMag = Math.hypot(de, dn);
  const azimuthDeg = dMag > 1e-6
    ? ((Math.atan2(de / dMag, dn / dMag) * 180 / Math.PI) % 360 + 360) % 360
    : 180;
  const pitchDeg = Math.atan(fall) * 180 / Math.PI;

  plane.pitch = clampPitch(pitchDeg);
  plane.azimuth = normalizeAzimuth(azimuthDeg);

  const azR = plane.azimuth * DEG;
  return {
    plane,
    frame,
    liftedPts: pts3D,
    eaveDirENU: { x: Math.cos(azR), y: -Math.sin(azR) },
    slopeAreaM2: plane.area,
  };
}

/** Clamp to the range buildRoofPlane3D itself enforces, so callers see one rule. */
export function clampPitch(pitchDeg: number): number {
  if (!isFinite(pitchDeg)) return 0;
  return Math.max(0, Math.min(60, pitchDeg));
}

/** Normalize any bearing into [0, 360). */
export function normalizeAzimuth(azDeg: number): number {
  if (!isFinite(azDeg)) return 180;
  return ((azDeg % 360) + 360) % 360;
}

/**
 * Build a pitched 3D RoofPlane from a flat traced outline plus a slope.
 *
 * Returns null — never throws and never guesses — when the outline cannot
 * describe a face: fewer than 3 vertices, or a degenerate sliver under 0.5 m in
 * either direction. Callers surface that as "trace at least 3 corners", which
 * is actionable, rather than rendering a shard.
 *
 * @param outline Traced corners in order, open ring (no repeated last vertex).
 *                Heights are ignored entirely — only lat/lng are read, which is
 *                precisely why this works with no 3D coverage.
 */
export function roofPlaneFromFootprint(
  outline: readonly { lat: number; lng: number }[],
  slope: FootprintSlope,
): FootprintPlaneResult | null {
  if (!outline || outline.length < 3) return null;

  const pitch = clampPitch(slope.pitchDeg);
  const az = normalizeAzimuth(slope.azimuthDeg);
  const groundElevM = isFinite(slope.groundElevM) ? slope.groundElevM : 0;
  const eaveHeightM = isFinite(slope.eaveHeightM) ? slope.eaveHeightM : 3.0;

  // Centroid in lat/lng — the local tangent-plane origin for the metre math.
  let sumLat = 0, sumLng = 0;
  for (const v of outline) {
    if (!isFinite(v.lat) || !isFinite(v.lng)) return null;
    sumLat += v.lat; sumLng += v.lng;
  }
  const cLat = sumLat / outline.length;
  const cLng = sumLng / outline.length;

  const cosLat = Math.cos(cLat * DEG);
  const mLng = M_PER_DEG_LAT * (cosLat > 0.01 ? cosLat : 1);

  // Downslope and eave (cross-slope) horizontal unit vectors in (East, North).
  // Downslope points along the azimuth; the eave is perpendicular to it.
  const dsE = Math.sin(az * DEG), dsN = Math.cos(az * DEG);
  const evE = Math.cos(az * DEG), evN = -Math.sin(az * DEG);

  // Project every vertex onto those two axes, in metres from the centroid.
  const along: number[] = [];   // + = further DOWNslope = lower
  let minEv = Infinity, maxEv = -Infinity;
  let minAlong = Infinity, maxAlong = -Infinity;
  for (const v of outline) {
    const dE = (v.lng - cLng) * mLng;
    const dN = (v.lat - cLat) * M_PER_DEG_LAT;
    const ev = dE * evE + dN * evN;
    const sl = dE * dsE + dN * dsN;
    along.push(sl);
    if (ev < minEv) minEv = ev;
    if (ev > maxEv) maxEv = ev;
    if (sl < minAlong) minAlong = sl;
    if (sl > maxAlong) maxAlong = sl;
  }

  // Reject degenerate slivers. A face narrower than half a metre in either
  // direction is a mis-click, not a roof, and would produce a shard that
  // panels cannot sit on. Same threshold segmentToRoofPlane3D uses.
  if (!(maxEv - minEv > 0.5)) return null;
  if (!(maxAlong - minAlong > 0.5)) return null;

  // Lift each vertex. The most-downslope vertex (maxAlong) is the eave and sits
  // at eaveHeightM; everything else rises by its distance UP the slope.
  // Lifting before the fit is what makes the area come out as true slope area
  // rather than footprint area — see the header note.
  const tanP = Math.tan(pitch * DEG);
  const baseH = groundElevM + eaveHeightM;
  const pts3D = outline.map((v, i) =>
    latLngToECEF(v.lat, v.lng, baseH + (maxAlong - along[i]) * tanP),
  );

  let plane: RoofPlane;
  let frame: Plane3DFrame;
  try {
    // Same two calls, same order, as the 3D-tiles path in finalizePlane3D.
    frame = computePlaneFromPoints3D(pts3D);
    plane = buildRoofPlane3D(pts3D);
  } catch {
    // These throw on collinear input that survived the extent checks above.
    // Treat it as "not a face" rather than propagating.
    return null;
  }

  // buildRoofPlane3D re-derives pitch and azimuth from the fitted normal. For a
  // synthesized face those must round-trip to what the user asked for; pin the
  // user's values so a 0.1° fitting residual never shows up as a different
  // number in the sidebar than the one they typed.
  plane.pitch = pitch;
  plane.azimuth = az;

  return {
    plane,
    frame,
    liftedPts: pts3D,
    eaveDirENU: { x: evE, y: evN },
    slopeAreaM2: plane.area,
  };
}
