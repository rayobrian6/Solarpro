// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE BOM'S 120% ALLOWANCE HAD NO BATTERY TERM.
//
// `lib/bom-engine-v4.ts` computed, in TWO duplicated blocks:
//
//     const maxPVBreaker = Math.floor(busRating * 1.2 - mainAmps);
//
// with no term for any other source on the busbar — while `batteryId` and `batteryCount`
// sat on the same input object, used only for a line quantity.
//
// NEC 705.12(B)(3)(2) is a SUM: every overcurrent device supplying the busbar other than
// the main must together stay inside 120% of the busbar rating. A battery branch therefore
// spends the allowance the PV breaker draws on. `lib/computed-system.ts` — the permit's
// engine — counts it. So the same permit package carried a stamped busbar verdict that
// INCLUDED the battery beside a BOM compliance note asserting an allowance the battery had
// already spent, and purchased a breaker sized for PV alone.
//
// The worked case: a 200 A bus with a 200 A main has 40 A of allowance. Two Enphase IQ
// Battery 10C units are an 80 A branch OCPD (DSH-00565-9.0 §OCPD). The battery alone
// exceeds the whole allowance — and the BOM still emitted a PV backfeed breaker and printed
// "120% rule: (200A × 1.2) − 200A = 40A max" as if the 40 A were available.
//
// 🚨 AND WHY IT COULD NOT SIMPLY SUBTRACT. `backfeedAmps` does not mean the same thing to
// every caller: `lib/permit/utils/bomForPermit.ts` passes the conductor authority's AC
// FEEDER OCPD (PV only), while `app/engineering/page.tsx`'s SLD payload sends
// `cs.backfeedBreakerAmps`, which `computed-system` sets from `totalBackfeedA` — PV PLUS
// storage. Subtracting the battery from the allowance while sizing against a figure that
// already includes it would double-count it: a needlessly small breaker and a violation
// warning on a compliant design.
//
// So the split is ASSERTED by the caller through `pvOnlyBackfeedA`, and when it is not
// established the resolver refuses to state a verdict rather than picking the reading that
// makes the design pass — the same discipline as `resolveInterconnectionMethod` answering
// 'unresolved' instead of fabricating a busbar rating.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { resolveLoadSideBackfeedBreaker } from '@/lib/nec/loadSideBackfeed';
import { maxLoadSideBackfeedA } from '@/lib/nec/rule705_12';
import { generateBOMV4, type BOMGenerationInputV4 } from '@/lib/bom-engine-v4';
import { resolveBatteryBranch } from '@/lib/equipment-db';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const BAT_10C = 'enphase-iq-battery-10c';

/** A minimal but real BOM input: 200 A bus, 200 A main — a 40 A allowance. */
function bomInput(over: Partial<BOMGenerationInputV4> = {}): BOMGenerationInputV4 {
  return {
    systemKw: 7.2,
    moduleCount: 18,
    panelId: 'qcells-peak-duo-400',
    inverterId: 'se-7600h',
    inverterType: 'string',
    mountType: 'roof',
    systemType: 'roof',
    interconnectionMethod: 'LOAD_SIDE',
    mainPanelAmps: 200,
    panelBusRating: 200,
    acVoltage: 240,
    ...over,
  } as never;
}

const breakerLine = (r: { items: Array<{ description?: string; model?: string }> }) =>
  r.items.find(i => (i.model || '').includes('Backfeed Breaker'));
const notes = (r: { complianceNotes?: string[] }) => (r.complianceNotes || []).join('\n');
const warns = (r: { warnings?: string[] }) => (r.warnings || []).join('\n');

// ── The resolver, directly ───────────────────────────────────────────────────
describe('🚨 the resolver counts every source on the busbar, not just PV', () => {
  it('PRECONDITION: the allowance comes from the ONE 705.12(B) implementation', () => {
    // If this file re-inlined (bus × 1.2) − main it would be a fifth copy of that
    // arithmetic. It imports rule705_12 instead, and this ties the two together.
    const r = resolveLoadSideBackfeedBreaker({
      busRatingA: 200, mainBreakerA: 100, requestedBreakerA: 40, pvFigureEstablished: true,
    });
    expect(r.busAllowanceA).toBe(maxLoadSideBackfeedA(200, 100));
    const src = read('lib', 'nec', 'loadSideBackfeed.ts');
    expect(src, 'the resolver re-inlines the 120% arithmetic instead of calling the authority')
      .not.toMatch(/\*\s*1\.2\s*\)?\s*-/);
  });

  it('with no other source it is unchanged — the allowance is the bus allowance', () => {
    const r = resolveLoadSideBackfeedBreaker({
      busRatingA: 200, mainBreakerA: 100, requestedBreakerA: 60, pvFigureEstablished: true,
    });
    expect(r.pvAllowanceA).toBe(140);
    expect(r.breakerA).toBe(60);
    expect(r.fits).toBe(true);
    expect(r.evaluated).toBe(true);
    expect(r.warning).toBeNull();
  });

  it('🚨 an 80 A battery branch takes the allowance out of the PV breaker', () => {
    // 240 − 100 = 140 gross; 140 − 80 = 60 left for PV. A 60 A request still fits; a 70 A
    // request does not, and under the old arithmetic BOTH passed against 140.
    const fits = resolveLoadSideBackfeedBreaker({
      busRatingA: 200, mainBreakerA: 100, requestedBreakerA: 60,
      pvFigureEstablished: true, otherSourceBackfeedA: 80, otherSourceBasis: '2 × IQ Battery 10C',
    });
    expect(fits.busAllowanceA).toBe(140);
    expect(fits.pvAllowanceA).toBe(60);
    expect(fits.fits).toBe(true);
    expect(fits.basis).toContain('80A non-PV backfeed');

    const over = resolveLoadSideBackfeedBreaker({
      busRatingA: 200, mainBreakerA: 100, requestedBreakerA: 70,
      pvFigureEstablished: true, otherSourceBackfeedA: 80, otherSourceBasis: '2 × IQ Battery 10C',
    });
    expect(over.fits, 'a 70A PV breaker on a 60A remainder still reads as compliant').toBe(false);
    expect(over.breakerA, 'the emitted breaker exceeds what is left').toBeLessThanOrEqual(60);
    expect(over.warning).toMatch(/705\.12\(B\) VIOLATION/);
  });

  it('🚨 the emitted rating is always a real NEC 240.6(A) size', () => {
    // 320 A bus / 200 A main = 184 A, which is not a breaker. The QO184 case.
    const r = resolveLoadSideBackfeedBreaker({
      busRatingA: 320, mainBreakerA: 200, requestedBreakerA: 200, pvFigureEstablished: true,
    });
    expect(r.busAllowanceA).toBe(184);
    expect([15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175],
      `QO${r.breakerA} is not a Square D rating`).toContain(r.breakerA);
    expect(r.breakerA).toBeLessThanOrEqual(184);
  });

  it('🚨 when the battery alone exceeds the allowance, it says NO standard size fits', () => {
    // 200/200 gives 40 A; an 80 A battery branch has already overrun it.
    const r = resolveLoadSideBackfeedBreaker({
      busRatingA: 200, mainBreakerA: 200, requestedBreakerA: 40,
      pvFigureEstablished: true, otherSourceBackfeedA: 80, otherSourceBasis: '2 × IQ Battery 10C',
    });
    expect(r.pvAllowanceA).toBe(-40);
    expect(r.fits).toBe(false);
    expect(r.noCompliantSize, 'a negative remainder still reads as a size that fits').toBe(true);
    expect(r.warning).toMatch(/NO standard NEC 240\.6\(A\) rating fits/);
  });

  it('🚨 an unstated PV split is NOT EVALUATED, not guessed either way', () => {
    const r = resolveLoadSideBackfeedBreaker({
      busRatingA: 200, mainBreakerA: 100, requestedBreakerA: 60,
      pvFigureEstablished: false, otherSourceBackfeedA: 80, otherSourceBasis: '2 × IQ Battery 10C',
    });
    expect(r.evaluated, 'a verdict was stated from a figure whose meaning is unknown').toBe(false);
    expect(r.pvAllowanceA).toBeNull();
    expect(r.fits).toBeNull();
    expect(r.basis).toMatch(/NOT EVALUATED/);
    // The breaker is still sized, so the BOM remains orderable.
    expect(r.breakerA).toBe(60);
    expect(r.warning).toMatch(/NOT CERTIFIED|NOT EVALUATED/i);
  });

  it('with no other source, an unstated split is harmless and still evaluated', () => {
    // Nothing to double-count, so the ambiguity does not matter. Not refusing here is what
    // keeps every non-battery design working exactly as before.
    const r = resolveLoadSideBackfeedBreaker({
      busRatingA: 200, mainBreakerA: 100, requestedBreakerA: 60, pvFigureEstablished: false,
    });
    expect(r.evaluated).toBe(true);
    expect(r.pvAllowanceA).toBe(140);
  });
});

// ── Through the real BOM engine ──────────────────────────────────────────────
describe('🚨 the BOM the installer buys from', () => {
  it('PRECONDITION: 2 × 10C really is an 80 A branch, from the equipment authority', () => {
    const b = resolveBatteryBranch(BAT_10C, 2);
    expect(b.resolved).toBe(true);
    expect(b.busbarContributionA).toBe(80);
  });

  it('a no-battery design is unchanged: 40 A allowance, compliant 40 A breaker', () => {
    const r = generateBOMV4(bomInput({ pvOnlyBackfeedA: 40, backfeedAmps: 40 }));
    const line = breakerLine(r as never);
    expect(line, 'no backfeed breaker line was emitted').toBeTruthy();
    expect(line!.model).toBe('40A Backfeed Breaker');
    expect(notes(r as never)).toContain('40A available to the PV breaker');
    expect(warns(r as never)).not.toMatch(/705\.12\(B\) VIOLATION/);
  });

  it('🚨 with a battery, the BOM stops certifying an allowance the battery already spent', () => {
    const r = generateBOMV4(bomInput({
      pvOnlyBackfeedA: 40, backfeedAmps: 40, batteryId: BAT_10C, batteryCount: 2,
    }));
    // The battery branch is counted, by name, from the authority.
    expect(notes(r as never), 'the note still asserts the gross allowance')
      .toMatch(/80A non-PV backfeed/);
    expect(notes(r as never)).toContain(BAT_10C);
    // 40 gross − 80 battery = −40: there is no compliant load-side breaker at all.
    expect(warns(r as never), 'the BOM still reads as 705.12(B) compliant on this design')
      .toMatch(/705\.12\(B\) VIOLATION/);
    expect(warns(r as never)).toMatch(/NO standard NEC 240\.6\(A\) rating fits/);
  });

  it('🚨 a battery job whose PV split is unstated is sized but NOT certified', () => {
    // `backfeedAmps` alone, which is exactly what the ambiguous callers send.
    const r = generateBOMV4(bomInput({ backfeedAmps: 40, batteryId: BAT_10C, batteryCount: 2 }));
    expect(notes(r as never)).toMatch(/NOT EVALUATED/);
    expect(notes(r as never), 'a 120% conclusion is still printed from an unknown figure')
      .not.toMatch(/available to the PV breaker/);
    expect(warns(r as never)).toMatch(/NOT EVALUATED|NOT certified/i);
    // Still orderable — refusing to certify must not remove the part.
    expect(breakerLine(r as never), 'the breaker line disappeared').toBeTruthy();
  });

  it('a larger service with a battery still passes when there is genuinely room', () => {
    // 400 A bus / 200 A main = 280 gross; − 80 battery = 200 available; 100 A PV fits.
    const r = generateBOMV4(bomInput({
      mainPanelAmps: 200, panelBusRating: 400, systemKw: 19.2, moduleCount: 48,
      pvOnlyBackfeedA: 100, backfeedAmps: 100, batteryId: BAT_10C, batteryCount: 2,
    }));
    expect(notes(r as never)).toContain('200A available to the PV breaker');
    expect(warns(r as never)).not.toMatch(/705\.12\(B\) VIOLATION/);
    expect(breakerLine(r as never)!.model).toBe('100A Backfeed Breaker');
  });

  it('an UNRESOLVED battery contributes nothing and is reported, not assumed', () => {
    // No contribution is invented from a battery the catalogue does not know — the design
    // is blocked by `interconnectionUnresolved` in computed-system instead.
    const r = generateBOMV4(bomInput({
      pvOnlyBackfeedA: 40, backfeedAmps: 40, batteryId: 'battery-that-is-not-real', batteryCount: 2,
    }));
    expect(notes(r as never)).not.toMatch(/non-PV backfeed/);
    expect(notes(r as never)).toContain('40A available to the PV breaker');
  });
});

describe('🚨 both duplicated blocks were fixed, not just the first', () => {
  it('neither 120% block still computes its own allowance', () => {
    // The finding was explicit that the logic exists twice (the legacy single-system path
    // and the per-sub aggregate path). Fixing one and leaving the other is the exact shape
    // of the grounding-electrode defect earlier in this campaign.
    const src = read('lib', 'bom-engine-v4.ts');
    expect(src, 'a 120% block still computes floor(bus × 1.2 − main) locally')
      .not.toMatch(/Math\.floor\(\s*busRating\s*\*\s*1\.2\s*-\s*mainAmps\s*\)/);
    const calls = src.match(/resolveLoadSideBackfeedBreaker\(/g) || [];
    expect(calls.length, 'the resolver is not called from both load-side blocks').toBe(2);
  });

  it('every BOM caller that knows its PV figure now says so', () => {
    for (const f of [
      ['lib', 'permit', 'utils', 'bomForPermit.ts'],
      ['app', 'api', 'engineering', 'preliminary', 'route.ts'],
      ['app', 'api', 'engineering', 'bom', 'route.ts'],
      ['app', 'engineering', 'page.tsx'],
    ]) {
      expect(read(...f), `${f.join('/')} does not pass pvOnlyBackfeedA`)
        .toMatch(/pvOnlyBackfeedA/);
    }
  });
});
