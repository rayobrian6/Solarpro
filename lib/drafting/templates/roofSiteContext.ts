// ============================================================================
// PV-2 Site Context — property line, street, driveway & sidewalk drawn INTO the
// main roof plan (NOT a separate inset). The roof plan works in "fake-degree"
// CAD units (1 unit ≈ 1 ft, origin-relative). This module converts the real
// county-GIS parcel + geocoded street into that SAME frame using the CAD model's
// originLat/originLng, so the lot renders to-scale around the roof — the way a
// professional site plan integrates the two (Ray, 2026-07-08).
//
// Honesty rules kept from the reference-set discipline:
//   • Property line comes from county-GIS geometry → labeled APPROXIMATE.
//   • Driveway & sidewalk are DERIVED (frontage inference), not surveyed →
//     labeled APPROXIMATE — FIELD VERIFY. They are drawn lightly/schematically
//     so an off-by-a-bit read as site context, not a survey claim.
// Everything here activates ONLY when a real parcel boundary is present; with no
// parcel the roof plan is rendered exactly as before (no fabricated lot).
// ============================================================================

import { latLngToXY } from '@/lib/cad/geometry';
import { locateEquipment } from '@/lib/permit/utils/equipmentLocator';
import { ftToFtIn } from '../primitives';

const M_TO_FT = 3.280_839_895;
const FAKE_DEG_OFFSET = 10; // must match lib/cad/adapter.ts xyToFakeDeg

export interface FakePt { lat: number; lng: number } // fake-degree (1 unit ≈ 1 ft)
export interface XY { x: number; y: number }

/** Real lat/lng → fake-degree, EXACTLY as the CAD adapter encodes roof geometry. */
export function latLngToFakeDeg(
  lat: number, lng: number, originLat: number, originLng: number,
): FakePt {
  const xy = latLngToXY(lat, lng, originLat, originLng);
  return { lat: xy.y * M_TO_FT + FAKE_DEG_OFFSET, lng: xy.x * M_TO_FT + FAKE_DEG_OFFSET };
}

export interface SiteRoadFake { name: string | null; klass: string; pts: FakePt[] }

export interface SiteContext {
  parcel: FakePt[] | null;          // parcel ring in fake-degrees (null when no parcel)
  roads: SiteRoadFake[];            // road centerlines (OSM polylines), fake-degrees
  buildings: FakePt[][];            // building footprints (OSM or Nearmap), fake-degrees
  // Nearmap AI ground surfaces (filled polygons) — present when Nearmap AI ran;
  // real driveways / walks-&-pads / road surface, far better than OSM.
  driveways: FakePt[][];
  paved: FakePt[][];
  roadSurfaces: FakePt[][];
  lawn: FakePt[][];                 // grass / pervious softscape (Nearmap)
  trees: FakePt[][];                // tall vegetation — shading (Nearmap)
  equipment: Array<{ kind: string; pt: FakePt; provenance: string }>;   // UM/MSP/AC on the wall
  source: string;                   // e.g. "County GIS" / "Nearmap AI"
  hasNearmap: boolean;              // Nearmap surfaces drove the site layer
  streetName: string | null;
  apn: string | null;
}

/** Pull the parcel + real site features off the PermitInput and project into the
 *  roof's frame. Returns null only when there's NOTHING to draw (no parcel AND no
 *  site features) or no CAD origin → roof-only render. */
export function buildSiteContext(
  cad: { originLat?: number; originLng?: number } | null | undefined,
  permitInput: unknown,
): SiteContext | null {
  const originLat = cad?.originLat, originLng = cad?.originLng;
  if (originLat == null || originLng == null || !isFinite(originLat) || !isFinite(originLng)
      || Math.abs(originLat) < 0.001) return null;

  const pi = permitInput as {
    aerialData?: {
      parcel?: { polygon?: Array<{ lat: number; lng: number }>; apn?: string | null; source?: string };
      siteFeatures?: {
        roads?: Array<{ name?: string | null; klass?: string; points?: Array<{ lat: number; lng: number }> }>;
        buildings?: Array<{ points?: Array<{ lat: number; lng: number }> }>;
      };
      nearmapSurfaces?: {
        buildings?: Array<Array<{ lat: number; lng: number }>>;
        driveways?: Array<Array<{ lat: number; lng: number }>>;
        paved?: Array<Array<{ lat: number; lng: number }>>;
        roads?: Array<Array<{ lat: number; lng: number }>>;
        lawn?: Array<Array<{ lat: number; lng: number }>>;
        trees?: Array<Array<{ lat: number; lng: number }>>;
      };
    };
    project?: {
      address?: string; lat?: number; lng?: number;
      roofPlanes?: Array<{ vertices?: Array<{ lat: number; lng: number }> }>;
      surveyPhotoHints?: unknown[];
    };
  } | null;

  const toFake = (v: { lat: number; lng: number }) => latLngToFakeDeg(v.lat, v.lng, originLat, originLng);
  const clean = (a?: Array<{ lat: number; lng: number }>) =>
    (a ?? []).filter(v => isFinite(v?.lat) && isFinite(v?.lng) && Math.abs(v.lat) > 0.001);
  const ringsToFake = (rings?: Array<Array<{ lat: number; lng: number }>>): FakePt[][] =>
    (rings ?? []).map(r => clean(r).map(toFake)).filter(r => r.length >= 3);

  const ring = clean(pi?.aerialData?.parcel?.polygon);
  const parcel = ring.length >= 3 ? ring.map(toFake) : null;

  // Prefer Nearmap AI surfaces (real driveways/walks/paving/footprints from
  // aerial); fall back to OSM (footprints + road centerlines, no surfaces).
  const nm = pi?.aerialData?.nearmapSurfaces;
  const hasNearmap = !!nm && ((nm.buildings?.length ?? 0) + (nm.driveways?.length ?? 0) + (nm.paved?.length ?? 0) + (nm.roads?.length ?? 0) > 0);

  const driveways = hasNearmap ? ringsToFake(nm!.driveways) : [];
  const paved = hasNearmap ? ringsToFake(nm!.paved) : [];
  const roadSurfaces = hasNearmap ? ringsToFake(nm!.roads) : [];
  const lawn = hasNearmap ? ringsToFake(nm!.lawn) : [];
  const trees = hasNearmap ? ringsToFake(nm!.trees) : [];
  const buildings: FakePt[][] = hasNearmap
    ? ringsToFake(nm!.buildings)
    : (pi?.aerialData?.siteFeatures?.buildings ?? []).map(b => clean(b.points).map(toFake)).filter(b => b.length >= 3);
  const roads: SiteRoadFake[] = hasNearmap ? [] : (pi?.aerialData?.siteFeatures?.roads ?? [])
    .map(r => ({ name: r.name ?? null, klass: r.klass || 'road', pts: clean(r.points).map(toFake) }))
    .filter(r => r.pts.length >= 2);

  if (!parcel && !roads.length && !buildings.length && !driveways.length && !paved.length && !roadSurfaces.length) return null;

  const proj = pi?.project ?? {};
  const streetName = (proj.address || '').split(',')[0]
    .replace(/^\s*\d+\s+/, '').replace(/\b(apt|unit|ste|#)\.?\s*\S*$/i, '').trim().toUpperCase() || null;

  // ── Service equipment (meter / MSP / AC disconnect) located on the building
  // wall from labeled survey photos (GPS) or the street-side heuristic, then
  // projected into this frame — same locator PV-1 uses. ──
  const realRing = clean((proj.roofPlanes ?? []).flatMap(rp => rp.vertices ?? []));
  const realPin = (isFinite(proj.lat as number) && isFinite(proj.lng as number) && Math.abs(proj.lat as number) > 0.001)
    ? { lat: proj.lat as number, lng: proj.lng as number } : null;
  const equipment = realRing.length >= 3
    ? locateEquipment(realRing, realPin, (proj.surveyPhotoHints ?? []) as never[])
        .map(e => ({ kind: e.kind, pt: latLngToFakeDeg(e.lat, e.lng, originLat, originLng), provenance: e.provenance }))
    : [];

  return {
    parcel,
    roads,
    buildings,
    driveways,
    paved,
    roadSurfaces,
    lawn,
    trees,
    equipment,
    hasNearmap,
    streetName,
    apn: pi?.aerialData?.parcel?.apn ?? null,
    source: hasNearmap ? 'Nearmap AI' : (pi?.aerialData?.parcel?.source || 'COUNTY GIS'),
  };
}

/** Axis-aligned bbox of a fake-degree ring. */
export function fakeBbox(pts: FakePt[]): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  const lngs = pts.map(p => p.lng), lats = pts.map(p => p.lat);
  return { minLng: Math.min(...lngs), maxLng: Math.max(...lngs), minLat: Math.min(...lats), maxLat: Math.max(...lats) };
}

/**
 * Fit window (fake-degrees) that includes the roof AND as much parcel as fits
 * without shrinking the roof below a floor. On a normal lot the whole parcel
 * shows; on a huge lot the window is capped so the building can't become a dot
 * (nearest property lines still show; SVG clips the rest).
 */
export function computeFitWindow(
  roof: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  contextPts: FakePt[],
  opts?: { maxZoomOut?: number; marginFt?: number },
): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  const maxZoomOut = opts?.maxZoomOut ?? 2.6;  // roof stays ≥ ~1/maxZoomOut of the window
  const marginFt = opts?.marginFt ?? 6;
  const cxLng = (roof.minLng + roof.maxLng) / 2, cyLat = (roof.minLat + roof.maxLat) / 2;
  const halfW = (roof.maxLng - roof.minLng) / 2 || 1, halfH = (roof.maxLat - roof.minLat) / 2 || 1;
  const capW = halfW * maxZoomOut, capH = halfH * maxZoomOut;
  // Expand toward each context point (parcel corners, neighbor buildings), but
  // clamp each contribution to the cap so a far feature can't shrink the roof.
  let minLng = roof.minLng, maxLng = roof.maxLng, minLat = roof.minLat, maxLat = roof.maxLat;
  for (const p of contextPts) {
    minLng = Math.min(minLng, Math.max(p.lng, cxLng - capW));
    maxLng = Math.max(maxLng, Math.min(p.lng, cxLng + capW));
    minLat = Math.min(minLat, Math.max(p.lat, cyLat - capH));
    maxLat = Math.max(maxLat, Math.min(p.lat, cyLat + capH));
  }
  return { minLng: minLng - marginFt, maxLng: maxLng + marginFt, minLat: minLat - marginFt, maxLat: maxLat + marginFt };
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL PLAN ROTATION (Ray 2026-07-11: "system is cocking everything to the
// side"). Professional sets square the BUILDING to the sheet and rotate the
// north arrow. ONE angle is derived from the dominant roof axis and applied to
// EVERY drawn layer — plane polygons, module rects, setback bands, site
// context, hybrid overlays, obstructions — so inter-layer bearings (fence vs
// building vs rows) are preserved exactly. drawRoofPlan applies it as a
// fake-degree pre-transform (before the toX/toY pixel mapping), which keeps
// all text horizontal and lets the fit window recompute on rotated extents.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dominant building-axis tilt in degrees CCW from sheet-horizontal, folded to
 * (-45°, 45°] — length-weighted vector mean of the plane edges' doubled-doubled
 * angles (4·angle, so 0° and 90° edges reinforce; same fold regularizeRoof
 * uses to straighten linework). |tilt| < identityDeg returns EXACTLY 0 so an
 * axis-aligned building renders through the identity transform.
 */
export function computePlanTiltDeg(
  planes: Array<{ vertices?: FakePt[] }>,
  opts?: { identityDeg?: number },
): number {
  let sx = 0, sy = 0;
  for (const pl of planes ?? []) {
    const vs = pl.vertices ?? [];
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) continue;
      const dx = b.lng - a.lng, dy = b.lat - a.lat;
      const len = Math.hypot(dx, dy);
      if (len < 2) continue;               // fake-deg = ft; skip sliver edges
      const ang4 = Math.atan2(dy, dx) * 4;
      sx += Math.cos(ang4) * len; sy += Math.sin(ang4) * len;
    }
  }
  if (sx === 0 && sy === 0) return 0;
  const tilt = (Math.atan2(sy, sx) / 4) * 180 / Math.PI;   // (-45, 45]
  return Math.abs(tilt) < (opts?.identityDeg ?? 0.75) ? 0 : tilt;
}

/**
 * The rotation (deg CCW, fake-degree space) that squares the building to the
 * sheet. Two candidates square it — minimal rotation (−tilt) or the long axis
 * turned onto the other sheet axis (−tilt ± 90) — and the one whose ROTATED
 * subject extents fit the draw window at the larger scale wins. Ties (≤3%) go
 * to the smaller |rotation| so north stays up-ish, like the pro references.
 */
export function choosePlanRotationDeg(
  tiltDeg: number,
  subjectPts: FakePt[],
  availW: number,
  availH: number,
): number {
  if (tiltDeg === 0) return 0;
  const primary = -tiltDeg;
  if (!subjectPts.length || !(availW > 0) || !(availH > 0)) return primary;
  let alt = primary + 90;
  if (alt > 90) alt -= 180;
  const scaleFor = (deg: number): number => {
    const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of subjectPts) {
      const x = p.lng * c - p.lat * s, y = p.lng * s + p.lat * c;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return Math.min(availW / Math.max(maxX - minX, 1), availH / Math.max(maxY - minY, 1));
  };
  return scaleFor(alt) > scaleFor(primary) * 1.03 ? alt : primary;
}

/** Rotate a fake-degree point by angleDeg CCW about a pivot (1 unit = 1 ft on
 *  both axes, so a plain 2D rotation is exact — no cos-lat correction). */
export function rotateFakePt(p: FakePt, angleDeg: number, pivot: FakePt): FakePt {
  if (angleDeg === 0) return { lat: p.lat, lng: p.lng };
  const th = angleDeg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const x = p.lng - pivot.lng, y = p.lat - pivot.lat;
  return { lng: pivot.lng + x * c - y * s, lat: pivot.lat + x * s + y * c };
}

/** Compass azimuth after the plan rotation: rotating the geometry CCW by θ
 *  turns a bearing A into A − θ (bearing measured clockwise from +lat north). */
export function rotateAzimuthDeg(az: number, planRotDeg: number): number {
  return ((az - planRotDeg) % 360 + 360) % 360;
}

/** SVG rotation (clockwise, y-down screen space) for the north arrow — the
 *  SAME angle constant every layer used, sign-flipped once for the screen
 *  frame. Identity plan rotation → identity north arrow. */
export function northArrowRotationDeg(planRotDeg: number): number {
  return planRotDeg === 0 ? 0 : -planRotDeg;
}

/** Rotate every drawn site-context layer through the SAME plan transform.
 *  Pure — returns a new SiteContext; the input (shared with other sheets that
 *  draw north-up) is untouched. */
export function rotateSiteContext(site: SiteContext, angleDeg: number, pivot: FakePt): SiteContext {
  if (angleDeg === 0) return site;
  const r = (p: FakePt) => rotateFakePt(p, angleDeg, pivot);
  const rings = (rs: FakePt[][]) => rs.map(ring => ring.map(r));
  return {
    ...site,
    parcel: site.parcel ? site.parcel.map(r) : null,
    roads: site.roads.map(rd => ({ ...rd, pts: rd.pts.map(r) })),
    buildings: rings(site.buildings),
    driveways: rings(site.driveways),
    paved: rings(site.paved),
    roadSurfaces: rings(site.roadSurfaces),
    lawn: rings(site.lawn),
    trees: rings(site.trees),
    equipment: site.equipment.map(e => ({ ...e, pt: r(e.pt) })),
  };
}

const esc = (s: string) => String(s).replace(/&(?![a-zA-Z0-9#]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Point→segment distance (fake-degree space). */
function ptSegDist(p: FakePt, a: FakePt, b: FakePt): number {
  const abx = b.lng - a.lng, aby = b.lat - a.lat;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.lng - a.lng) * abx + (p.lat - a.lat) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.lng - (a.lng + t * abx), p.lat - (a.lat + t * aby));
}

/** Liang-Barsky clip of segment a→b to a fake-degree window. Null = fully out. */
function clipSegToWin(
  a: FakePt, b: FakePt,
  win: { minLng: number; maxLng: number; minLat: number; maxLat: number },
): [FakePt, FakePt] | null {
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  let t0 = 0, t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.lng - win.minLng], [dx, win.maxLng - a.lng],
    [-dy, a.lat - win.minLat], [dy, win.maxLat - a.lat],
  ];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [
    { lng: a.lng + t0 * dx, lat: a.lat + t0 * dy },
    { lng: a.lng + t1 * dx, lat: a.lat + t1 * dy },
  ];
}

/** Point-in-ring (fake-degree), ray cast. */
function ptInFakeRing(p: FakePt, ring: FakePt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat, xj = ring[j].lng, yj = ring[j].lat;
    if (((yi > p.lat) !== (yj > p.lat)) && (p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function ringArea2(P: FakePt[]): number {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    s += a.lng * b.lat - b.lng * a.lat;
  }
  return s;   // signed ×2
}

/**
 * Inward offset ("setback ring") of a parcel polygon by d ft — miter join via
 * offset-line intersection. GEOMETRY-ONLY derivation from the county-GIS ring;
 * returns null whenever the result is degenerate (self-fold, vertex escaping
 * the parcel, miter explosion) so we never draw a wrong ring. Good for the
 * simple convex-ish lots parcels actually are; weird lots simply skip it.
 */
export function insetParcelRing(P0: FakePt[], d: number): FakePt[] | null {
  // drop consecutive near-duplicate vertices (they break edge normals)
  const P: FakePt[] = [];
  for (const p of P0) {
    const prev = P[P.length - 1];
    if (!prev || Math.hypot(p.lng - prev.lng, p.lat - prev.lat) > 1) P.push(p);
  }
  while (P.length > 1 && Math.hypot(P[0].lng - P[P.length - 1].lng, P[0].lat - P[P.length - 1].lat) <= 1) P.pop();
  const n = P.length;
  if (n < 3 || !(d > 0)) return null;
  const a2 = ringArea2(P);
  if (Math.abs(a2) < 4 * d * d) return null;      // lot too small vs the offset
  const ccw = a2 > 0;
  const lines: Array<{ px: number; py: number; dx: number; dy: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const dx = b.lng - a.lng, dy = b.lat - a.lat;
    const L = Math.hypot(dx, dy);
    // inward normal: left of travel when CCW, right when CW
    const nx = (ccw ? -dy : dy) / L, ny = (ccw ? dx : -dx) / L;
    lines.push({ px: a.lng + nx * d, py: a.lat + ny * d, dx, dy });
  }
  const out: FakePt[] = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n], B = lines[i];
    const den = A.dx * B.dy - A.dy * B.dx;
    if (Math.abs(den) < 1e-9) { out.push({ lng: B.px, lat: B.py }); continue; }
    const t = ((B.px - A.px) * B.dy - (B.py - A.py) * B.dx) / den;
    out.push({ lng: A.px + t * A.dx, lat: A.py + t * A.dy });
  }
  // validate: shrunk area, every vertex inside the parcel, miter sanity
  const outA2 = ringArea2(out);
  if (!(Math.abs(outA2) > 0) || Math.abs(outA2) >= Math.abs(a2)) return null;
  for (let i = 0; i < n; i++) {
    if (!ptInFakeRing(out[i], P)) return null;
    if (Math.hypot(out[i].lng - P[i].lng, out[i].lat - P[i].lat) > 8 * d) return null;
  }
  return out;
}

export interface SiteRender { els: string[]; legend: Array<{ swatch: string; label: string }> }

/**
 * Emit the integrated site layer, drawn UNDER the roof (roof linework paints on
 * top). All geometry is fake-degrees (1 unit ≈ 1 ft) projected through the roof
 * plan's own toX/toY so it registers exactly with the roof.
 */
export function drawSiteContextEls(
  site: SiteContext,
  roof: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  toX: (lng: number) => number,
  toY: (lat: number) => number,
  opts?: {
    /** Ground/fence array setback from property line (ft) — comes from the SAME
     *  engine value the ground/fence sheets print (CADGroundModel.setbackFt /
     *  layout.groundSetbackFt). Draws the dashed inner offset ring. Never a
     *  number invented here. */
    plSetbackFt?: number | null;
    /** The sheet's fit window (fake-deg) — labels are placed on the VISIBLE
     *  portion of clipped parcel edges so big-lot framing can't push every
     *  dimension off-frame. */
    fitWin?: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null;
    /** false → polygons/parcel-line ONLY (roads, sidewalks, trees, buildings,
     *  driveways, the dashed property line). Suppresses every annotation:
     *  edge dims, PROPERTY LINE tags, setback ring, setback dims, fallback
     *  note, service cluster. PV-1B wants the PV-1 site VISUALS behind its
     *  wiring, not the PV-1 furniture (Ray, 2026-07-20). Default true. */
    annotations?: boolean;
  },
): SiteRender {
  const els: string[] = [];
  const legend: SiteRender['legend'] = [];
  const px = (p: FakePt): XY => ({ x: toX(p.lng), y: toY(p.lat) });
  const polyStr = (b: FakePt[]) => b.map(p => { const q = px(p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');
  const inRoof = (lng: number, lat: number) =>
    lng >= roof.minLng && lng <= roof.maxLng && lat >= roof.minLat && lat <= roof.maxLat;
  // De-noise / subject emphasis: fade discrete features (neighbor buildings,
  // trees) by distance from the subject so its immediate context reads crisp and
  // the far complex recedes to context. 1.0 near → 0.4 far.
  const _rcLng = (roof.minLng + roof.maxLng) / 2, _rcLat = (roof.minLat + roof.maxLat) / 2;
  const _rHalf = Math.max(roof.maxLng - roof.minLng, roof.maxLat - roof.minLat) / 2 || 20;
  const fadeAt = (lng: number, lat: number) => {
    const d = Math.hypot(lng - _rcLng, lat - _rcLat);
    const near = _rHalf * 1.8, far = _rHalf * 3.6;
    return d <= near ? 1 : d >= far ? 0.4 : 1 - 0.6 * (d - near) / (far - near);
  };

  // ── SOFTSCAPE base: lawn / pervious (light green), drawn UNDER everything so
  // the site reads as landscape, not a gray hardscape sea (Nearmap AI). ──
  if (site.lawn.length) {
    for (const s of site.lawn) els.push(`<polygon points="${polyStr(s)}" fill="#e7f0e3" stroke="none"/>`);
    legend.push({ swatch: `<rect x="0" y="-4" width="14" height="8" fill="#e7f0e3" stroke="#bcd3b2" stroke-width="0.5"/>`, label: 'LAWN / PERVIOUS (NEARMAP AI)' });
  }

  // ── 0) Nearmap AI ground surfaces (REAL, filled) — drawn bottom-up so driveways
  // read on top of general paving: road surface → walks/pads → driveways. These
  // come from actual aerial AI (not OSM/guesses); clipped to the draw zone.
  // Driveways get a diagonal HATCH (the standard site-plan treatment) so they're
  // unmistakable; roads/walks are solid grays with clear outlines. ──
  if (site.driveways.length || site.paved.length || site.roadSurfaces.length) {
    els.push(`<defs><pattern id="nm-drive" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#d5dae1"/><line x1="0" y1="0" x2="0" y2="5" stroke="#8b93a0" stroke-width="0.7"/></pattern></defs>`);
  }
  if (site.roadSurfaces.length) {
    let big = site.roadSurfaces[0], bigA = -1;
    for (const s of site.roadSurfaces) {
      els.push(`<polygon points="${polyStr(s)}" fill="#d3d8df" stroke="#a3abb6" stroke-width="0.7"/>`);
      const xs = s.map(p => p.lng), ys = s.map(p => p.lat);
      const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      if (a > bigA) { bigA = a; big = s; }
    }
    if (site.streetName) {
      const cx = big.reduce((s, p) => s + px(p).x, 0) / big.length;
      const cy = big.reduce((s, p) => s + px(p).y, 0) / big.length;
      els.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="7" font-weight="900" letter-spacing="1.5" fill="#4a4f57" stroke="#fff" stroke-width="1.8" paint-order="stroke">${esc(site.streetName)}</text>`);
    }
    legend.push({ swatch: `<rect x="0" y="-4" width="14" height="8" fill="#d3d8df" stroke="#a3abb6" stroke-width="0.7"/>`, label: 'ROAD (NEARMAP AI)' });
  }
  for (const s of site.paved) els.push(`<polygon points="${polyStr(s)}" fill="#e6e9ee" stroke="#c0c6cf" stroke-width="0.5"/>`);
  if (site.paved.length) legend.push({ swatch: `<rect x="0" y="-4" width="14" height="8" fill="#e6e9ee" stroke="#c0c6cf" stroke-width="0.5"/>`, label: 'WALK / PAVING (NEARMAP AI)' });
  if (site.driveways.length) {
    // Merge/label: hatch each driveway polygon; label the largest one.
    let dBig = site.driveways[0], dA = -1;
    for (const s of site.driveways) {
      els.push(`<polygon points="${polyStr(s)}" fill="url(#nm-drive)" stroke="#7f8894" stroke-width="0.9"/>`);
      const xs = s.map(p => p.lng), ys = s.map(p => p.lat);
      const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      if (a > dA) { dA = a; dBig = s; }
    }
    const dcx = dBig.reduce((s, p) => s + px(p).x, 0) / dBig.length;
    const dcy = dBig.reduce((s, p) => s + px(p).y, 0) / dBig.length;
    els.push(`<text x="${dcx.toFixed(1)}" y="${dcy.toFixed(1)}" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.4" font-weight="bold" fill="#4a4f57" stroke="#fff" stroke-width="1.4" paint-order="stroke">DRIVEWAY</text>`);
    legend.push({ swatch: `<rect x="0" y="-4" width="14" height="8" fill="url(#nm-drive)" stroke="#7f8894" stroke-width="0.9"/>`, label: 'DRIVEWAY (NEARMAP AI)' });
  }

  // ── 1) REAL surrounding building footprints (OSM) — the "reality around the
  // home". The SUBJECT building (footprint centroid inside the roof bbox) is
  // skipped: the detailed roof/array is drawn on top of it. Neighbors read as
  // light-gray context so the sheet shows "this building, in this complex". ──
  let drewBuilding = false;
  for (const b of site.buildings) {
    if (b.length < 3) continue;
    const cLng = b.reduce((s, p) => s + p.lng, 0) / b.length;
    const cLat = b.reduce((s, p) => s + p.lat, 0) / b.length;
    if (inRoof(cLng, cLat)) continue; // subject building — roof draws over it
    const pts = b.map(p => { const q = px(p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');
    els.push(`<polygon points="${pts}" fill="#f1f3f5" stroke="#7f8894" stroke-width="1.0" opacity="${fadeAt(cLng, cLat).toFixed(2)}"/>`);
    drewBuilding = true;
  }
  if (drewBuilding) legend.push({ swatch: `<rect x="0" y="-4" width="14" height="8" fill="#f1f3f5" stroke="#7f8894" stroke-width="1.0"/>`, label: 'EXISTING BUILDING' });

  // ── TREE CANOPY (tall vegetation >2m, Nearmap) — semi-transparent green so the
  // ground/structures show through. A canopy reaching the roof is a SHADING flag
  // (relevant to production + AHJ); it's outlined amber-dashed and noted. ──
  if (site.trees.length) {
    const rPad = 6; // ft — "near the array" tolerance for a shading flag
    let shades = false;
    for (const t of site.trees) {
      const over = t.some(p => p.lng >= roof.minLng - rPad && p.lng <= roof.maxLng + rPad && p.lat >= roof.minLat - rPad && p.lat <= roof.maxLat + rPad);
      if (over) shades = true;
      const tcLng = t.reduce((s, p) => s + p.lng, 0) / t.length, tcLat = t.reduce((s, p) => s + p.lat, 0) / t.length;
      const tOp = over ? 1 : fadeAt(tcLng, tcLat);   // shading trees never fade
      const pts = t.map(p => { const q = px(p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');
      els.push(`<polygon points="${pts}" fill="rgba(120,165,102,${(0.34 * tOp).toFixed(2)})" stroke="${over ? '#b45309' : '#5f8a4a'}" stroke-width="${over ? 1.1 : 0.7}" stroke-opacity="${tOp.toFixed(2)}"${over ? ' stroke-dasharray="3 2"' : ''}/>`);
    }
    legend.push({ swatch: `<rect x="0" y="-4" width="14" height="8" fill="rgba(120,165,102,0.34)" stroke="#5f8a4a" stroke-width="0.7"/>`, label: 'TREE CANOPY (NEARMAP AI)' });
    if (shades && opts?.annotations !== false) {
      const bx = toX((roof.minLng + roof.maxLng) / 2);
      els.push(`<text x="${bx.toFixed(1)}" y="${(toY(roof.maxLat) - 6).toFixed(1)}" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.2" font-weight="bold" fill="#b45309" stroke="#fff" stroke-width="1.5" paint-order="stroke">TREE CANOPY NEAR ARRAY — SHADING, FIELD VERIFY</text>`);
    }
  }

  // ── 2) REAL road centerlines (OSM) — drawn where the road ACTUALLY is, with
  // the real name. Each unique name labeled once, on its longest segment. ──
  const labeled = new Set<string>();
  let drewRoad = false;
  for (const r of site.roads) {
    if (r.pts.length < 2) continue;
    const scr = r.pts.map(px);
    const pts = scr.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
    els.push(`<polyline points="${pts}" fill="none" stroke="#c7ccd3" stroke-width="2.4"/>`);
    els.push(`<polyline points="${pts}" fill="none" stroke="#9aa1ab" stroke-width="0.7"/>`);
    drewRoad = true;
    const nm = (r.name || site.streetName || '').toUpperCase();
    if (nm && !labeled.has(nm)) {
      labeled.add(nm);
      let bi = 0, bl = -1;
      for (let i = 0; i < scr.length - 1; i++) {
        const L = Math.hypot(scr[i + 1].x - scr[i].x, scr[i + 1].y - scr[i].y);
        if (L > bl) { bl = L; bi = i; }
      }
      if (bl > 26) {
        const a = scr[bi], b = scr[bi + 1];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
        els.push(`<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="7" font-weight="900" letter-spacing="1.5" fill="#666" stroke="#fff" stroke-width="1.8" paint-order="stroke">${esc(nm)}</text>`);
      }
    }
  }
  if (drewRoad) legend.push({ swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#9aa1ab" stroke-width="1.6"/>`, label: 'ROAD (OSM)' });

  // ── 3) PROPERTY LINE (county-GIS parcel) — dashed with a white halo. Drawn
  // above buildings/roads but still under the roof. ──
  const P = site.parcel;
  if (P && P.length >= 3) {
    const n = P.length;
    const xy = P.map(px);
    const ptsStr = xy.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    els.push(`<polygon points="${ptsStr}" fill="none" stroke="#ffffff" stroke-width="2.6" opacity="0.75" stroke-dasharray="11 6"/>`);
    els.push(`<polygon points="${ptsStr}" fill="none" stroke="#2b2f36" stroke-width="1.1" stroke-dasharray="11 6"/>`);
    legend.push({ swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#2b2f36" stroke-width="1.1" stroke-dasharray="4 2"/>`, label: 'PROPERTY LINE (COUNTY GIS)' });

    // ── PROPERTY-LINE SEGMENT DIMENSIONS (reference style: 227'-7" along each
    // dashed edge). Full surveyed-length of the edge, labeled at the midpoint
    // of its VISIBLE portion (big-lot framing clips the parcel — a label at the
    // true midpoint would land off-frame), rotated along the edge bearing and
    // nudged OUTWARD (away from the lot interior) so it rides beside the dashed
    // line, never on it. Tiny edges (<12 ft) skip to avoid clutter. ──
    let _edgeDims = 0;      // parcel edge dims drawn (suppresses the fallback note)
    let _ringDrawn = false; // setback ring drawn (ditto)
    if (opts?.annotations !== false && n <= 16) {
      const cenLng = P.reduce((s, p) => s + p.lng, 0) / n;
      const cenLat = P.reduce((s, p) => s + p.lat, 0) / n;
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        const ft = Math.hypot(b.lng - a.lng, b.lat - a.lat); // fake-deg = ft
        if (ft < 12) continue;
        const vis = opts?.fitWin ? clipSegToWin(a, b, opts.fitWin) : [a, b] as [FakePt, FakePt];
        if (!vis) continue;
        const va = px(vis[0]), vb = px(vis[1]);
        if (Math.hypot(vb.x - va.x, vb.y - va.y) < 42) continue;   // sliver on-screen
        let mx = (va.x + vb.x) / 2, my = (va.y + vb.y) / 2;
        let ang = Math.atan2(vb.y - va.y, vb.x - va.x) * 180 / Math.PI;
        if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
        // outward offset: perpendicular that points away from the lot centroid
        const cq = px({ lat: cenLat, lng: cenLng });
        let nx2 = -(vb.y - va.y), ny2 = vb.x - va.x;
        const nm2 = Math.hypot(nx2, ny2) || 1; nx2 /= nm2; ny2 /= nm2;
        if ((mx - cq.x) * nx2 + (my - cq.y) * ny2 < 0) { nx2 = -nx2; ny2 = -ny2; }
        mx += nx2 * 7; my += ny2 * 7;
        els.push(`<text x="${mx.toFixed(1)}" y="${(my + 2).toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="6" font-weight="bold" fill="#2b2f36" stroke="#fff" stroke-width="1.7" paint-order="stroke">${ftToFtIn(ft)}</text>`);
        _edgeDims++;
      }
      // "PROPERTY LINE" name tags (reference style) — on the two longest
      // VISIBLE edges, at the 30% point of the visible span so they never sit
      // on the mid-span dimension; offset to the opposite (inner) side.
      const _plEdges: Array<{ L: number; mx: number; my: number; ang: number }> = [];
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        const vis = opts?.fitWin ? clipSegToWin(a, b, opts.fitWin) : [a, b] as [FakePt, FakePt];
        if (!vis) continue;
        const va = px(vis[0]), vb = px(vis[1]);
        const L = Math.hypot(vb.x - va.x, vb.y - va.y);
        if (L < 140) continue;
        let tx = va.x + (vb.x - va.x) * 0.3, ty = va.y + (vb.y - va.y) * 0.3;
        let ang = Math.atan2(vb.y - va.y, vb.x - va.x) * 180 / Math.PI;
        if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
        const cq = px({ lat: cenLat, lng: cenLng });
        let nx2 = -(vb.y - va.y), ny2 = vb.x - va.x;
        const nm2 = Math.hypot(nx2, ny2) || 1; nx2 /= nm2; ny2 /= nm2;
        if ((tx - cq.x) * nx2 + (ty - cq.y) * ny2 > 0) { nx2 = -nx2; ny2 = -ny2; }   // point INWARD
        tx += nx2 * 6.5; ty += ny2 * 6.5;
        _plEdges.push({ L, mx: tx, my: ty, ang });
      }
      _plEdges.sort((a, b) => b.L - a.L).slice(0, 2).forEach(e => {
        els.push(`<text x="${e.mx.toFixed(1)}" y="${(e.my + 2).toFixed(1)}" transform="rotate(${e.ang.toFixed(1)} ${e.mx.toFixed(1)} ${e.my.toFixed(1)})" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="5" font-weight="700" letter-spacing="1.2" fill="#50565e" stroke="#fff" stroke-width="1.4" paint-order="stroke">PROPERTY LINE</text>`);
      });
    }

    // ── SETBACK OFFSET RING — dashed inner offset of the parcel boundary at
    // the array/fence setback the engine already computed (opts.plSetbackFt;
    // never invented here). Labeled once, on its longest visible edge. ──
    const sbFt = opts?.annotations === false ? null : opts?.plSetbackFt;
    if (sbFt != null && sbFt > 0) {
      const inset = insetParcelRing(P, sbFt);
      if (inset) {
        _ringDrawn = true;
        const ixy = inset.map(px);
        const iStr = ixy.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        els.push(`<polygon points="${iStr}" fill="none" stroke="#ffffff" stroke-width="2.0" opacity="0.7" stroke-dasharray="4 3"/>`);
        els.push(`<polygon points="${iStr}" fill="none" stroke="#50565e" stroke-width="0.8" stroke-dasharray="4 3"/>`);
        // longest VISIBLE inset edge carries the one label
        let bl = -1, bmx = 0, bmy = 0, bang = 0;
        for (let i = 0; i < inset.length; i++) {
          const a = inset[i], b = inset[(i + 1) % inset.length];
          const vis = opts?.fitWin ? clipSegToWin(a, b, opts.fitWin) : [a, b] as [FakePt, FakePt];
          if (!vis) continue;
          const va = px(vis[0]), vb = px(vis[1]);
          const L = Math.hypot(vb.x - va.x, vb.y - va.y);
          if (L > bl) {
            bl = L; bmx = (va.x + vb.x) / 2; bmy = (va.y + vb.y) / 2;
            bang = Math.atan2(vb.y - va.y, vb.x - va.x) * 180 / Math.PI;
            if (bang > 90) bang -= 180; else if (bang < -90) bang += 180;
          }
        }
        if (bl > 70) {
          const sbTxt = `${sbFt % 1 === 0 ? sbFt : sbFt.toFixed(1)}' SETBACK FROM PROPERTY LINE`;
          els.push(`<text x="${bmx.toFixed(1)}" y="${(bmy - 3).toFixed(1)}" transform="rotate(${bang.toFixed(1)} ${bmx.toFixed(1)} ${bmy.toFixed(1)})" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.4" font-weight="bold" fill="#50565e" stroke="#fff" stroke-width="1.5" paint-order="stroke">${sbTxt}</text>`);
        }
        legend.push({ swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#50565e" stroke-width="0.8" stroke-dasharray="3 2"/>`, label: `${sbFt % 1 === 0 ? sbFt : sbFt.toFixed(1)}' SETBACK FROM P/L (ARRAY/FENCE)` });
      }
    }

    // ── SETBACK DIMENSIONS — building side → nearest property line, per side.
    // Ray-cast outward from each roof edge to the nearest parcel edge; draw a
    // dimension line + distance where it FITS (≤70 ft) — normal home lots get
    // front/side/rear dims; a big shared lot (P/L far off-frame) draws none and
    // falls back to the closest-approach note. All APPROXIMATE (county GIS). ──
    const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
    const rayHit = (sx: number, sy: number, dx: number, dy: number): number | null => {
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        const ex = b.lng - a.lng, ey = b.lat - a.lat;
        const denom = cross(dx, dy, ex, ey);
        if (Math.abs(denom) < 1e-9) continue;
        const apx = a.lng - sx, apy = a.lat - sy;
        const t1 = cross(apx, apy, ex, ey) / denom;   // dist along ray (ft)
        const t2 = cross(apx, apy, dx, dy) / denom;   // param along edge
        if (t1 > 0.5 && t2 >= 0 && t2 <= 1 && t1 < best) best = t1;
      }
      return isFinite(best) ? best : null;
    };
    const cLng = (roof.minLng + roof.maxLng) / 2, cLat = (roof.minLat + roof.maxLat) / 2;
    // NO screen-downward (S) dim: the band under the roof ALWAYS carries the
    // overall dimension + callouts + viewport title, and the S dim's extension
    // line struck straight through them (Stowell "63'" through GRAPHIC SCALE).
    // The parcel edge dims + setback ring carry the south story instead.
    const sides: Array<[number, number, number, number]> = opts?.annotations === false ? [] : [
      [roof.minLng, cLat, -1, 0], [roof.maxLng, cLat, 1, 0],   // W, E
      [cLng, roof.maxLat, 0, 1],                               // N
    ];
    let dimsDrawn = 0;
    for (const [sx, sy, dx, dy] of sides) {
      const d = rayHit(sx, sy, dx, dy);
      if (d == null || d < 1 || d > 70) continue;   // skip: no P/L in range (fits typical lots only)
      const s = px({ lat: sy, lng: sx }), e = px({ lat: sy + dy * d, lng: sx + dx * d });
      let ux = e.x - s.x, uy = e.y - s.y; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
      const tx = -uy * 2.5, ty = ux * 2.5;   // tick perpendicular
      els.push(`<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="#2b2f36" stroke-width="0.6"/>`);
      els.push(`<line x1="${(s.x - tx).toFixed(1)}" y1="${(s.y - ty).toFixed(1)}" x2="${(s.x + tx).toFixed(1)}" y2="${(s.y + ty).toFixed(1)}" stroke="#2b2f36" stroke-width="0.6"/>`);
      els.push(`<line x1="${(e.x - tx).toFixed(1)}" y1="${(e.y - ty).toFixed(1)}" x2="${(e.x + tx).toFixed(1)}" y2="${(e.y + ty).toFixed(1)}" stroke="#2b2f36" stroke-width="0.6"/>`);
      const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2;
      els.push(`<text x="${mx.toFixed(1)}" y="${(my - 1.5).toFixed(1)}" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.4" font-weight="bold" fill="#2b2f36" stroke="#fff" stroke-width="1.5" paint-order="stroke">${Math.round(d)}'</text>`);
      dimsDrawn++;
    }
    if (!dimsDrawn && !_edgeDims && !_ringDrawn && opts?.annotations !== false) {
      // Nothing else told the P/L story (all off-frame) — report the closest
      // approach. When edge dims / the setback ring DID draw, this note is
      // redundant and printed straight through the overall-dimension band.
      let minFt = Infinity;
      const bcorners: FakePt[] = [
        { lat: roof.minLat, lng: roof.minLng }, { lat: roof.minLat, lng: roof.maxLng },
        { lat: roof.maxLat, lng: roof.maxLng }, { lat: roof.maxLat, lng: roof.minLng },
      ];
      for (const v of bcorners) for (let i = 0; i < n; i++) {
        const d = ptSegDist(v, P[i], P[(i + 1) % n]);
        if (d < minFt) minFt = d;
      }
      if (isFinite(minFt) && minFt > 0.5) {
        const bx = toX(cLng);
        els.push(`<text x="${bx.toFixed(1)}" y="${(toY(roof.minLat) + 12).toFixed(1)}" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.2" fill="#555" stroke="#fff" stroke-width="1.4" paint-order="stroke">BLDG → P/L ~${Math.round(minFt)}' (APPROX — COUNTY GIS)</text>`);
      }
    }
    if (dimsDrawn) legend.push({ swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#2b2f36" stroke-width="0.6"/><line x1="0" y1="-2.5" x2="0" y2="2.5" stroke="#2b2f36" stroke-width="0.6"/><line x1="14" y1="-2.5" x2="14" y2="2.5" stroke="#2b2f36" stroke-width="0.6"/>`, label: 'SETBACK (APPROX)' });
  }

  // ── SERVICE-EQUIPMENT CLUSTER at the interconnection wall (reference style:
  // the compact M | MSP | AC-D | INV box row + "PV INTERCONNECTION POINT"
  // leader note). Anchored on the located meter (survey-photo GPS or the
  // street-side heuristic — provenance carried by the FIELD VERIFY note),
  // clamped just outside the roof footprint and pushed OUTWARD (away from the
  // building) so the row never covers the roof, array or fence tags. ──
  if (site.equipment.length && opts?.annotations !== false) {
    const ORDER: Record<string, number> = { utility_meter: 0, msp: 1, ac_disconnect: 2 };
    const TAG: Record<string, string> = { utility_meter: 'M', msp: 'MSP', ac_disconnect: 'AC-D' };
    const clampOut = (p: FakePt): FakePt => {
      let lng = p.lng, lat = p.lat;
      if (lng > roof.minLng && lng < roof.maxLng && lat > roof.minLat && lat < roof.maxLat) {
        const dL = lng - roof.minLng, dR = roof.maxLng - lng, dB = lat - roof.minLat, dT = roof.maxLat - lat;
        const m = Math.min(dL, dR, dB, dT);
        if (m === dL) lng = roof.minLng - 3.5; else if (m === dR) lng = roof.maxLng + 3.5;
        else if (m === dB) lat = roof.minLat - 3.5; else lat = roof.maxLat + 3.5;
      }
      return { lat, lng };
    };
    const eq = [...site.equipment].sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9));
    const anchorE = eq.find(e => e.kind === 'utility_meter') ?? eq[0];
    const wall = px(clampOut(anchorE.pt));           // the wall point (leader target)
    // outward direction: away from the roof center, screen space
    const rc = px({ lat: (roof.minLat + roof.maxLat) / 2, lng: (roof.minLng + roof.maxLng) / 2 });
    let ox = wall.x - rc.x, oy = wall.y - rc.y;
    const om = Math.hypot(ox, oy) || 1; ox /= om; oy /= om;
    // box row: located existing gear + the (N) inverter at the same wall
    const tags = [...new Set(eq.map(e => TAG[e.kind] ?? '?')), 'INV'];
    const bh = 9;
    const widths = tags.map(t => Math.max(11, t.length * 4.2 + 4.5));
    const totW = widths.reduce((s, w) => s + w, 0);
    const rcx = wall.x + ox * 22, rcy = wall.y + oy * 22;   // row center
    const rx0 = rcx - totW / 2, ry0 = rcy - bh / 2;
    // leader: wall point ● → row edge
    els.push(`<circle cx="${wall.x.toFixed(1)}" cy="${wall.y.toFixed(1)}" r="1.5" fill="#111"/>`);
    els.push(`<line x1="${wall.x.toFixed(1)}" y1="${wall.y.toFixed(1)}" x2="${(rcx - ox * (totW / 2 + 2)).toFixed(1)}" y2="${(rcy - oy * (bh / 2 + 2)).toFixed(1)}" stroke="#111" stroke-width="0.7"/>`);
    let cx0 = rx0;
    for (let i = 0; i < tags.length; i++) {
      els.push(`<rect x="${cx0.toFixed(1)}" y="${ry0.toFixed(1)}" width="${widths[i].toFixed(1)}" height="${bh}" fill="#ffffff" stroke="#111" stroke-width="0.9"/>`);
      els.push(`<text x="${(cx0 + widths[i] / 2).toFixed(1)}" y="${(ry0 + bh / 2 + 1.8).toFixed(1)}" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="${tags[i].length > 2 ? '4.4' : '5'}" font-weight="900" fill="#111">${tags[i]}</text>`);
      cx0 += widths[i];
    }
    // interconnection note — stacked under (or above) the row, away from the roof
    const noteLines = [
      'PV INTERCONNECTION POINT',
      '(E) METER MAIN · (N) AC DISCONNECT · (N) INVERTER(S)',
      'AT EXTERIOR WALL — FIELD VERIFY',
    ];
    const noteBelow = oy >= 0;   // row sits below the house → note goes further down
    const nY0 = noteBelow ? ry0 + bh + 7.5 : ry0 - 5 - (noteLines.length - 1) * 6.5;
    // note block shifts OUTWARD horizontally too — the roof's own bottom
    // callouts (rail feet / dim band) live directly under the array, and a
    // centered note tail was colliding with them
    const noteX = rcx + (rcx < rc.x ? -20 : 20);
    noteLines.forEach((ln, i) => {
      els.push(`<text x="${noteX.toFixed(1)}" y="${(nY0 + i * 6.5).toFixed(1)}" text-anchor="middle" font-family="SolarPro Sans, SolarPro Symbols" font-size="${i === 0 ? '5.4' : '4.8'}" font-weight="${i === 0 ? '900' : 'normal'}" fill="#111" stroke="#fff" stroke-width="1.5" paint-order="stroke">${ln}</text>`);
    });
    legend.push({ swatch: `<rect x="0" y="-4" width="6" height="8" fill="#fff" stroke="#111" stroke-width="0.8"/><rect x="6" y="-4" width="6" height="8" fill="#fff" stroke="#111" stroke-width="0.8"/>`, label: 'SERVICE EQUIP — M / MSP / AC-D / INV (FIELD VERIFY)' });
  }

  return { els, legend };
}
