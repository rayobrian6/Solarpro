// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THREE SELECTABLE GAUGES SILENTLY REPORTED A PERFECT VOLTAGE DROP
//
// `lib/equipment-db.ts` CONDUCTORS — the roster `getConductorSpec` and therefore
// `calcVoltageDrop` read — stopped at #2/0 AWG and SKIPPED #3 AWG entirely. And
// `calcVoltageDrop` answered **0** for a gauge it could not resolve:
//
//     const cond = getConductorSpec(gauge);
//     if (!cond) return 0;
//
// `0 <= anyLimit` is true, so a conductor whose resistance was never looked up
// passed every voltage-drop check. A refusal converted into a pass is the most
// dangerous shape in this repo, because every downstream check then agrees with it.
//
// What it cost:
//   · a #3/0 or #4/0 AC service feeder, or a #3 AWG feeder, made
//     `maxOneWayLengthFt` return null, so `designMaxOneWayFt` was never set, no
//     "MAXIMUM ONE-WAY LENGTH n FT AT 3% Vd" note printed, and the
//     ROUTE-LENGTH-ESTIMATE requirement stayed BLOCKING — the mechanism built to
//     close a package without an attic walk failed for exactly the three largest
//     gauges the engine can select, which are the long service runs it exists for;
//   · `lib/wire-autosizer.ts` could not search past #2/0 and fell through to a
//     hard-coded '#2/0 AWG' carrying `ampacityPass: false, voltageDropPass: false`
//     — a conductor reported as SELECTED while flagged FAILED.
//
// 🚨 #3 AWG IS DELIBERATELY STILL ABSENT FROM THE AUTO-SIZE SEARCH ORDER, and that
// is asserted below rather than left implicit. It is now in the CONDUCTORS roster
// and in Table 8, so a designer who STATES #3 gets a real resistance — but putting
// it between #4 and #2 in the search changes what the auto-sizer RECOMMENDS on
// designs that work today, and #3 is a real NEC size that is rarely stocked. That is
// a product ruling about what goes on a BOM, not a correctness fix. NEEDS RAY.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  NEC_TABLE_8_COPPER,
  dcResistanceOhmsPerKft,
  circularMils,
} from '@/lib/nec/table8';
import { calcVoltageDrop, AWG_ORDER, getConductorSpec } from '@/lib/manufacturer-specs';
import { maxOneWayLengthFt } from '@/lib/electrical/routeLengthBound';
import { CONDUCTORS } from '@/lib/equipment-db';

const THE_THREE_MISSING = ['#3 AWG', '#3/0 AWG', '#4/0 AWG'] as const;

describe('🚨 NEC Chapter 9 Table 8 is complete', () => {
  it('carries the three rows that were missing', () => {
    for (const g of THE_THREE_MISSING) {
      expect(NEC_TABLE_8_COPPER[g], `${g} is absent from Table 8`).toBeTruthy();
    }
  });

  it('matches the published Table 8 values, as literals', () => {
    // Not derived from anything in the repo — read off the table.
    const rows: Array<[string, number, number]> = [
      ['#14 AWG', 4110, 3.14],   ['#12 AWG', 6530, 1.98],
      ['#10 AWG', 10380, 1.24],  ['#8 AWG', 16510, 0.778],
      ['#6 AWG', 26240, 0.491],  ['#4 AWG', 41740, 0.308],
      ['#3 AWG', 52620, 0.245],  ['#2 AWG', 66360, 0.194],
      ['#1 AWG', 83690, 0.154],  ['#1/0 AWG', 105600, 0.122],
      ['#2/0 AWG', 133100, 0.0967], ['#3/0 AWG', 167800, 0.0766],
      ['#4/0 AWG', 211600, 0.0608],
    ];
    for (const [g, cmil, ohms] of rows) {
      expect(circularMils(g), `${g} circular mils`).toBe(cmil);
      expect(dcResistanceOhmsPerKft(g), `${g} resistance`).toBe(ohms);
    }
  });

  it('is monotonic — a bigger conductor always has LOWER resistance', () => {
    const gauges = Object.keys(NEC_TABLE_8_COPPER);
    for (let i = 1; i < gauges.length; i++) {
      expect(NEC_TABLE_8_COPPER[gauges[i]].dcResistanceOhmsPerKft,
        `${gauges[i]} is not lower-resistance than ${gauges[i - 1]}`,
      ).toBeLessThan(NEC_TABLE_8_COPPER[gauges[i - 1]].dcResistanceOhmsPerKft);
      expect(NEC_TABLE_8_COPPER[gauges[i]].circularMils)
        .toBeGreaterThan(NEC_TABLE_8_COPPER[gauges[i - 1]].circularMils);
    }
  });

  it('🚨 refuses with null, never with a zero resistance', () => {
    for (const bad of ['', '#99 AWG', 'copper', '#0 AWG']) {
      expect(dcResistanceOhmsPerKft(bad), `'${bad}'`).toBeNull();
      expect(dcResistanceOhmsPerKft(bad), `'${bad}' returned a falsy NUMBER`).not.toBe(0);
    }
  });
});

describe('🚨 calcVoltageDrop refuses instead of returning a perfect zero', () => {
  it('returns null for an unresolvable conductor', () => {
    expect(calcVoltageDrop(30, 100, '#99 AWG', 240)).toBeNull();
    // The specific shape of the bug: null, not 0, because 0 <= limit PASSES.
    expect(calcVoltageDrop(30, 100, '#99 AWG', 240)).not.toBe(0);
  });

  it('🚨 gives a REAL percentage for the three gauges that used to return zero', () => {
    for (const g of THE_THREE_MISSING) {
      const pct = calcVoltageDrop(150, 200, g, 240);
      expect(pct, `${g} still returns no percentage`).not.toBeNull();
      expect(pct!, `${g} returned a zero voltage drop over 200 ft at 150 A`).toBeGreaterThan(0);
    }
    // Worked case, from Table 8 directly: 150 A on 200 ft of #4/0 at 240 V.
    // vd = 2 × 150 × 0.0608 × 200 / 1000 = 3.648 V → 1.52 %.
    expect(calcVoltageDrop(150, 200, '#4/0 AWG', 240)!).toBeCloseTo(1.52, 2);
  });

  it('a genuine zero input is still a genuine zero, not a refusal', () => {
    // No current, no length or no voltage IS a real zero drop. Only an unknown
    // CONDUCTOR is indeterminate, and the distinction has to survive.
    expect(calcVoltageDrop(0, 100, '#10 AWG', 240)).toBe(0);
    expect(calcVoltageDrop(30, 0, '#10 AWG', 240)).toBe(0);
    expect(calcVoltageDrop(30, 100, '#10 AWG', 0)).toBe(0);
  });

  it('the resistance no longer comes off the CONDUCTORS roster', () => {
    // Every roster entry must agree with Table 8 — a second resistance is a second
    // source, and the two disagreeing is how this class of defect starts.
    for (const c of CONDUCTORS) {
      const t8 = dcResistanceOhmsPerKft(c.gauge);
      expect(t8, `${c.gauge} is in CONDUCTORS but not in Table 8`).not.toBeNull();
      expect(c.dcResistance, `${c.gauge}: roster ${c.dcResistance} vs Table 8 ${t8}`).toBe(t8);
    }
  });
});

describe('🚨 the route-length bound works for the gauges it was built for', () => {
  it('bounds a #3/0 and #4/0 service feeder instead of returning unbounded', () => {
    for (const g of ['#3/0 AWG', '#4/0 AWG', '#3 AWG']) {
      const ft = maxOneWayLengthFt(g, 150, 240, 3);
      expect(ft, `${g}: no maximum one-way length could be derived`).not.toBeNull();
      expect(ft!, `${g}: derived a non-positive length`).toBeGreaterThan(0);
    }
  });

  it('a bigger conductor permits a LONGER run — proof the resistance is real', () => {
    const at = (g: string) => maxOneWayLengthFt(g, 150, 240, 3)!;
    expect(at('#4/0 AWG')).toBeGreaterThan(at('#3/0 AWG'));
    expect(at('#3/0 AWG')).toBeGreaterThan(at('#2/0 AWG'));
  });

  it('still refuses for a genuinely unknown gauge', () => {
    expect(maxOneWayLengthFt('#99 AWG', 150, 240, 3)).toBeNull();
  });
});

describe('the auto-size search order', () => {
  it('🚨 can now reach past #2/0 — the fall-through was the defect', () => {
    expect(AWG_ORDER).toContain('#3/0 AWG');
    expect(AWG_ORDER).toContain('#4/0 AWG');
    expect(AWG_ORDER[AWG_ORDER.length - 1]).toBe('#4/0 AWG');
    // And every gauge in the search order must actually resolve, or the search
    // silently skips it (`if (!cond) continue`).
    for (const g of AWG_ORDER) {
      expect(getConductorSpec(g), `${g} is in AWG_ORDER but has no spec`).toBeTruthy();
      expect(dcResistanceOhmsPerKft(g), `${g} is in AWG_ORDER but has no resistance`).not.toBeNull();
    }
  });

  it('🚨 does NOT yet include #3 AWG — a product ruling, recorded as NEEDS RAY', () => {
    // Asserted so the decision is visible and cannot drift in silently. #3 IS
    // resolvable (see above); it is simply not something the auto-sizer recommends.
    expect(AWG_ORDER).not.toContain('#3 AWG');
    expect(dcResistanceOhmsPerKft('#3 AWG'),
      '#3 AWG must still resolve for a designer who states it').toBe(0.245);
  });

  it('is ordered smallest-to-largest, so "next gauge" means bigger', () => {
    for (let i = 1; i < AWG_ORDER.length; i++) {
      expect(dcResistanceOhmsPerKft(AWG_ORDER[i])!,
        `${AWG_ORDER[i]} is not bigger than ${AWG_ORDER[i - 1]}`,
      ).toBeLessThan(dcResistanceOhmsPerKft(AWG_ORDER[i - 1])!);
    }
  });
});
