// ============================================================
// Nearmap aerial roof-geometry adapter (SERVER-ONLY)
// ============================================================
// Pulls real roof geometry from Nearmap's AI Feature API and maps it into a
// clean roof-plane shape that feeds the geometry rail (UnifiedGeometryArtifact →
// CanonicalBuildingModel → planset). This is the licensed-aerial replacement for
// the dead ground-photo CV path.
//
// Verified against the live eval (2026-06-22):
//   Coverage:    GET https://api.nearmap.com/coverage/v2/point/{lon},{lat}?apikey=KEY
//   AI Feature:  GET https://api.nearmap.com/ai/features/v4/features.json?polygon={lon,lat,...}&apikey=KEY
//   Each AI-Feature call costs CREDITS, so always coverage-check (free) first and
//   cache. A "Roof" feature carries: geometry (GeoJSON Polygon, real lon/lat),
//   areaSqft, confidence, and attributes incl. "Roof 3d attributes".pitch (deg),
//   "Roof material" (shingle/metal/tile ratios) and "Roof types" (gable/hip/...).
//
// REQUIRES env NEARMAP_API_KEY. With no key (or any error / no coverage), every
// function fails safe → null / [] so callers fall back to manual/survey geometry.
// Deep-rural sites (e.g. Pocahontas IL) have no Nearmap coverage — USGS LIDAR is
// the planned free fallback there.
//
// ⚠ AZIMUTH is not provided by the 2D AI feature (pitch is). Per-facet azimuth is
// a known follow-up (derive from facet 3D / DSM aspect, or operator-set). We do
// NOT fabricate it — azimuthDeg stays null until we have a real source.

const COVERAGE_URL = 'https://api.nearmap.com/coverage/v2/point';
const AI_FEATURE_URL = 'https://api.nearmap.com/ai/features/v4/features.json';
const TIMEOUT_MS = 30000;

export interface NearmapCoverage {
  covered: boolean;
  surveyCount: number;
  latestCaptureDate: string | null;
  hasAiFeatures: boolean;
}

export interface NearmapRoofPlane {
  worldPolygon: Array<{ lat: number; lng: number }>;
  areaSqft: number | null;
  pitchDeg: number | null;       // dominant roof pitch from "Roof 3d attributes"
  azimuthDeg: number | null;     // NOT provided by Nearmap 2D AI — follow-up (DSM/facet derive)
  roofType: string | null;       // gable / hip / flat / mansard / ...
  material: string | null;       // dominant roof material
  confidence: number | null;
  captureDate: string | null;
  source: 'nearmap_ai';
}

export const nearmapConfigured = (): boolean => !!process.env.NEARMAP_API_KEY;

/** Small lon,lat AOI ring (closed) around a point. radiusM ~ half-box edge. */
export function aoiPolygonAround(lat: number, lng: number, radiusM = 40): string {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring = [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
  return ring.map(([x, y]) => `${x},${y}`).join(',');
}

/** Free coverage check. Returns null on no-key / error. */
export async function checkNearmapCoverage(lat: number, lng: number): Promise<NearmapCoverage | null> {
  const key = process.env.NEARMAP_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${COVERAGE_URL}/${lng},${lat}?apikey=${key}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const surveys: any[] = Array.isArray(data?.surveys) ? data.surveys : [];
    const top = surveys[0];
    const resources = top?.resources ? Object.keys(top.resources) : [];
    return {
      covered: surveys.length > 0,
      surveyCount: surveys.length,
      latestCaptureDate: top?.captureDate ?? null,
      hasAiFeatures: resources.includes('aifeatures'),
    };
  } catch {
    return null;
  }
}

// ── Attribute extraction (defensive — Nearmap's nested AI attribute shape) ──
function findAttr(feature: any, descMatch: (d: string) => boolean): any | null {
  const attrs = feature?.attributes;
  if (!Array.isArray(attrs)) return null;
  return attrs.find((a) => typeof a?.description === 'string' && descMatch(a.description.toLowerCase())) ?? null;
}

function extractPitch(feature: any): number | null {
  const a = findAttr(feature, (d) => d.includes('3d'));
  const p = a?.pitch;
  return typeof p === 'number' && isFinite(p) ? Math.round(p * 10) / 10 : null;
}

function extractDominant(feature: any, descMatch: (d: string) => boolean): string | null {
  const a = findAttr(feature, descMatch);
  // Skip Nearmap's deprecated class variants (e.g. "Flat (Deprecated)") — they
  // pollute the dominant pick (a 22° roof was being labelled "Flat").
  const comps: any[] = (Array.isArray(a?.components) ? a.components : [])
    .filter((c) => typeof c?.description === 'string' && !/deprecated/i.test(c.description));
  if (comps.length === 0) return null;
  const dom = comps.find((c) => c?.dominant) ??
    comps.slice().sort((x, y) => (y?.ratio ?? 0) - (x?.ratio ?? 0))[0];
  return dom?.description ?? null;
}

/** Largest outer ring [[lon,lat],...] from a GeoJSON Polygon/MultiPolygon. */
function outerRing(geom: any): number[][] | null {
  if (!geom) return null;
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) return geom.coordinates[0];
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    let best: number[][] | null = null;
    for (const poly of geom.coordinates) {
      const ring = poly?.[0];
      if (Array.isArray(ring) && (!best || ring.length > best.length)) best = ring;
    }
    return best;
  }
  return null;
}

/**
 * Pure mapper: Nearmap AI Feature response JSON → roof planes. Exported for
 * testing without a network call. Returns [] for anything unusable.
 */
export function mapNearmapRoofPlanes(responseJson: unknown): NearmapRoofPlane[] {
  const d = responseJson as any;
  const feats: any[] = Array.isArray(d?.features) ? d.features : [];
  const planes: NearmapRoofPlane[] = [];
  for (const f of feats) {
    if (f?.description !== 'Roof') continue;
    const ring = outerRing(f.geometry);
    if (!ring || ring.length < 4) continue;
    const worldPolygon = ring
      .filter((pt: number[]) => Array.isArray(pt) && pt.length >= 2)
      .map((pt: number[]) => ({ lat: pt[1], lng: pt[0] }));
    if (worldPolygon.length < 4) continue;
    planes.push({
      worldPolygon,
      areaSqft: typeof f.areaSqft === 'number' ? Math.round(f.areaSqft)
        : typeof f.unclippedAreaSqft === 'number' ? Math.round(f.unclippedAreaSqft) : null,
      pitchDeg: extractPitch(f),
      azimuthDeg: null,
      roofType: extractDominant(f, (dsc) => dsc.includes('roof type')),
      material: extractDominant(f, (dsc) => dsc.includes('roof material')),
      confidence: typeof f.confidence === 'number' ? f.confidence : null,
      captureDate: f.surveyDate ?? d.surveyDate ?? null,
      source: 'nearmap_ai',
    });
  }
  return planes;
}

/**
 * Fetch roof planes for a location. Coverage-gated (free check first), so the
 * paid AI-Feature call only fires where Nearmap actually flies. Fails safe to []
 * (no key / no coverage / error) so callers fall back to manual geometry.
 */
export async function fetchNearmapRoofPlanes(
  lat: number,
  lng: number,
  opts: { radiusM?: number; skipCoverageCheck?: boolean } = {},
): Promise<NearmapRoofPlane[]> {
  const key = process.env.NEARMAP_API_KEY;
  if (!key) return [];
  try {
    if (!opts.skipCoverageCheck) {
      const cov = await checkNearmapCoverage(lat, lng);
      if (!cov?.covered || !cov.hasAiFeatures) return [];
    }
    const polygon = aoiPolygonAround(lat, lng, opts.radiusM ?? 40);
    const res = await fetch(`${AI_FEATURE_URL}?polygon=${polygon}&apikey=${key}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return mapNearmapRoofPlanes(await res.json());
  } catch {
    return [];
  }
}
