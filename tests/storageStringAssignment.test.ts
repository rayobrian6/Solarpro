// ═══════════════════════════════════════════════════════════════════════════
// The string-assignment RECOMMENDATION — `lib/electrical/storageStringAssignment.ts`.
//
// Ray (System Config UX correction V3): "Recommended assignment available [Accept] [Edit]" —
// deterministic, inside each unit's published PV input limits (MPPT count, kW STC), spreading the
// load, and null with a reason when nothing fits. It is a proposal: the only write is answerPvLanding.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  recommendStringAssignment, recordedStringAssignment, assignmentViolations, invertingUnits,
  unitDisplayLabels, stringsPerUnit, sameAssignment, type AssignableUnit,
} from '@/lib/electrical/storageStringAssignment';
import { answerPvLanding, answerServiceRating, answerBackup, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type PvInputLimits, type ServiceTopology } from '@/lib/electrical/serviceTopology';

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const RAYS_STRINGS = [9, 9, 9, 8, 2];
const rays = () => ({ ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const });

const lim = (over: Partial<PvInputLimits> = {}): PvInputLimits => ({
  maxStcKw: 20, mppts: 6, mpptVdc: [60, 480], inputVdc: [60, 550], maxImpPerMpptA: 15, maxIscPerMpptA: 19,
  basis: 'test datasheet', ...over,
});
const unit = (id: string, l: PvInputLimits | null = lim(), pvDcStcKw?: number | null): AssignableUnit =>
  ({ id, label: 'Unit', pvInputLimits: l, pvDcStcKw });

describe('Ray\'s DC-coupled job — 37 × 440 W, strings 9/9/9/8/2, four Powerwall 3', () => {
  it('spreads the strings across the four units, largest first, inside each unit\'s published inputs', () => {
    const t = rays();
    const units = invertingUnits(t);
    expect(units).toHaveLength(4);
    expect(units.every(u => u.pvInputLimits?.mppts === 6 && u.pvInputLimits?.maxStcKw === 20)).toBe(true);
    const rec = recommendStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units });
    if (rec.ok === false) throw new Error(rec.reason);
    const [a, b, c, d] = units.map(u => u.id);
    expect(rec.unitOf).toEqual([a, b, c, d, d]);
    expect(rec.perUnit).toEqual({ [a]: [9], [b]: [9], [c]: [9], [d]: [8, 2] });
    expect(rec.unitKw).toEqual({ [a]: 3.96, [b]: 3.96, [c]: 3.96, [d]: 4.4 });
  });

  it('is deterministic — the same inputs give the same answer, every time', () => {
    const units = invertingUnits(rays());
    const runs = Array.from({ length: 5 }, () => recommendStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units }));
    for (const r of runs) expect(r).toEqual(runs[0]);
  });

  it('accepted through answerPvLanding, it answers behavior.pv-landing and every unit\'s PV input check PASSES', () => {
    const t = rays();
    const rec = recommendStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units: invertingUnits(t) });
    if (rec.ok === false) throw new Error(rec.reason);
    const landed = ok(answerPvLanding(t, rec.perUnit, 440, 37));
    expect(invertingUnits(landed).map(u => u.pvDcStcKw)).toEqual([3.96, 3.96, 3.96, 4.4]);
    const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
    const iv = buildSystemConfigInterview({
      pvArray: pv37, topology: landed, coupling: 'dc-coupled-storage', couplingIsDecision: true, architectureConflict: false,
      equipment: {
        pvInverter: { state: 'NONE' },
        storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
        gateway: { label: 'Tesla Gateway 3', count: 2 },
      },
      evaluation: evaluateServiceTopology(landed),
    });
    expect(iv.sections.flatMap(s => s.items).find(i => i.id === 'behavior.pv-landing')?.state).toBe('answered');
    const dcInput = evaluateServiceTopology(landed).checks.filter(c => c.id === 'pv.dc-input');
    expect(dcInput).toHaveLength(4);
    expect(dcInput.every(c => c.conclusion === 'PASS')).toBe(true);
  });

  it('nothing is recorded by recommending — the graph is untouched until answerPvLanding is called', () => {
    const t = rays();
    const before = JSON.stringify(t);
    recommendStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units: invertingUnits(t) });
    expect(JSON.stringify(t)).toBe(before);
    expect(invertingUnits(t).every(u => u.pvDcStcKw === null || u.pvDcStcKw === undefined)).toBe(true);
  });

  it('labels each unit across the site, with its system where there is more than one', () => {
    const t = rays();
    const labels = unitDisplayLabels(t);
    const ids = invertingUnits(t).map(u => u.id);
    expect(labels[ids[0]]).toMatch(/^Tesla Powerwall 3 #1 \(.+\)$/);
    expect(labels[ids[3]]).toMatch(/^Tesla Powerwall 3 #4 \(.+\)$/);
  });
});

describe('the published limits are never exceeded', () => {
  it('MPPT count: each string takes one MPPT input — never two strings paralleled on one', () => {
    const units = [unit('a', lim({ mppts: 2 })), unit('b', lim({ mppts: 2 })), unit('c', lim({ mppts: 2 }))];
    const six = recommendStringAssignment({ strings: [5, 5, 5, 5, 5, 5], moduleWatts: 400, units });
    if (six.ok === false) throw new Error(six.reason);
    expect(Object.values(six.perUnit).map(s => s.length)).toEqual([2, 2, 2]);
    const seven = recommendStringAssignment({ strings: [5, 5, 5, 5, 5, 5, 5], moduleWatts: 400, units });
    expect(seven).toEqual({ ok: false, reason: '7 strings need 7 MPPT inputs; the 3 units publish 6.' });
  });

  it('MPPT count binds even where the least-loaded unit would otherwise take another string', () => {
    // Four equal strings; unit a has ONE input, b has three. Spreading alone would put a second on a.
    const units = [unit('a', lim({ mppts: 1 })), unit('b', lim({ mppts: 3 }))];
    const r = recommendStringAssignment({ strings: [2, 2, 2, 2], moduleWatts: 400, units });
    if (r.ok === false) throw new Error(r.reason);
    expect(r.perUnit).toEqual({ a: [2], b: [2, 2, 2] });
  });

  it('kW STC: no unit is given more than it accepts, even where filling the first unit would "fit" the MPPTs', () => {
    // 4 kW per unit, 10 × 400 W strings = 4 kW each: one per unit, never two on one.
    const units = [unit('a', lim({ maxStcKw: 4 })), unit('b', lim({ maxStcKw: 4 }))];
    const r = recommendStringAssignment({ strings: [10, 10], moduleWatts: 400, units });
    if (r.ok === false) throw new Error(r.reason);
    expect(r.perUnit).toEqual({ a: [10], b: [10] });
    const over = recommendStringAssignment({ strings: [10, 10, 1], moduleWatts: 400, units });
    expect(over).toEqual({ ok: false, reason: 'The array is 8.40 kW STC; the units accept 8.00 kW in total.' });
  });

  it('a single string larger than any unit accepts is refused with the reason', () => {
    const r = recommendStringAssignment({ strings: [11], moduleWatts: 400, units: [unit('a', lim({ maxStcKw: 4 })), unit('b', lim({ maxStcKw: 4 }))] });
    expect(r).toEqual({ ok: false, reason: 'A 11-module string (4.40 kW STC) is more than any unit accepts (4.00 kW).' });
  });

  it('where largest-first greedy dead-ends, it backtracks to the assignment that fits (3+3 | 2+2+2 into 6 + 6)', () => {
    const units = [unit('a', lim({ maxStcKw: 6, mppts: 3 })), unit('b', lim({ maxStcKw: 6, mppts: 3 }))];
    const r = recommendStringAssignment({ strings: [3, 3, 2, 2, 2], moduleWatts: 1000, units });
    if (r.ok === false) throw new Error(r.reason);
    expect(Object.values(r.perUnit).map(s => [...s].sort()).sort()).toEqual([[2, 2, 2], [3, 3]]);
    expect(Object.values(r.unitKw)).toEqual([6, 6]);
  });

  it('no packing fits ⇒ null with the reason, never a partial assignment', () => {
    // 7 + 7 + 6 = 20 kW into two 10 kW units: the totals, the MPPTs and the largest string all pass,
    // but every pair of strings exceeds 10 kW, so no packing exists.
    const units = [unit('a', lim({ maxStcKw: 10, mppts: 3 })), unit('b', lim({ maxStcKw: 10, mppts: 3 }))];
    const r = recommendStringAssignment({ strings: [7, 7, 6], moduleWatts: 1000, units });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toMatch(/^No assignment fits every unit’s published PV inputs/);
  });

  it('respects each unit\'s OWN limits where the units differ', () => {
    const units = [unit('small', lim({ maxStcKw: 1.8, mppts: 1 })), unit('big', lim({ maxStcKw: 20, mppts: 6 }))];
    const r = recommendStringAssignment({ strings: [5, 5, 4], moduleWatts: 400, units });
    if (r.ok === false) throw new Error(r.reason);
    // 4 × 400 W = 1.6 kW is the only string the 1.8 kW unit can take, and its one MPPT takes only one.
    expect(r.perUnit).toEqual({ small: [4], big: [5, 5] });
  });
});

describe('a search that runs out is not a proof that nothing fits', () => {
  it('hitting the search limit says so — it does not tell the installer to revise a design that fits', () => {
    // 3+3 | 2+2+2 into 6 + 6 fits (the backtracking case above); with a search limit of 2 placements
    // SolarPro gives up before finding it, and must say THAT, not "no assignment fits".
    const units = [unit('a', lim({ maxStcKw: 6, mppts: 3 })), unit('b', lim({ maxStcKw: 6, mppts: 3 }))];
    const input = { strings: [3, 3, 2, 2, 2], moduleWatts: 1000, units };
    expect(recommendStringAssignment(input).ok).toBe(true);
    const r = recommendStringAssignment(input, { searchBudget: 2 });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.reason).toMatch(/search limit/);
      expect(r.reason).not.toMatch(/No assignment fits|revise the string design/);
    }
    // …and a PROVEN no-fit still says so (the no-packing case, untouched by the limit).
    const none = recommendStringAssignment({ strings: [7, 7, 6], moduleWatts: 1000,
      units: [unit('a', lim({ maxStcKw: 10, mppts: 3 })), unit('b', lim({ maxStcKw: 10, mppts: 3 }))] });
    expect(none.ok).toBe(false);
    if (none.ok === false) expect(none.reason).toMatch(/^No assignment fits/);
  });
});

describe('no recommendation without the facts it needs — each with its reason', () => {
  it('no strings, no wattage, no units', () => {
    expect(recommendStringAssignment({ strings: [], moduleWatts: 440, units: [unit('a')] }))
      .toEqual({ ok: false, reason: 'The strings have not been derived yet, so there is nothing to assign.' });
    expect(recommendStringAssignment({ strings: [9], moduleWatts: null, units: [unit('a')] }).ok).toBe(false);
    expect(recommendStringAssignment({ strings: [9], moduleWatts: 440, units: [] }))
      .toEqual({ ok: false, reason: 'There is no battery with PV inputs to land the strings on.' });
  });

  it('a unit that publishes no PV input limits is never recommended onto', () => {
    const r = recommendStringAssignment({ strings: [9], moduleWatts: 440, units: [unit('a'), { id: 'b', label: 'Mystery ESS', pvInputLimits: null }] });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toMatch(/^Mystery ESS publishes no PV input limits/);
  });
});

describe('reading a recorded landing back, and judging a hand-made one', () => {
  it('a recorded landing reads back as a wiring consistent with each unit\'s recorded kW; one these strings cannot reproduce is not guessed at', () => {
    const t = rays();
    const ids = invertingUnits(t).map(u => u.id);
    const hand = ok(answerPvLanding(t, { [ids[0]]: [9, 9, 9, 8], [ids[1]]: [2] }, 440, 37));
    const back = recordedStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units: invertingUnits(hand) });
    expect(back).toEqual([ids[0], ids[0], ids[0], ids[0], ids[1]]);
    // The design changed (strings 10/9/9/6/3): no subset lands 2 modules on #2 — not a landing of these strings.
    expect(recordedStringAssignment({ strings: [10, 9, 9, 6, 3], moduleWatts: 440, units: invertingUnits(hand) })).toBeNull();
    // Nothing recorded ⇒ nothing to read back.
    expect(recordedStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units: invertingUnits(t) })).toBeNull();
  });

  it('the recommended landing, once accepted, reads back as itself', () => {
    const t = rays();
    const rec = recommendStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units: invertingUnits(t) });
    if (rec.ok === false) throw new Error(rec.reason);
    const landed = ok(answerPvLanding(t, rec.perUnit, 440, 37));
    const back = recordedStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units: invertingUnits(landed) });
    expect(sameAssignment(back, rec.unitOf)).toBe(true);
  });

  it('the record holds each unit\'s kW, not which string: the read-back reproduces the kW, not necessarily the rows saved', () => {
    // [5, 4, 3, 2] saved as [B, A, A, B] records A = 7, B = 7 modules. The graph keeps those two
    // figures (answerPvLanding), so any wiring with the same per-unit kW is the same record.
    const units = [unit('A'), unit('B')];
    const saved = ['B', 'A', 'A', 'B'];
    const kw = (perUnit: Record<string, number[]>) => Object.fromEntries(
      Object.entries(perUnit).map(([id, ns]) => [id, ns.reduce((a, b) => a + b, 0) * 400 / 1000]));
    const recorded = kw(stringsPerUnit([5, 4, 3, 2], saved, ['A', 'B']));
    const back = recordedStringAssignment({
      strings: [5, 4, 3, 2], moduleWatts: 400, units: units.map(u => ({ ...u, pvDcStcKw: recorded[u.id] })),
    });
    expect(back).not.toBeNull();
    expect(kw(stringsPerUnit([5, 4, 3, 2], back!, ['A', 'B']))).toEqual(recorded);
  });

  it('a valid record reads back VALID — inside each unit\'s own MPPT count where one exists', () => {
    // A has 2 MPPT inputs, B has 1. [B, A, A] on strings [4, 2, 2] is a valid landing (B: one string,
    // A: two). Read back with no MPPT bound it came back as [A, B, B] — two strings on B's one MPPT —
    // and the editor then reported a violation on a record that has none.
    const units = [unit('A', lim({ mppts: 2 })), unit('B', lim({ mppts: 1 }))];
    const input = { strings: [4, 2, 2], moduleWatts: 400, units: units.map((u, k) => ({ ...u, pvDcStcKw: [1.6, 1.6][k] })) };
    const back = recordedStringAssignment(input);
    expect(back).toEqual(['B', 'A', 'A']);
    expect(assignmentViolations(input, back!)).toEqual([]);
  });

  it('a record that is over a unit\'s MPPT count still reads back — as the over-full unit it is', () => {
    // Recorded A = 3 strings' worth on a 2-MPPT unit: no MPPT-bounded wiring reproduces it, so it is
    // read back unbounded and the violation is named rather than the record being hidden.
    const units = [unit('A', lim({ mppts: 2 }), 1.2), unit('B', lim({ mppts: 2 }), 0)];
    const input = { strings: [1, 1, 1], moduleWatts: 400, units };
    expect(recordedStringAssignment(input)).toEqual(['A', 'A', 'A']);
    expect(assignmentViolations(input, ['A', 'A', 'A'])).toEqual(['Unit has 2 MPPT inputs; 3 strings are assigned to it.']);
  });

  it('a hand-made assignment over a unit\'s MPPT count or kW STC is named, unit by unit', () => {
    const units = [unit('a', lim({ mppts: 2, maxStcKw: 4 })), unit('b')];
    const input = { strings: [5, 5, 5], moduleWatts: 400, units };
    expect(assignmentViolations(input, ['a', 'a', 'a'], { a: 'PW #1' })).toEqual([
      'PW #1 has 2 MPPT inputs; 3 strings are assigned to it.',
      'PW #1 accepts 4 kW STC; 6.00 kW is assigned to it.',
    ]);
    expect(assignmentViolations(input, ['a', 'b', 'b'])).toEqual([]);
    expect(stringsPerUnit([5, 5, 5], ['a', 'b', null], ['a', 'b'])).toEqual({ a: [5], b: [5] });
  });

  it('a single Powerwall 3 on a 200 A house: every string on its one unit, inside 6 MPPT / 20 kW', () => {
    const one = ok(answerBackup(ok(answerServiceRating(null, 200)), 'whole', {
      gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', totalUnits: 1,
    }));
    const units = invertingUnits(one);
    expect(units).toHaveLength(1);
    const r = recommendStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units });
    if (r.ok === false) throw new Error(r.reason);
    expect(r.perUnit).toEqual({ [units[0].id]: RAYS_STRINGS });
    expect(r.unitKw[units[0].id]).toBe(16.28);
  });
});
