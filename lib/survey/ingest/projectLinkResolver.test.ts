// ============================================================================
// v47.435 — Survey Ingest: Project Link Resolver Tests
//
// Tests for resolveProjectLink() and resolveProjectLinkStrategy().
// No DB interaction — the resolver is pure with respect to the DB.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveProjectLink,
  resolveProjectLinkStrategy,
} from './projectLinkResolver';
import { DEFAULT_SURVEY_PROJECT_LINK_STRATEGY } from './types';
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
    receivedAt: '2025-04-23T10:00:01.000Z',
    traceId: 'delivery-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveProjectLinkStrategy — env var parsing
// ---------------------------------------------------------------------------
describe('resolveProjectLinkStrategy', () => {
  const originalEnv = process.env.SURVEY_PROJECT_LINK_STRATEGY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SURVEY_PROJECT_LINK_STRATEGY;
    } else {
      process.env.SURVEY_PROJECT_LINK_STRATEGY = originalEnv;
    }
  });

  it('returns CREATE_ORPHAN when env var is not set', () => {
    delete process.env.SURVEY_PROJECT_LINK_STRATEGY;
    expect(resolveProjectLinkStrategy()).toBe('CREATE_ORPHAN');
  });

  it('returns CREATE_ORPHAN when env var is empty string', () => {
    process.env.SURVEY_PROJECT_LINK_STRATEGY = '';
    expect(resolveProjectLinkStrategy()).toBe('CREATE_ORPHAN');
  });

  it('parses CREATE_ORPHAN correctly', () => {
    process.env.SURVEY_PROJECT_LINK_STRATEGY = 'CREATE_ORPHAN';
    expect(resolveProjectLinkStrategy()).toBe('CREATE_ORPHAN');
  });

  it('parses ATTACH_TO_EXISTING correctly', () => {
    process.env.SURVEY_PROJECT_LINK_STRATEGY = 'ATTACH_TO_EXISTING';
    expect(resolveProjectLinkStrategy()).toBe('ATTACH_TO_EXISTING');
  });

  it('parses TRIAGE_QUEUE correctly', () => {
    process.env.SURVEY_PROJECT_LINK_STRATEGY = 'TRIAGE_QUEUE';
    expect(resolveProjectLinkStrategy()).toBe('TRIAGE_QUEUE');
  });

  it('is case-insensitive (lowercase input uppercased)', () => {
    process.env.SURVEY_PROJECT_LINK_STRATEGY = 'create_orphan';
    expect(resolveProjectLinkStrategy()).toBe('CREATE_ORPHAN');
  });

  it('trims whitespace before parsing', () => {
    process.env.SURVEY_PROJECT_LINK_STRATEGY = '  TRIAGE_QUEUE  ';
    expect(resolveProjectLinkStrategy()).toBe('TRIAGE_QUEUE');
  });

  it('falls back to default on unknown value', () => {
    process.env.SURVEY_PROJECT_LINK_STRATEGY = 'UNKNOWN_STRATEGY';
    expect(resolveProjectLinkStrategy()).toBe(DEFAULT_SURVEY_PROJECT_LINK_STRATEGY);
  });

  it('default strategy is CREATE_ORPHAN', () => {
    expect(DEFAULT_SURVEY_PROJECT_LINK_STRATEGY).toBe('CREATE_ORPHAN');
  });
});

// ---------------------------------------------------------------------------
// resolveProjectLink — CREATE_ORPHAN strategy (default)
// ---------------------------------------------------------------------------
describe('resolveProjectLink — CREATE_ORPHAN', () => {
  it('returns action=create with surveyExternalId=event.survey_id', () => {
    const ctx = makeContext({ partnerProjectId: null });
    const result = resolveProjectLink(ctx, 'CREATE_ORPHAN');
    expect(result.action).toBe('create');
    if (result.action === 'create') {
      expect(result.surveyExternalId).toBe('survey-abc-123');
      expect(result.strategy).toBe('CREATE_ORPHAN');
    }
  });

  it('v60.5: per-event routing overrides non-TRIAGE env strategy — attaches when partnerProjectId present', () => {
    // Pre-v60.5 behaviour: env=CREATE_ORPHAN hard-created every time.
    // v60.5 behaviour: only TRIAGE_QUEUE is honoured as an env override;
    // CREATE_ORPHAN/ATTACH_TO_EXISTING both fall through to per-event routing.
    const ctx = makeContext({ partnerProjectId: 'some-project-id' });
    const result = resolveProjectLink(ctx, 'CREATE_ORPHAN');
    expect(result.action).toBe('attach');
    if (result.action === 'attach') {
      expect(result.projectId).toBe('some-project-id');
    }
  });

  it('uses event.survey_id as the idempotency key', () => {
    const ctx = makeContext({
      event: {
        event: 'survey.completed',
        schemaVersion: '1.0',
        event_id: 'evt-002',
        survey_id: 'unique-survey-xyz',
        completed_at: '2025-04-23T10:00:00.000Z',
      },
    });
    const result = resolveProjectLink(ctx, 'CREATE_ORPHAN');
    if (result.action === 'create') {
      expect(result.surveyExternalId).toBe('unique-survey-xyz');
    }
  });

  it('uses env var strategy when no explicit strategy passed', () => {
    const original = process.env.SURVEY_PROJECT_LINK_STRATEGY;
    process.env.SURVEY_PROJECT_LINK_STRATEGY = 'CREATE_ORPHAN';
    const ctx = makeContext();
    const result = resolveProjectLink(ctx);
    expect(result.action).toBe('create');
    if (original === undefined) delete process.env.SURVEY_PROJECT_LINK_STRATEGY;
    else process.env.SURVEY_PROJECT_LINK_STRATEGY = original;
  });
});

// ---------------------------------------------------------------------------
// resolveProjectLink — ATTACH_TO_EXISTING strategy
// ---------------------------------------------------------------------------
describe('resolveProjectLink — ATTACH_TO_EXISTING', () => {
  it('returns action=attach with partnerProjectId when present', () => {
    const ctx = makeContext({ partnerProjectId: 'solarpro-project-123' });
    const result = resolveProjectLink(ctx, 'ATTACH_TO_EXISTING');
    expect(result.action).toBe('attach');
    if (result.action === 'attach') {
      expect(result.projectId).toBe('solarpro-project-123');
    }
  });

  it('v60.5: auto-creates under SSO user when partnerProjectId is null (per-event routing)', () => {
    // Pre-v60.5 behaviour: env=ATTACH_TO_EXISTING + no partnerProjectId → triage.
    // v60.5 behaviour: "user logs into mobile app and starts a survey from
    // scratch" is a legitimate flow — auto-create a new project for the SSO
    // user. Ops can still opt into triage-everything via env=TRIAGE_QUEUE.
    const ctx = makeContext({ partnerProjectId: null });
    const result = resolveProjectLink(ctx, 'ATTACH_TO_EXISTING');
    expect(result.action).toBe('create');
    if (result.action === 'create') {
      expect(result.surveyExternalId).toBe('survey-abc-123');
      expect(result.strategy).toBe('CREATE_ORPHAN');
    }
  });

  it('v60.5: auto-create path uses event.survey_id as idempotency key', () => {
    const ctx = makeContext({ partnerProjectId: null });
    const result = resolveProjectLink(ctx, 'ATTACH_TO_EXISTING');
    if (result.action === 'create') {
      expect(result.surveyExternalId).toBe(ctx.event.survey_id);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveProjectLink — TRIAGE_QUEUE strategy
// ---------------------------------------------------------------------------
describe('resolveProjectLink — TRIAGE_QUEUE', () => {
  it('returns action=triage with surveyExternalId', () => {
    const ctx = makeContext();
    const result = resolveProjectLink(ctx, 'TRIAGE_QUEUE');
    expect(result.action).toBe('triage');
    if (result.action === 'triage') {
      expect(result.surveyExternalId).toBe('survey-abc-123');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('triage reason mentions TRIAGE_QUEUE strategy', () => {
    const ctx = makeContext();
    const result = resolveProjectLink(ctx, 'TRIAGE_QUEUE');
    if (result.action === 'triage') {
      expect(result.reason).toContain('TRIAGE_QUEUE');
    }
  });

  it('uses event.survey_id regardless of partnerProjectId', () => {
    const ctx = makeContext({ partnerProjectId: 'partner-proj-999' });
    const result = resolveProjectLink(ctx, 'TRIAGE_QUEUE');
    if (result.action === 'triage') {
      expect(result.surveyExternalId).toBe(ctx.event.survey_id);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveProjectLink — v60.5 per-event routing (canonical default behaviour)
// ---------------------------------------------------------------------------
describe('resolveProjectLink — v60.5 per-event routing', () => {
  it('attaches to partnerProjectId when present (Case 1: survey from project)', () => {
    const ctx = makeContext({ partnerProjectId: 'existing-project-99' });
    // Default strategy (CREATE_ORPHAN) falls through to per-event routing.
    const result = resolveProjectLink(ctx, 'CREATE_ORPHAN');
    expect(result.action).toBe('attach');
    if (result.action === 'attach') {
      expect(result.projectId).toBe('existing-project-99');
    }
  });

  it('auto-creates when partnerProjectId is null (Case 2: survey from scratch)', () => {
    const ctx = makeContext({ partnerProjectId: null });
    const result = resolveProjectLink(ctx, 'CREATE_ORPHAN');
    expect(result.action).toBe('create');
    if (result.action === 'create') {
      expect(result.strategy).toBe('CREATE_ORPHAN');
      expect(result.surveyExternalId).toBe(ctx.event.survey_id);
    }
  });

  it('TRIAGE_QUEUE env override still parks everything for manual review', () => {
    const ctx = makeContext({ partnerProjectId: 'existing-project-99' });
    const result = resolveProjectLink(ctx, 'TRIAGE_QUEUE');
    expect(result.action).toBe('triage');
  });
});

// ---------------------------------------------------------------------------
// resolveProjectLink — determinism
// ---------------------------------------------------------------------------
describe('resolveProjectLink — determinism', () => {
  it('returns identical result on repeated calls with same context and strategy', () => {
    const ctx = makeContext({ partnerProjectId: null });
    const r1 = resolveProjectLink(ctx, 'CREATE_ORPHAN');
    const r2 = resolveProjectLink(ctx, 'CREATE_ORPHAN');
    expect(r1).toEqual(r2);
  });

  it('ATTACH_TO_EXISTING with projectId is deterministic', () => {
    const ctx = makeContext({ partnerProjectId: 'proj-stable' });
    const r1 = resolveProjectLink(ctx, 'ATTACH_TO_EXISTING');
    const r2 = resolveProjectLink(ctx, 'ATTACH_TO_EXISTING');
    expect(r1).toEqual(r2);
  });
});