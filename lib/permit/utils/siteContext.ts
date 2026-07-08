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
const esc = (s: string) => String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');

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

  const all = [...pPar, ...pBld, ...pPan, ...eqPts];
  const minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x));
  const minY = Math.min(...all.map(p => p.y)), maxY = Math.max(...all.map(p => p.y));
  const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);

  const pad = 10, hdrH = 16, ftrH = 30;
  const drawW = box.w - 2 * pad, drawH = box.h - 2 * pad - hdrH - ftrH;
  const scale = Math.min(drawW / spanX, drawH / spanY); // px per metre
  const offX = (drawW - spanX * scale) / 2;
  const offY = (drawH - spanY * scale) / 2;
  const toX = (p: { x: number }) => box.x + pad + offX + (p.x - minX) * scale;
  const toY = (p: { y: number }) => box.y + pad + hdrH + offY + (maxY - p.y) * scale; // north up

  const polyStr = (pp: Array<{ x: number; y: number }>) => pp.map(p => `${toX(p).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');

  const els: string[] = [];
  // Panel bounding box for a "closest approach" array setback + array footprint
  let arraySetback: number | null = null;
  if (panels.length) {
    arraySetback = minSetbackFt(panels, parcel, origin);
  }
  const buildingSetback = building.length ? minSetbackFt(building, parcel, origin) : null;

  // Frame + header
  els.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#ffffff" stroke="#111" stroke-width="1"/>`);
  els.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${hdrH}" fill="#111"/>`);
  els.push(`<text x="${box.x + 6}" y="${box.y + 11}" font-family="Arial" font-size="8" font-weight="700" fill="#fff" letter-spacing="0.5">SITE / PLOT PLAN — APPROXIMATE (NOT A SURVEY)</text>`);

  // Parcel boundary (solid, approximate)
  els.push(`<polygon points="${polyStr(pPar)}" fill="none" stroke="#111" stroke-width="1.4"/>`);
  // Parcel edge length dimensions
  const edgeFt = polygonEdgeLengthsFt(parcel);
  for (let i = 0; i < pPar.length; i++) {
    const a = pPar[i], b = pPar[(i + 1) % pPar.length];
    const mx = (toX(a) + toX(b)) / 2, my = (toY(a) + toY(b)) / 2;
    els.push(`<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" font-family="Arial" font-size="6" fill="#111" text-anchor="middle" stroke="#fff" stroke-width="1.6" paint-order="stroke">${edgeFt[i].toFixed(0)}'</text>`);
  }

  // Building footprint (hull)
  if (pBld.length >= 3) {
    els.push(`<polygon points="${polyStr(pBld)}" fill="rgba(120,120,120,0.18)" stroke="#444" stroke-width="1"/>`);
  }
  // PV array footprint (hull of panel centers, hatched)
  if (pPan.length >= 3) {
    const ah = convexHullLatLng(panels);
    const pah = projectToLocalM(ah, origin);
    els.push(`<polygon points="${polyStr(pah)}" fill="rgba(23,58,161,0.28)" stroke="#173aa1" stroke-width="1"/>`);
    const cx = pah.reduce((s, p) => s + toX(p), 0) / pah.length;
    const cy = pah.reduce((s, p) => s + toY(p), 0) / pah.length;
    els.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-family="Arial" font-size="6.5" font-weight="700" fill="#173aa1" text-anchor="middle">PV ARRAY</text>`);
  }

  // Service equipment markers (existing provenance kept as tiny tag)
  const kindTag: Record<string, string> = { utility_meter: 'UM', msp: 'MSP', ac_disconnect: 'AC' };
  for (const e of eqPts) {
    const x = toX(e), y = toY(e);
    els.push(`<rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" fill="#fff" stroke="#111" stroke-width="0.8"/>`);
    els.push(`<text x="${x.toFixed(1)}" y="${(y + 2).toFixed(1)}" font-family="Arial" font-size="5" font-weight="700" fill="#111" text-anchor="middle">${kindTag[e.kind] ?? '?'}</text>`);
  }

  // Street name — LABEL ONLY, near the frontage edge. No road/curb geometry drawn.
  if (input.streetName && input.streetPin && isFinite(input.streetPin.lat)) {
    const sp = latLngToXY(input.streetPin.lat, input.streetPin.lng, origin.lat, origin.lng);
    const sx = Math.max(box.x + 6, Math.min(box.x + box.w - 6, toX(sp)));
    const sy = Math.max(box.y + hdrH + 10, Math.min(box.y + box.h - ftrH - 4, toY(sp)));
    els.push(`<text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" font-family="Arial" font-size="6.5" font-weight="700" fill="#555" text-anchor="middle" stroke="#fff" stroke-width="1.6" paint-order="stroke">${esc(input.streetName)}</text>`);
  }

  // North arrow (small, top-right of inset)
  const nax = box.x + box.w - 16, nay = box.y + hdrH + 14;
  els.push(`<line x1="${nax}" y1="${nay + 8}" x2="${nax}" y2="${nay - 6}" stroke="#111" stroke-width="1"/>`);
  els.push(`<path d="M ${nax} ${nay - 9} L ${nax - 3} ${nay - 3} L ${nax + 3} ${nay - 3} Z" fill="#111"/>`);
  els.push(`<text x="${nax}" y="${nay - 11}" font-family="Arial" font-size="6" font-weight="700" fill="#111" text-anchor="middle">N</text>`);

  // Footer: approximate setbacks + graphic/written scale + APN + provenance
  const fy = box.y + box.h - ftrH;
  els.push(`<line x1="${box.x}" y1="${fy}" x2="${box.x + box.w}" y2="${fy}" stroke="#ccc" stroke-width="0.6"/>`);
  const sbBits: string[] = [];
  if (buildingSetback != null) sbBits.push(`BLDG→P/L ~${buildingSetback.toFixed(0)}'`);
  if (arraySetback != null) sbBits.push(`ARRAY→P/L ~${arraySetback.toFixed(0)}'`);
  els.push(`<text x="${box.x + 6}" y="${fy + 9}" font-family="Arial" font-size="6" font-weight="700" fill="#111">${sbBits.join('   ')}  ·  APPROXIMATE — BASED ON COUNTY GIS</text>`);
  // Graphic scale bar (10 ft)
  const barPx = Math.max(10 * (scale * M_TO_FT), 14); // scale is px/m → px per 10 ft
  const bx = box.x + 6, by = fy + 20;
  els.push(`<line x1="${bx}" y1="${by}" x2="${(bx + barPx).toFixed(1)}" y2="${by}" stroke="#111" stroke-width="1.4"/>`);
  els.push(`<line x1="${bx}" y1="${by - 3}" x2="${bx}" y2="${by + 3}" stroke="#111" stroke-width="1"/>`);
  els.push(`<line x1="${(bx + barPx).toFixed(1)}" y1="${by - 3}" x2="${(bx + barPx).toFixed(1)}" y2="${by + 3}" stroke="#111" stroke-width="1"/>`);
  els.push(`<text x="${(bx + barPx + 4).toFixed(1)}" y="${by + 2.5}" font-family="Arial" font-size="6" fill="#111">10 FT (APPROX)</text>`);
  const apn = input.parcel?.apn ? `APN ${esc(String(input.parcel.apn))}` : '';
  const src = input.parcel?.source ? esc(String(input.parcel.source)) : 'COUNTY GIS';
  els.push(`<text x="${box.x + box.w - 6}" y="${fy + 9}" font-family="Arial" font-size="5.5" fill="#555" text-anchor="end">${apn}</text>`);
  els.push(`<text x="${box.x + box.w - 6}" y="${fy + 20}" font-family="Arial" font-size="5.5" fill="#555" text-anchor="end">APPROXIMATE PROPERTY LINE — ${src} — VERIFY</text>`);

  // Provider-supplied site features — ONLY approved + permit-renderable ones.
  for (const f of (input.features ?? [])) {
    if (!isPermitRenderable(f)) continue; // detected/inferred/review_required → omitted from permit
    const fp = projectToLocalM(f.geometryWgs84, origin);
    if (f.geometryType === 'polygon') {
      els.push(`<polygon data-feature="${esc(f.kind)}" points="${polyStr(fp)}" fill="rgba(150,150,150,0.25)" stroke="#666" stroke-width="0.8"/>`);
    } else {
      els.push(`<polyline data-feature="${esc(f.kind)}" points="${polyStr(fp)}" fill="none" stroke="#666" stroke-width="0.8"/>`);
    }
  }

  return `<g class="site-context-inset">${els.join('')}</g>`;
}
