'use client';

// ============================================================================
// v47.439 - usePhotoExtraction hook
//
// Client-side hook that watches for photo uploads and calls the
// photo extraction API to extract panel brand, breaker count,
// and roof condition from uploaded photos.
//
// Usage:
//   const { result, loading, error } = usePhotoExtraction({
//     photos: draft.photos.photos,
//     structureType: draft.siteOverview.structureType,
//     latitude: draft.siteOverview.latitude,
//     longitude: draft.siteOverview.longitude,
//     panelRating: draft.electricalService.panelRating,
//     roofAgeYears: draft.roofConditions.roofAgeYears,
//     roofMaterial: draft.roofConditions.roofMaterial,
//   });
//
// DESIGN:
//   - Only calls the API when relevant photos are uploaded
//   - Debounces rapid photo uploads (e.g. multiple captures)
//   - Caches results to avoid redundant API calls
//   - Returns results compatible with ConfidenceBadge
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SurveyPhoto } from '@/lib/survey/v2/types';
import type { PhotoExtractionResult } from '@/lib/satellite/types';

interface UsePhotoExtractionInput {
  /** Current photos array from the survey draft */
  photos: SurveyPhoto[];
  /** Context for heuristic fallback */
  structureType?: string;
  latitude?: number | null;
  longitude?: number | null;
  panelRating?: string;
  roofAgeYears?: number | null;
  roofMaterial?: string;
  /** Only call when enabled */
  enabled?: boolean;
  /** Debounce uploads (default: 2000ms) */
  debounceMs?: number;
}

interface UsePhotoExtractionOutput {
  /** Extraction result */
  result: PhotoExtractionResult | null;
  /** Whether the API call is in progress */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Manually re-trigger extraction */
  refetch: () => void;
}

// Simple in-memory cache
const photoCache = new Map<string, { result: PhotoExtractionResult; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function photoCacheKey(photos: SurveyPhoto[]): string {
  // Create a stable key from the photo URLs + categories
  const parts = photos
    .map((p) => `${p.category}:${p.url}`)
    .sort()
    .join('|');
  return parts;
}

export function usePhotoExtraction({
  photos,
  structureType,
  latitude,
  longitude,
  panelRating,
  roofAgeYears,
  roofMaterial,
  enabled = true,
  debounceMs = 2000,
}: UsePhotoExtractionInput): UsePhotoExtractionOutput {
  const [result, setResult] = useState<PhotoExtractionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);
  const prevKeyRef = useRef<string>('');

  const fetchExtraction = useCallback(async () => {
    if (!enabled || photos.length === 0) return;

    // Build photo URL map
    const photoUrls: Record<string, string> = {};
    for (const p of photos) {
      photoUrls[p.category] = p.url;
    }

    // Only proceed if we have relevant photos
    const hasRelevantPhoto = [
      'main_panel_open',
      'main_panel_closed',
      'roof_overview',
      'roof_detail',
    ].some((cat) => photoUrls[cat]);

    if (!hasRelevantPhoto) return;

    // Check cache
    const key = photoCacheKey(photos);
    const cached = photoCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setResult(cached.result);
      setLoading(false);
      return;
    }

    // Stale request guard
    const thisFetchId = ++fetchIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/satellite/extract-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoUrls,
          structureType,
          latitude,
          longitude,
          panelRating,
          roofAgeYears,
          roofMaterial,
        }),
      });

      if (thisFetchId !== fetchIdRef.current) return;

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();

      if (!data.success || !data.result) {
        throw new Error(data.error ?? 'Extraction returned no results');
      }

      const extractionResult = data.result as PhotoExtractionResult;

      // Cache the result
      photoCache.set(key, { result: extractionResult, timestamp: Date.now() });

      setResult(extractionResult);
    } catch (err: unknown) {
      if (thisFetchId !== fetchIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[usePhotoExtraction] Failed: ${msg}`);
      setError(msg);
    } finally {
      if (thisFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    photos,
    structureType,
    latitude,
    longitude,
    panelRating,
    roofAgeYears,
    roofMaterial,
    enabled,
  ]);

  // Debounced fetch when photos change
  useEffect(() => {
    if (!enabled || photos.length === 0) return;

    const key = photoCacheKey(photos);

    // Skip if the photos haven't actually changed
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Debounce: wait for more photo uploads before calling API
    timerRef.current = setTimeout(() => {
      fetchExtraction();
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [photos, enabled, debounceMs, fetchExtraction]);

  const refetch = useCallback(() => {
    // Bypass cache
    const key = photoCacheKey(photos);
    photoCache.delete(key);
    prevKeyRef.current = '';
    fetchExtraction();
  }, [photos, fetchExtraction]);

  return { result, loading, error, refetch };
}
