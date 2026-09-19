/**
 * tests/featureFlagHotPathCache.test.ts
 *
 * THE DEFECT THIS PINS (2026-09-18 adversarial review, finding A).
 * app/layout.tsx is the ROOT layout — it renders for every request to every
 * page — and it became `async` solely to `await getSolarDogEnabled()`. That
 * helper went straight to Neon with no memo, so shipping it put a DB
 * round-trip on the critical path of every page load in production; and
 * because migration 121 has never been applied, `app_feature_flags` does not
 * exist, so what it actually put there was a FAILED connection plus a
 * console.warn, once per request, forever.
 *
 * The suite was green through all of that: nothing ever called the helper
 * twice and counted the reads. These tests do exactly that.
 *
 * They are written against the SEAM (lib/db/core.getDbReady), not against a
 * live database — the assertion is a CALL COUNT, which is the property that
 * was broken. Every case below fails against the pre-fix module:
 *   - 'one DB read'          → received 5
 *   - 'concurrent renders'   → received 4
 *   - 'missing table'        → received 4 (4 failed connections, 4 warn lines)
 * while the TTL-expiry and invalidation cases pass both before and after and
 * are here to prove the cache did not break the thing it must not break:
 * an admin flip still lands without a redeploy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── The seam ────────────────────────────────────────────────────────────────
// getDbReady is what every read in lib/db/featureFlags.ts goes through, so
// counting its calls counts DB round-trips exactly. `sqlSpy` counts the
// tagged-template executions underneath it, so a change that called getDbReady
// once and then queried in a loop could not hide.
const getDbReadySpy = vi.fn();
const sqlSpy = vi.fn();

vi.mock('@/lib/db/core', () => ({
  getDbReady: (...args: unknown[]) => getDbReadySpy(...args),
  handleRouteDbError: () => undefined,
}));

/** A stand-in for Neon's tagged-template executor. `rows` is what the SELECT
 *  in getFeatureFlag resolves to — [] means "no DB row for this flag". */
function sqlReturning(rows: unknown[]) {
  return (...args: unknown[]) => {
    sqlSpy(...args);
    return Promise.resolve(rows);
  };
}

/** Fresh module per test: the cache is module-level state by design (that is
 *  what survives across requests inside one Vercel lambda), so it has to be
 *  re-created rather than reached into. */
async function loadFeatureFlags() {
  vi.resetModules();
  return import('@/lib/db/featureFlags');
}

const ORIGINAL_SOLARDOG_ENV = process.env.SOLARDOG_ENABLED;

beforeEach(() => {
  getDbReadySpy.mockReset();
  sqlSpy.mockReset();
  getDbReadySpy.mockResolvedValue(sqlReturning([]));
  delete process.env.SOLARDOG_ENABLED;
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_SOLARDOG_ENV === undefined) delete process.env.SOLARDOG_ENABLED;
  else process.env.SOLARDOG_ENABLED = ORIGINAL_SOLARDOG_ENV;
});

describe('feature-flag hot path — the root layout must not query Neon per request', () => {
  it('resolves five sequential renders with ONE DB read', async () => {
    const { getSolarDogEnabled } = await loadFeatureFlags();

    for (let i = 0; i < 5; i++) await getSolarDogEnabled();

    // Pre-fix this is 5 — one round-trip per page load, which is the defect.
    expect(getDbReadySpy).toHaveBeenCalledTimes(1);
    expect(sqlSpy).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent renders during a cold start into ONE query', async () => {
    // A cold lambda taking four simultaneous requests must not open four
    // connections; the memo holds the in-flight PROMISE, not just the value.
    let release: (rows: unknown[]) => void = () => undefined;
    const pending = new Promise<unknown[]>((resolve) => { release = resolve; });
    getDbReadySpy.mockResolvedValue((...args: unknown[]) => { sqlSpy(...args); return pending; });

    const { getSolarDogEnabled } = await loadFeatureFlags();
    const all = Promise.all([
      getSolarDogEnabled(), getSolarDogEnabled(),
      getSolarDogEnabled(), getSolarDogEnabled(),
    ]);
    release([]);
    await all;

    expect(getDbReadySpy).toHaveBeenCalledTimes(1);
  });

  it('serves the DB row when there is one, and still only reads once', async () => {
    getDbReadySpy.mockResolvedValue(sqlReturning([{ enabled: true }]));
    const { getFeatureFlag } = await loadFeatureFlags();

    const a = await getFeatureFlag('solardog_enabled', () => false);
    const b = await getFeatureFlag('solardog_enabled', () => false);

    // Precedence is untouched: a DB row still beats the env resolver.
    expect(a).toEqual({ enabled: true, source: 'db' });
    expect(b).toEqual({ enabled: true, source: 'db' });
    expect(getDbReadySpy).toHaveBeenCalledTimes(1);
  });
});

describe('feature-flag hot path — fail-closed semantics are unchanged', () => {
  it('still falls through DB → env → off when app_feature_flags is missing', async () => {
    // Exactly today's production state: migration 121 is unregistered with the
    // runner, so the table does not exist and every read throws.
    getDbReadySpy.mockRejectedValue(new Error('relation "app_feature_flags" does not exist'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    process.env.SOLARDOG_ENABLED = 'true';
    const { getSolarDogEnabled, getFeatureFlag } = await loadFeatureFlags();

    for (let i = 0; i < 4; i++) expect(await getSolarDogEnabled()).toBe(true);
    // ...and the failure itself is what must stop repeating: pre-fix this was
    // four failed connections and four warn lines, one per page load.
    expect(getDbReadySpy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    // No env resolver at all ⇒ off, not a throw.
    expect(await getFeatureFlag('some_other_flag')).toEqual({ enabled: false, source: 'default' });
    warn.mockRestore();
  });

  it('resolves to the env var when the flag has no DB row', async () => {
    process.env.SOLARDOG_ENABLED = 'true';
    const { getSolarDogEnabled } = await loadFeatureFlags();
    expect(await getSolarDogEnabled()).toBe(true);

    // and anything that is not the literal string 'true' is off
    for (const v of ['TRUE', '1', 'yes', '']) {
      process.env.SOLARDOG_ENABLED = v;
      const mod = await loadFeatureFlags();
      expect(await mod.getSolarDogEnabled(), `env value ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

describe('feature-flag hot path — an admin flip still lands without a redeploy', () => {
  it('re-reads once the TTL has elapsed', async () => {
    vi.useFakeTimers();
    const { getSolarDogEnabled, FLAG_CACHE_TTL_MS } = await loadFeatureFlags();

    // The TTL is the bound on staleness. A per-process memo with no expiry
    // would pin the flag until the next deploy — the behaviour the layout's
    // comment explicitly promises against.
    expect(FLAG_CACHE_TTL_MS).toBeGreaterThan(0);
    expect(FLAG_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);

    await getSolarDogEnabled();
    expect(getDbReadySpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FLAG_CACHE_TTL_MS - 1);
    await getSolarDogEnabled();
    expect(getDbReadySpy).toHaveBeenCalledTimes(1);

    getDbReadySpy.mockResolvedValue(sqlReturning([{ enabled: true }]));
    vi.advanceTimersByTime(2);
    expect(await getSolarDogEnabled()).toBe(true);
    expect(getDbReadySpy).toHaveBeenCalledTimes(2);
  });

  it('drops the memo as soon as setFeatureFlag writes the key', async () => {
    const { getSolarDogEnabled, setFeatureFlag } = await loadFeatureFlags();

    expect(await getSolarDogEnabled()).toBe(false);
    expect(getDbReadySpy).toHaveBeenCalledTimes(1);

    getDbReadySpy.mockResolvedValue(sqlReturning([{
      id: 'solardog_enabled', flag_key: 'solardog_enabled', description: '',
      enabled: true, updated_at: new Date(), updated_by_user_id: 'admin-1', created_at: new Date(),
    }]));
    await setFeatureFlag('solardog_enabled', true, 'admin-1');

    // The instance that served the write sees it immediately, not in 30s.
    expect(await getSolarDogEnabled()).toBe(true);
  });

  it('invalidateFeatureFlagCache clears one key or all of them', async () => {
    const { getFeatureFlag, invalidateFeatureFlagCache } = await loadFeatureFlags();

    await getFeatureFlag('a');
    await getFeatureFlag('b');
    expect(getDbReadySpy).toHaveBeenCalledTimes(2); // distinct keys are cached separately

    invalidateFeatureFlagCache('a');
    await getFeatureFlag('a');
    await getFeatureFlag('b');
    expect(getDbReadySpy).toHaveBeenCalledTimes(3); // only 'a' was re-read

    invalidateFeatureFlagCache();
    await getFeatureFlag('a');
    await getFeatureFlag('b');
    expect(getDbReadySpy).toHaveBeenCalledTimes(5);
  });
});
