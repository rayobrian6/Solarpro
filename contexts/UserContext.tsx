'use client';

/**
 * UserContext — Global single source of truth for authenticated user state.
 *
 * All components read from this context instead of fetching /api/auth/me independently.
 * refreshUser() re-fetches from DB and updates all consumers simultaneously.
 *
 * Priority for account badge:
 *   super_admin > admin > free_pass (is_free_pass boolean) > active > trialing > free
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;           // DB role column — platform authority
  company?: string;
  phone?: string;
  plan: string;           // DB plan column — billing tier
  subscriptionStatus: string;
  trialEndsAt: string | null;
  isFreePass: boolean;    // DB is_free_pass boolean — never inferred from status
  freePassNote?: string | null;
  hasAccess: boolean;
  companyLogoUrl?: string | null;
  brandPrimaryColor?: string;
  brandSecondaryColor?: string;
}

interface UserContextValue {
  user: AppUser | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  refreshUser: async () => {},
});

// ─── Retry configuration ──────────────────────────────────────────────────────
//
// CRITICAL RULE: setUser(null) is called ONLY when the server returns 401.
// Any other failure (503, 500, network) PRESERVES the existing user state.
// A logged-in user must NEVER be logged out because of a database error.
//
const ME_MAX_RETRIES   = 10;
const ME_BASE_DELAY_MS = 1000;   // exponential: 1s, 2s, 4s, 8s, 16s… capped at 15s
const ME_MAX_DELAY_MS  = 15_000;

// Status values returned by fetchUserFromDb
// 'ok'        — authenticated, user populated
// 'logout'    — 401, JWT invalid/expired, must clear session
// 'retry'     — transient error, retry with backoff
// 'preserve'  — permanent error but NOT auth failure, keep existing session
type FetchStatus = 'ok' | 'logout' | 'retry' | 'preserve';
type FetchResult = { status: FetchStatus; user: AppUser | null };

/**
 * Single fetch attempt for /api/auth/me.
 * Returns a { status, user } pair — never throws.
 */
async function fetchUserFromDb(): Promise<FetchResult> {
  try {
    const res = await fetch('/api/auth/me', {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    });

    // ── 401: JWT invalid/expired — the ONLY true logout signal ───────────────
    if (res.status === 401) {
      console.log('[UserContext] 401 — session expired or cookie missing');
      return { status: 'logout', user: null };
    }

    // ── 503: DB cold start or config error ───────────────────────────────────
    if (res.status === 503) {
      const json = await res.json().catch(() => ({}));
      const code = (json as any)?.code;
      if (code === 'DB_CONFIG_ERROR') {
        // Genuine server misconfiguration — retrying won't help.
        // But this is NOT an auth failure — preserve the session.
        console.error('[UserContext] AUTH_DB_CONFIG_ERROR — preserving existing session');
        return { status: 'preserve', user: null };
      }
      console.warn('[UserContext] AUTH_DB_STARTING — DB waking up, will retry');
      return { status: 'retry', user: null };
    }

    // ── Any other non-200: 500, 502, 504, etc ────────────────────────────────
    // NEVER treat these as logout. Always retry — it could be a cold start
    // that didn't return DB_STARTING correctly.
    if (!res.ok) {
      console.warn(`[UserContext] /api/auth/me returned ${res.status} — treating as transient`);
      return { status: 'retry', user: null };
    }

    // ── 200: parse response ───────────────────────────────────────────────────
    const json = await res.json();
    const u = json?.data || json?.user || json;

    // Empty response — transient parse issue, retry
    if (!u?.id) {
      console.warn('[UserContext] /api/auth/me returned 200 but no user id — will retry');
      return { status: 'retry', user: null };
    }

    const isFP = u.isFreePass === true;
    const role = u.role || 'user';
    const status = u.subscriptionStatus || 'trialing';
    const trialEndsAt = u.trialEndsAt || null;
    const roleLower = role.toLowerCase();
    const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
    const hasAccess =
      roleLower === 'super_admin' ||
      roleLower === 'admin' ||
      isFP ||
      status === 'active' ||
      status === 'free_pass' ||
      (status === 'trialing' && trialEnd !== null && trialEnd > new Date());

    const user: AppUser = {
      id: u.id,
      name: u.name || u.email,
      email: u.email,
      role,
      company: u.company,
      phone: u.phone,
      plan: u.plan || 'starter',
      subscriptionStatus: status,
      trialEndsAt,
      isFreePass: isFP,
      freePassNote: u.freePassNote || null,
      hasAccess,
      companyLogoUrl: u.companyLogoUrl || null,
      brandPrimaryColor: u.brandPrimaryColor || '#f59e0b',
      brandSecondaryColor: u.brandSecondaryColor || '#0f172a',
    };
    return { status: 'ok', user };

  } catch {
    // Network error, fetch aborted — always retry
    console.warn('[UserContext] fetchUserFromDb: network error — will retry');
    return { status: 'retry', user: null };
  }
}

/**
 * Fetches the current user with exponential backoff retry on transient errors.
 *
 * Returns:
 *   AppUser    — authenticated, fresh from DB
 *   null       — 401 — definitively not authenticated (JWT expired/missing)
 *   'transient'— all retries exhausted but NOT a logout condition
 *                callers MUST preserve existing session state
 */
async function fetchUserWithRetry(): Promise<AppUser | null | 'transient'> {
  for (let attempt = 0; attempt <= ME_MAX_RETRIES; attempt++) {
    const { status, user } = await fetchUserFromDb();

    if (status === 'ok' && user)   return user;
    if (status === 'logout')       return null;      // 401 only — truly not authenticated
    if (status === 'preserve')     return 'transient'; // config error — preserve session

    // status === 'retry' — wait then try again
    if (attempt < ME_MAX_RETRIES) {
      const delay = Math.min(ME_BASE_DELAY_MS * Math.pow(2, attempt), ME_MAX_DELAY_MS);
      console.warn(`[UserContext] Retry attempt ${attempt + 1}/${ME_MAX_RETRIES} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // All retries exhausted — DB unreachable but user may still be authenticated
  console.warn('[UserContext] All retries exhausted — preserving existing session state');
  return 'transient';
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchingRef = useRef(false);
  // Queue a refresh if one is already in-flight — ensures the last call wins
  const pendingRefreshRef = useRef(false);

  /**
   * refreshUser — re-fetches user from DB and updates state.
   *
   * CRITICAL CONTRACT:
   * - On success: updates user state with fresh data
   * - On 401: clears user state (user truly not authenticated)
   * - On ANY other failure: PRESERVES existing user state (never logs out on DB error)
   */
  const refreshUser = useCallback(async () => {
    // If already fetching, queue one more refresh for when it completes
    if (fetchingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    fetchingRef.current = true;
    pendingRefreshRef.current = false;
    try {
      const result = await fetchUserWithRetry();
      if (result === 'transient') {
        // Transient failure — preserve existing state, do NOT call setUser(null)
        console.warn('[UserContext] refreshUser: transient failure — keeping existing session');
        // Do not touch user state — keep whatever was there before
      } else {
        // null = 401 (definitively not authenticated), AppUser = success
        setUser(result);
      }
    } finally {
      fetchingRef.current = false;
      setLoading(false);
      // If a refresh was queued while we were fetching, run it now
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        setTimeout(() => {
          fetchUserWithRetry().then(result => {
            if (result !== 'transient') setUser(result);
          }).catch(() => {
            // Network completely down — preserve state
          });
        }, 500);
      }
    }
  }, []);

  // Fetch on mount — initial load
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Re-fetch when window regains focus or tab becomes visible.
  // Uses background refresh — on failure, preserves existing session.
  useEffect(() => {
    const onFocus = () => { refreshUser(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') { refreshUser(); }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshUser]);

  // Periodic re-fetch every 5 minutes — ensures admin-granted permissions
  // (free pass, role changes) propagate. Uses a background refresh that
  // NEVER clears session state on failure.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && !loading) {
        fetchUserWithRetry().then(result => {
          // Only update state on success — never clear on failure
          if (result !== null && result !== 'transient') {
            setUser(result as AppUser);
          }
          // null (401) clears state — session genuinely expired
          if (result === null) {
            setUser(null);
          }
          // 'transient' — do nothing, keep current state
        }).catch(() => {
          // Network down — preserve state
        });
      }
    }, 5 * 60_000); // 5 minutes — was 30s which was too aggressive
    return () => clearInterval(interval);
  }, [loading]);

  return (
    <UserContext.Provider value={{ user, loading, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}

/**
 * Returns the correct account badge label and color.
 * Role takes ABSOLUTE priority over subscription/plan state.
 *
 * Priority: super_admin > admin > free_pass > active > trialing > past_due > canceled > free
 */
export function getAccountBadge(user: AppUser | null): { label: string; color: string } {
  if (!user) return { label: '…', color: 'text-slate-500' };

  const role = (user.role || '').toLowerCase();

  // Role = platform authority — always shown first
  if (role === 'super_admin') return { label: 'Super Admin', color: 'text-purple-400' };
  if (role === 'admin')       return { label: 'Admin',       color: 'text-amber-400' };

  // Free pass = DB boolean is_free_pass
  if (user.isFreePass)        return { label: 'Free Pass',   color: 'text-emerald-400' };

  // Subscription state
  const status = (user.subscriptionStatus || 'trialing').toLowerCase();
  if (status === 'active')    return { label: `${capitalize(user.plan || 'Pro')} Plan`, color: 'text-emerald-400' };
  if (status === 'trialing')  return { label: 'Trial',       color: 'text-amber-400' };
  if (status === 'past_due')  return { label: 'Past Due',    color: 'text-red-400' };
  if (status === 'canceled')  return { label: 'Canceled',    color: 'text-red-400' };
  // Safety net: free_pass status string (legacy — is_free_pass boolean is canonical)
  if (status === 'free_pass') return { label: 'Free Pass',   color: 'text-emerald-400' };

  return { label: 'Free', color: 'text-slate-400' };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isAdminRole(role?: string) {
  return role === 'admin' || role === 'super_admin';
}