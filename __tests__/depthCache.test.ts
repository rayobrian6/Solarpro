/**
 * Depth cache tests.
 *
 * Tests the DepthCache LRU cache for DepthMap artifacts.
 *
 * @jest-environment node
 */

import {
  DepthCache,
  getGlobalDepthCache,
  resetGlobalDepthCache,
} from '@/lib/siteSurveys/geometryReconstruction/workers/depth';
import type { DepthCacheKey, DepthCacheStats } from '@/lib/siteSurveys/geometryReconstruction/workers/depth';
import type { DepthMap } from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
} from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeFloat32ToBase64(arr: Float32Array): string {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  return buf.toString('base64');
}

function makeDepthMap(
  width: number,
  height: number,
  grid: Float32Array,
  overrides?: Partial<DepthMap>,
): DepthMap {
  return {
    artifactType: 'depth_map',
    fileId: 'test-file-001',
    width,
    height,
    depthData: encodeFloat32ToBase64(grid),
    depthMetric: 'normalized_relative',
    confidence: 0.75,
    authority: REVIEW_ONLY_AUTHORITY,
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeKey(fileId: string, modelVersion: string): DepthCacheKey {
  return { fileId, modelVersion };
}

function makeGrid(value: number): Float32Array {
  const grid = new Float32Array(8 * 8);
  grid.fill(value);
  return grid;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DepthCache', () => {
  afterEach(() => {
    resetGlobalDepthCache();
  });

  // -----------------------------------------------------------------------
  // Basic CRUD
  // -----------------------------------------------------------------------
  describe('basic CRUD', () => {
    it('stores and retrieves a DepthMap', () => {
      const cache = new DepthCache({ maxSize: 10 });
      const key = makeKey('photo-001', '2.0.0-depth-midas');
      const depthMap = makeDepthMap(8, 8, makeGrid(0.5));

      cache.set(key, depthMap, true);
      const entry = cache.get(key);

      expect(entry).not.toBeNull();
      expect(entry!.depthMap).toBe(depthMap);
      expect(entry!.usedMidas).toBe(true);
      expect(entry!.key.fileId).toBe('photo-001');
      expect(entry!.key.modelVersion).toBe('2.0.0-depth-midas');
    });

    it('returns null for a missing key', () => {
      const cache = new DepthCache();
      const entry = cache.get(makeKey('nonexistent', '1.0.0'));

      expect(entry).toBeNull();
    });

    it('differentiates keys by fileId', () => {
      const cache = new DepthCache();
      const dm1 = makeDepthMap(8, 8, makeGrid(0.3), { fileId: 'photo-001' });
      const dm2 = makeDepthMap(8, 8, makeGrid(0.7), { fileId: 'photo-002' });

      cache.set(makeKey('photo-001', 'v1'), dm1, true);
      cache.set(makeKey('photo-002', 'v1'), dm2, false);

      expect(cache.get(makeKey('photo-001', 'v1'))!.depthMap).toBe(dm1);
      expect(cache.get(makeKey('photo-002', 'v1'))!.depthMap).toBe(dm2);
    });

    it('differentiates keys by modelVersion', () => {
      const cache = new DepthCache();
      const dm1 = makeDepthMap(8, 8, makeGrid(0.3));
      const dm2 = makeDepthMap(8, 8, makeGrid(0.7));

      cache.set(makeKey('photo-001', 'v1'), dm1, false);
      cache.set(makeKey('photo-001', 'v2'), dm2, true);

      expect(cache.get(makeKey('photo-001', 'v1'))!.depthMap).toBe(dm1);
      expect(cache.get(makeKey('photo-001', 'v2'))!.depthMap).toBe(dm2);
    });

    it('updates an existing entry on set', () => {
      const cache = new DepthCache();
      const key = makeKey('photo-001', 'v1');
      const dm1 = makeDepthMap(8, 8, makeGrid(0.3));
      const dm2 = makeDepthMap(8, 8, makeGrid(0.7));

      cache.set(key, dm1, false);
      cache.set(key, dm2, true);

      const entry = cache.get(key);
      expect(entry!.depthMap).toBe(dm2);
      expect(entry!.usedMidas).toBe(true);
    });

    it('deletes an entry', () => {
      const cache = new DepthCache();
      const key = makeKey('photo-001', 'v1');
      cache.set(key, makeDepthMap(8, 8, makeGrid(0.5)), true);

      expect(cache.delete(key)).toBe(true);
      expect(cache.get(key)).toBeNull();
    });

    it('delete returns false for nonexistent key', () => {
      const cache = new DepthCache();
      expect(cache.delete(makeKey('nonexistent', 'v1'))).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // has() — non-impacting check
  // -----------------------------------------------------------------------
  describe('has()', () => {
    it('returns true for a cached key', () => {
      const cache = new DepthCache();
      const key = makeKey('photo-001', 'v1');
      cache.set(key, makeDepthMap(8, 8, makeGrid(0.5)), true);

      expect(cache.has(key)).toBe(true);
    });

    it('returns false for a missing key', () => {
      const cache = new DepthCache();
      expect(cache.has(makeKey('nonexistent', 'v1'))).toBe(false);
    });

    it('does not affect LRU ordering or stats', () => {
      const cache = new DepthCache({ maxSize: 2 });
      const key1 = makeKey('photo-001', 'v1');
      const key2 = makeKey('photo-002', 'v1');

      cache.set(key1, makeDepthMap(8, 8, makeGrid(0.1)), true);
      cache.set(key2, makeDepthMap(8, 8, makeGrid(0.2)), true);

      // has() should not update LRU position
      cache.has(key1);

      // Adding a third entry should evict key1 (LRU) NOT key2
      const key3 = makeKey('photo-003', 'v1');
      cache.set(key3, makeDepthMap(8, 8, makeGrid(0.3)), true);

      // key1 should be evicted, key2 should remain
      // But has() touched key1 for the check... no, has() doesn't update LRU
      // The LRU order is: key1 (oldest), key2 (newer)
      // Adding key3 evicts key1
      expect(cache.get(key1)).toBeNull();  // evicted
      expect(cache.get(key2)).not.toBeNull(); // still there
    });
  });

  // -----------------------------------------------------------------------
  // LRU eviction
  // -----------------------------------------------------------------------
  describe('LRU eviction', () => {
    it('evicts the least recently used entry when at capacity', () => {
      const cache = new DepthCache({ maxSize: 2 });
      const key1 = makeKey('photo-001', 'v1');
      const key2 = makeKey('photo-002', 'v1');
      const key3 = makeKey('photo-003', 'v1');

      cache.set(key1, makeDepthMap(8, 8, makeGrid(0.1)), true);
      cache.set(key2, makeDepthMap(8, 8, makeGrid(0.2)), true);

      // Cache is now at capacity (2)
      // Adding key3 should evict key1 (least recently used)
      cache.set(key3, makeDepthMap(8, 8, makeGrid(0.3)), true);

      expect(cache.get(key1)).toBeNull();  // evicted
      expect(cache.get(key2)).not.toBeNull();
      expect(cache.get(key3)).not.toBeNull();
    });

    it('get() updates LRU position', () => {
      const cache = new DepthCache({ maxSize: 2 });
      const key1 = makeKey('photo-001', 'v1');
      const key2 = makeKey('photo-002', 'v1');

      cache.set(key1, makeDepthMap(8, 8, makeGrid(0.1)), true);
      cache.set(key2, makeDepthMap(8, 8, makeGrid(0.2)), true);

      // Access key1 — it becomes most recently used
      cache.get(key1);

      // Adding key3 should now evict key2 (LRU), not key1
      const key3 = makeKey('photo-003', 'v1');
      cache.set(key3, makeDepthMap(8, 8, makeGrid(0.3)), true);

      expect(cache.get(key1)).not.toBeNull(); // still there (was accessed)
      expect(cache.get(key2)).toBeNull();     // evicted
      expect(cache.get(key3)).not.toBeNull();
    });

    it('set() on existing key updates LRU position', () => {
      const cache = new DepthCache({ maxSize: 2 });
      const key1 = makeKey('photo-001', 'v1');
      const key2 = makeKey('photo-002', 'v1');

      cache.set(key1, makeDepthMap(8, 8, makeGrid(0.1)), true);
      cache.set(key2, makeDepthMap(8, 8, makeGrid(0.2)), true);

      // Update key1 — it moves to most recently used
      cache.set(key1, makeDepthMap(8, 8, makeGrid(0.15)), true);

      // Adding key3 should evict key2 (LRU)
      const key3 = makeKey('photo-003', 'v1');
      cache.set(key3, makeDepthMap(8, 8, makeGrid(0.3)), true);

      expect(cache.get(key1)).not.toBeNull();
      expect(cache.get(key2)).toBeNull();
    });

    it('tracks eviction count', () => {
      const cache = new DepthCache({ maxSize: 2 });
      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.1)), true);
      cache.set(makeKey('p2', 'v1'), makeDepthMap(8, 8, makeGrid(0.2)), true);
      cache.set(makeKey('p3', 'v1'), makeDepthMap(8, 8, makeGrid(0.3)), true);

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // TTL expiration
  // -----------------------------------------------------------------------
  describe('TTL expiration', () => {
    it('expires entries after TTL', () => {
      // Use a very short TTL for testing
      const cache = new DepthCache({ maxSize: 10, ttlMs: 50 });
      const key = makeKey('photo-001', 'v1');

      cache.set(key, makeDepthMap(8, 8, makeGrid(0.5)), true);

      // Should be available immediately
      expect(cache.get(key)).not.toBeNull();

      // Wait for TTL to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(cache.get(key)).toBeNull();
          resolve();
        }, 80);
      });
    });

    it('has() returns false for expired entries', () => {
      const cache = new DepthCache({ maxSize: 10, ttlMs: 50 });
      const key = makeKey('photo-001', 'v1');

      cache.set(key, makeDepthMap(8, 8, makeGrid(0.5)), true);
      expect(cache.has(key)).toBe(true);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(cache.has(key)).toBe(false);
          resolve();
        }, 80);
      });
    });

    it('get() counts expired entries as misses', () => {
      const cache = new DepthCache({ maxSize: 10, ttlMs: 50 });
      const key = makeKey('photo-001', 'v1');

      cache.set(key, makeDepthMap(8, 8, makeGrid(0.5)), true);
      cache.get(key); // hit

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          cache.get(key); // expired → miss
          const stats = cache.getStats();
          expect(stats.hits).toBe(1);
          expect(stats.misses).toBe(1);
          resolve();
        }, 80);
      });
    });
  });

  // -----------------------------------------------------------------------
  // purgeExpired
  // -----------------------------------------------------------------------
  describe('purgeExpired', () => {
    it('removes expired entries', () => {
      const cache = new DepthCache({ maxSize: 10, ttlMs: 50 });

      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.1)), true);
      cache.set(makeKey('p2', 'v1'), makeDepthMap(8, 8, makeGrid(0.2)), true);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const purged = cache.purgeExpired();
          expect(purged).toBe(2);
          expect(cache.getStats().size).toBe(0);
          resolve();
        }, 80);
      });
    });

    it('does not remove non-expired entries', () => {
      const cache = new DepthCache({ maxSize: 10, ttlMs: 60000 });
      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.1)), true);

      const purged = cache.purgeExpired();
      expect(purged).toBe(0);
      expect(cache.getStats().size).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------
  describe('stats', () => {
    it('tracks hits and misses', () => {
      const cache = new DepthCache();
      const key = makeKey('photo-001', 'v1');

      cache.set(key, makeDepthMap(8, 8, makeGrid(0.5)), true);

      cache.get(key);  // hit
      cache.get(key);  // hit
      cache.get(makeKey('nonexistent', 'v1')); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('computes hitRate', () => {
      const cache = new DepthCache();
      const key = makeKey('photo-001', 'v1');

      cache.set(key, makeDepthMap(8, 8, makeGrid(0.5)), true);

      cache.get(key);  // hit
      cache.get(key);  // hit
      cache.get(makeKey('nonexistent', 'v1')); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
    });

    it('hitRate is 0 when no accesses', () => {
      const cache = new DepthCache();
      expect(cache.getStats().hitRate).toBe(0);
    });

    it('resetStats clears counters but not the cache', () => {
      const cache = new DepthCache();
      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.5)), true);
      cache.get(makeKey('p1', 'v1'));  // hit
      cache.get(makeKey('p2', 'v1'));  // miss

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.size).toBe(1); // cache still has the entry
    });

    it('reports correct size', () => {
      const cache = new DepthCache({ maxSize: 10 });

      expect(cache.getStats().size).toBe(0);

      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.1)), true);
      expect(cache.getStats().size).toBe(1);

      cache.set(makeKey('p2', 'v1'), makeDepthMap(8, 8, makeGrid(0.2)), true);
      expect(cache.getStats().size).toBe(2);
    });

    it('reports maxSize', () => {
      const cache = new DepthCache({ maxSize: 42 });
      expect(cache.getStats().maxSize).toBe(42);
    });
  });

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------
  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new DepthCache();
      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.1)), true);
      cache.set(makeKey('p2', 'v1'), makeDepthMap(8, 8, makeGrid(0.2)), true);

      cache.clear();

      expect(cache.getStats().size).toBe(0);
      expect(cache.get(makeKey('p1', 'v1'))).toBeNull();
    });

    it('does not reset stats', () => {
      const cache = new DepthCache();
      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.1)), true);
      cache.get(makeKey('p1', 'v1'));  // hit

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(1); // stats NOT reset
      expect(stats.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // entriesList
  // -----------------------------------------------------------------------
  describe('entriesList', () => {
    it('returns all entries in LRU→MRU order', () => {
      const cache = new DepthCache({ maxSize: 5 });
      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.1)), true);
      cache.set(makeKey('p2', 'v1'), makeDepthMap(8, 8, makeGrid(0.2)), true);
      cache.set(makeKey('p3', 'v1'), makeDepthMap(8, 8, makeGrid(0.3)), true);

      const entries = cache.entriesList();
      expect(entries.length).toBe(3);
      // Order should be LRU→MRU: p1, p2, p3
      expect(entries[0].key.fileId).toBe('p1');
      expect(entries[1].key.fileId).toBe('p2');
      expect(entries[2].key.fileId).toBe('p3');
    });
  });

  // -----------------------------------------------------------------------
  // Global singleton
  // -----------------------------------------------------------------------
  describe('global singleton', () => {
    it('getGlobalDepthCache returns the same instance', () => {
      const cache1 = getGlobalDepthCache();
      const cache2 = getGlobalDepthCache();
      expect(cache1).toBe(cache2);
    });

    it('resetGlobalDepthCache clears and nullifies the singleton', () => {
      const cache1 = getGlobalDepthCache();
      cache1.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.5)), true);

      resetGlobalDepthCache();

      const cache2 = getGlobalDepthCache();
      expect(cache2).not.toBe(cache1); // new instance
      expect(cache2.getStats().size).toBe(0);
    });

    it('global cache works like a regular cache', () => {
      const cache = getGlobalDepthCache();
      const key = makeKey('global-test', 'v1');

      cache.set(key, makeDepthMap(8, 8, makeGrid(0.5)), true);
      const entry = cache.get(key);

      expect(entry).not.toBeNull();
      expect(entry!.usedMidas).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Entry metadata
  // -----------------------------------------------------------------------
  describe('entry metadata', () => {
    it('sets cachedAt and lastAccessedAt on creation', () => {
      const cache = new DepthCache();
      const before = Date.now();
      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.5)), true);
      const after = Date.now();

      const entry = cache.get(makeKey('p1', 'v1'))!;
      expect(entry.cachedAt).toBeGreaterThanOrEqual(before);
      expect(entry.cachedAt).toBeLessThanOrEqual(after);
      expect(entry.lastAccessedAt).toBeGreaterThanOrEqual(before);
    });

    it('updates lastAccessedAt on get', () => {
      const cache = new DepthCache();
      cache.set(makeKey('p1', 'v1'), makeDepthMap(8, 8, makeGrid(0.5)), true);

      const entry1 = cache.get(makeKey('p1', 'v1'))!;
      const accessedAt1 = entry1.lastAccessedAt;

      // Small delay
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const entry2 = cache.get(makeKey('p1', 'v1'))!;
          expect(entry2.lastAccessedAt).toBeGreaterThan(accessedAt1);
          resolve();
        }, 20);
      });
    });
  });
});
