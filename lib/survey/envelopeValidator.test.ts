// ============================================================================
// v47.434a — Envelope validator tests.
//
// Covers validateEnvelope(). The route itself is integration-tested via
// partnerContract / signature tests; these tests lock envelope semantics in
// isolation.
//
// Key v47.434a behaviour: schemaVersion is OPTIONAL on the wire. Absent is
// accepted and coerced to CURRENT_SCHEMA_VERSION. Present-and-mismatched is
// still rejected (forward-compat signalling preserved).
// ============================================================================

import { describe, it, expect } from 'vitest';
import { validateEnvelope } from './envelopeValidator';
import { CURRENT_SCHEMA_VERSION } from './types';

const BASE_PAYLOAD = {
  event: 'survey.completed',
  event_id: '7c6f2e2e-9b4a-4d1f-8a1c-0123456789ab',
  survey_id: 'a1b2c3d4-5e6f-7890-abcd-ef0123456789',
  completed_at: '2026-04-23T18:25:43.000Z',
};

describe('validateEnvelope — v47.434a', () => {
  // ─── schemaVersion handling ───────────────────────────────────────────

  it('accepts payload WITH schemaVersion 1.0 (legacy / explicit signers)', () => {
    const result = validateEnvelope({
      ...BASE_PAYLOAD,
      schemaVersion: '1.0',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.event.event).toBe('survey.completed');
    }
  });

  it('accepts payload WITHOUT schemaVersion (partner wire format)', () => {
    // Partner's producer at kilby8/site_survey-app omits the field entirely.
    const result = validateEnvelope(BASE_PAYLOAD);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Validator coerces absent schemaVersion to CURRENT_SCHEMA_VERSION —
      // the in-memory SurveyCompletedEvent is always v1.0 in v47.434a.
      expect(result.event.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  it('rejects payload with an unknown schemaVersion string', () => {
    const result = validateEnvelope({
      ...BASE_PAYLOAD,
      schemaVersion: '2.0',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unsupported schemaVersion');
      expect(result.error).toContain('2.0');
    }
  });

  it('rejects payload with a non-string schemaVersion', () => {
    const result = validateEnvelope({
      ...BASE_PAYLOAD,
      schemaVersion: 1.0, // number, not '1.0' string
    });

    expect(result.ok).toBe(false);
  });

  // ─── Partner fat-event tolerance ──────────────────────────────────────

  it("accepts partner's fat payload (extra fields silently dropped)", () => {
    // Exactly what webhookService.ts emits at github.com/kilby8/site_survey-app@2cc3537f
    const partnerPayload = {
      event: 'survey.completed',
      event_id: '7c6f2e2e-9b4a-4d1f-8a1c-0123456789ab',
      occurred_at: '2026-04-23T18:25:43.000Z', // NOT in our spec
      survey_id: 'a1b2c3d4-5e6f-7890-abcd-ef0123456789',
      status: 'submitted', // NOT in our spec
      project_id: '11111111-2222-3333-4444-555555555555', // NOT in our spec
      project_name: 'Smith Residence', // NOT in our spec
      inspector_name: 'Jane Doe', // NOT in our spec
      site_name: '123 Solar Way', // NOT in our spec
      completed_at: '2026-04-23T18:25:43.000Z',
    };

    const result = validateEnvelope(partnerPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.event).toBe('survey.completed');
      expect(result.event.event_id).toBe(partnerPayload.event_id);
      expect(result.event.survey_id).toBe(partnerPayload.survey_id);
      expect(result.event.completed_at).toBe(partnerPayload.completed_at);
      // project_id is still silently dropped (not on SurveyCompletedEvent).
      // project_name and site_name are now first-class fields (promoted so
      // SolarPro can show the human-readable name in degraded mode instead
      // of falling back to "Survey uuid").
      // inspector_name IS a first-class field since commit 47b6784 (F-06b).
      expect('project_id' in result.event).toBe(false);
      expect('project_name' in result.event).toBe(true);    // promoted -- survey name fix
      expect('site_name' in result.event).toBe(true);       // promoted -- survey name fix
      expect('inspector_name' in result.event).toBe(true);  // promoted in F-06b
    }
  });

  // ─── Required-field rejections (regression-locks) ─────────────────────

  it('rejects non-object body', () => {
    expect(validateEnvelope(null).ok).toBe(false);
    expect(validateEnvelope(undefined).ok).toBe(false);
    expect(validateEnvelope('string').ok).toBe(false);
    expect(validateEnvelope(42).ok).toBe(false);
  });

  it('rejects unknown event type', () => {
    const result = validateEnvelope({ ...BASE_PAYLOAD, event: 'survey.canceled' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unsupported event type');
  });

  it('rejects missing / empty event_id', () => {
    expect(validateEnvelope({ ...BASE_PAYLOAD, event_id: '' }).ok).toBe(false);
    expect(validateEnvelope({ ...BASE_PAYLOAD, event_id: undefined }).ok).toBe(false);
    expect(validateEnvelope({ ...BASE_PAYLOAD, event_id: 123 }).ok).toBe(false);
  });

  it('rejects missing / empty survey_id', () => {
    expect(validateEnvelope({ ...BASE_PAYLOAD, survey_id: '' }).ok).toBe(false);
    expect(validateEnvelope({ ...BASE_PAYLOAD, survey_id: undefined }).ok).toBe(false);
  });

  it('rejects missing / empty completed_at', () => {
    expect(validateEnvelope({ ...BASE_PAYLOAD, completed_at: '' }).ok).toBe(false);
    expect(validateEnvelope({ ...BASE_PAYLOAD, completed_at: undefined }).ok).toBe(false);
  });

  it('accepts survey_url when present as string', () => {
    const result = validateEnvelope({
      ...BASE_PAYLOAD,
      survey_url: 'https://survey.example.com/api/surveys/abc',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.survey_url).toBe('https://survey.example.com/api/surveys/abc');
    }
  });

  it('accepts survey_url absent (optional)', () => {
    const result = validateEnvelope(BASE_PAYLOAD);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.survey_url).toBeUndefined();
    }
  });

  it('rejects survey_url with non-string type', () => {
    const result = validateEnvelope({ ...BASE_PAYLOAD, survey_url: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('survey_url');
  });
});