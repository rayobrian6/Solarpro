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

async function fetchUserFromDb(): Promise<AppUser | null> {
  try {
    const res = await fetch('/api/auth/me', {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const u = json?.data || json?.user || json;
    if (!u?.id) return null;

    // isFreePass MUST come from DB boolean is_free_pass only
    // Never infer from subscriptionStatus string
    const isFP = u.isFreePass === true;
    const role = u.role || 'user';
    const status = u.subscriptionStatus || 'trialing';
    const trialEndsAt = u.trialEndsAt || null;

    // Compute hasAccess using the same logic as hasPlatformAccess()
    // This ensures UserContext.hasAccess is always consistent with lib/permissions.ts
    const roleLower = role.toLowerCase();
    const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
    const hasAccess =
      roleLower === 'super_admin' ||
      roleLower === 'admin' ||
      isFP ||
      status === 'active' ||
      status === 'free_pass' ||   // set by admin grant_free_pass alongside is_free_pass boolean
      (status === 'trialing' && trialEnd !== null && trialEnd > new Date());

    return {
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
  } catch {
    return null;
  }
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchingRef = useRef(false);
  // Queue a refresh if one is already in-flight — ensures the last call wins
  const pendingRefreshRef = useRef(false);

  const refreshUser = useCallback(async () => {
    // If already fetching, queue one more refresh for when it completes
    if (fetchingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    fetchingRef.current = true;
    pendingRefreshRef.current = false;
    try {
      const u = await fetchUserFromDb();
      setUser(u);
    } finally {
      fetchingRef.current = false;
      setLoading(false);
      // If a refresh was queued while we were fetching, run it now
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        // Small delay to avoid tight loop
        setTimeout(() => {
          fetchUserFromDb().then(u => setUser(u)).catch(() => {});
        }, 200);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Re-fetch when window regains focus — ensures stale state is cleared
  // after admin actions, tab switches, or long idle periods
  useEffect(() => {
    const onFocus = () => {
      // Only refresh if we already have a user (i.e. logged in)
      // Avoids unnecessary fetches on login page
      refreshUser();
    };
    // Also refresh when tab becomes visible (handles mobile app switching)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshUser();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshUser]);

  // Periodic re-fetch every 30 seconds — ensures admin-granted permissions
  // (free pass, role changes) propagate to the affected user's session
  // without requiring a manual page reload or tab switch.
  useEffect(() => {
    const interval = setInterval(() => {
      // Only poll if the page is visible and user is logged in
      if (document.visibilityState === 'visible' && !loading) {
        fetchUserFromDb().then(u => {
          if (u) setUser(u);
        }).catch(() => {});
      }
    }, 30_000);
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