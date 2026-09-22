/**
 * tests/devAuthIdentity.test.ts
 *
 * THE DEV BYPASS COULD AUTHENTICATE AND THEN NOT CREATE A PROJECT.
 *
 * Found by an end-to-end run, the first time the bypass actually reached a
 * database. `DEV_SESSION_USER.id` was the string 'dev-user-bypass-001';
 * `projects.user_id` is a UUID column and the route validates it, so every
 * create through the real route came back
 *
 *     Invalid userId: "dev-user-bypass-001" is not a valid UUID
 *
 * mapped to a 503 by the transient-error handler. A bypass whose whole purpose
 * is to exercise real routes locally could not exercise the first one.
 *
 * 🚨 AND THE IDENTITY WAS WRITTEN OUT FOUR TIMES. Three survey routes compared
 * `user.id === 'dev-user-bypass-001'` to grant `bypassOwnershipCheck`, and the
 * login route signed a token with a fourth copy. So setting `DEV_AUTH_USER_ID`
 * made three of them false while the fourth still authenticated, and signing in
 * through the FORM produced a different user from the header path — a project
 * created by one was invisible to the other.
 *
 * These guards are deliberately about the production guards too: a bypass is a
 * hole by design, and the thing that makes it safe is that it can never open on
 * a production deployment.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  DEV_SESSION_USER, DEV_BYPASS_USER_ID, isDevBypassUser,
  isDevAuthAllowed, requestHasDevAuthHeader, getDevSessionUser,
} from '@/lib/dev-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ROUTES = [
  'app/api/site-surveys/[surveyId]/geometry-reconstruction/start/route.ts',
  'app/api/site-surveys/[surveyId]/google-solar-api/route.ts',
  'app/api/site-surveys/[surveyId]/unified-geometry/bundle/route.ts',
];

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the dev user can actually be written to the database', () => {
  it('its id is a valid UUID', () => {
    expect(DEV_BYPASS_USER_ID).toMatch(UUID_RE);
    expect(DEV_SESSION_USER.id).toMatch(UUID_RE);
    // 🚨 THE OLD VALUE, ASSERTED AGAINST. This is the string the route
    // rejected; a regression to anything like it fails here rather than in a
    // 503 nobody reads.
    expect(DEV_SESSION_USER.id).not.toBe('dev-user-bypass-001');
  });

  it('it is deterministic, so a local database keeps one dev user across runs', () => {
    expect(DEV_BYPASS_USER_ID).toBe('00000000-0000-4000-8000-000000000001');
  });
});

describe('🚨 the identity has ONE definition', () => {
  it('isDevBypassUser answers for whatever the id currently is', () => {
    expect(isDevBypassUser(DEV_SESSION_USER.id)).toBe(true);
    expect(isDevBypassUser('someone-else')).toBe(false);
    expect(isDevBypassUser('')).toBe(false);
    expect(isDevBypassUser(null)).toBe(false);
    expect(isDevBypassUser(undefined)).toBe(false);
  });

  it('no route hand-writes the id any more', () => {
    for (const rel of [...ROUTES, 'app/api/auth/login/route.ts']) {
      expect(strip(read(rel)), `${rel} still hard-codes the dev id`)
        .not.toMatch(/'dev-user-bypass-001'/);
    }
  });

  it('the three ownership bypasses go through the helper', () => {
    for (const rel of ROUTES) {
      const src = strip(read(rel));
      expect(src, `${rel} does not use isDevBypassUser`)
        .toMatch(/bypassOwnershipCheck: isDevBypassUser\(user\.id\)/);
      expect(src, `${rel} does not import it`).toMatch(/from '@\/lib\/dev-auth'/);
    }
  });

  it('🚨 the login form signs the SAME user the header bypass produces', () => {
    // Two dev users is worse than one: a project created through the form was
    // invisible to a request using the header, and nothing said why.
    expect(strip(read('app/api/auth/login/route.ts')))
      .toMatch(/id:\s*DEV_SESSION_USER\.id/);
  });
});

describe('🚨 the production guards are unchanged', () => {
  it('a Vercel PRODUCTION deployment can never use it, even with the flag on', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DEV_AUTH_BYPASS = 'true';
    expect(isDevAuthAllowed()).toBe(false);
    expect(getDevSessionUser({ get: () => 'bypass' })).toBeNull();
  });

  it('it is off unless explicitly opted into', () => {
    delete process.env.VERCEL_ENV;
    delete process.env.DEV_AUTH_BYPASS;
    expect(isDevAuthAllowed()).toBe(false);
    process.env.DEV_AUTH_BYPASS = 'false';
    expect(isDevAuthAllowed()).toBe(false);
    process.env.DEV_AUTH_BYPASS = 'TRUE';   // exact match, not truthiness
    expect(isDevAuthAllowed()).toBe(false);
    process.env.DEV_AUTH_BYPASS = 'true';
    expect(isDevAuthAllowed()).toBe(true);
  });

  it('🚨 the env var alone is not enough — the header is still required', () => {
    delete process.env.VERCEL_ENV;
    process.env.DEV_AUTH_BYPASS = 'true';
    // Without the header, real auth proceeds. That is what stops a signed-in
    // user being silently replaced by the dev user.
    expect(getDevSessionUser({ get: () => null })).toBeNull();
    expect(getDevSessionUser(null)).toBeNull();
    expect(requestHasDevAuthHeader({ get: () => 'bypass' })).toBe(true);
    expect(requestHasDevAuthHeader({ get: () => 'BYPASS' })).toBe(true);
    expect(requestHasDevAuthHeader({ get: () => 'nope' })).toBe(false);
    const u = getDevSessionUser({ get: () => 'bypass' });
    expect(u?.id).toBe(DEV_SESSION_USER.id);
  });
});
