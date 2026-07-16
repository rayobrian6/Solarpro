// ============================================================================
// Durable cache for Nearmap AI Feature responses (DB-backed).
//
// The AI trial is metered (100 parcels ANNUAL) and one AI Features call bills
// EVERY parcel its AOI polygon intersects (a 55 m radius in a residential area
// can touch several parcels) — so a single uncached call can cost 5-10+
// parcels, not 1. One response contains roofs AND obstructions AND ground
// surfaces, so EVERY consumer (PV-2 site plan, sitePlan aerial overlay, Design
// Studio roof detect, admin lookup) must share THIS module's single durable
// copy (migration 102: nearmap_ai_cache). The in-memory caches in nearmap.ts
// do not survive serverless cold starts — they are NOT quota protection.
//
// FAIL-CLOSED (2026-07-12, after 81/100 parcels burned in 5 days): the
// original fail-open design ("any DB error → live fetch") meant a missing
// table / missing DATABASE_URL silently re-billed the SAME property on every
// generate. On a metered trial that is the wrong default. Now:
//   • cache unreadable (no DB / migration 102 not run) → NO live fetch; the
//     consumer falls back (OSM surfaces / manual geometry). Loud console.error.
//   • no-coverage/empty responses ARE cached (negative cache) — they no
//     longer retry on every generate.
//   • lookup is BY PROXIMITY (~60 m box), not exact key — aerial re-center /
//     array-centroid drift between generates can no longer mint fresh keys.
//   • ALL fetches use ONE radius (55 m) so a single cached response is a
//     superset for every consumer (roof detect used 40-45 m).
//   • NEARMAP_AI_CACHE_ONLY=1 freezes ALL live AI fetches (cache hits only).
// ============================================================================

import { getDb } from '@/lib/db/core';
import {
  fetchNearmapAIRaw,
  mapNearmapSurfaces,
  mapNearmapRoofPlanes,
  mapNearmapObstructions,
  filterCanopyToRoof,
  type NearmapSurfaces,
  type NearmapAIResult,
  type NearmapRoofPlane,
} from '@/lib/aerial/nearmap';

const keyOf = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/** Sentinel stored for no-coverage/empty responses so they never re-fetch. */
const EMPTY_SENTINEL = { features: [], _noCoverage: true } as const;

/** One AOI radius for every consumer — the cached response must be a superset
 *  for surfaces (55) AND roof detect (was 40-45). */
export const NEARMAP_AI_RADIUS_M = 55;

/** Proximity window for cache lookup — must stay well under the AOI radius
 *  so a nearby cached response still covers the requested point. */
const MATCH_BOX_M = 60;

interface CacheProbe {
  ok: boolean;              // cache layer usable (DB reachable, table exists)
  response: unknown | null; // matched cached response (may be the sentinel)
}

async function readCacheNear(lat: number, lng: number): Promise<CacheProbe> {
  try {
    const sql = getDb();
    const dLat = MATCH_BOX_M / 111_320;
    const dLng = MATCH_BOX_M / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    // Exact key first (fast path), then nearest within the box.
    const rows = await sql`
      SELECT response,
             ABS(lat - ${lat}) + ABS(lng - ${lng}) AS dist
      FROM nearmap_ai_cache
      WHERE (location_key = ${keyOf(lat, lng)})
         OR (lat BETWEEN ${lat - dLat} AND ${lat + dLat}
             AND lng BETWEEN ${lng - dLng} AND ${lng + dLng})
      ORDER BY dist ASC
      LIMIT 1` as Array<{ response: unknown }>;
    return { ok: true, response: rows?.[0]?.response ?? null };
  } catch (e) {
    console.error(
      '[nearmapCache] CACHE UNAVAILABLE — live Nearmap AI fetch BLOCKED (fail-closed). ' +
      'Run migration 102 (nearmap_ai_cache) / check DATABASE_URL. Cause:',
      (e as Error)?.message,
    );
    return { ok: false, response: null };
  }
}

async function writeCache(lat: number, lng: number, response: unknown): Promise<boolean> {
  try {
    const sql = getDb();
    const surveyDate = ((response as { surveyDate?: string | null })?.surveyDate ?? null);
    await sql`
      INSERT INTO nearmap_ai_cache (location_key, lat, lng, survey_date, response)
      VALUES (${keyOf(lat, lng)}, ${lat}, ${lng}, ${surveyDate}, ${JSON.stringify(response)}::jsonb)
      ON CONFLICT (location_key) DO NOTHING`;
    return true;
  } catch (e) {
    console.error('[nearmapCache] write FAILED (next generate would re-bill this parcel):', (e as Error)?.message);
    return false;
  }
}

/**
 * THE single gateway to the metered Nearmap AI Features API. Returns the raw
 * response JSON (durable-cached, at most one live fetch per property EVER) or
 * null (no key / no coverage / cache unavailable / cache-only mode).
 */
export async function getNearmapAIRawCached(lat: number, lng: number): Promise<unknown | null> {
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const probe = await readCacheNear(lat, lng);
  if (probe.response) {
    const r = probe.response as { _noCoverage?: boolean };
    if (r._noCoverage) {
      console.log('[nearmapCache] HIT (no-coverage sentinel)', keyOf(lat, lng), '— 0 parcels, no retry');
      return null;
    }
    console.log('[nearmapCache] HIT', keyOf(lat, lng), '— 0 parcels');
    return probe.response;
  }

  // FAIL-CLOSED: no readable cache ⇒ no metered fetch. A working cache is the
  // precondition for spending trial parcels.
  if (!probe.ok) return null;

  if (process.env.NEARMAP_AI_CACHE_ONLY === '1' || process.env.NEARMAP_AI_CACHE_ONLY === 'true') {
    console.log('[nearmapCache] MISS but NEARMAP_AI_CACHE_ONLY set — live fetch skipped (0 parcels)');
    return null;
  }

  const raw = await fetchNearmapAIRaw(lat, lng, NEARMAP_AI_RADIUS_M);
  if (!raw || !Array.isArray((raw as { features?: unknown[] })?.features)) {
    // Negative-cache the miss: a no-coverage/error area must not re-bill on
    // every subsequent generate. (A transient HTTP error costs one sentinel
    // row; delete it from nearmap_ai_cache to allow a retry.)
    await writeCache(lat, lng, EMPTY_SENTINEL);
    console.log('[nearmapCache] no coverage / empty response — sentinel stored, will not retry');
    return null;
  }
  const stored = await writeCache(lat, lng, raw);
  console.log(`[nearmapCache] MISS ${keyOf(lat, lng)} → fetched${stored ? ' + stored' : ' (STORE FAILED)'} (billed: every parcel in the ${NEARMAP_AI_RADIUS_M} m AOI)`);
  return raw;
}

/**
 * Ground surfaces (driveways / walks / paving / neighbor footprints) for the
 * PV-2 site plan. Returns null on no-key / no-coverage / cache-unavailable
 * (site plan then falls back to OSM/parcel-only, no fabrication).
 * radiusM is accepted for call-site compatibility but the fetch always uses
 * NEARMAP_AI_RADIUS_M (one shared cached response per property).
 */
export async function getNearmapSurfacesCached(
  lat: number, lng: number, _radiusM = NEARMAP_AI_RADIUS_M,
): Promise<NearmapSurfaces | null> {
  const raw = await getNearmapAIRawCached(lat, lng);
  return raw ? mapNearmapSurfaces(raw) : null;
}

/**
 * Roof planes + roof-overlapping canopy obstructions — the durable-cached
 * equivalent of nearmap.ts fetchNearmapAIResult (identical mapping incl. the
 * canopy roof-overlap filter). Empty result on any miss path.
 */
export async function getNearmapAIResultCached(lat: number, lng: number): Promise<NearmapAIResult> {
  const raw = await getNearmapAIRawCached(lat, lng);
  if (!raw) return { roofPlanes: [], obstructions: [] };
  const roofPlanes = mapNearmapRoofPlanes(raw);
  const obstructions = filterCanopyToRoof(mapNearmapObstructions(raw), roofPlanes);
  return { roofPlanes, obstructions };
}

/** Roof planes only — durable-cached equivalent of fetchNearmapRoofPlanes. */
export async function getNearmapRoofPlanesCached(lat: number, lng: number): Promise<NearmapRoofPlane[]> {
  const raw = await getNearmapAIRawCached(lat, lng);
  return raw ? mapNearmapRoofPlanes(raw) : [];
}
