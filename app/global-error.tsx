'use client';

import { useEffect } from 'react';

/**
 * Next.js App Router global error boundary.
 * Catches unhandled errors at the root layout level.
 * This replaces the entire page with a recovery UI.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Ship the error to Sentry (fire-and-forget, non-blocking)
  useEffect(() => {
    import('@/lib/monitoring').then(({ captureError }) => {
      captureError(error, {
        code:  '[GLOBAL_ERROR_BOUNDARY]',
        route: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
        level: 'fatal',
        extra: { digest: error.digest },
      });
    }).catch(() => {/* non-critical */});
  }, [error]);
  return (
    <html lang="en" className="dark">
      <body style={{
        background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', margin: 0, padding: 32,
      }}>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f87171', marginBottom: 12 }}>
            Something went wrong
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 8, lineHeight: 1.6 }}>
            SolarPro encountered an unexpected error. Your work has been saved automatically.
          </p>
          <p style={{ color: '#64748b', fontSize: 12, marginBottom: 24 }}>
            {error.message || 'An unexpected error occurred.'}
            {error.digest ? <span style={{ display: 'block', marginTop: 4 }}>Reference: {error.digest}</span> : null}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{
                padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.href = '/dashboard'}
              style={{
                padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: 'rgba(255,255,255,0.1)', color: '#e2e8f0',
                border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
              }}
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}