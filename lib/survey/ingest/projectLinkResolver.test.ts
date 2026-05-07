// ============================================================================
// v47.440 — Survey Ingest: Project Link Resolver Tests
//
// Tests for resolveProjectLink().
// No DB interaction — the resolver is pure with respect to the DB.
//
// v47.440 change: resolver no longer accepts a strategy argument.
// Auto-create is BANNED. Only 'attach' and 'resolve_existing' actions are valid.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { resolveProjectLink } from './projectLinkResolver';
import type { IngestContext } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeContext(overrides: Partial<IngestContext> = {}): IngestContext {
  return {
    event: {
      event: 'survey.completed',
      schemaVersion: '1.0',
      event_id: 'evt-001',
      survey_id: 'survey-abc-123',
      completed_at: '2025-04-23T10:00:00.000Z',
    },
    deliveryId: 'delivery-001',
    ownerId: 'user-owner-001',
    ownerSource: 'default',
    partnerProjectId: null,
    selectedProjectId: null,
    selectedClientId: null,
    receivedAt: '2025-04-23T10:00:01.000Z',
    traceId: 'delivery-001',
    ...overrides,
  };
}

const VALID_UUID = '11111111-1111-4111-a111-111111111111';
const VALID_UUID_2 = '22222222-2222-4222-a222-222222222222';
const VALID_CLIENT_UUID = '33333333-3333-4333-a333-333333333333';

// ---------------------------------------------------------------------------
// Priority 1: selectedProjectId (on-device picker)
// ---------------------------------------------------------------------------
describe('resolveProjectLink — Priority 1: selectedProjectId', () => {
  it('returns action=attach method=selected_project when selectedProjectId is a valid UUID', () => {
    const ctx = makeContext({ selectedProjectId: VALID_UUID });
    const result = resolveProjectLink(ctx);
    expect(result.action).toBe('attach');
    if (result.action === 'attach') {
      expect(result.projectId).toBe(VALID_UUID);
      expect(result.method).toBe('selected_project');
    }
  });

  it('ignores selectedProjectId if it is not a valid UUID', () => {
    const ctx = makeContext({ selectedProjectId: 'not-a-uuid', partnerProjectId: VALID_UUID });
    const result = resolveProjectLink(ctx);
    // Falls through to Priority 2 (partnerProjectId)
    expect(result.action).toBe('attach');
    if (result.action === 'attach') {
      expect(result.projectId).toBe(VALID_UUID);
      expect(result.method).toBe('direct_id');
    }
  });

  it('selectedProjectId takes priority over partnerProjectId', () => {
    const ctx = makeContext({ selectedProjectId: VALID_UUID, partnerProjectId: VALID_UUID_2 });
    const result = resolveProjectLink(ctx);
    expect(result.action).toBe('attach');
    if (result.action === 'attach') {
      expect(result.projectId).toBe(VALID_UUID);
      expect(result.method).toBe('selected_project');
    }
  });
});

// ---------------------------------------------------------------------------
// Priority 2: partnerProjectId (JWT handoff)
// ---------------------------------------------------------------------------
describe('resolveProjectLink — Priority 2: partnerProjectId', () => {
  it('returns action=attach method=direct_id when partnerProjectId is a valid UUID', () => {
    const ctx = makeContext({ partnerProjectId: VALID_UUID });
    const result = resolveProjectLink(ctx);
    expect(result.action).toBe('attach');
    if (result.action === 'attach') {
      expect(result.projectId).toBe(VALID_UUID);
      expect(result.method).toBe('direct_id');
    }
  });

  it('ignores partnerProjectId if it is not a valid UUID', () => {
    const ctx = makeContext({ partnerProjectId: 'bad-id' });
    const result = resolveProjectLink(ctx);
    expect(result.action).toBe('resolve_existing');
  });

  it('returns resolve_existing when partnerProjectId is null', () => {
    const ctx = makeContext({ partnerProjectId: null });
    const result = resolveProjectLink(ctx);
    expect(result.action).toBe('resolve_existing');
  });
});

// ---------------------------------------------------------------------------
// Priority 3: resolve_existing (no direct UUID)
// ---------------------------------------------------------------------------
describe('resolveProjectLink — Priority 3: resolve_existing', () => {
  it('returns action=resolve_existing with surveyExternalId=event.survey_id', () => {
    const ctx = makeContext({ partnerProjectId: null });
    const result = resolveProjectLink(ctx);
    expect(result.action).toBe('resolve_existing');
    if (result.action === 'resolve_existing') {
      expect(result.surveyExternalId).toBe('survey-abc-123');
    }
  });

  it('passes selectedClientId as clientId hint when present', () => {
    const ctx = makeContext({ partnerProjectId: null, selectedClientId: VALID_CLIENT_UUID });
    const result = resolveProjectLink(ctx);
    expect(result.action).toBe('resolve_existing');
    if (result.action === 'resolve_existing') {
      expect(result.clientId).toBe(VALID_CLIENT_UUID);
    }
  });

  it('clientId is null when selectedClientId is not set', () => {
    const ctx = makeContext({ partnerProjectId: null, selectedClientId: null });
    const result = resolveProjectLink(ctx);
    if (result.action === 'resolve_existing') {
      expect(result.clientId).toBeNull();
    }
  });

  it('uses event.survey_id from context as surveyExternalId', () => {
    const ctx = makeContext({
      partnerProjectId: null,
      event: {
        event: 'survey.completed',
        schemaVersion: '1.0',
        event_id: 'evt-002',
        survey_id: 'unique-survey-xyz',
        completed_at: '2025-04-23T10:00:00.000Z',
      },
    });
    const result = resolveProjectLink(ctx);
    if (result.action === 'resolve_existing') {
      expect(result.surveyExternalId).toBe('unique-survey-xyz');
    }
  });
});

// ---------------------------------------------------------------------------
// Auto-create is BANNED
// ---------------------------------------------------------------------------
describe('resolveProjectLink — auto-create is banned', () => {
  it('never returns action=create', () => {
    const ctx = makeContext({ partnerProjectId: null });
    const result = resolveProjectLink(ctx);
    expect(result.action).not.toBe('create');
  });

  it('never returns action=triage', () => {
    const ctx = makeContext({ partnerProjectId: null });
    const result = resolveProjectLink(ctx);
    expect(result.action).not.toBe('triage');
  });

  it('never returns action=create_under_client', () => {
    const ctx = makeContext({ selectedClientId: VALID_CLIENT_UUID });
    const result = resolveProjectLink(ctx);
    expect(result.action).not.toBe('create_under_client');
    // Now goes to resolve_existing with clientId hint
    expect(result.action).toBe('resolve_existing');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------
describe('resolveProjectLink — determinism', () => {
  it('returns identical result on repeated calls with same context', () => {
    const ctx = makeContext({ partnerProjectId: null });
    const r1 = resolveProjectLink(ctx);
    const r2 = resolveProjectLink(ctx);
    expect(r1).toEqual(r2);
  });

  it('attach with projectId is deterministic', () => {
    const ctx = makeContext({ partnerProjectId: VALID_UUID });
    const r1 = resolveProjectLink(ctx);
    const r2 = resolveProjectLink(ctx);
    expect(r1).toEqual(r2);
  });
});