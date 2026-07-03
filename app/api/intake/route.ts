/**
 * /api/intake/route.ts
 *
 * Canonical intake endpoint — authenticated with X-Intake-Key header.
 * Used by internal systems, CRMs, and trusted integrations.
 *
 * POST /api/intake
 *   Headers:
 *     X-Intake-Key: <INTAKE_API_KEY env var>
 *   Body: RawIntakePayload (JSON)
 *
 * Returns:
 *   201 — created
 *   409 — duplicate_blocked
 *   422 — validation_failed
 *   500 — error
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runIntakePipeline } from '@/lib/intake/intakePipeline';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

/** Constant-time string comparison to prevent timing attacks. */
function safeStrEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth (timing-safe comparison)
  const intakeKey = req.headers.get('x-intake-key') || req.headers.get('X-Intake-Key');
  const configuredKey = process.env.INTAKE_API_KEY;

  if (!configuredKey) {
    console.warn('[POST /api/intake] INTAKE_API_KEY not configured');
    return NextResponse.json({ error: 'Intake endpoint not configured' }, { status: 503 });
  }

  if (!intakeKey || !safeStrEqual(intakeKey, configuredKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }

  // ── Extract metadata from headers
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || null;
  const userAgent = req.headers.get('user-agent') || null;
  const referer = req.headers.get('referer') || null;
  const sourceSystem = req.headers.get('x-source-system') || body.source_system as string || 'api';

  // ── Run pipeline
  const result = await runIntakePipeline(body, {
    source_system: sourceSystem,
    ip_address: ip,
    user_agent: userAgent,
    referer,
  });

  const statusMap: Record<string, number> = {
    created: 201,
    duplicate_flagged: 201,
    duplicate_blocked: 409,
    validation_failed: 422,
    error: 500,
  };

  const status = statusMap[result.action] ?? 500;

  return NextResponse.json({
    action: result.action,
    opportunity_id: result.opportunity_id,
    duplicate_score: result.duplicate_score,
    duplicate_match_id: result.duplicate_match_id,
    validation_errors: result.validation_errors,
    validation_warnings: result.validation_warnings,
    event_id: result.event_id,
    duration_ms: result.duration_ms,
  }, { status });
}
