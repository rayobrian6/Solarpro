// ============================================================================
// v47.437 — Admin Webhook Replay
//
// POST /api/admin/survey-webhook-log/:id/replay
//
// Re-runs the ingest pipeline for a previously received webhook delivery.
// Useful for recovering from pipeline failures or re-fetching payload data
// after fixing env vars (e.g. PARTNER_BASE_URL was empty).
//
// Steps:
//   1. Load delivery row from webhook_deliveries
//   2. Parse the raw_body back into a SurveyCompletedEvent envelope
//   3. Re-resolve owner (same logic as the original webhook handler)
//   4. Run runIngestPipeline() with the delivery's original data
//   5. Update webhook_deliveries.status = 'replayed'
// ============================================================================
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { getDbReady, isValidUUID } from '@/lib/db-neon';
import { validateEnvelope } from '@/lib/survey/envelopeValidator';
import { runIngestPipeline } from '@/lib/survey/ingest/ingestPipeline';
import { resolveIngestOwner } from '@/lib/survey/ingest/ownerResolver';
import type { IngestContext } from '@/lib/survey/ingest/types';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const { id } = await ctx.params;
  if (!id || typeof id !== 'string' || !isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid delivery id format.' }, { status: 400 });
  }

  const sql = await getDbReady();

  // ── Load delivery row ──────────────────────────────────────────────────────
  const rows = await sql`
    SELECT id, raw_body, status, event_id, signature_valid
      FROM webhook_deliveries
     WHERE id = ${id}
     LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ success: false, error: 'Delivery not found.' }, { status: 404 });
  }

  const delivery = rows[0] as {
    id: string;
    raw_body: string;
    status: string;
    event_id: string;
    signature_valid: boolean;
  };

  // ── Parse envelope from raw_body ───────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(delivery.raw_body);
  } catch {
    return NextResponse.json(
      { success: false, error: 'raw_body is not valid JSON — cannot replay.' },
      { status: 422 },
    );
  }

  const v = validateEnvelope(parsed);
  if (!v.ok) {
    return NextResponse.json(
      { success: false, error: `Envelope validation failed: ${v.error}` },
      { status: 422 },
    );
  }

  const envelope = v.event;

  // ── Resolve owner ──────────────────────────────────────────────────────────
  const ownerResolution = await resolveIngestOwner(
    envelope.solarpro_user_id    ?? null,
    delivery.id,
    envelope.solarpro_email      ?? null,
    envelope.solarpro_project_id ?? null,
    envelope.inspector_email     ?? null,
    envelope.inspector_name      ?? null,
  );

  if (!ownerResolution) {
    return NextResponse.json(
      { success: false, error: 'Owner resolution failed — SURVEY_INGEST_DEFAULT_USER_ID not configured.' },
      { status: 500 },
    );
  }

  // ── Build ingest context ───────────────────────────────────────────────────
  const ingestContext: IngestContext = {
    event: envelope,
    deliveryId: delivery.id,
    ownerId: ownerResolution.ownerId,
    ownerSource: ownerResolution.ownerSource,
    partnerProjectId: envelope.solarpro_project_id ?? null,
    selectedProjectId: envelope.solarpro_selected_project_id ?? null,
    selectedClientId:  envelope.solarpro_selected_client_id  ?? null,
    receivedAt: new Date().toISOString(),
    traceId: `replay-${delivery.id}`,
  };

  // ── Run ingest pipeline ────────────────────────────────────────────────────
  const ingestResult = await runIngestPipeline(ingestContext);

  // ── Record the real outcome ────────────────────────────────────────────────
  // A failed re-ingest must not be recorded as 'replayed' (that hid the fact the
  // survey was never ingested and made the ops view lie).
  const newStatus = ingestResult.status === 'ingested' ? 'replayed' : 'failed';
  try {
    await sql`
      UPDATE webhook_deliveries
         SET status = ${newStatus}, processed_at = now()
       WHERE id = ${id}
    `;
  } catch {
    // non-fatal
  }

  return NextResponse.json({
    success: ingestResult.status === 'ingested',
    deliveryId: id,
    ingestResult,
  });
}