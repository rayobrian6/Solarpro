// ============================================================================
// v47.440 — Survey Ingest: Pipeline Orchestrator Tests
//
// Tests for runIngestPipeline(). Uses vi.mock to isolate DB calls.
// Verifies the pipeline's resolution path, status transitions,
// error capture, and context validation — without a live DB.
//
// v47.440 changes from v47.435:
//   - Pipeline no longer creates projects. _upsertProject() is gone.
//   - Step E now calls _resolveExistingProjectId() (Priority A/B/C lookup)
//     then _attachSurveyToProject() (UPDATE ... RETURNING id).
//   - created flag is always false (we never create).
//   - PROJECT_RESOLUTION_FAILED replaces DB_WRITE_FAILED for resolution errors.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IngestContext } from './types';

// ---------------------------------------------------------------------------
// Mock DB before importing pipeline (avoids real getDbReady call at import).
// ---------------------------------------------------------------------------
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(),
  // isValidUUID is used by projectLinkResolver (imported at module load)
  isValidUUID: (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  // createSiteSurvey and bulkAddSiteSurveyFiles are called in Step E2 (non-fatal if they fail)
  createSiteSurvey: vi.fn().mockResolvedValue({ id: 'site-survey-mock-001' }),
  bulkAddSiteSurveyFiles: vi.fn().mockResolvedValue(0),
}));

import { runIngestPipeline } from './ingestPipeline';
import { getDbReady } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeContext(overrides: Partial<IngestContext> = {}): IngestContext {
  return {
    event: {
      event: 'survey.completed',
      schemaVersion: '1.0',
      event_id: 'evt-pipeline-001',
      survey_id: 'survey-pipeline-abc',
      completed_at: '2025-04-23T10:00:00.000Z',
    },
    deliveryId: 'delivery-pipeline-001',
    ownerId: 'user-owner-pipeline',
    ownerSource: 'default',
    partnerProjectId: null,
    selectedProjectId: null,
    selectedClientId: null,
    receivedAt: '2025-04-23T10:00:01.000Z',
    traceId: 'delivery-pipeline-001',
    ...overrides,
  };
}

/**
 * Build a mock sql tagged-template function for the v47.440 pipeline.
 *
 * New pipeline call sequence (for resolve_existing action):
 *   Call 1: _resolveExistingProjectId Priority B SELECT — returns [{ id }] to simulate "found"
 *   Call 2: _attachSurveyToProject   UPDATE...RETURNING — returns [{ id }] to simulate "updated"
 *   Call 3+: delivery UPDATE, physical_data, etc.     — returns []
 *
 * @param projectId  The project UUID the mock will "find" and "attach"
 */
function makeSql({
  projectId = 'proj-new-001',
  deliveryUpdateRows = [] as unknown[],
} = {}) {
  let callCount = 0;
  const sql = vi.fn((..._args: unknown[]) => {
    callCount++;
    // Call 1: _resolveExistingProjectId Priority B SELECT → found project
    if (callCount === 1) return Promise.resolve([{ id: projectId }]);
    // Call 2: _attachSurveyToProject UPDATE...RETURNING → success
    if (callCount === 2) return Promise.resolve([{ id: projectId }]);
    // All subsequent calls: delivery UPDATE, physical_data, etc.
    return Promise.resolve(deliveryUpdateRows);
  });
  // Make sql also callable as a tagged template (postgres.js style)
  const taggedSql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    return sql(strings, ...values);
  };
  // Copy mock internals for inspection
  Object.assign(taggedSql, { mock: sql.mock, mockClear: () => sql.mockClear() });
  return taggedSql as unknown as ReturnType<typeof getDbReady> extends Promise<infer T> ? T : never;
}

// ---------------------------------------------------------------------------
// Validation: missing ownerId
// ---------------------------------------------------------------------------
describe('runIngestPipeline — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide a minimal sql mock for the delivery-failed UPDATE
    const sql = makeSql();
    vi.mocked(getDbReady).mockResolvedValue(sql as any);
  });

  it('returns failed with MISSING_OWNER_ID when ownerId is empty', async () => {
    const ctx = makeContext({ ownerId: '' });
    const result = await runIngestPipeline(ctx);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.code).toBe('MISSING_OWNER_ID');
      expect(result.error).toContain('SURVEY_INGEST_DEFAULT_USER_ID');
    }
  });

  it('never throws — returns IngestResult even when ownerId is missing', async () => {
    const ctx = makeContext({ ownerId: '' });
    await expect(runIngestPipeline(ctx)).resolves.toBeDefined();
  });

  it('durationMs is present in failure result', async () => {
    const ctx = makeContext({ ownerId: '' });
    const result = await runIngestPipeline(ctx);
    if (result.status === 'failed') {
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Happy path: resolve_existing, rawPayload=null (v47.440)
//
// With no selectedProjectId/partnerProjectId, the resolver returns
// action='resolve_existing'. The pipeline looks up the project via
// Priority B (survey_external_id) using the mock, finds it, and attaches.
// ---------------------------------------------------------------------------
describe('runIngestPipeline — happy path (resolve_existing, stub)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const sql = makeSql({ projectId: 'proj-resolved-001' });
    vi.mocked(getDbReady).mockResolvedValue(sql as any);
  });

  it('returns status=ingested', async () => {
    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    expect(result.status).toBe('ingested');
  });

  it('returns the resolved projectId', async () => {
    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    if (result.status === 'ingested') {
      expect(result.projectId).toBe('proj-resolved-001');
    }
  });

  it('created=false (v47.440: we never create; always attach to existing)', async () => {
    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    if (result.status === 'ingested') {
      expect(result.created).toBe(false);
    }
  });

  it('transformSummary has the stub project name', async () => {
    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    if (result.status === 'ingested') {
      expect(result.transformSummary.projectName).toBe('Survey survey-pipeline-abc');
    }
  });

  it('transformSummary.fileCount=0 (no files in stub path)', async () => {
    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    if (result.status === 'ingested') {
      expect(result.transformSummary.fileCount).toBe(0);
    }
  });

  it('durationMs is present and non-negative', async () => {
    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('never throws', async () => {
    const ctx = makeContext();
    await expect(runIngestPipeline(ctx)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Happy path: attach action (selectedProjectId provided)
//
// When selectedProjectId is a valid UUID, resolver returns action='attach'.
// Pipeline runs Priority A: SELECT to verify the project exists.
// ---------------------------------------------------------------------------
describe('runIngestPipeline — happy path (attach via selectedProjectId)', () => {
  const PROJ_ID = 'aaaabbbb-cccc-dddd-eeee-000011112222';

  beforeEach(() => {
    vi.clearAllMocks();
    // Call 1: Priority A SELECT verify project exists → found
    // Call 2: _attachSurveyToProject UPDATE...RETURNING → success
    // Call 3+: everything else → []
    let callCount = 0;
    const sql = vi.fn((..._args: unknown[]) => {
      callCount++;
      if (callCount <= 2) return Promise.resolve([{ id: PROJ_ID }]);
      return Promise.resolve([]);
    });
    const taggedSql = (strings: TemplateStringsArray, ...values: unknown[]) => sql(strings, ...values);
    Object.assign(taggedSql, { mock: sql.mock });
    vi.mocked(getDbReady).mockResolvedValue(taggedSql as any);
  });

  it('returns status=ingested', async () => {
    const ctx = makeContext({ selectedProjectId: PROJ_ID });
    const result = await runIngestPipeline(ctx);
    expect(result.status).toBe('ingested');
  });

  it('returns the correct projectId', async () => {
    const ctx = makeContext({ selectedProjectId: PROJ_ID });
    const result = await runIngestPipeline(ctx);
    if (result.status === 'ingested') {
      expect(result.projectId).toBe(PROJ_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// DB write failure
// ---------------------------------------------------------------------------
describe('runIngestPipeline — DB write failure', () => {
  it('returns failed with PROJECT_RESOLUTION_FAILED when project lookup throws', async () => {
    // With resolve_existing action, Priority B SELECT throws → PROJECT_RESOLUTION_FAILED
    vi.clearAllMocks();
    const failingSql = vi.fn().mockRejectedValue(new Error('relation "projects" does not exist'));
    vi.mocked(getDbReady)
      .mockResolvedValueOnce(failingSql as any)   // first call: project resolution SQL fails
      .mockResolvedValueOnce(failingSql as any);  // second call: _markDeliveryFailed also fails (non-fatal)

    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.code).toBe('PROJECT_RESOLUTION_FAILED');
    }
  });

  it('returns failed with DB_WRITE_FAILED when _attachSurveyToProject throws', async () => {
    // Priority B SELECT succeeds (finds project), but UPDATE RETURNING fails
    vi.clearAllMocks();
    let callCount = 0;
    const mixedSql = vi.fn((..._args: unknown[]) => {
      callCount++;
      // Call 1: Priority B SELECT → found project
      if (callCount === 1) return Promise.resolve([{ id: 'proj-found-001' }]);
      // Call 2: _attachSurveyToProject UPDATE RETURNING → throws
      return Promise.reject(new Error('relation "projects" does not exist'));
    });
    const taggedSql = (strings: TemplateStringsArray, ...values: unknown[]) =>
      mixedSql(strings, ...values);
    Object.assign(taggedSql, { mock: mixedSql.mock });
    vi.mocked(getDbReady).mockResolvedValue(taggedSql as any);

    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.code).toBe('DB_WRITE_FAILED');
      expect(result.error).toContain('projects');
    }
  });

  it('returns failed with DB_WRITE_FAILED when getDbReady itself throws', async () => {
    vi.clearAllMocks();
    vi.mocked(getDbReady).mockRejectedValue(new Error('Neon connection timeout'));

    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.code).toBe('DB_WRITE_FAILED');
    }
  });

  it('never throws even when DB is completely unavailable', async () => {
    vi.clearAllMocks();
    vi.mocked(getDbReady).mockRejectedValue(new Error('Network error'));

    const ctx = makeContext();
    await expect(runIngestPipeline(ctx)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Status transitions: created flag
//
// v47.440: created is always false — surveys attach to EXISTING projects.
// ---------------------------------------------------------------------------
describe('runIngestPipeline — created flag (v47.440)', () => {
  it('created=false (pipeline never creates projects)', async () => {
    vi.clearAllMocks();
    const sql = makeSql({ projectId: 'proj-attach-001' });
    vi.mocked(getDbReady).mockResolvedValue(sql as any);

    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    if (result.status === 'ingested') {
      expect(result.created).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Pipeline result shape contract
// ---------------------------------------------------------------------------
describe('runIngestPipeline — result shape contract', () => {
  it('ingested result always has: status, projectId, created, transformSummary, durationMs', async () => {
    vi.clearAllMocks();
    const sql = makeSql({ projectId: 'proj-shape-001' });
    vi.mocked(getDbReady).mockResolvedValue(sql as any);

    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('durationMs');
    if (result.status === 'ingested') {
      expect(result).toHaveProperty('projectId');
      expect(result).toHaveProperty('created');
      expect(result).toHaveProperty('transformSummary');
      expect(result.transformSummary).toHaveProperty('projectName');
      expect(result.transformSummary).toHaveProperty('fileCount');
      expect(result.transformSummary).toHaveProperty('hasAddress');
      expect(result.transformSummary).toHaveProperty('hasSurveyMeta');
    }
  });

  it('failed result always has: status, error, code, durationMs', async () => {
    vi.clearAllMocks();
    vi.mocked(getDbReady).mockRejectedValue(new Error('db down'));

    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('durationMs');
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});