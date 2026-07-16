// tests/migration-operator-execution.test.ts
//
// Commit 5 — Reviewed single-migration execution. Pure adversarial tests for
// the execution-identity digest (tamper-evidence) and the eligibility
// assessment (every blocking condition). These run everywhere (no DB). The
// real-Postgres orchestration (dry-run → canonical run → verify from
// ledger+run-history → auto-relock) is validated by
// migration-operator-execution-postgres.test.ts.

import { describe, it, expect } from 'vitest';
import {
  buildExecutionIdentity,
  computeExecutionDigest,
  serializeExecutionIdentity,
  assessExecutionEligibility,
  EXECUTION_REVIEW_DIGEST_VERSION,
  type ExecutionEligibilityInput,
} from '../lib/migrations/executionReview';

const identity = (over: Partial<Parameters<typeof buildExecutionIdentity>[0]> = {}) =>
  buildExecutionIdentity({
    environment: 'development',
    identifier: '108',
    filename: '108_nearmap_ai_cache_latlng_idx.sql',
    checksumSha256: 'a'.repeat(64),
    transactionMode: 'REQUIRED',
    ...over,
  });

describe('Commit 5: execution-identity digest', () => {
  it('is deterministic for identical identity', () => {
    expect(computeExecutionDigest(identity())).toBe(computeExecutionDigest(identity()));
  });
  it('embeds the version tag', () => {
    expect(identity().version).toBe(EXECUTION_REVIEW_DIGEST_VERSION);
    expect(serializeExecutionIdentity(identity())).toContain(EXECUTION_REVIEW_DIGEST_VERSION);
  });
  it('changes when the identifier changes', () => {
    expect(computeExecutionDigest(identity({ identifier: '107' }))).not.toBe(computeExecutionDigest(identity()));
  });
  it('changes when the filename changes', () => {
    expect(computeExecutionDigest(identity({ filename: 'evil.sql' }))).not.toBe(computeExecutionDigest(identity()));
  });
  it('changes when the checksum changes (file edited after review)', () => {
    expect(computeExecutionDigest(identity({ checksumSha256: 'b'.repeat(64) }))).not.toBe(computeExecutionDigest(identity()));
  });
  it('changes when the transaction mode changes', () => {
    expect(computeExecutionDigest(identity({ transactionMode: 'FORBIDDEN' }))).not.toBe(computeExecutionDigest(identity()));
  });
  it('changes when the environment changes', () => {
    expect(computeExecutionDigest(identity({ environment: 'production' }))).not.toBe(computeExecutionDigest(identity()));
  });
});

const base: ExecutionEligibilityInput = {
  foundInManifest: true,
  currentStatus: null,          // pending
  hasChecksumConflict: false,
  transactionMode: 'REQUIRED',
  baselineStatus: 'CONFIRMED_NOT_APPLIED',
  hasValidActivationWindow: true,
  environmentAllowed: true,
  isProduction: false,
  productionExecutionAllowed: false,
};

describe('Commit 5: eligibility assessment — the eligible case', () => {
  it('a clean pending migration with a valid window is eligible', () => {
    const e = assessExecutionEligibility(base);
    expect(e.eligible).toBe(true);
    expect(e.blockReasons).toEqual([]);
  });
  it('a previously-failed migration is still eligible to retry', () => {
    expect(assessExecutionEligibility({ ...base, currentStatus: 'failed' }).eligible).toBe(true);
  });
});

describe('Commit 5: eligibility assessment — every blocking condition', () => {
  const cases: Array<[string, Partial<ExecutionEligibilityInput>, string]> = [
    ['not in manifest', { foundInManifest: false }, 'NOT_FOUND'],
    ['already applied', { currentStatus: 'applied' }, 'ALREADY_APPLIED'],
    ['running', { currentStatus: 'running' }, 'NOT_PENDING'],
    ['superseded', { currentStatus: 'superseded' }, 'NOT_PENDING'],
    ['checksum conflict', { hasChecksumConflict: true }, 'CHECKSUM_CONFLICT'],
    ['FORBIDDEN txn mode', { transactionMode: 'FORBIDDEN' }, 'FORBIDDEN'],
    ['no baseline row', { baselineStatus: null }, 'BASELINE_UNRECONCILED'],
    ['blocking baseline (UNKNOWN)', { baselineStatus: 'UNKNOWN' }, 'BASELINE_UNRECONCILED'],
    ['blocking baseline (PARTIALLY_APPLIED)', { baselineStatus: 'PARTIALLY_APPLIED' }, 'BASELINE_UNRECONCILED'],
    ['no active window', { hasValidActivationWindow: false }, 'NO_ACTIVE_WINDOW'],
    ['env not allowed', { environmentAllowed: false }, 'ENV_NOT_ALLOWED'],
  ];
  for (const [name, over, reason] of cases) {
    it(`blocks: ${name} → ${reason}`, () => {
      const e = assessExecutionEligibility({ ...base, ...over });
      expect(e.eligible).toBe(false);
      expect(e.blockReasons).toContain(reason);
    });
  }

  it('production without the two-key flag is blocked', () => {
    const e = assessExecutionEligibility({ ...base, isProduction: true, productionExecutionAllowed: false });
    expect(e.eligible).toBe(false);
    expect(e.blockReasons).toContain('PRODUCTION_DISABLED');
  });
  it('production WITH the two-key flag is not blocked on that ground', () => {
    const e = assessExecutionEligibility({ ...base, isProduction: true, productionExecutionAllowed: true });
    expect(e.blockReasons).not.toContain('PRODUCTION_DISABLED');
  });
  it('reports ALL blocking reasons at once (not short-circuited)', () => {
    const e = assessExecutionEligibility({
      ...base, foundInManifest: false, transactionMode: 'FORBIDDEN',
      hasValidActivationWindow: false, baselineStatus: null,
    });
    expect(e.blockReasons).toEqual(
      expect.arrayContaining(['NOT_FOUND', 'FORBIDDEN', 'BASELINE_UNRECONCILED', 'NO_ACTIVE_WINDOW']),
    );
  });
});
