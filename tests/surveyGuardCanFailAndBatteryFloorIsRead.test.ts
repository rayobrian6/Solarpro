// ═══════════════════════════════════════════════════════════════════════════
// THE LAST TWO AVAILABLE ENGINEERING FINDINGS
//
// 1. 🚨 A GUARD THAT COULD NOT FAIL, PRESENTED AS "high confidence, source: nec".
//    `lib/survey/prefillComputations.ts` computeInterconnection fabricated the solar
//    breaker when the caller supplied none:
//        const computedSolarBreaker = solarBreaker || Math.ceil(busRating * 0.2);
//        const maxAllowed = busRating * 1.2 - mainBreaker;
//        if (computedSolarBreaker <= maxAllowed) → 'high' / 'nec'
//    and `components/survey/StepElectrical.tsx` supplied none, while ALSO doing
//        const mainBreaker = busRating;   // "typically same as panel rating"
//
//    With main === bus those two expressions are THE SAME NUMBER — 40 A on a 200 A
//    service — so the test was `0.2B <= 0.2B`, true by construction. And since a main
//    breaker never exceeds its busbar in practice, `maxAllowed` is only ever larger. The
//    check passed for EVERY surveyed panel, and the derivation quoted real-looking
//    arithmetic where the "need" had been manufactured to match the limit.
//
//    It matters because the chip this produces is what the surveyor accepts, and
//    `lib/engineering/reportGenerator.ts` and `lib/system/electricalFromSurvey.ts` then
//    treat `interconnection_point` as INSPECTOR-CAPTURED GROUND TRUTH, ahead of their own
//    checks. A guard that cannot fail is worse than no guard, because three downstream
//    consumers trust it more than their own arithmetic.
//
// 2. 🚨 THE BATTERY BRANCH AUTHORITY PUBLISHED A CONDUCTOR FLOOR AND NOTHING READ IT.
//    `resolveBatteryBranch` returns the manufacturer's `minConductorAwg` — '#4 AWG' for
//    an 80 A branch — and a repo-wide search found no consumer outside equipment-db
//    itself. `lib/computed-system.ts`'s BATTERY_TO_BUI_RUN sized independently and
//    printed #8 AWG on an 80 A OCPD: a permit-grade conductor schedule, conduit schedule
//    and BOM footage for a conductor that would fail plan review against the datasheet
//    and, if built as drawn, is protected 30 A ABOVE its ampacity.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { computeInterconnection } from '@/lib/survey/prefillComputations';
import { buildInitialDraft } from '@/lib/survey/v2/defaults';
import { maxLoadSideBackfeedA } from '@/lib/nec/rule705_12';
import { computeSystem } from '@/lib/computed-system';
import { resolveBatteryBranch, BATTERIES, getBatteryById } from '@/lib/equipment-db';
import { AWG_ORDER } from '@/lib/manufacturer-specs';
import { calcBatteryBackfeedAmps } from '@/lib/engineering-helpers';
import { csStringInput } from './goldens/wave0-fixtures';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

describe('🚨 the survey 705.12 recommendation can now fail', () => {
  it('the tautology was real: ceil(B × 0.2) IS (B × 1.2 − M) when M === B', () => {
    // The arithmetic identity that made the old guard unfalsifiable, asserted directly so
    // the finding is not taken on trust.
    for (const bus of [100, 125, 150, 200, 225, 400]) {
      expect(Math.ceil(bus * 0.2), `${bus}A bus`).toBe(maxLoadSideBackfeedA(bus, bus));
    }
  });

  it('🚨 without a real solar breaker it reports LOW confidence, not a code conclusion', () => {
    // This is the call StepElectrical actually makes.
    const r = computeInterconnection({ busRating: 200, mainBreaker: 200, availableSlots: 4 });
    expect(r.confidence, 'a fabricated breaker is still being passed off as high confidence').toBe('low');
    expect(r.source, "the NEC is still being cited for a check that was not performed").toBe('ecosystem');
    expect(r.derivation).toMatch(/NOT evaluated/i);
    // It may still SUGGEST load side — that is a prior, not a verdict.
    expect(r.method).toBe('LOAD_SIDE');
  });

  it('with a real breaker that fits, it genuinely passes and says so', () => {
    const r = computeInterconnection({ busRating: 200, mainBreaker: 100, solarBreaker: 60, availableSlots: 4 });
    expect(r.confidence).toBe('high');
    expect(r.source).toBe('nec');
    expect(r.derivation).toMatch(/120% rule passes/);
    expect(r.derivation).toContain('140A max solar');   // 200×1.2 − 100
  });

  it('🚨 and with a real breaker that does NOT fit, it does not say load side passes', () => {
    // The case the old code could never reach: a 200 A bus with a 200 A main allows 40 A,
    // and a 60 A solar breaker does not fit. Under the fabrication this was the SAME
    // input that returned "high confidence, source: nec, 120% rule passes".
    const r = computeInterconnection({ busRating: 200, mainBreaker: 200, solarBreaker: 60, availableSlots: 4 });
    expect(r.derivation, 'a 60A breaker on a 40A allowance still reports the 120% rule passing')
      .not.toMatch(/120% rule passes/);
  });

  it('no available breaker slots is still respected', () => {
    const r = computeInterconnection({ busRating: 200, mainBreaker: 100, solarBreaker: 40, availableSlots: 0 });
    expect(r.derivation).not.toMatch(/120% rule passes/);
  });

  it('the no-panel-data branch is still honest, and now names WHICH input is missing', () => {
    const none = computeInterconnection({});
    expect(none.confidence).toBe('low');
    expect(none.source).toBe('ecosystem');
    expect(none.derivation).toMatch(/No panel data available/);
    // The state the survey UI now actually produces: busbar known, main breaker not.
    const noMain = computeInterconnection({ busRating: 200, availableSlots: 4 });
    expect(noMain.confidence).toBe('low');
    expect(noMain.derivation, 'a known 200A busbar is reported as "no panel data"')
      .toMatch(/Main breaker rating not recorded/);
    expect(noMain.derivation).toMatch(/NOT evaluated/i);
  });

  it('🚨 the survey step no longer fabricates one panel number from the other', () => {
    // The component is the caller that made the tautology reachable in production:
    //     const mainBreaker = busRating;   // "typically same as panel rating"
    // A behavioural assertion is not available without rendering the step, so this is a
    // source assertion — comments stripped, so the quoted defect in the explanatory
    // comment above the fix cannot satisfy it.
    const src = read('components', 'survey', 'StepElectrical.tsx');
    expect(src, 'StepElectrical still assumes the main breaker equals the busbar rating')
      .not.toMatch(/const\s+mainBreaker\s*(:[^=]*)?=\s*busRating\s*;/);
    // It must read the recorded busbar instead — and recompute when it changes. A memo
    // frozen on the old dependency list would read the new field and never see it change.
    expect(src, 'the busbar rating is not read from the survey record').toMatch(/data\.busbarRating/);
    expect(src, 'the interconnection memo does not depend on the busbar rating')
      .toMatch(/\[\s*data\.panelRating\s*,\s*data\.busbarRating\s*,\s*data\.availableBreakerSlots\s*\]/);
    // And the surveyor must be able to record it — a field read from a schema that has no
    // input for it is permanently undefined, which is a dead read, not a fix.
    expect(src, 'there is no busbar rating input to record').toMatch(/Busbar Rating \(Amps\)/);
  });

  it('🚨 the busbar rating is a real survey field, and blank means NOT RECORDED', () => {
    const types = read('lib', 'survey', 'v2', 'types.ts');
    expect(types, 'SurveyElectricalService has no busbarRating field')
      .toMatch(/busbarRating\s*:\s*PanelRating\s*;/);
    // A blank default, not a copy of the main rating: the whole defect was substituting one
    // for the other.
    const defaults = read('lib', 'survey', 'v2', 'defaults.ts');
    expect(defaults).toMatch(/busbarRating\s*:\s*''/);
    expect(buildInitialDraft({ project_id: 'p-1' } as never).electricalService.busbarRating,
      'a new survey starts with the busbar rating already assumed').toBe('');
  });

  it('🚨 the recorded busbar reaches the normalized survey, instead of the main-as-proxy', () => {
    // The readiness mapper is what turns survey v2 into the normalized model the engines
    // read. Until it knew this field, every v2 survey fell through to normalizeSurvey's
    // substitution of the main rating — the 0.2 × main collapse.
    const mapper = read('lib', 'siteSurvey', 'professionalSurveyReadinessReport.ts');
    expect(mapper, 'the readiness mapper still cannot see a recorded busbar rating')
      .toMatch(/electricalService\.busbarRating\b/);
    // And the proxy, when it is still used, must disclose what it costs. `PROXY` is
    // asserted on the STRIPPED source because it has to be in the runtime log string, not
    // only in a comment; the inverted "busbar ≤ main panel" claim is asserted on the RAW
    // source because it lived in a comment, which stripping would remove and so would make
    // that assertion pass no matter what the file says.
    expect(read('lib', 'siteSurvey', 'normalizeSurvey.ts'),
      'the busbar-for-main substitution is silent at runtime').toMatch(/PROXY/);
    expect(readFileSync(join(ROOT, 'lib', 'siteSurvey', 'normalizeSurvey.ts'), 'utf8'),
      'the inverted "busbar ≤ main panel" claim is still here')
      .not.toMatch(/busbar\s*[≤<]=?\s*main panel/i);
  });
});

// The Enphase IQ Battery 10C: 40 A / #8 AWG for one unit, 80 A / #4 AWG for two or
// more (DSH-00565-9.0 §OCPD), with a 29.5 A single-unit continuous output. Two units is
// therefore the exact case the finding describes — a 29.5 A ampacity calculation under
// an 80 A breaker whose datasheet minimum is #4.
const BAT_10C = 'enphase-iq-battery-10c';

/** Drive the REAL engine the way app/engineering/page.tsx:3261 drives it. */
function csWithBattery(batteryId: string, count: number) {
  const b = getBatteryById(batteryId);
  return computeSystem({
    ...csStringInput(),
    batteryIds: Array.from({ length: count }, () => batteryId),
    batteryCount: count,
    batteryBackfeedA: calcBatteryBackfeedAmps(batteryId, count),
    batteryContinuousOutputA: b?.maxContinuousOutputA ?? 0,
    interconnectionMethod: 'LOAD_SIDE',
    panelBusRating: 400,
    mainPanelAmps: 200,
  } as never);
}

const batRun = (cs: { runs: Array<{ id: string }> }) =>
  cs.runs.find(r => r.id === 'BATTERY_TO_BUI_RUN') as
    | { id: string; wireGauge: string; ocpdAmps: number }
    | undefined;

describe('🚨 the battery datasheet conductor minimum is read', () => {
  /** Catalogue batteries whose branch resolution publishes a conductor floor. */
  const WITH_FLOOR = BATTERIES
    .map(b => ({ b, r: resolveBatteryBranch(b.id, 2) }))
    .filter(x => x.r.resolved && x.r.minConductorAwg);

  it('PRECONDITION: the catalogue publishes a floor, and it is a conductor the ladder knows', () => {
    // Without this the cases below could pass vacuously — the exact shape that has
    // produced blind guards throughout this campaign. A floor the ladder cannot locate
    // would be read, compared against -1, and silently skipped.
    expect(WITH_FLOOR.length, 'no battery publishes minConductorAwg — nothing to enforce')
      .toBeGreaterThan(0);
    for (const { b, r } of WITH_FLOOR) {
      expect(AWG_ORDER, `${b.id} publishes ${r.minConductorAwg}, which is not in AWG_ORDER`)
        .toContain(r.minConductorAwg!);
    }
  });

  it('PRECONDITION: 2 × 10C is the 80 A / #4 AWG step, and #4 is LARGER than #8', () => {
    const r = resolveBatteryBranch(BAT_10C, 2);
    expect(r.resolved).toBe(true);
    expect(r.branchOcpdA).toBe(80);
    expect(r.minConductorAwg).toBe('#4 AWG');
    // #8 THWN-2 is 50 A at 75 °C — 30 A below the breaker protecting it.
    expect(AWG_ORDER.indexOf('#4 AWG')).toBeGreaterThan(AWG_ORDER.indexOf('#8 AWG'));
    expect(getBatteryById(BAT_10C)?.maxContinuousOutputA).toBe(29.5);
  });

  it('🚨 the BATTERY_TO_BUI_RUN conductor is not smaller than the datasheet minimum', () => {
    const cs = csWithBattery(BAT_10C, 2);
    const run = batRun(cs as never);
    expect(run, 'no BATTERY_TO_BUI_RUN segment was produced — the case is not being exercised')
      .toBeTruthy();
    expect(run!.ocpdAmps, 'the branch OCPD is not the 80 A step').toBe(80);
    expect(
      AWG_ORDER.indexOf(run!.wireGauge),
      `the permit prints ${run!.wireGauge} on an ${run!.ocpdAmps}A breaker; the datasheet minimum is #4 AWG`,
    ).toBeGreaterThanOrEqual(AWG_ORDER.indexOf('#4 AWG'));
  });

  it('🚨 and it says so — the raise is disclosed, not silent', () => {
    const cs = csWithBattery(BAT_10C, 2);
    const issue = (cs as { issues: Array<{ code: string; message: string; autoFixed?: boolean }> })
      .issues.find(i => i.code === 'BATTERY_CONDUCTOR_RAISED_TO_DATASHEET_MINIMUM');
    expect(issue, 'the conductor changed with no record of why').toBeTruthy();
    expect(issue!.message).toContain('#4 AWG');
    expect(issue!.autoFixed).toBe(true);
  });

  it('🚨 the raise reaches the conduit schedule, not just the segment', () => {
    // The conduit row's conductor text is built from run.wireGauge, so this is the
    // downstream artefact that would otherwise print the undersized conductor.
    const cs = csWithBattery(BAT_10C, 2) as { conduitSchedule: Array<{ from: string; to: string; conductors: string }> };
    const row = cs.conduitSchedule.find(r => r.from === 'BATTERY STORAGE');
    expect(row, 'the battery run has no conduit row').toBeTruthy();
    expect(row!.conductors, `conduit schedule prints "${row!.conductors}"`).toContain('#4 AWG');
  });

  it('it is a FLOOR, not a replacement — a larger ampacity answer still wins', () => {
    // One 10C is the 40 A / #8 step. A 300 ft run at 29.5 A needs far more than #8 for
    // voltage drop, and the floor must not pull it back down.
    const one = computeSystem({
      ...csStringInput(),
      batteryIds: [BAT_10C], batteryCount: 1,
      batteryBackfeedA: calcBatteryBackfeedAmps(BAT_10C, 1),
      batteryContinuousOutputA: 29.5,
      runLengthsBatteryGen: { batteryToBui: 300 },
      interconnectionMethod: 'LOAD_SIDE', panelBusRating: 400, mainPanelAmps: 200,
    } as never);
    const run = batRun(one as never);
    expect(resolveBatteryBranch(BAT_10C, 1).minConductorAwg).toBe('#8 AWG');
    expect(
      AWG_ORDER.indexOf(run!.wireGauge),
      `a 300 ft run was pulled back to the datasheet minimum ${run!.wireGauge}`,
    ).toBeGreaterThan(AWG_ORDER.indexOf('#8 AWG'));
  });

  it('an UNRESOLVED battery publishes no floor, and is blocked elsewhere', () => {
    // The refusal case: no floor is invented from a battery that did not resolve. The
    // design is stopped by interconnectionUnresolved instead — see
    // tests/unresolvedBatteryCannotClearThe120Rule.test.ts.
    const ghost = resolveBatteryBranch('battery-that-is-not-in-the-catalogue', 1);
    expect(ghost.resolved).toBe(false);
    expect(ghost.minConductorAwg ?? null).toBeNull();
  });
});
