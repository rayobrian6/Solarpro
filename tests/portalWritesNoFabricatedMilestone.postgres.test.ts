/**
 * tests/portalWritesNoFabricatedMilestone.postgres.test.ts
 *
 * ONE ADMIN CLICK WROTE A DATED, CUSTOMER-VISIBLE LIE. THIS RUNS THE CLICK.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 * ─────────────────────────────────────────────────────────────────────────────
 * `PATCH /api/admin/projects/[id]` with `action: 'set-stage'` is what the admin
 * UI calls when an operator picks a stage and presses Save
 * (app/admin/projects/[id]/page.tsx). Besides moving `homeowner_stage` and
 * logging the change, it wrote a "representative" micro-stage through
 * `HOMEOWNER_TO_MICRO_OVERRIDE`.
 *
 * Micro-stages are not an internal audit vocabulary. The homeowner portal
 * translates them into prose and renders them, with dates, as things that HAVE
 * HAPPENED (`MICRO_STAGE_ACTIVITY`, app/portal/dashboard/page.tsx). So selecting
 * a phase asserted its milestone:
 *
 *   under_review → bill_uploaded    → "Your utility bill was received"
 *   site_survey  → survey_submitted → "Site visit report submitted"
 *   installation → install_started  → "Installation crew arrived at your home"
 *
 * The first is contradicted by the same screen, which was still asking for the
 * bill (the upload prompt is driven by `project_files`, not by micro-stages). The
 * second and third are contradicted by the stage card directly beneath, which
 * says a technician WILL visit and that permits are still being handled.
 *
 * And `PATCH /api/projects/[id]/homeowner-stage` — the installer's own control —
 * mapped `installation` to `contract_signed`, so advancing a customer to
 * Installation made the customer's portal state, with today's date, that the
 * CUSTOMER had signed the agreement. On projects where no proposal was ever sent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS BEHAVIOURAL AND NOT A SOURCE SCAN
 * ─────────────────────────────────────────────────────────────────────────────
 * tests/stageEntryIsNotAnOutcome.test.ts enumerates the legitimate stage→micro
 * mappings by reading source. That is necessary (it catches a NEW map) and
 * insufficient: it cannot see a write that reaches the table by another route,
 * and it cannot prove the routes still write what they SHOULD. So this file calls
 * the real handlers against real PostgreSQL and reads the rows back.
 *
 * 🚨 PGlite — PostgreSQL 16 in-process, no daemon, no credentials. This is NOT
 * Ray's Neon instance: it proves the write paths, not what production contains.
 *
 * 🚨 AND IT PINS THE OPPOSITE DIRECTION TOO. "No row was written" is satisfied by
 * a route that is broken, or by a fixture where nothing works at all. Every
 * negative here is paired with a positive: the stage still moves, the history row
 * is still written, and the mappings that ARE entry-true still produce their rows.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { STAGE_CONTENT } from '../lib/portal/stageContent';

const ROOT = join(__dirname, '..');

// ── The PGlite fixture ──────────────────────────────────────────────────────

let db: PGlite;

/** Neon's `sql` is a tagged template returning rows; PGlite takes ($1,$2,…)
 *  text. The only translation here — everything it feeds is production code.
 *  Same shim as tests/microStageComesFromTheAuthority.postgres.test.ts. */
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

/**
 * The real migration files, named rather than globbed — see the long note in
 * tests/microStageComesFromTheAuthority.postgres.test.ts for why a glob over
 * either directory is actively dangerous here (lib/migrations/027 creates
 * `project_micro_stages` with a shape the product cannot use, after which
 * migrations/021 is a silent no-op).
 *
 * 006 is added because the admin route's email lookup LEFT JOINs `users` for the
 * company name, and nothing in 001 creates that table. Without it the lookup
 * throws inside the route's own try/catch and the email silently never sends —
 * which would make the email assertion below pass for the wrong reason.
 */
const MIGRATIONS: ReadonlyArray<[dir: string, file: string]> = [
  ['lib/migrations', '001_initial_schema.sql'],              // clients, projects
  ['lib/migrations', '006_users_subscriptions_whitelabel.sql'], // users (+company)
  ['migrations',     '019_homeowner_stage.sql'],             // homeowner_stage + history
  ['migrations',     '021_micro_stages.sql'],                // project_micro_stages
  ['migrations',     '022_micro_stages_unique.sql'],
];

async function applyMigrations(pg: PGlite): Promise<void> {
  for (const [dir, file] of MIGRATIONS) {
    const sql = readFileSync(join(ROOT, dir, file), 'utf8')
      // PGlite does not ship pgcrypto. Its only use is gen_random_uuid(), core
      // PostgreSQL since 13 (PGlite is 16), so dropping the line changes nothing.
      .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g,
        '-- pgcrypto omitted: gen_random_uuid() is core PostgreSQL from 13');
    await pg.exec(sql);
  }
}

// ── Module mocks ────────────────────────────────────────────────────────────

const USER_ID   = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID   = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT   = '4030b664-bebe-433b-a11c-cda05ead2f7d';

/** Captured stage-advance emails, so the copy the homeowner receives is readable. */
const sentEmails: Array<Record<string, unknown>> = [];

/**
 * Every `writeMicroStage` call any route under test makes.
 *
 * 🚨 THIS LIST EXISTS BECAUSE THE FIRST VERSION OF THIS FILE WAS BLIND.
 *
 * It restored `HOMEOWNER_TO_MICRO_OVERRIDE` to prove the guard went red — and
 * the guard stayed GREEN. The admin route calls `void writeMicroStage(…)`:
 * fire-and-forget, deliberately, so a logging failure cannot break an operator's
 * save. The handler therefore RETURNS BEFORE THE ROW IS WRITTEN, and a `SELECT`
 * issued the moment it resolves sees an empty table whether or not the defect is
 * present. The row arrived milliseconds later, in the customer's portal.
 *
 * Two independent observations replace that one unsound one: the CALL is recorded
 * here (timing-free — an un-awaited promise is still a call), and the TABLE is
 * read after the write has had time to land (see `settle`). The spy delegates to
 * the real implementation, so the database half is still exercised for real.
 */
const microStageWrites: Array<{ projectId: string; stage: string }> = [];

vi.mock('@/lib/db-neon', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbReady: async () => neonShim(db),
}));
vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, name: 'Installer', email: 'i@e.st', company: 'T' }),
}));
vi.mock('@/lib/adminAuth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireAdminApi: async () => ({ id: ADMIN_ID, email: 'admin@e.st', role: 'admin' }),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendStageAdvanceEmail: async (opts: Record<string, unknown>) => {
    sentEmails.push(opts);
    return { success: true };
  },
}));
vi.mock('@/lib/env', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getBaseUrl: () => 'https://example.test',
}));
vi.mock('@/lib/microStage', async (orig) => {
  const actual = await orig<typeof import('@/lib/microStage')>();
  return {
    ...actual,
    // Records the call, then does the real write. Not a stub: if a route writes a
    // milestone, the row really lands in the fixture database too.
    writeMicroStage: async (
      projectId: string,
      stage: string,
      createdBy: string | null = null,
      metadata: Record<string, unknown> | null = null,
    ) => {
      microStageWrites.push({ projectId, stage });
      return actual.writeMicroStage(projectId, stage as never, createdBy, metadata);
    },
  };
});

const { PATCH: ADMIN_PATCH } = await import('@/app/api/admin/projects/[id]/route');
const { PATCH: STAGE_PATCH } = await import('@/app/api/projects/[id]/homeowner-stage/route');

// ── Helpers ─────────────────────────────────────────────────────────────────

function adminSetStage(stage: string, extra: Record<string, unknown> = {}) {
  return ADMIN_PATCH(
    new Request(`http://localhost/api/admin/projects/${PROJECT}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-stage', stage, ...extra }),
    }) as never,
    { params: Promise.resolve({ id: PROJECT }) },
  );
}

function installerSetStage(stage: string) {
  return STAGE_PATCH(
    new Request(`http://localhost/api/projects/${PROJECT}/homeowner-stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    }) as never,
    { params: Promise.resolve({ id: PROJECT }) },
  );
}

async function microStages(): Promise<string[]> {
  const r = await db.query<{ micro_stage: string }>(
    `SELECT micro_stage FROM project_micro_stages WHERE project_id = $1 ORDER BY micro_stage`,
    [PROJECT],
  );
  return r.rows.map(x => x.micro_stage);
}

async function stageHistory(): Promise<Array<{ stage: string; note: string | null }>> {
  const r = await db.query<{ stage: string; note: string | null }>(
    `SELECT stage, note FROM project_homeowner_stage_history
      WHERE project_id = $1 ORDER BY created_at ASC`,
    [PROJECT],
  );
  return r.rows;
}

async function homeownerStage(): Promise<string | null> {
  const r = await db.query<{ homeowner_stage: string | null }>(
    `SELECT homeowner_stage FROM projects WHERE id = $1`, [PROJECT]);
  return r.rows[0]?.homeowner_stage ?? null;
}

/**
 * Gives un-awaited work started by the handler time to reach the database.
 *
 * 🚨 A DELAY IN A TEST IS USUALLY A SMELL. Here it is the point: the write being
 * forbidden is fire-and-forget, so "the table is empty the instant the handler
 * resolves" is not evidence of anything. Measured with the defect restored, the
 * row lands in single-digit milliseconds; this waits far longer than that and
 * yields to the event loop repeatedly, so a row that is coming WILL have arrived.
 * The call spy above is the timing-free half of the same proof.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 15));
}

/** The email is fire-and-forget inside the route; wait for it rather than sleep. */
async function waitForEmail(): Promise<Record<string, unknown>> {
  for (let i = 0; i < 100; i++) {
    if (sentEmails.length > 0) return sentEmails[sentEmails.length - 1];
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('the stage-advance email was never sent — the assertion below would be vacuous');
}

async function seed(stage: string = 'lead_submitted') {
  await db.exec(`
    DELETE FROM project_micro_stages;
    DELETE FROM project_homeowner_stage_history;
    DELETE FROM projects;
    DELETE FROM clients;
  `);
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, company)
     VALUES ($1, 'Test Installer', 'installer-fixture@e.st', 'x', 'Under the Sun Solar')
     ON CONFLICT (id) DO NOTHING`,
    [USER_ID],
  );
  await db.query(
    `INSERT INTO clients (id, user_id, name, email) VALUES ($1,$2,'Braidon Pilla','braidon@e.st')`,
    [CLIENT_ID, USER_ID],
  );
  await db.query(
    `INSERT INTO projects (id, user_id, client_id, name, address, system_type, homeowner_stage)
     VALUES ($1,$2,$3,'BRAIDON M PILLA — Solar','3 Melvin Drive, Granite City, IL 62040','roof',$4)`,
    [PROJECT, USER_ID, CLIENT_ID, stage],
  );
  sentEmails.length = 0;
  microStageWrites.length = 0;
}

beforeAll(async () => {
  db = await PGlite.create();
  await applyMigrations(db);
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(() => seed());

// ═══════════════════════════════════════════════════════════════════════════
// 0. THE FIXTURE IS HONEST
// ═══════════════════════════════════════════════════════════════════════════

describe('the fixture can see a micro-stage at all', () => {
  it('project_micro_stages exists and accepts a row', async () => {
    // Without this, every "no row was written" assertion below passes because the
    // table is broken — the confident wrong answer a missing fixture produces.
    await db.query(
      `INSERT INTO project_micro_stages (project_id, micro_stage) VALUES ($1,'bill_uploaded')`,
      [PROJECT],
    );
    expect(await microStages()).toEqual(['bill_uploaded']);
  });

  it('and the portal really does translate that row into a customer-facing claim', () => {
    // The reason any of this matters. Read from the portal page itself so the
    // link between "a row exists" and "the customer is told something" is not an
    // assumption in this file's prose.
    const page = readFileSync(join(ROOT, 'app', 'portal', 'dashboard', 'page.tsx'), 'utf8');
    expect(page).toMatch(/bill_uploaded:\s*'Your utility bill was received'/);
    expect(page).toMatch(/install_started:\s*'Installation crew arrived at your home'/);
    expect(page).toMatch(/contract_signed:\s*"You signed — you're locked in!"/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE ADMIN "SAVE STAGE" CLICK
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 an admin selecting a stage records the selection, not its milestone', () => {
  it.each([
    ['under_review',  'that the utility bill was received'],
    ['site_survey',   'that the site visit report was submitted'],
    ['installation',  'that the crew arrived at the home'],
    ['completed',     'that the system is live'],
  ])('set-stage %s writes NO micro-stage (it would claim %s)', async (stage) => {
    const res = await adminSetStage(stage);
    expect(res.status).toBe(200);
    // The timing-free observation: the route did not even ask for a milestone.
    expect(microStageWrites,
      'selecting a stage asked for a milestone to be recorded').toEqual([]);
    // And the one that survives a fire-and-forget write — see `settle`.
    await settle();
    expect(await microStages(),
      'selecting a stage fabricated a dated milestone in the customer portal').toEqual([]);
  });

  it('but it DOES move the stage and log the change', async () => {
    // The paired positive. "No micro-stage" must not be achieved by the route
    // failing, and the history row is where a manual change legitimately lives —
    // the portal renders it as "Milestone reached: <label>".
    const res = await adminSetStage('site_survey', { note: 'spoke to homeowner' });
    expect(res.status).toBe(200);
    expect(await homeownerStage()).toBe('site_survey');
    expect(await stageHistory()).toEqual([{ stage: 'site_survey', note: 'spoke to homeowner' }]);
  });

  it('and the email it sends says the same thing the portal page says', async () => {
    // 🚨 F4: a SECOND hardcoded stage-copy table lived in this route. Its
    // `installation` entry read "Your solar system is being installed! Our crew
    // is on-site." — emailed by the same click, linking to a portal page saying
    // the installation was still being planned. Both now read
    // lib/portal/stageContent.ts, so this compares the email that was actually
    // sent against the table the portal renders.
    const res = await adminSetStage('installation');
    expect(res.status).toBe(200);
    const email = await waitForEmail();
    expect(email.stageBody).toBe(STAGE_CONTENT.installation.body);
    expect(email.stageNext).toBe(STAGE_CONTENT.installation.next);
    expect(email.stageLabel).toBe(STAGE_CONTENT.installation.roadmapLabel);
    // And the specific sentence that caused the contradiction is gone from it.
    expect(String(email.stageBody)).not.toMatch(/crew is on-site/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE INSTALLER'S OWN STAGE CONTROL
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 advancing a customer to Installation does not claim they signed', () => {
  it('no micro-stage is written at all', async () => {
    const res = await installerSetStage('installation');
    expect(res.status).toBe(200);
    expect(await microStages(),
      "the portal now tells the customer they signed a contract — on a project with no proposal")
      .toEqual([]);
    expect(await homeownerStage()).toBe('installation');
  });

  it('specifically, `contract_signed` is not among them', async () => {
    await installerSetStage('installation');
    expect(await microStages()).not.toContain('contract_signed');
  });

  it('and the entry-true mappings still work, so this is not a dead route', async () => {
    // `proposal` is entered by sending the proposal; `completed` once the system
    // is live. Removing one wrong entry must not silence the right ones.
    await seed('lead_submitted');
    expect((await installerSetStage('proposal')).status).toBe(200);
    expect(await microStages()).toEqual(['proposal_sent']);

    await seed('installation');
    expect((await installerSetStage('completed')).status).toBe(200);
    expect(await microStages()).toEqual(['install_completed']);
  });
});
