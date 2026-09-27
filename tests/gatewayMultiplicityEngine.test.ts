// ============================================================================
// THE ELECTRICAL ENGINE SIZES EVERY GATEWAY IT IS TOLD ABOUT — no more, no less.
//
// Ray, 2026-09-26: "Once the solver determines 2 Envoys, every consumer must
// see 2 Envoys … conductor/OCPD calculations." A design that needs two IQ
// Combiners gets two output circuits (GW1/GW2_FEEDER_RUN), each sized for its
// own branches, landing in one shared PV AC combiner panel whose output is the
// old whole-system feeder. A design that needs one is byte-for-byte unchanged
// (the wave0 goldens pin that; this file pins the new shape).
// ============================================================================

import { describe, it, expect } from 'vitest';
import { computeSystem } from '../lib/computed-system';
import { computeMultiSystem, type MultiSubSystemInput } from '../lib/computed-multi-system';
import { csMicroInput } from './goldens/wave0-fixtures';

const micro = (panels: number, combinerSelectionId: string | null = 'enphase-iq-combiner-5c') => computeSystem({
  ...csMicroInput(), totalPanels: panels, combinerSelectionId,
} as any);

describe('single system: one output circuit per gateway, into a shared PV AC panel', () => {
  it('52 IQ8+ (4 branches) on a 5C: ONE gateway — no feeder runs, no panel, no instances', () => {
    const cs = micro(52);
    expect(cs.acBranchCount).toBe(4);
    expect(cs.gatewayInstances).toBeUndefined();
    expect(cs.runs.some(r => /^GW\d+_FEEDER_RUN$/.test(r.id))).toBe(false);
    expect(cs.runs.find(r => r.id === 'COMBINER_TO_DISCO_RUN')?.from).toBe('AC COMBINER');
    expect(cs.bomQuantities.acCombiner).toBe(1);
    expect(cs.equipmentSchedule.find(r => r.tag === 'COMB-1')?.qty).toBe(1);
    expect(cs.equipmentSchedule.some(r => r.tag === 'ACP-1')).toBe(false);
  });

  it('78 IQ8+ (6 branches) on a 5C: TWO gateways, each with its own sized output circuit', () => {
    const cs = micro(78);
    expect(cs.acBranchCount).toBe(6);
    expect(cs.gatewayInstances?.map(g => [g.label, g.branches.length])).toEqual([['GATEWAY 1', 4], ['GATEWAY 2', 2]]);
    const gw1 = cs.runs.find(r => r.id === 'GW1_FEEDER_RUN')!;
    const gw2 = cs.runs.find(r => r.id === 'GW2_FEEDER_RUN')!;
    expect(gw1.to).toBe('PV AC COMBINER PANEL');
    expect(gw1.continuousCurrent).toBeCloseTo(4 * 13 * 1.21, 6);
    expect(gw1.ocpdAmps).toBe(80);
    expect(gw2.continuousCurrent).toBeCloseTo(2 * 13 * 1.21, 6);
    expect(gw2.ocpdAmps).toBe(40);
    // Each feeder carries its neutral (L1 + L2 + N) and is conductor-sized for its own current.
    for (const r of [gw1, gw2]) {
      expect(r.conductorCount).toBe(3);
      expect(r.neutralRequired).toBe(true);
      expect(r.ampacityPass).toBe(true);
    }
    // The old whole-system feeder now leaves the shared panel — same current, same OCPD.
    const agg = cs.runs.find(r => r.id === 'COMBINER_TO_DISCO_RUN')!;
    expect(agg.from).toBe('PV AC COMBINER PANEL');
    expect(agg.continuousCurrent).toBeCloseTo(cs.acOutputCurrentA, 6);
    expect(agg.ocpdAmps).toBe(cs.acOcpdAmps);
    expect(cs.bomQuantities.acCombiner).toBe(2);
    expect(cs.equipmentSchedule.find(r => r.tag === 'COMB-1')?.qty).toBe(2);
    expect(cs.equipmentSchedule.find(r => r.tag === 'ACP-1')).toBeTruthy();
    // The conduit schedule carries the new circuits.
    expect(cs.conduitSchedule.filter(c => c.from.includes('GATEWAY')).length).toBe(2);
  });

  it('the MSP still sees ONE PV breaker for the whole system — the 120 % math is unchanged', () => {
    const one = computeSystem({ ...csMicroInput(), totalPanels: 78, combinerSelectionId: 'enphase-iq-combiner-6c' } as any);
    const two = micro(78);
    expect(two.backfeedBreakerAmps).toBe(one.backfeedBreakerAmps);
    expect(two.interconnectionPass).toBe(one.interconnectionPass);
  });

  it('the 6C takes 5 branches (quadplex): 65 IQ8+ → one; 78 → two', () => {
    expect(micro(65, 'enphase-iq-combiner-6c').gatewayInstances).toBeUndefined();
    expect(micro(78, 'enphase-iq-combiner-6c').gatewayInstances?.length).toBe(2);
  });

  it('the standalone Envoy counts current: 66 IQ8+ (79.86 A) → one; 67 (81.07 A) → two', () => {
    expect(micro(66, 'enphase-iq-gateway-standalone').gatewayInstances).toBeUndefined();
    const two = micro(67, 'enphase-iq-gateway-standalone');
    expect(two.gatewayInstances?.length).toBe(2);
    expect(two.gatewayInstances!.every(g => g.continuousCurrentA <= 80)).toBe(true);
  });
});

const lane = (key: 'roof' | 'ground', panels: number, sel = 'enphase-iq-combiner-5c'): MultiSubSystemInput => ({
  ...csMicroInput(), totalPanels: panels, combinerSelectionId: sel, subSystemKey: key,
} as any);

describe('hybrid: gateways counted over every array that shares a topology', () => {
  it('roof 26 + ground 13 IQ8+ on one 5C: ONE gateway, the lanes lose their own feeders', () => {
    const m = computeMultiSystem([lane('roof', 26), lane('ground', 13)]);
    const ids = m.aggregate.runs.map(r => String(r.id));
    expect(ids).not.toContain('roof:COMBINER_TO_DISCO_RUN');
    expect(ids).not.toContain('ground:COMBINER_TO_DISCO_RUN');
    const gw = m.aggregate.runs.find(r => r.id === 'GW1_FEEDER_RUN')!;
    // The site's only source: no shared panel, straight to the AC disconnect.
    expect(gw.to).toBe('AC DISCONNECT');
    expect(gw.continuousCurrent).toBeCloseTo(39 * 1.21, 6);
    expect(m.aggregate.gatewayInstances?.map(g => g.laneKeys)).toEqual([['roof', 'ground']]);
    expect(m.aggregate.bomQuantities.acCombiner).toBe(1);
    // The POI sees that ONE gateway's breaker, not two lane breakers.
    expect(m.aggregate.backfeedBreakerAmps).toBe(gw.ocpdAmps);
  });

  it('roof 52 + ground 52 on 5Cs (4 branches each): one gateway PER ARRAY — the engine is unchanged', () => {
    const m = computeMultiSystem([lane('roof', 52), lane('ground', 52)]);
    const ids = m.aggregate.runs.map(r => String(r.id));
    expect(ids).toContain('roof:COMBINER_TO_DISCO_RUN');
    expect(ids).toContain('ground:COMBINER_TO_DISCO_RUN');
    expect(ids.some(id => /^GW\d+_FEEDER_RUN$/.test(id))).toBe(false);
    expect(m.aggregate.gatewayInstances).toBeUndefined();
    expect(m.aggregate.bomQuantities.acCombiner).toBe(2);
  });

  it('roof 78 (6 branches) on 5Cs + ground on a recorded 6C: the roof array is SPLIT across two gateways', () => {
    const m = computeMultiSystem([lane('roof', 78), { ...lane('ground', 13), combinerSelectionId: 'enphase-iq-combiner-6c' } as any]);
    // roof → 2 × 5C; ground → its own 6C (a different recorded topology).
    expect(m.aggregate.gatewayInstances?.map(g => [g.deviceId, g.laneKeys])).toEqual([
      ['enphase-iq-combiner-5c', ['roof']],
      ['enphase-iq-combiner-5c', ['roof']],
      ['enphase-iq-combiner-6c', ['ground']],
    ]);
    const ids = m.aggregate.runs.map(r => String(r.id));
    expect(ids).not.toContain('roof:COMBINER_TO_DISCO_RUN');
    expect(ids).toContain('ground:COMBINER_TO_DISCO_RUN');   // whole-lane gateway keeps its feeder
    expect(ids.filter(id => /^GW\d+_FEEDER_RUN$/.test(id))).toEqual(['GW1_FEEDER_RUN', 'GW2_FEEDER_RUN']);
    expect(m.aggregate.runs.find(r => r.id === 'GW1_FEEDER_RUN')!.to).toBe('PV AC COMBINER PANEL');
    expect(m.aggregate.bomQuantities.acCombiner).toBe(3);
  });
});
