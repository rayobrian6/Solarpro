/**
 * tests/wireGaugeShowsItsConsequence.test.ts
 *
 * PICKING WIRE WAS DATA ENTRY. IT IS A DECISION.
 *
 * The DC wire dropdown was a bare list of five gauges, so choosing one meant
 * guessing, saving, reading the conduit schedule, and coming back to change it.
 * HelioScope annotates every option with the voltage drop it would cause —
 * `10 AWG (Copper), 0.2%` — which the engineering research lane rated the best
 * single interaction in the entire corpus. The number was already computable at
 * the point of the choice.
 *
 * 🚨 AND IT MUST BE THE SAME NUMBER THE SCHEDULE PRINTS.
 *
 * Several voltage-drop implementations exist in this codebase. Only two are
 * reachable from a user-facing path. `segmentVoltageDropPct` is the one whose
 * answer `computed-system` displays and the stamped plan set is engineered to.
 * Annotating the dropdown from any other — `manufacturer-specs.calcVoltageDrop`
 * is right there and uses a different resistance table — would show the
 * designer a figure that the conduit schedule immediately contradicts. That is
 * the defect class this campaign has spent its length closing, and it would
 * have been introduced by a feature intended to help.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { segmentVoltageDropPct } from '../lib/segment-schedule';

const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app', 'engineering', 'page.tsx'), 'utf8'));

describe('🚨 the annotation comes from the authority the schedule uses', () => {
  it('the page imports the segment schedule’s own function', () => {
    expect(PAGE).toMatch(/import \{ segmentVoltageDropPct \} from '@\/lib\/segment-schedule'/);
  });

  it('and calls it with the string’s real current, run and voltage', () => {
    expect(PAGE).toMatch(/segmentVoltageDropPct\(imp, runFt, g, stringV, 2\)/);
  });

  it('🚨 it does NOT use a different voltage-drop implementation', () => {
    // `manufacturer-specs` exports one with a different resistance table. Its
    // answer and this one differ, and the schedule prints this one.
    expect(PAGE, 'the dropdown is annotating from a second voltage-drop implementation')
      .not.toMatch(/from '@\/lib\/manufacturer-specs'[^\n]*calcVoltageDrop|calcVoltageDrop\(/);
  });
});

describe('🚨 a guessed number is worse than none', () => {
  it('the annotation is gated on every input being real', () => {
    // A drop computed from a defaulted current looks exactly like an answer.
    expect(PAGE).toMatch(/Number\.isFinite\(imp\) && imp > 0/);
    expect(PAGE).toMatch(/Number\.isFinite\(stringV\) && stringV > 0/);
    expect(PAGE).toMatch(/Number\.isFinite\(runFt\) && runFt > 0/);
  });

  it('and it falls back to a bare list rather than inventing one', () => {
    expect(PAGE).toMatch(/if \(!canAnnotate\) return <option key=\{g\} value=\{g\}>\{g\}<\/option>;/);
  });

  it('the option VALUE stays the plain gauge, so the annotation cannot be saved', () => {
    // 🚨 THE TRAP THIS AVOIDS. If the label were the value, selecting
    // "#10 AWG — 0.87%" would persist that whole string as the wire gauge, and
    // every downstream consumer keyed on '#10 AWG' would stop matching. The
    // annotation is display only.
    expect(PAGE).toMatch(/<option key=\{g\} value=\{g\}>\{`\$\{g\} — \$\{vd\.toFixed\(2\)\}%`\}<\/option>/);
  });
});

describe('the physics behind the annotation', () => {
  // A real string: 12 panels of a 34.29 Vmp / 12.25 Imp module on a 150 ft run.
  const IMP = 12.25, RUN = 150, STRING_V = 34.29 * 12;

  it('a thicker conductor always drops less', () => {
    const order = ['#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG'];
    const drops = order.map(g => segmentVoltageDropPct(IMP, RUN, g, STRING_V, 2));
    for (let i = 1; i < drops.length; i++) {
      expect(drops[i], `${order[i]} did not drop less than ${order[i - 1]}`)
        .toBeLessThan(drops[i - 1]);
    }
  });

  it('a longer run drops more, and doubling it doubles the drop', () => {
    const short = segmentVoltageDropPct(IMP, 100, '#10 AWG', STRING_V, 2);
    const long  = segmentVoltageDropPct(IMP, 200, '#10 AWG', STRING_V, 2);
    expect(long).toBeGreaterThan(short);
    expect(long / short).toBeCloseTo(2, 6);
  });

  it('the annotation spans the 3% decision boundary on a realistic run', () => {
    // The whole point of annotating: on a long run the list straddles the limit,
    // so it informs the choice instead of decorating it.
    //
    // 200 ft, not 150. A first version of this test asserted the boundary fell
    // at 150 ft and failed — #14 is 2.80% there, comfortably under. The code
    // was right and the expectation was invented. Recorded because a test that
    // asserts a plausible-sounding number it never computed is the same
    // mistake as a guard that pins a literal.
    const LONG = 200;
    const thin  = segmentVoltageDropPct(IMP, LONG, '#14 AWG', STRING_V, 2);
    const thick = segmentVoltageDropPct(IMP, LONG, '#10 AWG', STRING_V, 2);
    expect(thin, 'the thinnest option no longer exceeds the 3% limit anywhere').toBeGreaterThan(3);
    expect(thick, 'the thicker option no longer clears the 3% limit').toBeLessThan(3);
  });

  it('it is a percentage, not volts', () => {
    const pct = segmentVoltageDropPct(IMP, RUN, '#10 AWG', STRING_V, 2);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
  });

  it('an unknown gauge does not throw — it falls back to a tabulated size', () => {
    expect(Number.isFinite(segmentVoltageDropPct(IMP, RUN, '#999 AWG', STRING_V, 2))).toBe(true);
  });
});
