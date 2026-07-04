/**
 * /api/admin/network/webhooks/route.ts
 *
 * Admin API — Webhook Ingestion Log + Replay
 *
 * GET  — Webhook log with filters:
 *   ?platform=    filter by platform (meta, google, generic)
 *   ?status=      filter by status (received, processed, failed)
 *   ?from=        ISO date range start
 *   ?to=          ISO date range end
 *   ?verified=    boolean filter (true/false)
 *   ?partner_id=  filter by partner ID (for generic)
 *   ?page=        pagination (default 1)
 *   ?limit=       page size (default 25, max 100)
 *
 * POST — Replay webhook:
 *   { log_id } → re-runs raw body through appropriate pipeline
 *   Sets is_replay=true, original_log_id on the new log entry
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';
import { runIntakePipeline } from '@/lib/intake/intakePipeline';
import { generatePayloadIdempotencyKey } from '@/lib/intake/webhookVerifier';
import { neon } from '@neondatabase/serverless';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

// ── GET: Webhook log
export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = await getDbReady();
  const { searchParams } = new URL(req.url);

  const platform = searchParams.get('platform') || null;
  const status = searchParams.get('status') || null;
  const from = searchParams.get('from') || null;
  const to = searchParams.get('to') || null;
  const verified = searchParams.get('verified');  // 'true' | 'false' | null
  const partner_id = searchParams.get('partner_id') || null;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')));
  const offset = (page - 1) * limit;

  const verifiedBool = verified === 'true' ? true : verified === 'false' ? false : null;

  try {
    const logs = await sql`
      SELECT
        wl.id,
        wl.idempotency_key,
        wl.platform,
        wl.partner_id,
        wl.opportunity_id,
        wl.http_method,
        wl.signature_verified,
        wl.verification_method,
        wl.status,
        wl.action,
        wl.processing_error,
        wl.retry_count,
        wl.is_replay,
        wl.original_log_id,
        wl.leads_received,
        wl.leads_created,
        wl.leads_duplicate,
        wl.leads_errored,
        wl.processing_duration_ms,
        wl.ip_address,
        wl.received_at,
        wl.processed_at,
        -- Linked opportunity
        no.first_name,
        no.last_name,
        no.email,
        no.status AS opportunity_status,
        no.opportunity_score
      FROM webhook_ingestion_log wl
      LEFT JOIN network_opportunities no ON no.id = wl.opportunity_id
      WHERE (${platform}::text IS NULL OR wl.platform = ${platform})
        AND (${status}::text IS NULL OR wl.status = ${status})
        AND (${partner_id}::text IS NULL OR wl.partner_id = ${partner_id})
        AND (${from}::text IS NULL OR wl.received_at >= ${from}::timestamptz)
        AND (${to}::text IS NULL OR wl.received_at <= (${to}::text || 'T23:59:59Z')::timestamptz)
        AND (${verifiedBool}::boolean IS NULL OR wl.signature_verified = ${verifiedBool})
      ORDER BY wl.received_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT COUNT(*) AS total
      FROM webhook_ingestion_log wl
      WHERE (${platform}::text IS NULL OR wl.platform = ${platform})
        AND (${status}::text IS NULL OR wl.status = ${status})
        AND (${partner_id}::text IS NULL OR wl.partner_id = ${partner_id})
        AND (${from}::text IS NULL OR wl.received_at >= ${from}::timestamptz)
        AND (${to}::text IS NULL OR wl.received_at <= (${to}::text || 'T23:59:59Z')::timestamptz)
        AND (${verifiedBool}::boolean IS NULL OR wl.signature_verified = ${verifiedBool})
    `;
    const total = Number(countResult[0]?.total) || 0;

    // Aggregate stats (last 7 days)
    const aggStats = await sql`
      SELECT
        COUNT(*) AS total_webhooks,
        COUNT(*) FILTER (WHERE received_at >= CURRENT_DATE) AS today_webhooks,
        COUNT(*) FILTER (WHERE signature_verified = true) AS verified_count,
        COUNT(*) FILTER (WHERE signature_verified = false) AS unverified_count,
        COUNT(*) FILTER (WHERE status = 'processed') AS processed_count,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
        COUNT(*) FILTER (WHERE is_replay = true) AS replay_count,
        SUM(leads_received) AS total_leads_received,
        SUM(leads_created) AS total_leads_created,
        SUM(leads_duplicate) AS total_leads_duplicate,
        SUM(leads_errored) AS total_leads_errored,
        AVG(processing_duration_ms) FILTER (WHERE processing_duration_ms IS NOT NULL) AS avg_processing_ms
      FROM webhook_ingestion_log
      WHERE received_at >= NOW() - INTERVAL '7 days'
    `;

    // Platform breakdown
    const platformBreakdown = await sql`
      SELECT
        platform,
        COUNT(*) AS count,
        SUM(leads_received) AS leads_received,
        SUM(leads_created) AS leads_created,
        COUNT(*) FILTER (WHERE signature_verified = true) AS verified
      FROM webhook_ingestion_log
      WHERE received_at >= NOW() - INTERVAL '30 days'
      GROUP BY platform
      ORDER BY count DESC
    `;

    return NextResponse.json({
      logs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        has_next: offset + limit < total,
        has_prev: page > 1,
      },
      stats: {
        ...(aggStats[0] || {}),
        platform_breakdown: platformBreakdown,
      },
    });
  } catch (err) {
    console.error('[GET /api/admin/network/webhooks] Error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── POST: Replay webhook
export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { log_id } = body as { log_id?: string };
  if (!log_id) {
    return NextResponse.json({ error: 'log_id is required' }, { status: 400 });
  }

  const sql = await getDbReady();

  try {
    // Fetch original log entry
    const logs = await sql`
      SELECT
        id, platform, partner_id, parsed_payload, raw_body,
        signature_verified, status
      FROM webhook_ingestion_log
      WHERE id = ${log_id}
      LIMIT 1
    `;

    const original = logs[0];
    if (!original) {
      return NextResponse.json({ error: 'Log entry not found' }, { status: 404 });
    }

    // Create new idempotency key for replay
    const replayIdempotencyKey = generatePayloadIdempotencyKey({
      replay: true,
      original_log_id: log_id,
      admin_id: admin.id,
      timestamp: Date.now(),
    });

    // Log the replay ingestion
    const sqlDirect = neon(process.env.DATABASE_URL!);
    const newLogRows = await sqlDirect`
      INSERT INTO webhook_ingestion_log (
        idempotency_key, platform, partner_id, http_method,
        request_headers, raw_body, parsed_payload,
        signature_verified, verification_method,
        status, is_replay, original_log_id
      )
      VALUES (
        ${replayIdempotencyKey},
        ${original.platform as string},
        ${original.partner_id as string || null},
        'POST',
        ${JSON.stringify({ 'x-admin-replay': admin.email })},
        ${original.raw_body as string || null},
        ${JSON.stringify(original.parsed_payload)},
        true,
        'admin_replay',
        'received',
        true,
        ${log_id}
      )
      RETURNING id
    `;

    const newLogId = newLogRows[0]?.id as string || null;

    // Re-run the payload through the pipeline
    const payload = original.parsed_payload as Record<string, unknown>;
    const platform = original.platform as string;

    // Extract leads from payload (same logic as webhook routes)
    const leads: Record<string, unknown>[] = [];

    if (platform === 'meta') {
      const entries = (payload.entry as Record<string, unknown>[]) || [];
      for (const entry of entries) {
        const changes = (entry.changes as Record<string, unknown>[]) || [];
        for (const change of changes) {
          const value = (change.value as Record<string, unknown>) || {};
          const fieldData = (value.field_data as Array<{ name: string; values: string[] }>) || [];
          const flat: Record<string, string> = {};
          for (const field of fieldData) {
            flat[field.name] = field.values?.[0] || '';
          }
          leads.push({
            first_name: flat.first_name || null,
            last_name: flat.last_name || null,
            email: flat.email || null,
            phone: flat.phone_number || flat.phone || null,
            address_line1: flat.street_address || null,
            city: flat.city || null,
            state: flat.state || null,
            zip: flat.zip_code || null,
            monthly_bill_amount: flat.monthly_electric_bill || null,
            utm_source: 'facebook',
            utm_medium: 'paid_social',
            source_system: 'meta_lead_ads',
            source_channel: 'paid_social',
          });
        }
      }
    } else if (platform === 'google') {
      const rawLeads = Array.isArray(payload.leads) ? payload.leads as Record<string, unknown>[] : [payload];
      for (const lead of rawLeads) {
        const columnData = (lead.user_column_data as Array<{ column_id: string; string_value?: string }>) || [];
        const flat: Record<string, string> = {};
        for (const col of columnData) {
          flat[col.column_id?.toLowerCase() || ''] = col.string_value || '';
        }
        leads.push({
          first_name: (lead.first_name as string) || flat.first_name || null,
          last_name: (lead.last_name as string) || flat.last_name || null,
          email: (lead.email as string) || flat.email || null,
          phone: (lead.phone as string) || flat.phone_number || null,
          utm_source: 'google',
          utm_medium: 'paid_search',
          source_system: 'google_lead_form',
          source_channel: 'paid_search',
        });
      }
    } else {
      // Generic — flat or leads[]
      const rawLeads = Array.isArray(payload.leads)
        ? payload.leads as Record<string, unknown>[]
        : Array.isArray(payload.data)
          ? payload.data as Record<string, unknown>[]
          : [payload];
      for (const lead of rawLeads) {
        leads.push({
          ...lead,
          source_system: original.partner_id as string || 'generic',
          source_channel: 'partner_webhook',
        });
      }
    }

    let created = 0, duplicate = 0, error = 0;

    for (const lead of leads) {
      try {
        const result = await runIntakePipeline(lead, {
          source_system: platform,
          webhook_log_id: newLogId || undefined,
        });
        if (result.action === 'created' || result.action === 'duplicate_flagged') created++;
        else if (result.action === 'duplicate_blocked') duplicate++;
        else error++;
      } catch (err) {
        console.error('[POST /api/admin/network/webhooks replay] Pipeline error:', err);
        error++;
      }
    }

    // Update new log
    if (newLogId) {
      await sqlDirect`
        UPDATE webhook_ingestion_log
        SET
          status         = 'processed',
          leads_received = ${leads.length},
          leads_created  = ${created},
          leads_duplicate = ${duplicate},
          leads_errored  = ${error},
          processed_at   = NOW()
        WHERE id = ${newLogId}
      `;
    }

    return NextResponse.json({
      replayed: true,
      original_log_id: log_id,
      new_log_id: newLogId,
      platform,
      admin: admin.email,
      leads_processed: leads.length,
      results: { created, duplicate, error },
    });
  } catch (err) {
    console.error('[POST /api/admin/network/webhooks] Error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
