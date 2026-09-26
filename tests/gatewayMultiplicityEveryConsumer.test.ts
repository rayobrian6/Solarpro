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

// ── Part 3 — the multi-source sheet schedules what it draws ─────────────────
// A single system past one gateway now draws on the multi-source sheet, whose
// conductor schedule took the branch gauge from the 20 A ladder while the
// diagram printed the plan's callout: "#10 AWG THWN-2 + EGC" drawn over a
// "#12 AWG THWN-2" schedule row, on one sheet.

/** The sheet's text runs, in document order. */
const sheetTexts = (svg: string): string[] =>
  [...svg.matchAll(/>([^<]+)</g)].map(m => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()).filter(Boolean);

/** A branch-circuit schedule row: its gauge cell, its EGC row's gauge, and the
 *  gauge its voltage-drop row computed with. */
function branchRow(svg: string, desc: string) {
  const t = sheetTexts(svg);
  const at = t.map((s, i) => (s.endsWith(desc) ? i : -1)).filter(i => i >= 0);
  expect(at.length, `${desc} appears in the conductor schedule and the voltage-drop table`).toBe(2);
  const [sched, vd] = at;
  const egcAt = t.indexOf('EQUIPMENT GROUNDING CONDUCTOR (EGC)', sched);
  return { gauge: t[sched + 1], conduitSize: t[sched + 4], egc: t[egcAt + 1], vdGauge: t[vd - 1] };
}

/** The gauges the diagram's plan-drawn branch labels print — '#10 AWG THWN-2
 *  + EGC', which a long gauge list wraps before '+ EGC'. */
const drawnBranchGauges = (svg: string): string[] =>
  [...new Set([...sheetTexts(svg).join(' ¦ ').matchAll(/(#[\d/#]+ AWG) THWN-2(?: ¦)? \+ EGC/g)].map(m => m[1]))];

describe('the multi-source sheet schedules the branch conductors it draws', () => {
  const homeRun = 'PV-R AC BRANCH CIRCUITS — J-BOX TO COMBINER';
  const engineInput = () => microInput({ combiner: '5c', interconnection: 'LOAD_SIDE', ct: null, branches: 5, mode: 'sheet' });

  it('a single system on two gateways: the plan\'s #10 is drawn and scheduled; the trunk row states the engine run the diagram prints', () => {
    const input = engineInput();
    expect(input.microBranches!.every(b => /#10 THWN-2/.test(b.conductorCallout ?? ''))).toBe(true);
    const svg = renderSLDProfessional(input);
    // J-box → combiner is drawn from the plan…
    expect(drawnBranchGauges(svg)).toEqual(['#10 AWG']);
    expect(branchRow(svg, homeRun)).toMatchObject({ gauge: '#10 AWG THWN-2', vdGauge: '#10 AWG' });
    // …the array trunk from the engine's BRANCH_RUN, whose bundle the callout prints.
    const trunkRun = input.runs!.find(r => r.id === 'BRANCH_RUN')!;
    const hot = trunkRun.conductorBundle!.find(c => c.color !== 'GRN')!.gauge;
    const gnd = trunkRun.conductorBundle!.find(c => c.color === 'GRN')!.gauge;
    expect(sheetTexts(svg)).toEqual(expect.arrayContaining([expect.stringContaining(`×${hot.replace(' AWG', '')} THWN-2`), `1×${gnd.replace(' AWG', '')} GRN EGC`]));
    expect(branchRow(svg, 'PV-R AC BRANCH CIRCUITS — ARRAY TRUNK (5 BRANCHES)'))
      .toMatchObject({ gauge: `${hot} THWN-2`, egc: `${gnd} THWN-2`, vdGauge: hot });
  });

  it('a mixed plan: the row names both gauges, sizes the conduit on the heaviest and the voltage drop on the lightest', () => {
    const input = engineInput();
    input.microBranches![0] = { ...input.microBranches![0], conductorCallout: '2×#12 THWN-2\n1×#12 GRN EGC' };
    const svg = renderSLDProfessional(input);
    expect(drawnBranchGauges(svg)).toEqual(['#12/#10 AWG']);
    // 5 branches × L1 + L2, plus the EGC, is 11 conductors: #10 needs 1-1/4", #12 would fit 1".
    expect(branchRow(svg, homeRun)).toMatchObject({ gauge: '#12/#10 AWG THWN-2', conduitSize: '1-1/4"', vdGauge: '#12 AWG' });
  });

  it('the permit E-1 of the oversized package: the schedule agrees with the diagram', () => {
    const p = bigRoofPermit();
    const svg = renderSLDProfessional(buildSLDInputFromPermit(p as never, generateCADLayout(p as never)));
    const drawn = drawnBranchGauges(svg);
    expect(drawn.length).toBe(1);
    expect(branchRow(svg, homeRun).gauge).toBe(`${drawn[0]} THWN-2`);
    expect(branchRow(svg, 'PV-R AC BRANCH CIRCUITS — ARRAY TRUNK (6 BRANCHES)').gauge).toBe(`${drawn[0]} THWN-2`);
  });
});
