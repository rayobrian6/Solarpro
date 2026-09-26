// ============================================================================
// EVERY CONSUMER SEES THE SAME NUMBER OF GATEWAYS.
//
// Ray, 2026-09-26: "Once the solver determines 2 Envoys, every consumer must see
// 2 Envoys: Engineering UI, Diagram, SLD PDF, E-1, PV-4A, permit snapshot,
// equipment schedule, BOM, pricing, conductor/OCPD calculations, CT layout,
// commissioning information, save/reload. There must not be drawing = 2,
// BOM = 1 ever again."
//
// Part 1 walks one single-system design across the IQ Combiner 5C's position
// boundary (limit − 1, limit, limit + 1, 2 × limit, 2 × limit + 1 branches)
// through every engineering-side consumer. Part 2 builds one oversized permit
// package and reads the count off every sheet, the snapshot and the permit
// BOM. The mutation that proves these would catch the old `quantity = 1` is
// tests/gatewayMultiplicityMutation.test.ts (a module mock is file-wide).
// ============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { renderSLDProfessional } from '@/lib/sld-professional-renderer';
import { computeSystem } from '@/lib/computed-system';
import { planGatewayCount } from '@/lib/equipment/integratedBos';
import { microInput, DEVICES_FOR_BRANCHES, COMBINERS } from './support/sldVariantMatrix';
import { csMicroInput } from './goldens/wave0-fixtures';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { buildIntegratedEquipment } from '@/lib/permit/utils/integratedEquipment';
import { buildSLDInputFromPermit } from '@/lib/permit/utils/sldAdapter';
import { generateBOMForPermit } from '@/lib/permit/utils/bomForPermit';
import { buildPermitDesignSnapshot } from '@/lib/permit/snapshot/build';
import { buildComputeSystemShadow } from '@/lib/permit/utils/computedRuns';
import { pageNECCompliance } from '@/lib/permit/sections/electricalPages';
import { projectE1PhysicalSchedule } from '@/lib/permit/snapshot/electricalProjection';
import { bigRoofPermit, countMismatches, engineeringCounts, FIVE_C_BOUNDARY } from './support/gatewayMultiplicityCases';

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy.mockRestore(); warnSpy.mockRestore(); });

// ── Part 1 — the engineering side, at the 5C's position boundary ────────────

describe('the IQ Combiner 5C position boundary — every engineering consumer counts the same', () => {
  // 5C: 4 branch positions. limit − 1, limit, limit + 1, 2 × limit, 2 × limit + 1.
  it.each(FIVE_C_BOUNDARY)('%i branches → %i gateway(s) everywhere', (branches, want) => {
    const c = engineeringCounts(branches);
    expect(countMismatches(c, want), JSON.stringify(c)).toEqual([]);
  });

  it('the shared PV AC combiner panel exists exactly when there is more than one gateway — drawn AND bought', () => {
    for (const branches of [4, 5] as const) {
      const svg = renderSLDProfessional(microInput({ combiner: '5c', interconnection: 'LOAD_SIDE', ct: null, branches, mode: 'sheet' }));
      const drawn = /PV AC COMBINER PANEL</.test(svg);
      const cs = computeSystem({ ...csMicroInput(), totalPanels: DEVICES_FOR_BRANCHES[branches], inverterModel: 'IQ8+',
        combinerSelectionId: COMBINERS['5c'] } as any);
      expect(drawn, `${branches} branches drawn`).toBe(branches > 4);
      expect(cs.equipmentSchedule.some(r => r.tag === 'ACP-1'), `${branches} branches scheduled`).toBe(branches > 4);
    }
  });
});

// ── Part 2 — one oversized permit package ───────────────────────────────────

describe('an oversized permit package names two gateways on every sheet, in the snapshot and in the BOM', () => {
  const p = bigRoofPermit();
  const cad = generateCADLayout(p as never);

  it('the permit equipment plan: 2 × IQ Combiner 5C, 4 + 2 branches', () => {
    const bos = buildIntegratedEquipment(p, cad);
    expect(planGatewayCount(bos)).toBe(2);
    expect(bos.gatewayMultiplicity!.instances.map(i => i.branches.length)).toEqual([4, 2]);
  });

  it('E-1 draws both gateways and the shared panel', () => {
    const e1 = buildSLDInputFromPermit(p as never, cad);
    expect(e1.gateways?.map(g => g.label)).toEqual(['GATEWAY 1', 'GATEWAY 2']);
    const svg = renderSLDProfessional(e1);
    expect(svg).toContain('GATEWAY 2 — PV-R B5–B6');
    expect(svg).toMatch(/PV AC COMBINER PANEL</);
  });

  it('the permit engine sizes an output circuit per gateway', () => {
    const cs = buildComputeSystemShadow(p as never, cad);
    expect(cs?.gatewayInstances?.length).toBe(2);
    expect(cs?.runs.filter(r => /^GW\d+_FEEDER_RUN$/.test(String(r.id))).length).toBe(2);
  });

  it('the snapshot records the count (and so the digest identifies it)', () => {
    // The permit generator attaches the canonical engine result before it builds
    // the snapshot (generatePermit: input._computeSystem) — the route segments
    // PV-4B.1 prints come from it.
    const withEngine = { ...p, _computeSystem: buildComputeSystemShadow(p as never, cad) };
    const snap = buildPermitDesignSnapshot(withEngine as never, cad, { projectId: 'p1', designVersionId: 'v1' });
    expect(snap.electrical.gatewayMultiplicity).toMatchObject({ count: 2, deviceId: 'enphase-iq-combiner-5c', governing: 'limit:branchPositions' });
    expect(snap.electrical.gatewayMultiplicity!.sharedPanelModel).toBeTruthy();
    // PV-4B.1 — the conductor schedule lists each gateway's own output circuit,
    // and the whole-system feeder as leaving the shared panel.
    const labels = projectE1PhysicalSchedule(snap).map(s => s.sectionLabel);
    expect(labels).toEqual(expect.arrayContaining([
      'GATEWAY 1 OUTPUT → PV AC COMBINER PANEL',
      'GATEWAY 2 OUTPUT → PV AC COMBINER PANEL',
      'PV AC PANEL FEEDER → AC DISCONNECT',
    ]));
  });

  it('PV-4A states the count, the branches on each and who reads consumption, and the commissioning', () => {
    (p as any)._snapshot = buildPermitDesignSnapshot(p as never, cad, { projectId: 'p1', designVersionId: 'v1' });
    const html = pageNECCompliance(p as never, cad, 1, 1);
    expect(html).toContain('GATEWAYS (2):');
    expect(html).toContain('2 × IQ Combiner 5C');
    expect(html).toMatch(/GATEWAY 1: B1–B4/);
    expect(html).toMatch(/GATEWAY 2: B5–B6/);
    expect(html).toContain('COMMISSIONING:');
    expect(html).not.toContain('a single integrated device');
  });

  it('the permit BOM buys two combiners and the shared panel with one breaker per gateway output', () => {
    const bom = generateBOMForPermit(p as never, cad);
    const items = (bom as any).items ?? bom;
    const combiner = items.find((i: any) => i.category === 'combiner' && /IQ Combiner 5C/.test(i.model));
    expect(combiner?.quantity).toBe(2);
    expect(items.some((i: any) => i.category === 'combiner' && /PV AC Combiner Panel/.test(i.model))).toBe(true);
    const outBreakers = items.filter((i: any) => i.category === 'breaker' && /gateway output/.test(i.model));
    expect(outBreakers.reduce((s: number, i: any) => s + i.quantity, 0)).toBe(2);
  });
});
