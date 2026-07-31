/**
 * Tests for:
 *   Rate limiting on POST /api/proposals/[id]/sign
 *   — verifies the public e-signature endpoint has rate limiting
 *   — verifies the 'proposal-sign' key is in the CONFIG map (single source
 *     of truth since the 2026-08 fail-mode refactor)
 *   — verifies the local getClientIp was removed (uses imported one)
 *   — verifies checkRateLimit is called before body parsing
 *
 * All tests are source-code scanning (no DB / Redis connection needed).
 *
 * UPDATED 2026-08 for the rate-limiter fail-mode refactor. The previous
 * version of this test scanned for top-level constants like
 * `_proposalSignLimiter = makeLimiter(...)`. After the refactor, the
 * per-key limits live in the CONFIG map; we scan that instead.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';

// ─── helpers ─────────────────────────────────────────────────────────────────
const root = path.resolve(__dirname, '..');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// ─── rateLimiter.ts: 'proposal-sign' key in CONFIG ───────────────────────────
describe("rateLimiter.ts — 'proposal-sign' key in CONFIG", () => {
  const src = readSrc('lib/rateLimiter.ts');

  it("LimiterKey union includes 'proposal-sign'", () => {
    expect(src).toContain("'proposal-sign'");
  });

  it("CONFIG map has a 'proposal-sign' entry with a tight limit (≤ 10 requests)", () => {
    // Match either form:  'proposal-sign': { requests: N, ... }
    // or                   'proposal-sign':   { requests: N, ... }
    const match = src.match(/'proposal-sign'\s*:\s*\{\s*requests:\s*(\d+)/);
    expect(match).not.toBeNull();
    const limit = parseInt(match![1], 10);
    expect(limit).toBeLessThanOrEqual(10);
    expect(limit).toBeGreaterThan(0);
  });

  it("CONFIG['proposal-sign'] has a 15-minute window (900_000 ms)", () => {
    // The previous behavior was 5 / 15m. Keep that contract.
    // Capture the windowMs expression up to the next comma or closing brace,
    // then normalize whitespace before comparing.
    const match = src.match(
      /'proposal-sign'\s*:\s*\{\s*requests:\s*\d+,\s*windowMs:\s*([^,}]+?)\s*[,\}]/
    );
    expect(match).not.toBeNull();
    const expr = match![1].replace(/\s+/g, '');
    // 15 minutes = 15 * 60_000 = 900_000 (or equivalent expression)
    const accepts = [
      '900000',
      '15*60_000',
      '15*60000',
      '15*60*1000',
    ];
    expect(accepts).toContain(expr);
  });

  it("CONFIG map is built into LIMITERS at module load", () => {
    expect(src).toContain('CONFIG');
    expect(src).toContain('LIMITERS');
  });
});

// ─── sign/route.ts: imports ──────────────────────────────────────────────────
describe('proposals/[id]/sign/route.ts — imports', () => {
  const src = readSrc('app/api/proposals/[id]/sign/route.ts');

  it('imports checkRateLimit from @/lib/rateLimiter', () => {
    expect(src).toContain("import { checkRateLimit");
    expect(src).toContain("'@/lib/rateLimiter'");
  });

  it('imports getClientIp from @/lib/rateLimiter', () => {
    expect(src).toContain('getClientIp');
    expect(src).toContain("'@/lib/rateLimiter'");
  });

  it('does NOT define a local getClientIp function', () => {
    // The local helper was removed in favour of the shared import
    expect(src).not.toContain('function getClientIp');
  });
});

// ─── sign/route.ts: rate limit call ──────────────────────────────────────────
describe('proposals/[id]/sign/route.ts — rate limiting logic', () => {
  const src = readSrc('app/api/proposals/[id]/sign/route.ts');

  it("calls checkRateLimit with 'proposal-sign'", () => {
    expect(src).toContain("checkRateLimit('proposal-sign'");
  });

  it('passes the client IP to checkRateLimit', () => {
    expect(src).toContain('getClientIp(req)');
    // The result is stored and reused
    expect(src).toContain('const ip = getClientIp(req)');
  });

  it('returns 429 when rate limit is exceeded', () => {
    const rlIdx = src.indexOf("checkRateLimit('proposal-sign'");
    const after  = src.slice(rlIdx, rlIdx + 400);
    expect(after).toContain('429');
  });

  it('rate limit check appears before body parsing (req.json)', () => {
    const rlIdx   = src.indexOf("checkRateLimit('proposal-sign'");
    const jsonIdx = src.indexOf('req.json()');
    expect(rlIdx).toBeGreaterThan(0);
    expect(jsonIdx).toBeGreaterThan(0);
    expect(rlIdx).toBeLessThan(jsonIdx);
  });

  it('rate limit check appears before DB access (getDbReady)', () => {
    const rlIdx = src.indexOf("checkRateLimit('proposal-sign'");
    const dbIdx = src.indexOf('getDbReady()');
    expect(rlIdx).toBeGreaterThan(0);
    expect(dbIdx).toBeGreaterThan(0);
    expect(rlIdx).toBeLessThan(dbIdx);
  });

  it('reuses captured ip variable as signerIp (no second getClientIp call)', () => {
    // After the rate limit block, signerIp should be assigned from ip, not a fresh call
    expect(src).toContain('signerIp  = ip');
    // Should NOT call getClientIp a second time (only the one at the top)
    const occurrences = (src.match(/getClientIp\(req\)/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('rate limit 429 response includes a human-readable error message', () => {
    const rlIdx = src.indexOf("checkRateLimit('proposal-sign'");
    const after  = src.slice(rlIdx, rlIdx + 400);
    expect(after).toContain('Too many requests');
  });
});

// ─── sign/route.ts: unchanged core logic ────────────────────────────────────
describe('proposals/[id]/sign/route.ts — existing logic still present', () => {
  const src = readSrc('app/api/proposals/[id]/sign/route.ts');

  it('still validates signerName length', () => {
    expect(src).toContain('signerName.length < 2');
    expect(src).toContain('signerName.length > 200');
  });

  it('still checks agreedToTerms', () => {
    expect(src).toContain('agreedToTerms !== true');
  });

  it('still checks share_token if present', () => {
    expect(src).toContain('share_token');
    expect(src).toContain('Invalid access token');
  });

  it('still has idempotency check (409 already signed)', () => {
    expect(src).toContain('409');
    expect(src).toContain('already been signed');
  });

  it('still updates proposals table on success', () => {
    expect(src).toContain("status       = 'accepted'");
  });

  it('still advances homeowner_stage', () => {
    expect(src).toContain("homeowner_stage = 'installation'");
  });

  it('still fires installer notification email', () => {
    expect(src).toContain('sendProposalSignedEmail');
  });
});

// ─── coverage: GET /api/projects already has rate limit ─────────────────────
describe('GET /api/projects — rate limit (added in previous session)', () => {
  const src = readSrc('app/api/projects/route.ts');

  it('GET handler calls checkRateLimit', () => {
    const getIdx = src.indexOf('export async function GET');
    expect(getIdx).toBeGreaterThan(-1);
    const getBody = src.slice(getIdx, getIdx + 600);
    expect(getBody).toContain('checkRateLimit');
  });
});
