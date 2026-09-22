/**
 * tests/batteryElectricalAuthority.test.ts
 *
 * THE BATTERY ELECTRICAL AUTHORITY — specification, not characterisation.
 *
 * This file replaces the four-disagreeing-models characterisation in
 * tests/batteryBackfeedModels.test.ts. Where that file pinned a defect, this
 * one pins the intended behaviour of `resolveBatteryBranch` in
 * lib/equipment-db.ts, which is now the ONLY thing in the repository that
 * decides a battery's electrical characteristics.
 *
 * The centrepiece is the IQ Battery 10C OCPD STEP FUNCTION. It is a step
 * function, not arithmetic, so the tests below distinguish 1 / 2 / 3+ units
 * explicitly and assert what must NOT happen between the steps:
 *
 *   1 unit   -> 40 A, #8 AWG, no PCS
 *   2 units  -> 80 A, #4 AWG, no PCS
 *   3+ units -> 80 A, #4 AWG, PCS: IQ Battery Oversubscription
 *
 * Source: Enphase DSH-00565-9.0-EN-2026-02-26 and its footnote 8; see
 * docs/BATTERY-ELECTRICAL-AUTHORITY.md §4.3.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBatteryBranch,
  findBatteryByExactModel,
  computeBatteryBusImpact,
  getBatteryById,
  BATTERIES,
} from '@/lib/equipment-db';
import { runElectricalCalc, type ElectricalCalcInput } from '@/lib/electrical-calc';
import { ecStringInput } from './goldens/wave0-fixtures';

const TEN_C = 'enphase-iq-battery-10c';
const FIVE_P = 'enphase-iq-battery-5p';

describe('the IQ Battery 10C catalogue row — the absence that caused the defect', () => {
  it('exists, and is identified by the MODEL NUMBER Enphase requires for permitting', () => {
    const b = getBatteryById(TEN_C);
    expect(b, 'the 10C row is gone — the fabrications downstream have nothing to read').toBeTruthy();
    expect(b!.manufacturer).toBe('Enphase');
    expect(b!.model).toBe('IQ Battery 10C');
    // Datasheet footnote 2: "For all interconnection applications and
    // permitting processes, ensure that the model number is used, not the
    // ordering SKU."
    expect(b!.permitModelNumber).toBe('IQBATTERY-10C-1P-NA');
  });

  it('🚨 does NOT carry an ordering SKU where the model number belongs', () => {
    // B10CNC0708O is the COVER KIT's ordering SKU — one of two orderable parts
    // (the 10C ships as two 5 kWh units plus a cover kit). An earlier audit
    // note had the model number and the SKU the wrong way round, which would
    // have printed the cover kit's part number on a permit.
    const b = getBatteryById(TEN_C)!;
    expect(b.permitModelNumber).not.toBe('B10CNC0708O');
    expect(b.permitModelNumber).not.toMatch(/^B05-/);
  });

  it('carries the verified ratings, and does NOT derive one from another', () => {
    const b = getBatteryById(TEN_C)!;
    expect(b.continuousPowerKw).toBe(7.08);      // max continuous discharge, kW
    expect(b.ratedOutputCurrentA).toBe(29.5);    // at 240 V L-L, balanced
    expect(b.maxContinuousOutputA).toBe(29.5);
    expect(b.ratedNeutralCurrentA).toBe(24);     // at 120 V L-N
    // Total == usable == 10.0 kWh deliberately: the 2% safety and 3% sustenance
    // reserves are already inside the figure. No DoD derate on top.
    expect(b.usableCapacityKwh).toBe(10.0);
    // Nominal DC voltage, not the 48 V the other Enphase rows carry.
    expect(b.voltageNominalV).toBe(76.8);
    // "60% capacity, up to 15 years, or 6,000 cycles, whichever occurs first."
    expect(b.warrantyYears).toBe(15);
    expect(b.capacityRetentionPct).toBe(60);
    // AC round-trip 90%; the 96% figure on the datasheet is DC round-trip.
    expect(b.roundTripEfficiencyPct).toBe(90.0);
  });

  it('its datasheet URL is the one that actually serves the document', () => {
    const b = getBatteryById(TEN_C)!;
    expect(b.datasheetUrl).toBe('https://enphase.com/download/iq-battery-10c-data-sheet');
  });

  it('🚨 never advertises an unpublished peak POWER', () => {
    const b = getBatteryById(TEN_C)!;
    // Enphase publishes peak CURRENTS, not a peak power. The "14.16 kVA peak"
    // on reseller pages is not a manufacturer statement and must never reach a
    // planset. peakPowerKw is a required field, so it carries the rated
    // continuous value — the only direction that cannot overstate the product.
    expect(b.peakPowerKw).toBe(b.continuousPowerKw);
    expect(b.peakPowerKw).not.toBe(14.16);
    expect(b.peakOutputCurrentA).toEqual([
      { amps: 56, durationSec: 3 },
      { amps: 44.8, durationSec: 10 },
    ]);
  });

  it('🚨 carries NO scalar backfeedBreakerA, because no scalar is correct', () => {
    const b = getBatteryById(TEN_C)!;
    // A single number cannot be both 40 A and 80 A. Leaving it undefined forces
    // every consumer through the authority instead of letting one silently pick
    // a step of a two-step function.
    expect(b.backfeedBreakerA).toBeUndefined();
    expect(b.branchArchitecture).toBeTruthy();
  });

  it('records compatibility as the datasheet states it, and asserts no exclusive requirement', () => {
    const b = getBatteryById(TEN_C)!;
    // "Compatible with IQ and M Series Microinverters, IQ Meter Collar, IQ
    // Combiner 6C, and IQ Gateway for grid-tied and backup operations."
    expect(b.compatibleWith).toContain('enphase-iq-combiner-6c');
    expect(b.compatibleWith).toContain('enphase-iq-gateway');
    // 🚨 Compatibility is NOT a requirement. An earlier audit note claimed the
    // 10C "works ONLY with the IQ Combiner 6C" and "does not work with IQ
    // Gateway" — the datasheet's own Compatibility row contradicts both.
    expect(b.branchArchitecture!.requiresDeviceId).toBeNull();
    // This is the 5P/10T pairing, not the 10C's.
    expect(b.compatibleWith).not.toContain('enphase-iq-system-controller-3');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// THE STEP FUNCTION
// ════════════════════════════════════════════════════════════════════════════

describe('IQ Battery 10C OCPD — the step function, step by step', () => {
  it('ONE unit -> 40 A on #8 AWG, no PCS', () => {
    const r = resolveBatteryBranch(TEN_C, 1);
    expect(r.resolved).toBe(true);
    expect(r.basis).toBe('documented-architecture');
    expect(r.branchOcpdA).toBe(40);
    expect(r.minConductorAwg).toBe('#8 AWG');
    expect(r.pcsRequired).toBe(false);
    expect(r.pcsMode).toBeNull();
  });

  it('TWO units -> 80 A on #4 AWG, still no PCS', () => {
    const r = resolveBatteryBranch(TEN_C, 2);
    expect(r.resolved).toBe(true);
    expect(r.branchOcpdA).toBe(80);
    expect(r.minConductorAwg).toBe('#4 AWG');
    expect(r.pcsRequired).toBe(false);
  });

  it('THREE units -> 80 A, and PCS: IQ Battery Oversubscription becomes REQUIRED', () => {
    const r = resolveBatteryBranch(TEN_C, 3);
    expect(r.resolved).toBe(true);
    expect(r.branchOcpdA).toBe(80);
    expect(r.minConductorAwg).toBe('#4 AWG');
    expect(r.pcsRequired).toBe(true);
    expect(r.pcsMode).toBe('IQ Battery Oversubscription');
    // The planset owes a label at every PCS-enabled unit.
    expect(r.pcsLabelRequirement).toMatch(/PCS disclaimer label/i);
  });

  it('🚨 the OCPD does NOT keep growing with unit count — 3, 4, 5, 8 are all 80 A', () => {
    // Oversubscription increases the storage allowed behind a GIVEN breaker by
    // reducing each unit's continuous current. The breaker stays 80 A. A
    // per-unit × count model would have said 120/160/200/320 A here.
    for (const n of [3, 4, 5, 8]) {
      const r = resolveBatteryBranch(TEN_C, n);
      expect(r.resolved, `${n} units should resolve`).toBe(true);
      expect(r.branchOcpdA, `${n} units must stay at 80 A`).toBe(80);
      expect(r.pcsRequired, `${n} units require PCS`).toBe(true);
    }
  });

  it('🚨 the step between 1 and 2 units is a JUMP, not interpolation', () => {
    const one = resolveBatteryBranch(TEN_C, 1);
    const two = resolveBatteryBranch(TEN_C, 2);
    expect(one.branchOcpdA).toBe(40);
    expect(two.branchOcpdA).toBe(80);
    // Not 40 × 2 by coincidence of this product's numbers — prove the model is
    // a lookup by showing the NEXT step does not double again.
    expect(resolveBatteryBranch(TEN_C, 4).branchOcpdA).toBe(80);
    expect(resolveBatteryBranch(TEN_C, 4).branchOcpdA).not.toBe(160);
  });

  it('🚨 REFUSES past the documented maximum instead of extrapolating', () => {
    // A 9th unit has no published rule. The answer is UNRESOLVED, never
    // 80 × ceil(9/4).
    const r = resolveBatteryBranch(TEN_C, 9);
    expect(r.resolved).toBe(false);
    expect(r.refusal!.code).toBe('EXCEEDS_DOCUMENTED_MAXIMUM');
    expect(r.branchOcpdA).toBeNull();
    expect(r.busbarContributionA).toBeNull();
    expect(r.refusal!.message).toMatch(/8/);
  });

  it('aggregate usable energy tracks the fleet, with no depth-of-discharge derate', () => {
    expect(resolveBatteryBranch(TEN_C, 1).aggregateUsableKwh).toBe(10.0);
    expect(resolveBatteryBranch(TEN_C, 3).aggregateUsableKwh).toBe(30.0);
    // 8 units is the documented system maximum: 80 kWh.
    expect(resolveBatteryBranch(TEN_C, 8).aggregateUsableKwh).toBe(80.0);
  });

  it('the busbar contribution says it is a stand-in, not a verified feeder figure', () => {
    const r = resolveBatteryBranch(TEN_C, 2);
    expect(r.busbarContributionA).toBe(80);
    // The branch OCPD is a BRANCH quantity; whether it lands on the dwelling's
    // busbar or on a combiner's DER bus is a property of the design, and
    // Enphase publishes no battery-count -> main-panel-backfeed table either
    // way. The basis SAYS SO rather than asserting a feeder size.
    expect(r.busbarBasis).toBe('branch-ocpd-pending-feeder-data');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REFUSALS — unknown must never become a number
// ════════════════════════════════════════════════════════════════════════════

describe('unknown never becomes a number', () => {
  it('an unknown battery id refuses rather than returning 0', () => {
    const r = resolveBatteryBranch('no-such-battery', 2);
    expect(r.resolved).toBe(false);
    expect(r.refusal!.code).toBe('UNKNOWN_BATTERY');
    expect(r.busbarContributionA).toBeNull();
    expect(r.branchOcpdA).toBeNull();
  });

  it('a missing id refuses rather than returning 0', () => {
    for (const id of [undefined, null, '']) {
      const r = resolveBatteryBranch(id as string | undefined, 1);
      expect(r.resolved).toBe(false);
      expect(r.refusal!.code).toBe('UNKNOWN_BATTERY');
    }
  });

  it('a nonsense unit count refuses — the OCPD is a function OF the count', () => {
    for (const n of [0, -1, 1.5, NaN]) {
      const r = resolveBatteryBranch(TEN_C, n);
      expect(r.resolved, `count ${n} must refuse`).toBe(false);
      expect(r.refusal!.code).toBe('UNIT_COUNT_INVALID');
    }
  });

  it('🚨 every refusal returns a null contribution, never a permissive 0', () => {
    // 0 is the dangerous default: it makes NEC 705.12(B) EASIER to pass.
    const refusals = [
      resolveBatteryBranch('no-such-battery', 1),
      resolveBatteryBranch(TEN_C, 99),
      resolveBatteryBranch(TEN_C, 0),
    ];
    for (const r of refusals) {
      expect(r.busbarContributionA).toBeNull();
      expect(r.busbarContributionA).not.toBe(0);
      expect(r.basis).toBe('unresolved');
      expect(r.refusal).toBeTruthy();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PRODUCTS WITHOUT A TRANSCRIBED ARCHITECTURE
// ════════════════════════════════════════════════════════════════════════════

describe('scalar products still answer, and say that they are not architecture-verified', () => {
  it('the 5P resolves from the catalogue scalar, conservatively aggregated', () => {
    const r = resolveBatteryBranch(FIVE_P, 3);
    expect(r.resolved).toBe(true);
    expect(r.basis).toBe('catalogue-scalar');
    expect(r.busbarBasis).toBe('catalogue-scalar-sum');
    // 20 A scalar × 3 units. Deliberately the SAME number the calculation
    // engine already produced by summing per unit, so adopting the authority
    // does not move any existing design's 705.12(B) result.
    expect(r.busbarContributionA).toBe(60);
    expect(r.branchOcpdA).toBe(20);
    // No manufacturer conductor or PCS rule has been transcribed for it.
    expect(r.minConductorAwg).toBeNull();
    expect(r.pcsRequired).toBe(false);
  });

  it('🚨 a scalar basis is never reported as documented architecture', () => {
    for (const b of BATTERIES) {
      const r = resolveBatteryBranch(b.id, 1);
      if (!r.resolved) continue;
      if (r.basis === 'documented-architecture') {
        expect(getBatteryById(b.id)!.branchArchitecture,
          `${b.id} claims documented architecture without carrying one`).toBeTruthy();
      }
    }
  });

  it('a DC-coupled battery contributes nothing — the inverter backfeed counts it', () => {
    const dc = BATTERIES.find(b => b.subcategory === 'dc_coupled');
    if (!dc) return;
    const r = resolveBatteryBranch(dc.id, 2);
    expect(r.resolved).toBe(true);
    expect(r.busbarContributionA).toBe(0);
    expect(r.busbarBasis).toBe('dc-coupled-none');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IDENTITY
// ════════════════════════════════════════════════════════════════════════════

describe('battery identity is exact, never a substring', () => {
  it('finds the 10C from manufacturer + model text', () => {
    const b = findBatteryByExactModel('Enphase', 'IQ Battery 10C');
    expect(b?.id).toBe(TEN_C);
  });

  it('tolerates case, spacing and punctuation only', () => {
    expect(findBatteryByExactModel('  enphase ', 'iq-battery 10c')?.id).toBe(TEN_C);
  });

  it('🚨 "IQ Battery 10" does NOT match the 10C or the 10T', () => {
    // A substring matcher picks a 20 A breaker for a 29.5 A device. This is the
    // exact failure the module-identity work closed on panels; batteries carry
    // the same rule.
    expect(findBatteryByExactModel('Enphase', 'IQ Battery 10')).toBeUndefined();
    expect(findBatteryByExactModel('Enphase', 'IQ Battery')).toBeUndefined();
    expect(findBatteryByExactModel('Enphase', '10C')).toBeUndefined();
  });

  it('refuses on a missing manufacturer or model', () => {
    expect(findBatteryByExactModel(undefined, 'IQ Battery 10C')).toBeUndefined();
    expect(findBatteryByExactModel('Enphase', undefined)).toBeUndefined();
    expect(findBatteryByExactModel('', '')).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// THE CONSUMER THAT MATTERS MOST: the NEC 705.12(B) 120% check
//
// Run against the real engine, not asserted from source — a source grep proves
// the guard was typed, not that it fires.
// ════════════════════════════════════════════════════════════════════════════

describe('NEC 705.12(B) blocks on an unresolved battery instead of assuming 0 A', () => {
  /** The repo's own Wave-0 string fixture, so this exercises the real engine. */
  function baseInput(over: Partial<ElectricalCalcInput> = {}): ElectricalCalcInput {
    return { ...ecStringInput(), ...over };
  }

  it('NO battery: 0 A is correct and the check still passes', () => {
    const res = runElectricalCalc(baseInput());
    expect(res.interconnection.passes).toBe(true);
    expect(res.errors.some(e => e.code === 'E-BATTERY-BACKFEED-UNRESOLVED')).toBe(false);
  });

  it('battery present WITH a resolved backfeed: passes, and the backfeed counts', () => {
    const res = runElectricalCalc(baseInput({ batteryCount: 2, batteryBackfeedA: 80 }));
    expect(res.errors.some(e => e.code === 'E-BATTERY-BACKFEED-UNRESOLVED')).toBe(false);
    // 80 A of battery backfeed is actually in the busbar total.
    expect(res.interconnection.solarBreakerRequired).toBeGreaterThanOrEqual(80);
  });

  it('🚨 battery present with NO backfeed: BLOCKED, not silently passed on 0 A', () => {
    const res = runElectricalCalc(baseInput({ batteryCount: 2 }));
    const blocked = res.errors.find(e => e.code === 'E-BATTERY-BACKFEED-UNRESOLVED');
    expect(blocked, 'an unresolved battery must block the 705.12(B) conclusion').toBeTruthy();
    expect(blocked!.severity).toBe('error');
    expect(res.interconnection.passes).toBe(false);
  });

  it('a supply-side tap is exempt — NEC 705.11, the 120% rule does not apply', () => {
    const res = runElectricalCalc(baseInput({
      batteryCount: 2,
      interconnection: { method: 'SUPPLY_SIDE_TAP', busRating: 200, mainBreaker: 200 },
    }));
    expect(res.errors.some(e => e.code === 'E-BATTERY-BACKFEED-UNRESOLVED')).toBe(false);
    expect(res.interconnection.passes).toBe(true);
  });
});

describe('computeBatteryBusImpact — the legacy entry point now delegates', () => {
  it('still answers per unit for scalar products', () => {
    expect(computeBatteryBusImpact(FIVE_P)).toBe(20);
  });

  it('🚨 returns the ONE-UNIT step for the 10C, which is why callers must not sum it', () => {
    // 40 A is the correct answer for one unit. Three units share an 80 A
    // branch, so a caller summing this per unit would say 120 A. Callers use
    // resolveBatteryBranch(id, count) instead — computed-system now does.
    expect(computeBatteryBusImpact(TEN_C)).toBe(40);
    expect(resolveBatteryBranch(TEN_C, 3).busbarContributionA).toBe(80);
    expect(computeBatteryBusImpact(TEN_C) * 3).not.toBe(
      resolveBatteryBranch(TEN_C, 3).busbarContributionA);
  });

  it('an unknown id still yields 0 in the legacy shape — the reason it is legacy', () => {
    // This signature cannot express "unresolved". It is kept only for callers
    // that have not migrated; new code calls the authority directly.
    expect(computeBatteryBusImpact('no-such-battery')).toBe(0);
  });
});
