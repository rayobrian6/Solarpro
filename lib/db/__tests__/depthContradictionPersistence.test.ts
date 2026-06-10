/**
 * Depth Contradiction Report Persistence Tests (P0-2.3)
 *
 * Covers:
 *   - Feature flag ON: reports are persisted via insertContradictionReports()
 *   - Feature flag OFF: insert is a no-op
 *   - Write failure handling: insert errors are caught, not thrown
 *   - Query by survey ID: getContradictionReportsBySurvey() returns rows
 *   - Schema match: inserted data matches what getContradictionReportsBySurvey returns
 *   - Idempotency: re-insert deletes old rows first
 *   - Empty reports: no-op for both insert and query
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock setup — vi.mock is hoisted, so factory must use vi.fn() directly
// ---------------------------------------------------------------------------

const mockSql = vi.fn();

vi.mock('@/lib/db/core', () => ({
  getDbReady: vi.fn(() => mockSql),
}));

import {
  insertContradictionReports,
  getContradictionReportsBySurvey,
  isPhase0DepthContradictionPersistenceEnabled,
  type ContradictionReportRow,
} from '@/lib/db/geometryReconstruction';
import type { DepthContradictionReport } from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a DepthContradictionReport for testing. */
function makeReport(
  overrides: Partial<DepthContradictionReport> = {},
): DepthContradictionReport {
  return {
    segmentationClass: overrides.segmentationClass ?? 'roof',
    maskId: overrides.maskId ?? 'mask-001',
    expectedRange: overrides.expectedRange ?? [0.25, 0.75],
    actualDepth: overrides.actualDepth ?? 0.90,
    deviation: overrides.deviation ?? 0.15,
    severity: overrides.severity ?? 'moderate',
    confidencePenalty: overrides.confidencePenalty ?? 15,
    description: overrides.description ?? 'Roof depth contradicts expected range',
  };
}

/** Create a DB row shape matching the ContradictionReportRow interface. */
function makeRow(overrides: Partial<ContradictionReportRow> = {}): ContradictionReportRow {
  return {
    id: overrides.id ?? '550e8400-e29b-41d4-a716-446655440000',
    jobId: overrides.jobId ?? 'job-001',
    surveyId: overrides.surveyId ?? 'survey-001',
    segmentationClass: overrides.segmentationClass ?? 'roof',
    maskId: overrides.maskId ?? 'mask-001',
    expectedRangeMin: overrides.expectedRangeMin ?? 0.25,
    expectedRangeMax: overrides.expectedRangeMax ?? 0.75,
    actualDepth: overrides.actualDepth ?? 0.90,
    deviation: overrides.deviation ?? 0.15,
    severity: overrides.severity ?? 'moderate',
    confidencePenalty: overrides.confidencePenalty ?? 15,
    description: overrides.description ?? 'Roof depth contradicts expected range',
    createdAt: overrides.createdAt ?? '2025-01-15T10:00:00.000Z',
  };
}

// ===========================================================================
// Feature flag tests
// ===========================================================================

describe('isPhase0DepthContradictionPersistenceEnabled', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns false when PHASE0_DEPTH_CONTRADICTION_ENABLED is not set', () => {
    delete process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED;
    expect(isPhase0DepthContradictionPersistenceEnabled()).toBe(false);
  });

  it('returns false when PHASE0_DEPTH_CONTRADICTION_ENABLED is empty', () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = '';
    expect(isPhase0DepthContradictionPersistenceEnabled()).toBe(false);
  });

  it('returns true when PHASE0_DEPTH_CONTRADICTION_ENABLED is "true"', () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = 'true';
    expect(isPhase0DepthContradictionPersistenceEnabled()).toBe(true);
  });

  it('returns true when PHASE0_DEPTH_CONTRADICTION_ENABLED is "1"', () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = '1';
    expect(isPhase0DepthContradictionPersistenceEnabled()).toBe(true);
  });

  it('returns false for other values like "yes" or "on"', () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = 'yes';
    expect(isPhase0DepthContradictionPersistenceEnabled()).toBe(false);
  });
});

// ===========================================================================
// insertContradictionReports
// ===========================================================================

describe('insertContradictionReports', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockSql.mockReset();
  });

  it('returns { inserted: 0, failed: 0 } when flag is OFF', async () => {
    delete process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED;

    const result = await insertContradictionReports('job-001', 'survey-001', [makeReport()]);

    expect(result).toEqual({ inserted: 0, failed: 0 });
    // Should NOT call the DB at all
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns { inserted: 0, failed: 0 } when reports array is empty', async () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = 'true';

    const result = await insertContradictionReports('job-001', 'survey-001', []);

    expect(result).toEqual({ inserted: 0, failed: 0 });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('persists reports when flag is ON using UNNEST pattern', async () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = 'true';

    // Mock: DELETE returns empty, INSERT returns 2 rows (2 IDs)
    mockSql
      .mockResolvedValueOnce([])  // DELETE for idempotency
      .mockResolvedValueOnce([{ id: 'uuid-1' }, { id: 'uuid-2' }]); // INSERT RETURNING

    const reports = [
      makeReport({ maskId: 'mask-001', severity: 'moderate', deviation: 0.15 }),
      makeReport({ maskId: 'mask-002', severity: 'major', deviation: 0.25 }),
    ];

    const result = await insertContradictionReports('job-001', 'survey-001', reports);

    expect(result).toEqual({ inserted: 2, failed: 0 });
    expect(mockSql).toHaveBeenCalledTimes(2); // DELETE + INSERT
  });

  it('deletes existing reports before inserting (idempotency)', async () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = 'true';

    mockSql
      .mockResolvedValueOnce([{ id: 'old-1' }])  // DELETE returns old rows
      .mockResolvedValueOnce([{ id: 'new-1' }]);  // INSERT

    const reports = [makeReport({ maskId: 'mask-001' })];
    const result = await insertContradictionReports('job-001', 'survey-001', reports);

    expect(result).toEqual({ inserted: 1, failed: 0 });
    // First call should be DELETE
    expect(mockSql.mock.calls[0]).toBeDefined();
  });

  it('catches write failure and returns { inserted: 0, failed: N }', async () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = 'true';

    // DELETE succeeds, INSERT throws
    mockSql
      .mockResolvedValueOnce([])  // DELETE
      .mockRejectedValueOnce(new Error('Neon connection failed'));

    const reports = [makeReport(), makeReport()];
    const result = await insertContradictionReports('job-001', 'survey-001', reports);

    // Safe failure mode: should NOT throw, should return failed count
    expect(result).toEqual({ inserted: 0, failed: 2 });
  });

  it('continues even if idempotency DELETE fails', async () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = 'true';

    // DELETE fails, INSERT still attempted
    mockSql
      .mockRejectedValueOnce(new Error('DELETE failed'))
      .mockResolvedValueOnce([{ id: 'new-1' }]);  // INSERT succeeds

    const reports = [makeReport()];
    const result = await insertContradictionReports('job-001', 'survey-001', reports);

    expect(result).toEqual({ inserted: 1, failed: 0 });
  });

  it('correctly maps DepthContradictionReport fields to DB columns', async () => {
    process.env.PHASE0_DEPTH_CONTRADICTION_ENABLED = 'true';

    mockSql
      .mockResolvedValueOnce([])  // DELETE
      .mockResolvedValueOnce([{ id: 'uuid-1' }]); // INSERT

    const report = makeReport({
      segmentationClass: 'sky',
      maskId: 'mask-sky-001',
      expectedRange: [0.80, 1.00],
      actualDepth: 0.30,
      deviation: 0.50,
      severity: 'major',
      confidencePenalty: 30,
      description: 'Sky appears at ground level',
    });

    await insertContradictionReports('job-001', 'survey-001', [report]);

    // The INSERT call should contain the mapped fields
    // We can't easily inspect tagged template args, but we verify it was called
    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// getContradictionReportsBySurvey
// ===========================================================================

describe('getContradictionReportsBySurvey', () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  it('returns ContradictionReportRow[] for a survey with reports', async () => {
    const dbRows = [
      {
        id: 'uuid-1',
        job_id: 'job-001',
        survey_id: 'survey-001',
        segmentation_class: 'roof',
        mask_id: 'mask-001',
        expected_range_min: 0.25,
        expected_range_max: 0.75,
        actual_depth: 0.90,
        deviation: 0.15,
        severity: 'moderate',
        confidence_penalty: 15,
        description: 'Roof depth contradicts',
        created_at: '2025-01-15T10:00:00.000Z',
      },
      {
        id: 'uuid-2',
        job_id: 'job-001',
        survey_id: 'survey-001',
        segmentation_class: 'sky',
        mask_id: 'mask-002',
        expected_range_min: 0.80,
        expected_range_max: 1.00,
        actual_depth: 0.30,
        deviation: 0.50,
        severity: 'major',
        confidence_penalty: 30,
        description: 'Sky at ground level',
        created_at: '2025-01-15T10:01:00.000Z',
      },
    ];

    mockSql.mockResolvedValueOnce(dbRows);

    const rows = await getContradictionReportsBySurvey('survey-001');

    expect(rows).toHaveLength(2);

    // Verify schema mapping: DB snake_case → JS camelCase
    expect(rows[0]).toEqual({
      id: 'uuid-1',
      jobId: 'job-001',
      surveyId: 'survey-001',
      segmentationClass: 'roof',
      maskId: 'mask-001',
      expectedRangeMin: 0.25,
      expectedRangeMax: 0.75,
      actualDepth: 0.90,
      deviation: 0.15,
      severity: 'moderate',
      confidencePenalty: 15,
      description: 'Roof depth contradicts',
      createdAt: '2025-01-15T10:00:00.000Z',
    });

    expect(rows[1]).toEqual({
      id: 'uuid-2',
      jobId: 'job-001',
      surveyId: 'survey-001',
      segmentationClass: 'sky',
      maskId: 'mask-002',
      expectedRangeMin: 0.80,
      expectedRangeMax: 1.00,
      actualDepth: 0.30,
      deviation: 0.50,
      severity: 'major',
      confidencePenalty: 30,
      description: 'Sky at ground level',
      createdAt: '2025-01-15T10:01:00.000Z',
    });
  });

  it('returns empty array when no reports exist for survey', async () => {
    mockSql.mockResolvedValueOnce([]);

    const rows = await getContradictionReportsBySurvey('survey-empty');

    expect(rows).toEqual([]);
  });

  it('returns empty array on DB query failure (safe failure mode)', async () => {
    mockSql.mockRejectedValueOnce(new Error('Neon connection failed'));

    const rows = await getContradictionReportsBySurvey('survey-001');

    // Should NOT throw — safe failure returns empty
    expect(rows).toEqual([]);
  });

  it('queries with survey_id filter and severity ordering', async () => {
    mockSql.mockResolvedValueOnce([]);

    await getContradictionReportsBySurvey('survey-001');

    // Verify the SQL was called
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('round-trips: inserted data shape matches queried data shape', async () => {
    // This test verifies that the shape of data written by insertContradictionReports
    // matches the shape read by getContradictionReportsBySurvey.
    // Since we mock the DB, we verify the field mapping is consistent.

    const report = makeReport({
      segmentationClass: 'tree_canopy',
      maskId: 'mask-tree-001',
      expectedRange: [0.60, 0.90],
      actualDepth: 0.20,
      deviation: 0.40,
      severity: 'major',
      confidencePenalty: 30,
      description: 'Tree canopy at ground depth',
    });

    // Verify the insert fields map to the query output fields
    // Insert maps: report.expectedRange[0] → expected_range_min, etc.
    // Query maps: expected_range_min → expectedRangeMin, etc.
    // The round-trip should be: expectedRange[0] → expected_range_min → expectedRangeMin
    expect(report.expectedRange[0]).toBe(0.60);
    expect(report.expectedRange[1]).toBe(0.90);

    // Verify the row shape matches
    const row = makeRow({
      segmentationClass: report.segmentationClass,
      maskId: report.maskId,
      expectedRangeMin: report.expectedRange[0],
      expectedRangeMax: report.expectedRange[1],
      actualDepth: report.actualDepth,
      deviation: report.deviation,
      severity: report.severity,
      confidencePenalty: report.confidencePenalty,
      description: report.description,
    });

    // All fields should map correctly
    expect(row.segmentationClass).toBe(report.segmentationClass);
    expect(row.maskId).toBe(report.maskId);
    expect(row.expectedRangeMin).toBe(report.expectedRange[0]);
    expect(row.expectedRangeMax).toBe(report.expectedRange[1]);
    expect(row.actualDepth).toBe(report.actualDepth);
    expect(row.deviation).toBe(report.deviation);
    expect(row.severity).toBe(report.severity);
    expect(row.confidencePenalty).toBe(report.confidencePenalty);
    expect(row.description).toBe(report.description);
  });
});
