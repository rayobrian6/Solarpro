// ============================================================================
// lib/siteSurveys/aerialGeometry/eagleViewMeasurementParser.ts
//
// Parses an EagleView "EV Measurement JSON" roof report (fileType 107) into
// vendor-neutral RoofFacets.
//
// The report is a CAD-style boundary model:
//   POINTS: { @id, @data:"x,y,z" }      local planar coordinates in FEET
//   LINES:  { @id, @path:"Pa,Pb", @type } edges (EAVE/HIP/RIDGE/VALLEY/RAKE/…)
//   FACES:  { @id, @type:"ROOF"|…, POLYGON:{ @path:"La,Lb,…", @pitch, @orientation, @size } }
//           POLYGON.@path lists the boundary LINE ids in order.
//
// To get real-world lat/lng facet polygons we:
//   1. reconstruct each ROOF facet's ordered vertex ring from its line path,
//   2. self-CALIBRATE the local→true-north rotation by matching each facet's
//      reconstructed downslope bearing to EagleView's given @orientation
//      (no reliance on a guessed coordinate convention),
//   3. rotate + scale local feet offsets (centroid-anchored at the report
//      lat/lng) into WGS84 lat/lng.
// Pitch comes from @pitch (rise/12), azimuth from @orientation, area from @size.
// ============================================================================

import type { RoofFacet } from './types';
import type { LatLng, WorldRoofEdgeType } from '@/lib/siteSurveys/googleSolarApi/worldRoofPlanes';

const FT_TO_M = 0.3048;
const M_PER_DEG_LAT = 111_320;
const SQFT_TO_SQM = 0.092903;

const EDGE_MAP: Record<string, WorldRoofEdgeType> = {
  RIDGE: 'ridge', EAVE: 'eave', RAKE: 'rake', HIP: 'hip', VALLEY: 'valley',
};

type Vec3 = { x: number; y: number; z: number };
const asArr = <T>(x: T | T[] | undefined | null): T[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** Roof measurement summary — the data behind a length/pitch/area report. */
export interface RoofMeasurementSummary {
  totalAreaSqFt: number;
  facetCount: number;
  predominantPitch: string | null; // e.g. "10/12"
  areasByPitch: Array<{ pitch: string; areaSqFt: number; pct: number }>;
  /** Total edge length per type, in feet (true 3D edge length). */
  lineLengthsFt: Record<'ridge' | 'hip' | 'valley' | 'rake' | 'eave' | 'flashing' | 'stepFlashing' | 'parapet' | 'other', number>;
  lineCounts: Record<'ridge' | 'hip' | 'valley' | 'rake' | 'eave' | 'flashing' | 'stepFlashing' | 'parapet' | 'other', number>;
}

export interface EvParseResult {
  facets: RoofFacet[];
  roofFacetCount: number;
  calibrationRotationDeg: number | null;
  northOrientation: number | null;
  summary: RoofMeasurementSummary;
}

const LINE_TYPE_MAP: Record<string, keyof RoofMeasurementSummary['lineLengthsFt']> = {
  RIDGE: 'ridge', HIP: 'hip', VALLEY: 'valley', RAKE: 'rake', EAVE: 'eave',
  FLASHING: 'flashing', STEPFLASH: 'stepFlashing', PARAPET: 'parapet', OTHER: 'other',
};

/** Standard roofing waste table: total area + roofing squares at each waste %. */
export function wasteTable(
  totalAreaSqFt: number,
  steps: number[] = [0, 10, 12, 15, 17, 20, 22],
): Array<{ wastePct: number; areaSqFt: number; squares: number }> {
  return steps.map((wastePct) => {
    const areaSqFt = Math.round(totalAreaSqFt * (1 + wastePct / 100));
    return { wastePct, areaSqFt, squares: Math.ceil((areaSqFt / 100) * 10) / 10 };
  });
}

/** Least-squares fit z = a*x + b*y + c over vertices; returns gradient (a,b). */
function planeGradient(v: Vec3[]): { a: number; b: number } {
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, n = v.length;
  let Sxz = 0, Syz = 0, Sz = 0;
  for (const p of v) {
    Sxx += p.x * p.x; Sxy += p.x * p.y; Syy += p.y * p.y;
    Sx += p.x; Sy += p.y; Sxz += p.x * p.z; Syz += p.y * p.z; Sz += p.z;
  }
  // Solve 3x3 normal equations [[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,n]] · [a,b,c] = [Sxz,Syz,Sz]
  const M = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
  const r = [Sxz, Syz, Sz];
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0 };
  const inv0 = [
    (M[1][1] * M[2][2] - M[1][2] * M[2][1]) / det,
    (M[0][2] * M[2][1] - M[0][1] * M[2][2]) / det,
    (M[0][1] * M[1][2] - M[0][2] * M[1][1]) / det,
  ];
  const inv1 = [
    (M[1][2] * M[2][0] - M[1][0] * M[2][2]) / det,
    (M[0][0] * M[2][2] - M[0][2] * M[2][0]) / det,
    (M[0][2] * M[1][0] - M[0][0] * M[1][2]) / det,
  ];
  const a = inv0[0] * r[0] + inv0[1] * r[1] + inv0[2] * r[2];
  const b = inv1[0] * r[0] + inv1[1] * r[1] + inv1[2] * r[2];
  return { a, b };
}

/** Compass bearing (deg, CW from +Y/"north") of a local vector. */
const localBearing = (dx: number, dy: number) => norm360((Math.atan2(dx, dy) * 180) / Math.PI);

const emptyLineRec = (): RoofMeasurementSummary['lineLengthsFt'] => ({
  ridge: 0, hip: 0, valley: 0, rake: 0, eave: 0, flashing: 0, stepFlashing: 0, parapet: 0, other: 0,
});
const emptySummary = (): RoofMeasurementSummary => ({
  totalAreaSqFt: 0, facetCount: 0, predominantPitch: null, areasByPitch: [],
  lineLengthsFt: emptyLineRec(), lineCounts: emptyLineRec(),
});

export function parseEagleViewMeasurementJson(
  raw: any,
  originLat: number,
  originLng: number,
): EvParseResult {
  const S = raw?.EAGLEVIEW_EXPORT?.STRUCTURES;
  const roof = S?.ROOF;
  const northOrientation = S?.['@northorientation'] != null ? Number(S['@northorientation']) : null;
  if (!roof) return { facets: [], roofFacetCount: 0, calibrationRotationDeg: null, northOrientation, summary: emptySummary() };

  const pts = new Map<string, Vec3>();
  for (const p of asArr<any>(roof.POINTS?.POINT)) {
    const id = p?.['@id'];
    const d = String(p?.['@data'] ?? '').split(',').map(Number);
    if (id && d.length >= 3 && d.every((n) => Number.isFinite(n))) pts.set(id, { x: d[0], y: d[1], z: d[2] });
  }
  const lines = new Map<string, { a: string; b: string; type: string }>();
  for (const l of asArr<any>(roof.LINES?.LINE)) {
    const id = l?.['@id'];
    const [a, b] = String(l?.['@path'] ?? '').split(',');
    if (id && a && b) lines.set(id, { a, b, type: String(l?.['@type'] ?? '') });
  }

  // Reconstruct an ordered vertex ring (point ids + outgoing edge types) from a
  // POLYGON line path. The lines are in boundary order but each may be reversed.
  function ring(lineIds: string[]): { ids: string[]; types: string[] } | null {
    const segs = lineIds.map((id) => lines.get(id)).filter(Boolean) as { a: string; b: string; type: string }[];
    if (segs.length < 3) return null;
    const shared = (s1: { a: string; b: string }, s2: { a: string; b: string }) =>
      s1.a === s2.a || s1.a === s2.b ? s1.a : s1.b === s2.a || s1.b === s2.b ? s1.b : null;
    const sh = shared(segs[0], segs[1]);
    if (!sh) return null;
    let cur = segs[0].a === sh ? segs[0].b : segs[0].a; // start at seg0's non-shared end
    const ids: string[] = [];
    const types: string[] = [];
    for (const s of segs) {
      ids.push(cur);
      types.push(s.type);
      cur = s.a === cur ? s.b : s.a;
    }
    return { ids, types };
  }

  // Pass 1: build raw roof facets (local vertices) + per-facet downslope bearing.
  interface Raw {
    verts: Vec3[];
    pitchDeg: number;
    pitchOver12: number;
    orientation: number;
    areaSqM: number;
    edgeTypes: WorldRoofEdgeType[];
    downslopeBearing: number;
  }
  const rawFacets: Raw[] = [];
  let cx = 0, cy = 0, cn = 0;

  for (const f of asArr<any>(roof.FACES?.FACE)) {
    if (String(f?.['@type']) !== 'ROOF') continue; // skip ROOFPENETRATION etc.
    const poly = f.POLYGON;
    if (!poly) continue;
    const r = ring(String(poly['@path'] ?? '').split(',').filter(Boolean));
    if (!r) continue;
    const verts = r.ids.map((id) => pts.get(id)).filter(Boolean) as Vec3[];
    if (verts.length < 3) continue;

    const pitchOver12 = Number(poly['@pitch'] ?? 0);
    const pitchDeg = (Math.atan2(pitchOver12, 12) * 180) / Math.PI;
    const orientation = norm360(Number(poly['@orientation'] ?? 0));
    const areaSqM = Number(poly['@unroundedsize'] ?? poly['@size'] ?? 0) * SQFT_TO_SQM;
    const { a, b } = planeGradient(verts);
    const downslopeBearing = localBearing(-a, -b); // steepest descent

    const edgeTypes = r.types.map((t) => EDGE_MAP[t]).filter(Boolean) as WorldRoofEdgeType[];
    rawFacets.push({ verts, pitchDeg, pitchOver12, orientation, areaSqM, edgeTypes, downslopeBearing });
    for (const v of verts) { cx += v.x; cy += v.y; cn++; }
  }

  if (rawFacets.length === 0) return { facets: [], roofFacetCount: 0, calibrationRotationDeg: null, northOrientation, summary: emptySummary() };
  cx /= cn; cy /= cn;

  // Pass 2: CALIBRATE rotation = circular-mean(orientation - downslopeBearing),
  // weighted by area (bigger facets = more reliable slope). This maps the local
  // frame to true north without guessing EagleView's convention.
  let sumSin = 0, sumCos = 0;
  for (const f of rawFacets) {
    if (f.pitchDeg < 2) continue; // near-flat facets have no reliable downslope
    const off = (f.orientation - f.downslopeBearing) * (Math.PI / 180);
    const w = Math.max(f.areaSqM, 1);
    sumSin += Math.sin(off) * w; sumCos += Math.cos(off) * w;
  }
  const rotationDeg = norm360((Math.atan2(sumSin, sumCos) * 180) / Math.PI);

  // Pass 3: rotate + scale local offsets (from centroid) into lat/lng.
  const cosLat = Math.cos((originLat * Math.PI) / 180) || 1e-6;
  const toLatLng = (v: Vec3): LatLng => {
    const dx = v.x - cx, dy = v.y - cy;
    const r = Math.hypot(dx, dy);
    const trueBearing = (localBearing(dx, dy) + rotationDeg) * (Math.PI / 180);
    const Eft = r * Math.sin(trueBearing), Nft = r * Math.cos(trueBearing);
    return {
      lat: originLat + (Nft * FT_TO_M) / M_PER_DEG_LAT,
      lng: originLng + (Eft * FT_TO_M) / (M_PER_DEG_LAT * cosLat),
    };
  };

  const facets: RoofFacet[] = rawFacets.map((f) => ({
    pitchDegrees: Math.round(f.pitchDeg * 10) / 10,
    azimuthDegrees: Math.round(f.orientation * 10) / 10,
    areaSqM: Math.round(f.areaSqM * 100) / 100,
    polygon: f.verts.map(toLatLng),
    edgeTypes: f.edgeTypes.length === f.verts.length ? f.edgeTypes : undefined,
  }));

  // ── Measurement summary (true 3D edge lengths by type + areas by pitch) ──────
  const lineLengthsFt = emptyLineRec();
  const lineCounts = emptyLineRec();
  for (const { a, b, type } of lines.values()) {
    const pa = pts.get(a), pb = pts.get(b);
    if (!pa || !pb) continue;
    const key = LINE_TYPE_MAP[type.toUpperCase()] ?? 'other';
    lineLengthsFt[key] += Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
    lineCounts[key] += 1;
  }
  for (const k of Object.keys(lineLengthsFt) as Array<keyof typeof lineLengthsFt>) {
    lineLengthsFt[k] = Math.round(lineLengthsFt[k]);
  }

  const SQM_TO_SQFT = 1 / SQFT_TO_SQM;
  const pitchAreas = new Map<number, number>();
  let totalSqFt = 0;
  for (const f of rawFacets) {
    const sqft = f.areaSqM * SQM_TO_SQFT;
    totalSqFt += sqft;
    pitchAreas.set(f.pitchOver12, (pitchAreas.get(f.pitchOver12) ?? 0) + sqft);
  }
  const areasByPitch = [...pitchAreas.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([p, area]) => ({
      pitch: `${Math.round(p)}/12`,
      areaSqFt: Math.round(area),
      pct: totalSqFt > 0 ? Math.round((area / totalSqFt) * 1000) / 10 : 0,
    }));

  const summary: RoofMeasurementSummary = {
    totalAreaSqFt: Math.round(totalSqFt),
    facetCount: rawFacets.length,
    predominantPitch: areasByPitch[0]?.pitch ?? null,
    areasByPitch,
    lineLengthsFt,
    lineCounts,
  };

  return { facets, roofFacetCount: facets.length, calibrationRotationDeg: Math.round(rotationDeg * 10) / 10, northOrientation, summary };
}
