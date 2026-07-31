// ============================================================================
// PV-2 Site-Context Inset — parcel-scale plot view rendered ALONGSIDE the main
// roof plan (the roof viewport is untouched). Everything here comes from
// VERIFIED existing data (county-GIS parcel, canonical roof/building geometry,
// module layout, geocoded street name, located service equipment). It NEVER
// fabricates driveways, sidewalks, roads, curbs, easements, or right-of-way.
//
// County GIS is not a boundary survey, so the parcel line and every distance
// derived from it are labeled APPROXIMATE — COUNTY GIS — VERIFY.
//
// A minimal provider-independent seam (SiteContextFeature) lets approved
// driveway/sidewalk/etc. polygons be added LATER without touching this renderer:
// a feature renders ONLY when reviewState === 'approved' && permitRenderable.
// Until a real provider supplies verified, approved geometry, nothing is drawn
// (no diagrammatic fallback — omit, per spec).
// ============================================================================

import { latLngToXY } from '@/lib/cad/geometry';

export interface LatLng { lat: number; lng: number }

// ── Provider-independent site-context feature (Phase-2 seam; not overbuilt) ──
export type SiteFeatureKind =
  | 'driveway' | 'sidewalk' | 'road_edge' | 'curb'
  | 'concrete_surface' | 'easement' | 'right_of_way';
export type MeasurementBasis = 'measured' | 'detected' | 'inferred' | 'manually_traced';
export type ReviewState = 'unreviewed' | 'review_required' | 'approved' | 'rejected';

export interface SiteContextFeature {
  id: string;
  kind: SiteFeatureKind;
  geometryType: 'polygon' | 'polyline';
  geometryWgs84: LatLng[];
  provider: string;                 // 'county_gis' | 'nearmap_ai' | 'operator_trace' | ...
  capturedAt: string | null;        // source/imagery capture date
  confidence: number | null;        // 0..1
  measurementBasis: MeasurementBasis;
  reviewState: ReviewState;
  operatorAdjusted: boolean;
  renderPolicy: { permitRenderable: boolean };
  attributes?: Record<string, unknown>;
}

/** A feature may be drawn on the PERMIT sheet only when explicitly approved. */
export function isPermitRenderable(f: SiteContextFeature): boolean {
  return f.reviewState === 'approved' && f.renderPolicy?.permitRenderable === true;
}

// ── Pure geometry ───────────────────────────────────────────────────────────
const M_TO_FT = 3.280839895;

/** Project lat/lng points into local metres (canonical alignment, origin-relative). */
export function projectToLocalM(pts: LatLng[], origin: LatLng): Array<{ x: number; y: number }> {
  return pts.map(p => latLngToXY(p.lat, p.lng, origin.lat, origin.lng));
}

/** Great-ish-circle distance between two lat/lng in FEET (local-metric, exact enough at a parcel). */
export function distanceFt(a: LatLng, b: LatLng): number {
  const p = latLngToXY(b.lat, b.lng, a.lat, a.lng);
  return Math.hypot(p.x, p.y) * M_TO_FT;
}

/** Edge lengths (feet) of a closed polygon, one per edge i→i+1 (wrapping). */
export function polygonEdgeLengthsFt(poly: LatLng[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    out.push(distanceFt(poly[i], poly[(i + 1) % poly.length]));
  }
  return out;
}

/** Distance (metres) from point P to segment AB, all in local XY. */
export function pointToSegmentM(
  p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx, cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Minimum distance (FEET) from a subject polygon's vertices to the nearest edge
 * of the parcel boundary — the closest-approach "setback". APPROXIMATE: derived
 * from county-GIS parcel geometry, not a boundary survey.
 */
export function minSetbackFt(subject: LatLng[], parcel: LatLng[], origin: LatLng): number | null {
  if (!subject.length || parcel.length < 3) return null;
  const sub = projectToLocalM(subject, origin);
  const par = projectToLocalM(parcel, origin);
  let min = Infinity;
  for (const p of sub) {
    for (let i = 0; i < par.length; i++) {
      const d = pointToSegmentM(p, par[i], par[(i + 1) % par.length]);
      if (d < min) min = d;
    }
  }
  return isFinite(min) ? min * M_TO_FT : null;
}

/** Monotone-chain convex hull (lat/lng in, hull lat/lng out) — the building outline. */
export function convexHullLatLng(pts: LatLng[]): LatLng[] {
  const uniq = pts.filter((p, i, a) => a.findIndex(q => q.lat === p.lat && q.lng === p.lng) === i);
  if (uniq.length < 3) return uniq;
  const s = [...uniq].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (o: LatLng, a: LatLng, b: LatLng) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const lower: LatLng[] = [];
  for (const p of s) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: LatLng[] = [];
  for (let i = s.length - 1; i >= 0; i--) { const p = s[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// ── SVG helpers ─────────────────────────────────────────────────────────────
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SiteContextInsetInput {
  parcel?: { polygon?: LatLng[]; apn?: string | null; acres?: number | null; source?: string } | null;
  roofPlaneVertices: LatLng[];      // all roof-plane vertices (lat/lng) → building hull
  panelCenters: LatLng[];           // module centers (lat/lng) → array footprint
  streetName?: string | null;
  streetPin?: LatLng | null;        // geocode pin (frontage direction only; NO road drawn)
  equipment?: Array<{ kind: string; lat: number; lng: number; provenance: string }>;
  features?: SiteContextFeature[];  // provider seam — only approved ones render
}

export interface InsetBox { x: number; y: number; w: number; h: number }

/**
 * Build the site-context inset as an SVG <g>. Returns '' when no parcel boundary
 * is available (no-parcel fallback — the caller keeps the roof plan unchanged and
 * draws no lot geometry).
 */
export function buildSiteContextInset(input: SiteContextInsetInput, box: InsetBox): string {
  const parcel = (input.parcel?.polygon ?? []).filter(v => isFinite(v?.lat) && isFinite(v?.lng));
  if (parcel.length < 3) return '';

  const building = convexHullLatLng(input.roofPlaneVertices.filter(v => isFinite(v?.lat) && isFinite(v?.lng)));
  const panels = input.panelCenters.filter(v => isFinite(v?.lat) && isFinite(v?.lng));
  const origin = parcel[0];

  // Project everything to local metres, then fit the PARCEL extent into the box.
  const pPar = projectToLocalM(parcel, origin);
  const pBld = projectToLocalM(building, origin);
  const pPan = projectToLocalM(panels, origin);
  const eqPts = (input.equipment ?? []).map(e => ({ ...e, ...latLngToXY(e.lat, e.lng, origin.lat, origin.lng) }));

  // ── Window: subject BUILDING + generous margin, matched to the draw aspect —
  // NOT the whole parcel. A large apartment/complex lot would otherwise shrink
  // the building to a dot and clutter the view; we zoom to the building and CLIP
  // the parcel to the window, showing only the NEAREST property lines.
  const bldPts = pBld.length >= 2 ? pBld : (pPan.length ? pPan : pPar);
  const bMinX = Math.min(...bldPts.map(p => p.x)), bMaxX = Math.max(...bldPts.map(p => p.x));
  const bMinY = Math.min(...bldPts.map(p => p.y)), bMaxY = Math.max(...bldPts.map(p => p.y));
  const bW = Math.max(bMaxX - bMinX, 3), bH = Math.max(bMaxY - bMinY, 3);
  const cx0 = (bMinX + bMaxX) / 2, cy0 = (bMinY + bMaxY) / 2;

  const arraySetback = panels.length ? minSetbackFt(panels, parcel, origin) : null;
  const buildingSetback = building.length ? minSetbackFt(building, parcel, origin) : null;

  const pad = 10, hdrH = 16, ftrH = 34;
  const drawW = box.w - 2 * pad, drawH = box.h - 2 * pad - hdrH - ftrH;
  const aspect = drawW / drawH;
  // Window margin: enough to always show ~40 ft of context, and — when the nearest
  // property line is within a sane range — enough to actually SHOW that line (so a
  // plot plan isn't a bare building). Capped so a huge lot doesn't zoom the building
  // back down to a dot; the setback number conveys the rest.
  const nearestFt = Math.min(buildingSetback ?? Infinity, arraySetback ?? Infinity);
  const nearestM = isFinite(nearestFt) ? nearestFt / M_TO_FT : 12;
  const marginM = Math.max(0.6 * Math.max(bW, bH), 12, Math.min(nearestM + 5, 40));
  let halfW = bW / 2 + marginM, halfH = bH / 2 + marginM;
  if (halfW / halfH > aspect) halfH = halfW / aspect; else halfW = halfH * aspect;
  const winMinX = cx0 - halfW, winMaxX = cx0 + halfW, winMinY = cy0 - halfH, winMaxY = cy0 + halfH;
  const scale = drawW / (2 * halfW); // px per metre (uniform; window matches aspect)
  const toX = (p: { x: number }) => box.x + pad + (p.x - winMinX) * scale;
  const toY = (p: { y: number }) => box.y + pad + hdrH + (winMaxY - p.y) * scale; // north up
  const inWin = (p: { x: number; y: number }) => p.x >= winMinX && p.x <= winMaxX && p.y >= winMinY && p.y <= winMaxY;
  const polyStr = (pp: Array<{ x: number; y: number }>) => pp.map(p => `${toX(p).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');

  const els: string[] = [];
  // Frame + header
  els.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#ffffff" stroke="#111" stroke-width="1"/>`);
  els.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${hdrH}" fill="#111"/>`);
  els.push(`<text x="${box.x + 6}" y="${box.y + 11}" font-family="SolarPro Sans, SolarPro Symbols" font-size="8" font-weight="700" fill="#fff" letter-spacing="0.5">SITE / PLOT PLAN — APPROXIMATE (NOT A SURVEY)</text>`);

  // Everything geometric is clipped to the draw window so a large parcel spilling
  // beyond the frame is trimmed cleanly instead of drawing a tangle.
  const clipId = `sci-${Math.round(box.x)}-${Math.round(box.y)}`;
  els.push(`<clipPath id="${clipId}"><rect x="${(box.x + pad).toFixed(1)}" y="${(box.y + pad + hdrH).toFixed(1)}" width="${drawW.toFixed(1)}" height="${drawH.toFixed(1)}"/></clipPath>`);
  const clip: string[] = [];
  clip.push(`<polygon points="${polyStr(pPar)}" fill="none" stroke="#111" stroke-width="1.2"/>`);
  if (pBld.length >= 3) clip.push(`<polygon points="${polyStr(pBld)}" fill="rgba(120,120,120,0.20)" stroke="#333" stroke-width="1"/>`);
  if (pPan.length >= 3) {
    const pah = projectToLocalM(convexHullLatLng(panels), origin);
    clip.push(`<polygon points="${polyStr(pah)}" fill="rgba(23,58,161,0.28)" stroke="#173aa1" stroke-width="1"/>`);
    const cx = pah.reduce((s, p) => s + toX(p), 0) / pah.length, cy = pah.reduce((s, p) => s + toY(p), 0) / pah.length;
    clip.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-family="SolarPro Sans, SolarPro Symbols" font-size="6.5" font-weight="700" fill="#173aa1" text-anchor="middle">PV ARRAY</text>`);
  }
  const kindTag: Record<string, string> = { utility_meter: 'UM', msp: 'MSP', ac_disconnect: 'AC' };
  for (const e of eqPts) {
    if (!inWin(e)) continue;
    const x = toX(e), y = toY(e);
    clip.push(`<rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" fill="#fff" stroke="#111" stroke-width="0.8"/>`);
    clip.push(`<text x="${x.toFixed(1)}" y="${(y + 2).toFixed(1)}" font-family="SolarPro Sans, SolarPro Symbols" font-size="5" font-weight="700" fill="#111" text-anchor="middle">${kindTag[e.kind] ?? '?'}</text>`);
  }
  // Parcel edge dimensions ONLY for a simple lot with edges fully in view — skip
  // on complex/large parcels (an apartment lot) to avoid a clutter of labels.
  if (parcel.length <= 8) {
    const edgeFt = polygonEdgeLengthsFt(parcel);
    for (let i = 0; i < pPar.length; i++) {
      const a = pPar[i], b = pPar[(i + 1) % pPar.length];
      if (!inWin(a) || !inWin(b) || edgeFt[i] < 8) continue;
      clip.push(`<text x="${((toX(a) + toX(b)) / 2).toFixed(1)}" y="${((toY(a) + toY(b)) / 2).toFixed(1)}" font-family="SolarPro Sans, SolarPro Symbols" font-size="6" fill="#111" text-anchor="middle" stroke="#fff" stroke-width="1.6" paint-order="stroke">${edgeFt[i].toFixed(0)}'</text>`);
    }
  }
  els.push(`<g clip-path="url(#${clipId})">${clip.join('')}</g>`);

  // Street name — LABEL ONLY, clamped inside the draw area. No road/curb drawn.
  if (input.streetName && input.streetPin && isFinite(input.streetPin.lat)) {
    const sp = latLngToXY(input.streetPin.lat, input.streetPin.lng, origin.lat, origin.lng);
    const sx = Math.max(box.x + pad + 4, Math.min(box.x + box.w - pad - 4, toX(sp)));
    const sy = Math.max(box.y + hdrH + 10, Math.min(box.y + box.h - ftrH - 4, toY(sp)));
    els.push(`<text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" font-family="SolarPro Sans, SolarPro Symbols" font-size="6.5" font-weight="700" fill="#555" text-anchor="middle" stroke="#fff" stroke-width="1.8" paint-order="stroke">${esc(input.streetName)}</text>`);
  }

  // North arrow (top-right of the draw area)
  const nax = box.x + box.w - 15, nay = box.y + hdrH + 15;
  els.push(`<line x1="${nax}" y1="${nay + 8}" x2="${nax}" y2="${nay - 6}" stroke="#111" stroke-width="1"/>`);
  els.push(`<path d="M ${nax} ${nay - 9} L ${nax - 3} ${nay - 3} L ${nax + 3} ${nay - 3} Z" fill="#111"/>`);
  els.push(`<text x="${nax}" y="${nay - 11}" font-family="SolarPro Sans, SolarPro Symbols" font-size="6" font-weight="700" fill="#111" text-anchor="middle">N</text>`);

  // Footer — 3 clean rows: setbacks · scale bar + APN · provenance
  const fy = box.y + box.h - ftrH;
  els.push(`<line x1="${box.x}" y1="${fy}" x2="${box.x + box.w}" y2="${fy}" stroke="#ccc" stroke-width="0.6"/>`);
  const sbBits: string[] = [];
  if (buildingSetback != null) sbBits.push(`BLDG→P/L ~${buildingSetback.toFixed(0)}'`);
  if (arraySetback != null) sbBits.push(`ARRAY→P/L ~${arraySetback.toFixed(0)}'`);
  els.push(`<text x="${box.x + 6}" y="${fy + 10}" font-family="SolarPro Sans, SolarPro Symbols" font-size="6" font-weight="700" fill="#111">${sbBits.join('   ')}${sbBits.length ? '   ' : ''}(APPROXIMATE — BASED ON COUNTY GIS)</text>`);
  const barPx = Math.max(10 * (scale * M_TO_FT), 14);
  const bx = box.x + 6, by = fy + 22;
  els.push(`<line x1="${bx}" y1="${by}" x2="${(bx + barPx).toFixed(1)}" y2="${by}" stroke="#111" stroke-width="1.4"/>`);
  els.push(`<line x1="${bx}" y1="${by - 3}" x2="${bx}" y2="${by + 3}" stroke="#111" stroke-width="1"/>`);
  els.push(`<line x1="${(bx + barPx).toFixed(1)}" y1="${by - 3}" x2="${(bx + barPx).toFixed(1)}" y2="${by + 3}" stroke="#111" stroke-width="1"/>`);
  els.push(`<text x="${(bx + barPx + 4).toFixed(1)}" y="${by + 2.5}" font-family="SolarPro Sans, SolarPro Symbols" font-size="6" fill="#111">10 FT</text>`);
  const apn = input.parcel?.apn ? `APN ${esc(String(input.parcel.apn))}` : '';
  const src = input.parcel?.source ? esc(String(input.parcel.source)) : 'COUNTY GIS';
  if (apn) els.push(`<text x="${box.x + box.w - 6}" y="${fy + 10}" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.5" fill="#555" text-anchor="end">${apn}</text>`);
  els.push(`<text x="${box.x + box.w / 2}" y="${fy + 32}" font-family="SolarPro Sans, SolarPro Symbols" font-size="5.5" fill="#555" text-anchor="middle">APPROXIMATE PROPERTY LINE — ${src} — VERIFY</text>`);

  // Provider-supplied site features — ONLY approved + permit-renderable ones.
  const featEls: string[] = [];
  for (const f of (input.features ?? [])) {
    if (!isPermitRenderable(f)) continue; // detected/inferred/review_required → omitted
    const fp = projectToLocalM(f.geometryWgs84, origin);
    if (f.geometryType === 'polygon') featEls.push(`<polygon data-feature="${esc(f.kind)}" points="${polyStr(fp)}" fill="rgba(150,150,150,0.25)" stroke="#666" stroke-width="0.8"/>`);
    else featEls.push(`<polyline data-feature="${esc(f.kind)}" points="${polyStr(fp)}" fill="none" stroke="#666" stroke-width="0.8"/>`);
  }
  if (featEls.length) els.push(`<g clip-path="url(#${clipId})">${featEls.join('')}</g>`);

  return `<g class="site-context-inset">${els.join('')}</g>`;
}
