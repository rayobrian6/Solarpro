// ============================================================================
// v47.435 — Survey Ingest: Transform Layer Tests
//
// Tests for the transformer registry, the v1.0 scaffold transformer,
// and the buildTransformSummary helper.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  getTransformer,
  listRegisteredTransformers,
  registerTransformer,
  transform,
  buildTransformSummary,
  type SurveyTransformer,
  type TransformResult,
} from './transformLayer';
import type { TransformInput, IngestContext } from './types';
import type { SurveyCompletedEvent } from '@/lib/survey/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const baseEvent: SurveyCompletedEvent = {
  event: 'survey.completed',
  schemaVersion: '1.0',
  event_id: 'evt-test-001',
  survey_id: 'survey-test-abc',
  completed_at: '2025-04-23T10:00:00.000Z',
};

const baseContext: IngestContext = {
  event: baseEvent,
  deliveryId: 'delivery-test-001',
  ownerId: 'user-owner-test',
  ownerSource: 'default',
  partnerProjectId: null,
  receivedAt: '2025-04-23T10:00:01.000Z',
  traceId: 'delivery-test-001',
};

function makeInput(overrides: Partial<TransformInput> = {}): TransformInput {
  return {
    event: baseEvent,
    rawPayload: null,
    linkResolution: {
      action: 'create',
      surveyExternalId: 'survey-test-abc',
      strategy: 'CREATE_ORPHAN',
    },
    context: baseContext,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Transformer registry
// ---------------------------------------------------------------------------
describe('transformer registry', () => {
  it('v1.0/survey.completed is registered at module load', () => {
    const t = getTransformer('1.0', 'survey.completed');
    expect(t).not.toBeNull();
  });

  it('listRegisteredTransformers includes v1.0::survey.completed', () => {
    const keys = listRegisteredTransformers();
    expect(keys).toContain('1.0::survey.completed');
  });

  it('getTransformer returns null for unknown schema/event', () => {
    expect(getTransformer('9.9', 'survey.completed')).toBeNull();
    expect(getTransformer('1.0', 'survey.unknown')).toBeNull();
    expect(getTransformer('', '')).toBeNull();
  });

  it('registered transformer has correct schemaVersion and eventType', () => {
    const t = getTransformer('1.0', 'survey.completed')!;
    expect(t.schemaVersion).toBe('1.0');
    expect(t.eventType).toBe('survey.completed');
  });

  it('custom transformer can be registered and retrieved', () => {
    const custom: SurveyTransformer = {
      schemaVersion: '1.0' as any,
      eventType: 'survey.completed' as any,
      transform: (_input) => ({
        ok: true,
        output: {
          projectName: 'Custom',
          address: null,
          lat: null,
          lng: null,
          surveyMeta: {},
                    files: [],
          physicalData: null,
        },
      }),
    };
    // Use a fake version to avoid overwriting the real one
    const fakeTransformer: SurveyTransformer = {
      ...custom,
      schemaVersion: '99.0' as any,
      eventType: 'survey.test_only' as any,
    };
    registerTransformer(fakeTransformer);
    expect(getTransformer('99.0', 'survey.test_only')).toBe(fakeTransformer);
  });
});

// ---------------------------------------------------------------------------
// v1.0 transformer — rawPayload=null (v47.435 stub path)
// ---------------------------------------------------------------------------
describe('v1.0 transformer — rawPayload=null (stub path)', () => {
  it('returns ok=true', () => {
    const result = transform(makeInput({ rawPayload: null }));
    expect(result.ok).toBe(true);
  });

  it('projectName defaults to "Survey <survey_id>" when rawPayload=null', () => {
    const result = transform(makeInput({ rawPayload: null }));
    if (result.ok) {
      expect(result.output.projectName).toBe('Survey survey-test-abc');
    }
  });

  it('address is null when rawPayload=null', () => {
    const result = transform(makeInput({ rawPayload: null }));
    if (result.ok) {
      expect(result.output.address).toBeNull();
    }
  });

  it('lat and lng are null when rawPayload=null', () => {
    const result = transform(makeInput({ rawPayload: null }));
    if (result.ok) {
      expect(result.output.lat).toBeNull();
      expect(result.output.lng).toBeNull();
    }
  });

  it('files is empty array when rawPayload=null', () => {
    const result = transform(makeInput({ rawPayload: null }));
    if (result.ok) {
      expect(result.output.files).toEqual([]);
    }
  });

  it('surveyMeta contains ingest provenance fields', () => {
    const result = transform(makeInput({ rawPayload: null }));
    if (result.ok) {
      expect(result.output.surveyMeta).toMatchObject({
        surveyId: 'survey-test-abc',
        completedAt: '2025-04-23T10:00:00.000Z',
        traceId: 'delivery-test-001',
        ingestedAt: '2025-04-23T10:00:01.000Z',
      });
    }
  });

  it('surveyMeta.surveyUrl is null when event.survey_url is absent', () => {
    const result = transform(makeInput({ rawPayload: null }));
    if (result.ok) {
      expect(result.output.surveyMeta.surveyUrl).toBeNull();
    }
  });

  it('surveyMeta.surveyUrl is populated when event.survey_url is present', () => {
    const input = makeInput({
      event: { ...baseEvent, survey_url: 'https://survey.example.com/surveys/abc' },
      rawPayload: null,
    });
    const result = transform(input);
    if (result.ok) {
      expect(result.output.surveyMeta.surveyUrl).toBe('https://survey.example.com/surveys/abc');
    }
  });
});

// ---------------------------------------------------------------------------
// v1.0 transformer — rawPayload present (Q3 scaffold paths)
// ---------------------------------------------------------------------------
describe('v1.0 transformer — rawPayload with known candidate fields', () => {
  it('extracts site_name as projectName when present', () => {
    const result = transform(makeInput({
      rawPayload: { site_name: 'Jones Residence', other: 'ignored' },
    }));
    if (result.ok) {
      expect(result.output.projectName).toBe('Jones Residence');
    }
  });

  it('extracts project_name as projectName when site_name absent', () => {
    const result = transform(makeInput({
      rawPayload: { project_name: 'Smith Solar Install' },
    }));
    if (result.ok) {
      expect(result.output.projectName).toBe('Smith Solar Install');
    }
  });

  it('falls back to "Survey <id>" when no known name field present', () => {
    const result = transform(makeInput({
      rawPayload: { unknown_field: 'value' },
    }));
    if (result.ok) {
      expect(result.output.projectName).toBe('Survey survey-test-abc');
    }
  });

  it('extracts address field', () => {
    const result = transform(makeInput({
      rawPayload: { address: '123 Main St, Springfield, IL 62701' },
    }));
    if (result.ok) {
      expect(result.output.address).toBe('123 Main St, Springfield, IL 62701');
    }
  });

  it('extracts lat and lng as numbers', () => {
    const result = transform(makeInput({
      rawPayload: { lat: 39.7817, lng: -89.6501 },
    }));
    if (result.ok) {
      expect(result.output.lat).toBe(39.7817);
      expect(result.output.lng).toBe(-89.6501);
    }
  });

  it('extracts lat/lng from string values (defensive parsing)', () => {
    const result = transform(makeInput({
      rawPayload: { lat: '40.1234', lng: '-87.5678' },
    }));
    if (result.ok) {
      expect(result.output.lat).toBeCloseTo(40.1234);
      expect(result.output.lng).toBeCloseTo(-87.5678);
    }
  });

  it('ignores non-numeric lat/lng gracefully', () => {
    const result = transform(makeInput({
      rawPayload: { lat: 'not-a-number', lng: null },
    }));
    if (result.ok) {
      expect(result.output.lat).toBeNull();
      expect(result.output.lng).toBeNull();
    }
  });

  it('extracts photos array into files', () => {
    const result = transform(makeInput({
      rawPayload: {
        photos: [
          { id: 'photo-1', url: 'https://example.com/p1.jpg', name: 'roof-front.jpg' },
          { id: 'photo-2', url: 'https://example.com/p2.jpg', name: 'roof-side.jpg' },
        ],
      },
    }));
    if (result.ok) {
      expect(result.output.files).toHaveLength(2);
      expect(result.output.files[0].externalId).toBe('photo-1');
      expect(result.output.files[0].url).toBe('https://example.com/p1.jpg');
      expect(result.output.files[0].name).toBe('roof-front.jpg');
    }
  });

  it('generates fallback externalId when photo has no id', () => {
    const result = transform(makeInput({
      rawPayload: {
        photos: [{ url: 'https://example.com/img.jpg' }],
      },
    }));
    if (result.ok) {
      expect(result.output.files[0].externalId).toContain('survey-test-abc');
    }
  });

  it('skips photo entries with no url', () => {
    const result = transform(makeInput({
      rawPayload: {
        photos: [
          { id: 'photo-1', url: 'https://example.com/p1.jpg' },
          { id: 'photo-no-url' },
        ],
      },
    }));
    if (result.ok) {
      expect(result.output.files).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// transform() wrapper — unknown schema/event returns error
// ---------------------------------------------------------------------------
describe('transform() — unknown transformer', () => {
  it('returns ok=false for unregistered schema version', () => {
    const input = makeInput({
      event: { ...baseEvent, schemaVersion: '99.0' as any },
    });
    const result = transform(input);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toContain('No transformer registered');
    }
  });
});

// ---------------------------------------------------------------------------
// buildTransformSummary
// ---------------------------------------------------------------------------
describe('buildTransformSummary', () => {
  it('reflects projectName', () => {
    const output = {
      projectName: 'Test Project',
      address: null,
      lat: null,
      lng: null,
      surveyMeta: {},
      files: [],
      physicalData: null,
    };
    const summary = buildTransformSummary(output);
    expect(summary.projectName).toBe('Test Project');
  });

  it('hasAddress=false when address is null', () => {
    const output = {
      projectName: 'P', address: null, lat: null, lng: null,
      surveyMeta: {}, files: [],
      physicalData: null,
    };
    expect(buildTransformSummary(output).hasAddress).toBe(false);
  });

  it('hasAddress=true when address is non-null', () => {
    const output = {
      projectName: 'P', address: '123 Main St', lat: null, lng: null,
      surveyMeta: {}, files: [],
      physicalData: null,
    };
    expect(buildTransformSummary(output).hasAddress).toBe(true);
  });

  it('fileCount matches files array length', () => {
    const output = {
      projectName: 'P', address: null, lat: null, lng: null,
      surveyMeta: {},
      files: [
        { externalId: 'f1', name: 'a.jpg', url: 'http://x.com/a.jpg', mimeType: 'image/jpeg' },
        { externalId: 'f2', name: 'b.jpg', url: 'http://x.com/b.jpg', mimeType: 'image/jpeg' },
      ],
      physicalData: null,
    };
    expect(buildTransformSummary(output).fileCount).toBe(2);
  });

  it('hasSurveyMeta=false when surveyMeta is empty', () => {
    const output = {
      projectName: 'P', address: null, lat: null, lng: null,
      surveyMeta: {}, files: [],
      physicalData: null,
    };
    expect(buildTransformSummary(output).hasSurveyMeta).toBe(false);
  });

  it('hasSurveyMeta=true when surveyMeta has keys', () => {
    const output = {
      projectName: 'P', address: null, lat: null, lng: null,
      surveyMeta: { traceId: 'x' }, files: [],
      physicalData: null,
    };
    expect(buildTransformSummary(output).hasSurveyMeta).toBe(true);
  });
});