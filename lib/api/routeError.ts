import { NextResponse } from 'next/server';

/**
 * Generic error response for routes that do NOT touch the database.
 *
 * Several pure-compute / upstream-proxy routes were funneling every thrown
 * error through handleRouteDbError, which always returns 503 + code
 * DB_STARTING. The frontend treats DB_STARTING as a transient cold-start and
 * retries, so a deterministic parse/compute/upstream failure became a
 * misleading infinite retry loop. Use this instead for non-DB routes.
 *
 * - JSON body parse failures (SyntaxError) → 400
 * - everything else → the given status (default 500)
 * The raw error is logged server-side only; the client gets a safe message.
 */
export function routeError(
  label: string,
  err: unknown,
  opts?: { status?: number; clientMessage?: string },
): NextResponse {
  const isBadInput = err instanceof SyntaxError;
  const status = opts?.status ?? (isBadInput ? 400 : 500);
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`${label}:`, detail);
  return NextResponse.json(
    { success: false, error: opts?.clientMessage ?? (isBadInput ? 'Invalid request.' : 'Internal error.') },
    { status },
  );
}
