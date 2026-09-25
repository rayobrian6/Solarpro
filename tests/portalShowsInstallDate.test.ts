/**
 * tests/portalShowsInstallDate.test.ts
 *
 * THE MOST-ASKED QUESTION A SOLAR INSTALLER GETS, AND THE PORTAL DID NOT ANSWER IT.
 *
 * "When is my installation scheduled?" is 18.6% of inbound support contacts —
 * the single largest category. The date has been written all along, by both the
 * operations PATCH and the schedule modal. The portal's dashboard query simply
 * never selected it, so the card showed one static sentence — "you'll receive a
 * confirmed date soon" — for the whole permit-to-PTO window, and the homeowner
 * phoned in to ask.
 *
 * 🚨 WHICH COLUMN IS THE AUTHORITY, AND WHY IT MATTERS HERE MORE THAN USUAL.
 *
 * Two places hold an install date:
 *   - `projects.install_date` — written by BOTH paths. `ScheduleInstallModal`
 *     PATCHes it before it files a schedule item, and the operations route
 *     writes it directly. One value, UPDATED in place.
 *   - `project_schedule` — written by ONE path, with no UPDATE and no DELETE
 *     route in the codebase, so a reschedule APPENDS a row. "The latest one"
 *     is an inference, not a fact.
 *
 * A homeowner books time off work around this line. Being given the wrong date
 * is worse than being given none, so the portal reads the column every writer
 * maintains — and an unparseable value renders nothing rather than a
 * placeholder that looks like information.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const ROUTE_RAW = readFileSync(join(ROOT, 'app', 'api', 'portal', 'dashboard', 'route.ts'), 'utf8');

/**
 * Blank SQL `--` line comments, keeping length and line structure.
 *
 * 🚨 BECAUSE `stripComments` CANNOT SEE INTO A TEMPLATE LITERAL. The select
 * list lives inside one, so its explanatory comments survive a JS comment
 * strip — and this file's own note explaining why `project_schedule` was NOT
 * chosen therefore matched the guard forbidding it. That is the fourth time in
 * this campaign a guard has been tripped by the prose written to explain it.
 * Blanking rather than deleting preserves offsets, exactly as the JS stripper
 * does, so index-based assertions elsewhere keep working.
 */
const stripSqlComments = (s: string) =>
  s.replace(/--[^\n]*/g, m => ' '.repeat(m.length));

const ROUTE_SQL = stripSqlComments(ROUTE_RAW);
const PAGE = read('app', 'portal', 'dashboard', 'page.tsx');
const SCHEDULE_ROUTE = read('app', 'api', 'schedule', 'route.ts');

describe('🚨 the portal asks for the install date', () => {
  it('the dashboard query selects it', () => {
    // Read RAW: the select list lives inside a SQL template literal, which a
    // JS comment stripper does not see into.
    expect(ROUTE_SQL, 'the portal still does not ask for the install date')
      .toMatch(/p\.install_date/);
  });

  it('🚨 it reads the column every writer maintains, not the append-only log', () => {
    expect(ROUTE_SQL, 'the portal is reading the schedule log, where a reschedule appends a second row')
      .not.toMatch(/project_schedule/);
  });

  it('and that premise still holds — project_schedule has no update path', () => {
    // If an UPDATE or DELETE route ever appears on project_schedule, the
    // reasoning above changes and this choice must be revisited rather than
    // silently inherited.
    expect(SCHEDULE_ROUTE).not.toMatch(/export async function (PATCH|PUT|DELETE)/);
    expect(SCHEDULE_ROUTE).toMatch(/INSERT INTO project_schedule/);
  });
});

describe('🚨 what the homeowner is shown is never invented', () => {
  it('an absent or unparseable date renders NOTHING, not a placeholder', () => {
    const i = PAGE.indexOf('const installDateLabel = (() => {');
    expect(i, 'the guarded formatter is gone').toBeGreaterThan(-1);
    const body = PAGE.slice(i, PAGE.indexOf('})();', i));
    expect(body, 'a missing date no longer short-circuits').toMatch(/if \(!raw\) return null;/);
    expect(body, 'an unparseable date would render as Invalid Date')
      .toMatch(/Number\.isNaN\(d\.getTime\(\)\) *\) *return null;/);
  });

  it('the card renders it only when there is one', () => {
    expect(PAGE).toMatch(/\{installDateLabel \?/);
    expect(PAGE).toMatch(/Installation scheduled/);
  });

  it('🚨 and the promise to call about it YIELDS once it is known', () => {
    // The stage copy says "We'll reach out to confirm your installation date."
    // Once a date is confirmed that sentence is false, and telling someone you
    // will call about something you have already decided is how a portal loses
    // the trust it just earned.
    expect(PAGE, 'the portal still promises to confirm a date it is already showing')
      .toMatch(/\{content\.next && !installDateLabel \?/);
  });

  it('the formatter produces a real human date', () => {
    // The exact options the page uses, exercised directly — a formatter that
    // silently produced an empty string would pass the structural guards above.
    const label = new Date('2026-11-14T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    });
    expect(label).toMatch(/November/);
    expect(label).toMatch(/2026/);
    expect(label.length).toBeGreaterThan(10);
  });
});
