/**
 * /api/intake/webhook/google/route.ts
 *
 * Google Lead Form Extensions webhook handler.
 *
 * POST /api/intake/webhook/google
 *   Verifies X-Google-Key header against GOOGLE_WEBHOOK_KEY env var.
 *   Normalizes Google's user_column_data array format.
 *   Always returns 200.
 *
 * Env: GOOGLE_WEBHOOK_KEY
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { verifyGoogleWebhook, generatePayloadIdempotencyKey } from '@/lib/intake/webhookVerifier';
import { runIntakePipeline } from '@/lib/intake/intakePipeline';

const sql = neon(process.env.DATABASE_URL!);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const googleKeyHeader = req.headers.get('x-google-key');
  const requestId = req.headers.get('x-request-id') || null;

  // Read raw body
  const rawBodyStr = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBodyStr);
  } catch {
    console.error('[POST /api/intake/webhook/google] Invalid JSON');
    return NextResponse.json({ received: true, error: 'invalid_json' }, { status: 200 });
  }

  // ── Verify key
  const configuredKey = process.env.GOOGLE_WEBHOOK_KEY;
  let signatureVerified = false;
  if (configuredKey) {
    const verResult = verifyGoogleWebhook(googleKeyHeader, configuredKey);
    signatureVerified = verResult.verified;
    if (!signatureVerified) {
      console.warn('[POST /api/intake/webhook/google] Key verification failed');
    }
  } else {
    console.warn('[POST /api/intake/webhook/google] GOOGLE_WEBHOOK_KEY not set — skipping verification');
  }

  // ── Idempotency key
  const idempotencyKey = requestId
    ? generatePayloadIdempotencyKey({ platform: 'google', request_id: requestId })
    : generatePayloadIdempotencyKey({ platform: 'google', body });

  // ── Log ingestion
  let logId: string | null = null;
  const processingStart = Date.now();
  let leadsReceived = 0;
  let leadsCreated = 0;
  let leadesDuplicate = 0;
  let leadsErrored = 0;

  try {
    const logRows = await sql`
      INSERT INTO webhook_ingestion_log (
        idempotency_key, platform, http_method,
        request_headers, raw_body, parsed_payload,
        signature_header, signature_verified, verification_method,
        status, ip_address
      )
      VALUES (
        ${idempotencyKey}, 'google', 'POST',
        ${JSON.stringify({ 'x-google-key': googleKeyHeader ? '[redacted]' : null })},
        ${rawBodyStr},
        ${JSON.stringify(body)},
        ${googleKeyHeader ? '[redacted]' : null}, ${signatureVerified}, 'google_key',
        'received', ${ip}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    logId = logRows[0]?.id as string || null;

    if (!logId) {
      return NextResponse.json({ received: true, platform: 'google', duplicate_request: true }, { status: 200 });
    }
  } catch (err) {
    console.error('[POST /api/intake/webhook/google] Log insert error:', err);
  }

  // ── Normalize Google Lead Form payload
  // Google sends: { lead_id, form_id, user_column_data: [{ column_id, string_value }], ... }
  // or: { leads: [{ ... }] }
  const leads: Record<string, unknown>[] = [];

  if (Array.isArray(body.leads)) {
    leads.push(...(body.leads as Record<string, unknown>[]));
  } else {
    leads.push(body);
  }

  for (const lead of leads) {
    leadsReceived++;

    // Normalize user_column_data array to flat object
    const columnData = (lead.user_column_data as Array<{ column_id: string; string_value?: string }>) || [];
    const flat: Record<string, string> = {};
    for (const col of columnData) {
      // Google column_ids: FULL_NAME, EMAIL, PHONE_NUMBER, POSTAL_CODE, CITY, REGION, COUNTRY, etc.
      flat[col.column_id?.toLowerCase() || ''] = col.string_value || '';
    }

    // Also accept top-level fields
    const rawLead = {
      first_name: (lead.first_name as string) || flat.first_name || null,
      last_name: (lead.last_name as string) || flat.last_name || null,
      full_name: (lead.full_name as string) || flat.full_name || flat.name || null,
      email: (lead.email as string) || flat.email || flat.email_address || null,
      phone: (lead.phone as string) || flat.phone_number || flat.phone || null,
      address_line1: (lead.address_line1 as string) || flat.street_address || null,
      city: (lead.city as string) || flat.city || null,
      state: (lead.state as string) || flat.region || flat.state || null,
      zip: (lead.zip as string) || flat.postal_code || flat.zip_code || null,
      monthly_bill_amount: (lead.monthly_bill_amount as string) || flat.monthly_electric_bill || null,
      // Google attribution
      gclid: (lead.gclid as string) || null,
      utm_source: 'google',
      utm_medium: 'paid_search',
      source_system: 'google_lead_form',
      source_channel: 'paid_search',
    };

    try {
      const result = await runIntakePipeline(rawLead, {
        source_system: 'google_lead_form',
        source_channel: 'paid_search',
        webhook_log_id: logId || undefined,
        ip_address: ip || undefined,
      });

      if (result.action === 'created' || result.action === 'duplicate_flagged') leadsCreated++;
      else if (result.action === 'duplicate_blocked') leadesDuplicate++;
      else leadsErrored++;
    } catch (err) {
      console.error('[POST /api/intake/webhook/google] Pipeline error:', err);
      leadsErrored++;
    }
  }

  // ── Update log
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
      console.warn('[POST /api/intake/webhook/google] Log update error (non-fatal):', err);
    }
  }

  return NextResponse.json({
    received: true,
    platform: 'google',
    leads_received: leadsReceived,
    results: { created: leadsCreated, duplicate: leadesDuplicate, error: leadsErrored },
  }, { status: 200 });
}
