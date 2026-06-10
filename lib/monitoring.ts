/**
 * lib/monitoring.ts
 *
 * Unified error & performance monitoring for SolarPro.
 *
 * DESIGN PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero-dependency on Sentry being installed or the DSN being set.
 * Every error is logged to the console (Vercel captures these automatically).
 * When NEXT_PUBLIC_SENTRY_DSN is set, errors are ALSO shipped to Sentry via
 * their minimal fetch-based envelope API — no @sentry/nextjs webpack plugin
 * required, no build-time configuration needed.
 *
 * This means:
 *   - Works immediately with just `console.error` (no DSN = console-only)
 *   - Add DSN env var → Sentry alerts automatically activate
 *   - No changes to next.config.js, no sentry.client.config.ts required
 *   - Safe in Edge runtime (fetch-only, no Node.js-specific APIs)
 *
 * SETUP
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Create a Sentry project at https://sentry.io → New Project → Next.js
 * 2. Copy the DSN (starts with https://...@sentry.io/...)
 * 3. In Vercel Dashboard → Project → Settings → Environment Variables:
 *      NEXT_PUBLIC_SENTRY_DSN = https://xxx@o0.ingest.sentry.io/0
 *      SENTRY_DSN             = same value (for server-side)
 * 4. Deploy — errors will appear in Sentry immediately
 *
 * LOG CODES (searchable in Vercel function logs)
 * ─────────────────────────────────────────────────────────────────────────────
 *   [SENTRY_INIT]      — DSN parsed, Sentry shipping active
 *   [SENTRY_DISABLED]  — no DSN, console-only mode
 *   [SENTRY_SEND_OK]   — event successfully sent to Sentry
 *   [SENTRY_SEND_FAIL] — Sentry HTTP request failed (non-fatal)
 *   [CAPTURED_ERROR]   — error captured with context
 *   [CAPTURED_MESSAGE] — message captured with context
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface CaptureContext {
  /** Log code for Vercel search (e.g. '[AUTH_DB_STARTING]') */
  code?: string;
  /** URL or route identifier where the error occurred */
  route?: string;
  /** User ID (userId, NOT email) — safe to log */
  userId?: string;
  /** Arbitrary key-value tags (all values must be strings or numbers) */
  tags?: Record<string, string | number | boolean>;
  /** Extra structured data attached to the event */
  extra?: Record<string, unknown>;
  /** Severity — defaults to 'error' */
  level?: SeverityLevel;
}

// ── Sentry DSN parser ──────────────────────────────────────────────────────

interface ParsedDsn {
  endpoint: string;   // https://o<orgId>.ingest.sentry.io/api/<projectId>/envelope/
  publicKey: string;  // First component of the DSN user:password
  projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    // DSN format: https://<publicKey>@<host>/<projectId>
    const url = new URL(dsn);
    const publicKey  = url.username;
    const projectId  = url.pathname.replace('/', '');
    // Ingest endpoint — use sentry.io ingest subdomain format
    const host     = url.host; // e.g. o123456.ingest.sentry.io
    const endpoint = `https://${host}/api/${projectId}/envelope/`;
    if (!publicKey || !projectId) return null;
    return { endpoint, publicKey, projectId };
  } catch {
    return null;
  }
}

// ── Module-level singleton ─────────────────────────────────────────────────

let _parsedDsn: ParsedDsn | null | undefined = undefined; // undefined = not yet checked

function getDsn(): ParsedDsn | null {
  if (_parsedDsn !== undefined) return _parsedDsn;

  const dsn =
    (typeof process !== 'undefined' && process.env?.SENTRY_DSN) ||
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SENTRY_DSN) ||
    '';

  if (!dsn) {
    if (typeof window === 'undefined') {
      // Server-side only log — no console spam in browser
      console.log('[SENTRY_DISABLED] No SENTRY_DSN configured — errors logged to console only');
    }
    _parsedDsn = null;
    return null;
  }

  _parsedDsn = parseDsn(dsn);
  if (_parsedDsn) {
    console.log(`[SENTRY_INIT] Sentry active → projectId=${_parsedDsn.projectId}`);
  } else {
    console.warn('[SENTRY_DISABLED] SENTRY_DSN set but failed to parse — console-only mode');
  }
  return _parsedDsn;
}

// ── Build version helper ───────────────────────────────────────────────────

function getBuildVersion(): string {
  try {
    // Avoid circular import — read from env var injected at build time
    return process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Sentry envelope sender ─────────────────────────────────────────────────
// Uses the Sentry Envelope API (preferred over legacy store endpoint).
// Each envelope is a newline-separated JSON structure:
//   {header}\n{item-header}\n{item-payload}

async function sendToSentry(
  dsn: ParsedDsn,
  event: Record<string, unknown>
): Promise<void> {
  try {
    const eventId = event.event_id as string || crypto.randomUUID().replace(/-/g, '');
    const sentAt  = new Date().toISOString();

    // Envelope header
    const header = JSON.stringify({
      event_id: eventId,
      sent_at:  sentAt,
      sdk: {
        name:    'sentry.javascript.solarpro.custom',
        version: '1.0.0',
      },
      dsn: dsn.endpoint.replace('/envelope/', '').replace('/api/' + dsn.projectId, ''),
    });

    // Item header
    const itemHeader = JSON.stringify({ type: 'event', length: undefined });

    // Payload
    const tsMs = Date.now();
    const payload = JSON.stringify({ ...event, event_id: eventId, timestamp: Math.floor(tsMs / 1000) });

    const body = `${header}\n${itemHeader}\n${payload}`;

    const res = await fetch(dsn.endpoint, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/x-sentry-envelope',
        'X-Sentry-Auth':   `Sentry sentry_version=7, sentry_client=solarpro.custom/1.0, sentry_key=${dsn.publicKey}`,
      },
      body,
    });

    if (res.ok) {
      // Silent success — don't spam logs
    } else {
      console.warn(`[SENTRY_SEND_FAIL] HTTP ${res.status} — falling back to console-only`);
    }
  } catch (sendErr) {
    console.warn('[SENTRY_SEND_FAIL] Fetch failed:', sendErr);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * captureError — capture an Error with structured context.
 *
 * Always logs to console. Ships to Sentry when DSN is configured.
 *
 * Usage:
 *   import { captureError } from '@/lib/monitoring';
 *   captureError(err, { code: '[AUTH_DB_STARTING]', route: '/api/auth/me', userId });
 */
export function captureError(
  err: unknown,
  ctx: CaptureContext = {}
): void {
  const error = err instanceof Error ? err : new Error(String(err));
  const level = ctx.level || 'error';
  const code  = ctx.code  || '[CAPTURED_ERROR]';

  // ── Always log ────────────────────────────────────────────────────────
  console.error(
    `${code}${ctx.route ? ` route=${ctx.route}` : ''}${ctx.userId ? ` userId=${ctx.userId}` : ''} ${error.message}`,
    ctx.extra ? JSON.stringify(ctx.extra) : ''
  );

  // ── Sentry (when DSN configured) ──────────────────────────────────────
  const dsn = getDsn();
  if (!dsn) return;

  const event: Record<string, unknown> = {
    platform:    'javascript',
    level,
    release:     getBuildVersion(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    exception: {
      values: [{
        type:       error.name || 'Error',
        value:      error.message,
        stacktrace: error.stack
          ? {
              frames: error.stack.split('\n').slice(1).map(line => ({
                filename:   line.trim(),
                lineno:     undefined,
                colno:      undefined,
                in_app:     line.includes('/app/') || line.includes('/lib/') || line.includes('/components/'),
              })),
            }
          : undefined,
      }],
    },
    tags: {
      route:  ctx.route  || 'unknown',
      code:   code,
      ...(ctx.tags || {}),
    },
    extra: {
      ...(ctx.extra || {}),
      userId: ctx.userId || 'unknown',
    },
    user: ctx.userId ? { id: ctx.userId } : undefined,
    request: ctx.route ? { url: ctx.route } : undefined,
  };

  // Fire-and-forget — never block the request
  sendToSentry(dsn, event).catch(() => {/* already logged in sendToSentry */});
}

/**
 * captureMessage — capture a non-error event (warning, info, etc.)
 *
 * Usage:
 *   captureMessage('Rate limit hit', { level: 'warning', route: '/api/auth/login', tags: { ip: '...' } });
 */
export function captureMessage(
  message: string,
  ctx: CaptureContext = {}
): void {
  const level = ctx.level || 'info';
  const code  = ctx.code  || '[CAPTURED_MESSAGE]';

  // ── Always log ────────────────────────────────────────────────────────
  const logFn = level === 'error' || level === 'fatal'
    ? console.error
    : level === 'warning'
      ? console.warn
      : console.log;

  logFn(
    `${code}${ctx.route ? ` route=${ctx.route}` : ''} ${message}`,
    ctx.extra ? JSON.stringify(ctx.extra) : ''
  );

  // ── Sentry (when DSN configured) ──────────────────────────────────────
  const dsn = getDsn();
  if (!dsn) return;

  const event: Record<string, unknown> = {
    platform:    'javascript',
    level,
    message:     { formatted: message },
    release:     getBuildVersion(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    tags: {
      route: ctx.route  || 'unknown',
      code:  code,
      ...(ctx.tags || {}),
    },
    extra: {
      ...(ctx.extra || {}),
      userId: ctx.userId || 'unknown',
    },
    user: ctx.userId ? { id: ctx.userId } : undefined,
  };

  sendToSentry(dsn, event).catch(() => {});
}

/**
 * withMonitoring — wrap an async route handler and auto-capture unhandled errors.
 *
 * Usage:
 *   export const GET = withMonitoring('/api/projects', async (req) => {
 *     // ... handler code
 *   });
 */
export function withMonitoring<T>(
  route: string,
  handler: () => Promise<T>
): Promise<T> {
  return handler().catch((err: unknown) => {
    captureError(err, {
      code:  '[UNHANDLED_ROUTE_ERROR]',
      route,
      level: 'error',
    });
    throw err; // re-throw so the existing error handling still works
  });
}

/**
 * monitorDbError — specialized capture for DB errors with classification.
 * Called by handleRouteDbError (or can replace it) for structured DB alerts.
 */
export function monitorDbError(
  routeLabel: string,
  err: unknown,
  opts: { userId?: string; isTransient?: boolean } = {}
): void {
  const isTransient = opts.isTransient ?? true;
  captureError(err, {
    code:   isTransient ? '[DB_TRANSIENT_ERROR]' : '[DB_FATAL_ERROR]',
    route:  routeLabel,
    userId: opts.userId,
    level:  isTransient ? 'warning' : 'error',
    tags:   { db_transient: isTransient },
    extra:  { routeLabel },
  });
}

// ── Client-side window.onerror integration ─────────────────────────────────
// Call this once in your root layout or _app to capture unhandled browser errors.

export function initClientMonitoring(): void {
  if (typeof window === 'undefined') return;

  // Already initialized
  if ((window as any).__solarpro_monitoring_init) return;
  (window as any).__solarpro_monitoring_init = true;

  // Unhandled JS errors
  const origOnError = window.onerror;
  window.onerror = function(message, source, lineno, colno, error) {
    captureError(error || new Error(String(message)), {
      code:  '[BROWSER_UNHANDLED_ERROR]',
      route: String(source || window.location.pathname),
      extra: { source, lineno, colno },
      level: 'error',
    });
    return origOnError
      ? (origOnError as Function)(message, source, lineno, colno, error)
      : false;
  };

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event: { reason: unknown }) => {
    const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    captureError(reason, {
      code:  '[BROWSER_UNHANDLED_REJECTION]',
      route: window.location.pathname,
      level: 'error',
    });
  });
}
