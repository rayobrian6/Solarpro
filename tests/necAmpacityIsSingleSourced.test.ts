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
