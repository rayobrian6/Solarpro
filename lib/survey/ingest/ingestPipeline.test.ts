// ============================================================================
// v47.435 — Survey Ingest: Pipeline Orchestrator Tests
//
// Tests for runIngestPipeline(). Uses vi.mock to isolate DB calls.
// Verifies the pipeline's idempotency path, status transitions,
// error capture, and context validation — without a live DB.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IngestContext } from './types';

// ---------------------------------------------------------------------------
// Mock DB before importing pipeline (avoids real getDbReady call at import).
// ---------------------------------------------------------------------------
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(),
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

/** Build a mock sql tagged-template function that returns different results
 *  for UPDATE (delivery) vs INSERT (project upsert). */
function makeSql({
  upsertRows = [{ id: 'proj-new-001', inserted: true }],
  deliveryUpdateRows = [],
  insertFileRows = [],
}: {
  upsertRows?: unknown[];
  deliveryUpdateRows?: unknown[];
  insertFileRows?: unknown[];
} = {}) {
  let callCount = 0;
  const sql = vi.fn((..._args: unknown[]) => {
    callCount++;
    // First call: project upsert INSERT → return upsertRows
    // Subsequent UPDATE calls: return []
    if (callCount === 1) return Promise.resolve(upsertRows);
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
// Happy path: CREATE_ORPHAN, rawPayload=null (v47.435 stub)
// ---------------------------------------------------------------------------
describe('runIngestPipeline — happy path (CREATE_ORPHAN, stub)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const sql = makeSql({
      upsertRows: [{ id: 'proj-created-001', inserted: true }],
    });
    vi.mocked(getDbReady).mockResolvedValue(sql as any);
  });

  it('returns status=ingested', async () => {
    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    expect(result.status).toBe('ingested');
  });

  it('returns the projectId from the upsert', async () => {
    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    if (result.status === 'ingested') {
      expect(result.projectId).toBe('proj-created-001');
    }
  });

  it('created=true when DB returns inserted=true', async () => {
    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    if (result.status === 'ingested') {
      expect(result.created).toBe(true);
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
// DB write failure
// ---------------------------------------------------------------------------
describe('runIngestPipeline — DB write failure', () => {
  it('returns failed with DB_WRITE_FAILED when project upsert throws', async () => {
    vi.clearAllMocks();
    const failingSql = vi.fn().mockRejectedValue(new Error('relation "projects" does not exist'));
    vi.mocked(getDbReady)
      .mockResolvedValueOnce(failingSql as any)  // first call: project upsert fails
      .mockResolvedValueOnce(failingSql as any); // second call: _markDeliveryFailed also fails (non-fatal)

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
// Status transitions: created=true vs created=false
// ---------------------------------------------------------------------------
describe('runIngestPipeline — created flag from DB xmax', () => {
  it('created=false when DB returns inserted=false (update path)', async () => {
    vi.clearAllMocks();
    const sql = makeSql({
      upsertRows: [{ id: 'proj-existing-001', inserted: false }],
    });
    vi.mocked(getDbReady).mockResolvedValue(sql as any);

    const ctx = makeContext();
    const result = await runIngestPipeline(ctx);
    if (result.status === 'ingested') {
      expect(result.created).toBe(false);
    }
  });

  it('created=false when DB returns inserted="false" (string from postgres.js)', async () => {
    vi.clearAllMocks();
    const sql = makeSql({
      upsertRows: [{ id: 'proj-existing-002', inserted: 'false' }],
    });
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
    const sql = makeSql({
      upsertRows: [{ id: 'proj-shape-001', inserted: true }],
    });
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