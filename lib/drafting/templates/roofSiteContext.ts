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

export interface SiteContext {
  parcel: FakePt[];                 // parcel ring in fake-degrees
  streetPin: FakePt | null;         // geocode pin (frontage direction) in fake-degrees
  streetName: string | null;
  apn: string | null;
  source: string;                   // e.g. "County GIS"
}

/** Pull the parcel/street off the PermitInput and project into the roof's frame.
 *  Returns null when there's no usable parcel or CAD origin (→ roof-only render). */
export function buildSiteContext(
  cad: { originLat?: number; originLng?: number } | null | undefined,
  permitInput: unknown,
): SiteContext | null {
  const originLat = cad?.originLat, originLng = cad?.originLng;
  if (originLat == null || originLng == null || !isFinite(originLat) || !isFinite(originLng)
      || Math.abs(originLat) < 0.001) return null;

  const pi = permitInput as {
    aerialData?: { parcel?: { polygon?: Array<{ lat: number; lng: number }>; apn?: string | null; source?: string } };
    project?: { address?: string; lat?: number; lng?: number };
  } | null;

  const ring = (pi?.aerialData?.parcel?.polygon ?? [])
    .filter(v => isFinite(v?.lat) && isFinite(v?.lng) && Math.abs(v.lat) > 0.001);
  if (ring.length < 3) return null;

  const parcel = ring.map(v => latLngToFakeDeg(v.lat, v.lng, originLat, originLng));
  const proj = pi?.project ?? {};
  const streetName = (proj.address || '').split(',')[0]
    .replace(/^\s*\d+\s+/, '').replace(/\b(apt|unit|ste|#)\.?\s*\S*$/i, '').trim().toUpperCase() || null;
  const streetPin = (isFinite(proj.lat as number) && isFinite(proj.lng as number) && Math.abs(proj.lat as number) > 0.001)
    ? latLngToFakeDeg(proj.lat as number, proj.lng as number, originLat, originLng)
    : null;

  return {
    parcel,
    streetPin,
    streetName,
    apn: pi?.aerialData?.parcel?.apn ?? null,
    source: pi?.aerialData?.parcel?.source || 'COUNTY GIS',
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
  parcel: FakePt[],
  opts?: { maxZoomOut?: number; marginFt?: number },
): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  const maxZoomOut = opts?.maxZoomOut ?? 2.6;  // roof stays ≥ ~1/maxZoomOut of the window
  const marginFt = opts?.marginFt ?? 6;
  const cxLng = (roof.minLng + roof.maxLng) / 2, cyLat = (roof.minLat + roof.maxLat) / 2;
  const halfW = (roof.maxLng - roof.minLng) / 2 || 1, halfH = (roof.maxLat - roof.minLat) / 2 || 1;
  const capW = halfW * maxZoomOut, capH = halfH * maxZoomOut;
  const pb = fakeBbox(parcel);
  // Union with parcel, then clamp each side to the cap around the roof center.
  const minLng = Math.max(Math.min(roof.minLng, pb.minLng), cxLng - capW) - marginFt;
  const maxLng = Math.min(Math.max(roof.maxLng, pb.maxLng), cxLng + capW) + marginFt;
  const minLat = Math.max(Math.min(roof.minLat, pb.minLat), cyLat - capH) - marginFt;
  const maxLat = Math.min(Math.max(roof.maxLat, pb.maxLat), cyLat + capH) + marginFt;
  return { minLng, maxLng, minLat, maxLat };
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const seg2 = (a: XY, b: XY) => Math.hypot(b.x - a.x, b.y - a.y);

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
  const P = site.parcel;
  const n = P.length;
  const xy = P.map(p => ({ x: toX(p.lng), y: toY(p.lat) }));
  const cLng = (roof.minLng + roof.maxLng) / 2, cLat = (roof.minLat + roof.maxLat) / 2;
  const bldgCenter: XY = { x: toX(cLng), y: toY(cLat) };

  // ── Frontage edge = parcel edge nearest the street pin (fallback: nearest to
  // the building's downhill/most-open side = the edge with the largest gap to
  // the building, i.e. min approach among edges facing away). Prefer the pin. ──
  let frontIdx = 0;
  if (site.streetPin) {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = ptSegDist(site.streetPin, P[i], P[(i + 1) % n]);
      if (d < best) { best = d; frontIdx = i; }
    }
  } else {
    // No pin → pick the LONGEST edge (typical street frontage on a rectangular lot).
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      const L = Math.hypot(P[(i + 1) % n].lng - P[i].lng, P[(i + 1) % n].lat - P[i].lat);
      if (L > best) { best = L; frontIdx = i; }
    }
  }
  const fA = xy[frontIdx], fB = xy[(frontIdx + 1) % n];
  const fLen = seg2(fA, fB);
  // Outward normal of the frontage (points away from the building).
  let nx = -(fB.y - fA.y), ny = fB.x - fA.x;
  const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
  const fmx = (fA.x + fB.x) / 2, fmy = (fA.y + fB.y) / 2;
  if ((fmx + nx * 5 - bldgCenter.x) ** 2 + (fmy + ny * 5 - bldgCenter.y) ** 2
      < (fmx - nx * 5 - bldgCenter.x) ** 2 + (fmy - ny * 5 - bldgCenter.y) ** 2) {
    nx = -nx; ny = -ny; // ensure outward (away from building)
  }
  const along = { x: (fB.x - fA.x) / (fLen || 1), y: (fB.y - fA.y) / (fLen || 1) };

  // ── STREET: name + edge line just OUTSIDE the frontage (no fabricated road
  // surface — a single curb/edge line + label, reference style). ──
  if (site.streetName && fLen > 20) {
    const off = 16; // px outward
    const rax = fA.x + nx * off, ray = fA.y + ny * off;
    const rbx = fB.x + nx * off, rby = fB.y + ny * off;
    els.push(`<line x1="${rax.toFixed(1)}" y1="${ray.toFixed(1)}" x2="${rbx.toFixed(1)}" y2="${rby.toFixed(1)}" stroke="#9aa1ab" stroke-width="1"/>`);
    let ang = Math.atan2(rby - ray, rbx - rax) * 180 / Math.PI;
    if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
    const lx = (rax + rbx) / 2 + nx * 9, ly = (ray + rby) / 2 + ny * 9;
    els.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="900" letter-spacing="2" fill="#555">${esc(site.streetName)}</text>`);
  }

  // ── SIDEWALK: thin double line just outside the frontage, between property
  // line and street (public walk parallel to frontage). Approximate. ──
  if (fLen > 24) {
    const o1 = 5, o2 = 8;
    const s1 = `${(fA.x + nx * o1).toFixed(1)},${(fA.y + ny * o1).toFixed(1)} ${(fB.x + nx * o1).toFixed(1)},${(fB.y + ny * o1).toFixed(1)}`;
    const s2 = `${(fA.x + nx * o2).toFixed(1)},${(fA.y + ny * o2).toFixed(1)} ${(fB.x + nx * o2).toFixed(1)},${(fB.y + ny * o2).toFixed(1)}`;
    els.push(`<polyline points="${s1}" fill="none" stroke="#b7bcc4" stroke-width="0.8"/>`);
    els.push(`<polyline points="${s2}" fill="none" stroke="#b7bcc4" stroke-width="0.8"/>`);
    const swx = fmx + along.x * fLen * 0.28 + nx * 6.5, swy = fmy + along.y * fLen * 0.28 + ny * 6.5;
    let ang = Math.atan2(fB.y - fA.y, fB.x - fA.x) * 180 / Math.PI;
    if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
    els.push(`<text x="${swx.toFixed(1)}" y="${swy.toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${swx.toFixed(1)} ${swy.toFixed(1)})" text-anchor="middle" font-family="Arial,sans-serif" font-size="4.6" fill="#8a9099">SIDEWALK (APPROX)</text>`);
    legend.push({ swatch: `<line x1="0" y1="-2" x2="14" y2="-2" stroke="#b7bcc4" stroke-width="0.8"/><line x1="0" y1="1" x2="14" y2="1" stroke="#b7bcc4" stroke-width="0.8"/>`, label: 'SIDEWALK (APPROX)' });
  }

  // ── DRIVEWAY: strip from the frontage to the building's nearest corner. The
  // building corner is approximated by the roof bbox corner closest to the
  // frontage midpoint; the driveway runs from the frontage (at the foot of that
  // corner) inward. ~10 ft wide, hatched, APPROXIMATE. ──
  {
    const rb = { x0: toX(roof.minLng), x1: toX(roof.maxLng), y0: toY(roof.maxLat), y1: toY(roof.minLat) };
    const corners: XY[] = [
      { x: rb.x0, y: rb.y0 }, { x: rb.x1, y: rb.y0 }, { x: rb.x1, y: rb.y1 }, { x: rb.x0, y: rb.y1 },
    ];
    // corner nearest the frontage midpoint
    let cc = corners[0], cd = Infinity;
    for (const c of corners) { const d = (c.x - fmx) ** 2 + (c.y - fmy) ** 2; if (d < cd) { cd = d; cc = c; } }
    // foot on the frontage nearest that corner (project corner onto frontage)
    const t = Math.max(0.12, Math.min(0.88,
      ((cc.x - fA.x) * (fB.x - fA.x) + (cc.y - fA.y) * (fB.y - fA.y)) / ((fLen * fLen) || 1)));
    const foot = { x: fA.x + (fB.x - fA.x) * t, y: fA.y + (fB.y - fA.y) * t };
    const dir = { x: cc.x - foot.x, y: cc.y - foot.y };
    const dl = Math.hypot(dir.x, dir.y) || 1; dir.x /= dl; dir.y /= dl;
    const perp = { x: -dir.y, y: dir.x };
    const halfW = 5.5; // ~11 ft driveway
    const startPush = 5; // start out at the street edge
    const A0 = { x: foot.x + dir.x * -startPush + perp.x * halfW, y: foot.y + dir.y * -startPush + perp.y * halfW };
    const A1 = { x: foot.x + dir.x * -startPush - perp.x * halfW, y: foot.y + dir.y * -startPush - perp.y * halfW };
    const B0 = { x: cc.x + perp.x * halfW, y: cc.y + perp.y * halfW };
    const B1 = { x: cc.x - perp.x * halfW, y: cc.y - perp.y * halfW };
    if (dl > 10) {
      const poly = `${A0.x.toFixed(1)},${A0.y.toFixed(1)} ${B0.x.toFixed(1)},${B0.y.toFixed(1)} ${B1.x.toFixed(1)},${B1.y.toFixed(1)} ${A1.x.toFixed(1)},${A1.y.toFixed(1)}`;
      els.push(`<polygon points="${poly}" fill="#eceef1" stroke="#aeb4bd" stroke-width="0.8"/>`);
      const dmx = (foot.x + cc.x) / 2, dmy = (foot.y + cc.y) / 2;
      let ang = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
      els.push(`<text x="${dmx.toFixed(1)}" y="${dmy.toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${dmx.toFixed(1)} ${dmy.toFixed(1)})" text-anchor="middle" font-family="Arial,sans-serif" font-size="5" font-weight="bold" fill="#7c828b">DRIVEWAY (APPROX)</text>`);
      legend.push({ swatch: `<rect x="0" y="-4" width="14" height="8" fill="#eceef1" stroke="#aeb4bd" stroke-width="0.7"/>`, label: 'DRIVEWAY (APPROX)' });
    }
  }

  // ── PROPERTY LINE: county-GIS parcel, dashed with a white halo (drawn LAST in
  // this layer so it sits above driveway/sidewalk but still under the roof). ──
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

  // Closest building→property-line approach (ft) — a site-plan setback datum.
  {
    let minFt = Infinity;
    const bldg: FakePt[] = [
      { lat: roof.minLat, lng: roof.minLng }, { lat: roof.minLat, lng: roof.maxLng },
      { lat: roof.maxLat, lng: roof.maxLng }, { lat: roof.maxLat, lng: roof.minLng },
    ];
    for (const v of bldg) for (let i = 0; i < n; i++) {
      const d = ptSegDist(v, P[i], P[(i + 1) % n]); // fake-deg = ft
      if (d < minFt) minFt = d;
    }
    if (isFinite(minFt) && minFt > 0.5) {
      els.push(`<text x="${(bldgCenter.x).toFixed(1)}" y="${(toY(roof.minLat) + 12).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.2" fill="#555" stroke="#fff" stroke-width="1.4" paint-order="stroke">BLDG → P/L ~${Math.round(minFt)}' (APPROX — COUNTY GIS)</text>`);
    }
  }

  return { els, legend };
}
