/**
 * tests/stageEntryIsNotAnOutcome.test.ts
 *
 * ENTERING "INSPECTION" WOULD HAVE TOLD THE HOMEOWNER IT PASSED.
 *
 * 🚨 A LANDMINE IN DORMANT CODE, ARMED BY THE FIX THAT WAS ABOUT TO LAND.
 *
 * `/api/projects/transition` is a governed stage machine whose docblock calls
 * it "the ONLY authorised path". It has **zero callers** — every real stage
 * write goes to `update-status`, which validates set membership and nothing
 * else. Repointing those writers at the governed route is the top recommendation
 * from the CRM research lane, and it also unlocks the homeowner lane's top item,
 * because this route's map already covers `permit_submitted`, `permit_approved`,
 * `install_scheduled` and `pto_submitted`.
 *
 * Which is exactly what made this dangerous. The map contained
 * `inspection: 'inspection_passed'`. `writeMicroStage` forward-syncs
 * `homeowner_stage`, and the customer portal renders micro-stages as
 * milestones — so the moment anyone wired this route up, every project ENTERING
 * inspection would have announced to its homeowner that the inspection had
 * PASSED. A customer acts on that. And it would have arrived as a side effect
 * of an unrelated improvement, which is the worst way for a defect to ship.
 *
 * THE RULE: a stage ENTRY is not an OUTCOME. Every other entry in that map
 * records something that has genuinely happened by the time the stage begins.
 * Inspection is the one stage whose entire purpose is that it can fail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { MICRO_STAGES } from '../lib/microStage';

const ROOT = join(__dirname, '..');
const ROUTE = stripComments(
  readFileSync(join(ROOT, 'app', 'api', 'projects', 'transition', 'route.ts'), 'utf8'),
);

/** The map body, anchored on real syntax rather than a character count. */
function mapBody(): string {
  const i = ROUTE.indexOf('const PIPELINE_STAGE_TO_MICRO');
  expect(i, 'the stage-to-micro map is gone').toBeGreaterThan(-1);
  const end = ROUTE.indexOf('};', i);
  expect(end).toBeGreaterThan(i);
  return ROUTE.slice(i, end);
}

describe('🚨 entering a stage never claims its outcome', () => {
  it('inspection maps to nothing', () => {
    expect(mapBody(), 'entering inspection announces a result the inspection has not had')
      .not.toMatch(/inspection:\s*'inspection_passed'/);
    expect(mapBody(), 'inspection is mapped to something again — a stage entry is not an outcome')
      .not.toMatch(/^\s*inspection:\s*'/m);
  });

  it('and `inspection_passed` still exists for whatever observes a real pass', () => {
    // Removing the mapping must not remove the vocabulary — a genuine pass
    // still needs somewhere to be recorded.
    expect(MICRO_STAGES as readonly string[]).toContain('inspection_passed');
  });

  it('the entries that DID survive all record something that has happened', () => {
    // Entering installation means the install started; entering pto means PTO
    // was submitted. Those are entry-true. Kept explicitly so a future edit has
    // to think about which kind it is adding.
    const b = mapBody();
    expect(b).toMatch(/installation:\s*'install_started'/);
    expect(b).toMatch(/pto:\s*'pto_submitted'/);
    expect(b).toMatch(/permit_submitted:\s*'permit_submitted'/);
  });

  it('🚨 no surviving entry asserts a PASS, APPROVAL or COMPLETION it cannot know', () => {
    // The general form of the defect, so the next one is caught by SHAPE rather
    // than by name.
    //
    // The exemption is principled, not a list: a stage whose OWN NAME asserts
    // the outcome is entry-true, because you only enter it once the outcome has
    // happened. `permit_approved -> permit_approved` and
    // `design_complete -> layout_completed` both qualify — the second is why
    // this rule had to be stated properly rather than matched on equality,
    // since "design complete" and "layout completed" are the same fact in
    // different words. `inspection` asserts nothing, which is the whole point.
    const ASSERTS_OUTCOME = /(passed|approved|complete|completed)/;
    const b = mapBody();
    const suspicious = [...b.matchAll(/^\s*(\w+):\s*'([a-z_]+)'/gm)]
      .filter(([, stage, micro]) =>
        ASSERTS_OUTCOME.test(micro) && !ASSERTS_OUTCOME.test(stage));
    expect(suspicious.map(m => `${m[1]} -> ${m[2]}`),
      'a stage entry is claiming a pass, approval or completion that has not been observed')
      .toEqual([]);
  });
});

describe('the route this protects is still the dormant one', () => {
  it('it remains the governed path, with the micro-stage writer', () => {
    expect(ROUTE).toMatch(/writeMicroStage\(projectId, mappedMicro/);
  });

  it('and it still writes nothing when a stage has no mapping', () => {
    // The whole repair depends on an unmapped stage being a no-op rather than
    // falling through to some default.
    expect(ROUTE).toMatch(/const mappedMicro = PIPELINE_STAGE_TO_MICRO\[newStage\];/);
    expect(ROUTE).toMatch(/if \(mappedMicro\) \{/);
  });
});
