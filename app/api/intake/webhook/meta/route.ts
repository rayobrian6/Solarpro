/**
 * /api/intake/webhook/meta/route.ts
 *
 * Meta (Facebook) Lead Ads webhook handler.
 *
 * GET  — hub challenge verification (Facebook sends ?hub.mode=subscribe&hub.verify_token=&hub.challenge=)
 * POST — lead ads webhook; HMAC-SHA256 verified via X-Hub-Signature-256
 *
 * Always returns 200 (Meta retries on non-200).
 * Env: META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { verifyMetaWebhook, generatePayloadIdempotencyKey } from '@/lib/intake/webhookVerifier';
import { runIntakePipeline } from '@/lib/intake/intakePipeline';

async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const db = await getDbReady();
  return (db as any)(strings, ...values);
}

// ── GET: Hub challenge
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    console.warn('[GET /api/intake/webhook/meta] META_WEBHOOK_VERIFY_TOKEN not set');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge || '', { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ── POST: Lead ads
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const sigHeader = req.headers.get('x-hub-signature-256');
  const requestId = req.headers.get('x-request-id') || null;

  // Read raw body as Buffer for signature verification
  const rawBodyBuffer = Buffer.from(await req.arrayBuffer());
  const rawBodyStr = rawBodyBuffer.toString('utf8');

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBodyStr);
  } catch {
    // Always 200 to Meta
    console.error('[POST /api/intake/webhook/meta] Invalid JSON');
    return NextResponse.json({ received: true, error: 'invalid_json' }, { status: 200 });
  }

  // ── Verify signature
  const appSecret = process.env.META_APP_SECRET;
  let signatureVerified = false;
  if (appSecret) {
    const verResult = verifyMetaWebhook(rawBodyBuffer, sigHeader, appSecret);
    signatureVerified = verResult.verified;
    if (!signatureVerified) {
      console.warn('[POST /api/intake/webhook/meta] Signature verification failed:', verResult.reason);
      // A secret IS configured, so an unverified payload is untrusted — reject
      // it (200 so Meta doesn't retry-storm) WITHOUT ingesting any lead.
      return NextResponse.json(
        { received: true, error: 'signature_verification_failed' },
        { status: 200 },
      );
    }
  } else {
    console.warn('[POST /api/intake/webhook/meta] META_APP_SECRET not set — skipping verification');
  }

  // ── Idempotency key
  const idempotencyKey = requestId
    ? generatePayloadIdempotencyKey({ platform: 'meta', request_id: requestId })
    : generatePayloadIdempotencyKey({ platform: 'meta', body });

  // ── Log ingestion
  let logId: string | null = null;
  let leadsReceived = 0;
  let leadsCreated = 0;
  let leadesDuplicate = 0;
  let leadsErrored = 0;
  const processingStart = Date.now();

  try {
    const logRows = await sql`
      INSERT INTO webhook_ingestion_log (
        idempotency_key, platform, http_method,
        request_headers, raw_body, parsed_payload,
        signature_header, signature_verified, verification_method,
        status, ip_address
      )
      VALUES (
        ${idempotencyKey}, 'meta', 'POST',
        ${JSON.stringify({ 'x-hub-signature-256': sigHeader })},
        ${rawBodyStr},
        ${JSON.stringify(body)},
        ${sigHeader}, ${signatureVerified}, 'meta_hmac',
        'received', ${ip}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    logId = logRows[0]?.id as string || null;

    // Already processed
    if (!logId) {
      return NextResponse.json({ received: true, platform: 'meta', duplicate_request: true }, { status: 200 });
    }
  } catch (err) {
    console.error('[POST /api/intake/webhook/meta] Log insert error:', err);
  }

  // ── Extract and process leads
  // Meta payload: { object: 'page', entry: [{ id, time, changes: [{ value: { leadgen_id, form_id, field_data: [...] } }] }] }
  const entries = (body.entry as Record<string, unknown>[]) || [];

  for (const entry of entries) {
    const changes = (entry.changes as Record<string, unknown>[]) || [];
    for (const change of changes) {
      const value = (change.value as Record<string, unknown>) || {};
      if (change.field !== 'leadgen' && change.field !== undefined) continue;

      leadsReceived++;

      // Normalize Meta field_data array to flat object
      const fieldData = (value.field_data as Array<{ name: string; values: string[] }>) || [];
      const flat: Record<string, string> = {};
      for (const field of fieldData) {
        flat[field.name] = field.values?.[0] || '';
      }

      const rawLead = {
        first_name: flat.first_name || flat['FIRST_NAME'] || null,
        last_name: flat.last_name || flat['LAST_NAME'] || null,
        full_name: flat.full_name || flat.name || null,
        email: flat.email || flat['EMAIL'] || null,
        phone: flat.phone_number || flat['PHONE_NUMBER'] || flat.phone || null,
        address_line1: flat.street_address || flat['STREET_ADDRESS'] || null,
        city: flat.city || flat['CITY'] || null,
        state: flat.state || flat['STATE'] || null,
        zip: flat.zip_code || flat['ZIP_CODE'] || flat.postal_code || null,
        monthly_bill_amount: flat.monthly_electric_bill || flat.monthly_bill || null,
        // Meta attribution
        utm_source: 'facebook',
        utm_medium: 'paid_social',
        fbclid: value.leadgen_id as string || null,
        source_system: 'meta_lead_ads',
        source_channel: 'paid_social',
      };

      try {
        const result = await runIntakePipeline(rawLead, {
          source_system: 'meta_lead_ads',
          source_channel: 'paid_social',
          webhook_log_id: logId || undefined,
          ip_address: ip || undefined,
        });

        if (result.action === 'created' || result.action === 'duplicate_flagged') leadsCreated++;
        else if (result.action === 'duplicate_blocked') leadesDuplicate++;
        else leadsErrored++;
      } catch (err) {
        console.error('[POST /api/intake/webhook/meta] Pipeline error:', err);
        leadsErrored++;
      }
    }
  }

  // ── Update log with results
  if (logId) {
    try {
      await sql`
        UPDATE webhook_ingestion_log
        SET
          status             = 'processed',
          leads_received     = ${leadsReceived},
          leads_created      = ${leadsCreated},
          leads_duplicate    = ${leadesDuplicate},
          leads_errored      = ${leadsErrored},
          processing_duration_ms = ${Date.now() - processingStart},
          processed_at       = NOW()
        WHERE id = ${logId}
      `;
    } catch (err) {
      console.warn('[POST /api/intake/webhook/meta] Log update error (non-fatal):', err);
    }
  }

  return NextResponse.json({
    received: true,
    platform: 'meta',
    leads_received: leadsReceived,
    results: { created: leadsCreated, duplicate: leadesDuplicate, error: leadsErrored },
  }, { status: 200 });
}
