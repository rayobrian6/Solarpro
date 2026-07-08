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
    project?: { address?: string };
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

  return {
    parcel,
    roads,
    buildings,
    driveways,
    paved,
    roadSurfaces,
    lawn,
    trees,
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

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Point→segment distance (fake-degree space). */
function ptSegDist(p: FakePt, a: FakePt, b: FakePt): number {
  const abx = b.lng - a.lng, aby = b.lat - a.lat;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.lng - a.lng) * abx + (p.lat - a.lat) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.lng - (a.lng + t * abx), p.lat - (a.lat + t * aby));
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
      els.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="900" letter-spacing="1.5" fill="#4a4f57" stroke="#fff" stroke-width="1.8" paint-order="stroke">${esc(site.streetName)}</text>`);
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
    els.push(`<text x="${dcx.toFixed(1)}" y="${dcy.toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.4" font-weight="bold" fill="#4a4f57" stroke="#fff" stroke-width="1.4" paint-order="stroke">DRIVEWAY</text>`);
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
    if (shades) {
      const bx = toX((roof.minLng + roof.maxLng) / 2);
      els.push(`<text x="${bx.toFixed(1)}" y="${(toY(roof.maxLat) - 6).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.2" font-weight="bold" fill="#b45309" stroke="#fff" stroke-width="1.5" paint-order="stroke">TREE CANOPY NEAR ARRAY — SHADING, FIELD VERIFY</text>`);
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
        els.push(`<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="900" letter-spacing="1.5" fill="#666" stroke="#fff" stroke-width="1.8" paint-order="stroke">${esc(nm)}</text>`);
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

    // Parcel edge dimensions (ft) — only for simple lots so labels don't clutter.
    if (n <= 8) {
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        const ft = Math.hypot(b.lng - a.lng, b.lat - a.lat); // fake-deg = ft
        if (ft < 8) continue;
        const ax = xy[i], bx = xy[(i + 1) % n];
        const mx = (ax.x + bx.x) / 2, my = (ax.y + bx.y) / 2;
        let ang = Math.atan2(bx.y - ax.y, bx.x - ax.x) * 180 / Math.PI;
        if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
        els.push(`<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.6" font-weight="bold" fill="#2b2f36" stroke="#fff" stroke-width="1.6" paint-order="stroke">${Math.round(ft)}'</text>`);
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
    const sides: Array<[number, number, number, number]> = [
      [roof.minLng, cLat, -1, 0], [roof.maxLng, cLat, 1, 0],   // W, E
      [cLng, roof.minLat, 0, -1], [cLng, roof.maxLat, 0, 1],   // S, N
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
      els.push(`<text x="${mx.toFixed(1)}" y="${(my - 1.5).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.4" font-weight="bold" fill="#2b2f36" stroke="#fff" stroke-width="1.5" paint-order="stroke">${Math.round(d)}'</text>`);
      dimsDrawn++;
    }
    if (!dimsDrawn) {
      // Big/shared lot — P/L off-frame; report the closest approach instead.
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
        els.push(`<text x="${bx.toFixed(1)}" y="${(toY(roof.minLat) + 12).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.2" fill="#555" stroke="#fff" stroke-width="1.4" paint-order="stroke">BLDG → P/L ~${Math.round(minFt)}' (APPROX — COUNTY GIS)</text>`);
      }
    }
    if (dimsDrawn) legend.push({ swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#2b2f36" stroke-width="0.6"/><line x1="0" y1="-2.5" x2="0" y2="2.5" stroke="#2b2f36" stroke-width="0.6"/><line x1="14" y1="-2.5" x2="14" y2="2.5" stroke="#2b2f36" stroke-width="0.6"/>`, label: 'SETBACK (APPROX)' });
  }

  return { els, legend };
}
