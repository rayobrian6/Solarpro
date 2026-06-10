/**
 * Depth map cache — in-memory LRU cache for DepthMap artifacts.
 *
 * Caches DepthMap artifacts keyed by (fileId, modelVersion) to avoid
 * redundant MiDaS inference when the same photo is processed multiple
 * times (e.g., across pipeline runs, or when depth is needed for
 * multiple downstream consumers).
 *
 * Design decisions:
 * - LRU eviction: bounded memory, evicts least-recently-used entries
 * - Key: (fileId, modelVersion) — same photo with a different model
 *   version is a cache miss (the depth output may differ)
 * - TTL: optional time-to-live — stale entries are automatically evicted
 * - Thread-safe: all operations are synchronous (no async locks needed)
 * - Stats: cache hit/miss/eviction counts for monitoring
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { DepthMap } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DepthCacheKey {
  /** File ID of the source photo */
  fileId: string;
  /** Model version that produced this depth map (e.g., '2.0.0-depth-midas') */
  modelVersion: string;
}

export interface DepthCacheEntry {
  key: DepthCacheKey;
  depthMap: DepthMap;
  /** Whether MiDaS was used for this depth map */
  usedMidas: boolean;
  /** Timestamp when this entry was cached (ms since epoch) */
  cachedAt: number;
  /** Timestamp when this entry was last accessed (ms since epoch) */
  lastAccessedAt: number;
}

export interface DepthCacheStats {
  /** Current number of entries in the cache */
  size: number;
  /** Maximum number of entries allowed */
  maxSize: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Number of entries evicted due to LRU or TTL */
  evictions: number;
  /** Hit rate (hits / (hits + misses)) or 0 if no accesses */
  hitRate: number;
}

export interface DepthCacheOptions {
  /** Maximum number of entries (default: 100) */
  maxSize?: number;
  /** Time-to-live in milliseconds (default: 30 minutes = 1_800_000) */
  ttlMs?: number;
}

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SIZE = 100;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// DepthCache class
// ---------------------------------------------------------------------------

/**
 * In-memory LRU cache for DepthMap artifacts.
 *
 * Usage:
 *   const cache = new DepthCache({ maxSize: 50, ttlMs: 600_000 });
 *
 *   // Store
 *   cache.set({ fileId: 'photo-001', modelVersion: '2.0.0-depth-midas' }, depthMap, true);
 *
 *   // Retrieve
 *   const entry = cache.get({ fileId: 'photo-001', modelVersion: '2.0.0-depth-midas' });
 *   if (entry) {
 *     // Cache hit — no need to call MiDaS again
 *     return entry.depthMap;
 *   }
 *
 *   // Stats
 *   console.log(cache.getStats());
 */
export class DepthCache {
  private entries: Map<string, DepthCacheEntry>;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: DepthCacheOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.entries = new Map();
  }

  // -------------------------------------------------------------------------
  // Key management
  // -------------------------------------------------------------------------

  private makeKeyString(key: DepthCacheKey): string {
    return `${key.fileId}::${key.modelVersion}`;
  }

  // -------------------------------------------------------------------------
  // Core operations
  // -------------------------------------------------------------------------

  /**
   * Get a cached DepthMap entry.
   *
   * Returns null if:
   * - No entry exists for this key (cache miss)
   * - The entry has expired (TTL exceeded)
   *
   * On a hit, the entry's lastAccessedAt is updated (LRU ordering).
   */
  get(key: DepthCacheKey): DepthCacheEntry | null {
    const keyStr = this.makeKeyString(key);
    const entry = this.entries.get(keyStr);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    const now = Date.now();
    if (now - entry.cachedAt > this.ttlMs) {
      // Entry has expired
      this.entries.delete(keyStr);
      this.evictions++;
      this.misses++;
      return null;
    }

    // Cache hit — update access time and LRU position
    entry.lastAccessedAt = now;
    this.hits++;

    // Move to end of Map (most recently used) for LRU eviction
    this.entries.delete(keyStr);
    this.entries.set(keyStr, entry);

    return entry;
  }

  /**
   * Store a DepthMap in the cache.
   *
   * If the cache is at capacity, the least-recently-used entry is evicted.
   */
  set(key: DepthCacheKey, depthMap: DepthMap, usedMidas: boolean): void {
    const keyStr = this.makeKeyString(key);
    const now = Date.now();

    // If key already exists, remove it first (to update LRU position)
    if (this.entries.has(keyStr)) {
      this.entries.delete(keyStr);
    }

    // Evict LRU entries if at capacity
    while (this.entries.size >= this.maxSize) {
      // The first key in the Map is the least recently used
      const lruKey = this.entries.keys().next().value;
      if (lruKey !== undefined) {
        this.entries.delete(lruKey);
        this.evictions++;
      } else {
        break;
      }
    }

    const entry: DepthCacheEntry = {
      key,
      depthMap,
      usedMidas,
      cachedAt: now,
      lastAccessedAt: now,
    };

    this.entries.set(keyStr, entry);
  }

  /**
   * Check if a key exists in the cache without affecting LRU ordering or stats.
   * Also returns false if the entry exists but has expired.
   */
  has(key: DepthCacheKey): boolean {
    const keyStr = this.makeKeyString(key);
    const entry = this.entries.get(keyStr);
    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      return false; // expired (but don't evict — that's get()'s job)
    }

    return true;
  }

  /**
   * Remove a specific entry from the cache.
   * Returns true if the entry existed (and was removed), false otherwise.
   */
  delete(key: DepthCacheKey): boolean {
    const keyStr = this.makeKeyString(key);
    return this.entries.delete(keyStr);
  }

  // -------------------------------------------------------------------------
  // Bulk operations
  // -------------------------------------------------------------------------

  /**
   * Remove all entries from the cache.
   * Does not reset stats (hits/misses/evictions are cumulative).
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Remove all expired entries from the cache.
   * Returns the number of entries removed.
   */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;

    for (const [keyStr, entry] of this.entries) {
      if (now - entry.cachedAt > this.ttlMs) {
        this.entries.delete(keyStr);
        this.evictions++;
        purged++;
      }
    }

    return purged;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /**
   * Get cache statistics.
   */
  getStats(): DepthCacheStats {
    const totalAccesses = this.hits + this.misses;
    return {
      size: this.entries.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: totalAccesses > 0 ? this.hits / totalAccesses : 0,
    };
  }

  /**
   * Reset cumulative stats (hits, misses, evictions) without clearing the cache.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  // -------------------------------------------------------------------------
  // Current entries (for debugging/monitoring)
  // -------------------------------------------------------------------------

  /**
   * Get a snapshot of all current entries (ordered from LRU to MRU).
   * Do NOT modify these entries — they are references to the live cache.
   */
  entriesList(): readonly DepthCacheEntry[] {
    return Array.from(this.entries.values());
  }
}

// ---------------------------------------------------------------------------
// Singleton instance (optional convenience)
// ---------------------------------------------------------------------------

let _globalCache: DepthCache | null = null;

/**
 * Get the global depth cache singleton.
 *
 * This is a convenience for applications that want a shared cache instance.
 * For testing or multi-tenant scenarios, create separate DepthCache instances.
 *
 * The global cache uses defaults: maxSize=100, ttlMs=30min.
 */
export function getGlobalDepthCache(): DepthCache {
  if (!_globalCache) {
    _globalCache = new DepthCache();
  }
  return _globalCache;
}

/**
 * Reset the global depth cache singleton (useful for tests).
 */
export function resetGlobalDepthCache(): void {
  if (_globalCache) {
    _globalCache.clear();
    _globalCache.resetStats();
  }
  _globalCache = null;
}
