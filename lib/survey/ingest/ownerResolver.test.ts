// ============================================================================
// Regression tests for resolveIngestOwner()
//
// These tests were added after a production bug where the resolver's SQL
// referenced a `users.deleted_at` column that did not exist, causing every
// lookup to throw, land in the catch block, and silently fall back to
// SURVEY_INGEST_DEFAULT_USER_ID. The net effect: EVERY survey was routed
// to a single account regardless of the solarpro_user_id claim.
//
// These tests lock in the claim-vs-default precedence and guard against the
// resolver query drifting back to a column the users table doesn't have.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock getDbReady before importing the resolver
const mockSql = vi.fn();
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => mockSql),
}));

// Import AFTER the mock so the resolver picks it up
import { resolveIngestOwner } from './ownerResolver';

const KNOWN_USER_ID = '195c3524-540b-43bc-8da1-43e3aa5f1eac';
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

describe('resolveIngestOwner()', () => {
  const originalEnv = process.env.SURVEY_INGEST_DEFAULT_USER_ID;

  beforeEach(() => {
    mockSql.mockReset();
    process.env.SURVEY_INGEST_DEFAULT_USER_ID = DEFAULT_USER_ID;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SURVEY_INGEST_DEFAULT_USER_ID;
    } else {
      process.env.SURVEY_INGEST_DEFAULT_USER_ID = originalEnv;
    }
  });

  it('returns ownerSource=claim when user exists', async () => {
    mockSql.mockResolvedValueOnce([{ id: KNOWN_USER_ID }]);
    const result = await resolveIngestOwner(KNOWN_USER_ID, 'trace-1');
    expect(result).toEqual({
      ownerId: KNOWN_USER_ID,
      ownerSource: 'claim',
    });
  });

  it('falls back to default when claim matches no user row', async () => {
    mockSql.mockResolvedValueOnce([]); // no rows
    const result = await resolveIngestOwner(KNOWN_USER_ID, 'trace-2');
    expect(result).toEqual({
      ownerId: DEFAULT_USER_ID,
      ownerSource: 'default',
    });
  });

  it('REGRESSION: falls back to default if DB throws (but must not leak claim as owner)', async () => {
    mockSql.mockRejectedValueOnce(new Error('column "deleted_at" does not exist'));
    const result = await resolveIngestOwner(KNOWN_USER_ID, 'trace-3');
    expect(result).toEqual({
      ownerId: DEFAULT_USER_ID,
      ownerSource: 'default',
    });
  });

  it('REGRESSION: resolver SQL must NOT reference users.deleted_at (column missing in schema)', async () => {
    // This test captures the exact query the resolver issues and asserts on
    // it to guard against the column-does-not-exist bug returning.
    mockSql.mockImplementation((strings: TemplateStringsArray, ..._values: unknown[]) => {
      const queryText = strings.join('?');
      // The users table has no deleted_at column. Any reference must fail CI.
      expect(queryText).not.toMatch(/\bdeleted_at\b/);
      expect(queryText).toMatch(/FROM users/i);
      expect(queryText).toMatch(/WHERE\s+id\s*=/i);
      return Promise.resolve([{ id: KNOWN_USER_ID }]);
    });
    const result = await resolveIngestOwner(KNOWN_USER_ID, 'trace-4');
    expect(result?.ownerSource).toBe('claim');
  });

  it('returns default immediately when no claim is provided', async () => {
    const result = await resolveIngestOwner(null, 'trace-5');
    expect(result).toEqual({
      ownerId: DEFAULT_USER_ID,
      ownerSource: 'default',
    });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns null when both claim is absent and default is unset', async () => {
    delete process.env.SURVEY_INGEST_DEFAULT_USER_ID;
    const result = await resolveIngestOwner(null, 'trace-6');
    expect(result).toBeNull();
  });

  it('returns default when claim is invalid AND default is set', async () => {
    mockSql.mockResolvedValueOnce([]); // claim user not found
    const result = await resolveIngestOwner('not-a-real-uuid', 'trace-7');
    expect(result).toEqual({
      ownerId: DEFAULT_USER_ID,
      ownerSource: 'default',
    });
  });
});