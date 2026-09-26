/**
 * tests/portalFileAccessIsScoped.postgres.test.ts
 *
 * THE NEW ENDPOINT IS THE RISK. THIS IS THE TEST THAT EARNS IT.
 *
 * The portal's document vault rendered a download glyph that was not a control:
 * no href, no handler, and no endpoint behind it. The homeowner clicked it and
 * nothing happened. `GET /api/portal/files/[id]` exists so that glyph can be a
 * real link.
 *
 * 🚨 AN ENDPOINT LIKE THIS WITHOUT AN OWNERSHIP CHECK IS STRICTLY WORSE THAN THE
 *    DEAD ICON IT REPLACES. A dead icon is an annoyance. An id-addressable file
 *    endpoint that only checks "is there a portal session" lets any homeowner read
 *    any other homeowner's uploaded documents — their electric bill, their name,
 *    their address, their consumption — by iterating ids. So the negative case is
 *    tested first and by hand: ANOTHER CLIENT'S FILE MUST NOT COME BACK.
 *
 * Three further boundaries, each with its own case below:
 *   • a file on a SOFT-DELETED project is not served;
 *   • an internal ops artefact (`permit_packet`, `site_survey`, …) is not served
 *     even to the owning client — the portal's read route deliberately excludes
 *     internal documents, and an id-addressable endpoint must not become the back
 *     door around that;
 *   • a refusal is a 404, never a 403, because a 403 confirms the file exists.
 *
 * 🚨 PGlite — PostgreSQL 16 in-process, no daemon, no credentials. The ownership
 * rule is a JOIN predicate, so proving it needs a real query planner and real
 * rows; a mocked `sql` would only prove the test's own mock.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let db: PGlite;

function neonShim(pg: PGlite) {
  return (async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === 'string') {
      const r = await pg.query(strings, (values[0] as unknown[]) ?? []);
      return r.rows;
    }
    let text = '';
    const params: unknown[] = [];
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) { params.push(values[i]); text += `$${params.length}`; }
    });
    const r = await pg.query(text, params);
    return r.rows;
  }) as unknown as never;
}

/** project_files has no `.sql` migration — its DDL is extracted from the route
 *  that creates it. See the long note in
 *  tests/portalBillUploadKeepsTheOriginal.postgres.test.ts. */
function projectFilesDdl(): string[] {
  const src = read('app', 'api', 'migrate', 'route.ts');
  const start = src.indexOf('CREATE TABLE IF NOT EXISTS project_files (');
  expect(start, 'the project_files DDL moved').toBeGreaterThan(-1);
  const end = src.indexOf('`;', start);
  const create = src.slice(start, end).trim();
  const status = src.match(/ALTER TABLE project_files ADD COLUMN IF NOT EXISTS status[^`]*/);
  expect(status).not.toBeNull();
  return [create, status![0].trim()];
}

// ── Identities ──────────────────────────────────────────────────────────────

const USER_ID       = '11111111-1111-4111-8111-111111111111';
const ME            = '33333333-3333-4333-8333-333333333333';
const SOMEONE_ELSE  = '44444444-4444-4444-8444-444444444444';
const MY_PROJECT    = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const THEIR_PROJECT = '5140c775-cfcf-4441-b22d-deb16fbe3e8e';
const DELETED_PROJECT = '6250d886-d0d0-4552-c33e-efc27acf4f9f'.replace(/[^0-9a-f-]/g, '0');

const BILL = Buffer.from('%PDF-1.4\nmy electric bill\n%%EOF\n');

vi.mock('@/lib/db-neon', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbReady: async () => neonShim(db),
}));
/** The session under test is always MINE. The files are not. */
vi.mock('@/lib/portalAuth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getPortalSession: () => ({ clientId: ME, email: 'me@e.st', name: 'Me' }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));

const { GET } = await import('@/app/api/portal/files/[id]/route');

function fetchFile(id: string) {
  return GET(
    new Request(`http://localhost/api/portal/files/${id}`) as never,
    { params: Promise.resolve({ id }) },
  );
}

/** Inserts a file and returns its id. */
async function addFile(
  projectId: string, clientId: string, name: string, fileType: string,
  data: Buffer | null = BILL, url: string | null = null,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO project_files
       (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, file_url)
     VALUES ($1,$2,$3,$4,$5,$6,'application/pdf',$7,$8) RETURNING id`,
    [projectId, clientId, clientId, name, fileType, data?.length ?? null, data, url],
  );
  return r.rows[0].id;
}

async function seed() {
  await db.exec(`DELETE FROM project_files; DELETE FROM projects; DELETE FROM clients;`);
  await db.query(`INSERT INTO clients (id, user_id, name, email) VALUES ($1,$2,'Me','me@e.st')`, [ME, USER_ID]);
  await db.query(`INSERT INTO clients (id, user_id, name, email) VALUES ($1,$2,'Them','them@e.st')`, [SOMEONE_ELSE, USER_ID]);
  await db.query(
    `INSERT INTO projects (id, user_id, client_id, name, system_type) VALUES ($1,$2,$3,'Mine','roof')`,
    [MY_PROJECT, USER_ID, ME]);
  await db.query(
    `INSERT INTO projects (id, user_id, client_id, name, system_type) VALUES ($1,$2,$3,'Theirs','roof')`,
    [THEIR_PROJECT, USER_ID, SOMEONE_ELSE]);
  await db.query(
    `INSERT INTO projects (id, user_id, client_id, name, system_type, deleted_at)
     VALUES ($1,$2,$3,'Mine, deleted','roof', NOW())`,
    [DELETED_PROJECT, USER_ID, ME]);
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(read('lib', 'migrations', '001_initial_schema.sql')
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g, '-- omitted'));
  for (const stmt of projectFilesDdl()) await db.exec(stmt);
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

// ═══════════════════════════════════════════════════════════════════════════
// 1. 🚨 THE NEGATIVE CASE — THE REASON THIS ENDPOINT IS ALLOWED TO EXIST
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 another homeowner\'s file is not served', () => {
  it('a file on someone else\'s project 404s, and no bytes come back', async () => {
    const theirs = await addFile(THEIR_PROJECT, SOMEONE_ELSE, 'Utility_Bill.pdf', 'utility_bill');
    const res = await fetchFile(theirs);

    expect(res.status, 'ANOTHER CLIENT\'S UTILITY BILL WAS SERVED — this is a data leak').toBe(404);
    const body = await res.text();
    expect(body).not.toContain('my electric bill');
    expect(body).not.toContain('%PDF');
  });

  it('and it is a 404, not a 403 — a 403 would confirm the file exists', async () => {
    const theirs = await addFile(THEIR_PROJECT, SOMEONE_ELSE, 'Utility_Bill.pdf', 'utility_bill');
    expect((await fetchFile(theirs)).status).not.toBe(403);
  });

  it('a file id that does not exist is indistinguishable from it', async () => {
    const res = await fetchFile('7770dddd-7777-4777-8777-777777777777');
    expect(res.status).toBe(404);
  });

  it('🚨 while MY OWN file, in the same table, IS served', async () => {
    // The control. Without it, an endpoint that 404s everything passes every
    // assertion above while being completely broken — and "no leak" would be
    // proving nothing about the ownership rule.
    const mine = await addFile(MY_PROJECT, ME, 'Utility_Bill.pdf', 'utility_bill');
    const res = await fetchFile(mine);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(BILL)).toBe(true);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE OTHER BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════════

describe('the rest of the allowlist', () => {
  it('an internal ops artefact on MY project is still not served', async () => {
    // The portal read route deliberately excludes internal documents. An
    // id-addressable endpoint must not be the way around that decision.
    for (const type of ['permit_packet', 'site_survey', 'engineering_report', 'other']) {
      const f = await addFile(MY_PROJECT, ME, `${type}.pdf`, type);
      expect((await fetchFile(f)).status, `${type} was served to the homeowner`).toBe(404);
    }
  });

  it('a file on a soft-deleted project is not served', async () => {
    const f = await addFile(DELETED_PROJECT, ME, 'Utility_Bill.pdf', 'utility_bill');
    expect((await fetchFile(f)).status).toBe(404);
  });

  it('a row with neither bytes nor a URL is not served', async () => {
    const f = await addFile(MY_PROJECT, ME, 'Utility_Bill.pdf', 'utility_bill', null, null);
    expect((await fetchFile(f)).status).toBe(404);
  });

  it('a malformed id is rejected before any query runs', async () => {
    expect((await fetchFile('not-a-uuid')).status).toBe(400);
  });

  it('and an SVG is never served with its own content type', async () => {
    // Stored bytes are homeowner-supplied. `image/svg+xml` rendered on this
    // origin is stored XSS against the portal, so the type is not echoed back.
    const r = await db.query<{ id: string }>(
      `INSERT INTO project_files
         (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data)
       VALUES ($1,$2,$3,'evil.svg','portal_upload',10,'image/svg+xml',$4) RETURNING id`,
      [MY_PROJECT, ME, ME, Buffer.from('<svg onload="alert(1)"/>')],
    );
    const res = await fetchFile(r.rows[0].id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE SESSION ITSELF
// ═══════════════════════════════════════════════════════════════════════════

describe('an unauthenticated caller', () => {
  it('gets 401 and no file', async () => {
    vi.resetModules();
    vi.doMock('@/lib/portalAuth', async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      getPortalSession: () => null,
    }));
    try {
      const { GET: ANON } = await import('@/app/api/portal/files/[id]/route');
      const mine = await addFile(MY_PROJECT, ME, 'Utility_Bill.pdf', 'utility_bill');
      const res = await ANON(
        new Request(`http://localhost/api/portal/files/${mine}`) as never,
        { params: Promise.resolve({ id: mine }) },
      );
      expect(res.status).toBe(401);
    } finally {
      vi.doUnmock('@/lib/portalAuth');
      vi.resetModules();
    }
  });
});
