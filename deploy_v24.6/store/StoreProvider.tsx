/**
 * store/StoreProvider.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps the app and:
 *  1. Instantly hydrates store from localStorage (zero-flicker)
 *  2. Fetches fresh data from server in background
 *  3. Keeps localStorage in sync with server data
 */

'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from './appStore';

interface StoreProviderProps {
  children: React.ReactNode;
}

export function StoreProvider({ children }: StoreProviderProps) {
  const hydrateFromLocalStorage = useAppStore(s => s.hydrateFromLocalStorage);
  const loadClients = useAppStore(s => s.loadClients);
  const loadProjects = useAppStore(s => s.loadProjects);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Step 1: Instantly show cached data (synchronous)
    hydrateFromLocalStorage();

    // Step 2: Fetch fresh data from server (async, background)
    loadClients(true);
    loadProjects(true);
  }, [hydrateFromLocalStorage, loadClients, loadProjects]);

  return <>{children}</>;
}

export default StoreProvider;