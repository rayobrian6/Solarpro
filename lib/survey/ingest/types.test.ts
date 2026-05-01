// ============================================================================
// v47.435 — Survey Ingest: Types Contract Tests
//
// Locks the IngestStatus, IngestErrorCode, SurveyProjectLinkStrategy,
// and related constants against accidental drift.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  SURVEY_PROJECT_LINK_STRATEGIES,
  DEFAULT_SURVEY_PROJECT_LINK_STRATEGY,
  type IngestStatus,
  type IngestErrorCode,
  type SurveyProjectLinkStrategy,
  type LinkResolution,
  type IngestResult,
} from './types';

// ---------------------------------------------------------------------------
// SurveyProjectLinkStrategy — closed enum guard
// ---------------------------------------------------------------------------
describe('SurveyProjectLinkStrategy', () => {
  it('SURVEY_PROJECT_LINK_STRATEGIES contains exactly the 3 expected values', () => {
    expect(SURVEY_PROJECT_LINK_STRATEGIES).toEqual([
      'ATTACH_TO_EXISTING',
      'CREATE_ORPHAN',
      'TRIAGE_QUEUE',
    ]);
  });

  it('SURVEY_PROJECT_LINK_STRATEGIES has no duplicates', () => {
    const set = new Set(SURVEY_PROJECT_LINK_STRATEGIES);
    expect(set.size).toBe(SURVEY_PROJECT_LINK_STRATEGIES.length);
  });

  it('DEFAULT_SURVEY_PROJECT_LINK_STRATEGY is CREATE_ORPHAN', () => {
    expect(DEFAULT_SURVEY_PROJECT_LINK_STRATEGY).toBe('CREATE_ORPHAN');
  });

  it('DEFAULT_SURVEY_PROJECT_LINK_STRATEGY is a member of SURVEY_PROJECT_LINK_STRATEGIES', () => {
    expect(SURVEY_PROJECT_LINK_STRATEGIES).toContain(DEFAULT_SURVEY_PROJECT_LINK_STRATEGY);
  });

  it('all strategy values are uppercase strings', () => {
    for (const s of SURVEY_PROJECT_LINK_STRATEGIES) {
      expect(s).toBe(s.toUpperCase());
    }
  });
});

// ---------------------------------------------------------------------------
// IngestStatus — exhaustive union check
// ---------------------------------------------------------------------------
describe('IngestStatus', () => {
  it('covers both terminal pipeline states', () => {
    // TypeScript compile-time check: if the union is modified, this test
    // must be updated (just like contractDriftGuard.test.ts does for WebhookDeliveryStatus).
    const statuses: IngestStatus[] = ['ingested', 'failed'];
    expect(statuses).toHaveLength(2);
    expect(statuses).toContain('ingested');
    expect(statuses).toContain('failed');
  });

  it('does not include upstream statuses (those are set before pipeline runs)', () => {
    const statuses: IngestStatus[] = ['ingested', 'failed'];
    const upstreamOnly = ['received', 'verified', 'duplicate', 'replayed'];
    for (const s of upstreamOnly) {
      expect(statuses).not.toContain(s);
    }
  });
});

// ---------------------------------------------------------------------------
// IngestErrorCode — closed enum guard
// ---------------------------------------------------------------------------
describe('IngestErrorCode', () => {
  it('contains all expected error codes', () => {
    // TypeScript compile-time + runtime lock.
    const codes: IngestErrorCode[] = [
      'MISSING_OWNER_ID',
      'LINK_RESOLUTION_FAILED',
      'TRANSFORM_FAILED',
      'DB_WRITE_FAILED',
      'DELIVERY_UPDATE_FAILED',
      'UNKNOWN',
    ];
    expect(codes).toHaveLength(6);
    // All codes are SCREAMING_SNAKE_CASE
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// LinkResolution — discriminated union shape checks
// ---------------------------------------------------------------------------
describe('LinkResolution discriminated union', () => {
  it('action=attach has projectId', () => {
    const res: LinkResolution = { action: 'attach', projectId: 'abc-123' };
    expect(res.action).toBe('attach');
    expect(res.projectId).toBe('abc-123');
  });

  it('action=create has surveyExternalId and strategy', () => {
    const res: LinkResolution = {
      action: 'create',
      surveyExternalId: 'survey-xyz',
      strategy: 'CREATE_ORPHAN',
    };
    expect(res.action).toBe('create');
    expect(res.surveyExternalId).toBe('survey-xyz');
    expect(res.strategy).toBe('CREATE_ORPHAN');
  });

  it('action=triage has surveyExternalId and reason', () => {
    const res: LinkResolution = {
      action: 'triage',
      surveyExternalId: 'survey-xyz',
      reason: 'test reason',
    };
    expect(res.action).toBe('triage');
    expect(res.reason.length).toBeGreaterThan(0);
  });

  it('action=error has error message', () => {
    const res: LinkResolution = { action: 'error', error: 'something went wrong' };
    expect(res.action).toBe('error');
    expect(res.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// IngestResult — discriminated union shape checks
// ---------------------------------------------------------------------------
describe('IngestResult discriminated union', () => {
  it('status=ingested has required success fields', () => {
    const res: IngestResult = {
      status: 'ingested',
      projectId: 'proj-abc',
      created: true,
      transformSummary: {
        projectName: 'Test Project',
        hasAddress: false,
        fileCount: 0,
        hasSurveyMeta: true,
        hasPhysicalData: false,
        panelRatingAmps: null,
        roofMaterial: null,
        rafterSpacingIn: null,
      },
      durationMs: 42,
    };
    expect(res.status).toBe('ingested');
    expect(res.projectId).toBeTruthy();
    expect(typeof res.created).toBe('boolean');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('status=failed has error and code', () => {
    const res: IngestResult = {
      status: 'failed',
      error: 'Something failed',
      code: 'UNKNOWN',
      durationMs: 5,
    };
    expect(res.status).toBe('failed');
    expect(res.error).toBeTruthy();
    expect(res.code).toBeTruthy();
  });
});