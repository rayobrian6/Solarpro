// ============================================================================
// Wave 2b — lib/electrical-calc.ts per-subsystem contract tests.
// See docs/ARCHITECTURE-per-subsystem-equipment.md §1.7 / §3 (Wave 2 — 2b),
// Invariants I-1 (N=1 parity), I-6 (aggregator-owned POI), I-7 (code-scope
// correctness at N>1), I-10 (behavior-change quarantine), and Addendum B
// ruling 2 (backfeed ALWAYS recomputed — no legacy freeze flag).
//
// Covers:
//   1. N=1 parity against the Wave-0 golden numbers (literal re-assertions).
//   2. Hybrid 3-sub (Enphase micro roof + Solis 7.6 kW string ground +
//      optimizer fence): per-inverter-FIRST OCPD rounding proven against a
//      hand-computed case where sum-then-round differs (705.12(B)).
//   3. Single 120% busbar check at the POI (battery counted exactly once).
//   4. RSD (NEC 690.12) scoped to roof-tagged inverters only at N>1.
//   5. Rooftop temp adder applied to roof-tagged conductors only at N>1.
//   6. NEC 690.15 DC-disconnect evaluated per sub-system at N>1.
//   7. result.subSystems[] keys/shape (consumed by 2d + Waves 3/5).
//   8. EngineeringModel honesty fix (perInverter[] + largest-entry scalars).
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  runElectricalCalc,
  sizeAcBranch,
  inverterEntryAcKw,
  type ElectricalCalcInput,
  type InverterInput,
} from '../../lib/electrical-calc';
import { nextStandardOCPD } from '../../lib/manufacturer-specs';
import { ecStringInput, PANEL, r6 } from './wave0-fixtures';

// ── Hybrid fixture inverters (contract I-3 golden trio) ─────────────────────

/** Enphase IQ8+-style micro fleet — ROOF. acOutputKw is PER DEVICE. */
function roofMicro(over: Partial<InverterInput> = {}): InverterInput {
  return {
    type: 'micro', acOutputKw: 0.29, maxDcVoltage: 60,
    mpptVoltageMin: 27, mpptVoltageMax: 45,
    maxInputCurrentPerMppt: 12, acOutputCurrentMax: 1.21,
    deviceCount: 20, modulesPerDevice: 1, strings: [],
    subSystemKey: 'roof',
    ...over,
  };
}

function mkString(panelCount: number) {
  return {
    panelCount, panelVoc: PANEL.voc, panelIsc: PANEL.isc, panelImp: PANEL.imp,
    panelVmp: PANEL.vmp, panelWatts: PANEL.watts,
    tempCoeffVoc: PANEL.tcVoc, tempCoeffIsc: PANEL.tcIsc,
    maxSeriesFuseRating: PANEL.fuse, wireGauge: '#10 AWG', wireLength: 50, conduitType: 'EMT',
  };
}

/** Solis-style 7.6 kW string inverter — GROUND. */
function groundString(over: Partial<InverterInput> = {}): InverterInput {
  return {
    type: 'string', acOutputKw: 7.6, maxDcVoltage: 600,
    mpptVoltageMin: 100, mpptVoltageMax: 600,
    maxInputCurrentPerMppt: 17, acOutputCurrentMax: 32,
    strings: [mkString(10), mkString(10)],
    subSystemKey: 'ground',
    ...over,
  };
}

/** SolFence-style optimizer system — FENCE (per SolFence data: OPTIMIZERS). */
function fenceOptimizer(over: Partial<InverterInput> = {}): InverterInput {
  return {
    type: 'optimizer', acOutputKw: 3.8, maxDcVoltage: 480,
    mpptVoltageMin: 300, mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 15, acOutputCurrentMax: 16,
    strings: [mkString(10)],
    subSystemKey: 'fence',
    ...over,
  };
}

function hybridInput(over: Partial<ElectricalCalcInput> = {}): ElectricalCalcInput {
  return {
    inverters: [roofMicro(), groundString(), fenceOptimizer()],
    mainPanelAmps: 200, systemVoltage: 240,
    designTempMin: -10, designTempMax: 40, rooftopTempAdder: 30,
    wireGauge: '#10 AWG', wireLength: 50, conduitType: 'EMT',
    rapidShutdown: true, acDisconnect: true, dcDisconnect: true, necVersion: '2023',
    ...over,
  };
}

// ── Hand-computed hybrid AC math (the 705.12(B) proof numbers) ──────────────
// roof micro   : 0.29 × 20 = 5.8 kW → 24.1667 A → ×1.25 = 30.2083 → OCPD 35
// ground string: 7.6 kW           → 31.6667 A → ×1.25 = 39.5833 → OCPD 40
// fence optim. : 3.8 kW           → 15.8333 A → ×1.25 = 19.7917 → OCPD 20
// Per-inverter FIRST, then sum:      35 + 40 + 20                =      95 A
// Sum first, then round once:  nextStdOCPD(71.6667 × 1.25 = 89.5833) = 90 A
// 95 ≠ 90 — the fabricated single rounding UNDERCOUNTS the physical breaker
// schedule an AHJ reviews. (The deleted :671–674 fork was worse still:
// nextStdOCPD((71.6667 / 3) × 1.25) = 30 A.)
const ROOF_OCPD = 35, GROUND_OCPD = 40, FENCE_OCPD = 20;
const PER_INVERTER_FIRST_SUM = ROOF_OCPD + GROUND_OCPD + FENCE_OCPD; // 95

describe('Wave 2b — AC helper (single-source Steps 1–3)', () => {
  it('sizeAcBranch computes output amps → ×1.25 continuous → next-standard OCPD', () => {
    const s = sizeAcBranch(7.6, 240);
    expect(r6(s.acOutputAmps)).toBeCloseTo(31.666667, 5);
    expect(r6(s.continuousAmps)).toBeCloseTo(39.583333, 5);
    expect(s.ocpdAmps).toBe(40);
  });

  it('inverterEntryAcKw expands micro fleets, passes string/optimizer through', () => {
    expect(inverterEntryAcKw(roofMicro())).toBeCloseTo(5.8, 9);
    expect(inverterEntryAcKw(groundString())).toBe(7.6);
    expect(inverterEntryAcKw(fenceOptimizer())).toBe(3.8);
  });
});

describe('Wave 2b — N=1 parity with the Wave-0 golden (I-1)', () => {
  const res = runElectricalCalc(ecStringInput());

  it('every Wave-0-pinned number is unchanged', () => {
    // Literal re-assertions of tests/goldens/__snapshots__/
    // wave0-electrical-calc.golden.test.ts.snap — the N=1 path is untouched.
    expect(res.status).toBe('PASS');
    expect(res.acWireGauge).toBe('#8 AWG');
    expect(res.acSizing.acCurrentAmps).toBe(31.67);
    expect(res.acSizing.continuousCurrentAmps).toBe(39.58);
    expect(res.acSizing.ocpdAmps).toBe(40);
    expect(res.acSizing.disconnectAmps).toBe(60);
    expect(res.busbar.backfeedBreakerRequired).toBe(40);
    expect(r6(res.busbar.totalAcOutputAmps)).toBeCloseTo(31.666667, 5);
    expect(res.busbar.maxAllowedBackfeed).toBe(40);
    expect(res.busbar.passes).toBe(true);
    expect(res.summary.totalPanels).toBe(20);
    expect(res.errors).toHaveLength(0);
  });

  it('engineeringModel honesty fix leaves the N=1 golden fields unchanged', () => {
    const em = res.acSizing.engineeringModel;
    // Old fabricated average ≡ honest largest-entry value when N=1.
    expect(em.inverterCount).toBe(1);
    expect(em.totalAcKw).toBe(7.6);
    expect(em.perInverterAcKw).toBe(7.6);
    expect(em.perInverterDisconnectAmps).toBe(40);
    // ...and the honest per-inverter record agrees with the scalars.
    expect(em.perInverter).toHaveLength(1);
    expect(em.perInverter![0]).toMatchObject({
      inverterIndex: 0, type: 'string', subSystemKey: 'roof',
      acKw: 7.6, ocpdAmps: 40, disconnectAmps: 40,
    });
  });

  it('legacy untagged single-system input yields exactly one roof summary', () => {
    expect(res.subSystems).toHaveLength(1);
    const sub = res.subSystems[0];
    expect(sub.key).toBe('roof');
    expect(sub.topology).toBe('string');
    expect(sub.inverterIndexes).toEqual([0]);
    expect(sub.ocpdAmps).toBe(40);
    expect(r6(sub.acOutputAmps)).toBeCloseTo(31.666667, 5);
    expect(sub.panelCount).toBe(20);
    expect(sub.stringCount).toBe(2);
    expect(sub.rsdRequired).toBe(true);
    expect(sub.rooftopTempAdderC).toBe(30); // legacy single-sub: input adder as-is
    expect(sub.acWireGauge).toBe('#8 AWG');
  });

  it('tag presence alone never changes the NEC numbers (I-10, non-roof key)', () => {
    // A GROUND-tagged single-sub input: subSystems[].key is honestly 'ground',
    // but every number is identical to the untagged run — scoping changes
    // gate strictly on >1 DISTINCT keys, never on tag presence.
    const taggedInput = ecStringInput();
    taggedInput.inverters = taggedInput.inverters.map(inv => ({ ...inv, subSystemKey: 'ground' as const }));
    const tagged = runElectricalCalc(taggedInput);
    const strip = (r: ReturnType<typeof runElectricalCalc>) =>
      JSON.parse(JSON.stringify({ ...r, subSystems: undefined, acSizing: { ...r.acSizing, engineeringModel: { ...r.acSizing.engineeringModel, perInverter: undefined } } }));
    expect(strip(tagged)).toEqual(strip(res));
    expect(tagged.subSystems[0].key).toBe('ground');
    expect(tagged.subSystems[0].ocpdAmps).toBe(40);
    expect(tagged.subSystems[0].rooftopTempAdderC).toBe(30); // single-sub: legacy adder kept
    // RSD still asserted for single-sub non-roof tags (legacy behavior, I-10).
    const taggedNoRsd = runElectricalCalc({ ...taggedInput, rapidShutdown: false });
    expect(taggedNoRsd.errors.map(e => e.code)).toContain('E-RAPID-SHUTDOWN');
  });
});

describe('Wave 2b — 705.12(B) per-inverter-FIRST rounded summed backfeed', () => {
  it('hybrid backfeed = Σ nextStandardOCPD(perInverter × 1.25) = 95 A (≠ sum-then-round 90 A)', () => {
    const res = runElectricalCalc(hybridInput());
    // Prove the hand math: rounding order MATTERS for this fixture.
    const totalAmps = (5.8 + 7.6 + 3.8) * 1000 / 240; // 71.6667 A
    expect(nextStandardOCPD(totalAmps * 1.25)).toBe(90);           // sum-then-round (WRONG)
    expect(PER_INVERTER_FIRST_SUM).toBe(95);                        // round-per-inverter-first (RIGHT)
    expect(res.busbar.backfeedBreakerRequired).toBe(95);
    expect(res.interconnection.solarBreakerRequired).toBe(95);
    // Honest per-inverter breakers land in engineeringModel.perInverter.
    expect(res.acSizing.engineeringModel.perInverter!.map(p => p.ocpdAmps))
      .toEqual([ROOF_OCPD, GROUND_OCPD, FENCE_OCPD]);
  });

  it('exactly ONE 120% check at the POI — fails at 95 A where sum-then-round (90 A) would have slipped through', () => {
    // (200 A bus × 1.2) − 150 A main = 90 A max allowed. The honest 95 A
    // backfeed FAILS; the old single-rounding 90 A would have (wrongly) passed.
    const res = runElectricalCalc(hybridInput({
      interconnection: { method: 'LOAD_SIDE', busRating: 200, mainBreaker: 150 },
    }));
    expect(res.interconnection.maxAllowedSolarBreaker).toBe(90);
    expect(res.interconnection.passes).toBe(false);
    const busbarErrors = res.errors.filter(e => e.code === 'E-BUSBAR-120');
    expect(busbarErrors).toHaveLength(1); // aggregator-owned POI: one check, ever (I-6)
    expect(busbarErrors[0].value).toBe(95);
  });

  it('passes when the bus honestly allows the summed schedule', () => {
    // (225 × 1.2) − 175 = 95 A max allowed — exactly the summed backfeed.
    const res = runElectricalCalc(hybridInput({
      interconnection: { method: 'LOAD_SIDE', busRating: 225, mainBreaker: 175 },
    }));
    expect(res.interconnection.passes).toBe(true);
    expect(res.errors.filter(e => e.code === 'E-BUSBAR-120')).toHaveLength(0);
  });

  it('battery backfeed is counted exactly once, at the POI', () => {
    const res = runElectricalCalc(hybridInput({ batteryBackfeedA: 30 }));
    expect(res.interconnection.solarBreakerRequired).toBe(95 + 30);
    // Per-sub summaries never include the battery (it is POI-level, I-6).
    expect(res.subSystems.reduce((s, x) => s + x.ocpdAmps, 0)).toBe(95);
  });

  it('Addendum B ruling 2: legacy multi-inverter single-sub projects ALWAYS get the recomputed sum (no freeze flag)', () => {
    // Two untagged 7.6 kW string inverters. The deleted :671–674 fork
    // fabricated nextStdOCPD((totalAmps / 2) × 1.25) = 40 A — the AVERAGE
    // per-inverter breaker reported as the WHOLE system's backfeed. Honest:
    // 40 + 40 = 80 A. Ray ruling 2026-07-12: "No one has a working hybrid
    // project... regenerating will be fine" — always recompute, no flag.
    const res = runElectricalCalc(hybridInput({
      inverters: [groundString({ subSystemKey: undefined }), groundString({ subSystemKey: undefined })],
    }));
    expect(res.busbar.backfeedBreakerRequired).toBe(80);
  });
});

describe('Wave 2b — RSD (NEC 690.12) scoped to roof at N>1 (I-7)', () => {
  it('ground + fence hybrid without RSD: no E-RAPID-SHUTDOWN, compliant, info emitted', () => {
    const res = runElectricalCalc(hybridInput({
      inverters: [groundString(), fenceOptimizer()],
      rapidShutdown: false,
    }));
    expect(res.errors.map(e => e.code)).not.toContain('E-RAPID-SHUTDOWN');
    expect(res.rapidShutdownCompliant).toBe(true);
    expect(res.infos.map(i => i.code)).toContain('I-RSD-NOT-REQUIRED');
  });

  it('hybrid WITH a roof sub still requires RSD', () => {
    const res = runElectricalCalc(hybridInput({ rapidShutdown: false }));
    expect(res.errors.map(e => e.code)).toContain('E-RAPID-SHUTDOWN');
    expect(res.rapidShutdownCompliant).toBe(false);
  });

  it('legacy untagged input still requires RSD (unchanged N=1 path)', () => {
    const res = runElectricalCalc({ ...ecStringInput(), rapidShutdown: false });
    expect(res.errors.map(e => e.code)).toContain('E-RAPID-SHUTDOWN');
  });
});

describe('Wave 2b — rooftop temp adder scoped to roof-tagged conductors (I-7)', () => {
  it('at N>1 the ground string never carries the 30 °C roof derate', () => {
    // Two IDENTICAL string inverters, one roof / one ground. MANUAL mode pins
    // both DC gauges at #10 AWG so the derated ampacities are directly
    // comparable: roof derates at designTempMax + 30 °C, ground at ambient.
    const res = runElectricalCalc(hybridInput({
      inverters: [groundString({ subSystemKey: 'roof' }), groundString()],
      engineeringMode: 'MANUAL',
    }));
    const roofStr = res.inverters[0].strings[0];
    const groundStr = res.inverters[1].strings[0];
    expect(roofStr.wireGauge).toBe(groundStr.wireGauge); // same conductor…
    expect(groundStr.wireAmpacityDerated).toBeGreaterThan(roofStr.wireAmpacityDerated); // …less derate off-roof
  });

  it('per-inverter env.rooftopTempAdderC override wins over the sub rule', () => {
    const res = runElectricalCalc(hybridInput({
      inverters: [
        groundString({ subSystemKey: 'roof', env: { rooftopTempAdderC: 0 } }),
        groundString(),
      ],
      engineeringMode: 'MANUAL',
    }));
    // With the roof adder explicitly zeroed, both identical strings derate identically.
    expect(res.inverters[0].strings[0].wireAmpacityDerated)
      .toBe(res.inverters[1].strings[0].wireAmpacityDerated);
  });
});

describe('Wave 2b — NEC 690.15 DC disconnect per sub-system at N>1 (I-7)', () => {
  it('micro roof is exempt while string ground + optimizer fence each still require one', () => {
    const res = runElectricalCalc(hybridInput({ dcDisconnect: false }));
    const errs = res.errors.filter(e => e.code === 'E-DC-DISCONNECT');
    expect(errs).toHaveLength(2); // ground + fence — the micro roof must not exempt them
    expect(errs.map(e => e.message).join(' ')).toContain('ground');
    expect(errs.map(e => e.message).join(' ')).toContain('fence');
    const microInfos = res.infos.filter(i => i.code === 'I-DC-DISCONNECT-MICRO');
    expect(microInfos).toHaveLength(1); // …and the string ground must not force one onto the roof
    expect(microInfos[0].message).toContain('roof');
  });

  it('factory-integrated switches satisfy 690.15 per sub', () => {
    const res = runElectricalCalc(hybridInput({
      dcDisconnect: false,
      inverters: [
        roofMicro(),
        groundString({ integratedDcDisconnect: true }),
        fenceOptimizer({ integratedDcDisconnect: true }),
      ],
    }));
    expect(res.errors.map(e => e.code)).not.toContain('E-DC-DISCONNECT');
    expect(res.infos.filter(i => i.code === 'I-DC-DISCONNECT-INTEGRATED')).toHaveLength(2);
  });
});

describe('Wave 2b — result.subSystems[] shape (consumed by 2d + Waves 3/5)', () => {
  const res = runElectricalCalc(hybridInput());

  it('one entry per distinct key, fixed roof > ground > fence order', () => {
    expect(res.subSystems.map(s => s.key)).toEqual(['roof', 'ground', 'fence']);
  });

  it('roof (Enphase micro fleet) summary', () => {
    const roof = res.subSystems[0];
    expect(roof).toMatchObject({
      key: 'roof', topology: 'micro', inverterIndexes: [0],
      inverterCount: 1, deviceCount: 20, panelCount: 20, stringCount: 0,
      ocpdAmps: ROOF_OCPD, rsdRequired: true, rooftopTempAdderC: 30,
      branch: { deviceCount: 20, modulesPerDevice: 1 },
    });
    expect(roof.acKw).toBeCloseTo(5.8, 9);
    expect(roof.dcKw).toBeCloseTo(8.0, 9); // 20 modules × 400 W default (no string data on micro entry)
    expect(r6(roof.acOutputAmps)).toBeCloseTo(24.166667, 5);
    expect(roof.perInverter).toHaveLength(1);
    expect(roof.perInverter[0]).toMatchObject({
      inverterIndex: 0, type: 'micro', subSystemKey: 'roof',
      ocpdAmps: ROOF_OCPD, disconnectAmps: ROOF_OCPD, deviceCount: 20,
    });
    expect(roof.acWireGauge).toBeTruthy();
    expect(roof.acConductorCallout).toBeTruthy();
  });

  it('ground (Solis string) summary — no roof derates, no RSD', () => {
    const ground = res.subSystems[1];
    expect(ground).toMatchObject({
      key: 'ground', topology: 'string', inverterIndexes: [1],
      inverterCount: 1, deviceCount: 1, panelCount: 20, stringCount: 2,
      ocpdAmps: GROUND_OCPD, rsdRequired: false, rooftopTempAdderC: 0,
    });
    expect(ground.acKw).toBe(7.6);
    expect(ground.dcKw).toBeCloseTo(8.4, 9); // 20 × 420 W
    expect(ground.branch).toBeUndefined();
  });

  it('fence (optimizer) summary — topology from ITS OWN equipment (I-3)', () => {
    const fence = res.subSystems[2];
    expect(fence).toMatchObject({
      key: 'fence', topology: 'optimizer', inverterIndexes: [2],
      panelCount: 10, stringCount: 1,
      ocpdAmps: FENCE_OCPD, rsdRequired: false, rooftopTempAdderC: 0,
    });
    expect(fence.dcKw).toBeCloseTo(4.2, 9); // 10 × 420 W
  });

  it('sub-level ocpdAmps are never re-rounded — they sum to the POI backfeed', () => {
    expect(res.subSystems.map(s => s.ocpdAmps)).toEqual([ROOF_OCPD, GROUND_OCPD, FENCE_OCPD]);
    expect(res.subSystems.reduce((s, x) => s + x.ocpdAmps, 0))
      .toBe(res.busbar.backfeedBreakerRequired);
  });

  it('engineeringModel honesty at N>1: largest-entry scalars, never the fabricated average', () => {
    const em = res.acSizing.engineeringModel;
    // Old fork would have reported avg = nextStdOCPD((71.67/3)×1.25) = 30 A.
    expect(em.perInverterDisconnectAmps).toBe(40); // largest honest entry (Solis)
    expect(em.perInverterAcKw).toBe(7.6);
    expect(em.perInverter!.map(p => [p.subSystemKey, p.ocpdAmps])).toEqual([
      ['roof', 35], ['ground', 40], ['fence', 20],
    ]);
  });
});
