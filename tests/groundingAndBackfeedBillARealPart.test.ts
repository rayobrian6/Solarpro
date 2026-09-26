// ═══════════════════════════════════════════════════════════════════════════
// 🚨 FOUR DEFECTS ON PURCHASED, INSTALLED GROUNDING AND INTERCONNECTION PARTS
//
// All four live in `lib/bom-engine-v4.ts`, and all four emit a BOM LINE — a part
// somebody buys and an electrician installs — not a display artifact.
//
// 1. EGC — an inline 3-rung ternary standing in for the 11-rung NEC 250.122
//    table, FLAT at #6 AWG above 100 A:
//        ocpdForEgc <= 60 ? '#10 AWG' : ocpdForEgc <= 100 ? '#8 AWG' : '#6 AWG'
//    A 300 A AC feeder shipped #6 where 250.122 requires #4, on a line whose own
//    necReference reads 'NEC 690.43 / 250.122'. Same shape as the `size * 15`
//    defect: a wrong number made credible by a correct-looking citation. Below
//    the flat region it over-buys — a 20 A feeder got #10 where #12 suffices.
//
// 2. GEC — NEC Table 250.66 existed THREE times and the copies DISAGREED AT
//    EVERY RUNG, and none was indexed on what the table is indexed on:
//        bom-engine-v4 x2:  <=60 -> #6, <=100 -> #4, else #2
//        computed-plan:     <=60 -> #8, <=100 -> #6, <=200 -> #4, else #2
//    All three keyed on the OCPD. Table 250.66 is keyed on the largest ungrounded
//    SERVICE-ENTRANCE conductor. On a 200 A service the live copy billed 50 ft of
//    #2 bare copper — four gauge steps above the #6 that 250.66(A) caps a
//    rod-only GEC at; above 350 kcmil it was UNDERSIZED.
//
// 3. The grounding-electrode gate was applied to one BOM emitter and left off the
//    other, so every HYBRID project shipped a phantom rod + acorn + 50 ft of bare
//    copper and printed 'NEC 250.52(A)(5): ... required', while the permit
//    package's own electrical sheet stated in print that no new electrode is added.
//
// 4. The backfeed breaker was capped with `Math.min(requestedBreaker, maxPVBreaker)`
//    where maxPVBreaker = floor(busRating × 1.2 − mainAmps) — raw arithmetic, not
//    a rating. A 320 A service with a 200 A main gives 184, and the BOM emitted
//    '184A Backfeed Breaker' with Square D part number 'QO184'. No such device
//    exists. Rounding up to 200 puts 400 A on a 384 A allowance and violates the
//    705.12(B)(3)(2) rule the same BOM certified.
//
// These cases assert PROPERTIES — every grounding conductor this product bills
// comes from the published table, and every breaker part number it bills is a
// real NEC 240.6(A) rating — rather than pinning today's numbers.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
// Static imports only — `require('@/lib/...')` does NOT resolve the path alias
// under vitest, which fails the whole suite before a single case runs.
import { NEC_STANDARD_OCPD, prevStandardOcpd } from '@/lib/electrical/stdSizes';
import { getEGCSize } from '@/lib/manufacturer-specs';
import {
  gecSizeForServiceConductor,
  resolveGec,
  smallerConductor,
  ROD_ONLY_GEC_MAX,
} from '@/lib/nec/table250_66';

const STANDARD = new Set<number>(NEC_STANDARD_OCPD as readonly number[]);

// ── 1. NEC Table 250.66, against the published rows ─────────────────────────
describe('🚨 NEC Table 250.66 is the published table, not a guess at it', () => {
  it('matches every row of Table 250.66 (copper)', () => {
    // Literals from the published table — NOT derived by calling the function
    // under test, which would make this case agree with any implementation.
    const rows: Array<[string, string]> = [
      ['#8 AWG',    '#8 AWG'],   // 2 AWG or smaller
      ['#4 AWG',    '#8 AWG'],   // 2 AWG or smaller
      ['#2 AWG',    '#8 AWG'],   // 2 AWG or smaller  (boundary)
      ['#1 AWG',    '#6 AWG'],   // 1 or 1/0 AWG
      ['#1/0 AWG',  '#6 AWG'],   // 1 or 1/0 AWG      (boundary)
      ['#2/0 AWG',  '#4 AWG'],   // 2/0 or 3/0 AWG
      ['#3/0 AWG',  '#4 AWG'],   // 2/0 or 3/0 AWG    (boundary)
      ['#4/0 AWG',  '#2 AWG'],   // over 3/0 through 350 kcmil
      ['250 kcmil', '#2 AWG'],
      ['350 kcmil', '#2 AWG'],   // boundary
      ['400 kcmil', '#1/0 AWG'], // over 350 through 600
      ['600 kcmil', '#1/0 AWG'], // boundary
      ['700 kcmil', '#2/0 AWG'], // over 600 through 1100
      ['1100 kcmil','#2/0 AWG'], // boundary
      ['1500 kcmil','#3/0 AWG'], // over 1100
    ];
    for (const [service, gec] of rows) {
      expect(gecSizeForServiceConductor(service), `${service} service-entrance conductor`).toBe(gec);
    }
  });

  it('refuses an unresolvable size instead of inventing a gauge', () => {
    for (const bad of ['', 'big', '#99 AWG', 'copper']) {
      expect(gecSizeForServiceConductor(bad), `'${bad}'`).toBeNull();
    }
  });

  it('🚨 250.66(A) CAPS the rod-only GEC at #6 — it does not raise a smaller one', () => {
    // 200 A residential service is typically 2/0–4/0 Cu. Table says #4/#2; the
    // rod-only cap brings it to #6. That is the several-hundred-dollar line.
    expect(resolveGec({ serviceConductorSize: '4/0 AWG', rodOnly: true }).size).toBe('#6 AWG');
    expect(resolveGec({ serviceConductorSize: '4/0 AWG', rodOnly: true }).cappedByRodOnly).toBe(true);
    expect(resolveGec({ serviceConductorSize: '350 kcmil', rodOnly: true }).size).toBe('#6 AWG');

    // Where the table calls for #8, the cap must NOT push it up to #6.
    const small = resolveGec({ serviceConductorSize: '#4 AWG', rodOnly: true });
    expect(small.size, '250.66(A) is a cap, not a minimum').toBe('#8 AWG');
    expect(small.cappedByRodOnly).toBe(false);
  });

  it('a NON-rod electrode is sized by the table, uncapped', () => {
    // Where the GEC is not the sole connection to a rod, 250.66(A) does not apply
    // and the table governs — including the large rows the old copies capped at #2.
    expect(resolveGec({ serviceConductorSize: '700 kcmil', rodOnly: false }).size).toBe('#2/0 AWG');
    expect(resolveGec({ serviceConductorSize: '1500 kcmil', rodOnly: false }).size).toBe('#3/0 AWG');
  });

  it('never returns a conductor SMALLER than the table requires when the size is known', () => {
    // The undersized direction is the one that is a code violation on installed wire.
    const order = ['#8 AWG', '#6 AWG', '#4 AWG', '#2 AWG', '#1/0 AWG', '#2/0 AWG', '#3/0 AWG'];
    for (const service of ['#8 AWG', '#2 AWG', '#1 AWG', '#3/0 AWG', '350 kcmil', '600 kcmil', '1100 kcmil', '2000 kcmil']) {
      const required = gecSizeForServiceConductor(service)!;
      const got = resolveGec({ serviceConductorSize: service, rodOnly: false }).size;
      expect(order.indexOf(got), `${service}: ${got} is smaller than the required ${required}`)
        .toBeGreaterThanOrEqual(order.indexOf(required));
    }
  });

  it('the no-input fallback can never be undersized', () => {
    // A rod-only electrode with no service conductor on file: #6 satisfies
    // 250.66(A) for ANY service, so the fallback is compliant, not a guess.
    const rod = resolveGec({ rodOnly: true });
    expect(rod.size).toBe(ROD_ONLY_GEC_MAX);
    expect(rod.basis, 'the basis must not imply the table was consulted').toMatch(/not supplied/);

    // With no rod cap to lean on, take the largest row rather than a middle guess.
    expect(resolveGec({ rodOnly: false }).size).toBe('#3/0 AWG');
  });

  it('smallerConductor compares by AREA, not by the printed number', () => {
    // '#8' vs '#6': the bigger numeral is the smaller wire. A naive numeric
    // comparison here is how a cap becomes an upsize.
    expect(smallerConductor('#8 AWG', '#6 AWG')).toBe('#8 AWG');
    expect(smallerConductor('#2 AWG', '#6 AWG')).toBe('#6 AWG');
    expect(smallerConductor('#3/0 AWG', '#1/0 AWG')).toBe('#1/0 AWG');
  });
});

// ── 2. NEC 250.122 — the EGC ladder the BOM now bills from ───────────────────
describe('🚨 the EGC comes from the whole 250.122 table, not a flat tail', () => {
  it('matches the published 250.122 rows the old ternary collapsed', () => {
    const rows: Array<[number, string]> = [
      [15, '#14 AWG'], [20, '#12 AWG'], [60, '#10 AWG'], [100, '#8 AWG'],
      [200, '#6 AWG'], [300, '#4 AWG'], [400, '#3 AWG'], [500, '#2 AWG'], [600, '#1 AWG'],
    ];
    for (const [ocpd, egc] of rows) {
      expect(getEGCSize(ocpd), `${ocpd} A OCPD`).toBe(egc);
    }
  });

  it('🚨 does NOT go flat above 100 A — the unsafe direction', () => {
    // The old ternary returned '#6 AWG' for every OCPD above 100. Each of these
    // is a conductor that was purchased and installed undersized.
    for (const ocpd of [300, 400, 500, 600]) {
      expect(getEGCSize(ocpd), `${ocpd} A still gets the flat #6 AWG`).not.toBe('#6 AWG');
    }
  });

  it('does not over-buy at the bottom either', () => {
    // The old ternary gave '#10 AWG' for a 20 A feeder; 250.122 says #12.
    expect(getEGCSize(20)).toBe('#12 AWG');
    expect(getEGCSize(15)).toBe('#14 AWG');
  });

  it('is monotonic — a bigger OCPD never gets a smaller ground', () => {
    const order = ['#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG',
                   '#3 AWG', '#2 AWG', '#1 AWG', '#1/0 AWG'];
    let prev = -1;
    for (let a = 1; a <= 800; a += 1) {
      const idx = order.indexOf(getEGCSize(a));
      expect(idx, `${a} A -> ${getEGCSize(a)}, which is not a 250.122 size`).toBeGreaterThanOrEqual(0);
      expect(idx, `${a} A got a SMALLER ground than ${a - 1} A`).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });
});

// ── 3. The 120% cap must land on a real part number ─────────────────────────
describe('🚨 the 120% backfeed cap lands on a rating Square D actually makes', () => {
  it('the allowance values the old code emitted are not ratings', () => {
    // floor(bus × 1.2 − main) for real services, and what the BOM printed.
    const allowances: Array<[number, number, number]> = [
      // [busRating, mainAmps, the raw allowance the old cap emitted as a part number]
      [320, 200, 184],
      [200, 100, 140],
      [125, 100,  50],
      [400, 225, 255],
    ];
    for (const [bus, main, raw] of allowances) {
      expect(Math.floor(bus * 1.2 - main), `${bus}A bus / ${main}A main`).toBe(raw);
    }
    // Two of those four are not orderable devices.
    expect(STANDARD.has(184), '184 A is not an NEC 240.6(A) rating').toBe(false);
    expect(STANDARD.has(255), '255 A is not an NEC 240.6(A) rating').toBe(false);
  });

  it('the capped rating is always a real size AND never above the allowance', () => {
    for (let bus = 100; bus <= 600; bus += 5) {
      for (const main of [100, 125, 150, 200, 225, 400]) {
        const allowance = Math.floor(bus * 1.2 - main);
        if (allowance < 15) continue; // no compliant size exists; warned separately
        const capped = prevStandardOcpd(allowance);
        expect(STANDARD.has(capped), `${bus}/${main}: ${capped} A is not a rating`).toBe(true);
        expect(capped, `${bus}/${main}: ${capped} A EXCEEDS the ${allowance} A allowance`)
          .toBeLessThanOrEqual(allowance);
      }
    }
  });

  it('320A bus / 200A main yields 175 A, not the fictitious 184 A', () => {
    expect(prevStandardOcpd(184)).toBe(175);
    expect(prevStandardOcpd(184)).not.toBe(184);
    // And rounding UP — the installer's natural move — would have violated the rule.
    expect(200 + 200, 'rounding up to 200 A exceeds the 384 A allowance').toBeGreaterThan(320 * 1.2);
  });
});
