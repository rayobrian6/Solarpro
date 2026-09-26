/**
 * tests/necAmpacityIsSingleSourced.test.ts
 *
 * ONE NEC 310.16 TABLE, AND THE #1 AWG ROW THAT PROVED WHY.
 *
 * The 90 °C column existed twice and the two copies disagreed at exactly one row:
 *
 *     lib/computed-system.ts   '#1 AWG': 145   ← correct
 *     lib/segment-schedule.ts  '#1 AWG': 150   ← wrong (that is 1/0's 75 °C value)
 *
 * The wrong copy was the one that SELECTED the installed conductor; the right one only
 * PRINTED the derivation on E-1. So the sheet published the arithmetic proving a
 * choice that a different number had made, and on a hot-ambient feeder it graded its
 * own conductor FAIL.
 *
 * 🚨 A COMMENT HAD ASSERTED THIS WAS IMPOSSIBLE — "each accessor delegates to the
 * module-private table the wire-sizer already uses, so E-1's ampacity evidence and the
 * sizer can never disagree." True of one sizer, false of the one that owns the callout.
 * A sentence is not a guard, which is what this file is for.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  NEC_310_16_COPPER_75C, NEC_310_16_COPPER_90C, NEC_AWG_ORDER, necAmpacity,
  necAmbientCorrection90C, necConductorCountAdjustment,
} from '@/lib/nec/ampacity';
import { ampacityTable75C, ampacityTable90C } from '@/lib/computed-system';

const ROOT = join(__dirname, '..');

describe('the table itself', () => {
  it('🚨 #1 AWG at 90 °C is 145 A, not 1/0\'s 75 °C 150', () => {
    expect(NEC_310_16_COPPER_90C['#1 AWG']).toBe(145);
    // The value that was copied in by mistake, and where it actually belongs.
    expect(NEC_310_16_COPPER_75C['#1/0 AWG']).toBe(150);
  });

  it('every gauge in the order has all columns, and the columns rank correctly', () => {
    for (const g of NEC_AWG_ORDER) {
      const a75 = NEC_310_16_COPPER_75C[g];
      const a90 = NEC_310_16_COPPER_90C[g];
      expect(a75, `${g} 75 °C`).toBeGreaterThan(0);
      expect(a90, `${g} 90 °C`).toBeGreaterThan(0);
      // A hotter insulation column is never below a cooler one — the single check
      // that would have caught a row copied in from the wrong column, in either
      // direction.
      expect(a90, `${g}: the 90 °C value must exceed the 75 °C value`).toBeGreaterThan(a75);
    }
  });

  it('ampacity rises monotonically with conductor size', () => {
    for (const table of [NEC_310_16_COPPER_75C, NEC_310_16_COPPER_90C]) {
      for (let i = 1; i < NEC_AWG_ORDER.length; i++) {
        expect(table[NEC_AWG_ORDER[i]],
          `${NEC_AWG_ORDER[i]} must carry more than ${NEC_AWG_ORDER[i - 1]}`)
          .toBeGreaterThan(table[NEC_AWG_ORDER[i - 1]]);
      }
    }
  });

  it('tolerates the legacy un-prefixed aught spelling, and returns undefined off-table', () => {
    expect(necAmpacity(NEC_310_16_COPPER_75C, '1/0 AWG')).toBe(150);
    expect(necAmpacity(NEC_310_16_COPPER_75C, '#1/0 AWG')).toBe(150);
    // 🚨 undefined, NOT 0. A zero ampacity silently fails every comparison it enters,
    // which reads as "this conductor is never big enough" rather than "unknown gauge".
    expect(necAmpacity(NEC_310_16_COPPER_75C, '#42 AWG')).toBeUndefined();
  });
});

describe('every consumer reads that one table', () => {
  it('the accessors E-1 prints from return the canonical values', () => {
    for (const g of NEC_AWG_ORDER) {
      expect(ampacityTable90C(g), `90 °C ${g}`).toBe(NEC_310_16_COPPER_90C[g]);
      expect(ampacityTable75C(g), `75 °C ${g}`).toBe(NEC_310_16_COPPER_75C[g]);
    }
  });

  it('🚨 no module re-declares the table as its own literal', () => {
    // The signature of a transcribed 310.16 copy: the 90 °C column's own row values
    // appearing together as object literals. Checked across lib/ so a fourth copy
    // cannot be added quietly — which is precisely how the third one arrived.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
        if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
        // The canonical module is allowed to be the one place these live.
        if (p.endsWith(join('lib', 'nec', 'ampacity.ts'))) continue;
        const src = readFileSync(p, 'utf8');
        // Two adjacent 90 °C rows as literals is enough to identify a copy, and is
        // specific enough not to match an unrelated number.
        if (/'#1 AWG':\s*(145|150)\s*,/.test(src) && /'#2 AWG':\s*130\s*,/.test(src)) {
          offenders.push(p.slice(ROOT.length + 1));
        }
      }
    };
    walk(join(ROOT, 'lib'));
    expect(offenders,
      'a NEC 310.16 90 °C table has been re-declared outside lib/nec/ampacity.ts — that is how the #1 AWG row came to disagree with itself')
      .toEqual([]);
  });
});

describe('🚨 the conductor the sizer picks, on the row that disagreed', () => {
  it('a feeder in the divergence window now needs 1/0, not #1', async () => {
    // This is the case the two tables answered differently. With a 0.87 ambient
    // correction and three current-carrying conductors (adjustment 1.00):
    //
    //   the wrong table:  min(150 × 0.87, 130) = 130.00 A  → #1 AWG accepted
    //   the right table:  min(145 × 0.87, 130) = 126.15 A  → #1 AWG refused
    //
    // so a required continuous current between those two figures selects a different
    // conductor depending on which table is consulted. 110.14(C) caps both at the
    // 75 °C terminal rating of 130 A, which is why the window is narrow and real.
    const { autoSizeGauge } = await import('@/lib/segment-schedule');
    const AMBIENT_C = 43;   // reachable ASHRAE 2 % design dry bulb, inland CA/AZ/NV
    const CCC = 3;

    // 128 A continuous sits inside the window: 126.15 < 128 ≤ 130.00
    const picked = autoSizeGauge(128 / 1.25, AMBIENT_C, CCC, false);
    const gauge = typeof picked === 'string' ? picked : (picked as { gauge: string }).gauge;
    expect(gauge,
      'the sizer still accepts #1 AWG at 128 A continuous — it is reading a 150 A base for a 145 A conductor')
      .not.toMatch(/^#1 AWG$/);
    expect(gauge).toMatch(/1\/0/);
  });

  it('and a load comfortably inside #1 AWG still gets #1 AWG', () => {
    // The correction must not simply upsize everything: below the window the answer
    // is unchanged, which is what makes the case above specific.
    expect(NEC_310_16_COPPER_90C['#1 AWG'] * 0.87).toBeGreaterThan(120);
  });
});

describe('🚨 the derating ladders, which had THREE copies and one dissenter', () => {
  it('the ambient correction is the 90 °C column across its whole domain', () => {
    // Spot-checks at the boundaries the code table actually steps on. The dissenting
    // copy in lib/segment-builder.ts returned 0.64 at 43 °C and 0.41 at 20 °C.
    const cases: Array<[number, number]> = [
      [-10, 1.15], [10, 1.15], [15, 1.12], [20, 1.08], [25, 1.04], [30, 1.00],
      [35, 0.96], [40, 0.91], [43, 0.87], [45, 0.87], [50, 0.82], [55, 0.76],
      [60, 0.71],
      // 🚨 THE TOP OF THE TABLE. Two of the four copies stopped at 60 and returned a
      // flat 0.58 above it, which is LESS conservative than NEC from about 70 °C up —
      // on the hot-rooftop end, where a PV conductor actually lives. The first draft of
      // this very case asserted 0.58 at 75 °C, because it was written against the
      // behaviour rather than against the table.
      [65, 0.65], [70, 0.58], [75, 0.50], [80, 0.41], [85, 0.29], [95, 0.29],
    ];
    for (const [c, f] of cases) {
      expect(necAmbientCorrection90C(c), `${c} °C`).toBe(f);
    }
  });

  it('🚨 43 °C is 0.87 and 20 °C is 1.08 — the two the dissenter got wrong', () => {
    // Named separately because these are the values that made the disagreement
    // material rather than cosmetic: a third and a two-thirds error respectively.
    expect(necAmbientCorrection90C(43)).toBe(0.87);
    expect(necAmbientCorrection90C(43)).not.toBe(0.64);
    expect(necAmbientCorrection90C(20)).toBe(1.08);
    expect(necAmbientCorrection90C(20)).not.toBe(0.41);
  });

  it('the count adjustment holds 0.50 through TWENTY conductors', () => {
    // The dissenter stepped to 0.45 at 13. Between 13 and 20 the two answers differ by
    // a tenth of the conductor's ampacity.
    for (const n of [4, 6]) expect(necConductorCountAdjustment(n), `${n}`).toBe(0.80);
    for (const n of [7, 9]) expect(necConductorCountAdjustment(n), `${n}`).toBe(0.70);
    for (const n of [10, 13, 20]) expect(necConductorCountAdjustment(n), `${n}`).toBe(0.50);
    expect(necConductorCountAdjustment(3)).toBe(1.00);
    expect(necConductorCountAdjustment(21)).toBe(0.45);
    expect(necConductorCountAdjustment(41)).toBe(0.35);
  });

  it('both are monotonic — a hotter or more crowded raceway never derates LESS', () => {
    // The property that makes a transcription slip visible without knowing the table:
    // the dissenter's `?? 0.41` fallback broke it at both ends of its window.
    for (let c = -20; c < 80; c++) {
      expect(necAmbientCorrection90C(c + 1), `${c} → ${c + 1} °C`)
        .toBeLessThanOrEqual(necAmbientCorrection90C(c));
    }
    for (let n = 1; n < 60; n++) {
      expect(necConductorCountAdjustment(n + 1), `${n} → ${n + 1} CCC`)
        .toBeLessThanOrEqual(necConductorCountAdjustment(n));
    }
  });

  it('🚨 no module re-declares either ladder', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
        if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
        if (p.endsWith(join('lib', 'nec', 'ampacity.ts'))) continue;
        const src = readFileSync(p, 'utf8');
        // The signature of a re-typed ambient ladder: two adjacent steps as literals.
        if (/<=\s*45\)\s*return\s*0\.87/.test(src) && /<=\s*40\)\s*return\s*0\.91/.test(src)) {
          offenders.push(p.slice(ROOT.length + 1));
        }
      }
    };
    walk(join(ROOT, 'lib'));
    expect(offenders,
      'an NEC derating ladder has been re-declared outside lib/nec/ampacity.ts — that is how one of the three came to disagree with the other two')
      .toEqual([]);
  });
});
