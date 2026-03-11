'use client';

/**
 * useVersionCheck
 *
 * Polls /api/version every 60 seconds and compares against the version
 * this client was built with (injected at build time via NEXT_PUBLIC_BUILD_VERSION).
 *
 * If the server reports a newer version, the page is hard-reloaded with
 * cache-busting query params so the user always runs the latest code.
 *
 * This solves the Vercel alias caching problem where the alias URL
 * (e.g. solarpro-v31.vercel.app) may serve a stale deployment to users
 * who have the old page open.
 */

import { useEffect, useRef } from 'react';

const POLL_INTERVAL_MS = 60_000; // check every 60 seconds
const CLIENT_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION || '';

function hardReload() {
  // Force a full page reload bypassing all caches
  const url = new URL(window.location.href);
  url.searchParams.set('_v', Date.now().toString());
  window.location.replace(url.toString());
}

export function useVersionCheck() {
  const lastKnownVersion = useRef<string>(CLIENT_VERSION);
  const hasReloaded = useRef(false);

  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    async function checkVersion() {
      try {
        const res = await fetch(`/api/version?_=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        });
        if (!res.ok) return;
        const data = await res.json();
        const serverVersion: string = data.version || '';

        // First call — store the server version as baseline
        if (!lastKnownVersion.current) {
          lastKnownVersion.current = serverVersion;
          return;
        }

        // If server version differs from what we loaded with, reload
        if (
          serverVersion &&
          lastKnownVersion.current &&
          serverVersion !== lastKnownVersion.current &&
          !hasReloaded.current
        ) {
          console.log(`[VersionCheck] New version detected: ${lastKnownVersion.current} → ${serverVersion}. Reloading...`);
          hasReloaded.current = true;
          hardReload();
        }
      } catch {
        // Silently ignore network errors — don't disrupt the user
      }
    }

    // Check immediately on mount
    checkVersion();

    // Then poll every 60 seconds
    const interval = setInterval(checkVersion, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}