// tests/migration-temporary-activation.test.ts
//
// Commit 4 — Bounded Activation. Pure tests for the server-side duration clamp
// (a client can never request a window above the maximum) and the activation
// limits. Run everywhere (no DB). The runtime expiry/relock/gate behavior on
// real Postgres is covered by migration-temporary-activation-postgres.test.ts.

import { describe, it, expect } from 'vitest';
import {
  clampActivationMinutes,
  ACTIVATION_DEFAULT_MINUTES,
  ACTIVATION_MAX_MINUTES,
  ACTIVATION_MIN_MINUTES,
} from '../lib/migrations/ledger';

describe('Commit 4: bounded-activation limits', () => {
  it('default is 10, max 15, min 1', () => {
    expect(ACTIVATION_DEFAULT_MINUTES).toBe(10);
    expect(ACTIVATION_MAX_MINUTES).toBe(15);
    expect(ACTIVATION_MIN_MINUTES).toBe(1);
  });
});

describe('Commit 4: clampActivationMinutes — client cannot exceed the maximum', () => {
  it('caps a request above the maximum at 15', () => {
    expect(clampActivationMinutes(60)).toBe(15);
    expect(clampActivationMinutes(9999)).toBe(15);
    expect(clampActivationMinutes(Number.MAX_SAFE_INTEGER)).toBe(15);
  });

  it('raises a request below the minimum to 1', () => {
    expect(clampActivationMinutes(0)).toBe(1);
    expect(clampActivationMinutes(-30)).toBe(1);
  });

  it('honors an in-range request', () => {
    expect(clampActivationMinutes(5)).toBe(5);
    expect(clampActivationMinutes(15)).toBe(15);
    expect(clampActivationMinutes(1)).toBe(1);
  });

  it('floors a fractional request', () => {
    expect(clampActivationMinutes(10.9)).toBe(10);
    expect(clampActivationMinutes(14.99)).toBe(14);
  });

  it('falls back to the default for non-finite / garbage input', () => {
    expect(clampActivationMinutes(undefined)).toBe(ACTIVATION_DEFAULT_MINUTES);
    expect(clampActivationMinutes(null)).toBe(ACTIVATION_DEFAULT_MINUTES);
    expect(clampActivationMinutes('abc')).toBe(ACTIVATION_DEFAULT_MINUTES);
    expect(clampActivationMinutes(NaN)).toBe(ACTIVATION_DEFAULT_MINUTES);
    expect(clampActivationMinutes(Infinity)).toBe(ACTIVATION_DEFAULT_MINUTES);
    expect(clampActivationMinutes({})).toBe(ACTIVATION_DEFAULT_MINUTES);
  });

  it('a string that parses to a number in range is honored (server-coerced, still clamped)', () => {
    expect(clampActivationMinutes('12')).toBe(12);
    expect(clampActivationMinutes('100')).toBe(15); // still clamped
  });
});
