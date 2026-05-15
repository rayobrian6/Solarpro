'use client';

/**
 * ClientMonitoringInit
 *
 * Mounts once in the root layout to:
 *   1. Register window.onerror + unhandledrejection handlers
 *   2. Ship uncaught browser errors to Sentry (when NEXT_PUBLIC_SENTRY_DSN is set)
 *
 * Uses dynamic import so monitoring.ts is not bundled unless this component renders.
 * Runs once on first mount, idempotent via __solarpro_monitoring_init flag.
 */

import { useEffect } from 'react';

export default function ClientMonitoringInit() {
  useEffect(() => {
    import('@/lib/monitoring').then(({ initClientMonitoring }) => {
      initClientMonitoring();
    }).catch(() => {/* non-critical */});
  }, []); // empty deps — run once

  return null; // no UI
}
