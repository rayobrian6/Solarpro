/**
 * tests/batteryBackfeedModels.test.ts
 *
 * FIVE RULES FOR "HOW MUCH DOES THE BATTERY ADD" — AND NOW THERE IS ONE.
 *
 * 🚨 THIS FILE WAS REWRITTEN, NOT PATCHED, exactly as its previous version
 * instructed: "WHEN THE SINGLE AUTHORITY LANDS, THIS FILE MUST BE REWRITTEN."
 *
 * It used to be a CHARACTERISATION test. It pinned a live defect — five call
 * sites each deciding a battery's electrical characteristics differently, and
 * disagreeing for the same fleet — so the disagreement could not widen
 * silently. A green run meant "the models still disagree in the documented
 * way", which was NOT a passing compliance check.
 *
 * It is now a CONVERGENCE test. The authority is `resolveBatteryBranch` in
 * lib/equipment-db.ts (see tests/batteryElectricalAuthority.test.ts for its
 * specification). What this file guards is that the fabrications DO NOT COME
 * BACK: the literals, the unconditional multiplications, the `Math.max`
 * reconciliation and the project mutation are each asserted ABSENT, at the
 * exact sites that carried them.
 *
 * The five, as they were, for one fleet of 3 × Enphase IQ Battery 5P:
 *
 *   1. app/engineering/page.tsx    requiresGateway ? flat : × count    -> 20 A
 *   2. lib/engineering-helpers.ts  an unused duplicate of model 1      -> 20 A
 *   3. lib/computed-system.ts      Σ per id, no gateway awareness      -> 60 A
 *   4. lib/permit/generatePermit   20 × count, hard-coded, MUTATING    -> 60 A
 *   5. …/sldAdapter.ts             20 × count, hard-coded              -> 60 A
 *   —  lib/sld-professional-renderer.ts   a flat `?? 20` in the drawing
 *
 * Source of the defect record: docs/BATTERY-ELECTRICAL-AUTHORITY.md §3b.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBatteryBranch, getBatteryById } from '@/lib/equipment-db';
import { stripComments } from './support/stripSource';

const FIVE_P = 'enphase-iq-battery-5p';
const TEN_C = 'enphase-iq-battery-10c';

function read(rel: string): string {
  return stripComments(readFileSync(join(__dirname, '..', rel), 'utf8'));
}

describe('the catalogue rows these models read', () => {
  it('the 5P still exists and still carries a single scalar breaker', () => {
    const b: any = getBatteryById(FIVE_P);
    expect(b, 'the fixture battery is gone — this file is testing nothing').toBeTruthy();
    expect(b.subcategory).toBe('ac_coupled');
    expect(typeof b.backfeedBreakerA).toBe('number');
    // 🚨 STILL A DEFECT, just no longer an invisible one. A scalar cannot
    // express a branch rule; the 5P simply has no transcribed architecture
    // yet, and the authority reports that as `catalogue-scalar` rather than
    // pretending it is manufacturer-verified.
    expect(b.branchArchitecture).toBeUndefined();
    expect(resolveBatteryBranch(FIVE_P, 3).basis).toBe('catalogue-scalar');
  });

  it('🚨 the IQ Battery 10C is PRESENT — the absence that caused the fabrications is closed', () => {
    // The previous version of this file asserted this row was MISSING, and
    // said: "retire this expectation and encode the architecture rules".
    // Both have now happened.
    const b = getBatteryById(TEN_C);
    expect(b, 'the 10C row was removed — the downstream fabrications have nothing to read').toBeTruthy();
    expect(b!.branchArchitecture, 'the 10C must carry its documented step function').toBeTruthy();
  });
});

describe('ONE aggregation model, and it is the authority', () => {
  it('3 × 5P resolves once, to one number, from one place', () => {
    const r = resolveBatteryBranch(FIVE_P, 3);
    expect(r.resolved).toBe(true);

    // 🚨 THIS TEST ASSERTED 60 A, AND ITS JUSTIFICATION WAS FACTUALLY WRONG.
    //
    // It said "deliberately identical to what the calculation engine already
    // produced by summing per unit — adopting the authority moved no existing
    // design's 705.12(B) result". The shim every legacy caller used was
    // `calcBatteryBackfeedAmps`, and it read:
    //
    //     if (b.requiresGateway) return b.backfeedBreakerA;
    //
    // The 5P carries `requiresGateway: true, gatewayModel: 'Enphase IQ System
    // Controller 3'`, so that path returned 20 A for ANY count. Adopting 60
    // moved the result for 5 of 6 catalogue batteries at counts >= 2, and an
    // adversarial audit measured a 2-unit Powerwall 3 job on a 200 A busbar
    // behind a 150 A main flipping from PASS to FAIL with nothing about the
    // design having changed.
    //
    // 20 A is also the physically defensible stand-in. Three 5P units sit
    // behind ONE System Controller, which is the point of connection to the
    // dwelling's busbar; what that controller backfeeds through is a FEEDER
    // OCPD this catalogue does not carry. So the single branch OCPD stands in
    // and `busbarBasis` says the feeder layer is unverified — exactly what the
    // documented-architecture path above already does with
    // 'branch-ocpd-pending-feeder-data'. Summing three branch breakers models
    // a topology the manufacturer does not publish.
    expect(r.busbarContributionA).toBe(20);
    expect(r.busbarBasis).toBe('catalogue-scalar-shared-gateway');
    expect(r.source).toMatch(/ONE point of connection/);
  });

  it('🚨 and for a step-function product the fleet answer is NOT perUnit × count', () => {
    // This is the case every one of the five old models got wrong: three 10C
    // units daisy-chain onto ONE 80 A branch. The old `Σ per id` reduce in
    // computed-system would have said 120 A; the old `20 × count` in the
    // permit and the SLD adapter would have said 60 A; the old page.tsx model
    // would have said 0 A, because the 10C carries no scalar to read.
    const three = resolveBatteryBranch(TEN_C, 3);
    expect(three.busbarContributionA).toBe(80);
    expect(three.busbarContributionA).not.toBe(120);
    expect(three.busbarContributionA).not.toBe(60);
    expect(three.busbarContributionA).not.toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// THE FABRICATIONS, ASSERTED ABSENT AT THEIR OWN SITES
//
// Source-level assertions, because these are the shapes that regress: someone
// adds a "sensible default" back to a call site to make a screen render. Each
// test names the literal that must not return.
// ════════════════════════════════════════════════════════════════════════════

describe('models 1 and 2 — the page and its duplicate now delegate', () => {
  it('app/engineering/page.tsx no longer decides; it calls the authority', () => {
    const src = read('app/engineering/page.tsx');
    const fn = src.slice(src.indexOf('function calcBatteryBackfeedAmps('));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/resolveBatteryBranch\(/);
    // The old model, gone: no gateway fork, no scalar multiplication.
    expect(body).not.toMatch(/requiresGateway/);
    expect(body).not.toMatch(/backfeedBreakerA/);
  });

  it('lib/engineering-helpers.ts — the duplicate delegates too', () => {
    const src = read('lib/engineering-helpers.ts');
    const fn = src.slice(src.indexOf('export function calcBatteryBackfeedAmps('));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/resolveBatteryBranch\(/);
    expect(body).not.toMatch(/requiresGateway/);
  });
});

describe('model 3 — computed-system reconciles nothing, because there is one model', () => {
  it('🚨 the Math.max of two disagreeing models is GONE', () => {
    const src = read('lib/computed-system.ts');
    expect(src).not.toMatch(/Math\.max\(\s*batteryBusImpactFromIds,\s*input\.batteryBackfeedA \?\? 0,?\s*\)/);
  });

  it('it groups units by product and asks the authority for the fleet', () => {
    const src = read('lib/computed-system.ts');
    expect(src).toMatch(/resolveBatteryBranch\(id, count\)/);
    // The per-unit reduce that overstated any shared-branch product is gone.
    expect(src).not.toMatch(/sum \+ computeBatteryBusImpact\(id\)/);
  });
});

describe('model 4 — the permit fabricates nothing and mutates nothing derived', () => {
  it('🚨 the hard-coded 20 A per unit is GONE', () => {
    const src = read('lib/permit/generatePermit.ts');
    expect(src).not.toMatch(/const backfeedPerUnit = 20;/);
    expect(src).not.toMatch(/project\.batteryBackfeedA = backfeedPerUnit \* project\.batteryCount;/);
  });

  it('🚨 the invented 5.0 kWh per unit is GONE', () => {
    const src = read('lib/permit/generatePermit.ts');
    expect(src).not.toMatch(/project\.batteryKwh = 5\.0;/);
  });

  it('both figures now come from the authority', () => {
    const src = read('lib/permit/generatePermit.ts');
    expect(src).toMatch(/resolveBatteryBranch\(/);
    expect(src).toMatch(/aggregateUsableKwh/);
    expect(src).toMatch(/busbarContributionA/);
  });
});

describe('model 5 — the SLD adapter prints the authority, it does not choose', () => {
  it('🚨 the unconditional 20 A per unit is GONE', () => {
    const src = read('lib/permit/utils/sldAdapter.ts');
    expect(src).not.toMatch(/\(project\.batteryCount \?\? 1\) \* 20/);
  });

  it('🚨 the 5.0 kWh per-unit fallback is GONE', () => {
    const src = read('lib/permit/utils/sldAdapter.ts');
    expect(src).not.toMatch(/project\.batteryKwh \?\? 5\.0/);
  });

  it('it resolves the battery once, through the authority', () => {
    const src = read('lib/permit/utils/sldAdapter.ts');
    expect(src).toMatch(/resolveBatteryBranch\(/);
  });
});

describe('the renderer no longer invents a breaker it cannot know', () => {
  it('🚨 the flat `?? 20` fallback is GONE', () => {
    const src = read('lib/sld-professional-renderer.ts');
    expect(src).not.toMatch(/input\.batteryBackfeedA \?\? 20/);
  });

  it('an absent value is DRAWN as unresolved rather than filled in', () => {
    const src = read('lib/sld-professional-renderer.ts');
    expect(src).toMatch(/SIZE UNRESOLVED/);
  });
});

describe('the fabrications that turned an unknown into a number', () => {
  it('🚨 the 120% busbar check no longer substitutes 0 for a PRESENT battery', () => {
    // 0 is the permissive direction — a smaller backfeed makes NEC 705.12(B)
    // easier to pass. With no battery on the job 0 is still correct and still
    // used; with a battery present and unresolved, the conclusion is blocked.
    const src = read('lib/electrical-calc.ts');
    expect(src).toMatch(/batteryBackfeedUnresolved/);
    expect(src).toMatch(/E-BATTERY-BACKFEED-UNRESOLVED/);
  });

  it('🚨 an unresolved battery cannot be reported as a 705.12(B) pass', () => {
    const src = read('lib/electrical-calc.ts');
    const guard = src.slice(src.indexOf('if (batteryBackfeedUnresolved'));
    expect(guard.slice(0, guard.indexOf('\n  }'))).toMatch(/interconnectionPasses = false/);
  });
});
