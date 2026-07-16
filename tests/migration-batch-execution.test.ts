// tests/migration-batch-execution.test.ts
//
// Commit 6 — Reviewed batch execution. Pure adversarial tests for the batch
// canonicalization (server-authoritative, manifest order) and the batch digest
// (tamper-evidence). The real-Postgres stop-on-first-failure orchestration is
// validated by migration-batch-execution-postgres.test.ts.

import { describe, it, expect } from 'vitest';
import {
  canonicalizeExecutionBatch,
  computeExecutionBatchDigest,
  batchExecutionOrder,
  serializeExecutionBatch,
  EXECUTION_BATCH_DIGEST_VERSION,
  type ServerExecutionEntry,
} from '../lib/migrations/executionBatch';

const SERVER: ServerExecutionEntry[] = [
  { identifier: '900', filename: '900_a.sql', checksumSha256: 'a'.repeat(64), transactionMode: 'REQUIRED', order: 0 },
  { identifier: '901', filename: '901_b.sql', checksumSha256: 'b'.repeat(64), transactionMode: 'REQUIRED', order: 1 },
  { identifier: '902', filename: '902_c.sql', checksumSha256: 'c'.repeat(64), transactionMode: 'FORBIDDEN', order: 2 },
];

const canon = (ids: string[], environment = 'development') =>
  canonicalizeExecutionBatch({ environment, serverEntries: SERVER, selectedIdentifiers: ids });

describe('Commit 6: batch canonicalization (server-authoritative)', () => {
  it('normalizes reordered client selection to canonical manifest order', () => {
    expect(batchExecutionOrder(canon(['902', '900', '901']))).toEqual(['900', '901', '902']);
  });
  it('same selection in any order yields the same digest', () => {
    expect(computeExecutionBatchDigest(canon(['901', '900']))).toBe(computeExecutionBatchDigest(canon(['900', '901'])));
  });
  it('rejects an unknown identifier', () => {
    expect(() => canon(['999'])).toThrow(/Unknown migration identifier/);
  });
  it('rejects a duplicate identifier', () => {
    expect(() => canon(['900', '900'])).toThrow(/Duplicate identifier/);
  });
  it('embeds the version tag', () => {
    expect(serializeExecutionBatch(canon(['900']))).toContain(EXECUTION_BATCH_DIGEST_VERSION);
  });
});

describe('Commit 6: batch digest is tamper-evident', () => {
  const base = computeExecutionBatchDigest(canon(['900', '901']));
  it('changes when the selected set changes', () => {
    expect(computeExecutionBatchDigest(canon(['900']))).not.toBe(base);
    expect(computeExecutionBatchDigest(canon(['900', '901', '902']))).not.toBe(base);
  });
  it('changes when the environment changes', () => {
    expect(computeExecutionBatchDigest(canon(['900', '901'], 'production'))).not.toBe(base);
  });
  it('changes when a member migration checksum changes (file edited)', () => {
    const tampered: ServerExecutionEntry[] = SERVER.map((e) =>
      e.identifier === '900' ? { ...e, checksumSha256: 'f'.repeat(64) } : e);
    const d = computeExecutionBatchDigest(
      canonicalizeExecutionBatch({ environment: 'development', serverEntries: tampered, selectedIdentifiers: ['900', '901'] }));
    expect(d).not.toBe(base);
  });
});
