// ============================================================================
// Durable cache for Nearmap AI Feature responses (DB-backed).
//
// The AI trial is metered (100 parcels). The in-memory cache in nearmap.ts does
// NOT survive Vercel's serverless cold starts, so every fresh planset generate
// would spend an AI parcel. This module persists the raw response per location
// (migration 102: nearmap_ai_cache) so a given property is fetched AT MOST ONCE,
// EVER — re-renders/iterations are free. Fail-safe: any DB error falls back to a
// live fetch (worst case = one parcel), never throws.
// ============================================================================

import { getDb } from '@/lib/db/core';
import { fetchNearmapAIRaw, mapNearmapSurfaces, type NearmapSurfaces } from '@/lib/aerial/nearmap';

const keyOf = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

async function readCache(lat: number, lng: number): Promise<any | null> {
  try {
    const sql = getDb();
    const rows = await sql`SELECT response FROM nearmap_ai_cache WHERE location_key = ${keyOf(lat, lng)} LIMIT 1` as Array<{ response: unknown }>;
    return rows?.[0]?.response ?? null;
  } catch (e) {
    console.warn('[nearmapCache] read skipped:', (e as Error)?.message);
    return null;
  }
}

async function writeCache(lat: number, lng: number, response: any): Promise<void> {
  try {
    const sql = getDb();
    const surveyDate = (response?.surveyDate ?? null) as string | null;
    await sql`
      INSERT INTO nearmap_ai_cache (location_key, lat, lng, survey_date, response)
      VALUES (${keyOf(lat, lng)}, ${lat}, ${lng}, ${surveyDate}, ${JSON.stringify(response)}::jsonb)
      ON CONFLICT (location_key) DO NOTHING`;
  } catch (e) {
    console.warn('[nearmapCache] write skipped:', (e as Error)?.message);
  }
}

/**
 * Ground surfaces (driveways / walks / paving / neighbor footprints) for the
 * PV-2 site plan, from Nearmap AI — DB-cached so a location costs at most one
 * AI parcel EVER. Returns null on no-key / no-coverage / error (site plan then
 * falls back to OSM/parcel-only, no fabrication).
 */
export async function getNearmapSurfacesCached(
  lat: number, lng: number, radiusM = 55,
): Promise<NearmapSurfaces | null> {
  const cached = await readCache(lat, lng);
  if (cached) {
    console.log('[nearmapCache] HIT', keyOf(lat, lng), '— 0 parcels');
    return mapNearmapSurfaces(cached);
  }
  const raw = await fetchNearmapAIRaw(lat, lng, radiusM);
  if (!raw || !Array.isArray(raw?.features)) return null;
  await writeCache(lat, lng, raw);
  console.log('[nearmapCache] MISS', keyOf(lat, lng), '→ fetched + stored (1 AI parcel)');
  return mapNearmapSurfaces(raw);
}
