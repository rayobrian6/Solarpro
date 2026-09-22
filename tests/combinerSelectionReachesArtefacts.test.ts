/**
 * tests/combinerSelectionReachesArtefacts.test.ts
 *
 * "WHAT COMBINER ARE WE INSTALLING?" — ONE PERSISTED ANSWER, AND EVERY
 * CONSUMER READS IT.
 *
 * The live report was that the propagation claim did not match the test. An
 * audit found why, and it was not the propagation code:
 *
 *   [CRITICAL] `projectCombinerId` on the engineering page had exactly ONE
 *   writer — `CombinerSelector`, mounted `visible={!!computedSystem?.isMicro}`.
 *   On a hybrid whose roof is string/optimizer the aggregate is not micro, so
 *   the selector never rendered, never fetched, and the state stayed null
 *   FOREVER. The installer's decision sat in
 *   `projects.selected_equipment.combinerSelection` and reached no artefact at
 *   all: not the SLD payload, not the BOM, not the permit. The read-only badge
 *   on the Diagram tab said "not selected" about a project that had one.
 *
 *   [HIGH] `combinerSelectionIsDecided` was computed by the adapter and read by
 *   NOTHING, so every sheet printed an unresolved DEFAULT with exactly the same
 *   confidence as a recorded selection. Three of the four sheet builders never
 *   even carried the field.
 *
 * These are source guards, and they are the right shape for this defect: what
 * was wrong was that a value existed and NOTHING ASKED FOR IT. A behavioural
 * test of the functions would have passed throughout.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { combinerBasisIsDecided } from '@/lib/combinerSelection/service';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/** Strip comments so a guard cannot be satisfied by prose describing itself. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const PAGE = strip(read('app/engineering/page.tsx'));
const SLD_ROUTE = strip(read('app/api/engineering/sld/route.ts'));
const PDF_ROUTE = strip(read('app/api/engineering/sld/pdf/route.ts'));
const PLANSET = strip(read('lib/permit/utils/sldAdapter.ts'));
const RENDERER = strip(read('lib/sld-professional-renderer.ts'));

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the persisted selection is loaded, whatever tab is mounted', () => {
  it('the page reads it from the project, keyed on the project', () => {
    expect(PAGE).toMatch(/fetch\(`\/api\/projects\/\$\{pid\}\/combiner-selection`\)/);
    expect(PAGE).toMatch(/body\?\.selected\?\.combinerDeviceId/);
    expect(PAGE).toMatch(/setProjectCombinerId\(id\)/);
  });

  it('…and it does NOT depend on the selector being visible', () => {
    // The effect must not be gated on the topology. The selector's own
    // `visible={!!computedSystem?.isMicro}` is what made the selection
    // unreachable on a hybrid, and re-introducing that condition here would
    // restore the defect exactly.
    const i = PAGE.indexOf('/combiner-selection`');
    expect(i, 'the project read is gone').toBeGreaterThan(-1);
    const block = PAGE.slice(Math.max(0, i - 900), i + 900);
    expect(block).not.toMatch(/isMicro/);
    expect(block).not.toMatch(/computedSystem\?\./);
  });

  it('🚨 a late answer for the PREVIOUS project is dropped', () => {
    // The fetch resolves after a project switch as readily as before one, and
    // applying it would put one project's equipment decision on another's
    // permit — which is the same class of defect as the stale-id reset that
    // sits immediately above it.
    const i = PAGE.indexOf('/combiner-selection`');
    const block = PAGE.slice(i, i + 900);
    expect(block).toMatch(/let cancelled = false|cancelled = true/);
    expect(block).toMatch(/if \(!cancelled/);
  });

  it('the selection still resets to null on a project change', () => {
    // Preserved from the previous round: a selection belongs to one project.
    expect(PAGE).toMatch(/setProjectCombinerId\(null\);/);
    expect(PAGE).toMatch(/\}, \[currentProjectId\]\);/);
  });
});

describe('🚨 every sheet builder carries whether the name is a DECISION', () => {
  it('the exported SLD PDF', () => {
    expect(PDF_ROUTE).toMatch(/combinerSelectionIsDecided: _combiner\.combinerSelectionIsDecided/);
  });

  it('the live SLD route, which resolves its own plan', () => {
    expect(SLD_ROUTE).toMatch(/combinerSelectionIsDecided: combinerBasisIsDecided\(/);
    expect(SLD_ROUTE).toMatch(/from '@\/lib\/combinerSelection\/service'/);
  });

  it('the PLANSET E-1 builder', () => {
    expect(PLANSET).toMatch(/combinerSelectionIsDecided: combinerBasisIsDecided\(/);
  });

  it('and the renderer actually consumes it', () => {
    expect(RENDERER).toMatch(/combinerSelectionIsDecided/);
    expect(RENDERER).toMatch(/NOT SELECTED/);
  });

  it('🚨 the fallback is the UNRESOLVED basis, not a cheerful default', () => {
    // `?? 'unresolved-default'` is the honest reading of a plan with no basis:
    // nobody decided. `?? 'installer-selected'` would be the defect this whole
    // field exists to prevent, so the vocabulary is asserted rather than trusted.
    expect(combinerBasisIsDecided('unresolved-default')).toBe(false);
    for (const src of [SLD_ROUTE, PLANSET]) {
      expect(src).toMatch(/combinerBasisIsDecided\([^)]*\?\? 'unresolved-default'\)/);
    }
  });
});

describe('🚨 a lane never claims a combiner from another brand', () => {
  it('the renderer resolves the selection per lane', () => {
    expect(RENDERER).toMatch(/laneSelectedCombinerId/);
    expect(RENDERER).toMatch(/selectedCombinerIdByLane/);
  });

  it('🚨 and nothing yet WRITES a per-lane selection, which is recorded here', () => {
    // `selected_equipment.subSystems[key]` carries panelId / inverterId /
    // topology / batteryId and NO combiner — checked against the only writer,
    // app/api/projects/[id]/equipment/route.ts. So `selectedCombinerIdByLane`
    // has no source today and the brand check is what protects a hybrid: a lane
    // whose inverter brand differs from the selected combiner's falls to its
    // own declared pairing rather than claiming a box that is not on that wall.
    //
    // 🚨 THIS TEST EXISTS SO THE FIELD DOES NOT BECOME THE NEXT
    // `combinerSelectionIsDecided` — declared, wired through a type, and read
    // by nothing while everyone assumes it is doing something. If a writer is
    // added, this assertion fails and whoever adds it must say so here.
    const equipRoute = strip(read('app/api/projects/[id]/equipment/route.ts'));
    expect(equipRoute).not.toMatch(/combinerDeviceId|combinerId/);
  });
});
