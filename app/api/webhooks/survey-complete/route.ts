// ============================================================================
// v47.435 Stage 9.2 — Inbound Survey Webhook Endpoint
//
// Receives survey.completed notifications from the in-house survey tool.
//
// Flow:
//   1. Read raw body (must match signed bytes exactly).
//   2. Verify HMAC signature against SURVEY_WEBHOOK_SECRET.
//   3. Parse + validate envelope shape.
//   4. Check webhook_deliveries for duplicate event_id → 200 no-op if seen.
//   5. Insert webhook_deliveries row with status='verified'.
//   6. Build IngestContext and call runIngestPipeline().
//   7. Return 202 Accepted with ingest result (success or failed-but-logged).
//
// v47.435 PIPELINE STATE:
//   - payload fetch (Step C) is a stub: rawPayload=null (blocked on Q2).
//   - field mapping is a scaffold (blocked on Q3).
//   - project upsert is LIVE: creates real projects with origin='survey'.
//
// v47.436+: async photo fetch worker, handoff JWT minter.
// ============================================================================
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { BUILD_VERSION } from '@/lib/version';
import {
  verifyWebhookSignature,
  TIMESTAMP_TOLERANCE_SECONDS,
} from '@/lib/survey/verifyWebhookSignature';
import {
  CURRENT_SCHEMA_VERSION,
  type SurveyCompletedEvent,
} from '@/lib/survey/types';
import { validateEnvelope } from '@/lib/survey/envelopeValidator';
import { runIngestPipeline } from '@/lib/survey/ingest/ingestPipeline';
import type { IngestContext } from '@/lib/survey/ingest/types';
import { resolveIngestOwner } from '@/lib/survey/ingest/ownerResolver';

export async function POST(req: NextRequest) {
  const secret = process.env.SURVEY_WEBHOOK_SECRET;
  if (!secret) {
    // Missing secret = server misconfiguration; return 500 without any DB side-effect.
    // Never leak whether the secret is missing vs. invalid to the caller.
    console.error('[webhook:survey-complete] SURVEY_WEBHOOK_SECRET is not configured');
    return NextResponse.json(
      { success: false, error: 'Webhook receiver not configured', producerVersion: BUILD_VERSION },
      { status: 500 },
    );
  }

  // ── Read raw body (bytes-exact for HMAC) ───────────────────────────────
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Could not read request body', producerVersion: BUILD_VERSION },
      { status: 400 },
    );
  }

  const signatureHeader = req.headers.get('x-survey-signature');
  const timestampHeader = req.headers.get('x-survey-timestamp');
  const eventIdHeader = req.headers.get('x-survey-event-id');

  // ── HMAC verification ──────────────────────────────────────────────────
  const sigResult = verifyWebhookSignature({
    rawBody,
    signatureHeader,
    timestampHeader,
    secret,
  });

  // ── DB handle (needed for both valid and invalid paths: we log everything) ─
  let sql;
  try {
    sql = await getDbReady();
  } catch (err) {
    return handleRouteDbError('[POST /api/webhooks/survey-complete]', err);
  }

  // ── Parse envelope (only attempted if signature is valid; otherwise we log raw) ─
  let envelope: SurveyCompletedEvent | null = null;
  let envelopeError: string | null = null;

  if (sigResult.valid) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      envelopeError = 'Body is not valid JSON';
    }
    if (!envelopeError) {
      const v = validateEnvelope(parsed);
      if (v.ok) {
        envelope = v.event;
      } else {
        envelopeError = v.error;
      }
    }
  }

  // ── Idempotency check (only meaningful when we have a verified event_id) ─
  // Prefer event_id from envelope; fall back to X-Survey-Event-Id header if present.
  const effectiveEventId = envelope?.event_id ?? eventIdHeader ?? null;

  if (sigResult.valid && envelope && effectiveEventId) {
    try {
      const existing = await sql`
        SELECT id, status FROM webhook_deliveries
         WHERE source = 'survey' AND event_id = ${effectiveEventId}
         LIMIT 1
      `;
      if (existing.length > 0) {
        // Duplicate delivery — record nothing new, return 200 no-op.
        // Survey backend will mark this delivered and stop retrying.
        return NextResponse.json(
          {
            // Partner-contract fields (v47.435)
            ok: true,
            duplicate: true,
            event_id: effectiveEventId,
            // Extended fields for internal ops
            success: true,
            data: {
              duplicate: true,
              existingDeliveryId: existing[0].id,
              existingStatus: existing[0].status,
            },
            producerVersion: BUILD_VERSION,
          },
          { status: 200 },
        );
      }
    } catch (err) {
      return handleRouteDbError('[POST /api/webhooks/survey-complete:idempotency]', err);
    }
  }

  // ── Record delivery (valid or invalid — ops needs to see both) ────────
  const deliveryStatus: 'verified' | 'failed' = sigResult.valid && envelope ? 'verified' : 'failed';
  const deliveryError: string | null = !sigResult.valid
    ? `HMAC verification failed: ${sigResult.reason ?? 'unknown'}`
    : envelopeError;

  // For the log row we need SOMETHING as event_id even when unverified, so
  // downstream queries on webhook_deliveries don't fail. We use the header
  // if present, else a synthetic marker. The (source, event_id) unique-ish
  // pattern is NOT enforced as a DB UNIQUE to allow logging repeated failures.
  const logEventId = effectiveEventId ?? `unverified-${Date.now()}`;
  const logEventType = envelope?.event ?? 'survey.completed'; // best guess; we know only survey.completed is valid in v1

  let deliveryId: string;
  try {
    const rows = await sql`
      INSERT INTO webhook_deliveries (
        source, event_type, event_id,
        signature_header, timestamp_header, signature_valid,
        raw_body, status, error_message, processed_at
      ) VALUES (
        'survey', ${logEventType}, ${logEventId},
        ${signatureHeader}, ${timestampHeader}, ${sigResult.valid},
        ${rawBody}, ${deliveryStatus}, ${deliveryError}, now()
      )
      RETURNING id
    `;
    deliveryId = rows[0].id;
  } catch (err) {
    return handleRouteDbError('[POST /api/webhooks/survey-complete:log]', err);
  }

  // ── Terminal responses ─────────────────────────────────────────────────
  if (!sigResult.valid) {
    return NextResponse.json(
      {
        success: false,
        error: 'Signature verification failed',
        reason: sigResult.reason,
        deliveryId,
        producerVersion: BUILD_VERSION,
      },
      { status: 401 },
    );
  }

  if (!envelope) {
    return NextResponse.json(
      {
        success: false,
        error: envelopeError ?? 'Envelope invalid',
        deliveryId,
        producerVersion: BUILD_VERSION,
      },
      { status: 400 },
    );
  }

  // v47.435 — Run the ingest pipeline.
  //
  // The pipeline is called synchronously on the request path. It:
  //   A. Validates context (ownerId present)
  //   B. Resolves project link (Q8 strategy via SURVEY_PROJECT_LINK_STRATEGY env)
  //   C. Fetches full payload (STUB — rawPayload=null, blocked on Q2)
  //   D. Transforms (scaffold — field mapping blocked on Q3)
  //   E. Upserts project + files to DB
  //   F. Updates webhook_deliveries.status to 'ingested' or 'failed'
  //
  // The route ALWAYS returns 202 Accepted on this path (HMAC + envelope were valid).
  // Pipeline errors are surfaced in the response body for partner logging but do
  // NOT change the HTTP status — the delivery has been accepted and logged.
  // Partner's retry queue should NOT retry on pipeline-only failures (the
  // delivery is recorded; a replay via v47.437 is the recovery path).
  // -- F-06: Resolve owner from payload claims, fallback to default user --------
  // resolveIngestOwner() checks solarpro_user_id from the envelope against
  // the SolarPro users table.  Falls back to SURVEY_INGEST_DEFAULT_USER_ID
  // if the claim is absent, invalid, or the user no longer exists.
  // Returns null only if BOTH paths fail (claim invalid + default missing),
  // in which case we return 500 so the partner retries.
  const ownerResolution = await resolveIngestOwner(
    envelope.solarpro_user_id ?? null,
    deliveryId,
  );

  if (!ownerResolution) {
    console.error(
      '[webhook:survey-complete] Owner resolution failed — no solarpro_user_id claim ' +
      'and SURVEY_INGEST_DEFAULT_USER_ID is not configured. ' +
      'Returning 500 so partner retries.',
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Webhook receiver not configured',
        producerVersion: BUILD_VERSION,
      },
      { status: 500 },
    );
  }

  const ingestContext: IngestContext = {
    event: envelope,
    deliveryId,
    ownerId: ownerResolution.ownerId,
    ownerSource: ownerResolution.ownerSource,
    partnerProjectId: envelope.solarpro_project_id ?? null,
    receivedAt: new Date().toISOString(),
    traceId: deliveryId,
  };

  const ingestResult = await runIngestPipeline(ingestContext);

  if (ingestResult.status === 'ingested') {
    return NextResponse.json(
      {
        // Partner-contract fields (v47.435)
        ok: true,
        code: 'ACCEPTED_PRE_INGEST',
        event_id: envelope.event_id,
        // Extended fields for internal ops
        success: true,
        accepted: true,
        reason: 'INGEST_OK',
        deliveryId,
        projectId: ingestResult.projectId,
        created: ingestResult.created,
        transformSummary: ingestResult.transformSummary,
        event: {
          event_id: envelope.event_id,
          survey_id: envelope.survey_id,
          completed_at: envelope.completed_at,
        },
        schemaVersion: CURRENT_SCHEMA_VERSION,
        toleranceSeconds: TIMESTAMP_TOLERANCE_SECONDS,
        producerVersion: BUILD_VERSION,
      },
      { status: 202 },
    );
  }

  // Pipeline failed — still return 202 (delivery was accepted + logged).
  // Partner should NOT retry; ops can replay via v47.437.
  return NextResponse.json(
    {
      // Partner-contract fields (v47.435)
      // code is ACCEPTED_PRE_INGEST even on pipeline failure: the delivery
      // was accepted and logged; ingest is async from the partner's perspective.
      ok: true,
      code: 'ACCEPTED_PRE_INGEST',
      event_id: envelope.event_id,
      // Extended fields for internal ops
      success: true,
      accepted: true,
      reason: 'INGEST_FAILED_BUT_LOGGED',
      deliveryId,
      ingestError: ingestResult.error,
      ingestErrorCode: ingestResult.code,
      event: {
        event_id: envelope.event_id,
        survey_id: envelope.survey_id,
        completed_at: envelope.completed_at,
      },
      note: 'Delivery has been logged. Ingest pipeline failed — replay via POST /api/admin/survey-webhook-log/:id/replay (v47.437).',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      toleranceSeconds: TIMESTAMP_TOLERANCE_SECONDS,
      producerVersion: BUILD_VERSION,
    },
    { status: 202 },
  );
}