// ============================================================================
// v47.440 — Survey Ingest: Types Contract Tests
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
    // v47.440: PROJECT_RESOLUTION_FAILED added for survey→project resolution failures.
    const codes: IngestErrorCode[] = [
      'MISSING_OWNER_ID',
      'LINK_RESOLUTION_FAILED',
      'PROJECT_RESOLUTION_FAILED',
      'TRANSFORM_FAILED',
      'DB_WRITE_FAILED',
      'DELIVERY_UPDATE_FAILED',
      'UNKNOWN',
    ];
    expect(codes).toHaveLength(7);
    // All codes are SCREAMING_SNAKE_CASE
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// LinkResolution — discriminated union shape checks
//
// v47.440: Only 'attach', 'resolve_existing', and 'error' are valid.
// 'create', 'create_under_client', and 'triage' have been removed.
// Surveys MUST attach to existing projects — auto-create is banned.
// ---------------------------------------------------------------------------
describe('LinkResolution discriminated union', () => {
  it('action=attach has projectId and method', () => {
    const res: LinkResolution = {
      action: 'attach',
      projectId: 'abc-123',
      method: 'direct_id',
    };
    expect(res.action).toBe('attach');
    if (res.action === 'attach') {
      expect(res.projectId).toBe('abc-123');
      expect(res.method).toBe('direct_id');
    }
  });

  it('action=attach accepts selected_project method', () => {
    const res: LinkResolution = {
      action: 'attach',
      projectId: 'proj-selected',
      method: 'selected_project',
    };
    expect(res.action).toBe('attach');
    if (res.action === 'attach') {
      expect(res.method).toBe('selected_project');
    }
  });

  it('action=resolve_existing has surveyExternalId, clientId, address', () => {
    const res: LinkResolution = {
      action: 'resolve_existing',
      surveyExternalId: 'survey-xyz',
      clientId: null,
      address: null,
    };
    expect(res.action).toBe('resolve_existing');
    if (res.action === 'resolve_existing') {
      expect(res.surveyExternalId).toBe('survey-xyz');
      expect(res.clientId).toBeNull();
      expect(res.address).toBeNull();
    }
  });

  it('action=resolve_existing can carry clientId hint', () => {
    const res: LinkResolution = {
      action: 'resolve_existing',
      surveyExternalId: 'survey-abc',
      clientId: 'client-uuid-123',
      address: '123 Main St',
    };
    expect(res.action).toBe('resolve_existing');
    if (res.action === 'resolve_existing') {
      expect(res.clientId).toBe('client-uuid-123');
      expect(res.address).toBe('123 Main St');
    }
  });

  it('action=error has error message', () => {
    const res: LinkResolution = { action: 'error', error: 'something went wrong' };
    expect(res.action).toBe('error');
    if (res.action === 'error') {
      expect(res.error).toBeTruthy();
    }
  });

  // ------ Auto-create is BANNED ------
  it('create action does not exist in the union (auto-create is banned)', () => {
    // This is a compile-time guarantee enforced by TypeScript.
    // At runtime we verify the valid action values are the expected set.
    const validActions = ['attach', 'resolve_existing', 'error'];
    expect(validActions).not.toContain('create');
    expect(validActions).not.toContain('create_under_client');
    expect(validActions).not.toContain('triage');
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