/**
 * tests/batteryBackfeedModels.test.ts
 *
 * FOUR RULES FOR "HOW MUCH DOES THE BATTERY ADD", AND THEY DISAGREE.
 *
 * This is a CHARACTERISATION test, not a specification. The numbers pinned below
 * are a record of a known defect (docs/BATTERY-ELECTRICAL-AUTHORITY.md §3b), so
 * that:
 *
 *   • the disagreement cannot widen silently, and
 *   • changing ONE of the four models without the others fails here immediately.
 *
 * 🚨 WHEN THE SINGLE AUTHORITY LANDS, THIS FILE MUST BE REWRITTEN, NOT PATCHED.
 * A green run of this file means "the four models still disagree in exactly the
 * documented way". It does NOT mean the battery contribution is correct. Do not
 * read it as a passing compliance check.
 *
 * The four, for one fleet of 3 × Enphase IQ Battery 5P:
 *
 *   1. app/engineering/page.tsx  calcBatteryBackfeedAmps
 *        requiresGateway ? backfeedBreakerA : backfeedBreakerA * count   ->  20 A
 *   2. lib/computed-system.ts    reduce over computeBatteryBusImpact
 *        sum per battery id, NO gateway awareness                        ->  60 A
 *   3. lib/permit/generatePermit.ts
 *        20 * batteryCount, unconditional, MUTATES project               ->  60 A
 *   4. …/sldAdapter.ts
 *        (batteryCount ?? 1) * 20, unconditional                         ->  60 A
 *
 * and computed-system reconciles 1 against 2 with `Math.max(...)`, which is not
 * an authority — it is "take whichever number isn't zero".
 *
 * The correct model is layered (individual battery → branch → combiner DER bus →
 * combiner feeder/backfeed → service), and the service calculation must consume
 * the COMBINER FEEDER, never an individual battery's current. Battery count
 * reaches the service only by changing branch architecture — a step function
 * through documented manufacturer rules, never `perUnit × count` and never a
 * constant either.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBatteryBusImpact, getBatteryById, BATTERIES } from '@/lib/equipment-db';
import { stripComments } from './support/stripSource';

const FIVE_P = 'enphase-iq-battery-5p';
const FLEET = [FIVE_P, FIVE_P, FIVE_P]; // three units — one real Enphase fleet

function read(rel: string): string {
  return stripComments(readFileSync(join(__dirname, '..', rel), 'utf8'));
}

describe('the catalogue row these models all read', () => {
  it('the 5P exists, is gateway-based, and carries a single scalar breaker', () => {
    const b: any = getBatteryById(FIVE_P);
    expect(b, 'the fixture battery is gone — this file is testing nothing').toBeTruthy();
    expect(b.requiresGateway).toBe(true);
    expect(b.subcategory).toBe('ac_coupled');
    // 🚨 ONE scalar cannot express the 40 A / 80 A branch rule. That it is a
    // single number is itself the shape of the defect, not an implementation
    // detail — see the architecture-rule table in the doc.
    expect(typeof b.backfeedBreakerA).toBe('number');
  });

  it('🚨 the IQ Battery 10C — a currently shipping SKU — is absent from the catalogue', () => {
    // This absence is why its figures were invented downstream. Recorded so the
    // gap is a failing expectation the day someone believes it was filled.
    const byId = getBatteryById('enphase-iq-battery-10c');
    expect(byId, 'a 10C row now exists — retire this expectation and encode the architecture rules').toBeFalsy();
  });
});

describe('model 2 — computeBatteryBusImpact, summed per id', () => {
  it('counts EVERY unit, with no gateway awareness', () => {
    const total = FLEET.reduce((sum, id) => sum + computeBatteryBusImpact(id), 0);
    const perUnit = (getBatteryById(FIVE_P) as any).backfeedBreakerA as number;
    expect(total).toBe(perUnit * FLEET.length);
    // The same fleet that model 1 calls a single shared breaker.
    expect(total).not.toBe(perUnit);
  });

  it('a DC-coupled battery correctly contributes nothing', () => {
    // Not a defect — the inverter backfeed already counts it. Pinned so the
    // rewrite does not lose a rule that is right.
    const dc: any = (BATTERIES as any[]).find(b => b.subcategory === 'dc_coupled');
    if (!dc) return; // no DC-coupled product catalogued; nothing to assert
    expect(computeBatteryBusImpact(dc.id)).toBe(0);
  });
});

describe('models 1, 3 and 4 — pinned structurally, because they are not exported', () => {
  it('model 1 is gateway-aware: a shared breaker, not per unit', () => {
    const src = read('app/engineering/page.tsx');
    const fn = src.slice(src.indexOf('function calcBatteryBackfeedAmps('));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/requiresGateway/);
    expect(body).toMatch(/return b\.backfeedBreakerA;/);          // gateway → flat
    expect(body).toMatch(/b\.backfeedBreakerA \* qty/);            // otherwise → × count
  });

  it('🚨 model 3 fabricates 20 A per unit and MUTATES the project', () => {
    const src = read('lib/permit/generatePermit.ts');
    // The literal, the multiplication and the write-back are each part of the
    // defect; asserting only the literal would pass a version that still wrote a
    // derived number into the shared project object.
    expect(src).toMatch(/const backfeedPerUnit = 20;/);
    expect(src).toMatch(/project\.batteryBackfeedA = backfeedPerUnit \* project\.batteryCount;/);
  });

  it('🚨 model 4 fabricates 20 A per unit in the SLD adapter', () => {
    const src = read('lib/permit/utils/sldAdapter.ts');
    expect(src).toMatch(/\(project\.batteryCount \?\? 1\) \* 20/);
  });

  it('🚨 the renderer falls back to a flat 20 A for a breaker it cannot know', () => {
    const src = read('lib/sld-professional-renderer.ts');
    expect(src).toMatch(/input\.batteryBackfeedA \?\? 20/);
  });
});

describe('the reconciliation between models 1 and 2 is Math.max, not an authority', () => {
  it('computed-system picks the larger of two disagreeing models', () => {
    const src = read('lib/computed-system.ts');
    expect(src).toMatch(/Math\.max\(\s*batteryBusImpactFromIds,\s*input\.batteryBackfeedA \?\? 0,?\s*\)/);
  });

  it('🚨 and the same field is ALSO rounded UP to an OCPD elsewhere in that file', () => {
    // nextStandardOCPD(x) only makes sense on a CURRENT. Summing the same field
    // into a busbar total only makes sense on a BREAKER RATING. One field cannot
    // be both, and this is the proof that it is being read as both.
    const src = read('lib/computed-system.ts');
    expect(src).toMatch(/nextStandardOCPD\(input\.batteryBackfeedA\)/);
    expect(src).toMatch(/input\.batteryContinuousOutputA \?\? input\.batteryBackfeedA/);
  });
});

describe('the fabrications that turn an unknown into a number', () => {
  it('🚨 the 120% busbar check still substitutes 0 for an unknown battery backfeed', () => {
    // The permissive direction: a smaller backfeed makes NEC 705.12(B) easier to
    // pass. Unknown must become UNRESOLVED, never 0.
    const src = read('lib/electrical-calc.ts');
    expect(src).toMatch(/const batteryBackfeedA = input\.batteryBackfeedA \?\? 0;/);
  });

  it('🚨 the permit still invents 5.0 kWh per unit for a battery it does not know', () => {
    const src = read('lib/permit/generatePermit.ts');
    expect(src).toMatch(/project\.batteryKwh = 5\.0;/);
  });
});
