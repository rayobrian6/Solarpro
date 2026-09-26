/**
 * tests/portalBillUploadKeepsTheOriginal.postgres.test.ts
 *
 * THE HOMEOWNER'S ACTUAL UTILITY BILL WAS THROWN AWAY. THIS UPLOADS ONE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 * ─────────────────────────────────────────────────────────────────────────────
 * `POST /api/portal/bill-upload` took the homeowner's PDF, forwarded it to the
 * parser, kept FIVE FIELDS as a ~200-byte JSON blob, and dropped the bytes. The
 * portal then said "Utility bill received ✓" and listed "Utility Bill" in Your
 * Documents — a row containing no bill.
 *
 * The route returns a `confidence` score with the parse. So when the parse was
 * wrong there was, by construction, nothing to check it against — and the system
 * size, production, savings and proposal are all derived from those five numbers.
 * The homeowner could not re-upload either: any second attempt returned
 * `alreadyExists`, and the portal hid the control once a row existed.
 *
 * And the summary was called `Utility_Bill_Summary.json`, which the installer's
 * engineering page classifies as the **"Original Utility Bill"** (it classifies
 * `utility_bill` files by whether the name starts `Bill_Data_`). So the one
 * artefact the product labelled "original" was the derived summary, and nothing
 * in the UI could reveal that the original was gone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 * ─────────────────────────────────────────────────────────────────────────────
 * That the BYTES SURVIVE — compared to the bytes uploaded, against real
 * PostgreSQL, through the real route. Not that a row exists; the defect had a row.
 *
 * Plus the naming contract, which is load-bearing in two directions at once:
 *   • the engineering page must call the original "Original Utility Bill" and the
 *     summary "Bill Data" — decided by the `Bill_Data_` prefix;
 *   • the portal decides whether to offer the upload control by looking for a
 *     document whose normalized label is exactly "Utility Bill" — so the ORIGINAL
 *     must normalize to that and the summary must not.
 * Those two rules pull on the same two filenames, which is exactly the kind of
 * coupling that silently breaks. Both are asserted here against the real
 * normalizer.
 *
 * 🚨 PGlite — PostgreSQL 16 in-process, no daemon, no credentials. Not Ray's Neon.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { normalizeDocumentLabel } from '../lib/normalizeDocumentLabel';
import {
  PORTAL_BILL_SUMMARY_FILE_NAME,
  portalOriginalBillFileName,
  isHomeownerFacingDocument,
} from '../lib/portal/documents';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

// ── The PGlite fixture ──────────────────────────────────────────────────────

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

const MIGRATIONS: ReadonlyArray<[dir: string, file: string]> = [
  ['lib/migrations', '001_initial_schema.sql'],   // clients, projects
  ['migrations',     '019_homeowner_stage.sql'],  // homeowner_stage + history
  ['migrations',     '021_micro_stages.sql'],     // project_micro_stages
  ['migrations',     '022_micro_stages_unique.sql'],
];

/**
 * 🚨 `project_files` HAS NO `.sql` MIGRATION — IT IS CREATED BY A ROUTE.
 *
 * Its DDL lives inside a template literal in app/api/migrate/route.ts, so it is
 * extracted from that source rather than hand-copied here. A hand-copied table is
 * how a fixture ends up missing the column under test and reporting the product
 * as broken (or, worse, as fine). The extraction is anchored on real syntax and
 * the test below fails loudly if it stops matching.
 *
 * (That the table's shape is defined in an API route and not in the migration
 * directory the runner reads is a real finding, and not this file's to fix.)
 */
function projectFilesDdl(): string[] {
  const src = read('app', 'api', 'migrate', 'route.ts');

  const start = src.indexOf('CREATE TABLE IF NOT EXISTS project_files (');
  expect(start, 'the project_files DDL is no longer in app/api/migrate/route.ts')
    .toBeGreaterThan(-1);
  const end = src.indexOf('`;', start);
  expect(end).toBeGreaterThan(start);
  const create = src.slice(start, end).trim();
  expect(create).toMatch(/file_data\s+BYTEA/);

  const status = src.match(
    /ALTER TABLE project_files ADD COLUMN IF NOT EXISTS status[^`]*/,
  );
  expect(status, 'the project_files.status column statement is gone').not.toBeNull();

  return [
    create,
    status![0].trim(),
    // The upsert target the route's ON CONFLICT names.
    `ALTER TABLE project_files
       ADD CONSTRAINT project_files_project_user_name_unique
       UNIQUE (project_id, user_id, file_name)`,
  ];
}

async function applyMigrations(pg: PGlite): Promise<void> {
  for (const [dir, file] of MIGRATIONS) {
    await pg.exec(
      read(dir, file).replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g,
        '-- pgcrypto omitted: gen_random_uuid() is core PostgreSQL from 13'),
    );
  }
  for (const stmt of projectFilesDdl()) await pg.exec(stmt);
}

// ── Module mocks ────────────────────────────────────────────────────────────

const USER_ID   = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CLIENT = '44444444-4444-4444-8444-444444444444';
const PROJECT   = '4030b664-bebe-433b-a11c-cda05ead2f7d';

vi.mock('@/lib/db-neon', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbReady: async () => neonShim(db),
}));
vi.mock('@/lib/portalAuth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getPortalSession: () => ({ clientId: CLIENT_ID, email: 'braidon@e.st', name: 'Braidon' }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));

const { POST } = await import('@/app/api/portal/bill-upload/route');

// ── The upload ──────────────────────────────────────────────────────────────

/** A minimal but real PDF byte string — enough that "the bytes match" means something. */
const BILL_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.4\n% a homeowner\'s actual electric bill\n'),
  Buffer.from(Array.from({ length: 512 }, (_, i) => i % 251)),
  Buffer.from('\n%%EOF\n'),
]);

/** The parser is a separate route; the upload route calls it over HTTP. */
const PARSED = {
  success: true,
  billData: {
    utilityProvider: 'Ameren Illinois',
    monthlyKwh: [900, 850, 1100],
    annualKwh: 14200,
    electricityRate: 0.1364,
    confidence: 0.61,      // 🚨 the reason the original has to survive
  },
};

function stubParser(response: unknown = PARSED, status = 200) {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(response), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
}

async function upload(fileName = 'March bill.pdf', type = 'application/pdf') {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(BILL_BYTES)], fileName, { type }));
  form.append('project_id', PROJECT);
  const req = new NextRequest('http://localhost/api/portal/bill-upload', {
    method: 'POST',
    body: form,
  });
  const res = await POST(req);
  return { res, json: await res.json() as Record<string, unknown> };
}

interface FileRow {
  file_name: string;
  file_type: string;
  mime_type: string | null;
  file_size: number | null;
  file_data: Uint8Array | null;
  status: string;
}

async function files(): Promise<FileRow[]> {
  const r = await db.query<FileRow>(
    `SELECT file_name, file_type, mime_type, file_size, file_data, status
       FROM project_files WHERE project_id = $1 ORDER BY file_name`,
    [PROJECT],
  );
  return r.rows;
}

async function seed() {
  await db.exec(`
    DELETE FROM project_files;
    DELETE FROM project_micro_stages;
    DELETE FROM project_homeowner_stage_history;
    DELETE FROM projects;
    DELETE FROM clients;
  `);
  await db.query(
    `INSERT INTO clients (id, user_id, name, email) VALUES ($1,$2,'Braidon Pilla','braidon@e.st')`,
    [CLIENT_ID, USER_ID],
  );
  await db.query(
    `INSERT INTO clients (id, user_id, name, email) VALUES ($1,$2,'Someone Else','other@e.st')`,
    [OTHER_CLIENT, USER_ID],
  );
  await db.query(
    `INSERT INTO projects (id, user_id, client_id, name, address, system_type, homeowner_stage)
     VALUES ($1,$2,$3,'BRAIDON M PILLA — Solar','3 Melvin Drive, Granite City, IL','roof','lead_submitted')`,
    [PROJECT, USER_ID, CLIENT_ID],
  );
  stubParser();
}

beforeAll(async () => {
  db = await PGlite.create();
  await applyMigrations(db);
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

// ═══════════════════════════════════════════════════════════════════════════
// 0. THE FIXTURE IS HONEST
// ═══════════════════════════════════════════════════════════════════════════

describe('the fixture is the table the route actually writes to', () => {
  it('project_files has file_data and the unique constraint the upsert names', async () => {
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'project_files'`,
    );
    const names = new Set(cols.rows.map(r => r.column_name));
    for (const c of ['file_name', 'file_type', 'file_size', 'mime_type', 'file_data', 'notes', 'status']) {
      expect(names.has(c), `project_files.${c} is missing from the fixture`).toBe(true);
    }
    const uniq = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = 'project_files_project_user_name_unique'`,
    );
    expect(uniq.rows.length, 'the ON CONFLICT target does not exist, so the upsert takes its ' +
      'delete-then-insert fallback and this fixture is testing the wrong path').toBe(1);
  });

  it('and BYTEA really does round-trip bytes here', async () => {
    // If it did not, "the stored bytes equal the uploaded bytes" would be
    // untestable and the central assertion of this file would be meaningless.
    await db.query(
      `INSERT INTO project_files (project_id, user_id, file_name, file_type, file_data)
       VALUES ($1,$2,'probe.bin','other',$3)`,
      [PROJECT, USER_ID, BILL_BYTES],
    );
    const r = await db.query<{ file_data: Uint8Array }>(
      `SELECT file_data FROM project_files WHERE file_name = 'probe.bin'`);
    expect(Buffer.from(r.rows[0].file_data).equals(BILL_BYTES)).toBe(true);
    await db.exec(`DELETE FROM project_files WHERE file_name = 'probe.bin'`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE BYTES SURVIVE
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the homeowner\'s actual bill is stored', () => {
  it('the uploaded bytes come back out of the database unchanged', async () => {
    const { res, json } = await upload();
    expect(res.status, JSON.stringify(json)).toBe(200);

    const rows = await files();
    const original = rows.find(r => !r.file_name.startsWith('Bill_Data_'));
    expect(original, 'no row holds the original document — only the parsed summary').toBeDefined();
    expect(original!.file_data, 'the original row has no bytes').not.toBeNull();
    expect(
      Buffer.from(original!.file_data!).equals(BILL_BYTES),
      'the stored document is not the document the homeowner uploaded',
    ).toBe(true);
    expect(original!.file_size).toBe(BILL_BYTES.length);
    expect(original!.mime_type).toBe('application/pdf');
  });

  it('alongside the parsed summary, which is a separate row', async () => {
    await upload();
    const rows = await files();
    expect(rows.map(r => r.file_name).sort())
      .toEqual([PORTAL_BILL_SUMMARY_FILE_NAME, 'Utility_Bill.pdf'].sort());

    const summary = rows.find(r => r.file_name === PORTAL_BILL_SUMMARY_FILE_NAME)!;
    const parsed = JSON.parse(Buffer.from(summary.file_data!).toString('utf8'));
    expect(parsed.annualKwh).toBe(14200);
    // The confidence is kept, and is now checkable against the original.
    expect(parsed.confidence).toBe(0.61);
  });

  it('and the route says so, so a caller can tell the difference', async () => {
    const { json } = await upload();
    expect(json.originalStored).toBe(true);
    expect(json.originalFileName).toBe('Utility_Bill.pdf');
  });

  it('the file extension follows the document, not the upload form', async () => {
    await upload('scan of bill.JPG', 'image/jpeg');
    const rows = await files();
    expect(rows.map(r => r.file_name).sort())
      .toEqual([PORTAL_BILL_SUMMARY_FILE_NAME, 'Utility_Bill.jpg'].sort());
  });

  it('🚨 and nothing is written at all when the parse fails', async () => {
    // Otherwise a failed parse leaves a `utility_bill` row that makes the portal
    // claim a bill was received and blocks the retry.
    stubParser({ success: false, error: 'unreadable' }, 422);
    const { res } = await upload();
    expect(res.status).toBe(422);
    expect(await files()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE NAMING CONTRACT — TWO CONSUMERS, THE SAME TWO FILENAMES
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the names the two consumers read', () => {
  /**
   * 🚨 MEASURED, NOT ASSUMED: this one assertion PASSES with the defect restored.
   * The old summary was called `Utility_Bill_Summary.json`, which also fails the
   * `Bill_Data_` test and also normalizes to "Utility Bill" — so it satisfied this
   * check while containing no bill. That is the defect's whole disguise. The
   * discriminating assertion is the byte comparison in §1; this one guards the
   * portal's upload gate against a future rename, and is recorded as a regression
   * guard rather than counted as proof.
   */
  it('the ORIGINAL normalizes to exactly "Utility Bill" — the portal\'s upload gate', async () => {
    // app/portal/dashboard/page.tsx hides the upload control when a document
    // labelled 'Utility Bill' exists for the project. If the original stopped
    // normalizing to that, the homeowner would be asked to upload a bill that is
    // already on file — or, worse, the gate would be satisfied by the summary
    // alone and a failed byte-write would be invisible again.
    await upload();
    const rows = await files();
    const original = rows.find(r => !r.file_name.startsWith('Bill_Data_'))!;
    expect(normalizeDocumentLabel(original.file_name)).toBe('Utility Bill');
  });

  it('the SUMMARY does not, and is not shown to the homeowner', async () => {
    await upload();
    const label = normalizeDocumentLabel(PORTAL_BILL_SUMMARY_FILE_NAME);
    expect(label).not.toBe('Utility Bill');
    expect(isHomeownerFacingDocument({ label }),
      'the homeowner is being offered a JSON blob in their document vault').toBe(false);
    // And the real bill still is shown.
    expect(isHomeownerFacingDocument({ label: 'Utility Bill' })).toBe(true);
  });

  it('the engineering page classifies each one correctly (by its prefix rule)', () => {
    // SOURCE SCAN, stated plainly: app/engineering/page.tsx is 17k lines of React
    // and its classifier is a predicate inside a JSX table, so this asserts the
    // RULE both sides depend on rather than rendering the page. The behavioural
    // half is the filename assertions above.
    const page = read('app', 'engineering', 'page.tsx');
    expect(page).toContain("f.file_type === 'utility_bill' && f.file_name.startsWith('Bill_Data_')");
    expect(page).toContain("f.file_type === 'utility_bill' && !f.file_name.startsWith('Bill_Data_')");

    // Applied to what the route actually writes:
    expect(PORTAL_BILL_SUMMARY_FILE_NAME.startsWith('Bill_Data_'),
      'the summary would be labelled "Original Utility Bill" on the engineering page').toBe(true);
    expect(portalOriginalBillFileName('application/pdf', 'x.pdf').startsWith('Bill_Data_'),
      'the original would be labelled "Bill Data"').toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. RE-UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

describe('a second attempt', () => {
  it('is still refused once a completed upload exists', async () => {
    await upload();
    const { json } = await upload();
    expect(json.alreadyExists).toBe(true);
  });

  it('and a legacy summary-only project counts as completed too', async () => {
    // Projects that uploaded before the bytes were retained must not be
    // re-parsed behind the homeowner's back on their next visit.
    await db.query(
      `INSERT INTO project_files (project_id, client_id, user_id, file_name, file_type, file_data)
       VALUES ($1,$2,$3,'Utility_Bill_Summary.json','utility_bill','{}')`,
      [PROJECT, CLIENT_ID, CLIENT_ID],
    );
    const { json } = await upload();
    expect(json.alreadyExists).toBe(true);
  });

  it('🚨 but a HALF-FINISHED upload is retryable', async () => {
    // The old check matched any `utility_bill` row, so an upload that stored the
    // bytes and then failed before the summary would answer `alreadyExists`
    // forever and the parse would never be redone. The summary is what proves a
    // parse completed, so the summary is what the check looks for.
    await upload();
    await db.exec(`DELETE FROM project_files WHERE file_name = '${PORTAL_BILL_SUMMARY_FILE_NAME}'`);
    const { json } = await upload();
    expect(json.alreadyExists).toBe(false);
    expect((await files()).length).toBe(2);
  });
});
