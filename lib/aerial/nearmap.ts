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
const TILE_URL = 'https://api.nearmap.com/tiles/v3/Vert';   // {z}/{x}/{y}.jpg
const TIMEOUT_MS = 30000;

// ── Web-Mercator tile math (pure — standard XYZ / EPSG:3857, 256px tiles) ──
// Nearmap Vert tiles share Google/OSM's projection, so a stitched Nearmap image
// is geometrically interchangeable with the Google Static Maps aerial.
const TILE_SIZE = 256;

/** Global pixel X of a longitude at zoom z (0 … 256·2^z). */
export function lngToGlobalPx(lng: number, z: number): number {
  return ((lng + 180) / 360) * TILE_SIZE * 2 ** z;
}
/** Global pixel Y of a latitude at zoom z. */
export function latToGlobalPx(lat: number, z: number): number {
  const s = Math.max(-0.9999, Math.min(0.9999, Math.sin((lat * Math.PI) / 180)));
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE_SIZE * 2 ** z;
}

export interface TilePlacement { z: number; x: number; y: number; left: number; top: number; }
export interface TileGrid {
  tiles: TilePlacement[];       // tile coords + composite offset within the full tile canvas
  tx0: number; ty0: number;     // top-left tile index of the canvas
  canvasW: number; canvasH: number;
  cropLeft: number; cropTop: number;   // where to extract the centred WxH image
  W: number; H: number;
}

/** Tiles needed to render a W×H image centred on (lat,lng) at zoom z, plus the
 *  crop offset into the whole-tile canvas. Pure — no I/O (testable). */
export function nearmapTileGrid(lat: number, lng: number, z: number, W: number, H: number): TileGrid {
  const cx = lngToGlobalPx(lng, z), cy = latToGlobalPx(lat, z);
  const left = cx - W / 2, top = cy - H / 2;
  const tx0 = Math.floor(left / TILE_SIZE), ty0 = Math.floor(top / TILE_SIZE);
  const tx1 = Math.floor((left + W - 1) / TILE_SIZE), ty1 = Math.floor((top + H - 1) / TILE_SIZE);
  const tiles: TilePlacement[] = [];
  for (let x = tx0; x <= tx1; x++) {
    for (let y = ty0; y <= ty1; y++) {
      tiles.push({ z, x, y, left: (x - tx0) * TILE_SIZE, top: (y - ty0) * TILE_SIZE });
    }
  }
  return {
    tiles, tx0, ty0,
    canvasW: (tx1 - tx0 + 1) * TILE_SIZE, canvasH: (ty1 - ty0 + 1) * TILE_SIZE,
    cropLeft: Math.round(left - tx0 * TILE_SIZE), cropTop: Math.round(top - ty0 * TILE_SIZE),
    W, H,
  };
}

export interface NearmapStaticAerial {
  imageBase64: string;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  tilesFetched: number;
}

/**
 * Compose fetched tiles onto the whole-tile canvas, then crop the centred W×H
 * window — in TWO sharp passes. In a single chain sharp applies .composite()
 * at the END of its pipeline (after .extract()), so the extract cropped the
 * BLANK canvas and the tiles were then pasted at full-canvas offsets onto the
 * already-cropped image: the whole scene rendered shifted by (cropLeft,
 * cropTop) — a centre-dependent 0-255px (≈0-15 m @ z21) offset. That was the
 * "house not centred" planset bug (proved against the 3 Melvin Dr render:
 * measured scene shift +200,+112 px == the design-centre crop offset 190,112).
 * Exported for the regression test.
 */
export async function stitchAndCropTiles(
  sharpLib: typeof import('sharp'),
  grid: TileGrid,
  composites: Array<{ input: Buffer; left: number; top: number }>,
): Promise<Buffer> {
  const canvas = await sharpLib({
    create: { width: grid.canvasW, height: grid.canvasH, channels: 3, background: { r: 20, g: 20, b: 20 } },
  })
    .composite(composites)
    .png() // lossless intermediate — jpeg here would double-compress the tiles
    .toBuffer();
  return sharpLib(canvas)
    .extract({ left: grid.cropLeft, top: grid.cropTop, width: grid.W, height: grid.H })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/**
 * Stitch a centred top-down Nearmap Vert aerial (7.5cm @ z21) as a single JPEG.
 * Server-only (uses the key directly + sharp). Tries zooms in order, first with
 * enough real tiles wins. Fails safe → null so callers fall back to Google.
 */
export async function fetchNearmapStaticAerial(
  lat: number, lng: number,
  opts: { zoom?: number; sizePx?: number; widthPx?: number; heightPx?: number } = {},
): Promise<NearmapStaticAerial | null> {
  const key = process.env.NEARMAP_API_KEY;
  if (!key) return null;
  const W = opts.widthPx ?? opts.sizePx ?? 1024;
  const H = opts.heightPx ?? opts.sizePx ?? 1024;
  const zooms = opts.zoom ? [opts.zoom] : [21, 20, 19];
  let sharp: typeof import('sharp');
  try { sharp = (await import('sharp')).default as unknown as typeof import('sharp'); }
  catch { return null; }

  for (const z of zooms) {
    try {
      const grid = nearmapTileGrid(lat, lng, z, W, H);
      const results = await Promise.all(grid.tiles.map(async (t) => {
        try {
          const r = await fetch(`${TILE_URL}/${t.z}/${t.x}/${t.y}.jpg?apikey=${key}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!r.ok) return null;
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.byteLength < 500) return null;   // blank/placeholder tile
          return { input: buf, left: t.left, top: t.top };
        } catch { return null; }
      }));
      const composites = results.filter(c => c !== null) as Array<{ input: Buffer; left: number; top: number }>;
      if (composites.length === 0) continue;

      const out = await stitchAndCropTiles(sharp, grid, composites);

      return {
        imageBase64: `data:image/jpeg;base64,${out.toString('base64')}`,
        imageWidth: W, imageHeight: H, zoom: z, tilesFetched: composites.length,
      };
    } catch {
      continue;
    }
  }
  return null;
}

// ── Aerial frame snap: center the aerial on Nearmap's OWN detected roof ──────
// The AI roof polygons live in the same imagery frame as the Vert tiles, so a
// frame centered on the roof polygon's bbox center puts the HOME pixel-exact at
// the image center — immune to street-interpolated geocode pins (~15m off at
// 3 Melvin Dr) and to the imagery-vs-GPS registration offset a design-centroid
// center inherits (Ray, 2026-07-01: circled home sat right-of-center on PV-1).

export interface RoofSnapResult { lat: number; lng: number; distM: number; contained: boolean; }

/** Ray-casting point-in-polygon on a lat/lng ring. */
function pointInRing(lat: number, lng: number, ring: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lng, yj = ring[j].lat, xj = ring[j].lng;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Pick the roof polygon the aerial should frame: the one CONTAINING (lat,lng),
 * else the nearest bbox-center within maxSnapM meters. Returns that polygon's
 * bbox center (the visual "home center" for framing), or null when nothing
 * qualifies. Pure — exported for unit tests.
 */
export function nearmapRoofSnapCenter(
  lat: number, lng: number,
  planes: Array<Pick<NearmapRoofPlane, 'worldPolygon'>>,
  opts: { maxSnapM?: number } = {},
): RoofSnapResult | null {
  const maxSnapM = opts.maxSnapM ?? 25;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best: RoofSnapResult | null = null;
  for (const p of planes ?? []) {
    const poly = p?.worldPolygon;
    if (!Array.isArray(poly) || poly.length < 4) continue;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const v of poly) {
      if (!v || !isFinite(v.lat) || !isFinite(v.lng)) { minLat = Infinity; break; }
      if (v.lat < minLat) minLat = v.lat;
      if (v.lat > maxLat) maxLat = v.lat;
      if (v.lng < minLng) minLng = v.lng;
      if (v.lng > maxLng) maxLng = v.lng;
    }
    if (!isFinite(minLat)) continue;
    const cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
    const distM = Math.hypot((cLat - lat) * 111320, (cLng - lng) * 111320 * cosLat);
    const contained = pointInRing(lat, lng, poly);
    const cand: RoofSnapResult = { lat: cLat, lng: cLng, distM, contained };
    if (contained) {
      // A containing roof always wins; among several (touching structures), nearest.
      if (!best || !best.contained || distM < best.distM) best = cand;
    } else if (distM <= maxSnapM && (!best || (!best.contained && distM < best.distM))) {
      best = cand;
    }
  }
  return best;
}

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

/** Roof-plane cache keyed by `${lat},${lng},${radiusM}` — same TTL as obstructions. */
const roofPlanesCache = new Map<string, { result: NearmapRoofPlane[]; ts: number }>();

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

  // Cache per (lat,lng,radius) — the permit route fetches the aerial twice per
  // generate (initial + design re-center); don't charge two AI credits for it.
  const cacheKey = `${lat.toFixed(7)},${lng.toFixed(7)},${opts.radiusM ?? 40}`;
  const cached = roofPlanesCache.get(cacheKey);
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
    const planes = mapNearmapRoofPlanes(await res.json());
    roofPlanesCache.set(cacheKey, { result: planes, ts: Date.now() });
    return planes;
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
