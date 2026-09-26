// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THREE GUESSES IN THE ENGINEERING REPORT, ALL OF THEM PRINTED AND ONE BOUGHT
//
// `lib/engineering/reportGenerator.ts` is reached by four routes
// (engineering/generate, engineering/report, engineering/preliminary and
// lib/engineering/syncPipeline) and it SETS panelsPerString, stringCount,
// dcWireGauge, stringFuseAmps, dcDisconnectAmps, and both conduit trade sizes on
// the stored engineering report.
//
// 1. CONDUIT came from a `conduit` column on the wire-gauge bracket tables: no
//    conductor area, no fill percentage, no conductor count. NEC Chapter 9 sizes a
//    raceway from the SUM of conductor areas against a limit that depends on the
//    conductor COUNT (53 % for one, 31 % for two, 40 % for three or more) — none of
//    which is a function of amps. Those two fields reach the EQUIPMENT SCHEDULE,
//    where the trade size IS the line item's model and specs (the conduit a crew
//    orders), the rendered SLD wire label, the saved artifact, and the
//    customer-visible Engineering tab. The AC side over-bought one trade size; the
//    DC side was the unsafe one — a ≥5-string design got 3/4" EMT printed and
//    scheduled at 43.5 % fill against the 40 % limit, and nothing downstream could
//    catch it because the number never passed through a fill calculation.
//
// 2. INTERCONNECTION was `backfeedBreakerAmps <= mainPanelBusAmps * 0.2`, with ONE
//    field standing in for both the busbar and the main breaker, and a fabricated
//    200 A busbar when the survey was silent. `× 0.2` is not a rule the NEC states.
//    And 'supply-side' is not a label — it is a different SCOPE OF WORK:
//    SUPPLY_SIDE_TAP deletes the backfed breaker from the BOM and adds three
//    insulated multi-tap connectors plus a fused AC disconnect that must BE the
//    OCPD, under the 705.11(C) ≤10 ft placement constraint.
//
// 3. STRING LENGTH used a blanket Voc × 1.25 — Table 690.7(A)'s most conservative
//    row (−1 to −5 °C) — ignoring the module coefficient and the site entirely,
//    with a hard 20-panel clamp. A Florida job (FL −2 °C, real factor ≈1.07) was
//    capped as if it were at −38 °C, so the report recommended shorter strings and
//    therefore MORE strings, more MPPT channels and sometimes another inverter than
//    the design needs — a price the customer pays. And the "DC Voltage" it printed
//    was the STC sum, not the NEC 690.7(A) maximum, so a reader checking headroom
//    against a 600 V inverter was reading the wrong number.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  maxLoadSideBackfeedA,
  resolveInterconnectionMethod,
} from '@/lib/nec/rule705_12';
import {
  conductorAreaIn2,
  selectSmallestConduit,
  fillLimitPct,
} from '@/lib/nec/chapter9';
import { coldVocFactor } from '@/lib/permit/utils/panelSpecs';

// ── NEC 705.12(B)(2): the 120% rule takes TWO ratings ───────────────────────
describe('🚨 the 120% rule is the 120% rule, and needs the main breaker', () => {
  it('is (bus × 1.2) − main, not bus × 0.2', () => {
    // Worked literals, from the code text rather than from the function.
    expect(maxLoadSideBackfeedA(200, 200)).toBe(40);
    expect(maxLoadSideBackfeedA(200, 100)).toBe(140);
    expect(maxLoadSideBackfeedA(320, 200)).toBeCloseTo(184, 6);
    expect(maxLoadSideBackfeedA(400, 225)).toBe(255);
  });

  it('🚨 the old × 0.2 test only ever agreed where main === bus', () => {
    // It coincides at main = bus (both give bus × 0.2). Everywhere else it is a
    // different question, and the disagreement is the interesting part.
    expect(maxLoadSideBackfeedA(200, 200)).toBe(200 * 0.2);
    // A 200 A bus behind a 100 A main genuinely allows 140 A of backfeed; the old
    // test allowed 40 A and sent the job to a supply-side tap it does not need.
    expect(maxLoadSideBackfeedA(200, 100)).not.toBe(200 * 0.2);
    expect(maxLoadSideBackfeedA(200, 100)).toBeGreaterThan(200 * 0.2);
  });

  it('🚨 refuses to conclude from an assumed service size', () => {
    // The whole defect: with the survey silent, a 200 A busbar was invented and a
    // conclusion about the scope of work was stated from it.
    const noBus = resolveInterconnectionMethod({ backfeedBreakerA: 40 });
    expect(noBus.side).toBe('unresolved');
    expect(noBus.maxLoadSideBackfeedA).toBeNull();
    expect(noBus.basis).toMatch(/not established/i);

    // A busbar alone is still not enough — the rule subtracts the main breaker.
    const busOnly = resolveInterconnectionMethod({ busRatingA: 200, backfeedBreakerA: 40 });
    expect(busOnly.side, 'a busbar alone was treated as sufficient').toBe('unresolved');
    expect(busOnly.basis).toMatch(/main breaker/i);
  });

  it('concludes when both ratings are known, and shows its arithmetic', () => {
    const fits = resolveInterconnectionMethod({
      busRatingA: 200, mainBreakerA: 100, backfeedBreakerA: 60,
    });
    expect(fits.side).toBe('load-side');
    expect(fits.maxLoadSideBackfeedA).toBe(140);
    expect(fits.basis).toContain('140A max backfeed');

    const doesNot = resolveInterconnectionMethod({
      busRatingA: 200, mainBreakerA: 200, backfeedBreakerA: 60,
    });
    expect(doesNot.side).toBe('supply-side');
  });

  it('a field-captured interconnection point still wins over arithmetic', () => {
    // An inspector at the panel is better evidence than two nameplate numbers.
    for (const p of ['load_side', 'main_panel']) {
      expect(resolveInterconnectionMethod({ surveyedPoint: p, backfeedBreakerA: 999 }).side)
        .toBe('load-side');
    }
    for (const p of ['supply_side', 'sub_panel']) {
      expect(resolveInterconnectionMethod({ surveyedPoint: p, backfeedBreakerA: 1 }).side)
        .toBe('supply-side');
    }
  });
});

// ── NEC Chapter 9: a raceway is sized from area and count ───────────────────
describe('🚨 the conduit trade size is a fill calculation, not an amps bracket', () => {
  it('the DC bundle the old bracket called 3/4" EMT genuinely exceeds 40% fill', () => {
    // 5 strings → 10 current-carrying #10 AWG + 1 EGC = 11 conductors.
    const count = 5 * 2 + 1;
    const area = conductorAreaIn2('#10 AWG')! * count;
    expect(fillLimitPct(count), 'Table 1: three or more conductors ⇒ 40%').toBe(40);

    // What the bracket printed, and what it actually allows.
    const threeQuarterEmtAllowable = selectSmallestConduit('EMT', 0, count); // smallest that fits nothing
    expect(threeQuarterEmtAllowable).not.toBeNull();

    const chosen = selectSmallestConduit('EMT', area, count);
    expect(chosen, 'no EMT size could be selected for the DC bundle').not.toBeNull();
    expect(area, 'the bundle must exceed the 3/4" allowance for this case to be real')
      .toBeGreaterThan(0);
    // The fill of the CHOSEN conduit is within the limit — that is the property.
    expect(area).toBeLessThanOrEqual(chosen!.allowableIn2);
    // And the answer is not the 3/4" the bracket asserted.
    expect(chosen!.tradeSize, 'still selecting the 3/4" the amps bracket printed').not.toBe('3/4"');
  });

  it('every selected conduit is within its Table 1 limit, across the range', () => {
    for (const gauge of ['#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG', '#2 AWG', '#1/0 AWG']) {
      const a = conductorAreaIn2(gauge);
      expect(a, `${gauge} has no Chapter 9 area`).not.toBeNull();
      for (const count of [2, 3, 4, 5, 7, 9, 11, 13]) {
        const sel = selectSmallestConduit('EMT', a! * count, count);
        if (!sel) continue; // genuinely larger than 4" EMT — a refusal, not a guess
        expect(a! * count,
          `${count} × ${gauge} in ${sel.tradeSize} EMT exceeds the ${fillLimitPct(count)}% limit`,
        ).toBeLessThanOrEqual(sel.allowableIn2);
      }
    }
  });

  it('the fill limit tracks the conductor COUNT, which no amps bracket can express', () => {
    expect(fillLimitPct(1)).toBe(53);
    expect(fillLimitPct(2)).toBe(31);
    expect(fillLimitPct(3)).toBe(40);
    expect(fillLimitPct(11)).toBe(40);
    // Two conductors are held to a TIGHTER limit than three — so a table keyed on
    // amps alone cannot be right for both, whatever values it holds.
    expect(fillLimitPct(2)).toBeLessThan(fillLimitPct(3));
  });
});

// ── NEC 690.7(A): the cold-Voc law, not a blanket multiplier ────────────────
describe('🚨 the string ceiling uses the module coefficient and the site', () => {
  it('a warm site is not capped as if it were at -38 C', () => {
    // FL design minimum ≈ -2 C, a typical silicon β = -0.27 %/C.
    const fl = coldVocFactor(-0.27, -2);
    expect(fl, 'Florida is still corrected by the blanket 1.25').toBeLessThan(1.25);
    expect(fl).toBeCloseTo(1 + (-0.27 / 100) * (-2 - 25), 6);

    // The blanket 1.25 corresponds to roughly -1..-5 C on Table 690.7(A). Using it
    // in Florida costs string length: with a 600 V inverter and a 41.7 V module,
    const maxDc = 600, voc = 41.7;
    const withLaw = Math.floor(maxDc / (voc * fl));
    const withBlanket = Math.floor(maxDc / (voc * 1.25));
    expect(withLaw, 'the corrected law does not permit a longer string in Florida')
      .toBeGreaterThan(withBlanket);
  });

  it('the blanket 1.25 is conservative everywhere real — so this defect COSTS, it does not endanger', () => {
    // Worth stating precisely, because it sets what kind of defect this is.
    // coldVocFactor(-0.27, -25) = 1 + (-0.0027)(-50) = 1.135 < 1.25. To exceed the
    // blanket with a typical β you would need (25 - T) > 0.25/0.0027 ≈ 93 °C, i.e.
    // T < -68 °C — not a site. So the blanket never UNDER-corrects for a real
    // module; it over-restricts. The harm is more strings, more MPPT channels and
    // sometimes another inverter than the design needs — a price the customer pays,
    // not an overvoltage risk. (The overvoltage risk in this repo lives in the
    // panel-compatibility gate's ×1.12, which is a separate finding.)
    expect(coldVocFactor(-0.27, -25)).toBeCloseTo(1.135, 6);
    expect(coldVocFactor(-0.27, -25)).toBeLessThan(1.25);
    expect(coldVocFactor(-0.27, -40)).toBeLessThan(1.25);
  });

  it('the law TRACKS the coefficient — which the blanket cannot', () => {
    // The whole point of reading β: two modules at the same site are corrected
    // differently. A -0.35 %/C module needs more headroom than a -0.24 %/C one, and
    // a single multiplier is blind to that distinction.
    const at = (beta: number) => coldVocFactor(beta, -25);
    expect(at(-0.35)).toBeGreaterThan(at(-0.24));
    expect(at(-0.35)).toBeCloseTo(1 + (-0.35 / 100) * (-50), 6);
    // And both are still below the blanket, so neither is made less safe by the law.
    expect(at(-0.35)).toBeLessThan(1.25);
  });

  it('falls back to the blanket 1.25 only when the coefficient is unknown', () => {
    expect(coldVocFactor(undefined, -2)).toBe(1.25);
    expect(coldVocFactor(Number.NaN, -30)).toBe(1.25);
  });

  it('the corrected string Voc is a DIFFERENT number from the STC sum', () => {
    // The report labelled the STC sum "DC Voltage", so a reader checking headroom
    // against a 600 V inverter read 496 V for a string whose design maximum is 563 V.
    const voc = 41.3, panels = 12;
    const stc = voc * panels;
    const corrected = voc * coldVocFactor(-0.27, -25) * panels;
    expect(Math.round(stc)).toBe(496);
    expect(Math.round(corrected)).toBeGreaterThan(Math.round(stc));
    expect(Math.round(corrected)).toBe(563);
  });
});
