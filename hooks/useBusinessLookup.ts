'use client';

// ============================================================================
// v47.440 - useBusinessLookup hook
//
// Client-side hook that calls the business registry lookup API when
// the user reaches the onboarding Step 2 (Company Info).
//
// Usage:
//   const { result, loading, error, refetch } = useBusinessLookup({
//     email: user.email,
//     companyName: company.companyName,
//     phone: company.companyPhone,
//     enabled: step === 2,
//   });
//
// DESIGN:
//   - Calls /api/satellite/lookup-business when triggered
//   - Debounces rapid name changes (e.g. user typing)
//   - Caches results to avoid redundant API calls
//   - Returns results compatible with ConfidenceBadge
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { BusinessRegistryResult } from '@/lib/satellite/types';

interface UseBusinessLookupInput {
  /** User's email address (for domain inference) */
  email?: string;
  /** User-entered company name (for normalization + lookup) */
  companyName?: string;
  /** User's phone (for area-code region inference) */
  phone?: string;
  /** Only call the API when enabled (e.g. when onboarding step 2 is visible) */
  enabled?: boolean;
  /** Debounce name changes (default: 1500ms) */
  debounceMs?: number;
}

interface UseBusinessLookupOutput {
  /** Lookup result (null while loading or if no inputs) */
  result: BusinessRegistryResult | null;
  /** Whether the API call is in progress */
  loading: boolean;
  /** Error message if the API call failed */
  error: string | null;
  /** Manually re-trigger the lookup */
  refetch: () => void;
  /** Whether the hook has attempted a fetch */
  attempted: boolean;
}

// Simple in-memory cache for business lookup results
const businessCache = new Map<string, { result: BusinessRegistryResult; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(email?: string, companyName?: string, phone?: string): string {
  return `${email || ''}|${companyName || ''}|${phone || ''}`;
}

export function useBusinessLookup({
  email,
  companyName,
  phone,
  enabled = true,
  debounceMs = 1500,
}: UseBusinessLookupInput): UseBusinessLookupOutput {
  const [result, setResult] = useState<BusinessRegistryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  const fetchLookup = useCallback(async () => {
    if (!enabled) return;
    // Need at least email or companyName
    if (!email?.trim() && !companyName?.trim()) return;

    // Check cache first
    const key = cacheKey(email, companyName, phone);
    const cached = businessCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setResult(cached.result);
      setLoading(false);
      setAttempted(true);
      return;
    }

    // Stale request guard
    const thisFetchId = ++fetchIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/satellite/lookup-business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          companyName,
          phone,
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
        throw new Error(data.error ?? 'Lookup returned no results');
      }

      const lookupResult = data.result as BusinessRegistryResult;

      // Cache the result
      businessCache.set(key, { result: lookupResult, timestamp: Date.now() });

      setResult(lookupResult);
      setAttempted(true);
    } catch (err: unknown) {
      if (thisFetchId !== fetchIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[useBusinessLookup] Failed: ${msg}`);
      setError(msg);
      setAttempted(true);
    } finally {
      if (thisFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [email, companyName, phone, enabled]);

  // Debounced fetch when inputs change
  useEffect(() => {
    if (!enabled) return;
    if (!email?.trim() && !companyName?.trim()) return;

    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Debounce: wait before calling the API
    timerRef.current = setTimeout(() => {
      fetchLookup();
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [email, companyName, phone, enabled, debounceMs, fetchLookup]);

  const refetch = useCallback(() => {
    // Bypass cache on manual refetch
    const key = cacheKey(email, companyName, phone);
    businessCache.delete(key);
    fetchLookup();
  }, [email, companyName, phone, fetchLookup]);

  return { result, loading, error, refetch, attempted };
}
