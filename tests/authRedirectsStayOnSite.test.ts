/**
 * tests/authRedirectsStayOnSite.test.ts
 *
 * AFTER AUTHENTICATION THE BROWSER — AND THE SSO TOKEN — STAY WHERE WE SEND THEM.
 *
 *   · lib/safeRedirect.ts is the one rule for `?redirect=` after login/MFA.
 *     The MFA page had none (see tests/mfaRedirectStaysOnSite.test.tsx); the
 *     login page's prefix checks missed browser normalisation (`/\t/evil.com`
 *     parses as `//evil.com`).
 *   · /api/auth/authorize mints a 10-minute SSO JWT and redirects it to the
 *     caller-supplied redirect_uri. Its DEFAULT allowlist accepted `exp://`
 *     with ANY host — a logged-in user who opened a crafted link handed their
 *     token to an attacker's Expo project — and `com.underthesun.` as a bare
 *     prefix. The default is now the production app scheme only, and Expo Go's
 *     shared hosts are refused even when listed (lib/ssoRedirectAllowlist.ts).
 *   · A logged-out user was bounced to /auth/login?next=…, which the login
 *     page ignores (it reads `redirect`), so SSO never resumed after login.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ getUserFromRequest: vi.fn(() => null) }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => Object.assign(
    (_s: TemplateStringsArray, ..._v: unknown[]) => Promise.resolve([]), {})),
}));

import { NextRequest }        from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { GET as AUTHORIZE }   from '@/app/api/auth/authorize/route';
import { safeRelativeRedirect } from '@/lib/safeRedirect';

describe('safeRelativeRedirect', () => {
  it.each([
    ['https://evil.example/x'], ['http://evil.example'], ['//evil.example/x'],
    ['/\\evil.example'], ['/\t/evil.example'], ['/\n/evil.example'], ['\\\\evil.example'],
    ['javascript:alert(1)'], ['data:text/html,<script>1</script>'], [' /dashboard'],
    ['evil.example'], [''], [null], [undefined],
  ])('refuses %j', (raw) => {
    expect(safeRelativeRedirect(raw as string, '/dashboard')).toBe('/dashboard');
  });

  it.each([
    ['/dashboard', '/dashboard'],
    ['/projects/123?tab=design#roof', '/projects/123?tab=design#roof'],
    ['/api/auth/authorize?redirect_uri=sitesurvey%3A%2F%2Fauth%2Fcallback&state=x',
     '/api/auth/authorize?redirect_uri=sitesurvey%3A%2F%2Fauth%2Fcallback&state=x'],
  ])('keeps the same-site path %j', (raw, expected) => {
    expect(safeRelativeRedirect(raw)).toBe(expected);
  });
});

function authorizeReq(redirectUri: string) {
  const u = new URL('https://solarpro.solutions/api/auth/authorize');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', 'abc');
  return new NextRequest(u.toString(), { headers: { accept: 'application/json' } });
}

describe('🚨 /api/auth/authorize redirect_uri allowlist', () => {
  beforeEach(() => {
    vi.stubEnv('SOLARPRO_HANDOFF_SECRET', 'x'.repeat(48));
    vi.stubEnv('AUTHORIZE_ALLOWED_REDIRECTS', '');
    vi.mocked(getUserFromRequest).mockReturnValue({ id: 'u1', email: 'u@x.test', name: 'U' } as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('the default allowlist refuses an Expo URL on an attacker host — no token is minted', async () => {
    const res = await AUTHORIZE(authorizeReq('exp://attacker.example:8081/--/auth/callback'));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('the default allowlist refuses a lookalike bundle-id scheme', async () => {
    const res = await AUTHORIZE(authorizeReq('com.underthesun.evil://auth/callback'));
    expect(res.status).toBe(400);
  });

  it('the production app scheme still works by default', async () => {
    const res = await AUTHORIZE(authorizeReq('sitesurvey://auth/callback'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^sitesurvey:\/\/auth\/callback\?/);
  });

  it('a bare exp:// in the override is ignored — it would admit any Expo host', async () => {
    vi.stubEnv('AUTHORIZE_ALLOWED_REDIRECTS', 'sitesurvey://,exp://,com.underthesun.');
    const res = await AUTHORIZE(authorizeReq('exp://attacker.example:8081/--/auth/callback'));
    expect(res.status).toBe(400);
  });

  it("Expo's shared update host is refused even when listed — anyone can publish there", async () => {
    vi.stubEnv('AUTHORIZE_ALLOWED_REDIRECTS', 'sitesurvey://,exp://u.expo.dev/update/');
    const res = await AUTHORIZE(authorizeReq('exp://u.expo.dev/update/attacker-update-id/--/login'));
    expect(res.status).toBe(400);
  });

  it('a specific development host an operator lists is still admitted', async () => {
    vi.stubEnv('AUTHORIZE_ALLOWED_REDIRECTS', 'sitesurvey://,exp://192.168.1.20:8081');
    const res = await AUTHORIZE(authorizeReq('exp://192.168.1.20:8081/--/auth/callback'));
    expect(res.status).toBe(302);
  });

  it('the refusal no longer tells operators to allow exp:// everywhere', async () => {
    const res  = await AUTHORIZE(authorizeReq('exp://attacker.example:8081/--/auth/callback'));
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/sitesurvey:\/\/,exp:\/\//);
    expect(body).not.toMatch(/"exp:\/\/"/);
  });
});

describe('🚨 a logged-out SSO request resumes after login', () => {
  beforeEach(() => {
    vi.stubEnv('SOLARPRO_HANDOFF_SECRET', 'x'.repeat(48));
    vi.mocked(getUserFromRequest).mockReturnValue(null as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('bounces to /auth/login with the parameter the login page actually reads', async () => {
    const res = await AUTHORIZE(authorizeReq('sitesurvey://auth/callback'));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/auth/login');
    const back = loc.searchParams.get('redirect');
    expect(back).toMatch(/^\/api\/auth\/authorize\?/);
    // …and the login page's own rule accepts it unchanged.
    expect(safeRelativeRedirect(back)).toBe(back);
  });
});
