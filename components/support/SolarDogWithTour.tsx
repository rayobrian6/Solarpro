'use client';

/**
 * SolarDogWithTour — thin client wrapper around SolarDog.
 *
 * Responsibilities:
 *  1. Read hasSeenTour from UserContext
 *  2. On first load (hasSeenTour=false), pass autoStartTour=true to SolarDog
 *  3. When tour finishes/skips, POST /api/auth/tour-complete and refreshUser()
 *
 * This is a separate component so the root layout stays a Server Component.
 */

import { useCallback, useRef } from 'react';
import SolarDog from '@/components/support/SolarDog';
import { useUser } from '@/contexts/UserContext';

export default function SolarDogWithTour() {
  const { user, loading, refreshUser } = useUser();
  const tourCompleteCalledRef = useRef(false);

  const handleTourComplete = useCallback(async () => {
    // Guard: only call once per session even if the callback fires multiple times
    if (tourCompleteCalledRef.current) return;
    tourCompleteCalledRef.current = true;

    try {
      await fetch('/api/auth/tour-complete', {
        method: 'POST',
        credentials: 'include',
      });
      // Refresh user so hasSeenTour updates to true in UserContext
      await refreshUser();
    } catch {
      // Non-critical — tour state will be re-fetched on next load
    }
  }, [refreshUser]);

  // Don't render until we know whether to auto-start the tour
  // (avoids a race where SolarDog renders before user loads)
  if (loading) return <SolarDog />;

  const shouldAutoStart = !!user && !user.hasSeenTour;

  return (
    <SolarDog
      autoStartTour={shouldAutoStart}
      onTourComplete={shouldAutoStart ? handleTourComplete : undefined}
    />
  );
}