/**
 * tests/admin-override-env.test.ts
 *
 * F-13 — verify the admin override email is read from env, fails closed
 * when missing, and does NOT fall back to a hardcoded default.
 *
 * Background: `carpenterjames88@gmail.com` was hardcoded as the team-member
 * free-pass email in app/api/migrate/route.ts (F-13 in
 * AI-AGENT-README §11). F-13 moved the value to ADMIN_OVERRIDE_EMAIL env var
 * and the helper in lib/auth.ts getAdminOverrideEmail() enforces fail-closed.
 *
 * The "no hardcoded fallback" test is the regression guard: if anyone ever
 * re-introduces a default value in getAdminOverrideEmail(), the email leaks
 * back into source and this test catches it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAdminOverrideEmail } from '../lib/auth';

describe('getAdminOverrideEmail — F-13 admin override env var', () => {
  const SAVED_ENV = process.env.ADMIN_OVERRIDE_EMAIL;

  beforeEach(() => {
    // Start each test from a known state: env var is unset.
    delete process.env.ADMIN_OVERRIDE_EMAIL;
  });

  afterEach(() => {
    // Restore whatever the test runner had, so we don't leak state.
    if (SAVED_ENV === undefined) {
      delete process.env.ADMIN_OVERRIDE_EMAIL;
    } else {
      process.env.ADMIN_OVERRIDE_EMAIL = SAVED_ENV;
    }
  });

  it('returns the env var value when set', () => {
    process.env.ADMIN_OVERRIDE_EMAIL = 'james@example.com';
    expect(getAdminOverrideEmail()).toBe('james@example.com');
  });

  it('trims whitespace from the env var value', () => {
    process.env.ADMIN_OVERRIDE_EMAIL = '  james@example.com  ';
    expect(getAdminOverrideEmail()).toBe('james@example.com');
  });

  it('throws when env var is missing (fail-closed)', () => {
    // beforeEach deleted the var; explicitly double-check
    delete process.env.ADMIN_OVERRIDE_EMAIL;
    expect(() => getAdminOverrideEmail()).toThrow(/ADMIN_OVERRIDE_EMAIL env var is required/);
  });

  it('throws when env var is empty string', () => {
    process.env.ADMIN_OVERRIDE_EMAIL = '';
    expect(() => getAdminOverrideEmail()).toThrow(/ADMIN_OVERRIDE_EMAIL env var is required/);
  });

  it('throws when env var is whitespace only', () => {
    process.env.ADMIN_OVERRIDE_EMAIL = '   ';
    expect(() => getAdminOverrideEmail()).toThrow(/ADMIN_OVERRIDE_EMAIL env var is required/);
  });

  it('error message points the operator at AI-AGENT-README §6', () => {
    // The error must be self-documenting — a missing env var should
    // immediately tell the operator where to look (no guesswork).
    delete process.env.ADMIN_OVERRIDE_EMAIL;
    expect(() => getAdminOverrideEmail()).toThrow(/AI-AGENT-README\.md §6/);
  });

  it('does NOT fall back to a hardcoded email (regression guard)', () => {
    // F-13's whole point: the value must come from env, never from a default
    // in source. If anyone ever adds a fallback like:
    //   return process.env.ADMIN_OVERRIDE_EMAIL ?? 'carpenterjames88@gmail.com'
    // ...this test fails.
    delete process.env.ADMIN_OVERRIDE_EMAIL;
    let result: string | null = null;
    let threw = false;
    try {
      result = getAdminOverrideEmail();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(result).toBeNull();
    expect(result).not.toBe('carpenterjames88@gmail.com');
  });
});
