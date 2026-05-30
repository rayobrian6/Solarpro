// ============================================================================
// lib/siteSurveys/googleSolarApi/cache.ts
//
// Server-side lightweight cache for Google Solar API buildingInsights data.
//
// PROBLEM: Both Pipeline C (/api/site-surveys/[surveyId]/google-solar-api)
// and the 3D design pipeline (/api/solar) call the same Google Solar API
// buildingInsights endpoint for the same building. At $0.015/call, duplicate
// calls waste money.
//
// SOLUTION: This module provides a process-level in-memory cache keyed by
// normalized lat/lng. When any route fetches buildingInsights data, it writes
// to this cache. When another route needs data for the same location, it can
// read from the cache instead of making another API call.
//
// ISOLATION NOTE: This cache does NOT violate pipeline isolation. Both
// pipelines make their own independent API calls and write to their own DB
// tables. The cache is merely an optimization layer that avoids duplicate
// network requests to Google's API. It does NOT share request objects,
// response objects, or DB writes between pipelines. Each pipeline still
// processes and adapts the data independently.
//
// CACHE SEMANTICS:
//   - TTL: 24 hours (roof geometry doesn't change frequently)
//   - Key: normalized lat/lng (rounded to 5 decimal places ≈ 1m resolution)
//   - Max entries: 500 (prevents memory bloat)
//   - Thread-safe: uses a Map with no async operations on the map itself
//   - Eviction: lazy TTL-based eviction on read + periodic sweep
//
// API pricing: $0.015 per buildingInsights call SAVED by cache hits.
// ============================================================================

import type { BuildingInsightsResponse } from './types';

// ─── Configuration ─────────────────────────────────────────────────────────

/** Cache TTL in milliseconds. 24 hours — roof geometry changes slowly. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum number of cache entries. Prevents unbounded memory growth. */
const MAX_CACHE_ENTRIES = 500;

/** Precision for lat/lng key normalization. 5 decimal places ≈ 1.1m. */
const LAT_LNG_PRECISION = 5;

// ─── Types ──────────────────────────────────────────────────────────────────

interface CacheEntry {
  /** The cached buildingInsights response. */
  data: BuildingInsightsResponse;

  /** Timestamp when this entry was cached (epoch ms). */
  cachedAt: number;

  /** Timestamp when this entry expires (epoch ms). */
  expiresAt: number;

  /** Number of times this entry has been read (for monitoring). */
  hitCount: number;

  /** Source that populated this cache entry (for logging). */
  source: '3d_design_pipeline' | 'pipeline_c' | 'pre_fetched' | 'unknown';
}

export interface CacheStats {
  /** Total entries currently in the cache. */
  totalEntries: number;

  /** Number of entries that have been used at least once. */
  entriesWithHits: number;

  /** Total hit count across all entries. */
  totalHits: number;

  /** Estimated memory usage in bytes (rough approximation). */
  estimatedMemoryBytes: number;
}

export interface CacheLookupResult {
  /** Whether a valid cache entry was found. */
  hit: boolean;

  /** The cached buildingInsights data, if hit. */
  data: BuildingInsightsResponse | null;

  /** Age of the cache entry in milliseconds, if hit. */
  ageMs: number | null;

  /** Source that originally populated this entry, if hit. */
  source: CacheEntry['source'] | null;
}

// ─── Cache Storage ──────────────────────────────────────────────────────────

/**
 * Process-level in-memory cache.
 *
 * In a serverless environment (Vercel, Cloudflare Workers), this cache is
 * per-cold-start. That's fine — even a short-lived cache saves API calls
 * within a single request chain (e.g., a user loads the 3D design page,
 * then navigates to the survey page within the same cold start).
 *
 * In a long-running Node.js server, this cache persists across requests
 * and provides maximum savings.
 */
const cache = new Map<string, CacheEntry>();

// ─── Key Generation ─────────────────────────────────────────────────────────

/**
 * Generate a cache key from lat/lng coordinates.
 *
 * We normalize to 5 decimal places (~1.1m resolution) so that slightly
 * different coordinates for the same building still hit the same cache key.
 * The Google Solar API's findClosest endpoint already finds the nearest
 * building within a radius, so small coordinate differences don't matter.
 */
function makeCacheKey(latitude: number, longitude: number): string {
  const normalizedLat = latitude.toFixed(LAT_LNG_PRECISION);
  const normalizedLng = longitude.toFixed(LAT_LNG_PRECISION);
  return `bi:${normalizedLat},${normalizedLng}`;
}

// ─── Lazy Eviction ──────────────────────────────────────────────────────────

/**
 * Remove expired entries and enforce the max entry limit.
 *
 * This is called lazily on read operations to keep the cache healthy.
 * It's also called periodically (see sweepExpiredEntries).
 */
function evict(): void {
  const now = Date.now();

  // Remove all expired entries
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }

  // If still over the limit, remove the oldest entries
  if (cache.size > MAX_CACHE_ENTRIES) {
    // Sort by cachedAt ascending (oldest first)
    const entries = [...cache.entries()].sort(
      (a, b) => a[1].cachedAt - b[1].cachedAt,
    );
    const excess = cache.size - MAX_CACHE_ENTRIES;
    for (let i = 0; i < excess; i++) {
      cache.delete(entries[i][0]);
    }
  }
}

/**
 * Periodic sweep: remove all expired entries.
 * Call this from a timer or on idle to keep the cache lean.
 * Not strictly necessary since evict() runs on every read, but
 * good hygiene for long-running servers.
 */
export function sweepExpiredEntries(): number {
  const now = Date.now();
  let swept = 0;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
      swept++;
    }
  }
  if (swept > 0) {
    console.info(
      `[Pipeline C Cache] Swept ${swept} expired entries. ${cache.size} remaining.`,
    );
  }
  return swept;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Look up buildingInsights data in the cache.
 *
 * @param latitude  - Latitude of the building location
 * @param longitude - Longitude of the building location
 * @returns CacheLookupResult indicating whether a valid entry was found
 */
export function getCachedBuildingInsights(
  latitude: number,
  longitude: number,
): CacheLookupResult {
  evict(); // Lazy eviction on read

  const key = makeCacheKey(latitude, longitude);
  const entry = cache.get(key);

  if (!entry) {
    return { hit: false, data: null, ageMs: null, source: null };
  }

  // Check TTL (shouldn't be needed after evict(), but double-check)
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return { hit: false, data: null, ageMs: null, source: null };
  }

  // Cache hit!
  entry.hitCount++;
  const ageMs = Date.now() - entry.cachedAt;

  console.info(
    `[Pipeline C Cache] HIT for key=${key} age=${(ageMs / 1000).toFixed(0)}s hits=${entry.hitCount} source=${entry.source}`,
  );

  return {
    hit: true,
    data: entry.data,
    ageMs,
    source: entry.source,
  };
}

/**
 * Store buildingInsights data in the cache.
 *
 * @param latitude  - Latitude of the building location
 * @param longitude - Longitude of the building location
 * @param data      - The buildingInsights response to cache
 * @param source    - Which pipeline/component populated this cache entry
 */
export function setCachedBuildingInsights(
  latitude: number,
  longitude: number,
  data: BuildingInsightsResponse,
  source: CacheEntry['source'] = 'unknown',
): void {
  const now = Date.now();
  const key = makeCacheKey(latitude, longitude);

  // Don't cache empty/invalid responses
  if (!data || (!data.roofPlanes && !data.boundingBox && !data.center)) {
    console.warn(
      `[Pipeline C Cache] Skipping cache SET for key=${key} — response has no useful data`,
    );
    return;
  }

  const entry: CacheEntry = {
    data,
    cachedAt: now,
    expiresAt: now + CACHE_TTL_MS,
    hitCount: 0,
    source,
  };

  cache.set(key, entry);

  console.info(
    `[Pipeline C Cache] SET for key=${key} source=${source} ttl=${CACHE_TTL_MS / 1000 / 60 / 60}h`,
  );

  // Evict if we're over the limit
  if (cache.size > MAX_CACHE_ENTRIES) {
    evict();
  }
}

/**
 * Validate that a given object looks like a valid BuildingInsightsResponse.
 *
 * Used when accepting pre-fetched data from the request body to ensure
 * the data has the minimum required fields for Pipeline C processing.
 */
export function isValidBuildingInsightsData(
  data: unknown,
): data is BuildingInsightsResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  // Must have at least a boundingBox or roofPlanes
  const hasBbox = obj.boundingBox && typeof obj.boundingBox === 'object';
  const hasPlanes = Array.isArray(obj.roofPlanes);

  return hasBbox || hasPlanes;
}

/**
 * Get cache statistics for monitoring.
 */
export function getCacheStats(): CacheStats {
  let totalHits = 0;
  let entriesWithHits = 0;
  let estimatedMemoryBytes = 0;

  for (const entry of cache.values()) {
    totalHits += entry.hitCount;
    if (entry.hitCount > 0) entriesWithHits++;
    // Rough estimate: ~1KB per roof plane, ~500B overhead
    const planeCount = entry.data.roofPlanes?.length ?? 0;
    estimatedMemoryBytes += planeCount * 1024 + 512;
  }

  return {
    totalEntries: cache.size,
    entriesWithHits,
    totalHits,
    estimatedMemoryBytes,
  };
}

/**
 * Clear the entire cache. Useful for testing.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Remove a specific cache entry. Useful for testing.
 */
export function deleteCachedBuildingInsights(
  latitude: number,
  longitude: number,
): boolean {
  const key = makeCacheKey(latitude, longitude);
  return cache.delete(key);
}
