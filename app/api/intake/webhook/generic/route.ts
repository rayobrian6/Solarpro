/**
 * /api/intake/webhook/generic/route.ts
 *
 * Generic partner webhook handler.
 * Supports: LeadPerfection, Hatch, Velocify, and any HMAC-based partner.
 *
 * POST /api/intake/webhook/generic
 *   Headers:
 *     X-Partner-Id:          partner slug (e.g. "leadperfection", "hatch", "velocify")
 *     X-Webhook-Signature:   sha256=<hmac> (optional, depends on partner config)
 *     X-Idempotency-Key:     optional idempotency key
 *     X-Request-Id:          optional request ID
 *
 * Secret resolution:
 *   WEBHOOK_SECRET_<PARTNER_ID_UPPERCASE>  (e.g. WEBHOOK_SECRET_LEADPERFECTION)
 *   fallback: WEBHOOK_SECRET_GENERIC
 *
 * If secret is configured but no signature → 401
 * If secret is configured and signature mismatch → 401
 * If no secret configured → warn + allow (log unverified)
 *
 * Body shapes handled:
 *   { leads: [...] }         — array of leads
 *   { data: [...] }          — array of leads
 *   { data: { ... } }        — single lead object
 *   { lead: { ... } }        — single lead object
 *   flat root object         — treat root as single lead
 *
 * Always returns 200 (except 401 on bad sig).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { verifyGenericWebhook, generatePayloadIdempotencyKey } from '@/lib/intake/webhookVerifier';
import { runIntakePipeline } from '@/lib/intake/intakePipeline';

const sql = neon(process.env.DATABASE_URL!);

// ────────────────────────────────────────────────────────────────────────────
// Body shape normalizer
// ────────────────────────────────────────────────────────────────────────────

function extractLeads(body: Record<string, unknown>): Record<string, unknown>[] {
  // body.leads[]
  if (Array.isArray(body.leads)) return body.leads as Record<string, unknown>[];
  // body.data[]
  if (Array.isArray(body.data)) return body.data as Record<string, unknown>[];
  // body.data{}
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    return [body.data as Record<string, unknown>];
  }
  // body.lead{}
  if (body.lead && typeof body.lead === 'object' && !Array.isArray(body.lead)) {
    return [body.lead as Record<string, unknown>];
  }
  // Flat root — check for any of these identity fields
  if (body.email || body.phone || body.first_name || body.last_name || body.full_name) {
    return [body];
  }
  return [];
}

// ────────────────────────────────────────────────────────────────────────────
// Field name normalizer (handles various CRM field naming conventions)
// ────────────────────────────────────────────────────────────────────────────

function normalizeLead(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    first_name:           raw.first_name || raw.firstName || raw.fname || raw.FirstName || null,
    last_name:            raw.last_name  || raw.lastName  || raw.lname || raw.LastName  || null,
    full_name:            raw.full_name  || raw.fullName  || raw.name  || raw.Name      || null,
    email:                raw.email      || raw.Email     || raw.email_address          || null,
    phone:                raw.phone      || raw.Phone     || raw.phone_number || raw.PhoneNumber || raw.mobile || null,
    address_line1:        raw.address_line1 || raw.address || raw.Address || raw.street || null,
    address_line2:        raw.address_line2 || raw.address2 || null,
    city:                 raw.city || raw.City || null,
    state:                raw.state || raw.State || null,
    zip:                  raw.zip || raw.zip_code || raw.ZipCode || raw.postal_code || null,
    county:               raw.county || raw.County || null,
    monthly_bill_amount:  raw.monthly_bill_amount || raw.monthlyBill || raw.monthly_bill || raw.electric_bill || null,
    property_type:        raw.property_type || raw.propertyType || null,
    home_ownership:       raw.home_ownership || raw.homeOwnership || raw.ownership || null,
    roof_type:            raw.roof_type || raw.roofType || null,
    utm_source:           raw.utm_source || null,
    utm_medium:           raw.utm_medium || null,
    utm_campaign:         raw.utm_campaign || null,
    utm_content:          raw.utm_content || null,
    utm_term:             raw.utm_term || null,
    gclid:                raw.gclid || null,
    notes:                raw.notes || raw.comments || raw.note || null,
    consent_given:        raw.consent_given || raw.consentGiven || raw.opted_in || raw.optedIn || null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Route handler
// ────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const partnerId = (req.headers.get('x-partner-id') || 'generic').toLowerCase().trim();
  const sigHeader = req.headers.get('x-webhook-signature');
  const idempotencyKeyHeader = req.headers.get('x-idempotency-key') || req.headers.get('x-request-id');

  // Read raw body
  const rawBodyBuffer = Buffer.from(await req.arrayBuffer());
  const rawBodyStr = rawBodyBuffer.toString('utf8');

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBodyStr);
  } catch {
    console.error('[POST /api/intake/webhook/generic] Invalid JSON');
    return NextResponse.json({ received: true, error: 'invalid_json' }, { status: 200 });
  }

  // ── Resolve secret
  const partnerEnvKey = `WEBHOOK_SECRET_${partnerId.toUpperCase().replace(/-/g, '_')}`;
  const secret = process.env[partnerEnvKey] || process.env.WEBHOOK_SECRET_GENERIC;

  // ── Verify signature
  let signatureVerified = false;

  if (secret) {
    if (!sigHeader) {
      // Secret configured but no signature — reject
      console.warn(`[POST /api/intake/webhook/generic] Partner=${partnerId}: secret configured but no X-Webhook-Signature header`);
      return NextResponse.json({ error: 'Unauthorized: missing signature' }, { status: 401 });
    }
    const verResult = verifyGenericWebhook(rawBodyBuffer, sigHeader, secret);
    if (!verResult.verified) {
      console.warn(`[POST /api/intake/webhook/generic] Partner=${partnerId}: signature mismatch`);
      return NextResponse.json({ error: 'Unauthorized: signature mismatch' }, { status: 401 });
    }
    signatureVerified = true;
  } else {
    console.warn(`[POST /api/intake/webhook/generic] Partner=${partnerId}: no secret configured — processing unverified`);
  }

  // ── Idempotency key
  const idempotencyKey = idempotencyKeyHeader
    ? generatePayloadIdempotencyKey({ platform: 'generic', partner_id: partnerId, key: idempotencyKeyHeader })
    : generatePayloadIdempotencyKey({ platform: 'generic', partner_id: partnerId, body });

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
        idempotency_key, platform, partner_id, http_method,
        request_headers, raw_body, parsed_payload,
        signature_header, signature_verified, verification_method,
        status, ip_address
      )
      VALUES (
        ${idempotencyKey}, 'generic', ${partnerId}, 'POST',
        ${JSON.stringify({
          'x-partner-id': partnerId,
          'x-webhook-signature': sigHeader ? '[present]' : null,
          'x-idempotency-key': idempotencyKeyHeader,
        })},
        ${rawBodyStr},
        ${JSON.stringify(body)},
        ${sigHeader ? '[redacted]' : null}, ${signatureVerified}, 'generic_hmac',
        'received', ${ip}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    logId = logRows[0]?.id as string || null;

    if (!logId) {
      return NextResponse.json({
        received: true,
        partner_id: partnerId,
        duplicate_request: true,
        leads_received: 0,
        results: { created: 0, duplicate: 0, error: 0 },
      }, { status: 200 });
    }
  } catch (err) {
    console.error('[POST /api/intake/webhook/generic] Log insert error:', err);
  }

  // ── Extract and process leads
  const rawLeads = extractLeads(body);
  leadsReceived = rawLeads.length;

  for (const rawLead of rawLeads) {
    const normalized = normalizeLead(rawLead as Record<string, unknown>);
    normalized.source_system = partnerId;
    normalized.source_channel = 'partner_webhook';

    try {
      const result = await runIntakePipeline(normalized, {
        source_system: partnerId,
        source_channel: 'partner_webhook',
        webhook_log_id: logId || undefined,
        ip_address: ip || undefined,
      });

      if (result.action === 'created' || result.action === 'duplicate_flagged') leadsCreated++;
      else if (result.action === 'duplicate_blocked') leadesDuplicate++;
      else leadsErrored++;
    } catch (err) {
      console.error(`[POST /api/intake/webhook/generic] Partner=${partnerId} pipeline error:`, err);
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
      console.warn('[POST /api/intake/webhook/generic] Log update error (non-fatal):', err);
    }
  }

  return NextResponse.json({
    received: true,
    partner_id: partnerId,
    leads_received: leadsReceived,
    results: { created: leadsCreated, duplicate: leadesDuplicate, error: leadsErrored },
  }, { status: 200 });
}
