// ============================================================
// Site features (real roads + building footprints) — OpenStreetMap.
//
// The permit site plan must show the REALITY around the home: the
// actual road (correct position + name, not a guess off the geocode
// pin) and the surrounding building footprints (critical for
// apartment complexes, where one parcel holds many buildings — e.g.
// Braidon's 3.12-ac / ~13-building lot on Melvin Dr).
//
// Source: OpenStreetMap via Overpass API — free, global, ODbL
// (attribution). Roads come from way["highway"]["name"]; buildings
// from way["building"]. Fail-safe null on any error/timeout, never a
// guess — same contract as parcelBoundary.ts. This runs in the async
// permit route (generatePermitHTML is sync) and rides in on aerialData.
//
// Coverage caveat: OSM building coverage is good in cities, spotty
// rural. Microsoft Building Footprints (better US coverage, no point
// API — per-state GeoJSON) is the future upgrade; the shape here
// (list of lat/lng rings) is provider-independent.
// ============================================================

export interface SiteRoad {
  name: string | null;
  klass: string;                 // OSM highway= value (residential, service, …)
  points: Array<{ lat: number; lng: number }>;
}
export interface SiteBuildingFootprint {
  points: Array<{ lat: number; lng: number }>;
}
export interface SiteFeatures {
  roads: SiteRoad[];
  buildings: SiteBuildingFootprint[];
  source: string;
}

// Multiple public mirrors — the main instance rate-limits/blocks datacenter IPs
// (e.g. Vercel) that a residential dev IP sails through, so we fall through the
// list. If ALL fail in production the sheet still renders (parcel + roof only).
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];
const TIMEOUT_MS = 12000;
const MAX_RING_PTS = 80;
const MAX_BUILDINGS = 80;
const MAX_ROADS = 40;

const cache = new Map<string, { result: SiteFeatures | null; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function decimate<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % step === 0);
}

/**
 * Fetch real roads + building footprints within `radiusM` of (lat, lng).
 * Returns null (never throws) on any failure — the sheet then renders the
 * property line without the surrounding context rather than a fabrication.
 */
export async function fetchSiteFeatures(
  lat: number,
  lng: number,
  radiusM = 150,
): Promise<SiteFeatures | null> {
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) < 0.001) return null;

  const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)},${radiusM}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.result;

  const q = `[out:json][timeout:20];(` +
    `way["building"](around:${radiusM},${lat},${lng});` +
    `way["highway"]["name"](around:${radiusM},${lat},${lng});` +
    `);out geom;`;

  for (const base of OVERPASS_URLS) {
    try {
      // GET with the query as ?data= — Overpass returns 406 for the form-POST
      // shape from some clients; GET + explicit Accept is the reliable path.
      const res = await fetch(`${base}?data=${encodeURIComponent(q)}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'SolarPro-Planset/1.0 (permit site plan)' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) { console.log(`[siteFeatures] Overpass HTTP ${res.status} @ ${base}`); continue; }
      const data = await res.json() as { elements?: Array<Record<string, unknown>> };
      const els = (data.elements ?? []).filter(e => e.type === 'way' && Array.isArray(e.geometry));

      const roads: SiteRoad[] = [];
      const buildings: SiteBuildingFootprint[] = [];
      for (const e of els) {
        const geom = (e.geometry as Array<{ lat: number; lon: number }>)
          .filter(p => isFinite(p?.lat) && isFinite(p?.lon))
          .map(p => ({ lat: p.lat, lng: p.lon }));
        if (geom.length < 2) continue;
        const tags = (e.tags ?? {}) as Record<string, string>;
        if (tags.building) {
          if (buildings.length < MAX_BUILDINGS) buildings.push({ points: decimate(geom, MAX_RING_PTS) });
        } else if (tags.highway) {
          if (roads.length < MAX_ROADS) roads.push({
            name: tags.name ?? null,
            klass: tags.highway,
            points: decimate(geom, MAX_RING_PTS),
          });
        }
      }
      if (!roads.length && !buildings.length) {
        console.log('[siteFeatures] OSM returned nothing near point');
        cache.set(cacheKey, { result: null, ts: Date.now() });
        return null;
      }
      const result: SiteFeatures = { roads, buildings, source: 'OpenStreetMap' };
      console.log(`[siteFeatures] OSM: ${roads.length} roads, ${buildings.length} buildings`);
      cache.set(cacheKey, { result, ts: Date.now() });
      return result;
    } catch (e: unknown) {
      console.log(`[siteFeatures] Overpass fetch failed @ ${base}:`, (e as Error)?.message);
    }
  }
  cache.set(cacheKey, { result: null, ts: Date.now() });
  return null;
}
