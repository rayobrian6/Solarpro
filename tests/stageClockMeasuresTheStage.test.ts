/**
 * tests/stageClockMeasuresTheStage.test.ts
 *
 * A REAL NUMBER WITH A FALSE LABEL, AND A FOLLOW-UP THAT COULD NEVER FIRE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT (C4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every days-in-stage number in the CRM lane was `now - projects.updated_at`.
 * `updated_at` is bumped by 20+ unrelated writers — saving a layout, editing a
 * note, uploading a bill, the `project_status` backfill in
 * `/api/operations/projects`, the system writing to itself. Two consequences,
 * and the second is the one a user sees:
 *
 *   1. THE RULE NEVER FIRED. `lib/commands/generateActions.ts` rule 4 creates
 *      the AHJ chase-up command for `permit_submitted` + `daysStale >= 5`. A
 *      project genuinely sitting with the AHJ for six weeks reported 0 days for
 *      as long as anyone touched the row, so the command was never created for
 *      the projects most likely to be actively worked. The dashboard's stall
 *      detection went with it: nothing turned red.
 *
 *   2. THE LABEL ASSERTED AN EVENT THAT WAS NOT MEASURED. "Proposal sent 7d ago
 *      with no response" was really "nothing has touched this row for 7d", and
 *      `getNextStep` printed "5d stalled" — an accusation about a deal built
 *      from a fact about a row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS TESTED HERE, AND WHAT IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 * These are the two SHIPPED rule engines — `generateActionsForProject` and
 * `getNextStep`/`getActionItems` — driven with clocks. They are pure, so no
 * database and no render is needed and the behaviour is measured directly rather
 * than scanned for.
 *
 * 🚨 THE FALLBACK IS THE IMPORTANT HALF. The correct fix is a
 * `projects.stage_changed_at` column, which needs a migration and is reported as
 * NEEDS-MIGRATION. Until it lands, most projects have no stage-change record and
 * the clock falls back to `updated_at` — so what matters is that the fallback
 * STILL PRODUCES THE COMMAND (a follow-up that never appears is the worse
 * failure) while REFUSING to describe the number as a stage event. A wrong label
 * on a real number is the user-facing defect; it survives any fix to the number.
 *
 * Not covered here: whether any route SUPPLIES `last_stage_change_at`. None does
 * yet — `app/api/commands/generate` and `app/api/operations/projects` belong to
 * other file sets and the one-line SELECT each needs is reported as a handoff.
 * These tests measure the receiving end, which is what a handoff has to be able
 * to rely on.
 */

import { describe, it, expect } from 'vitest';
import { generateActionsForProject } from '@/lib/commands/generateActions';
import { getNextStep, getActionItems } from '@/lib/operations/getNextStep';
import {
  resolveStageAge,
  describeStageAge,
  stageAgeBadge,
  classifyStageAge,
  daysSinceTimestamp,
  STAGE_CHANGED_AT_DDL,
} from '@/lib/operations/stageClock';

const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE RULE THAT NEVER FIRED
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the AHJ chase-up command survives an unrelated write', () => {
  it('a project parked in permit_submitted for 30 days produces the command, even though the row was just touched', () => {
    // THE EXACT SHAPE OF THE DEFECT. A project has been with the AHJ for a month.
    // Someone saved a layout an hour ago, so `updated_at` is now. Before the
    // repair `daysStale` was 0 and rule 4 (>= 5 days) could not fire.
    const actions = generateActionsForProject({
      id: PROJECT,
      name: 'Braidon',
      project_status: 'permit_submitted',
      updated_at: new Date().toISOString(),   // a layout save, an hour ago
      last_stage_change_at: daysAgo(30),      // the AHJ has had it for a month
    });

    const permit = actions.find(a => a.type === 'permit_followup');
    expect(permit, 'no AHJ chase-up for a permit that has been out 30 days').toBeDefined();
    expect(permit!.priority, '30 days out is not merely "high"').toBe('critical');
    expect(permit!.description).toMatch(/Permit submitted 30d ago/);
  });

  it('and the same project with no stage-change record still produces it, from the fallback', () => {
    // The common case until the column lands. The command MUST still appear —
    // silence would be a worse regression than the wrong label.
    const actions = generateActionsForProject({
      id: PROJECT,
      name: 'Braidon',
      project_status: 'permit_submitted',
      updated_at: daysAgo(30),
    });
    const permit = actions.find(a => a.type === 'permit_followup');
    expect(permit).toBeDefined();
    // 🚨 BUT IT MAY NOT CLAIM THE PERMIT WAS SUBMITTED 30 DAYS AGO.
    expect(permit!.description,
      'the fallback number is being described as a submission date')
      .not.toMatch(/Permit submitted 30d ago/);
    expect(permit!.description).toMatch(/no activity on this project for 30d/);
  });

  it('a freshly-submitted permit produces nothing', () => {
    const actions = generateActionsForProject({
      id: PROJECT, name: 'Braidon', project_status: 'permit_submitted',
      updated_at: daysAgo(30), last_stage_change_at: daysAgo(1),
    });
    expect(actions.find(a => a.type === 'permit_followup'),
      'a permit submitted yesterday produced a chase-up').toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE LABEL
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a number may only be described as the event it measured', () => {
  it('the proposal follow-up names the send date ONLY when the clock measured the stage', () => {
    const measured = generateActionsForProject({
      id: PROJECT, name: 'Braidon', project_status: 'proposal_sent',
      updated_at: daysAgo(1), last_stage_change_at: daysAgo(7),
    });
    expect(measured[0].description).toMatch(/^Proposal sent 7d ago with no response\./);
  });

  it('and says what it actually measured otherwise', () => {
    // BEFORE THE REPAIR this read "Proposal sent 7d ago with no response." for a
    // row whose only known fact was that nothing had touched it for 7 days. The
    // proposal may have gone out this morning.
    const fallback = generateActionsForProject({
      id: PROJECT, name: 'Braidon', project_status: 'proposal_sent',
      updated_at: daysAgo(7),
    });
    expect(fallback[0].description).not.toMatch(/Proposal sent/);
    expect(fallback[0].description).toMatch(/^no activity on this project for 7d\./);
    // The number itself is unchanged and still drives the priority — the repair
    // relabels, it does not soften.
    expect(fallback[0].priority).toBe('critical');
  });

  it('no generated description claims a stage event on a fallback clock', () => {
    // The generalisation, across every rule in the file rather than the two
    // above. Any past-tense stage claim on an `updated_at`-only project is the
    // defect, however the rules are later edited.
    const EVENT_CLAIM = /\b(Proposal sent|Permit submitted|Design completed|Site assessment started|Reached \w+ stage|Created as a lead)\b/;
    const stages = [
      'proposal_sent', 'permit_submitted', 'design_complete', 'site_assessment',
      'lead', 'design', 'proposal', 'approved',
    ];
    for (const stage of stages) {
      const actions = generateActionsForProject({
        id: PROJECT, name: 'Braidon', project_status: stage, status: stage,
        updated_at: daysAgo(12),
      });
      for (const a of actions) {
        expect(a.description, `${stage}: "${a.description}" asserts an event from updated_at`)
          .not.toMatch(EVENT_CLAIM);
      }
    }
  });

  it('and every rule that CAN name an event does so once the clock earns it', () => {
    // The positive control. Without it the assertion above is satisfied by a
    // repair that simply deleted every event phrase.
    const named = [
      ['proposal_sent', /Proposal sent 12d ago/],
      ['permit_submitted', /Permit submitted 12d ago/],
      ['design_complete', /Design completed 12d ago/],
      ['site_assessment', /Site assessment started 12d ago/],
    ] as const;
    for (const [stage, re] of named) {
      const actions = generateActionsForProject({
        id: PROJECT, name: 'Braidon', project_status: stage,
        updated_at: daysAgo(1), last_stage_change_at: daysAgo(12),
      });
      expect(actions.length, `${stage} produced no action at all`).toBeGreaterThan(0);
      expect(actions.map(a => a.description).join(' | '),
        `${stage} never names its own event`).toMatch(re);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. "STALLED" IS A CLAIM ABOUT A STAGE
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 getNextStep does not call a quiet record a stalled deal', () => {
  it('a measured stage stall says "in stage" and goes red', () => {
    const step = getNextStep('permit_submitted', {
      last_stage_change_at: daysAgo(9), updated_at: daysAgo(1),
    }, false, false);
    expect(step.label).toBe('9d in stage — Follow up with AHJ on permit');
    expect(step.urgency).toBe('red');
    expect(step.urgent).toBe(true);
    expect(step.age.measuresStage).toBe(true);
  });

  it('an updated_at-only number says "no activity" and does NOT go red', () => {
    // BEFORE THE REPAIR: "9d stalled — Follow up with AHJ on permit", red, on a
    // number that says nothing about the stage. A red card is the strongest
    // signal on the board.
    const step = getNextStep('permit_submitted', { updated_at: daysAgo(9) }, false, false);
    expect(step.label).toBe('9d no activity — Follow up with AHJ on permit');
    expect(step.label).not.toMatch(/stalled/);
    expect(step.urgency, 'a fallback number raised the red state').toBe('yellow');
    expect(step.urgent).toBe(false);
    expect(step.age.measuresStage).toBe(false);
  });

  it('a bare timestamp — what every existing caller passes — is treated as last-touch', () => {
    // Backwards compatibility with an honest reading, not a silent upgrade: a
    // lone `updated_at` string cannot become a stage clock by being passed
    // positionally.
    const step = getNextStep('permit_submitted', daysAgo(9), false, false);
    // 🚨 THE LABEL IS ASSERTED FIRST, DELIBERATELY. Reading `step.age` first
    // throws on the old code (the field did not exist) and a TypeError masks the
    // assertion that carries the finding. The red must name the string the
    // product used to print: "9d stalled — Follow up with AHJ on permit".
    expect(step.label).toBe('9d no activity — Follow up with AHJ on permit');
    expect(step.label).not.toMatch(/stalled/);
    expect(step.age.basis).toBe('last_activity');
  });

  it('getActionItems reports ONE number, the one its own label used', () => {
    // It used to call the day-count helper a second time, independently of the
    // label, so the badge and the sentence could in principle disagree.
    const [item] = getActionItems([{
      id: PROJECT, name: 'Braidon', project_status: 'permit_submitted',
      updated_at: daysAgo(2), last_stage_change_at: daysAgo(11),
    }]);
    expect(item.daysInStage).toBe(11);
    expect(item.action).toMatch(/^11d in stage/);
    expect(item.age.measuresStage).toBe(true);
    expect(stageAgeBadge(item.age)).toBe('11d in stage');
  });

  it('a lead is never stalled, measured or not', () => {
    expect(getNextStep('lead', { last_stage_change_at: daysAgo(40) }).urgency).not.toBe('red');
    expect(getNextStep('lead', { updated_at: daysAgo(40) }).urgency).not.toBe('red');
  });

  it('a complete project reports a clock but no urgency', () => {
    const step = getNextStep('complete', { last_stage_change_at: daysAgo(40) });
    expect(step.urgency).toBe('green');
    expect(step.age.days).toBe(40);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE CLOCK ITSELF
// ═══════════════════════════════════════════════════════════════════════════
//
// Characterisation of the new module. These cannot be made to go red by
// restoring the old code — the module did not exist — and are NOT counted as
// evidence for C4. The evidence is §1–§3, which run the shipped rule engines.

describe('resolveStageAge', () => {
  it('prefers the column, then the derived value, then the last touch', () => {
    expect(resolveStageAge({
      stage_changed_at: daysAgo(3), last_stage_change_at: daysAgo(10), updated_at: daysAgo(20),
    })).toMatchObject({ days: 3, basis: 'stage_change', measuresStage: true });

    expect(resolveStageAge({
      last_stage_change_at: daysAgo(10), updated_at: daysAgo(20),
    })).toMatchObject({ days: 10, basis: 'stage_change', measuresStage: true });

    expect(resolveStageAge({ updated_at: daysAgo(20) }))
      .toMatchObject({ days: 20, basis: 'last_activity', measuresStage: false });

    expect(resolveStageAge({ created_at: daysAgo(5) }))
      .toMatchObject({ days: 5, basis: 'last_activity', measuresStage: false });
  });

  it('reports unknown rather than 0 days when there is nothing to measure', () => {
    const age = resolveStageAge(null);
    expect(age.basis).toBe('unknown');
    expect(age.at).toBeNull();
    expect(stageAgeBadge(age)).toBe('—');
    expect(describeStageAge(age, 'Proposal sent')).toBe('no recorded activity');
  });

  it('an unparsable timestamp falls through instead of producing NaN', () => {
    expect(daysSinceTimestamp('not a date')).toBeNull();
    const age = resolveStageAge({ stage_changed_at: 'not a date', updated_at: daysAgo(4) });
    expect(age.days).toBe(4);
    expect(age.basis).toBe('last_activity');
  });

  it('a future timestamp floors at 0 rather than going negative', () => {
    expect(resolveStageAge({ stage_changed_at: daysAgo(-5) }).days).toBe(0);
  });

  it('classifyStageAge only calls it stalled when the stage was measured', () => {
    expect(classifyStageAge(resolveStageAge({ last_stage_change_at: daysAgo(6) }), 5))
      .toEqual({ stalled: true, quiet: false });
    expect(classifyStageAge(resolveStageAge({ updated_at: daysAgo(6) }), 5))
      .toEqual({ stalled: false, quiet: true });
    expect(classifyStageAge(resolveStageAge({ updated_at: daysAgo(1) }), 5))
      .toEqual({ stalled: false, quiet: false });
  });

  it('describeStageAge never produces an event phrase from a fallback clock', () => {
    const fallback = resolveStageAge({ updated_at: daysAgo(8) });
    expect(describeStageAge(fallback, 'Proposal sent')).not.toMatch(/Proposal sent/);
    const measured = resolveStageAge({ last_stage_change_at: daysAgo(8) });
    expect(describeStageAge(measured, 'Proposal sent')).toBe('Proposal sent 8d ago');
    expect(describeStageAge(measured)).toBe('8d in this stage');
  });

  it('the migration that makes all of this one read is stated, not guessed at', () => {
    // NEEDS-MIGRATION. No .sql file was added; the DDL lives as a constant so
    // whoever registers it does not re-derive the column type or the index.
    expect(STAGE_CHANGED_AT_DDL)
      .toMatch(/ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;/);
    expect(STAGE_CHANGED_AT_DDL).toMatch(/idx_projects_stage_changed_at/);
  });
});
