'use client';

/**
 * useVersionCheck — DISABLED auto-reload
 *
 * Auto-reload was causing force-logouts on every deployment.
 * Version checking is now passive — no automatic page reloads ever.
 */

export function useVersionCheck() {
  return { updateReady: false };
}