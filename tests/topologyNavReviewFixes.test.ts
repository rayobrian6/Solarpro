// ═══════════════════════════════════════════════════════════════════════════
// 🚨 CLOSURE SLICE 1 — REVIEW FIXES (pure: writers, the interview, computeSystem, the page source).
// The route-level half is tests/topologyNavReviewFixes.postgres.test.ts; the clicked half is
// tests/topologyNavReviewFixes.component.test.tsx.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  answerBackup, answerDistribution, answerServiceRating, answerStorageLanding, answerSystemsArrangement,
  answerInterconnection, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { answerSystemEquipment, batteryCircuitOf } from '@/lib/electrical/systemConfigSystemEquipment';
import { computeSystem, type ComputedSystemInput } from '@/lib/computed-system';
import { csStringInput } from './goldens/wave0-fixtures';
import { planArchitectureResolution } from '@/lib/electrical/architectureResolution';
import type { ElectricalProjectModel } from '@/lib/electrical/projectModel';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { findInterviewItem, requiredQueue } from '@/lib/electrical/systemConfigPlacement';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { evaluateServiceTopology } from '@/lib/electrical/serviceTopology';
import { answerGenerationPanelPart } from '@/lib/electrical/systemConfigGenerationPanels';
import { equipmentInstancesFromTopology, reconcileQuantities } from '@/lib/electrical/topologyEquipment';
import { bomFromServiceTopology } from '@/lib/bom/topologyBom';
import { serviceTopologyScheduleRows, serviceTopologyProcurement } from '@/lib/permit/utils/serviceTopologySchedule';
import {
  sccrAmpsFromKa, sccrKaFromAmps, answerAvailableFaultCurrent, answerExistingService, answerIsolationRequired,
  answerPanel, soleServicePanel,
} from '@/lib/electrical/systemConfigAnswers';

const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';
const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };

function raysJob(): ServiceTopology {
  let t = ok(answerServiceRating(null, 400));
  t = ok(answerDistribution(t, 'two-main-panels'));
  t = ok(answerBackup(t, 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 4,
    unitsPerPanel: { [t.panels[0].id]: 2, [t.panels[1].id]: 2 } }));
  t = { ...t, solarCoupling: 'dc-coupled-storage' };
  t = ok(answerStorageLanding(t, 'der-aggregation-panel'));
  t = ok(answerSystemsArrangement(t, 'independent-branch'));
  return ok(answerInterconnection(t, 'manufacturer-integrated'));
}

const PAGE = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 one battery circuit, as the graph records it — the owner computeSystem\'s battery run reads', () => {
  it('batteryCircuitOf: the commissioned setting\'s current and OCPD; the LARGEST when systems differ; null without units', () => {
    const t = raysJob();
    expect(batteryCircuitOf(t)).toEqual({ continuousOutputA: 48, ocpdA: 60 });
    let both = t;
    for (const d of t.domains) both = ok(answerSystemEquipment(both, d.id, { outputConfigKw: 7.6 }));
    expect(batteryCircuitOf(both)).toEqual({ continuousOutputA: 31.7, ocpdA: 40 });
    const mixed = ok(answerSystemEquipment(t, t.domains[0].id, { outputConfigKw: 7.6 }));
    expect(batteryCircuitOf(mixed)).toEqual({ continuousOutputA: 48, ocpdA: 60 });
    expect(batteryCircuitOf(ok(answerServiceRating(null, 200)))).toBeNull();
    expect(batteryCircuitOf(null)).toBeNull();
  });

  it('computeSystem: BATTERY_TO_BUI_RUN is protected at the recorded circuit OCPD, the busbar contribution untouched', () => {
    const base = {
      ...csStringInput(), batteryIds: [PW3], batteryCount: 2, batteryBackfeedA: 60, batteryContinuousOutputA: 31.7,
      interconnectionMethod: 'LOAD_SIDE', panelBusRating: 400, mainPanelAmps: 400,
    } as ComputedSystemInput;
    const run = (input: ComputedSystemInput) => computeSystem(input).runs.find(r => r.id === 'BATTERY_TO_BUI_RUN');
    expect(run({ ...base, batteryCircuitOcpdA: 40 })!.ocpdAmps).toBe(40);
    expect(run({ ...base, batteryCircuitOcpdA: 40 })!.continuousCurrent).toBe(31.7);
    // Without a recorded circuit the run keeps the caller's figure, as before.
    expect(run(base)!.ocpdAmps).toBe(60);
  });

  it('the page sizes its own battery run from the graph\'s circuit before the catalogue maximum (both payloads)', () => {
    const live = PAGE.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const runPayload = live.slice(live.indexOf('batteryContinuousOutputA: includePoi && config.batteryId'),
      live.indexOf('generatorOutputBreakerA: includePoi'));
    expect(runPayload).toContain('batteryCircuitOf(svcTopology)?.continuousOutputA');
    expect(runPayload).toContain('batteryCircuitOcpdA: includePoi && config.batteryId ? batteryCircuitOf(svcTopology)?.ocpdA');
    const calcAt = live.indexOf('batteryCount: config.batteryCount || 0,');
    const calc = live.slice(calcAt, live.indexOf('batteryModel: config.batteryModel', calcAt));
    expect(calc).toContain('batteryCircuitOf(svcTopology)?.continuousOutputA');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the PV coupling: no phantom inverter decision, and a recorded decision can be changed', () => {
  const model = (over: Record<string, unknown>) => ({
    solarCouplingProvenance: { source: 'none', basis: '' }, architectureChoices: [],
    hasExternalInverter: false, externalInverterId: null, externalInverterOrigin: null, ...over,
  }) as unknown as ElectricalProjectModel;
  const NOW = new Date('2026-10-03T00:00:00Z');
  const plan = (r: ReturnType<typeof planArchitectureResolution>) => { if (r.ok === false) throw new Error(r.message); return r.plan; };

  it('a first AC answer with NO inverter on file records the decision only — never an inverter provenance', () => {
    const p = plan(planArchitectureResolution(model({}), 'ac-coupled-inverter', NOW));
    const prov = p.equipmentPatch.provenance as Record<string, { basis: string }>;
    expect(Object.keys(prov)).toEqual(['architecture']);
    expect(prov.architecture.basis).toMatch(/separate AC PV inverter \(none is selected yet\)/);
    expect(p.summary).toBe('Electrical architecture resolved to ac-coupled-inverter');
  });

  it('a DC answer with nothing to retire records a DC decision (it used to write the AC branch\'s text and an inverter)', () => {
    const p = plan(planArchitectureResolution(model({}), 'dc-coupled-storage', NOW));
    const prov = p.equipmentPatch.provenance as Record<string, { basis: string }>;
    expect(Object.keys(prov)).toEqual(['architecture']);
    expect(prov.architecture.basis).toMatch(/PV DC coupled to storage/);
    expect(p.retiredExternalInverter).toBe(false);
  });

  it('control: an AC answer with an inverter on file still confirms it', () => {
    const p = plan(planArchitectureResolution(model({ hasExternalInverter: true, externalInverterId: 'x' }), 'ac-coupled-inverter', NOW));
    expect(Object.keys(p.equipmentPatch.provenance as object).sort()).toEqual(['architecture', 'inverter']);
  });

  it('a recorded decision is refused without change intent, and re-planned with it (DC retires the inverter on file)', () => {
    const decided = model({
      solarCouplingProvenance: { source: 'service-topology', basis: '' }, hasExternalInverter: true,
      externalInverterId: 'tesla-solar-inverter-5p7k',
    });
    expect(planArchitectureResolution(decided, 'dc-coupled-storage', NOW).ok).toBe(false);
    const p = plan(planArchitectureResolution(decided, 'dc-coupled-storage', NOW, { change: true }));
    expect(p.retiredExternalInverter).toBe(true);
    expect(p.equipmentPatch.inverter).toBeNull();
  });

  it('a fresh PV job with no inverter and no storage: the inverter question asks it — no one-option coupling radio', () => {
    const t = ok(answerServiceRating(null, 200));
    const iv = buildSystemConfigInterview({
      pvArray: resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' }),
      topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
      equipment: { pvInverter: { state: 'UNDECIDED' }, storage: null, gateway: null },
      evaluation: evaluateServiceTopology(t),
    });
    const need = findInterviewItem(iv, 'engineering.needs.interconnection.solarCoupling');
    expect(need?.options).toBeUndefined();
    const queue = requiredQueue(iv).map(i => i.id);
    expect(queue).toContain('equipment.pv-inverter');
    expect(queue).not.toContain('engineering.needs.interconnection.solarCoupling');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the generation panel part reaches the consumers its editor promises', () => {
  it('instances → BOM line, quantity and the procurement schedule name the chosen part; none chosen orders nothing', () => {
    const t = raysJob();
    expect(equipmentInstancesFromTopology(t).filter(i => i.kind === 'der-aggregation-panel').map(i => i.productId)).toEqual(['', '']);
    expect(bomFromServiceTopology(t).items.filter(i => i.id.startsWith('topology-der-aggregation'))).toEqual([]);
    const chosen = ok(answerGenerationPanelPart(t, t.aggregationPanels[0].id, { productId: 'Eaton BR816L125RP', busbarRatingA: 125, sccrA: 10_000 }));
    const bom = bomFromServiceTopology(chosen);
    expect(bom.items.filter(i => i.partNumber === 'Eaton BR816L125RP').map(i => i.quantity)).toEqual([1]);
    expect(reconcileQuantities(chosen, bom.quantities)).toEqual([]);
    const rows = serviceTopologyScheduleRows(chosen).filter(r => r.deviceType === 'der-aggregation-panel');
    expect(rows.map(r => r.model)).toEqual(['Eaton BR816L125RP', '']);
    expect(serviceTopologyProcurement(chosen).find(l => l.productId === 'Eaton BR816L125RP')?.quantity).toBe(1);
  });

  it('the item states the SCCR in kA, as it is entered', () => {
    const t = ok(answerGenerationPanelPart(raysJob(), 'agg-1', { productId: 'P', busbarRatingA: 125, sccrA: 22_000 }));
    expect(sccrAmpsFromKa(22)).toBe(22_000);
    expect(sccrKaFromAmps(10_000)).toBe(10);
    const r = answerGenerationPanelPart(t, 'agg-1', { sccrA: 10_000 });
    expect(r.ok && r.did).toMatch(/SCCR 10 kA/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 raising the commissioned setting re-sizes the generation panel SolarPro sized itself', () => {
  /** The reviewer's job: 400 A / two MSPs, 4 PW3 at 7.6 kW, independent paths, each system its own panel. */
  function at76WithPanels(): ServiceTopology {
    let t = ok(answerServiceRating(null, 400));
    t = ok(answerDistribution(t, 'two-main-panels'));
    t = ok(answerBackup(t, 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 4,
      unitsPerPanel: { [t.panels[0].id]: 2, [t.panels[1].id]: 2 } }));
    t = ok(answerSystemsArrangement(t, 'independent-branch'));
    for (const d of t.domains) t = ok(answerSystemEquipment(t, d.id, { outputConfigKw: 7.6 }));
    return ok(answerStorageLanding(t, 'der-aggregation-panel'));
  }
  const aggOf = (t: ServiceTopology, domainId: string) => t.aggregationPanels.find(a => a.domainId === domainId)!;
  const panelFails = (t: ServiceTopology, aggId: string) => evaluateServiceTopology(t).checks
    .filter(c => c.scope === `aggregation:${aggId}` && c.conclusion === 'FAIL').map(c => c.id);

  it('no part chosen: 7.6 → 11.5 kW rebuilds it to the new current (was 80 A / 80 A, FAILING, with no control to clear it)', () => {
    const t = at76WithPanels();
    const d1 = t.domains[0].id;
    expect([aggOf(t, d1).outputOcpdA, aggOf(t, d1).busbarRatingA]).toEqual([80, 80]);
    const raised = ok(answerSystemEquipment(t, d1, { outputConfigKw: 11.5 }));
    expect([aggOf(raised, d1).outputOcpdA, aggOf(raised, d1).busbarRatingA]).toEqual([125, 125]);
    expect(aggOf(raised, d1).inputs.map(i => i.ocpdA)).toEqual([60, 60]);
    expect(panelFails(raised, aggOf(raised, d1).id)).toEqual([]);
    // The other system's panel is untouched.
    expect(aggOf(raised, t.domains[1].id)).toEqual(aggOf(t, t.domains[1].id));
  });

  it('a part already chosen keeps its own numbers — and the engine re-checks them against the new current', () => {
    let t = at76WithPanels();
    const d1 = t.domains[0].id;
    t = ok(answerGenerationPanelPart(t, aggOf(t, d1).id, { productId: 'small-100', busbarRatingA: 100, sccrA: 10_000 }));
    const raised = ok(answerSystemEquipment(t, d1, { outputConfigKw: 11.5 }));
    expect(aggOf(raised, d1)).toMatchObject({ productId: 'small-100', busbarRatingA: 100, sccrA: 10_000 });
    expect(aggOf(raised, d1).inputs.map(i => i.ocpdA)).toEqual([60, 60]);
    expect(panelFails(raised, aggOf(raised, d1).id)).toContain('aggregation.busbar');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 one nameplate, one answer: a one-panel service\'s Verify AIC IS MSP #1\'s SCCR', () => {
  const house = () => {
    let t = ok(answerServiceRating(null, 200));
    t = ok(answerInterconnection(t, 'load-side-busbar'));
    t = ok(answerIsolationRequired(t, false));
    return ok(answerAvailableFaultCurrent(t, 10_000));
  };
  const interview = (t: ServiceTopology) => buildSystemConfigInterview({
    pvArray: resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-fence-ps1' }),
    topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
    evaluation: evaluateServiceTopology(t),
  });
  const verify = (t: ServiceTopology, sccrA: number) => ok(answerExistingService(t, {
    existing: true, manufacturer: 'Square D', catalogNumber: 'QO', mainArrangement: 'one main',
    feederArrangement: 'none', sccrA, verified: true,
  }));

  it('answered in the Verify dialog: the chain stops waiting on MSP #1, and the panel row reads it back', () => {
    const before = house();
    expect(requiredQueue(interview(before)).map(i => i.id)).toContain('engineering.needs.sccr:msp-1');
    const t = verify(before, 22_000);
    expect(t.panels[0].sccrA).toBe(22_000);
    expect(requiredQueue(interview(t)).map(i => i.id)).not.toContain('engineering.needs.sccr:msp-1');
    expect(evaluateServiceTopology(t).checks.find(c => c.id === 'sccr.chain')?.conclusion).toBe('PASS');
  });

  it('answered on the panel row instead: the Verify AIC reads the same figure', () => {
    const t = ok(answerPanel(verify(house(), 22_000), 'msp-1', { sccrA: 25_000 }));
    expect([t.panels[0].sccrA, t.service.existingEquipment?.sccrA]).toEqual([25_000, 25_000]);
  });

  it('a NEW service assembly does not inherit the old one\'s label; two panels are two assemblies', () => {
    const t = ok(answerExistingService(verify(house(), 22_000), { existing: false }));
    expect(t.panels[0].sccrA).toBeNull();
    const two = ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));
    const v = verify(two, 42_000);
    expect(v.panels.map(p => p.sccrA ?? null)).toEqual([null, null]);
    expect(soleServicePanel(two)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('compliance help text names a place that is in the navigation', () => {
  it('an unrecorded interconnection method sends the installer to System Config, not the service topology', () => {
    const cs = computeSystem({ ...csStringInput(), interconnectionMethod: 'UNRESOLVED' } as ComputedSystemInput);
    const issue = cs.issues.find(i => i.code === 'INTERCONNECTION_METHOD_UNRESOLVED')!;
    expect(issue.suggestion).toMatch(/System Configuration card in System Config/);
    expect(`${issue.message} ${issue.suggestion}`).not.toMatch(/service topology/i);
  });
});
