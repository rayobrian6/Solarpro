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

const POLL_INTERVAL_MS = 30_000; // check every 30 seconds (was 60)
const CLIENT_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION || '';

function hardReload() {
  // Force a full page reload bypassing all caches
  const url = new URL(window.location.href);
  url.searchParams.set('_v', Date.now().toString());
  window.location.replace(url.toString());
}

export function useVersionCheck() {
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

        if (!serverVersion) return;

        // If we know our client version and it differs from server → reload
        if (CLIENT_VERSION && serverVersion !== CLIENT_VERSION && !hasReloaded.current) {
          console.log(`[VersionCheck] New version detected: ${CLIENT_VERSION} → ${serverVersion}. Reloading...`);
          hasReloaded.current = true;
          hardReload();
          return;
        }

        // If client version is unknown (old frozen deployment), always reload
        // when server reports any version — this breaks the freeze
        if (!CLIENT_VERSION && serverVersion && !hasReloaded.current) {
          console.log(`[VersionCheck] Client has no version (stale build). Server is ${serverVersion}. Reloading...`);
          hasReloaded.current = true;
          hardReload();
        }
      } catch {
        // Silently ignore network errors — don't disrupt the user
      }
    }

    // Check immediately on mount
    checkVersion();

    // Then poll every 30 seconds
    const interval = setInterval(checkVersion, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}