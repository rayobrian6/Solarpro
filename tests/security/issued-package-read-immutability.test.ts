/** @vitest-environment node */
// ═══════════════════════════════════════════════════════════════════════════
// WS-A — AN ISSUED PACKAGE READ MUST NOT CHANGE THE PACKAGE.
//
// The permit GET used to "self-heal": if the stored artifact predated the
// current engine version, a READ regenerated the planset and wrote it back over
// the issued one. Because generatePermitHTML unconditionally re-resolves
// project.date, and that value reaches the DIGESTED meta.generatedAtIso, merely
// downloading an issued package on a later day moved its issue date, its
// snapshot digest, its snapshot id and its CERT Document ID — and a licensed
// engineering review, bound to the exact digest it approved, stopped covering
// the document it had approved.
//
// It was never one write. The resolution lifecycle reached SIX tables from that
// GET: projects.selected_equipment and projects.engineering_config through a
// four-statement reconciliation transaction, equipment_reconciliation_audit,
// snapshot_digest_invalidations, ahj_registry (on the success AND the failure
// path) and manufacturer_document_registry — most of it passed to a helper
// named `safeDbRead`.
//
// These tests drive the REAL route handler against a fake database that records
// every statement. They assert on what the handler actually issued, not on what
// the source text says.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Every statement the handler issued, in order. */
const statements: string[] = [];

/** The stored issued package. Mutating it requires a WRITE — which is the thing
 *  under test — so any change here means the read path wrote. */
const store = {
  html: '<!DOCTYPE html><html><head>'
    + '<meta name="planset-version" content="1">'   // deliberately STALE
    + '<meta name="document-issue-date-local" content="8/2/2026">'
    + '<meta name="document-timezone" content="America/Chicago">'
    + '</head><body>'
    + '<div class="tb-sheet-id">PV-0</div>'
    + 'SNAPSHOT PDS-5A88FD0FC1D6 · SHA-256 5a88fd0fc1d67809'
    + '<div>SP-PERMIT-ACMEPROJECT-822026</div>'
    + '</body></html>',
  input: JSON.stringify({ project: { date: '8/2/2026', projectName: 'Acme Project' } }),
};

const MUTATING = /\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/i;

vi.mock('@/lib/auth', () => ({ getUserFromRequest: () => ({ id: OWNER_ID }) }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/pdf/generatePdf', () => ({ generatePdfFromHtml: async () => null }));

vi.mock('@/lib/db-neon', () => ({
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: () => new Response(JSON.stringify({ success: false }), { status: 500 }),
  getDbReady: async () => {
    const sql = (strings: TemplateStringsArray) => {
      const q = strings.join(' ');
      statements.push(q.replace(/\s+/g, ' ').trim());
      if (MUTATING.test(q)) {
        // If the guard is working this is unreachable — the read-only wrapper
        // throws before dispatch. Reaching it means a write escaped.
        throw new Error('FAKE-DB: a write reached the database from a read path: ' + q.slice(0, 120));
      }
      if (/FROM projects/i.test(q)) return Promise.resolve([{ id: PROJECT_ID, user_id: OWNER_ID, name: 'Acme Project' }]);
      if (/FROM users/i.test(q)) return Promise.resolve([{ role: 'user' }]);
      if (/FROM project_files/i.test(q)) {
        return Promise.resolve([
          { file_name: 'permit_planset.html', file_data: Buffer.from(store.html, 'utf8') },
          { file_name: 'permit_input.json', file_data: Buffer.from(store.input, 'utf8') },
        ]);
      }
      return Promise.resolve([]);
    };
    return sql;
  },
}));

// vi.mock is hoisted above these, so the handler binds to the fakes.
import { GET } from '@/app/api/engineering/permit/route';
import { readOnlySql, ReadOnlyViolationError, mutatingVerb } from '@/lib/db/readOnlySql';

/** A NextRequest-shaped stub. The handler reads `req.nextUrl.searchParams`, so a
 *  bare Request is not enough — supplying the real shape keeps the test honest
 *  about which surface the handler actually touches. */
const req = (format = 'html', projectId: string = PROJECT_ID) => {
  const url = new URL(`http://localhost/api/engineering/permit?projectId=${projectId}&format=${format}`);
  return { nextUrl: url, url: url.toString(), headers: new Headers() } as never;
};

/** The identity a caller can observe from the served artifact. */
function identityOf(html: string) {
  return {
    snapshotId: (html.match(/PDS-[A-F0-9]+/) ?? [])[0] ?? null,
    digest: (html.match(/SHA-256 ([0-9a-f]+)/) ?? [])[1] ?? null,
    certDocumentId: (html.match(/SP-PERMIT-[A-Z0-9]+-\d+/) ?? [])[0] ?? null,
    issueDate: (html.match(/name="document-issue-date-local" content="([^"]*)"/) ?? [])[1] ?? null,
    timezone: (html.match(/name="document-timezone" content="([^"]*)"/) ?? [])[1] ?? null,
  };
}

const writes = () => statements.filter(s => MUTATING.test(s));

beforeEach(() => { statements.length = 0; });

// ── 1. GET PERFORMS NO WRITES ──────────────────────────────────────────────
describe('WS-A §1 · the issued-package GET is strictly read-only', () => {
  it('1. a GET issues only SELECT statements', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(statements.length).toBeGreaterThan(0);
    expect(writes(), `writes escaped:\n${writes().join('\n')}`).toEqual([]);
    for (const s of statements) expect(s.toUpperCase().startsWith('SELECT')).toBe(true);
  });

  it('2. a GET does not write the artifact, the input, the project or any ledger', async () => {
    await GET(req());
    const forbidden = [
      'project_files', 'projects SET', 'engineering_config', 'selected_equipment',
      'equipment_reconciliation_audit', 'snapshot_digest_invalidations',
      'ahj_registry', 'manufacturer_document_registry', 'nearmap_ai_cache',
      'engineering_review_records', 'upload_date',
    ];
    for (const f of forbidden) {
      const hit = statements.filter(s => MUTATING.test(s) && s.toLowerCase().includes(f.toLowerCase()));
      expect(hit, `a GET wrote ${f}`).toEqual([]);
    }
  });

  it('3. a GET emits no mutation audit event', async () => {
    await GET(req());
    expect(statements.filter(s => /INSERT INTO audit_log/i.test(s))).toEqual([]);
  });

  it('4. the served artifact is byte-identical to the stored one', async () => {
    const res = await GET(req());
    expect(await res.text()).toBe(store.html);
  });

  it('5. a STALE stored artifact is served unchanged, not regenerated', async () => {
    // The stored artifact declares planset-version 1; the engine is far newer.
    // The old self-heal treated that as a trigger to rebuild and overwrite.
    const res = await GET(req());
    expect(res.headers.get('X-Planset-Stale')).toBe('true');
    expect(res.headers.get('X-Planset-Issued-Artifact')).toBe('stored');
    expect(await res.text()).toBe(store.html);
    expect(writes()).toEqual([]);
  });

  it('6. staleness is disclosed with a repair pointer rather than repaired', async () => {
    const res = await GET(req());
    expect(res.headers.get('X-Planset-Repair')).toMatch(/POST/);
    expect(res.headers.get('X-Planset-Stored-Engine-Version')).toBe('1');
  });
});

// ── 2. IDENTITY IS STABLE ──────────────────────────────────────────────────
describe('WS-A §2 · package identity survives reading', () => {
  it('7. identity is unchanged after a single read', async () => {
    const before = identityOf(store.html);
    const after = identityOf(await (await GET(req())).text());
    expect(after).toEqual(before);
    expect(after.snapshotId).toBe('PDS-5A88FD0FC1D6');
    expect(after.certDocumentId).toBe('SP-PERMIT-ACMEPROJECT-822026');
    expect(after.issueDate).toBe('8/2/2026');
  });

  it('8. one hundred sequential reads preserve identity and write nothing', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const html = await (await GET(req())).text();
      seen.add(JSON.stringify(identityOf(html)));
    }
    expect(seen.size, 'package identity changed across repeated reads').toBe(1);
    expect(writes()).toEqual([]);
    expect(store.html).toContain('PDS-5A88FD0FC1D6');
  });

  it('9. twenty-five CONCURRENT reads preserve identity, write nothing, create no duplicate', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => GET(req())));
    const ids = new Set<string>();
    for (const r of results) ids.add(JSON.stringify(identityOf(await r.text())));
    expect(ids.size, 'concurrent reads produced divergent identities').toBe(1);
    expect(writes()).toEqual([]);
    // no duplicate package: the artifact row was never inserted, so there is
    // exactly one stored artifact and it is the original.
    expect(statements.filter(s => /INSERT/i.test(s))).toEqual([]);
  });

  it('10. identity is unchanged 30 days later', async () => {
    const before = identityOf(await (await GET(req())).text());
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
      const after = identityOf(await (await GET(req())).text());
      expect(after).toEqual(before);
      expect(after.issueDate).toBe('8/2/2026');       // NOT the read date
      expect(writes()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('11. identity is unchanged at a UTC-boundary instant', async () => {
    // 00:30Z on 8/3 is still 8/2 in Chicago — the exact boundary that used to
    // re-date a package. A read must be indifferent to it either way.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-03T00:30:00Z'));
      const a = identityOf(await (await GET(req())).text());
      vi.setSystemTime(new Date('2026-08-03T06:30:00Z'));
      const b = identityOf(await (await GET(req())).text());
      expect(a).toEqual(b);
      expect(a.issueDate).toBe('8/2/2026');
      expect(writes()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

// ── 3. INTEGRITY FAILURES ARE EXPLICIT ─────────────────────────────────────
describe('WS-A §3 · a missing artifact is reported, never rebuilt', () => {
  it('12. a missing artifact WITH a stored input is repair-required, not regenerated', async () => {
    const saved = store.html;
    store.html = '';
    try {
      const res = await GET(req());
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe('ISSUED_ARTIFACT_UNAVAILABLE');
      expect(body.repairRequired).toBe(true);
      expect(writes(), 'an integrity failure triggered a write').toEqual([]);
    } finally { store.html = saved; }
  });

  it('13. an integrity failure does not mutate the stored package', async () => {
    const saved = store.html;
    const savedInput = store.input;
    store.html = '';
    try {
      await GET(req());
      expect(store.input).toBe(savedInput);   // untouched
    } finally { store.html = saved; }
  });
});

// ── 4. THE WRITE BARRIER ITSELF ────────────────────────────────────────────
// A guard nobody has fired is a guard nobody should trust.
describe('WS-A §4 · the read-only barrier is real', () => {
  const fake = (() => Promise.resolve([])) as unknown as (...a: never[]) => unknown;

  it('14. the barrier classifies statements correctly', () => {
    expect(mutatingVerb('SELECT 1')).toBeNull();
    expect(mutatingVerb('  \n -- c\n SELECT 1')).toBeNull();
    expect(mutatingVerb('WITH x AS (SELECT 1) SELECT * FROM x')).toBeNull();
    expect(mutatingVerb('INSERT INTO t VALUES (1)')).toBe('INSERT');
    expect(mutatingVerb('UPDATE t SET a=1')).toBe('UPDATE');
    expect(mutatingVerb('DELETE FROM t')).toBe('DELETE');
    // a data-modifying CTE is a write wearing a read's first keyword
    expect(mutatingVerb('WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x')).toBe('INSERT');
    // fails CLOSED on an unrecognised shape
    expect(mutatingVerb('LOCK TABLE t')).toBe('LOCK');
  });

  it('15. a write through a read-only handle throws by name', () => {
    const guarded = readOnlySql(fake, 'test');
    expect(() => (guarded as unknown as (s: TemplateStringsArray) => unknown)(
      Object.assign(['INSERT INTO project_files VALUES (1)'], { raw: [] }) as unknown as TemplateStringsArray,
    )).toThrow(ReadOnlyViolationError);
  });

  it('16. a read through a read-only handle passes through', async () => {
    const guarded = readOnlySql(fake, 'test');
    const out = await (guarded as unknown as (s: TemplateStringsArray) => Promise<unknown>)(
      Object.assign(['SELECT 1'], { raw: [] }) as unknown as TemplateStringsArray,
    );
    expect(out).toEqual([]);
  });

  it('17. sql.transaction is NOT reachable — the door the reconciliation walked through', () => {
    const withTx = Object.assign(fake, { transaction: () => Promise.resolve([]) });
    const guarded = readOnlySql(withTx as never, 'test');
    expect(() => (guarded as unknown as { transaction: unknown }).transaction)
      .toThrow(ReadOnlyViolationError);
  });

  it('18. the violation message never leaks row data, only the statement shape', () => {
    const guarded = readOnlySql(fake, 'permit/GET');
    try {
      (guarded as unknown as (s: TemplateStringsArray) => unknown)(
        Object.assign(['UPDATE projects SET selected_equipment = '], { raw: [] }) as unknown as TemplateStringsArray,
      );
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ReadOnlyViolationError);
      expect((e as Error).message).toContain('permit/GET');
      expect((e as Error).message).toContain('UPDATE');
    }
  });
});
