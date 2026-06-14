'use client';

// ============================================================================
// v47.441 - useDatasheetIngestion hook
//
// Client-side hook that calls the datasheet ingestion API when a user
// enters a datasheet URL in the admin hardware form.
//
// Usage:
//   const { result, loading, error, ingest } = useDatasheetIngestion();
//   // When user enters a URL:
//   ingest({
//     url: 'https://example.com/datasheet.pdf',
//     equipmentTypeHint: 'panel',
//   });
//
// DESIGN:
//   - Manual trigger (not auto-watching like other hooks)
//   - Caches results per URL to avoid redundant API calls
//   - Returns results compatible with ConfidenceBadge
// ============================================================================

import { useState, useCallback, useRef } from 'react';
import type { DatasheetIngestionResult } from '@/lib/satellite/types';

interface UseDatasheetIngestionInput {
  /** Only call the API when enabled */
  enabled?: boolean;
}

interface UseDatasheetIngestionOutput {
  /** Ingestion result */
  result: DatasheetIngestionResult | null;
  /** Whether the API call is in progress */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Trigger ingestion for a specific URL */
  ingest: (input: {
    url: string;
    equipmentTypeHint?: 'panel' | 'string_inverter' | 'microinverter' | 'optimizer';
    manufacturerHint?: string;
    modelHint?: string;
  }) => void;
  /** Clear the current result */
  clear: () => void;
}

// Simple in-memory cache for datasheet results
const datasheetCache = new Map<string, { result: DatasheetIngestionResult; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes (datasheets don't change often)

export function useDatasheetIngestion({
  enabled = true,
}: UseDatasheetIngestionInput = {}): UseDatasheetIngestionOutput {
  const [result, setResult] = useState<DatasheetIngestionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const ingest = useCallback(async (input: {
    url: string;
    equipmentTypeHint?: 'panel' | 'string_inverter' | 'microinverter' | 'optimizer';
    manufacturerHint?: string;
    modelHint?: string;
  }) => {
    if (!enabled) return;

    const { url, equipmentTypeHint, manufacturerHint, modelHint } = input;

    // Check cache first
    const cacheKey = `${url}|${equipmentTypeHint || ''}|${manufacturerHint || ''}|${modelHint || ''}`;
    const cached = datasheetCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setResult(cached.result);
      setLoading(false);
      setError(null);
      return;
    }

    // Stale request guard
    const thisFetchId = ++fetchIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/satellite/ingest-datasheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          equipmentTypeHint,
          manufacturerHint,
          modelHint,
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
        throw new Error(data.error ?? 'Ingestion returned no results');
      }

      const ingestionResult = data.result as DatasheetIngestionResult;

      // Cache the result
      datasheetCache.set(cacheKey, { result: ingestionResult, timestamp: Date.now() });

      setResult(ingestionResult);
    } catch (err: unknown) {
      if (thisFetchId !== fetchIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[useDatasheetIngestion] Failed: ${msg}`);
      setError(msg);
    } finally {
      if (thisFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled]);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, ingest, clear };
}
