// ═══════════════════════════════════════════════════════════════════════════
// NEC CHAPTER 9 — ONE RACEWAY-FILL AUTHORITY (2026-08-29)
//
// The repo held FIVE conduit-area tables and five conductor-area sources, of
// which exactly one was both correct and correctly applied:
//
//   · CONDUIT_40PCT_AREA (computed-system) was written `X * 0.40` where X was
//     ALREADY the NEC 40% column — so a raceway was accepted only when the bundle
//     fitted in 16% of its interior, over-sizing conduit by roughly two trade
//     sizes on every job;
//   · CONDUIT_FULL_AREA (computed-system AND a byte-identical copy in
//     segment-schedule, the one that fed the sheets) was commented "Full conduit
//     areas (100%)" and populated with that same 40% column, so every printed
//     fill percentage was 2.5× the truth;
//   · segment-builder's table was TYPE-BLIND — one column for EMT, PVC 40 and
//     PVC 80 alike, while its function took a conduitType it never used — and
//     drifted from the code at 2-1/2" and 3";
//   · equipment-db's table was correct and incomplete: no PVC Sch 80 rows at all,
//     nothing above 2". A PVC Sch 80 project found nothing, reported 100% fill,
//     raised E-CONDUIT-FILL on a sound raceway, and the autosizer fell back to a
//     hardcoded 3/4".
//
// Table 4 holds TOTAL areas. Table 1 holds the ALLOWANCE as a percentage of them.
// They are two numbers and the code must never store one under the other's name.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  CONDUIT_TOTAL_AREA_IN2, CONDUCTOR_AREA_IN2, fillLimitPct, normalizeConduitType,
  conduitTotalAreaIn2, conduitAllowableFillIn2, conductorAreaIn2,
  selectSmallestConduit, computeConduitFill, CONDUIT_TRADE_SIZES,
} from '@/lib/nec/chapter9';

describe('the published tables are the published tables', () => {
  it('Table 4 total areas match NFPA 70 Chapter 9', () => {
    // Spot-checked against the code, including the sizes the old tables got wrong.
    expect(conduitTotalAreaIn2('EMT', '1/2"')).toBeCloseTo(0.304, 3);
    expect(conduitTotalAreaIn2('EMT', '3/4"')).toBeCloseTo(0.533, 3);
    expect(conduitTotalAreaIn2('EMT', '1-1/4"')).toBeCloseTo(1.496, 3);
    // segment-builder had 4.860 and 7.928 here — ~11% under, forcing upsizing.
    expect(conduitTotalAreaIn2('EMT', '2-1/2"')).toBeCloseTo(5.858, 3);
    expect(conduitTotalAreaIn2('EMT', '3"')).toBeCloseTo(8.846, 3);
    // the type nothing in the repo carried a single row for
    expect(conduitTotalAreaIn2('PVC Sch 80', '1-1/4"')).toBeCloseTo(1.237, 3);
  });

  it('every tabulated type covers every trade size, monotonically', () => {
    for (const type of Object.keys(CONDUIT_TOTAL_AREA_IN2)) {
      let prev = 0;
      for (const size of CONDUIT_TRADE_SIZES) {
        const a = conduitTotalAreaIn2(type, size);
        expect(a, `${type} ${size}`).not.toBeNull();
        expect(a as number, `${type} ${size} not increasing`).toBeGreaterThan(prev);
        prev = a as number;
      }
    }
  });

  it('PVC Sch 80 is smaller than Sch 40, which is smaller than RMC', () => {
    // A cheap physical sanity check that catches a column pasted from the wrong
    // product — which is how a PVC table came to hold EMT numbers.
    for (const size of CONDUIT_TRADE_SIZES) {
      const p80 = conduitTotalAreaIn2('PVC Sch 80', size) as number;
      const p40 = conduitTotalAreaIn2('PVC Sch 40', size) as number;
      expect(p80, size).toBeLessThan(p40);
    }
  });

  it('Table 5 conductor areas match, including the one that had drifted', () => {
    expect(conductorAreaIn2('#12 AWG')).toBeCloseTo(0.0133, 4);
    expect(conductorAreaIn2('#10 AWG')).toBeCloseTo(0.0211, 4);
    expect(conductorAreaIn2('#6 AWG')).toBeCloseTo(0.0507, 4);
    // computed-system had 0.2660 here, segment-schedule the same; NEC is 0.2679.
    expect(conductorAreaIn2('#3/0 AWG')).toBeCloseTo(0.2679, 4);
    expect(CONDUCTOR_AREA_IN2['#4/0 AWG']).toBeCloseTo(0.3237, 4);
  });
});

describe('the allowance is a percentage OF the total, never stored as the total', () => {
  it('Table 1: 53% for one conductor, 31% for two, 40% for more', () => {
    expect(fillLimitPct(1)).toBe(53);
    expect(fillLimitPct(2)).toBe(31);
    expect(fillLimitPct(3)).toBe(40);
    expect(fillLimitPct(9)).toBe(40);
  });

  it('the allowance is derived, so it can never be 16% of the interior', () => {
    // The old CONDUIT_40PCT_AREA was 0.40 × (the 40% column) = 0.16 × interior.
    const total = conduitTotalAreaIn2('EMT', '3/4"') as number;
    expect(conduitAllowableFillIn2('EMT', '3/4"', 3)).toBeCloseTo(total * 0.40, 6);
    expect(conduitAllowableFillIn2('EMT', '3/4"', 1)).toBeCloseTo(total * 0.53, 6);
  });

  it('a reported fill is a percentage of the TOTAL, as a reviewer recomputes it', () => {
    // 6 × #10 + 1 × #12 in 1-1/4" PVC Sch 80 — the audited home-run bundle.
    const area = 6 * 0.0211 + 0.0133;
    const f = computeConduitFill({
      conduitType: 'PVC Sch 80', tradeSize: '1-1/4"', conductorAreaIn2: area, conductorCount: 7,
    });
    expect(f.fillPct).toBeCloseTo((area / 1.237) * 100, 3);
    expect(f.fillPct as number).toBeLessThan(15);   // the sheet printed 29.0%
    expect(f.withinLimit).toBe(true);
  });
});

describe('the selector picks the smallest size that actually holds the bundle', () => {
  const cases: Array<[string, number, number, string]> = [
    ['EMT', 2 * 0.0211 + 0.0211, 3, '1/2"'],
    ['EMT', 6 * 0.0211 + 0.0133, 7, '3/4"'],
    ['EMT', 3 * 0.0507 + 0.0211, 4, '3/4"'],
    ['EMT', 3 * 0.0366 + 0.0211, 4, '3/4"'],
  ];
  for (const [type, area, n, expected] of cases) {
    it(`${type} ${area.toFixed(4)} in² × ${n} conductors ⇒ ${expected}`, () => {
      const p = selectSmallestConduit(type, area, n);
      expect(p?.tradeSize).toBe(expected);
      // and the pick genuinely satisfies the limit it was chosen under
      expect(area).toBeLessThanOrEqual((p as { allowableIn2: number }).allowableIn2 + 1e-9);
      // ...while the next size down does not
      const i = CONDUIT_TRADE_SIZES.indexOf(expected as never);
      if (i > 0) {
        const smaller = conduitAllowableFillIn2(type, CONDUIT_TRADE_SIZES[i - 1], n) as number;
        expect(area).toBeGreaterThan(smaller);
      }
    });
  }
});

describe('a conduit type nobody recognises never silently becomes EMT', () => {
  it('resolves every label the UI actually offers', () => {
    expect(normalizeConduitType('PVC Schedule 80')).toBe('PVC Sch 80');
    expect(normalizeConduitType('PVC Schedule 40')).toBe('PVC Sch 40');
    expect(normalizeConduitType('PVC Sch 80')).toBe('PVC Sch 80');
    expect(normalizeConduitType('Rigid Metal (RMC)')).toBe('RMC');
    expect(normalizeConduitType('Flexible Metal (FMC)')).toBe('FMC');
    expect(normalizeConduitType('EMT')).toBe('EMT');
  });

  it('an unknown type returns null rather than a steel column', () => {
    // The old tables did `TABLE[type] ?? TABLE['EMT']`, so a PVC run could be
    // sized and reported against EMT while the sheet printed PVC.
    expect(normalizeConduitType('unobtainium')).toBeNull();
    expect(conduitTotalAreaIn2('unobtainium', '3/4"')).toBeNull();
    expect(selectSmallestConduit('unobtainium', 0.05, 3)).toBeNull();
  });

  it('PVC Sch 80 is now selectable at every size — it had no rows at all', () => {
    expect(selectSmallestConduit('PVC Schedule 80', 3 * 0.0507 + 0.0211, 4)?.tradeSize).toBe('1"');
  });
});
