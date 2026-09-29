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

  // ── SURVEY_WEBHOOK_RECEIVED ────────────────────────────────────────────────
  // Emitted on every inbound call BEFORE signature check so we can prove
  // the payload reached SolarPro regardless of what happens next.
  // Search Vercel logs for: SURVEY_WEBHOOK_RECEIVED
  console.info(
    JSON.stringify({
      tag:          'SURVEY_WEBHOOK_RECEIVED',
      timestamp:    new Date().toISOString(),
      eventId:      eventIdHeader ?? null,
      hasSignature: Boolean(signatureHeader),
      hasTimestamp: Boolean(timestampHeader),
      bodyLength:   rawBody.length,
    }),
  );

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

  // ── Idempotency: ONE event, claimed only by a delivery that can be processed ─
  //
  // 🚨 A FAILED ATTEMPT MUST NOT CONSUME THE EVENT. The duplicate lookup used to
  // match ANY row with this event_id — including a delivery that failed the
  // HMAC check (wrong secret, clock skew) or the envelope validation. The
  // correctly signed retry then got 200 "duplicate", the app backend marked the
  // event delivered, and the survey was never ingested. Nothing on either side
  // could recover it short of the admin replay route.
  //
  // The rule now:
  //   · an UNSIGNED delivery is logged (signature_valid = false) and never
  //     claims the event — migration 014's unique index excludes those rows too;
  //   · a signed delivery whose ENVELOPE is invalid is logged and never claims
  //     it either;
  //   · a signed, valid delivery claims it. The event is a DUPLICATE only when a
  //     signed delivery for it has been ingested/replayed, or is being processed
  //     right now. A signed delivery that FAILED (validation or ingest), or one
  //     abandoned mid-flight, is taken over by the retry — the SAME row, by an
  //     atomic compare-and-set, because migration 014 allows one signature-valid
  //     row per event.
  const effectiveEventId = envelope?.event_id ?? eventIdHeader ?? null;

  const duplicateResponse = (existing: { id: string; status: string }) =>
    NextResponse.json(
      {
        // Partner-contract fields (v47.435)
        ok: true,
        duplicate: true,
        event_id: effectiveEventId,
        // Extended fields for internal ops
        success: true,
        data: {
          duplicate: true,
          existingDeliveryId: existing.id,
          existingStatus: existing.status,
        },
        producerVersion: BUILD_VERSION,
      },
      { status: 200 },
    );

  const deliveryError: string | null = !sigResult.valid
    ? `HMAC verification failed: ${sigResult.reason ?? 'unknown'}`
    : envelopeError;
  // For the log row we need SOMETHING as event_id even when unverified, so
  // downstream queries on webhook_deliveries don't fail. We use the header
  // if present, else a synthetic marker.
  const logEventId = effectiveEventId ?? `unverified-${Date.now()}`;
  const logEventType = envelope?.event ?? 'survey.completed'; // best guess; we know only survey.completed is valid in v1

  let deliveryId: string;

  if (sigResult.valid && envelope && effectiveEventId) {
    try {
      const existing = await sql`
        SELECT id, status, processed_at, received_at FROM webhook_deliveries
         WHERE source = 'survey' AND event_id = ${effectiveEventId}
           AND signature_valid = true
         ORDER BY received_at DESC
         LIMIT 1
      `;
      if (existing.length > 0) {
        const row = existing[0] as { id: string; status: string; processed_at: unknown; received_at: unknown };
        if (!isReclaimableDelivery(row)) return duplicateResponse(row);
        // Take the failed / abandoned row over. Conditional on the state that
        // was read, so of two concurrent retries exactly one proceeds.
        const claimed = await sql`
          UPDATE webhook_deliveries
             SET status           = 'verified',
                 event_type       = ${logEventType},
                 signature_header = ${signatureHeader},
                 timestamp_header = ${timestampHeader},
                 raw_body         = ${rawBody},
                 error_message    = NULL,
                 processed_at     = now()
           WHERE id = ${row.id}
             AND status = ${row.status}
             -- Millisecond precision: the driver hands timestamptz back as a JS
             -- Date (ms), the column holds µs. Same idiom as the layout claim.
             AND date_trunc('milliseconds', processed_at)
                 IS NOT DISTINCT FROM date_trunc('milliseconds', ${isoOrNull(row.processed_at)}::timestamptz)
           RETURNING id
        `;
        if (claimed.length === 0) return duplicateResponse(row);
        deliveryId = claimed[0].id;
      } else {
        try {
          const rows = await sql`
            INSERT INTO webhook_deliveries (
              source, event_type, event_id,
              signature_header, timestamp_header, signature_valid,
              raw_body, status, error_message, processed_at
            ) VALUES (
              'survey', ${logEventType}, ${effectiveEventId},
              ${signatureHeader}, ${timestampHeader}, true,
              ${rawBody}, 'verified', NULL, now()
            )
            RETURNING id
          `;
          deliveryId = rows[0].id;
        } catch (err) {
          // Migration 014: another signed delivery of this event was recorded
          // between our read and our write — it owns the event.
          if (isUniqueViolation(err)) {
            return duplicateResponse({ id: 'concurrent', status: 'verified' });
          }
          throw err;
        }
      }
    } catch (err) {
      return handleRouteDbError('[POST /api/webhooks/survey-complete:claim]', err);
    }
  } else {
    // ── Record a delivery that cannot be processed (ops needs to see it) ───
    // It claims nothing. A SIGNED one (bad envelope) is signature_valid = true,
    // so it can only be logged while no signed row holds the event; a
    // collision is reported in the log, not turned into a 5xx retry loop.
    try {
      const rows = await sql`
        INSERT INTO webhook_deliveries (
          source, event_type, event_id,
          signature_header, timestamp_header, signature_valid,
          raw_body, status, error_message, processed_at
        ) VALUES (
          'survey', ${logEventType}, ${logEventId},
          ${signatureHeader}, ${timestampHeader}, ${sigResult.valid},
          ${rawBody}, 'failed', ${deliveryError}, now()
        )
        RETURNING id
      `;
      deliveryId = rows[0].id;
    } catch (err) {
      if (!isUniqueViolation(err)) {
        return handleRouteDbError('[POST /api/webhooks/survey-complete:log]', err);
      }
      console.warn('[webhook:survey-complete] rejected delivery not logged — a signed delivery already holds event',
        logEventId, '—', deliveryError);
      deliveryId = 'not-logged';
    }
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
    envelope.solarpro_user_id    ?? null,
    deliveryId,
    envelope.solarpro_email      ?? null,
    envelope.solarpro_project_id ?? null,
    envelope.inspector_email     ?? null,
    envelope.inspector_name      ?? null,
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
    // v47.438: on-device picker selections from standalone surveys.
    // These are forwarded by /api/survey/submit from the SurveyV2Payload.
    // Null for all PM-initiated surveys (where partnerProjectId is set instead).
    selectedProjectId: envelope.solarpro_selected_project_id ?? null,
    selectedClientId:  envelope.solarpro_selected_client_id  ?? null,
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

/**
 * May a signed retry take this signature-valid delivery row over?
 *   · 'failed'   — validation or ingest failed: yes, reprocess (ingest is
 *                  idempotent: attach is update-only, file inserts are
 *                  ON CONFLICT DO NOTHING);
 *   · 'verified' — being processed: only once it is older than the in-flight
 *                  window (this route's maxDuration is 30 s), i.e. abandoned;
 *   · anything else ('ingested', 'replayed', 'duplicate', unknown) — no: the
 *     event was delivered, and a retry is a true duplicate.
 */
const IN_FLIGHT_WINDOW_MS = 5 * 60 * 1000;
function isReclaimableDelivery(row: { status: string; processed_at: unknown; received_at: unknown }): boolean {
  if (row.status === 'failed') return true;
  if (row.status !== 'verified') return false;
  const at = row.processed_at ?? row.received_at;
  const ms = at instanceof Date ? at.getTime() : Date.parse(String(at ?? ''));
  return Number.isFinite(ms) && Date.now() - ms > IN_FLIGHT_WINDOW_MS;
}

function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === '23505' || /duplicate key value violates unique constraint/i.test(String(e?.message ?? ''));
}