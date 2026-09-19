/**
 * tests/dbReadyTestRunnerFastFail.test.ts
 *
 * THE DB PROBE MUST NOT BACK OFF UNDER A TEST RUNNER.
 *
 * WHAT THIS PREVENTS
 * ------------------
 * getDbWithRetry() probes `SELECT 1` and retries 5 times with exponential
 * backoff — 50 + 100 + 200 + 400 = 750ms per exhausted sequence. That budget
 * exists for ONE reason: to absorb a Neon cold start on a serverless instance,
 * where waiting 750ms beats failing the request.
 *
 * Under a test runner there is no sleeping database to wake. CI points
 * DATABASE_URL at `postgresql://test:test@localhost:5432/test` — a stub with
 * nothing listening, added so scripts/check-env.js passes without real
 * secrets. So every probe fails as a TRANSIENT error (connection refused, not
 * misconfigured), takes the full 750ms, and can never succeed.
 *
 * The first pull request opened against master in 81 days logged 820 exhausted
 * probe sequences — 4,099 failed attempts, ~615s of pure sleeping — and the
 * Unit Tests job hit its 10-minute `timeout-minutes` cap at 10m16s. GitHub
 * reports a timed-out job as `cancelled`, so it never even read as a failure.
 * The suite did not fail; it never FINISHED. Nobody had seen it because CI had
 * not run on this branch in 81 days.
 *
 * 🚨 If this test starts failing, the CI suite is about to stop finishing.
 * Do NOT fix it by raising timeout-minutes — that hides a quadratic-ish cost
 * behind a bigger number. Either keep the fast-fail, or stop the code under
 * test from reaching a real database.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('getDbWithRetry under a test runner', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is running under vitest (guards the premise of this whole file)', () => {
    expect(process.env.VITEST === 'true' || process.env.VITEST === '1').toBe(true);
  });

  it('probes ONCE and does not sleep, against an unreachable database', async () => {
    const { getDbWithRetry } = await import('@/lib/db-ready');

    const attempts: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      const line = String(args[0] ?? '');
      if (line.includes('DB_CONNECTION_ATTEMPT')) attempts.push(line);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const started = performance.now();
    await expect(getDbWithRetry()).rejects.toBeDefined();
    const elapsedMs = performance.now() - started;

    logSpy.mockRestore();

    // ONE attempt, not five.
    expect(attempts.length, `expected a single probe attempt, got:\n${attempts.join('\n')}`).toBe(1);

    // And no backoff. The old path slept 50+100+200+400 = 750ms before giving
    // up; generous ceiling here so a slow connect-refuse does not flake it,
    // while still failing loudly if the backoff ladder comes back.
    expect(elapsedMs, `probe took ${elapsedMs.toFixed(0)}ms — the backoff ladder is back`).toBeLessThan(700);
  });

  it('the 820-probe CI cost is what this saves', () => {
    // Recorded so the number is not lost: this is why the job timed out.
    const EXHAUSTED_SEQUENCES_IN_CI = 820;
    const OLD_BACKOFF_MS_PER_SEQUENCE = 50 + 100 + 200 + 400; // 750
    const oldSleepSeconds = (EXHAUSTED_SEQUENCES_IN_CI * OLD_BACKOFF_MS_PER_SEQUENCE) / 1000;
    const JOB_TIMEOUT_SECONDS = 10 * 60;

    expect(oldSleepSeconds).toBeCloseTo(615, 0);
    // Sleeping alone exceeded the entire job budget, before any test ran.
    expect(oldSleepSeconds).toBeGreaterThan(JOB_TIMEOUT_SECONDS);
  });
});
