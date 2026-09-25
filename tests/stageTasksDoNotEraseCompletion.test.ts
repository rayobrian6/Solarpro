/**
 * tests/stageTasksDoNotEraseCompletion.test.ts
 *
 * MOVING A PROJECT BACK A STAGE DELETED THE CREW'S COMPLETED CHECKLIST.
 *
 * 🚨 A DESTRUCTIVE WRITE DRESSED AS AN IDEMPOTENT ONE.
 *
 * `generateTasksForStage` opened with a DELETE of every task for that
 * project+stage and then re-INSERTed the whole TASK_MAP as `'pending'`. Its own
 * comment called this "Idempotent: clears existing tasks for the stage first" —
 * and it is idempotent in the sense the author meant, which is that running it
 * twice does not produce duplicate rows. It is not idempotent in the sense that
 * matters: running it twice destroys everything that happened in between.
 *
 * `project_tasks` is not a derived view. It is where the crew's work is
 * recorded: `status` and `completed_at` are written by a human ticking a box in
 * `PATCH /api/projects/[id]/tasks`, and `GET` on the same route reports a
 * completion percentage from them. Deleting a row deletes the fact that someone
 * did the work, and there is no undo, no tombstone and no activity-log entry
 * for it — the transition log records the stage change, never the erasure.
 *
 * REACHING IT TAKES ONE CLICK. Neither caller constrains the move:
 *
 *   - `app/api/projects/transition/route.ts` gates on `isValidStage(newStage)`,
 *     which only asks whether the string is a member of the enum. There is no
 *     ordering rule, so installation → inspection → installation is accepted,
 *     which is precisely what a failed inspection looks like.
 *   - `app/api/projects/update-status/route.ts` has no same-stage check either,
 *     so re-selecting the stage a project is already in wipes its checklist.
 *
 * Both callers wrap the call in try/catch and treat failure as non-fatal, so
 * the erasure is silent in the success case and silent in the failure case.
 *
 * THE FIX IS ADDITIVE, NOT A NARROWER DELETE. Generation now inserts only the
 * titles that are not already present for that project+stage, in one statement,
 * and never touches a row that exists. Duplicate-suppression — the thing the
 * DELETE was actually for — is preserved; the data loss is not. A title dropped
 * from TASK_MAP leaves its existing rows alone rather than removing them: a
 * completed task is a record of work, and retiring it from the template is not
 * a reason to deny it happened.
 *
 * 🚨 THIS FILE EXECUTES REAL SQL. PGlite — PostgreSQL in-process, no daemon and
 * no credentials — running the shipped function against the real DDL. A
 * source-scanning test could assert "no DELETE appears" and would have passed
 * on an implementation that deleted by a different spelling; only running it
 * tells you whether a completed row survived.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(__dirname, '..');

// ── The real database, shimmed to Neon's tagged-template shape ──────────────
// Same translation the other .postgres tests in this suite use.
let db: PGlite;

function neonShim(pg: PGlite) {
  const run = async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
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
  };
  return run as unknown as ReturnType<typeof import('@neondatabase/serverless').neon>;
}

vi.mock('@neondatabase/serverless', () => ({ neon: () => neonShim(db) }));
vi.mock('@/lib/db-ready', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbWithRetry: async () => neonShim(db),
}));
vi.mock('@/lib/db-neon', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbReady: async () => neonShim(db),
}));

const { generateTasksForStage, checkStageCompletion } =
  await import('@/lib/operations/generateTasksForStage');
const { TASK_MAP } = await import('@/lib/operations/pipeline');

/**
 * The REAL `project_tasks` DDL, lifted out of the file that actually creates it
 * rather than retyped here.
 *
 * 🚨 `project_tasks` has no numbered migration — it is created inline by
 * `app/api/migrate/route.ts` (step 016b). Extracting it from source instead of
 * pasting a copy means this fixture cannot drift away from production, and the
 * extraction failing is itself a signal that the DDL moved.
 */
function realProjectTasksDDL(): string {
  const src = readFileSync(join(ROOT, 'app', 'api', 'migrate', 'route.ts'), 'utf8');
  const start = src.indexOf('CREATE TABLE IF NOT EXISTS project_tasks (');
  if (start < 0) throw new Error('the project_tasks DDL is no longer in app/api/migrate/route.ts');
  const end = src.indexOf(')', src.indexOf('completed_at', start));
  if (end < 0) throw new Error('could not find the end of the project_tasks DDL');
  return src.slice(start, end + 1);
}

const PROJECT = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJECT = '33333333-3333-4333-8333-333333333333';

/** The first stage in TASK_MAP that actually has tasks, and its titles. */
const STAGE = (Object.keys(TASK_MAP) as Array<keyof typeof TASK_MAP>)
  .find((s) => (TASK_MAP[s] ?? []).length > 1)!;
const TITLES = TASK_MAP[STAGE] as string[];

beforeAll(async () => {
  db = new PGlite();
  // Only the FK target is needed from `projects`; every assertion below is about
  // rows in `project_tasks`, so the parent is deliberately minimal rather than a
  // partial copy of the real projects table that could be mistaken for one.
  await db.exec(`CREATE TABLE projects (id UUID PRIMARY KEY);`);
  await db.exec(realProjectTasksDDL() + ';');
  await db.exec(`INSERT INTO projects (id) VALUES ('${PROJECT}'), ('${OTHER_PROJECT}');`);
});

afterAll(async () => { await db?.close(); });

beforeEach(async () => { await db.exec('DELETE FROM project_tasks;'); });

async function rows(projectId = PROJECT) {
  const r = await db.query<{ title: string; status: string; completed_at: Date | null; id: string }>(
    `SELECT id, title, status, completed_at FROM project_tasks
     WHERE project_id = $1 AND stage = $2 ORDER BY title`,
    [projectId, STAGE],
  );
  return r.rows;
}

/** A crew member ticking the box — the same write PATCH /tasks performs. */
async function complete(title: string) {
  await db.query(
    `UPDATE project_tasks SET status = 'completed', completed_at = now()
     WHERE project_id = $1 AND stage = $2 AND title = $3`,
    [PROJECT, STAGE, title],
  );
}

describe('🚨 re-entering a stage must not erase what the crew finished', () => {
  it('the fixture is a real stage with real tasks', () => {
    // Guards the whole file: if TASK_MAP were empty, every assertion below
    // would pass vacuously against any implementation at all.
    expect(TITLES.length).toBeGreaterThan(1);
  });

  it('first entry into a stage creates the checklist, all pending', async () => {
    const res = await generateTasksForStage(PROJECT, STAGE as never);
    expect(res.inserted).toBe(TITLES.length);

    const got = await rows();
    expect(got.map((r) => r.title).sort()).toEqual([...TITLES].sort());
    expect(got.every((r) => r.status === 'pending')).toBe(true);
    expect(got.every((r) => r.completed_at === null)).toBe(true);
  });

  it('🚨 a completed task SURVIVES re-entering the stage', async () => {
    await generateTasksForStage(PROJECT, STAGE as never);
    await complete(TITLES[0]);

    const before = (await rows()).find((r) => r.title === TITLES[0])!;
    expect(before.status).toBe('completed');

    // A failed inspection sends the project back. This is the call that used to
    // DELETE the row above and re-insert it as 'pending'.
    await generateTasksForStage(PROJECT, STAGE as never);

    const after = (await rows()).find((r) => r.title === TITLES[0]);
    expect(after, 'the completed task row was deleted outright').toBeDefined();
    expect(after!.status, 'the crew\'s completed task was reset to pending').toBe('completed');
    expect(after!.completed_at, 'the completion timestamp was destroyed').not.toBeNull();
    expect(after!.id, 'the row was replaced rather than kept — anything referencing it now dangles')
      .toBe(before.id);
  });

  it('🚨 and so does the whole checklist, not just the row we looked at', async () => {
    await generateTasksForStage(PROJECT, STAGE as never);
    for (const t of TITLES) await complete(t);

    await generateTasksForStage(PROJECT, STAGE as never);

    const after = await rows();
    expect(after.filter((r) => r.status === 'completed').length,
      'a fully-worked stage came back empty')
      .toBe(TITLES.length);

    // The reported percentage is what the operator actually sees.
    const stats = await checkStageCompletion(PROJECT, STAGE as never);
    expect(stats.allComplete).toBe(true);
    expect(stats.completed).toBe(TITLES.length);
  });

  it('re-entry still does not duplicate rows — the DELETE\'s actual purpose is kept', async () => {
    await generateTasksForStage(PROJECT, STAGE as never);
    await generateTasksForStage(PROJECT, STAGE as never);
    await generateTasksForStage(PROJECT, STAGE as never);

    const got = await rows();
    expect(got.length, 'generation duplicated the checklist').toBe(TITLES.length);
    // And it reports honestly that it added nothing the second time.
    const res = await generateTasksForStage(PROJECT, STAGE as never);
    expect(res.inserted).toBe(0);
  });

  it('a title missing from the checklist is added without disturbing the others', async () => {
    await generateTasksForStage(PROJECT, STAGE as never);
    await complete(TITLES[0]);
    // Someone deleted one task by hand; re-entering the stage should restore it.
    await db.query(`DELETE FROM project_tasks WHERE project_id = $1 AND stage = $2 AND title = $3`,
      [PROJECT, STAGE, TITLES[1]]);

    const res = await generateTasksForStage(PROJECT, STAGE as never);
    expect(res.inserted).toBe(1);

    const got = await rows();
    expect(got.length).toBe(TITLES.length);
    expect(got.find((r) => r.title === TITLES[0])!.status).toBe('completed');
    expect(got.find((r) => r.title === TITLES[1])!.status).toBe('pending');
  });

  it('a task a user added by hand is not swept away by generation', async () => {
    // `project_tasks` has a free-text title and no constraint tying it to
    // TASK_MAP. The DELETE was by project+stage, so it removed these too.
    await generateTasksForStage(PROJECT, STAGE as never);
    await db.query(
      `INSERT INTO project_tasks (project_id, title, status, stage)
       VALUES ($1, $2, 'completed', $3)`,
      [PROJECT, 'Call the HOA about the gate code', STAGE],
    );

    await generateTasksForStage(PROJECT, STAGE as never);

    const got = await rows();
    expect(got.map((r) => r.title)).toContain('Call the HOA about the gate code');
  });

  it('generation is scoped to its own project and stage', async () => {
    // The insert must not become so permissive that it stops distinguishing
    // rows — a NOT EXISTS over the wrong columns would silently insert nothing
    // for the second project and this is what catches it.
    await generateTasksForStage(PROJECT, STAGE as never);
    const res = await generateTasksForStage(OTHER_PROJECT, STAGE as never);
    expect(res.inserted).toBe(TITLES.length);
    expect((await rows(OTHER_PROJECT)).length).toBe(TITLES.length);

    const otherStage = (Object.keys(TASK_MAP) as string[])
      .find((s) => s !== STAGE && (TASK_MAP[s as never] as string[] ?? []).length > 0);
    if (otherStage) {
      const r2 = await generateTasksForStage(PROJECT, otherStage as never);
      expect(r2.inserted).toBe((TASK_MAP[otherStage as never] as string[]).length);
      // ...and the first stage's completed work is untouched by it.
      expect((await rows()).length).toBe(TITLES.length);
    }
  });

  it('a stage with no tasks is a no-op, not a wipe', async () => {
    await generateTasksForStage(PROJECT, STAGE as never);
    await complete(TITLES[0]);

    const empty = (Object.keys(TASK_MAP) as string[])
      .find((s) => ((TASK_MAP[s as never] as string[]) ?? []).length === 0);
    if (!empty) return; // nothing to assert on this TASK_MAP
    const res = await generateTasksForStage(PROJECT, empty as never);
    expect(res.inserted).toBe(0);
    expect((await rows()).find((r) => r.title === TITLES[0])!.status).toBe('completed');
  });
});
