/**
 * tests/topographyPermitNodeCanGoGreen.postgres.test.ts
 *
 * A GUARD TYPED `false` CANNOT FIRE, AND THIS ONE WAS WRONG WHILE IT COULDN'T.
 *
 * `TopographyState.systemIntegration` declared four of its six flags as the
 * LITERAL type `false`, not `boolean`. That is not a default value — it makes
 * green unrepresentable, so the compiler itself would have rejected the correct
 * answer. Every project, forever, showed those nodes red on the /admin/topography
 * Site Survey Integration map.
 *
 * `usedInPermit` was the expensive one, because it was FALSE AND WRONG.
 * `permitIntegration` has a caller — app/api/engineering/permit/route.ts:1215 —
 * and the surveyed roofType, roofPitch, rafterSize, rafterSpacing, mainPanelAmps,
 * mainPanelBrand, utilityMeter, interconnectionMethod and panelBusRating override
 * the design values on the generated plan set (SURVEY_WINS_FIELDS, same file,
 * :1236-1247). The one dashboard built to answer "did the survey reach
 * engineering?" answered NO about the one place it demonstrably did.
 *
 * 🚨 THIS FILE EXECUTES REAL SQL (PGlite, in-process). `usedInPermit` is now
 * inferred from two rows this function already reads — a project_physical_data row
 * and a permit artifact in project_files — so the only way to test it is to put
 * those rows in a database and read the answer back.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT ASSERT. It does not claim
 * `appliedToSystemDefinition` or `usedInCAD` should be true. Both were
 * re-verified on this branch and are honestly false: `applyToSystemDefinition` is
 * called but its patched `definition` is consumed only by a console.log, and
 * `buildCADFromSurvey` is reachable only from `getArrayPlanFromPermit` /
 * `getStructuralFromPermit`, which have no callers anywhere. What this file DOES
 * assert about them is that they are now plain booleans — so the next person to
 * wire one changes a constant instead of fighting the type.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
/** PGlite has no pgcrypto; gen_random_uuid() is core since PG13, so only the
 *  CREATE EXTENSION line is dropped and every column definition is the shipped one. */
const pgliteSql = (...p: string[]) =>
  readFileSync(join(ROOT, ...p), 'utf8').replace(/^\s*CREATE EXTENSION[^;]*;/gim, '');

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
  return run as unknown as never;
}

vi.mock('@/lib/db-neon', () => ({ getDbReady: async () => neonShim(db) }));

import { getTopographyState } from '@/lib/topography/getTopographyState';

const USER    = '11111111-1111-4111-8111-111111111111';
const PROJECT = '44444444-4444-4444-8444-444444444444';

/** The tables getTopographyState reads. `project_physical_data` comes from its
 *  real migration; `site_surveys` and `project_files` are the columns this
 *  function selects, and nothing here asserts on their other columns. */
async function freshDb(): Promise<PGlite> {
  const pg = new PGlite();
  // In migration order, because it is load-bearing: 002 adds projects.lat/lng,
  // which this function SELECTs. A fixture missing them produced
  // `project fetch: column "lat" does not exist` in `state.errors` — which is
  // indistinguishable from a real product fault and is the exact false alarm the
  // sibling postgres suites warn about.
  await pg.exec(pgliteSql('lib', 'migrations', '001_initial_schema.sql'));
  await pg.exec(pgliteSql('lib', 'migrations', '002_project_coordinates.sql'));
  await pg.exec(pgliteSql('lib', 'migrations', '006_users_subscriptions_whitelabel.sql'));
  await pg.exec(pgliteSql('migrations', '013_project_physical_data.sql'));
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS site_surveys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID,
      survey_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS engineering_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS project_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID,
      file_type TEXT
    );
  `);
  await pg.exec(`INSERT INTO users (id, email, password_hash, name, plan)
                 VALUES ('${USER}', 'a@b.c', 'x', 'A', 'starter');`);
  await pg.exec(`INSERT INTO projects (id, user_id, name, address)
                 VALUES ('${PROJECT}', '${USER}', 'Braidon', '1 Main St');`);
  return pg;
}

const addSurvey = (pg: PGlite) => pg.exec(
  `INSERT INTO project_physical_data (project_id, roof_material, panel_rating_amps, rafter_spacing_in, interconnection_point)
   VALUES ('${PROJECT}', 'shingle', 200, 24, 'load_side');`);

const addPermitArtifact = (pg: PGlite, type = 'permit_planset') => pg.exec(
  `INSERT INTO project_files (project_id, file_type) VALUES ('${PROJECT}', '${type}');`);

beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db?.close(); });

// ── The node that could never go green ──────────────────────────────────────

describe('usedInPermit', () => {
  it('goes GREEN when the project has both a survey row and a permit artifact', async () => {
    await addSurvey(db);
    await addPermitArtifact(db);

    const state = await getTopographyState(PROJECT);

    // 🚨 This is the assertion the literal type `false` made IMPOSSIBLE to satisfy.
    expect(state.systemIntegration.usedInPermit).toBe(true);
    expect(state.permit.artifactExists).toBe(true);
    expect(state.survey.legacy).toBe(true);
    expect(state.errors).toEqual([]);
  });

  it('stays false with a survey but no permit artifact', async () => {
    await addSurvey(db);
    const state = await getTopographyState(PROJECT);
    expect(state.systemIntegration.usedInPermit).toBe(false);
  });

  it('stays false with a permit artifact but NO survey — permitIntegration never ran', async () => {
    // 🚨 The discrimination that matters for honesty in the other direction. The
    // permit route's survey block is gated on a project_physical_data row, so a
    // plan set generated without one never touched permitIntegration. Reading
    // "a permit exists" as "the survey reached the permit" would be the same
    // class of fabrication in reverse.
    await addPermitArtifact(db);
    const state = await getTopographyState(PROJECT);
    expect(state.permit.artifactExists).toBe(true);
    expect(state.systemIntegration.usedInPermit).toBe(false);
  });

  it('a cover sheet counts as a permit artifact, same as a planset', async () => {
    await addSurvey(db);
    await addPermitArtifact(db, 'permit_cover_sheet');
    expect((await getTopographyState(PROJECT)).systemIntegration.usedInPermit).toBe(true);
  });

  it('an unrelated project file is not a permit artifact', async () => {
    await addSurvey(db);
    await addPermitArtifact(db, 'engineering');
    expect((await getTopographyState(PROJECT)).systemIntegration.usedInPermit).toBe(false);
  });
});

// ── The type itself ─────────────────────────────────────────────────────────

describe('no flag is locked to a literal false any more', () => {
  it('all six integration flags are plain booleans at runtime', async () => {
    await addSurvey(db);
    await addPermitArtifact(db);
    const si = (await getTopographyState(PROJECT)).systemIntegration;
    for (const key of [
      'appliedToSystemDefinition', 'usedInCAD', 'usedInEngineering',
      'usedInEngineeringPartial', 'usedInPermit', 'usedInProposal',
    ] as const) {
      expect(typeof si[key], `${key} is not a boolean`).toBe('boolean');
    }
  });

  it('a `false` assignment to usedInPermit would be a TYPE ERROR no more', () => {
    // 🚨 THE STRUCTURAL PROOF, and the reason this test is a source read and says
    // so: the defect was in the TYPE, and a type is not observable at runtime —
    // `typeof false` is 'boolean' whether the declared type is `false` or
    // `boolean`. So the declaration is read from the file with comments stripped,
    // because the repair's own comments necessarily quote the literal `false`
    // spelling they removed, and a raw text search would match the explanation of
    // the fix and report the defect as still present. This suite's sibling in
    // tests/contractorPerformanceIsUnmeasured.test.ts was bitten by exactly that.
    const src = stripComments(readFileSync(join(ROOT, 'lib', 'topography', 'getTopographyState.ts'), 'utf8'));

    // The interface body, taken from the `systemIntegration: {` declaration to its
    // closing brace, so the assertion cannot be satisfied by text elsewhere.
    const start = src.indexOf('systemIntegration: {');
    expect(start, 'the systemIntegration declaration is gone').toBeGreaterThan(-1);
    const end = src.indexOf('};', start);
    const decl = src.slice(start, end);

    for (const field of ['appliedToSystemDefinition', 'usedInCAD', 'usedInPermit', 'usedInProposal']) {
      expect(decl, `${field} is still typed as the literal false`)
        .not.toMatch(new RegExp(`${field}\\s*:\\s*false`));
      expect(decl, `${field} is not declared boolean`)
        .toMatch(new RegExp(`${field}\\s*:\\s*boolean`));
    }
  });
});

// ── The stale comment that justified the wrong value ────────────────────────

describe('the file no longer asserts a caller count that has changed', () => {
  it('the "0 callers of permitIntegration" claim is gone', () => {
    // A SOURCE READ, stated plainly. The claim being removed IS prose, so there is
    // nothing else to read — and comments are deliberately NOT stripped here,
    // because the comment text is the thing under test.
    const raw = readFileSync(join(ROOT, 'lib', 'topography', 'getTopographyState.ts'), 'utf8');
    // The exact phrasing that sat next to the wrong value and justified it.
    expect(raw).not.toMatch(/0 callers of permitIntegration/);
    // And the replacement names the caller, so the next reader can check it.
    expect(raw).toMatch(/permit\/route\.ts:1215/);
    // 🚨 NOT ASSERTED, on purpose: that the words "permitIntegration -> 0 callers"
    // appear nowhere. The repair's own header QUOTES the stale claim in order to
    // explain why it was removed, so such an assertion would fail on the fixed
    // file and pass on nothing useful — the mirror image of the trap in
    // tests/support/stripSource.ts's header, where a guard was satisfied by the
    // comment documenting the code's removal.
  });
});
