// ═══════════════════════════════════════════════════════════════════════════
// LA §4 — THE CANONICAL PROJECT NAME, THROUGH THE REAL POST ROUTE.
//
// The MCC phase corrected the permit POST path to read the authoritative
// `projects.name` instead of the stale `engineering_config.projectName` mirror,
// but shipped it with only live/harness verification — the route itself had no
// regression coverage, and I said so. This is that coverage.
//
// It drives the ACTUAL exported POST handler with a faked database, so the
// assertion is about the production code path, not a reimplementation of it.
//
// WHAT THIS PINS:
//   • the route reads `projects.name`
//   • a stale mirror cannot override it
//   • a canonical name that legitimately contains "TEST" is PRESERVED, and the
//     non-production policy still catches it — the fix corrects source
//     authority, it does not strip strings
//   • snapshot identity, title blocks and the artifact filename all agree
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '4030b664-bebe-433b-a11c-cda05ead2f7d';

/** What `projects.name` returns for the next request. */
const db = { canonicalName: 'BRAIDON M PILLA — Solar' };

vi.mock('@/lib/auth', () => ({ getUserFromRequest: () => ({ id: OWNER_ID }) }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/pdf/generatePdf', () => ({ generatePdfFromHtml: async () => null }));
// The aerial/parcel enrichment reaches the network; the identity question does
// not depend on it, and leaving it live would make the test flaky and slow.
vi.mock('@/lib/aerial/parcelBoundary', () => ({ fetchParcelBoundary: async () => null }));
vi.mock('@/lib/aerial/nearmapCache', () => ({ getNearmapSurfacesCached: async () => null }));

vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: () => new Response(JSON.stringify({ success: false }), { status: 500 }),
  getDbReady: async () => {
    const sql = (strings: TemplateStringsArray) => {
      const q = strings.join(' ').replace(/\s+/g, ' ').trim();
      // The canonical-identity read added by MCC §2.
      if (/SELECT name FROM projects/i.test(q)) {
        return Promise.resolve(db.canonicalName === null ? [] : [{ name: db.canonicalName }]);
      }
      if (/FROM projects/i.test(q)) {
        return Promise.resolve([{
          id: PROJECT_ID, user_id: OWNER_ID, name: db.canonicalName,
          system_type: 'roof', canonical_snapshot: null, engineering_config: null,
          proj_sys_type: 'roof', layout_sys_type: 'roof',
        }]);
      }
      return Promise.resolve([]);
    };
    return sql;
  },
}));

// Hoisted above this import, so the handler binds to the fakes.
import { POST } from '@/app/api/engineering/permit/route';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** A NextRequest-shaped stub carrying the permit body. The handler reads
 *  `req.nextUrl.searchParams`, so a bare Request is not enough. */
function req(body: unknown, format = 'html') {
  const url = new URL(`http://localhost/api/engineering/permit?format=${format}`);
  return {
    nextUrl: url,
    url: url.toString(),
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as never;
}

/** POST the fixture with a deliberately stale mirror name. */
async function generate(staleMirrorName: string) {
  const body = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  body.projectId = PROJECT_ID;
  body.generatedAtIso = '2026-08-04T12:00:00Z';
  (body.project as Record<string, unknown>).projectName = staleMirrorName;
  const res = await POST(req(body));
  const html = await res.text();
  return { res, html };
}

describe('LA §4 · the permit POST route uses the canonical project record', () => {
  beforeEach(() => { db.canonicalName = 'BRAIDON M PILLA — Solar'; });

  it('the authoritative projects.name replaces a stale engineering_config mirror', async () => {
    const { res, html } = await generate('BRAIDON M PILLA — Solar TEST');
    expect(res.status).toBe(200);
    // The corrected identity reaches the rendered package…
    expect(html).toContain('BRAIDON M PILLA — Solar');
    // …and the stale suffix is gone from it entirely.
    expect(html).not.toContain('Solar TEST');
  }, 120_000);

  it('the artifact FILENAME agrees with the canonical identity', async () => {
    const { res } = await generate('BRAIDON M PILLA — Solar TEST');
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).not.toMatch(/TEST/i);
    expect(cd.toUpperCase()).toContain('BRAIDON');
  }, 120_000);

  it('the SNAPSHOT identity carries the canonical name, not the mirror', async () => {
    // Two POSTs whose ONLY difference is the stale mirror must produce the same
    // design digest: the mirror is not project identity and may not move it.
    const a = await generate('BRAIDON M PILLA — Solar TEST');
    const b = await generate('completely different stale mirror value');
    const digestOf = (h: string) => (h.match(/SHA-256 ([0-9a-f]{12,})/) ?? [])[1] ?? null;
    expect(digestOf(a.html)).not.toBeNull();
    expect(digestOf(b.html)).toBe(digestOf(a.html));
  }, 120_000);

  it('a canonical name that legitimately contains TEST is PRESERVED, and the policy still fires', async () => {
    // THE ANTI-REGRESSION. The repair corrects which field is authoritative; it
    // must never manipulate the string. A real project named "…TEST" keeps its
    // name — and the non-production policy still catches it.
    //
    // Asserted BEHAVIOURALLY rather than by text match: the same design, named
    // two ways, must differ by exactly the one non-production requirement.
    const clean = await generate('stale mirror');
    db.canonicalName = 'NORTHSIDE TEST RANGE — Solar';
    const tested = await generate('stale mirror');

    expect(tested.html).toContain('NORTHSIDE TEST RANGE — Solar');   // preserved verbatim
    const count = (h: string) => Number((h.match(/(\d+)\s+UNRESOLVED REQUIREMENTS/) ?? [])[1] ?? NaN);
    expect(count(clean.html)).toBeGreaterThan(0);
    expect(count(tested.html)).toBe(count(clean.html) + 1);          // the policy fired
  }, 120_000);

  it('a BLANK canonical name is not authority — the posted value stands', async () => {
    db.canonicalName = '   ';
    const { html } = await generate('POSTED FALLBACK NAME');
    expect(html).toContain('POSTED FALLBACK NAME');
  }, 120_000);

  it('no project row at all leaves the posted value untouched', async () => {
    db.canonicalName = null as unknown as string;
    const { html } = await generate('POSTED FALLBACK NAME');
    expect(html).toContain('POSTED FALLBACK NAME');
  }, 120_000);
});
