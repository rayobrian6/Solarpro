// ============================================================================
// v47.434c — Capabilities payload + ETag drift-guard tests
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  buildCapabilitiesPayload,
  buildCapabilitiesEtag,
} from './capabilities';
import { BUILD_VERSION, BUILD_DATE } from '@/lib/version';
import {
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SURVEY_EVENT_TYPES,
  PROJECT_ORIGIN_VALUES,
} from '@/lib/survey/types';
import { TIMESTAMP_TOLERANCE_SECONDS } from '@/lib/survey/verifyWebhookSignature';

describe('v47.434c — buildCapabilitiesPayload', () => {
  const FIXED_NOW = '2026-04-23T18:00:00.000Z';

  it('identity block reflects BUILD_VERSION / BUILD_DATE from lib/version.ts', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.service).toBe('solarpro');
    expect(p.producerVersion).toBe(BUILD_VERSION);
    expect(p.buildDate).toBe(BUILD_DATE);
  });

  it('producerVersion value is the current release tag (not a hardcoded string)', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    // This also guards against someone accidentally typo-ing BUILD_VERSION
    // back to a prior version in the capabilities payload only.
    expect(p.producerVersion).toMatch(/^v\d+\.\d+[a-z]?$/);
    expect(p.producerVersion).toBe(BUILD_VERSION);
  });

  it('inbound.survey.endpoint matches the actual route path', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.inbound.survey.endpoint).toBe('/api/webhooks/survey-complete');
    expect(p.inbound.survey.method).toBe('POST');
  });

  it('inbound.survey.schemaVersion === CURRENT_SCHEMA_VERSION from types.ts', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.inbound.survey.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(p.inbound.survey.supportedSchemaVersions).toEqual([CURRENT_SCHEMA_VERSION]);
  });

  it('inbound.survey.supportedEventTypes === SUPPORTED_SURVEY_EVENT_TYPES', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.inbound.survey.supportedEventTypes).toEqual(SUPPORTED_SURVEY_EVENT_TYPES);
  });

  it('HMAC contract exposes both partner and legacy timestamp formats', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.inbound.survey.hmac.algorithm).toBe('sha256');
    expect(p.inbound.survey.hmac.signedString).toBe('{timestamp}.{rawBody}');
    expect(p.inbound.survey.hmac.timestampFormats).toContain('iso-8601');
    expect(p.inbound.survey.hmac.timestampFormats).toContain('unix-epoch-seconds');
    expect(p.inbound.survey.hmac.signatureFormats).toContain('sha256=<hex>');
    expect(p.inbound.survey.hmac.signatureFormats).toContain('<hex>');
  });

  it('HMAC tolerance === TIMESTAMP_TOLERANCE_SECONDS from verifier module', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.inbound.survey.hmac.toleranceSeconds).toBe(TIMESTAMP_TOLERANCE_SECONDS);
  });

  it('HMAC header names match what the route actually reads', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.inbound.survey.hmac.headers.signature).toBe('X-Survey-Signature');
    expect(p.inbound.survey.hmac.headers.timestamp).toBe('X-Survey-Timestamp');
    expect(p.inbound.survey.hmac.headers.eventId).toBe('X-Survey-Event-Id');
  });

  it('responseContract locks the v47.435 202 + partner-contract fields + producerVersion-echoed invariant', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    // 202 verified path
    expect(p.inbound.survey.responseContract.onVerified.status).toBe(202);
    expect(p.inbound.survey.responseContract.onVerified.ok).toBe(true);
    expect(p.inbound.survey.responseContract.onVerified.code).toBe('ACCEPTED_PRE_INGEST');
    expect(p.inbound.survey.responseContract.onVerified.eventIdEchoed).toBe(true);
    // reasons array (internal ops field; two values in v47.435)
    expect(p.inbound.survey.responseContract.onVerified.reasons).toContain('INGEST_OK');
    expect(p.inbound.survey.responseContract.onVerified.reasons).toContain('INGEST_FAILED_BUT_LOGGED');
    // Stale stub is gone
    expect(p.inbound.survey.responseContract.onVerified.reasons).not.toContain('INGEST_NOT_IMPLEMENTED_BUT_LOGGED');
    // 200 duplicate path
    expect(p.inbound.survey.responseContract.onDuplicate.status).toBe(200);
    expect(p.inbound.survey.responseContract.onDuplicate.ok).toBe(true);
    expect(p.inbound.survey.responseContract.onDuplicate.duplicate).toBe(true);
    expect(p.inbound.survey.responseContract.onDuplicate.eventIdEchoed).toBe(true);
    // error paths
    expect(p.inbound.survey.responseContract.onBadSignature.status).toBe(401);
    expect(p.inbound.survey.responseContract.onBadEnvelope.status).toBe(400);
    expect(p.inbound.survey.responseContract.onMisconfigured.status).toBe(500);
    expect(p.inbound.survey.responseContract.producerVersionEchoed).toBe(true);
  });

  it('idempotencyKey is event_id (matches webhook_deliveries dedupe)', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.inbound.survey.idempotencyKey).toBe('event_id');
  });

  it('outbound handoff + releaseWebhook advertised as not_yet_implemented', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.outbound.handoff.status).toBe('not_yet_implemented');
    expect(p.outbound.handoff.expectedContract.algorithm).toBe('HS256');
    // SECURITY: sharedSecretEnvVar intentionally NOT exposed on capabilities payload
    // (env var names must not be disclosed publicly). See capabilities.ts line 95.
    expect(
      (p.outbound.handoff.expectedContract as { sharedSecretEnvVar?: string }).sharedSecretEnvVar,
    ).toBeUndefined();
    expect(p.outbound.handoff.expectedContract.claims).toContain('jti');
    expect(p.outbound.handoff.expectedContract.claims).toContain('project_id');
    expect(p.outbound.releaseWebhook.status).toBe('not_yet_implemented');
  });

  it('features.projectOrigins === PROJECT_ORIGIN_VALUES registry constant', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.features.projectOrigins).toEqual(PROJECT_ORIGIN_VALUES);
  });

  it('features.webhookDeliveryStatuses contains the 6-member status union', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.features.webhookDeliveryStatuses).toEqual([
      'received',
      'verified',
      'duplicate',
      'ingested',
      'failed',
      'replayed',
    ]);
  });

  it('releaseHistoryEndpoint points at the companion route', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.releaseHistoryEndpoint).toBe('/api/system/release');
  });

  it('generatedAt is ISO-8601 (passed through uninspected)', () => {
    const p = buildCapabilitiesPayload(FIXED_NOW);
    expect(p.generatedAt).toBe(FIXED_NOW);
  });

  it('payload shape is deterministic modulo generatedAt', () => {
    const a = buildCapabilitiesPayload('2026-01-01T00:00:00.000Z');
    const b = buildCapabilitiesPayload('2099-12-31T23:59:59.999Z');
    // Strip generatedAt and serialise — must be byte-identical.
    const stripped = (p: ReturnType<typeof buildCapabilitiesPayload>) => {
      const { generatedAt: _, ...rest } = p;
      return JSON.stringify(rest);
    };
    expect(stripped(a)).toBe(stripped(b));
  });
});

describe('v47.434c — buildCapabilitiesEtag', () => {
  it('ETag is stable across calls when contract is unchanged', () => {
    const a = buildCapabilitiesPayload('2026-01-01T00:00:00.000Z');
    const b = buildCapabilitiesPayload('2099-12-31T23:59:59.999Z');
    expect(buildCapabilitiesEtag(a)).toBe(buildCapabilitiesEtag(b));
  });

  it('ETag is a quoted string containing BUILD_VERSION', () => {
    const p = buildCapabilitiesPayload();
    const tag = buildCapabilitiesEtag(p);
    expect(tag.startsWith('"')).toBe(true);
    expect(tag.endsWith('"')).toBe(true);
    expect(tag.includes(BUILD_VERSION)).toBe(true);
  });

  it('ETag hash portion is 16 hex characters (sha256 truncated)', () => {
    const p = buildCapabilitiesPayload();
    const tag = buildCapabilitiesEtag(p);
    // "vX.Y...-<16hex>"
    const hashPart = tag.replace(/^"/, '').replace(/"$/, '').split('-').pop() ?? '';
    expect(hashPart).toMatch(/^[0-9a-f]{16}$/);
  });
});