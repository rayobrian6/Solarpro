// ============================================================================
// v47.435 — Capabilities payload builder
//
// Extracted from app/api/system/capabilities/route.ts because Next.js
// disallows non-reserved exports from app/api route files. Pure function,
// deterministic given BUILD_VERSION + contract constants, safe to import
// from tests.
// ============================================================================
import crypto from 'node:crypto';
import { BUILD_VERSION, BUILD_DATE } from '@/lib/version';
import {
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SURVEY_EVENT_TYPES,
  PROJECT_ORIGIN_VALUES,
} from '@/lib/survey/types';
import { TIMESTAMP_TOLERANCE_SECONDS } from '@/lib/survey/verifyWebhookSignature';

/**
 * Pure, deterministic capabilities payload. Same input (BUILD_VERSION +
 * imported contract constants) always produces byte-identical output, so the
 * ETag we derive from it can be used as a strong comparator by partner
 * clients.
 *
 * @param nowIso - Injectable ISO-8601 timestamp for deterministic tests.
 *                 Defaults to `new Date().toISOString()`.
 */
export function buildCapabilitiesPayload(nowIso: string = new Date().toISOString()) {
  return {
    // ── Identity ─────────────────────────────────────────────────────────
    service: 'solarpro',
    producerVersion: BUILD_VERSION,
    buildDate: BUILD_DATE,

    // ── Inbound webhook contract (partner → SolarPro) ────────────────────
    inbound: {
      survey: {
        endpoint: '/api/webhooks/survey-complete',
        method: 'POST',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        supportedSchemaVersions: [CURRENT_SCHEMA_VERSION] as const,
        supportedEventTypes: SUPPORTED_SURVEY_EVENT_TYPES,
        // HMAC wire contract — accepts both partner format (ISO-8601
        // timestamp + 'sha256=' prefix) and legacy format (Unix epoch +
        // raw hex) per v47.434a dual-mode parsing.
        hmac: {
          algorithm: 'sha256',
          signedString: '{timestamp}.{rawBody}',
          headers: {
            signature: 'X-Survey-Signature',
            timestamp: 'X-Survey-Timestamp',
            eventId: 'X-Survey-Event-Id',
          },
          timestampFormats: ['iso-8601', 'unix-epoch-seconds'] as const,
          signatureFormats: ['sha256=<hex>', '<hex>'] as const,
          toleranceSeconds: TIMESTAMP_TOLERANCE_SECONDS,
        },
        idempotencyKey: 'event_id',
        responseContract: {
          onVerified: {
            status: 202,
            // Partner-contract fields present in every 202 body (v47.435+)
            ok: true,
            code: 'ACCEPTED_PRE_INGEST',
            // reason is an internal ops field; two values in v47.435:
            //   'INGEST_OK'              — pipeline ran and project was upserted
            //   'INGEST_FAILED_BUT_LOGGED' — pipeline failed; delivery recorded; replay via v47.437
            reasons: ['INGEST_OK', 'INGEST_FAILED_BUT_LOGGED'] as const,
            eventIdEchoed: true,
          },
          onDuplicate: {
            status: 200,
            // Partner-contract fields present in every 200 body (v47.435+)
            ok: true,
            duplicate: true,
            eventIdEchoed: true,
          },
          onBadSignature: { status: 401 },
          onBadEnvelope: { status: 400 },
          onMisconfigured: { status: 500 },
          producerVersionEchoed: true,
        },
      },
    },

    // ── Outbound (SolarPro → partner) ────────────────────────────────────
    // Deferred to v47.435 (handoff JWT minter) and a later milestone for
    // outbound release/event webhooks. Partner receivers don't exist yet.
    outbound: {
      handoff: {
        status: 'not_yet_implemented',
        planned: 'v47.435 or v47.436',
        expectedContract: {
          algorithm: 'HS256',
          claims: ['jti', 'project_id', 'iat', 'exp'],
          // SECURITY FIX: Removed sharedSecretEnvVar field — env var names must not be disclosed publicly
        },
      },
      releaseWebhook: {
        status: 'not_yet_implemented',
        planned: 'v47.435+ (contract design in v47.435 scoping doc)',
        note: 'Pull-based discovery available today via GET /api/system/release.',
      },
    },

    // ── Feature flags / domain-model snapshots ───────────────────────────
    features: {
      projectOrigins: PROJECT_ORIGIN_VALUES,
      webhookDeliveryStatuses: [
        'received',
        'verified',
        'duplicate',
        'ingested',
        'failed',
        'replayed',
      ] as const,
    },

    // ── Release history discovery ────────────────────────────────────────
    releaseHistoryEndpoint: '/api/system/release',

    // NOTE: generatedAt is excluded from the ETag computation (see
    // buildCapabilitiesEtag) so it does not invalidate the cache on
    // every call.
    generatedAt: nowIso,
  };
}

export type CapabilitiesPayload = ReturnType<typeof buildCapabilitiesPayload>;

/**
 * ETag derived from everything EXCEPT generatedAt. Strong comparator.
 * Partners can use If-None-Match to avoid reprocessing an identical
 * capabilities snapshot.
 */
export function buildCapabilitiesEtag(payload: CapabilitiesPayload): string {
  const { generatedAt: _ignored, ...stable } = payload;
  const json = JSON.stringify(stable);
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  return `"${BUILD_VERSION}-${hash}"`;
}