// ═══════════════════════════════════════════════════════════════════════════
// NEC 705.12(B) — THE PERMIT PACKAGE AND THE UI MUST REACH THE SAME VERDICT.
//
// Two defects, both of which made the PERMIT the permissive one:
//
//   1. The permit path (lib/permit/utils/computedRuns.ts) handed computeSystem
//      `batteryBackfeedA: 0, batteryCount: 0` — two literals — so the busbar
//      total omitted the battery entirely, while the engineering page and the
//      standalone SLD both pass the real battery id.
//   2. computed-system.ts rounded the AGGREGATE AC current once
//      (nextStandardOcpd(ΣIᵢ × 1.25)), while runElectricalCalc summed the
//      PER-INVERTER rounded OCPD (Σ nextStandardOcpd(Iᵢ × 1.25)). At N>1
//      inverters the two disagree, and the engine whose projection IS
//      `compliance.electrical.busbar` was the one that under-counted.
//
// Every assertion below is written so it FAILS on the pre-fix code — the
// expected numbers ARE the old bug's numbers with the missing term restored.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { computeSystem, type ComputedSystemInput } from '../../lib/computed-system';
import { runElectricalCalc, totalInterconnectionBackfeedA } from '../../lib/electrical-calc';
import { buildComputeSystemShadow } from '../../lib/permit/utils/computedRuns';
import { generateCADLayout } from '../../lib/cad/cadEngine';
import { roofProject } from '../../test-fixtures/roofProject';
import { csStringInput, ecStringInput } from '../goldens/wave0-fixtures';

// ── 1. The shared formula itself ───────────────────────────────────────────
describe('totalInterconnectionBackfeedA — the ONE 705.12(B) formula', () => {
  it('rounds each interconnecting device to its own NEC 240.6(A) size, THEN sums', () => {
    // Three Fronius Primo 6.0-1 at 240 V: 25 A each.
    // Per device: 25 × 1.25 = 31.25 → 35 A ⇒ 105 A.
    // The aggregate-first reading gave 75 × 1.25 = 93.75 → 100 A — one whole
    // ladder step of backfeed that no breaker in the panel actually is.
    expect(totalInterconnectionBackfeedA([25, 25, 25])).toBe(105);
    expect(totalInterconnectionBackfeedA([75])).toBe(100);
  });

  it('is identical to the single-circuit answer at N = 1 (no golden may move)', () => {
    expect(totalInterconnectionBackfeedA([31.67])).toBe(40); // 7.6 kW @ 240 V
    expect(totalInterconnectionBackfeedA([])).toBe(0);
  });
});

// ── 2. computed-system now agrees with runElectricalCalc at N > 1 ──────────
describe('computeSystem 705.12(B) total backfeed — Σ of the real breakers', () => {
  const threeInverters = (): ComputedSystemInput => ({
    ...csStringInput(),
    inverterModel: 'Primo 6.0-1',
    inverterAcKw: 6.0,          // PER-UNIT nameplate
    inverterCount: 3,
    inverterAcCurrentMax: 25,
    mainPanelAmps: 140,         // 200 × 1.2 − 140 = 100 A of headroom exactly
    panelBusRating: 200,
  });

  it('three 6.0 kW inverters backfeed 105 A, not 100 A', () => {
    const cs = computeSystem(threeInverters());
    // OLD: acOcpdAmps (aggregate 75 A × 1.25 → 100 A) was reused as the busbar
    // term, so this read 100 and the 120% check PASSED at exactly the limit.
    expect(cs.backfeedBreakerAmps).toBe(105);
    expect(cs.interconnectionPass).toBe(false);
    expect(cs.issues.some(i => i.code === 'NEC_705_12B_120PCT')).toBe(true);
  });

  it('the FEEDER OCPD stays sized on the aggregate current — it is a different device', () => {
    const cs = computeSystem(threeInverters());
    // One conductor set carries all three inverters; its OCPD is still 100 A.
    // Confusing the two is what produced the wrong busbar term in the first place.
    expect(cs.acOcpdAmps).toBe(100);
  });

  it('agrees with runElectricalCalc — the two engines, one number', () => {
    const csIn = threeInverters();
    const cs = computeSystem(csIn);
    const ec = runElectricalCalc({
      ...ecStringInput(),
      inverters: [0, 1, 2].map(() => ({
        ...ecStringInput().inverters[0],
        acOutputKw: 6.0,
      })),
      mainPanelAmps: 140,
      interconnection: { method: 'LOAD_SIDE', busRating: 200, mainBreaker: 140 },
    });
    // BEFORE: 100 (permit) vs 105 (page) — one design, two verdicts, and the
    // stamped document was the one that passed.
    expect(ec.interconnection.solarBreakerRequired).toBe(105);
    expect(cs.backfeedBreakerAmps).toBe(ec.interconnection.solarBreakerRequired);
    expect(cs.interconnectionPass).toBe(ec.interconnection.passes);
  });

  it('N = 1 is numerically unchanged (Wave-0 goldens must not move)', () => {
    const cs = computeSystem(csStringInput());       // 7.6 kW, one inverter
    expect(cs.backfeedBreakerAmps).toBe(cs.acOcpdAmps);
  });

  it('interconnectingCircuitAmps overrides the inferred fleet (the permit path shape)', () => {
    // The permit hands the engine ONE synthetic whole-system inverter, so
    // inverterCount cannot describe the real fleet. The explicit circuit list can.
    const cs = computeSystem({
      ...csStringInput(),
      inverterAcKw: 18.0,       // the synthetic whole-system unit
      inverterCount: 1,
      mainPanelAmps: 140,
      panelBusRating: 200,
      interconnectingCircuitAmps: [25, 25, 25],
    } as ComputedSystemInput);
    expect(cs.backfeedBreakerAmps).toBe(105);
    expect(cs.acOcpdAmps).toBe(100);   // feeder unaffected
  });
});

// ── 3. The permit package now carries the battery on the busbar ────────────
describe('permit busbar — the battery is IN the 705.12(B) total', () => {
  const mk = (battery: boolean) => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    input.project.panelBusRating = 200;
    input.project.mainPanelAmps = 175;          // 200 × 1.2 − 175 = 65 A allowed
    input.project.interconnectionMethod = 'LOAD_SIDE';
    if (battery) {
      input.project.batteryId = 'tesla-powerwall-3';
      input.project.batteryBrand = 'Tesla';
      input.project.batteryModel = 'Powerwall 3';
      input.project.batteryCount = 1;
    }
    const cad = generateCADLayout(input);
    return buildComputeSystemShadow(input, cad as any)!;
  };

  it('no battery: 30 A of PV clears the 65 A allowance (unchanged)', () => {
    const cs = mk(false);
    expect(cs.backfeedBreakerAmps).toBe(30);
    expect(cs.interconnectionPass).toBe(true);
  });

  it('one Powerwall 3: 30 A PV + 50 A battery = 80 A > 65 A → the permit FAILS', () => {
    const cs = mk(true);
    // OLD: batteryBackfeedA/batteryCount were hard 0 and no batteryIds were
    // passed, so this read 30 and interconnectionPass was TRUE — the permit
    // cleared a busbar the engineering page failed.
    expect(cs.backfeedBreakerAmps).toBe(80);
    expect(cs.interconnectionPass).toBe(false);
    const issue = cs.issues.find(i => i.code === 'NEC_705_12B_120PCT');
    expect(issue).toBeTruthy();
    expect(issue!.message).toContain('50A battery');
  });

  it('the battery term comes from resolveBatteryBranch — a brand/model-only design still resolves', () => {
    // A legacy design carries batteryBrand/batteryModel and NO catalogue id.
    // The authority owns the EXACT manufacturer+model recovery, so the permit
    // gets the same 50 A the id-carrying design gets rather than a silent 0.
    const input: any = JSON.parse(JSON.stringify(roofProject));
    input.project.panelBusRating = 200;
    input.project.mainPanelAmps = 175;
    input.project.interconnectionMethod = 'LOAD_SIDE';
    input.project.batteryBrand = 'Tesla';
    input.project.batteryModel = 'Powerwall 3';
    input.project.batteryCount = 1;
    const cad = generateCADLayout(input);
    const cs = buildComputeSystemShadow(input, cad as any)!;
    expect(cs.backfeedBreakerAmps).toBe(80);
    expect(cs.interconnectionPass).toBe(false);
  });
});

// ── 3b. …and the permit path actually hands the engine that circuit list ───
describe('permit path — three string inverters reach the busbar as three breakers', () => {
  const mk = () => {
    const input: any = JSON.parse(JSON.stringify(roofProject));
    input.project.panelBusRating = 200;
    input.project.mainPanelAmps = 140;          // 240 − 140 = 100 A allowed
    input.project.interconnectionMethod = 'LOAD_SIDE';
    input.system.topology = 'string';
    input.system.totalAcKw = 18.0;
    const one = input.system.inverters[0];
    input.system.inverters = [0, 1, 2].map(i => ({
      ...JSON.parse(JSON.stringify(one)),
      type: 'string',
      manufacturer: 'Fronius',
      model: 'Primo 6.0-1',
      acOutputKw: 6.0,
      strings: [{ ...(one.strings?.[0] ?? {}), label: `S${i + 1}`, panelCount: 4 }],
    }));
    const cad = generateCADLayout(input);
    return buildComputeSystemShadow(input, cad as any)!;
  };

  it('the permit busbar term is 105 A, the same number the Electrical tab shows', () => {
    const cs = mk();
    // OLD: the permit handed computeSystem ONE synthetic 18 kW inverter, so the
    // engine rounded 75 A × 1.25 once → 100 A → PASS at exactly the limit.
    expect(cs.backfeedBreakerAmps).toBe(105);
    expect(cs.interconnectionPass).toBe(false);
  });
});

// ── 4. The unit count is a STEP, not a multiplier ──────────────────────────
describe('battery unit count reaches the branch authority', () => {
  it('batteryIds names the PRODUCT and batteryCount names the fleet', () => {
    // IQ Battery 10C publishes a genuine STEP: one unit → 40 A branch OCPD,
    // two units on the shared branch → 80 A (DSH-00565-9.0 §OCPD). Before this,
    // `[id]` + `batteryCount: 2` asked the authority for the ONE-unit rule —
    // the wrong step of a manufacturer's table, understating the busbar by 40 A
    // while the equipment schedule beside it printed qty 2.
    const pv = computeSystem(csStringInput()).acOcpdAmps;
    const one = computeSystem({
      ...csStringInput(), batteryIds: ['enphase-iq-battery-10c'], batteryCount: 1,
    } as ComputedSystemInput);
    const two = computeSystem({
      ...csStringInput(), batteryIds: ['enphase-iq-battery-10c'], batteryCount: 2,
    } as ComputedSystemInput);
    expect(one.backfeedBreakerAmps - pv).toBe(40);
    expect(two.backfeedBreakerAmps - pv).toBe(80);
  });

  it('one schedule row per PRODUCT, carrying the fleet qty — whichever spelling the caller used', () => {
    // Product list + separate count (what the engineering page and the permit send).
    const byCount = computeSystem({
      ...csStringInput(), batteryIds: ['tesla-powerwall-3'], batteryCount: 3,
    } as ComputedSystemInput);
    // Per-UNIT list (the spelling the busbar grouping was written for). OLD:
    // three identical BATT-n rows EACH saying qty 3 — nine batteries and three
    // gateways on the schedule for a three-battery job.
    const byUnits = computeSystem({
      ...csStringInput(),
      batteryIds: ['tesla-powerwall-3', 'tesla-powerwall-3', 'tesla-powerwall-3'],
      batteryCount: 3,
    } as ComputedSystemInput);
    for (const cs of [byCount, byUnits]) {
      const batt = cs.equipmentSchedule.filter(r => r.tag.startsWith('BATT-'));
      expect(batt).toHaveLength(1);
      expect(batt[0].qty).toBe(3);
      // One gateway row, not three.
      expect(cs.equipmentSchedule.filter(r => r.tag.startsWith('GW-'))).toHaveLength(1);
    }
  });
});
