/**
 * gridCache.ts — Grid result cache for panel layout solver
 *
 * Extracted from panelLayoutOptimized.ts (v47.98) into its own module
 * so the portrait-first solver (panelLayoutOptimized.ts v47.100) can
 * re-export it for backwards-compatibility with callers.
 */

import type { PlacedPanel } from '@/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GridCacheKey {
  polygonHash:  string;
  setback:      number;
  panelW:       number;
  panelH:       number;
  panelSpacing: number;
  rowSpacing:   number;
  azimuth:      number;
  orientation:  string;
}

interface GridCacheEntry {
  panels:    PlacedPanel[];
  timestamp: number;
}

// ─── Cache store ────────────────────────────────────────────────────────────

const gridCache    = new Map<string, GridCacheEntry>();
const GRID_CACHE_MAX    = 50;
const GRID_CACHE_TTL_MS = 60_000; // 1 minute TTL

// ─── Key builder ────────────────────────────────────────────────────────────

/**
 * Build a deterministic string cache key from layout parameters.
 * Azimuth is rounded to 1 degree to avoid float-drift cache misses.
 */
export function makeGridCacheKey(k: GridCacheKey): string {
  const azRounded = Math.round(k.azimuth);
  return [
    k.polygonHash,
    k.setback.toFixed(3),
    k.panelW.toFixed(4),
    k.panelH.toFixed(4),
    k.panelSpacing.toFixed(3),
    k.rowSpacing.toFixed(3),
    azRounded,
    k.orientation,
  ].join('|');
}

// ─── Polygon hash ───────────────────────────────────────────────────────────

/**
 * Fast 32-bit hash of a lat/lng polygon.
 * Precision: 5 decimal places (~1m) to absorb tiny float drift.
 */
export function hashPolygon(vertices: { lat: number; lng: number }[]): string {
  let h = vertices.length;
  for (const v of vertices) {
    h = (h * 31 + Math.round(v.lat * 100_000)) | 0;
    h = (h * 31 + Math.round(v.lng * 100_000)) | 0;
  }
  return h.toString(36);
}

// ─── Cache accessors ────────────────────────────────────────────────────────

export function getCachedGrid(key: string): PlacedPanel[] | null {
  const entry = gridCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > GRID_CACHE_TTL_MS) {
    gridCache.delete(key);
    return null;
  }
  return entry.panels;
}

export function setCachedGrid(key: string, panels: PlacedPanel[]): void {
  if (gridCache.size >= GRID_CACHE_MAX) {
    // Evict oldest entry (Map preserves insertion order)
    const firstKey = gridCache.keys().next().value;
    if (firstKey !== undefined) gridCache.delete(firstKey);
  }
  gridCache.set(key, { panels, timestamp: Date.now() });
}

// ─── Management ─────────────────────────────────────────────────────────────

export function clearGridCache(): void {
  gridCache.clear();
}

export function getGridCacheStats(): { size: number; maxSize: number } {
  return { size: gridCache.size, maxSize: GRID_CACHE_MAX };
}