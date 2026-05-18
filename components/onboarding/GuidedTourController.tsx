'use client';

/**
 * GuidedTourController — Thin wrapper that decides when to show GuidedTour.
 *
 * Reads `hasSeenTour` from UserContext. When false (new user), renders
 * the GuidedTour overlay. On completion/skip, POSTs to
 * /api/settings/onboarding-complete and refreshes the user.
 *
 * Mounted inside AppShell so it appears on top of every page.
 * Does NOT render until the user has loaded (avoids flicker).
 */

import { useCallback, useRef } from 'react';
import { useUser } from '@/contexts/UserContext';
import GuidedTour from './GuidedTour';

export default function GuidedTourController() {
  const { user, loading, refreshUser } = useUser();
  const completedRef = useRef(false);

  const handleComplete = useCallback(async () => {
    // Guard against double-fire (Escape + button click race)
    if (completedRef.current) return;
    completedRef.current = true;

    try {
      await fetch('/api/settings/onboarding-complete', {
        method:      'POST',
        credentials: 'include',
      });
      // Update UserContext so the tour doesn't reappear on next render
      await refreshUser();
    } catch {
      // Non-critical — worst case the tour shows once more on next page load
    }
  }, [refreshUser]);

  // Don't render until user state is resolved
  if (loading || !user) return null;

  // Tour already seen — nothing to render
  if (user.hasSeenTour) return null;

  return <GuidedTour onComplete={handleComplete} />;
}
