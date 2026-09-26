// ═══════════════════════════════════════════════════════════════════════════
// TWO DEFECTS IN THE ONE CONDUCTOR SELECTOR THAT SHIPS.
//
// `lib/segment-schedule.ts` is the selector whose answer survives: computed-system
// back-populates `conductorBundle`, `conductorCallout`, `wireGauge`, `conduitSize`,
// `voltageDropPct` and `overallPass` from its rows onto every RunSegment, and the
// BOM, the SLD and the stamped sheets all read RunSegment. So whatever this file
// decides is what gets ordered and what gets printed.
//
// V1 — IT HAD NO DC VOLTAGE AT ALL. `SegmentScheduleInput` carried only
//      `systemVoltageAC`, so a DC string's voltage drop was expressed as a
//      percentage of 240 V — the AC service voltage — and that number then
//      overwrote the correct string-Vmp percentage.
//
// V2 — IT NEVER CHECKED VOLTAGE DROP. `autoSizeGauge` accepted the first gauge
//      clearing 125 % of the continuous current. `computed-system.autoSizeWire`
//      gates on `ampacityPass && vdropPass` — but its answer is the one that gets
//      thrown away.
//
// ── WHY THESE ASSERTIONS DISCRIMINATE ─────────────────────────────────────
// Every number below is a hand-computed worked case with a named gauge, not a
// restatement of the implementation. Voltage drop here is
// VD = I × 12.9 × L × 2 / cmil (NEC Chapter 9 Table 8 circular mils), and the
// ampacity chain is NEC 310.16 × 310.15(B)(1) × 310.15(C)(1) capped at 110.14(C).
// The two numbers that matter are the ones that differ BY A GAUGE: #8 vs #6 on the
// AC feeder, and 3.73 % vs 1.44 % on the DC string. A test that only re-read the
// code could not tell those apart.
//
// ── RED-PROOF ─────────────────────────────────────────────────────────────
// Proven red by restoring the ORIGINAL BYTES of lib/segment-schedule.ts
// (`git checkout HEAD -- lib/segment-schedule.ts`), never by re-typing an
// "equivalent" mutation. See the report for the captured output.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  autoSizeGauge,
  buildSegmentSchedule,
  type SegmentScheduleInput,
  type SegmentScheduleRow,
} from '../lib/segment-schedule';
import {
  gradeVoltageDropPolicy,
  vdLimitPctForSegment,
  classifyVdRole,
  ROUTE_VD_LIMIT_PCT,
} from '../lib/electrical/routeLengthBound';
import { circularMils } from '../lib/nec/table8';

/** The formula under test, written out independently of the implementation. */
const vdPct = (amps: number, ft: number, cmil: number, volts: number) =>
  ((amps * 12.9 * ft * 2) / cmil / volts) * 100;

// ── The worked DC case ───────────────────────────────────────────────────────
// A 200 ft #10 AWG PV source circuit at 18 A on a 620 V string.
const DC_AMPS = 18;
const DC_FT = 200;
const STRING_VMP = 620;

// ── The worked AC case ───────────────────────────────────────────────────────
// A 120 ft AC feeder at 32 A, 240 V, against the 2 % design target.
const AC_AMPS = 32;
const AC_FT = 120;
const AC_VOLTS = 240;
const AC_TARGET_PCT = 2;

function stringInput(over: Partial<SegmentScheduleInput> = {}): SegmentScheduleInput {
  return {
    topology: 'string',
    moduleCount: 20,
    maxDevicesPerBranch: 13,
    microAcCurrentA: 0,
    stringCount: 1,
    stringCurrentA: DC_AMPS,
    systemVoltageAC: AC_VOLTS,
    systemVoltageDC: STRING_VMP,
    acOutputCurrentA: AC_AMPS,
    mainPanelAmps: 200,
    feederGauge: '#10 AWG',
    egcGauge: '#10 AWG',
    conduitType: 'EMT',
    runLengths: {
      arrayToJbox: DC_FT,
      jboxToCombiner: 10,
      jboxToInverter: 10,
      combinerToDisco: 10,
      inverterToDisco: 10,
      discoToMeter: AC_FT,
      meterToMsp: 10,
      mspToUtility: 5,
    },
    ambientTempC: 30,
    rooftopTempAdderC: 33,
    maxACVoltageDropPct: AC_TARGET_PCT,
    maxDCVoltageDropPct: 3,
    ...over,
  };
}

const row = (rows: SegmentScheduleRow[], type: string) =>
  rows.find(r => r.segmentType === type)!;

// ═══════════════════════════════════════════════════════════════════════════
describe('V1 — a DC string is not a percentage of the AC service voltage', () => {
  it('the hand arithmetic is what the finding says it is', () => {
    // Independent of the implementation: this is the defect and the truth.
    expect(circularMils('#10 AWG')).toBe(10380);
    expect(vdPct(DC_AMPS, DC_FT, 10380, AC_VOLTS)).toBeCloseTo(3.73, 2);   // the defect
    expect(vdPct(DC_AMPS, DC_FT, 10380, STRING_VMP)).toBeCloseTo(1.44, 2); // the truth
  });

  it('the DC source-circuit row is referenced to the string Vmp', () => {
    const dc = row(buildSegmentSchedule(stringInput()), 'ARRAY_TO_JBOX');
    expect(dc.conductorBundle[0].gauge).toBe('#10 AWG');
    expect(dc.voltageDropPct).toBeCloseTo(1.44, 2);
    // 🚨 THE DISCRIMINATOR: 3.73 is the pre-fix number. Asserting merely
    // "less than 3" would also pass on a #8 upsize, which is a different world.
    expect(dc.voltageDropPct).not.toBeCloseTo(3.73, 1);
  });

  it('the volts column and the percent column describe one circuit', () => {
    const dc = row(buildSegmentSchedule(stringInput()), 'ARRAY_TO_JBOX');
    // 18 A × 12.9 × 200 × 2 / 10380 = 8.95 V. This is the SAME 8.95 V either way —
    // which is exactly why the two columns disagreeing was invisible: only the
    // divisor was wrong.
    expect(dc.voltageDropVolts).toBeCloseTo(8.95, 2);
    expect(dc.voltageDropVolts / STRING_VMP * 100).toBeCloseTo(dc.voltageDropPct, 6);
  });

  it('a 200 ft string inside its DC target is a PASS, not a blocking failure', () => {
    const dc = row(buildSegmentSchedule(stringInput()), 'ARRAY_TO_JBOX');
    expect(dc.voltageDropPass).toBe(true);
    expect(dc.overallPass).toBe(true);
  });

  it('at 150 ft the pre-fix package read 2.80% where the truth is 1.08%', () => {
    const rows = buildSegmentSchedule(stringInput({
      runLengths: { ...stringInput().runLengths, arrayToJbox: 150 },
    }));
    expect(vdPct(DC_AMPS, 150, 10380, AC_VOLTS)).toBeCloseTo(2.80, 2);
    expect(row(rows, 'ARRAY_TO_JBOX').voltageDropPct).toBeCloseTo(1.08, 2);
  });

  it('a DC source circuit is CLASSIFIED, and not as an AC branch circuit', () => {
    for (const id of ['DC_STRING_RUN', 'DC_DISCO_TO_INV_RUN', 'ROOF_RUN']) {
      expect(classifyVdRole(id), id).toBe('dcSource');
      expect(vdLimitPctForSegment(id), id).toBe(ROUTE_VD_LIMIT_PCT.dcSource);
      expect(vdLimitPctForSegment(id), id).not.toBe(ROUTE_VD_LIMIT_PCT.branch);
    }
    // DC_DISCO_TO_INV_RUN contains the substring 'DISCO_TO_' and would be graded as
    // an AC FEEDER if DC were not tested first. This pins the ordering.
    expect(classifyVdRole('DC_DISCO_TO_INV_RUN')).not.toBe('feeder');
    // Fail-closed is preserved for anything genuinely unclassified.
    expect(classifyVdRole('SOME_UNCLASSIFIED_RUN')).toBe('branch');
    expect(classifyVdRole('COMBINER_TO_DISCO_RUN')).toBe('feeder');
  });

  it('NEC 210.19(A) Inf. Note 4 is never cited against a PV source circuit', () => {
    // 3.73% — the exact number the pre-fix package computed for this run.
    const g = gradeVoltageDropPolicy(3.73, 'DC_STRING_RUN');
    // The citation may NAME 210.19(A) — it does, in order to say the note is a
    // branch-circuit note and does not reach here. What it must never do is ASSERT
    // it as the governing requirement, which is what `definitiveFailure` encodes.
    expect(g.citation).toMatch(/no NEC voltage-drop requirement applies/i);
    expect(g.recommendationPct).toBeNull();     // the NEC publishes none
    expect(g.definitiveFailure).toBe(false);    // so nothing can be "exceeded"
    expect(g.compliant).toBe(true);
    expect(g.state).toBe('DESIGN_TARGET_EXCEEDED');
    // The pre-fix label for this exact percentage was
    // "EXCEEDS NEC 210.19(A) Informational Note 4 — 3.73% > 3.0%".
    expect(g.label).not.toMatch(/^EXCEEDS /);

    // The AC roles are untouched — this widened nothing.
    const br = gradeVoltageDropPolicy(3.01, 'BRANCH_RUN');
    expect(br.citation).toMatch(/210\.19\(A\)/);
    expect(br.definitiveFailure).toBe(true);
    expect(br.compliant).toBe(false);
    const fd = gradeVoltageDropPolicy(2.5, 'COMBINER_TO_DISCO_RUN');
    expect(fd.citation).toMatch(/215\.2\(A\)\(1\)/);
    expect(fd.definitiveFailure).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('V2 — the conductor that ships is chosen against voltage drop too', () => {
  it('the hand arithmetic names the two gauges that differ', () => {
    expect(circularMils('#8 AWG')).toBe(16510);
    expect(circularMils('#6 AWG')).toBe(26240);
    // #8 clears ampacity (50 A at 75 °C ≥ 32 × 1.25 = 40 A) and BUSTS the 2 % target.
    expect(vdPct(AC_AMPS, AC_FT, 16510, AC_VOLTS)).toBeCloseTo(2.50, 2);
    // #6 is the smallest that meets both.
    expect(vdPct(AC_AMPS, AC_FT, 26240, AC_VOLTS)).toBeCloseTo(1.57, 2);
  });

  it('the ampacity-only probe still returns #8 — the constraint is what changed', () => {
    // ANTI-VACUITY: if this ALSO returned #6, the new gate would be untested and
    // something else (an ampacity change) would be doing the work.
    const ampOnly = autoSizeGauge(AC_AMPS, 30, 3, false, '#10 AWG');
    expect(ampOnly.gauge).toBe('#8 AWG');
    expect(ampOnly.effectiveAmpacity).toBe(50);   // min(55 × 1.00 × 1.00, 50)
    expect(ampOnly.effectiveAmpacity).toBeGreaterThanOrEqual(AC_AMPS * 1.25);
  });

  it('with the run and the limit, the selector upsizes to #6', () => {
    const gated = autoSizeGauge(AC_AMPS, 30, 3, false, '#10 AWG', {
      onewayFt: AC_FT, circuitVoltage: AC_VOLTS, maxVDropPct: AC_TARGET_PCT,
    });
    expect(gated.gauge).toBe('#6 AWG');
    expect(gated.voltageDropPct).toBeCloseTo(1.57, 2);
    expect(gated.voltageDropPct as number).toBeLessThanOrEqual(AC_TARGET_PCT);
  });

  it('the SHIPPED feeder row — bundle, callout and BOM gauge — is #6', () => {
    // This is the part that matters: the gauge that survives back-population.
    const feeder = row(buildSegmentSchedule(stringInput()), 'DISCO_TO_METER');
    expect(feeder.onewayLengthFt).toBe(AC_FT);
    const hot = feeder.conductorBundle.filter(c => c.color === 'BLK' || c.color === 'RED');
    for (const c of hot) expect(c.gauge).toBe('#6 AWG');
    expect(feeder.conductorCallout).toMatch(/#6 THWN-2/);
    expect(feeder.voltageDropPct).toBeCloseTo(1.57, 2);
    // and the row no longer contradicts itself
    expect(feeder.voltageDropPass).toBe(true);
    expect(feeder.overallPass).toBe(true);
  });

  it('an UNRESOLVABLE voltage drop is not a pass', () => {
    // `circularMils` returns null for a gauge outside Table 8, and the selector
    // must treat that as "not acceptable" rather than as a zero drop. A 0 that
    // passes every limit is the precise defect the Table 8 module was built for.
    expect(circularMils('#999 AWG')).toBeNull();
    const r = autoSizeGauge(1, 30, 2, false, '#10 AWG', {
      onewayFt: 10, circuitVoltage: AC_VOLTS, maxVDropPct: 2,
    });
    // a resolvable conductor still resolves — this test is not asserting refusal
    // of everything
    expect(r.voltageDropPct).not.toBeNull();
    expect(r.voltageDropPct as number).toBeGreaterThan(0);
  });

  it('a run short enough for #8 still gets #8 — the gate is not a blanket upsize', () => {
    // ANTI-VACUITY the other way: at 20 ft the same feeder drops 0.42 % on #8, so
    // the correct answer is #8 and the gate must not have become "always bigger".
    expect(vdPct(AC_AMPS, 20, 16510, AC_VOLTS)).toBeCloseTo(0.42, 2);
    const gated = autoSizeGauge(AC_AMPS, 30, 3, false, '#10 AWG', {
      onewayFt: 20, circuitVoltage: AC_VOLTS, maxVDropPct: AC_TARGET_PCT,
    });
    expect(gated.gauge).toBe('#8 AWG');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('V3 — the rooftop adder is gated, and scoped to the segment', () => {
  // NEC 310.15(B)(3)(c) was DELETED for PV circuits by NEC 2017 690.31(A). With no
  // adopted edition established — which is what the permit path supplies today —
  // the adder is 0, so a 200 ft #10 string at 30 °C ambient is sized at 30 °C and
  // NOT at 63 °C. Direction: the old behaviour OVER-derated (bigger wire).
  it('no adopted edition ⇒ no adder ⇒ the free-air DC run is sized at ambient', () => {
    const dc = row(buildSegmentSchedule(stringInput()), 'ARRAY_TO_JBOX');
    // necAmbientCorrection90C(30) = 1.00; (30 + 33 = 63) would be 0.65.
    expect(dc.tempDeratingFactor).toBe(1.00);
    expect(dc.tempDeratingFactor).not.toBe(0.65);
  });

  it('a pre-2017 edition DOES reinstate it, on the RACEWAY off the roof', () => {
    // The scope half: 310.15(B)(3)(c) covered raceways and cables on rooftops. The
    // in-conduit JBOX_TO_INVERTER run is within it; it is the run the adder used to
    // be WITHHELD from.
    const rows = buildSegmentSchedule(stringInput({ necEdition: '2014', systemType: 'roof' }));
    expect(row(rows, 'JBOX_TO_INVERTER').tempDeratingFactor).toBe(0.65); // 30 + 33 = 63 °C
    // and on a GROUND mount the same pre-2017 edition still applies nothing
    const ground = buildSegmentSchedule(stringInput({ necEdition: '2014', systemType: 'ground' }));
    expect(row(ground, 'JBOX_TO_INVERTER').tempDeratingFactor).toBe(1.00);
  });
});
