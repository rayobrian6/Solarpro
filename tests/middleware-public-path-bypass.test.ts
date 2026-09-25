/**
 * middleware.ts — the '/' PUBLIC_PATHS entry.
 *
 * ⚠ THESE TESTS PIN A KNOWN DEFECT, ON PURPOSE. ⚠
 *
 * PUBLIC_PATHS lists '/' first, and the gate matches with
 *     PUBLIC_PATHS.some(p => pathname.startsWith(p))
 * Every pathname starts with '/', so that branch returns NextResponse.next()
 * for EVERY request and the session, CSRF and session-timeout checks below it
 * are unreachable. The middleware is not an auth gate today; the route handlers
 * are the sole auth authority (266 of 302 app/api route.ts files carry their
 * own check — the proposals GET was one of the ones that did not, fixed in
 * lib/proposalAccess.ts).
 *
 * It is NOT fixed here because turning the gate on with today's PUBLIC_PATHS
 * would lock out three live unauthenticated flows, none of which are listed:
 *
 *   1. the homeowner portal — /api/portal/dashboard, /api/portal/verify-otp,
 *      /api/portal/bill-upload authenticate with their OWN cookie via
 *      getPortalSession(); middleware only understands solarpro_session, so it
 *      would 401 every one of them
 *   2. the homeowner proposal view — /api/proposals/[id], .../sign, .../pdf,
 *      .../signature, reached by share token, not by session
 *   3. /api/settings/branding?proposalId=... — an explicit public-access path
 *      (see the "Public access path" branch in that route) the proposal view
 *      page calls to brand the page
 *
 * Fixing it is a scoped piece of work: audit every unauthenticated entry point,
 * add them to PUBLIC_PATHS, make '/' an exact match, then delete this file. If
 * you are here because these tests started FAILING, that is the good outcome —
 * the gate is live; confirm the three flows above still work.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const SRC = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');

describe("middleware.ts — '/' in PUBLIC_PATHS disables the gate (known, documented)", () => {

  it("still lists '/' as a PUBLIC_PATHS entry", () => {
    const list = SRC.slice(SRC.indexOf('const PUBLIC_PATHS'), SRC.indexOf('];', SRC.indexOf('const PUBLIC_PATHS')));
    expect(list).toMatch(/^\s*'\/',\s*$/m);
  });

  it('still matches PUBLIC_PATHS by prefix, which is what makes it match everything', () => {
    expect(SRC).toContain('PUBLIC_PATHS.some(p => pathname.startsWith(p))');
  });

  it('lets an unauthenticated API request through instead of returning 401', () => {
    const res = middleware(new NextRequest('http://localhost/api/projects'));
    // The session check further down would 401 this. It never runs.
    expect(res.status).not.toBe(401);
  });

  it('lets a cross-origin state-changing request through instead of returning 403', () => {
    const res = middleware(new NextRequest('http://localhost/api/projects', {
      method:  'POST',
      headers: { origin: 'https://attacker.example', host: 'localhost' },
    }));
    // The CSRF check further down would 403 this. It never runs either.
    expect(res.status).not.toBe(403);
  });

  it('does not redirect an unauthenticated page request to /auth/login', () => {
    const res = middleware(new NextRequest('http://localhost/projects'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('carries the comment that records this as a known state, not an oversight', () => {
    expect(SRC).toContain('KNOWN: this gate is currently open');
  });
});

describe('the route handlers are therefore the auth authority', () => {
  it('the proposals GET enforces its own access (see proposal-read-authorization.test.ts)', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/proposals/[id]/route.ts'), 'utf8');
    expect(route).toContain('authorizeProposalRead');
  });

  it('the proposals PDF route enforces its own access', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/proposals/[id]/pdf/route.ts'), 'utf8');
    expect(route).toContain('authorizeProposalRead');
  });
});
