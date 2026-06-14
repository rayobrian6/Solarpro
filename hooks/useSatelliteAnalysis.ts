'use client';

// ============================================================================
// v47.438 - useSatelliteAnalysis hook
//
// Client-side hook that calls the satellite analysis API when
// lat/lng are available and returns detection results for wiring
// into survey steps.
//
// Usage:
//   const { result, loading, error, refetch } = useSatelliteAnalysis({
//     latitude: siteOverview.latitude,
//     longitude: siteOverview.longitude,
//     structureType: siteOverview.structureType,
//     enabled: true,
//   });
//
// DESIGN:
//   - Calls /api/satellite/analyze on mount when lat/lng are present
//   - Debounces rapid coordinate changes (e.g. address geocoding)
//   - Caches results per lat/lng to avoid redundant API calls
//   - Returns results compatible with ComputedField + ConfidenceBadge
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SatelliteAnalysisResult } from '@/lib/satellite/types';

interface UseSatelliteAnalysisInput {
  latitude: number | null;
  longitude: number | null;
  address?: string;
  structureType?: string;
  /** Only call the API when enabled (e.g. when survey step is visible) */
  enabled?: boolean;
  /** Debounce coordinate changes (default: 1500ms) */
  debounceMs?: number;
}

interface UseSatelliteAnalysisOutput {
  /** Analysis result (null while loading or if coordinates missing) */
  result: SatelliteAnalysisResult | null;
  /** Whether the API call is in progress */
  loading: boolean;
  /** Error message if the API call failed */
  error: string | null;
  /** Manually re-trigger the analysis */
  refetch: () => void;
  /** Whether the hook has attempted a fetch (even if it failed) */
  attempted: boolean;
}

// Simple in-memory cache for satellite results (prevents redundant calls)
const satelliteCache = new Map<string, { result: SatelliteAnalysisResult; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(lat: number, lng: number): string {
  // Round to ~11m precision (4 decimal places) for cache hits
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export function useSatelliteAnalysis({
  latitude,
  longitude,
  address,
  structureType,
  enabled = true,
  debounceMs = 1500,
}: UseSatelliteAnalysisInput): UseSatelliteAnalysisOutput {
  const [result, setResult] = useState<SatelliteAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0); // Stale request guard

  const fetchAnalysis = useCallback(async () => {
    if (latitude == null || longitude == null || !enabled) return;

    // Check cache first
    const key = cacheKey(latitude, longitude);
    const cached = satelliteCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setResult(cached.result);
      setLoading(false);
      setAttempted(true);
      return;
    }

    // Stale request guard: increment fetch ID
    const thisFetchId = ++fetchIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/satellite/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude,
          longitude,
          address,
          structureType,
        }),
      });

      // Check if this request is stale
      if (thisFetchId !== fetchIdRef.current) return;

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();

      if (!data.success || !data.result) {
        throw new Error(data.error ?? 'Analysis returned no results');
      }

      const analysisResult = data.result as SatelliteAnalysisResult;

      // Cache the result
      satelliteCache.set(key, { result: analysisResult, timestamp: Date.now() });

      setResult(analysisResult);
      setAttempted(true);
    } catch (err: unknown) {
      if (thisFetchId !== fetchIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[useSatelliteAnalysis] Failed: ${msg}`);
      setError(msg);
      setAttempted(true);
    } finally {
      if (thisFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [latitude, longitude, address, structureType, enabled]);

  // Debounced fetch on coordinate change
  useEffect(() => {
    if (latitude == null || longitude == null || !enabled) return;

    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Debounce: wait before calling the API
    timerRef.current = setTimeout(() => {
      fetchAnalysis();
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [latitude, longitude, enabled, debounceMs, fetchAnalysis]);

  const refetch = useCallback(() => {
    // Bypass cache on manual refetch
    if (latitude != null && longitude != null) {
      const key = cacheKey(latitude, longitude);
      satelliteCache.delete(key);
    }
    fetchAnalysis();
  }, [latitude, longitude, fetchAnalysis]);

  return { result, loading, error, refetch, attempted };
}
