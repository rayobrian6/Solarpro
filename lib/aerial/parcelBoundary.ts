// ============================================================
// Parcel (property-line) boundary fetch — county GIS registry.
//
// No free national parcel API exists, but ~2,000 of 3,100 US
// counties expose public ArcGIS REST parcel layers with a
// byte-identical query shape — only the base URL and the APN
// field name differ. This module keeps a registry keyed by
// state+county, seeded with counties as customers appear in
// them (each takes ~15-30 min to discover and verify). When a
// county isn't in the registry the sheet simply renders
// without property lines — fail-safe null, never a guess.
//
// Registry entry #1: Madison County, IL (CCAO Parcel_Owners) —
// verified live 2026-07-03: point-in-polygon query returns the
// parcel polygon + PIN in ~0.2 s, anonymous, no token.
//
// Paid national fallback when Ray wants it: Regrid (~159M
// parcels, point→polygon+APN, self-serve plans) — slot it in
// after the registry miss.
// ============================================================

export interface ParcelBoundary {
  /** Parcel ring, real lat/lng, decimated to ≤ MAX_RING_PTS */
  polygon: Array<{ lat: number; lng: number }>;
  /** Assessor parcel number, formatted for the title block */
  apn: string | null;
  acres: number | null;
  /** Data source name — printed nowhere, logged for provenance */
  source: string;
}

interface CountyService {
  state: string;                 // 2-letter
  county: RegExp;                // matches project.county (case-insensitive)
  serviceUrl: string;            // ArcGIS layer URL (no trailing /query)
  apnField: string;
  name: string;
}

const COUNTY_REGISTRY: CountyService[] = [
  {
    state: 'IL',
    county: /madison/i,
    serviceUrl: 'https://gisportal.co.madison.il.us/servera/rest/services/CCAO/Parcel_Owners/MapServer/0',
    apnField: 'PIN',
    name: 'Madison County IL CCAO',
  },
];

const MAX_RING_PTS = 160;   // county rings densify curves (Melvin: 399 verts)
const TIMEOUT_MS = 8000;

const parcelCache = new Map<string, { result: ParcelBoundary | null; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Fetch the parcel containing (lat, lng). Returns null (never throws) when
 * the county isn't registered, the service is down, or no parcel matches.
 */
export async function fetchParcelBoundary(
  lat: number,
  lng: number,
  county?: string | null,
  state?: string | null,
): Promise<ParcelBoundary | null> {
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) < 0.001) return null;
  const svc = COUNTY_REGISTRY.find(s =>
    (!state || s.state.toLowerCase() === String(state).trim().toLowerCase()) &&
    (!!county && s.county.test(String(county))));
  if (!svc) {
    console.log(`[parcel] no registry entry for ${county ?? '?'} county, ${state ?? '?'} — property lines omitted`);
    return null;
  }

  const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const cached = parcelCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.result;

  try {
    const url = `${svc.serviceUrl}/query?geometry=${lng},${lat}` +
      `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) { console.log(`[parcel] ${svc.name} HTTP ${res.status}`); return null; }
    const gj = await res.json() as any;
    const feat = gj?.features?.[0];
    const ringRaw: number[][] | undefined = feat?.geometry?.type === 'Polygon'
      ? feat.geometry.coordinates?.[0]
      : feat?.geometry?.type === 'MultiPolygon'
        ? feat.geometry.coordinates?.[0]?.[0]
        : undefined;
    if (!ringRaw || ringRaw.length < 4) { console.log(`[parcel] ${svc.name}: no parcel at point`); return null; }

    const step = Math.max(1, Math.ceil(ringRaw.length / MAX_RING_PTS));
    const polygon = ringRaw
      .filter((_, i) => i % step === 0)
      .map(pt => ({ lat: pt[1], lng: pt[0] }))
      .filter(v => isFinite(v.lat) && isFinite(v.lng));
    if (polygon.length < 4) return null;

    const props = feat.properties ?? {};
    const result: ParcelBoundary = {
      polygon,
      apn: typeof props[svc.apnField] === 'string' && props[svc.apnField].trim() ? props[svc.apnField].trim() : null,
      acres: isFinite(props.ACRES) ? Number(props.ACRES) : null,
      source: svc.name,
    };
    console.log(`[parcel] ${svc.name}: parcel found — APN ${result.apn ?? '—'}, ${result.acres ?? '?'} ac, ${polygon.length} pts`);
    parcelCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  } catch (e: unknown) {
    console.log(`[parcel] ${svc.name} fetch failed:`, (e as Error)?.message);
    return null;
  }
}
