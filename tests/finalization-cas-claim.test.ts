/**
 * tests/finalization-cas-claim.test.ts
 *
 * Tests for markFinalizationStarted() CAS (compare-and-swap) claim logic.
 *
 * ROOT CAUSE of the stuck-running bug:
 *   The Neon serverless driver (without fullResults:true) returns just rows[]
 *   for UPDATE queries. Without RETURNING, rows[] is always empty — so
 *   result.length === 0 even when rows ARE affected. This made
 *   markFinalizationStarted() always return false.
 *
 * FIX: All UPDATE queries that need to detect affected rows now use
 *   RETURNING job_id, so result.length > 0 correctly indicates success.
 *
 * These tests mock the Neon SQL executor to prove:
 *   1. markFinalizationStarted() returns true for status='completed' + finalization_status='pending'
 *   2. markFinalizationStarted() returns false only when already 'running' or 'complete'
 *   3. The debug log fires on CAS failure
 *   4. resetStuckFinalization works with RETURNING
 *   5. resetStuckOrFailedFinalization works with RETURNING
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the DB layer ──────────────────────────────────────────────────────
// We mock @/lib/db/core so getDbReady() returns our controlled SQL executor.

const mockSql = vi.fn();
vi.mock('@/lib/db/core', () => ({
  getDbReady: () => Promise.resolve(mockSql),
}));

// Import AFTER the mock is set up so the module uses the mocked DB
import {
  markFinalizationStarted,
  resetStuckFinalization,
  resetStuckOrFailedFinalization,
  resetAllStuckFinalizations,
  cancelJob,
  markStaleJobsFailed,
} from '../lib/assistedEvidenceSources/asyncPhotoVisionJobManager';

// ── Test constants ──────────────────────────────────────────────────────────
const JOB_ID = 'job_302cf42c-5c9d-40f6-bf4a-100accaa75a4_1779929175095_gmyhrj';

/**
 * Helper: extract the raw SQL text from a tagged-template call.
 * Neon's tagged template literal produces calls like:
 *   sql`UPDATE ... WHERE id = ${jobId} RETURNING job_id`
 * which becomes: sql(strings[0], strings[1], ..., value0, value1, ...)
 * The first argument is the TemplateStringsArray, and values follow.
 * We join only the string fragments to get the SQL skeleton.
 */
function getSqlTextFromCall(callArgs: unknown[]): string {
  // In a tagged template call like sql`a ${x} b ${y} c`:
  //   callArgs = [strings, x, y] where strings = ['a ', ' b ', ' c']
  // The first argument is always the TemplateStringsArray
  const strings = callArgs[0] as string[];
  return strings.join('$PARAM');
}

beforeEach(() => {
  mockSql.mockReset();
});

// ════════════════════════════════════════════════════════════════════════════
// markFinalizationStarted
// ════════════════════════════════════════════════════════════════════════════
describe('markFinalizationStarted', () => {
  it('returns true when finalization_status is pending (CAS claim succeeds)', async () => {
    // Simulate Neon returning the affected row via RETURNING job_id
    mockSql.mockResolvedValueOnce([{ job_id: JOB_ID }]); // UPDATE ... RETURNING

    const result = await markFinalizationStarted(JOB_ID);

    expect(result).toBe(true);
    // Verify the SQL uses RETURNING
    const sqlText = getSqlTextFromCall(mockSql.mock.calls[0]);
    expect(sqlText).toContain('RETURNING');
    expect(sqlText).toContain('job_id');
  });

  it('returns true when finalization_status is failed (retry succeeds)', async () => {
    // Same as pending — the SQL matches IN ('pending', 'failed', 'skipped')
    mockSql.mockResolvedValueOnce([{ job_id: JOB_ID }]); // UPDATE ... RETURNING

    const result = await markFinalizationStarted(JOB_ID);

    expect(result).toBe(true);
  });

  it('returns true when finalization_status is skipped (retry succeeds)', async () => {
    mockSql.mockResolvedValueOnce([{ job_id: JOB_ID }]); // UPDATE ... RETURNING

    const result = await markFinalizationStarted(JOB_ID);

    expect(result).toBe(true);
  });

  it('returns false when finalization_status is running (CAS rejected)', async () => {
    // No rows returned — UPDATE WHERE clause didn't match
    mockSql.mockResolvedValueOnce([]); // Empty array = no rows affected
    // Also mock the debug re-read
    mockSql.mockResolvedValueOnce([{
      job_id: JOB_ID,
      status: 'completed',
      finalization_status: 'running',
      finalization_started_at: new Date(),
      finalization_error: null,
    }]);

    const result = await markFinalizationStarted(JOB_ID);

    expect(result).toBe(false);
  });

  it('returns false when finalization_status is complete (CAS rejected)', async () => {
    // No rows returned
    mockSql.mockResolvedValueOnce([]);
    // Debug re-read
    mockSql.mockResolvedValueOnce([{
      job_id: JOB_ID,
      status: 'completed',
      finalization_status: 'complete',
      finalization_started_at: new Date(),
      finalization_error: null,
    }]);

    const result = await markFinalizationStarted(JOB_ID);

    expect(result).toBe(false);
  });

  it('fires debug log on CAS failure showing DB state', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // No rows returned
    mockSql.mockResolvedValueOnce([]);
    // Debug re-read
    mockSql.mockResolvedValueOnce([{
      job_id: JOB_ID,
      status: 'completed',
      finalization_status: 'running',
      finalization_started_at: '2025-01-01T00:00:00Z',
      finalization_error: null,
    }]);

    await markFinalizationStarted(JOB_ID);

    // Debug log: console.error is called with a single concatenated string argument
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[markFinalizationStarted] CAS FAILED'),
    );
    // The log should mention the actual finalization_status from DB
    const logMessage = String(consoleSpy.mock.calls[0]?.[0] ?? '');
    expect(logMessage).toContain('finalization_status=running');
    expect(logMessage).toContain('status=completed');

    consoleSpy.mockRestore();
  });

  it('handles debug re-read failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // No rows returned for UPDATE
    mockSql.mockResolvedValueOnce([]);
    // Debug re-read throws
    mockSql.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await markFinalizationStarted(JOB_ID);

    expect(result).toBe(false);
    // Should have logged both the CAS failure AND the debug re-read failure
    // When debug re-read throws, console.error is called once with the combined error message
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// resetStuckFinalization
// ════════════════════════════════════════════════════════════════════════════
describe('resetStuckFinalization', () => {
  it('returns true when stale running job is reset', async () => {
    mockSql.mockResolvedValueOnce([{ job_id: JOB_ID }]);

    const result = await resetStuckFinalization(JOB_ID);

    expect(result).toBe(true);
    // Verify RETURNING is used
    const sqlText = getSqlTextFromCall(mockSql.mock.calls[0]);
    expect(sqlText).toContain('RETURNING');
  });

  it('returns false when no stale running job found', async () => {
    mockSql.mockResolvedValueOnce([]); // Empty = no rows affected

    const result = await resetStuckFinalization(JOB_ID);

    expect(result).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// resetStuckOrFailedFinalization
// ════════════════════════════════════════════════════════════════════════════
describe('resetStuckOrFailedFinalization', () => {
  it('returns true when failed job is reset', async () => {
    mockSql.mockResolvedValueOnce([{ job_id: JOB_ID }]);

    const result = await resetStuckOrFailedFinalization(JOB_ID);

    expect(result).toBe(true);
    const sqlText = getSqlTextFromCall(mockSql.mock.calls[0]);
    expect(sqlText).toContain('RETURNING');
  });

  it('returns false when no matching job', async () => {
    mockSql.mockResolvedValueOnce([]);

    const result = await resetStuckOrFailedFinalization(JOB_ID);

    expect(result).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// resetAllStuckFinalizations
// ════════════════════════════════════════════════════════════════════════════
describe('resetAllStuckFinalizations', () => {
  it('returns count of reset jobs', async () => {
    mockSql.mockResolvedValueOnce([{ job_id: 'job1' }, { job_id: 'job2' }]);

    const result = await resetAllStuckFinalizations();

    expect(result).toBe(2);
    const sqlText = getSqlTextFromCall(mockSql.mock.calls[0]);
    expect(sqlText).toContain('RETURNING');
  });

  it('returns 0 when no stuck jobs', async () => {
    mockSql.mockResolvedValueOnce([]);

    const result = await resetAllStuckFinalizations();

    expect(result).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// markStaleJobsFailed
// ════════════════════════════════════════════════════════════════════════════
describe('markStaleJobsFailed', () => {
  it('returns count of stale jobs marked failed', async () => {
    mockSql.mockResolvedValueOnce([{ job_id: 'job1' }]);

    const result = await markStaleJobsFailed();

    expect(result).toBe(1);
    const sqlText = getSqlTextFromCall(mockSql.mock.calls[0]);
    expect(sqlText).toContain('RETURNING');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// cancelJob
// ════════════════════════════════════════════════════════════════════════════
describe('cancelJob', () => {
  it('returns true when job is cancelled', async () => {
    // First call: SELECT render_job_id
    mockSql.mockResolvedValueOnce([{ render_job_id: 'render-123' }]);
    // Second call: UPDATE ... RETURNING
    mockSql.mockResolvedValueOnce([{ job_id: JOB_ID }]);

    const result = await cancelJob(JOB_ID);

    expect(result).toBe(true);
    // Verify UPDATE uses RETURNING
    const updateSqlText = getSqlTextFromCall(mockSql.mock.calls[1]);
    expect(updateSqlText).toContain('RETURNING');
  });

  it('returns false when job not found or not in pending/running', async () => {
    // SELECT returns nothing
    mockSql.mockResolvedValueOnce([]);
    // UPDATE returns nothing
    mockSql.mockResolvedValueOnce([]);

    const result = await cancelJob(JOB_ID);

    expect(result).toBe(false);
  });
});
