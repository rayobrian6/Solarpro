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

// ── Nearmap AI obstruction types (roof clutter that panel layout must avoid) ──
// These are AI-detected features like vents, chimneys, A/C units, satellite dishes,
// skylights, etc. Each type has a default clearance buffer (meters) that expands
// the polygon when creating keep-out zones. Buffers are configurable constants.

export type NearmapObstructionType =
  | 'vent' | 'chimney' | 'ac_unit' | 'satellite' | 'skylight' | 'other';

export interface NearmapObstruction {
  type: NearmapObstructionType;
  /** Nearmap AI class description (e.g. "Vent", "Residential Chimney") */
  description: string;
  /** Polygon in true lat/lng (same CRS as Nearmap roof planes) */
  polygon: Array<{ lat: number; lng: number }>;
  confidence: number | null;
  captureDate: string | null;
}

/** Per-type clearance buffer in meters — panels are excluded from the obstruction
 *  polygon expanded by this margin. Easy to tune per AHJ / racking spec. */
export const OBSTRUCTION_CLEARANCE_M: Record<NearmapObstructionType, number> = {
  vent:      0.15,   // ~6" — plumbing vent / pipe boot
  chimney:   0.6,    // ~24" — IRC fire clearance + working space
  ac_unit:   0.3,    // ~12" — HVAC service clearance
  satellite: 0.3,    // ~12" — dish swing radius
  skylight:  0.3,    // ~12" — glass + flashing edge
  other:     0.15,   // default conservative buffer
};

/** Map Nearmap AI `description` → our obstruction type enum.
 *  Nearmap class names are like "Vent", "Residential Chimney",
 *  "A/C Condenser Unit", "Residential Satellite Dish", etc.
 *  Any unrecognised obstruction description maps to 'other'. */
export function mapObstructionDescription(desc: string): NearmapObstructionType {
  const d = desc.toLowerCase();
  if (d.includes('vent') || d.includes('pipe')) return 'vent';
  if (d.includes('chimney')) return 'chimney';
  if (d.includes('a/c') || d.includes('condenser') || d.includes('hvac')) return 'ac_unit';
  if (d.includes('satellite') || d.includes('dish')) return 'satellite';
  if (d.includes('skylight') || d.includes('solar tube')) return 'skylight';
  return 'other';
}

/** Known Nearmap AI obstruction class descriptions — used to filter features.
 *  We include common classes but also accept any feature that isn't a Roof,
 *  Car, Tree, etc. (non-roof non-scenery = likely obstruction on roof). */
const OBSTRUCTION_DESCRIPTIONS = new Set([
  'vent', 'residential chimney', 'a/c condenser unit', 'residential satellite dish',
  'skylight', 'solar tube', 'pipe boot', 'exhaust vent', 'ridge vent',
  'roof hvac', 'antenna', 'flashing', 'dormer', 'roof jack',
]);

/** Non-obstruction classes to explicitly skip (scenery / ground clutter). */
const SKIP_DESCRIPTIONS = new Set([
  'roof', 'car', 'tree', 'vegetation', 'shed', 'fence', 'wall', 'pool',
  'deck', 'patio', 'driveway', 'sidewalk', 'road', 'building', 'structure',
  'swimming_pool', 'trampoline', 'solar_panel',
]);

function isObstructionFeature(desc: string): boolean {
  const d = desc.toLowerCase().trim();
  if (SKIP_DESCRIPTIONS.has(d)) return false;
  // Exact match on known obstruction classes
  if (OBSTRUCTION_DESCRIPTIONS.has(d)) return true;
  // Heuristic: if it contains obstruction keywords but isn't in the skip list
  if (d.includes('vent') || d.includes('chimney') || d.includes('condenser') ||
      d.includes('hvac') || d.includes('satellite') || d.includes('dish') ||
      d.includes('skylight') || d.includes('pipe') || d.includes('exhaust') ||
      d.includes('antenna') || d.includes('dormer') || d.includes('flashing')) {
    return true;
  }
  return false;
}

/** Obstruction result cache keyed by `${lat},${lng},${surveyDate}`.
 *  Prevents re-charging Nearmap credits for the same location + survey. */
const obstructionCache = new Map<string, { result: NearmapObstruction[]; ts: number }>();
const OBSTRUCTION_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

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

// ── Nearmap obstruction detection ─────────────────────────────────────────
// Pulls AI-detected roof obstructions (vents, chimneys, A/C units, etc.)
// from the same AI Feature API call that returns roof planes.
// Obstructions are filtered by description and mapped to typed objects.

/**
 * Pure mapper: Nearmap AI Feature response JSON → obstructions.
 * Exported for testing without a network call. Returns [] for anything unusable.
 * Uses the SAME response JSON as mapNearmapRoofPlanes (one AI Feature call
//  returns both roofs and obstructions — no extra credit charge).
 */
export function mapNearmapObstructions(responseJson: unknown): NearmapObstruction[] {
  const d = responseJson as any;
  const feats: any[] = Array.isArray(d?.features) ? d.features : [];
  const obstructions: NearmapObstruction[] = [];
  for (const f of feats) {
    const desc = typeof f?.description === 'string' ? f.description : '';
    if (!isObstructionFeature(desc)) continue;
    const ring = outerRing(f.geometry);
    if (!ring || ring.length < 4) continue;
    const polygon = ring
      .filter((pt: number[]) => Array.isArray(pt) && pt.length >= 2)
      .map((pt: number[]) => ({ lat: pt[1], lng: pt[0] }));
    if (polygon.length < 4) continue;
    obstructions.push({
      type: mapObstructionDescription(desc),
      description: desc,
      polygon,
      confidence: typeof f.confidence === 'number' ? f.confidence : null,
      captureDate: f.surveyDate ?? d.surveyDate ?? null,
    });
  }
  return obstructions;
}

/**
 * Fetch obstructions for a location. Coverage-gated (free check first),
//  cached per (lat,lng,survey) to avoid re-charging credits.
 * Uses the SAME AI Feature API call — one request returns both roof planes
 * AND obstructions. Fails safe to [] on no key / no coverage / error.
 */
export async function fetchNearmapObstructions(
  lat: number,
  lng: number,
  opts: { radiusM?: number; skipCoverageCheck?: boolean } = {},
): Promise<NearmapObstruction[]> {
  const key = process.env.NEARMAP_API_KEY;
  if (!key) return [];

  // Check cache first
  const cacheKey = `${lat.toFixed(7)},${lng.toFixed(7)}`;
  const cached = obstructionCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OBSTRUCTION_CACHE_TTL_MS) {
    return cached.result;
  }

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

    const result = mapNearmapObstructions(await res.json());

    // Cache the result
    obstructionCache.set(cacheKey, { result, ts: Date.now() });

    return result;
  } catch {
    return [];
  }
}

/** Combined result from a single Nearmap AI Feature API call. */
export interface NearmapAIResult {
  roofPlanes: NearmapRoofPlane[];
  obstructions: NearmapObstruction[];
}

/**
 * Fetch both roof planes AND obstructions in a single AI Feature API call
 * (one credit charge). This is the preferred entry point for the API route,
 * which needs both results. Individual fetch functions are kept for
 * backward compat but each makes its own call (separate credit charge).
 */
export async function fetchNearmapAIResult(
  lat: number,
  lng: number,
  opts: { radiusM?: number; skipCoverageCheck?: boolean } = {},
): Promise<NearmapAIResult> {
  const key = process.env.NEARMAP_API_KEY;
  const empty: NearmapAIResult = { roofPlanes: [], obstructions: [] };
  if (!key) return empty;

  try {
    if (!opts.skipCoverageCheck) {
      const cov = await checkNearmapCoverage(lat, lng);
      if (!cov?.covered || !cov.hasAiFeatures) return empty;
    }

    const polygon = aoiPolygonAround(lat, lng, opts.radiusM ?? 40);
    const res = await fetch(`${AI_FEATURE_URL}?polygon=${polygon}&apikey=${key}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return empty;

    const json = await res.json();
    const roofPlanes = mapNearmapRoofPlanes(json);
    const obstructions = mapNearmapObstructions(json);

    // Cache obstructions for the combined fetch too
    const cacheKey = `${lat.toFixed(7)},${lng.toFixed(7)}`;
    obstructionCache.set(cacheKey, { result: obstructions, ts: Date.now() });

    return { roofPlanes, obstructions };
  } catch {
    return empty;
  }
}
