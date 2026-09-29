/**
 * tests/priority-sso-authorize.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * CI guard for the /api/auth/authorize redirect_uri allowlist.
 *
 * HISTORY. This suite was written after partners-bot reported Expo Go SSO
 * being refused ("redirect_uri is not in the allowlist"), and it pinned the
 * fix of the day: default to `sitesurvey://`, bare `exp://` and the bare prefix
 * `com.underthesun.`. That fix is what made the route hand a freshly minted,
 * 10-minute SSO token to ANY Expo host — a logged-in user who opened a crafted
 * link sent their sign-in to an attacker's Expo project. `exp://u.expo.dev/…`
 * (the partners-bot URL) is no narrower: anyone can publish an EAS update there.
 *
 * THE RULE NOW (lib/ssoRedirectAllowlist.ts — imported here, no longer
 * re-implemented in this file where it could drift):
 *   1. default: `sitesurvey://` only (the production app's own scheme);
 *   2. AUTHORIZE_ALLOWED_REDIRECTS replaces the default, but a bare `exp://`
 *      and any `exp://u.expo.dev…` entry are ignored;
 *   3. a specific development host an operator lists is admitted;
 *   4. matching is exact-prefix, never substring;
 *   5. the route and .env.example no longer tell operators to add `exp://`.
 * Expo Go testing should use a development build with the `sitesurvey://`
 * scheme, which the default already admits.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_ALLOWED_REDIRECT_PREFIXES, parseAllowedRedirectPrefixes, isRedirectAllowed,
} from '@/lib/ssoRedirectAllowlist';

const root = path.resolve(__dirname, '..');
const PARTNERS_BOT_URI = 'exp://u.expo.dev/update/019e37fd-72e0-7d02-bf96-fd09456d1acf/--/login';

describe('authorize — default allowlist', () => {
  it('is exactly the production app scheme', () => {
    expect([...DEFAULT_ALLOWED_REDIRECT_PREFIXES]).toEqual(['sitesurvey://']);
  });

  const { allowed } = parseAllowedRedirectPrefixes(undefined);

  it.each(['sitesurvey://login', 'sitesurvey://login?state=abc', 'sitesurvey://auth/callback'])(
    'accepts %s', (uri) => expect(isRedirectAllowed(uri, allowed)).toBe(true));

  it.each([
    'exp://localhost:19000', PARTNERS_BOT_URI, 'exp://192.168.1.100:8081', 'exp://exp.host/@user/app',
    'com.underthesun.sitesurvey://login', 'com.underthesun.evil://callback',
    'https://evil.com/sitesurvey://', 'https://evil.com', 'http://localhost:3000', '',
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
  ])('refuses %s', (uri) => expect(isRedirectAllowed(uri, allowed)).toBe(false));
});

describe('authorize — env-var override parsing', () => {
  it.each([[''], [undefined], ['   ']])('%j falls back to the default', (v) => {
    expect(parseAllowedRedirectPrefixes(v as string).allowed).toEqual(['sitesurvey://']);
  });

  it('trims and drops empty segments', () => {
    expect(parseAllowedRedirectPrefixes(' sitesurvey:// , com.underthesun.app:// ,').allowed)
      .toEqual(['sitesurvey://', 'com.underthesun.app://']);
  });

  it('🚨 the old "fix" value no longer admits Expo Go: bare exp:// is ignored', () => {
    const r = parseAllowedRedirectPrefixes('sitesurvey://,exp://,com.underthesun.');
    expect(r.ignored).toEqual(['exp://']);
    expect(isRedirectAllowed('exp://attacker.example:8081/--/login', r.allowed)).toBe(false);
    expect(isRedirectAllowed(PARTNERS_BOT_URI, r.allowed)).toBe(false);
    expect(isRedirectAllowed('sitesurvey://login', r.allowed)).toBe(true);
  });

  it('🚨 Expo\'s shared update host is ignored even when listed explicitly', () => {
    for (const v of ['exp://u.expo.dev', 'exp://u.expo.dev/', 'exp://u.expo.dev/update/', 'EXPS://u.expo.dev:443/x']) {
      const r = parseAllowedRedirectPrefixes(`sitesurvey://,${v}`);
      expect(r.ignored).toEqual([v]);
    }
  });

  it('a specific development host is admitted — and only that host', () => {
    const r = parseAllowedRedirectPrefixes('sitesurvey://,exp://192.168.1.100:8081');
    expect(r.ignored).toEqual([]);
    expect(isRedirectAllowed('exp://192.168.1.100:8081/--/login', r.allowed)).toBe(true);
    expect(isRedirectAllowed('exp://192.168.1.101:8081/--/login', r.allowed)).toBe(false);
  });

  it('a lookalike host is not the shared Expo host', () => {
    expect(parseAllowedRedirectPrefixes('exp://u.expo.devices.example').ignored).toEqual([]);
  });
});

describe('authorize — source and config integrity', () => {
  const routeSource = fs.readFileSync(path.join(root, 'app/api/auth/authorize/route.ts'), 'utf8');
  const envExample  = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

  it('the route uses the shared allowlist module', () => {
    expect(routeSource).toContain("from '@/lib/ssoRedirectAllowlist'");
    expect(routeSource).toContain('parseAllowedRedirectPrefixes(');
  });

  it('the route error responses keep a fix hint but no longer recommend exp://', () => {
    expect(routeSource).toContain('fix:');
    expect(routeSource).not.toContain('sitesurvey://,exp://');
  });

  it('.env.example does not recommend exp:// for AUTHORIZE_ALLOWED_REDIRECTS', () => {
    const line = envExample.split('\n').find(l => l.startsWith('AUTHORIZE_ALLOWED_REDIRECTS='));
    expect(line).toBeDefined();
    expect(line).toContain('sitesurvey://');
    expect(line).not.toContain('exp://');
  });
});
