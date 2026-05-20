/**
 * /api/intake/homeowner/route.ts
 *
 * Public homeowner form submissions — no auth required.
 * Rate-limited: 3 submissions per 15 minutes per IP.
 * Looks up funnel config from intake_funnels table.
 *
 * Canonical review-first flow for /free-solar-estimate:
 *   /free-solar-estimate → this route → intake_events → Admin Intake Feed
 *   → operator review → later conversion into marketplace opportunity.
 *
 * POST /api/intake/homeowner
 *   Body: RawIntakePayload + optional funnel_slug
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import {
  logMalformedHomeownerIntake,
  makeHomeownerIntakeEventId,
  submitHomeownerIntakeEvent,
} from '@/lib/intake/homeownerEventIntake';
import {
  isUtilityBillStorageFailure,
  metadataOnlyUtilityBill,
  storeUtilityBillAttachment,
} from '@/lib/intake/utilityBillAttachment';

async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const db = await getDbReady();
  return (db as any)(strings, ...values);
}

// ── In-memory rate limiter (3 per 15 min per IP)
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 3;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitMap.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.resetAt };
}

// Clean up stale entries every 1000 requests
let cleanupCounter = 0;
function maybeCleanupRateLimitMap(): void {
  if (++cleanupCounter % 1000 === 0) {
    const now = Date.now();
    for (const [key, val] of rateLimitMap.entries()) {
      if (now > val.resetAt) rateLimitMap.delete(key);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  const userAgent = req.headers.get('user-agent') || null;
  const referer = req.headers.get('referer') || null;

  maybeCleanupRateLimitMap();

  // ── Rate limit
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rateCheck.resetAt / 1000)),
          'Retry-After': String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  // ── Parse body. Existing JSON clients remain supported; multipart carries the
  // real utility bill file for the public homeowner form.
  let body: Record<string, unknown>;
  let billFile: File | null = null;
  const contentType = req.headers.get('content-type') || '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const payloadText = formData.get('payload');
      if (typeof payloadText === 'string' && payloadText.trim()) {
        body = JSON.parse(payloadText) as Record<string, unknown>;
      } else {
        body = {};
        for (const [key, value] of formData.entries()) {
          if (key === 'utility_bill') continue;
          if (typeof value === 'string') body[key] = value;
        }
      }
      const maybeFile = formData.get('utility_bill');
      billFile = maybeFile instanceof File && maybeFile.size > 0 ? maybeFile : null;
    } else {
      body = await req.json();
    }
  } catch (err) {
    const eventId = await logMalformedHomeownerIntake((err as Error).message || 'Invalid request body', {
      source_system: 'homeowner_form',
      source_channel: 'web',
      funnel_slug: 'free-solar-estimate',
      ip_address: ip,
      user_agent: userAgent,
      referer,
    });
    return NextResponse.json({ error: 'Invalid request body', event_id: eventId }, { status: 400 });
  }

  // ── Look up funnel config
  const funnelSlug = (body.funnel_slug as string) || 'free-solar-estimate';
  let funnelId: string | null = null;
  let campaignId: string | null = null;
  let requirePhone = false;
  let requireAddress = false;

  if (funnelSlug) {
    try {
      const funnels = await sql`
        SELECT id, campaign_id, require_phone, require_address, require_monthly_bill, is_active
        FROM intake_funnels
        WHERE slug = ${funnelSlug}
        LIMIT 1
      `;
      const funnel = funnels[0];
      if (funnel) {
        if (!funnel.is_active) {
          return NextResponse.json({ error: 'This form is no longer active.' }, { status: 410 });
        }
        funnelId = funnel.id as string;
        campaignId = funnel.campaign_id as string || null;
        requirePhone = !!funnel.require_phone;
        requireAddress = !!funnel.require_address;
      }
    } catch (err) {
      console.warn('[POST /api/intake/homeowner] Funnel lookup failed (non-fatal):', (err as Error).message);
    }
  }

  const eventId = makeHomeownerIntakeEventId();
  body.event_id = eventId;

  if (billFile) {
    try {
      const billMetadata = await storeUtilityBillAttachment(billFile, {
        eventId,
        funnelSlug,
      });
      body.uploaded_bill_filename = billMetadata.filename;
      body.uploaded_bill_size_bytes = billMetadata.size_bytes;
      body.uploaded_bill_content_type = billMetadata.content_type;
      body.bill_metadata = billMetadata;
      body.bill_attachment_metadata_only = false;
    } catch (err) {
      const fallbackMetadata = metadataOnlyUtilityBill(billFile);
      body.uploaded_bill_filename = billFile.name;
      body.uploaded_bill_size_bytes = billFile.size;
      body.uploaded_bill_content_type = billFile.type || 'application/octet-stream';
      if (fallbackMetadata) body.bill_metadata = fallbackMetadata;
      body.bill_attachment_metadata_only = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ATTACHMENT STORAGE FAILED]', {
        event_id: eventId,
        filename: billFile.name,
        size_bytes: billFile.size,
        content_type: billFile.type || null,
        recoverable: isUtilityBillStorageFailure(err),
        message,
      });

      if (!isUtilityBillStorageFailure(err)) {
        return NextResponse.json(
          {
            error: message || 'Utility bill upload failed. Please try again without the file or upload a supported PDF/image.',
            event_id: eventId,
          },
          { status: 400 },
        );
      }
    }
  }

  // ── Persist a canonical review-first intake_events row. This deliberately
  // does not create network_opportunities or marketplace inventory.
  const result = await submitHomeownerIntakeEvent(body, {
    source_system: 'homeowner_form',
    source_channel: (body.source_channel as string) || 'web',
    funnel_id: funnelId,
    funnel_slug: funnelSlug,
    campaign_id: campaignId,
    ip_address: ip,
    user_agent: userAgent,
    referer,
    require_phone: requirePhone,
    require_address: requireAddress,
  });

  // Public responses are intentionally vague on duplicates
  if (result.action === 'validation_failed') {
    return NextResponse.json(
      { error: 'Please check your information and try again.', details: result.validation_errors, event_id: result.event_id },
      { status: 422 }
    );
  }

  if (result.action === 'error') {
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.', event_id: result.event_id },
      { status: 500 }
    );
  }

  // Return 200 for all success cases (including duplicates — don't reveal to user)
  return NextResponse.json(
    {
      success: true,
      message: 'Thank you! A solar advisor will be in touch shortly.',
      event_id: result.event_id,
      opportunity_id: null,
      review_status: 'pending_operator_review',
    },
    {
      status: 200,
      headers: {
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': String(rateCheck.remaining),
        'X-RateLimit-Reset': String(Math.ceil(rateCheck.resetAt / 1000)),
      },
    }
  );
}
