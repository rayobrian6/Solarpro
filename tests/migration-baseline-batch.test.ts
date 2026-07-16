// tests/migration-baseline-batch.test.ts
//
// Commit 3 — Reviewed Baseline Batch. Pure adversarial tests for the tamper-
// evident digest, server-authoritative canonicalization, and blocking-status
// resolution rules. These run everywhere (no DB). The transactional recorder is
// exercised separately (recordBaselineBatch with an injected executor here; the
// real Postgres transaction/rollback path is covered by the TEST_DATABASE_URL
// integration suite).

import { describe, it, expect } from 'vitest';
import {
  canonicalizeBaselineBatch,
  computeBaselineBatchDigest,
  serializeBaselineBatch,
  validateBaselineBatch,
  baselineBatchStatusCounts,
  recordBaselineBatch,
  RESOLUTION_REQUIRED_STATUSES,
  type ServerBaselineEntry,
  type ClientBaselineReview,
} from '../lib/migrations/baselineBatch';
import type { BaselineReconciliationStatus } from '../lib/migrations/types';

// Server-owned manifest facts (never client-supplied).
const SERVER: ServerBaselineEntry[] = [
  { identifier: '001', filename: '001_a.sql', checksumSha256: 'a'.repeat(64), order: 0 },
  { identifier: '002', filename: '002_b.sql', checksumSha256: 'b'.repeat(64), order: 1 },
  { identifier: '074a', filename: '074_x.sql', checksumSha256: 'c'.repeat(64), order: 2 },
  { identifier: '074b', filename: '074_y.sql', checksumSha256: 'd'.repeat(64), order: 3 },
];

const review = (
  identifier: string,
  status: BaselineReconciliationStatus,
  notes?: string,
): ClientBaselineReview => ({ identifier, status, notes });

function canon(clientReviews: ClientBaselineReview[], environment = 'test') {
  return canonicalizeBaselineBatch({ environment, serverEntries: SERVER, clientReviews });
}

describe('Commit 3: reviewed baseline batch — canonicalization (server-authoritative)', () => {
  it('normalizes reordered client input to canonical manifest order', () => {
    const a = canon([review('074b', 'CONFIRMED_APPLIED'), review('001', 'CONFIRMED_APPLIED')]);
    const b = canon([review('001', 'CONFIRMED_APPLIED'), review('074b', 'CONFIRMED_APPLIED')]);
    expect(a.entries.map((e) => e.identifier)).toEqual(['001', '074b']);
    expect(computeBaselineBatchDigest(a)).toBe(computeBaselineBatchDigest(b));
  });

  it('rejects a client identifier not in the server manifest', () => {
    expect(() => canon([review('999', 'CONFIRMED_APPLIED')])).toThrow(/Unknown migration identifier/);
  });

  it('rejects a duplicate review for the same identifier', () => {
    expect(() => canon([review('001', 'CONFIRMED_APPLIED'), review('001', 'NOT_APPLICABLE')]))
      .toThrow(/Duplicate review/);
  });

  it('IGNORES client-supplied filename/checksum — uses server values', () => {
    const tampered = [{ identifier: '001', status: 'CONFIRMED_APPLIED', filename: 'evil.sql', checksumSha256: 'f'.repeat(64) } as unknown as ClientBaselineReview];
    const b = canon(tampered);
    expect(b.entries[0].filename).toBe('001_a.sql');
    expect(b.entries[0].checksumSha256).toBe('a'.repeat(64));
    // digest matches the clean review of the same decision
    expect(computeBaselineBatchDigest(b)).toBe(computeBaselineBatchDigest(canon([review('001', 'CONFIRMED_APPLIED')])));
  });
});

describe('Commit 3: digest is deterministic and tamper-evident', () => {
  const base = canon([review('001', 'CONFIRMED_APPLIED', 'seen in schema'), review('002', 'NOT_APPLICABLE', 'n/a here')]);
  const baseDigest = computeBaselineBatchDigest(base);

  it('is deterministic for identical input', () => {
    expect(computeBaselineBatchDigest(canon([review('001', 'CONFIRMED_APPLIED', 'seen in schema'), review('002', 'NOT_APPLICABLE', 'n/a here')]))).toBe(baseDigest);
  });

  it('changes when a status changes', () => {
    const other = canon([review('001', 'CONFIRMED_NOT_APPLIED', 'seen in schema'), review('002', 'NOT_APPLICABLE', 'n/a here')]);
    expect(computeBaselineBatchDigest(other)).not.toBe(baseDigest);
  });

  it('changes when a note changes', () => {
    const other = canon([review('001', 'CONFIRMED_APPLIED', 'DIFFERENT note'), review('002', 'NOT_APPLICABLE', 'n/a here')]);
    expect(computeBaselineBatchDigest(other)).not.toBe(baseDigest);
  });

  it('changes when the selected migration set changes', () => {
    const other = canon([review('001', 'CONFIRMED_APPLIED', 'seen in schema')]);
    expect(computeBaselineBatchDigest(other)).not.toBe(baseDigest);
  });

  it('changes when the environment changes', () => {
    const other = canon([review('001', 'CONFIRMED_APPLIED', 'seen in schema'), review('002', 'NOT_APPLICABLE', 'n/a here')], 'production');
    expect(computeBaselineBatchDigest(other)).not.toBe(baseDigest);
  });

  it('a note cannot forge a field/row boundary (separator injection)', () => {
    // A malicious note containing the field (␟) and row (␞) separators must not
    // be able to inject extra fields/rows into the digest input.
    const injected = canon([review('001', 'CONFIRMED_APPLIED', 'note␟with␞separators')]);
    // Exactly 1 header row + 1 entry row → 2 segments; the note's separators
    // were stripped, so they did not create phantom rows.
    expect(serializeBaselineBatch(injected).split('␞').length).toBe(2);
    // And the stored note is sanitized.
    expect(injected.entries[0].notes).not.toMatch(/[␟␞]/);
  });
});

describe('Commit 3: blocking-status resolution rules', () => {
  it('UNKNOWN and PARTIALLY_APPLIED are the resolution-required set', () => {
    expect([...RESOLUTION_REQUIRED_STATUSES].sort()).toEqual(['PARTIALLY_APPLIED', 'UNKNOWN']);
  });

  it('UNKNOWN without a note is blocking', () => {
    const b = canon([review('001', 'UNKNOWN')]);
    const v = validateBaselineBatch(b);
    expect(v.ok).toBe(false);
    expect(v.issues[0].code).toBe('RESOLUTION_REQUIRED');
  });

  it('PARTIALLY_APPLIED without a note is blocking', () => {
    const v = validateBaselineBatch(canon([review('002', 'PARTIALLY_APPLIED')]));
    expect(v.ok).toBe(false);
    expect(v.issues[0].code).toBe('RESOLUTION_REQUIRED');
  });

  it('UNKNOWN WITH a note passes resolution', () => {
    const v = validateBaselineBatch(canon([review('001', 'UNKNOWN', 'cannot determine, treating as pending')]));
    expect(v.ok).toBe(true);
  });

  it('a checksum-conflicted identifier is blocking', () => {
    const b = canon([review('001', 'CONFIRMED_APPLIED', 'ok')]);
    const v = validateBaselineBatch(b, { conflictIdentifiers: ['001'] });
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === 'CHECKSUM_CONFLICT')).toBe(true);
  });

  it('counts statuses correctly', () => {
    const b = canon([review('001', 'CONFIRMED_APPLIED', 'x'), review('002', 'CONFIRMED_APPLIED', 'y'), review('074a', 'NOT_APPLICABLE', 'z')]);
    expect(baselineBatchStatusCounts(b)).toMatchObject({ CONFIRMED_APPLIED: 2, NOT_APPLICABLE: 1 });
  });
});

describe('Commit 3: recordBaselineBatch (injected transaction) — tamper + atomicity contract', () => {
  const okBatch = canon([review('001', 'CONFIRMED_APPLIED', 'seen'), review('002', 'NOT_APPLICABLE', 'n/a')]);
  const okDigest = computeBaselineBatchDigest(okBatch);

  function deps(record: { calls: number; got?: unknown[] }, fail = false) {
    return {
      environment: 'test',
      runTransaction: async (entries: unknown[]) => {
        record.calls += 1;
        record.got = entries;
        if (fail) throw new Error('duplicate key / constraint');
      },
      audit: () => {},
    };
  }

  it('records when the confirmed digest matches', async () => {
    const rec = { calls: 0 };
    const r = await recordBaselineBatch({ batch: okBatch, confirmedDigest: okDigest, reconciledBy: 'op', reason: 'baseline sweep', deps: deps(rec) });
    expect(r.success).toBe(true);
    expect(r.recorded).toBe(2);
    expect(rec.calls).toBe(1);
  });

  it('rejects a tampered batch (digest mismatch) and writes NOTHING', async () => {
    const rec = { calls: 0 };
    const r = await recordBaselineBatch({ batch: okBatch, confirmedDigest: 'deadbeef', reconciledBy: 'op', reason: 'x', deps: deps(rec) });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/DIGEST_MISMATCH/);
    expect(rec.calls).toBe(0); // never touched the DB
  });

  it('requires a non-empty reason', async () => {
    const rec = { calls: 0 };
    const r = await recordBaselineBatch({ batch: okBatch, confirmedDigest: okDigest, reconciledBy: 'op', reason: '   ', deps: deps(rec) });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/REASON_REQUIRED/);
    expect(rec.calls).toBe(0);
  });

  it('refuses to record a batch with blocking issues', async () => {
    const bad = canon([review('001', 'UNKNOWN')]); // no note → blocking
    const rec = { calls: 0 };
    const r = await recordBaselineBatch({ batch: bad, confirmedDigest: computeBaselineBatchDigest(bad), reconciledBy: 'op', reason: 'x', deps: deps(rec) });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/BLOCKING_ISSUES/);
    expect(rec.calls).toBe(0);
  });

  it('surfaces a transaction failure as TRANSACTION_FAILED (all-or-nothing)', async () => {
    const rec = { calls: 0 };
    const r = await recordBaselineBatch({ batch: okBatch, confirmedDigest: okDigest, reconciledBy: 'op', reason: 'x', deps: deps(rec, true) });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/TRANSACTION_FAILED/);
  });

  it('is idempotent: identical confirmed batch replays to the same digest', async () => {
    const rec1 = { calls: 0 }; const rec2 = { calls: 0 };
    const r1 = await recordBaselineBatch({ batch: okBatch, confirmedDigest: okDigest, reconciledBy: 'op', reason: 'first', deps: deps(rec1) });
    const r2 = await recordBaselineBatch({ batch: okBatch, confirmedDigest: okDigest, reconciledBy: 'op', reason: 'replay', deps: deps(rec2) });
    expect(r1.digest).toBe(r2.digest);
    expect(r1.success && r2.success).toBe(true);
  });
});
