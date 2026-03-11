'use client';

/**
 * useVersionCheck
 *
 * Polls /api/version every 90 seconds and compares against the version
 * this client was built with (injected at build time via NEXT_PUBLIC_BUILD_VERSION).
 *
 * SAFE RELOAD STRATEGY:
 * - Only reloads after the new version has been confirmed on 2 consecutive checks
 *   (i.e. ~90 seconds of stability) — prevents reloading mid-deployment when
 *   Vercel functions are still cold-starting and login would fail.
 * - Never reloads if the user is actively typing or has focus on an input.
 * - Shows a soft banner instead of force-reloading during active sessions.
 * - Does NOT check immediately on mount — waits for first poll interval so the
 *   page has fully loaded before any version check fires.
 */

import { useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS   = 90_000; // check every 90 seconds
const CONFIRM_COUNT      = 2;      // must see new version N times before reload
const CLIENT_VERSION     = process.env.NEXT_PUBLIC_BUILD_VERSION || '';

function hardReload() {
  const url = new URL(window.location.href);
  url.searchParams.set('_v', Date.now().toString());
  window.location.replace(url.toString());
}

function isUserActive(): boolean {
  // Don't reload if user is focused on an input/textarea
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable;
}

export function useVersionCheck() {
  const hasReloaded      = useRef(false);
  const mismatchCount    = useRef(0);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
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

        const isNewVersion =
          (CLIENT_VERSION && serverVersion !== CLIENT_VERSION) ||
          (!CLIENT_VERSION && !!serverVersion);

        if (isNewVersion) {
          mismatchCount.current += 1;
          console.log(`[VersionCheck] Mismatch detected (${mismatchCount.current}/${CONFIRM_COUNT}): client=${CLIENT_VERSION} server=${serverVersion}`);

          if (mismatchCount.current >= CONFIRM_COUNT && !hasReloaded.current) {
            // Show banner — let user decide when to reload, or reload if idle
            setUpdateReady(true);
            if (!isUserActive()) {
              console.log(`[VersionCheck] Reloading now (user idle, version confirmed stable).`);
              hasReloaded.current = true;
              hardReload();
            }
          }
        } else {
          // Versions match — reset mismatch counter (deployment may have rolled back)
          mismatchCount.current = 0;
        }
      } catch {
        // Silently ignore network errors
      }
    }

    // Do NOT check immediately on mount — wait for first interval
    // This avoids hitting cold-starting functions right after a deploy
    const interval = setInterval(checkVersion, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return { updateReady };
}