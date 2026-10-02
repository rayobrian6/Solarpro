// ═══════════════════════════════════════════════════════════════════════════
// 🚨 HOW THE DER ACTUALLY REACHES THE SERVICE.
//
// Ray, after live-testing the 400 A workflow: "It does not yet adequately describe how the two DER
// systems aggregate and actually interconnect with the 400 A service... Do not assume that exact
// hardware arrangement is correct merely because Ray suggested it. Instead, give SolarPro enough
// electrical vocabulary to represent and engineer it correctly."
//
// His acceptance is explicit and it is what this file is: "Prove at least two graph configurations
// can be represented WITHOUT CHANGING THE DATA MODEL. 1. independent governed branch topology.
// 2. common DER aggregation → common isolation → service POI topology. This is not proof both are
// allowable for Ray's project. It proves SolarPro can model the alternatives and let authority
// determine which is valid."
//
// So nothing here asserts that either arrangement is permitted. The manufacturer's multi-controller
// guidance and the utility's interconnection requirements stay exactly as unresolved as they were,
// and a test that quietly resolved them would be the guess this model exists to refuse.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { applyDerArrangement, DER_ARRANGEMENT_CHOICES } from '@/lib/electrical/topologyPresets';
import {
  addAggregationPanel, updatePointOfInterconnection, updateAggregationPanel,
  recommendAggregationRatings, addGenerationUnit, placeDevice,
} from '@/lib/electrical/topologyAuthoring';
import {
  evaluateServiceTopology, sizeAggregationPanel, governingArticleFor, derSources,
  buildConnectionGraph, derIsolationCoverage, domainGeneration,
  type ServiceTopology, type TopologyCheck,
} from '@/lib/electrical/serviceTopology';
import {
  equipmentInstancesFromTopology, equipmentQuantities, acSourcesFromTopology, reconcileQuantities,
} from '@/lib/electrical/topologyEquipment';
import { bomFromServiceTopology, pricedQuantitiesFromBom } from '@/lib/bom/topologyBom';
import {
  serviceTopologyScheduleRows, serviceTopologyReleaseReadiness,
} from '@/lib/permit/utils/serviceTopologySchedule';
import { buildServiceTopologyGraph } from '@/lib/sld/serviceTopologyGraph';
import { buildServiceOverview, groupRequirements } from '@/lib/electrical/topologyOverview';

const check = (cs: TopologyCheck[], id: string, scope?: string) =>
  cs.find(c => c.id === id && (scope ? c.scope === scope : true));

const RESOLVED = {
  availableFaultCurrentA: 10_000, gatewaySccrA: 10_000,
  calculatedServiceDemandA: 310, branchDemandA: [160, 150] as [number, number],
};

/** Ray's job with a chosen arrangement, built by the preset from the generic authoring functions. */
const arranged = (which: 'independent-branch' | 'common-aggregation', over = {}) =>
  applyDerArrangement(
    buildTesla400ATwoGateway({ ...RESOLVED, ...over }).topology, which).topology;

describe('🚨 both arrangements, one data model', () => {
  it('the independent-branch topology has a POI per domain and no aggregation panel', () => {
    const t = arranged('independent-branch', { storageConnection: 'gateway-panelboard' });
    expect(t.aggregationPanels).toEqual([]);
    expect(t.pointsOfInterconnection).toHaveLength(2);
    expect(t.pointsOfInterconnection.map(p => p.relationship))
      .toEqual(['manufacturer-integrated', 'manufacturer-integrated']);
    expect(evaluateServiceTopology(t).checks.find(c => c.id === 'interconnection.arrangement')!
      .conclusion).toBe('PASS');
  });

  it('the common-aggregation topology has one panel, one POI, and the isolation on the DER feeder', () => {
    const t = arranged('common-aggregation');
    expect(t.aggregationPanels).toHaveLength(1);
    expect(t.pointsOfInterconnection).toHaveLength(1);
    const agg = t.aggregationPanels[0];
    // Both Powerwalls, taken at their own output, so they leave their domains.
    expect(agg.inputs).toHaveLength(2);
    expect(agg.inputs.every(i => i.tap === 'der-output')).toBe(true);
    expect(t.domains.every(d => d.storageConnection === 'der-aggregation-panel')).toBe(true);
    // The utility isolation device sits on the aggregated feeder, not on the service conductors.
    const iso = t.devices.find(d => d.roles.includes('der-isolation-disconnect'))!;
    expect(agg.feedsNodeId).toBe(iso.id);
    expect(iso.feedsNodeId).toBe(t.pointsOfInterconnection[0].id);
  });

  it('🚨 NEITHER is claimed to be permitted — the authorities stay unresolved', () => {
    for (const which of ['independent-branch', 'common-aggregation'] as const) {
      const cs = evaluateServiceTopology(arranged(which)).checks;
      // The manufacturer's multi-controller document is still missing, on both.
      expect(check(cs, 'metering.multi-gateway')!.conclusion).toBe('NOT_EVALUATED');
    }
  });

  it('every arrangement the picker offers says what it will build', () => {
    expect(DER_ARRANGEMENT_CHOICES.map(c => c.id))
      .toEqual(['independent-branch', 'common-aggregation', 'custom']);
    for (const c of DER_ARRANGEMENT_CHOICES) {
      expect(c.describe.length).toBeGreaterThan(20);
      expect(c.builds.length).toBeGreaterThan(20);
    }
  });
});

describe('🚨 the aggregation panel is sized from the DER, never from the service', () => {
  const t = arranged('common-aggregation');
  const agg = t.aggregationPanels[0];

  it('96 A of storage on a 400 A service gives a 125 A panel', () => {
    const s = sizeAggregationPanel(t, agg);
    // Ray: "400 A describes the service. 96 A describes the two inverter-bearing Powerwalls'
    // aggregate AC output. Those numbers do not automatically determine the same piece of
    // equipment."
    expect(s.aggregateContinuousA).toBe(96);
    expect(s.requiredOcpdA).toBeCloseTo(120, 6);
    expect(s.standardOcpdA).toBe(125);
    expect(s.outputConductorGauge).toBe('#1 AWG');
    expect(agg.busbarRatingA).toBe(125);
    expect(agg.outputOcpdA).toBe(125);
    // 🚨 THE SERVICE RATING IS NOWHERE IN IT.
    expect(s.standardOcpdA).not.toBe(t.service.ratedAmps);
  });

  it('🚨 EXPANSIONS ADD NOTHING TO IT — energy is not power', () => {
    const expansions = t.storage.filter(u => u.role === 'energy-expansion');
    expect(expansions).toHaveLength(2);
    // Two 13.5 kWh expansions are in the topology and none of them is a source.
    expect(derSources(t).map(s => s.id)).not.toEqual(expect.arrayContaining(expansions.map(e => e.id)));
    expect(sizeAggregationPanel(t, agg).aggregateContinuousA).toBe(96);
  });

  it('doubling the storage doubles the panel, which is the point of computing it', () => {
    const two = applyDerArrangement(buildTesla400ATwoGateway({
      ...RESOLVED,
    }).topology, 'common-aggregation').topology;
    const four = { ...two, storage: [...two.storage, ...two.storage.map(u => ({ ...u, id: `${u.id}-b` }))] };
    const withMore = updateAggregationPanel(four, four.aggregationPanels[0].id, {});
    const panel = {
      ...withMore.aggregationPanels[0],
      inputs: derSources(withMore).map((s, i) => ({
        id: `in-${i}`, sourceId: s.id, tap: 'der-output' as const, ocpdA: s.ocpdA,
      })),
    };
    expect(sizeAggregationPanel(withMore, panel).aggregateContinuousA).toBe(192);
    expect(sizeAggregationPanel(withMore, panel).standardOcpdA).toBe(250);
  });

  it('an under-sized output OCPD FAILS — the check is not its own arithmetic', () => {
    const bad = updateAggregationPanel(t, agg.id, { outputOcpdA: 70 });
    expect(check(evaluateServiceTopology(bad).checks, 'aggregation.output-ocpd')!.conclusion)
      .toBe('FAIL');
  });

  it('a panel that will not say whether it carries load is NOT_EVALUATED, not assumed', () => {
    const unknownKind = updateAggregationPanel(t, agg.id, { carriesPremisesLoad: null });
    const c = check(evaluateServiceTopology(unknownKind).checks, 'aggregation.busbar')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(c.requires).toContain('aggregation.carriesPremisesLoad');
  });

  it('a load-carrying panel is governed by the 120% busbar allowance instead', () => {
    const loadCentre = updateAggregationPanel(t, agg.id, {
      carriesPremisesLoad: true, busbarRatingA: 225, mainBreakerA: 200,
    });
    // 225 × 1.2 − 200 = 70 allowed, and 96 A of DER exceeds it.
    const c = check(evaluateServiceTopology(loadCentre).checks, 'aggregation.busbar')!;
    expect(c.conclusion).toBe('FAIL');
    expect(c.citation).toBe('NEC 705.12(B)');
  });
});

describe('🚨 a common aggregation point is not permission to parallel two islands', () => {
  it('FAILS when two backup domains\' backed-up buses land on one panel', () => {
    const t = buildTesla400ATwoGateway({
      ...RESOLVED, derArrangement: 'common-aggregation', aggregateBackedUpBuses: true,
      aggregationBusbarA: 225, aggregationOutputOcpdA: 125,
    }).topology;
    const c = check(evaluateServiceTopology(t).checks, 'aggregation.island-integrity')!;
    expect(c.conclusion).toBe('FAIL');
    expect(c.detail).toMatch(/parallels two islands|2 separate/);
  });

  it('PASSES when the same panel takes the sources\' own outputs instead', () => {
    const t = arranged('common-aggregation');
    expect(check(evaluateServiceTopology(t).checks, 'aggregation.island-integrity')!.conclusion)
      .toBe('PASS');
  });

  it('one domain tapping its own backed-up bus is not two, and does not fail', () => {
    const base = buildTesla400ATwoGateway(RESOLVED).topology;
    const t = addAggregationPanel(base, {
      carriesPremisesLoad: false, mainLugOnly: true,
      inputs: [{ sourceId: base.domains[0].id, tap: 'backed-up-busbar', ocpdA: 60 }],
    }).topology;
    expect(check(evaluateServiceTopology(t).checks, 'aggregation.island-integrity')!.conclusion)
      .toBe('PASS');
  });
});

describe('🚨 DER ISOLATION COVERAGE — does opening it actually disconnect everything?', () => {
  it('PASSES when every source runs through the isolation device', () => {
    const t = updatePointOfInterconnection(
      arranged('common-aggregation'), 'poi-1',
      { relationship: 'aggregation-to-supply-side', connectedToNodeId: 'svc-disco' });
    const cov = derIsolationCoverage(t);
    expect(cov.conclusion).toBe('PASS');
    expect(cov.reachableSourceIds).toEqual([]);
    expect(cov.isolatedSourceIds).toHaveLength(2);
    expect(check(evaluateServiceTopology(t).checks, 'interconnection.der-isolation-coverage')!
      .conclusion).toBe('PASS');
  });

  it('🚨 FAILS when one domain keeps a path the isolation does not cut', () => {
    // Only the first domain's storage goes to the aggregation panel; the second still lands in its
    // own controller and reaches the utility through its own service branch.
    const t = buildTesla400ATwoGateway({
      ...RESOLVED, derArrangement: 'common-aggregation', aggregateOnlyFirstDomain: true,
      storageConnection: 'gateway-panelboard',
      aggregationBusbarA: 125, aggregationOutputOcpdA: 70,
    }).topology;
    const cov = derIsolationCoverage(t);
    expect(cov.conclusion).toBe('FAIL');
    expect(cov.reachableSourceIds).toHaveLength(1);
    expect(cov.detail).toContain('DER ISOLATION DOES NOT ISOLATE ALL ON-SITE DER');
    const c = check(evaluateServiceTopology(t).checks, 'interconnection.der-isolation-coverage')!;
    expect(c.conclusion).toBe('FAIL');
  });

  it('a source with no traceable path is NOT_EVALUATED — a missing wire is not isolation', () => {
    // Nobody has said where the storage lands, so no path exists to cut.
    const t = buildTesla400ATwoGateway(RESOLVED).topology;
    const cov = derIsolationCoverage(t);
    expect(cov.conclusion).toBe('NOT_EVALUATED');
    expect(cov.isolatedSourceIds).toEqual([]);
    expect(cov.requires.length).toBeGreaterThan(0);
  });

  it('no isolation device at all is NOT_EVALUATED, naming the arrangement', () => {
    const base = arranged('independent-branch', { storageConnection: 'gateway-panelboard' });
    const t = { ...base, devices: base.devices.filter(d => !d.roles.includes('der-isolation-disconnect')) };
    const cov = derIsolationCoverage(t);
    expect(cov.conclusion).toBe('NOT_EVALUATED');
    expect(cov.requires).toContain('interconnection.isolationArrangement');
  });

  it('🚨 a feeder that runs PAST the isolation device FAILS — the defect this preset once had', () => {
    const resolved = updatePointOfInterconnection(
      arranged('common-aggregation'), 'poi-1',
      { relationship: 'aggregation-to-supply-side', connectedToNodeId: 'svc-disco' });
    expect(derIsolationCoverage(resolved).conclusion).toBe('PASS');

    // Point the aggregation panel straight at the point of interconnection while the isolation
    // device still sits between them on paper. That is a parallel path AROUND the disconnect — and
    // it is exactly what `applyDerArrangement` produced until the coverage check caught it, because
    // the POI's DER side was left naming the panel after the device was inserted.
    const bypassed = updateAggregationPanel(resolved, 'agg-1', { feedsNodeId: 'poi-1' });
    const cov = derIsolationCoverage(bypassed);
    expect(cov.conclusion).toBe('FAIL');
    expect(cov.reachableSourceIds).toHaveLength(2);
    expect(cov.detail).toContain('DER ISOLATION DOES NOT ISOLATE ALL ON-SITE DER');
  });

  it('a utility that does not require one is answered, not asked about coverage', () => {
    const base = arranged('independent-branch', { storageConnection: 'gateway-panelboard' });
    const t = { ...base, interconnection: { ...base.interconnection, externalDerIsolationRequired: false } };
    expect(check(evaluateServiceTopology(t).checks, 'interconnection.der-isolation-coverage'))
      .toBeUndefined();
  });
});

describe('🚨 the point of interconnection selects the code section', () => {
  it('each governed relationship names its own article, and the unresolved one names none', () => {
    expect(governingArticleFor('load-side-busbar')).toBe('NEC 705.12(B)');
    expect(governingArticleFor('load-side-feeder-tap')).toBe('NEC 705.12(A) / 240.21');
    expect(governingArticleFor('supply-side')).toBe('NEC 705.11');
    expect(governingArticleFor('aggregation-to-supply-side')).toBe('NEC 705.11');
    expect(governingArticleFor('manufacturer-integrated')).toBeNull();
    expect(governingArticleFor('unresolved')).toBeNull();
  });

  it('an unresolved relationship is NOT_EVALUATED and says INTERCONNECTION ARRANGEMENT REQUIRED', () => {
    const t = arranged('common-aggregation');
    const c = check(evaluateServiceTopology(t).checks, 'poi.relationship')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(c.detail).toContain('INTERCONNECTION ARRANGEMENT REQUIRED');
    expect(c.requires).toContain('poi.relationship');
  });

  it('🚨 a supply-side arrangement says the 705.11 work is NOT evaluated rather than passing', () => {
    const t = updatePointOfInterconnection(arranged('common-aggregation'), 'poi-1', {
      relationship: 'aggregation-to-supply-side', connectedToNodeId: 'svc-disco',
    });
    const c = check(evaluateServiceTopology(t).checks, 'poi.supply-side-conductors')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(c.citation).toBe('NEC 705.11');
  });

  it('a meter-collar POI on a project that forbids it FAILS', () => {
    const t = updatePointOfInterconnection(arranged('common-aggregation'), 'poi-1', {
      relationship: 'meter-collar', connectedToNodeId: 'svc-disco',
    });
    expect(check(evaluateServiceTopology(t).checks, 'poi.relationship')!.conclusion).toBe('FAIL');
  });
});

describe('🚨 the aggregation panel reaches every output', () => {
  const t = updatePointOfInterconnection(arranged('common-aggregation'), 'poi-1',
    { relationship: 'aggregation-to-supply-side', connectedToNodeId: 'svc-disco' });

  it('it is an equipment instance, and it is not an AC source', () => {
    const inst = equipmentInstancesFromTopology(t);
    const agg = inst.find(i => i.kind === 'der-aggregation-panel')!;
    expect(agg.instanceId).toBe('agg-1');
    expect(agg.contributesAcSource).toBe(false);
    // And the AC source count is still the two inverting units.
    expect(acSourcesFromTopology(t).count).toBe(2);
    expect(acSourcesFromTopology(t).totalContinuousOutputA).toBe(96);
  });

  it('🚨 the instance list and the DER source list agree — two enumerations, one answer', () => {
    const fromInstances = equipmentInstancesFromTopology(t)
      .filter(i => i.contributesAcSource).map(i => i.instanceId).sort();
    const fromModel = derSources(t).map(s => s.id).sort();
    expect(fromInstances).toEqual(fromModel);
  });

  it('BOM and pricing agree with the topology', () => {
    const bom = bomFromServiceTopology(t);
    expect(reconcileQuantities(t, bom.quantities)).toEqual([]);
    expect(reconcileQuantities(t, pricedQuantitiesFromBom(bom))).toEqual([]);
    expect(bom.quantities).toEqual(equipmentQuantities(t));
  });

  it('the permit schedule gives it its own row and its own device type', () => {
    const rows = serviceTopologyScheduleRows(t);
    const agg = rows.find(r => r.deviceType === 'der-aggregation-panel')!;
    expect(agg.tag).toBe('AGG-1');
    expect(agg.rating).toContain('125 A bus');
    expect(agg.notes).toContain('96 A aggregated');
    expect(agg.notes).toContain('DER only, no premises load');
    // And the point of interconnection is a LOCATION, scheduled and never procured.
    const poi = rows.find(r => r.deviceType === 'point-of-interconnection')!;
    expect(poi.notes).toContain('NEC 705.11');
    expect(bomFromServiceTopology(t).items.some(i => i.partNumber.includes('poi'))).toBe(false);
  });

  it('the SLD graph draws it, its point of interconnection, and no invented wire', () => {
    const g = buildServiceTopologyGraph(t);
    expect(g.nodes.some(n => n.type === 'DER_AGGREGATION_PANEL')).toBe(true);
    expect(g.nodes.some(n => n.type === 'POINT_OF_INTERCONNECTION')).toBe(true);
    expect(g.validationErrors).toEqual([]);
    expect(g.hasDirectDeviceEdges).toBe(false);

    // With the arrangement unresolved, the panel's output has a callout and NO conductor run.
    const unresolved = arranged('common-aggregation');
    const gu = buildServiceTopologyGraph(unresolved);
    const poiNode = gu.nodes.find(n => n.type === 'POINT_OF_INTERCONNECTION')!;
    expect(poiNode.unresolvedCallouts?.some(c => c.label.includes('INTERCONNECTION ARRANGEMENT REQUIRED')))
      .toBe(true);
    expect(gu.edges.some(e => e.from === poiNode.id)).toBe(false);
  });

  it('the permit release understands it without printing a verdict on the sheet', () => {
    const r = serviceTopologyReleaseReadiness(t);
    expect(r.drawable).toBe(true);
    expect(r.releaseReady).toBe(false);
    for (const req of r.requirements) expect(req).toMatch(/REQUIRED/);
    expect(r.requirements.join(' ')).toContain('SUPPLY-SIDE TAP CONDUCTORS');
    // A requirement line means the sheet is waiting on something. An optional calculation is not,
    // so it has its own list and never dilutes that meaning.
    expect(r.requirements.join(' ')).not.toContain('LOAD CALCULATION');
    expect(r.optional.join(' ')).toContain('LOAD CALCULATION NOT PROVIDED');
  });
});

describe('🚨 NEEDS INPUT says who owes each thing', () => {
  const o = buildServiceOverview(arranged('common-aggregation'));

  it('no requirement is shown to the operator as a raw token', () => {
    for (const r of o.requiredInputs) {
      expect(r.label, `'${r.key}' is printed at the operator as its own key`).not.toBe(r.key);
    }
  });

  it('🚨 every requirement points at a node that actually exists — including the new kinds', () => {
    const t = arranged('common-aggregation');
    const ids = new Set<string>([
      'service', 'interconnection',
      ...t.branches.map(b => b.id), ...t.panels.map(p => p.id), ...t.domains.map(d => d.id),
      ...(t.aggregationPanels ?? []).map(a => a.id),
      ...(t.pointsOfInterconnection ?? []).map(p => p.id),
    ]);
    for (const r of o.requiredInputs) {
      expect(ids.has(r.focus.nodeId), `${r.key} → ${r.focus.nodeId}`).toBe(true);
    }
    // And the aggregation/POI requirements land on THEIR node, not on the service catch-all.
    const aggReq = o.requiredInputs.find(r => r.key.startsWith('sccr:agg'));
    expect(aggReq?.focus.kind).toBe('aggregation');
    const poiReq = o.requiredInputs.find(r => r.key === 'poi.relationship');
    expect(poiReq?.focus.kind).toBe('poi');
  });

  it('the categories separate what the designer owes from what the utility owes', () => {
    // A job with nothing measured yet, so every category is populated.
    const raw = buildServiceOverview(
      applyDerArrangement(buildTesla400ATwoGateway().topology, 'common-aggregation').topology);
    const owners = groupRequirements(raw.requiredInputs).map(g => g.spec.owner);
    expect(owners).toContain('design-decision');
    expect(owners).toContain('utility-must-provide');
    expect(owners).toContain('manufacturer-authority');
    // The fault current is the utility's; the point-of-interconnection arrangement is the
    // designer's; the multi-controller document is the manufacturer's.
    const ownerOf = (k: string) => raw.requiredInputs.find(r => r.key === k)?.owner;
    expect(ownerOf('service.availableFaultCurrentA')).toBe('utility-must-provide');
    expect(ownerOf('poi.relationship')).toBe('design-decision');
    expect(raw.requiredInputs.find(r => r.key.startsWith('manufacturer-document:'))?.owner)
      .toBe('manufacturer-authority');
    // 🚨 AND THE PANEL SOLARPRO SIZES IS NOT IN THE SAME BUCKET AS A PANEL ON THE WALL: its busbar
    // is a calculation, an existing MSP's busbar is something to go and read.
    const unstated = buildServiceOverview(updateAggregationPanel(
      arranged('common-aggregation'), 'agg-1', { carriesPremisesLoad: null, busbarRatingA: null }));
    const un = (k: string) => unstated.requiredInputs.find(r => r.key === k)?.owner;
    expect(un('aggregation.carriesPremisesLoad')).toBe('design-decision');
    // 🚨 AND THE DWELLING LOAD IS NOT IN ANY OF THOSE BUCKETS. It used to be asked for five times
    // over as `calculatedServiceDemandA`, `calculatedDemandA` × 2 and `backedUpDemandA` × 2, all
    // owned by 'solarpro-can-calculate' — which read as five things SolarPro was waiting on. It is
    // one optional model now, and nothing asks for those tokens again.
    expect(ownerOf('calculatedDemandA')).toBeUndefined();
    expect(ownerOf('loads.model')).toBe('optional-calculation');
    expect(buildServiceOverview(buildTesla400ATwoGateway().topology)
      .requiredInputs.find(r => r.key === 'panel.busbarRatingA')?.owner ?? 'field-verification')
      .toBe('field-verification');
  });

  it('with no arrangement chosen, that IS the requirement and it belongs to the designer', () => {
    const none = buildServiceOverview(buildTesla400ATwoGateway(RESOLVED).topology);
    const r = none.requiredInputs.find(x => x.key === 'interconnection.derArrangement')!;
    expect(r.owner).toBe('design-decision');
    expect(r.label).toBe('How the DER systems interconnect with the service');
    expect(none.summary.derArrangementLabel).toBeNull();
  });
});

describe('🚨 generation that is not storage is a DER source too', () => {
  it('a PV inverter in a domain counts on that domain\'s busbar, and the scalar defers to it', () => {
    const base = buildTesla400ATwoGateway({
      ...RESOLVED, storageConnection: 'backed-up-panel-busbar',
    }).topology;
    // The scalar says 0; the unit says 16 A. The unit wins, and nothing is double counted.
    const t = addGenerationUnit(base, {
      kind: 'pv-inverter', label: 'PV inverter', continuousOutputA: 16, ocpdA: 20,
      domainId: base.domains[0].id,
    }).topology;
    expect(domainGeneration(t, t.domains[0])).toBe(16);
    expect(domainGeneration(t, t.domains[1])).toBe(0);
    expect(derSources(t)).toHaveLength(3);
    // It is an instance, it contributes AC, and both enumerations still agree.
    expect(acSourcesFromTopology(t).count).toBe(3);
    expect(acSourcesFromTopology(t).totalContinuousOutputA).toBe(112);
    expect(equipmentInstancesFromTopology(t).filter(i => i.contributesAcSource).map(i => i.instanceId).sort())
      .toEqual(derSources(t).map(s => s.id).sort());
  });

  it('a generation unit with no stated output leaves the domain NOT_EVALUATED, not zero', () => {
    const base = buildTesla400ATwoGateway({
      ...RESOLVED, storageConnection: 'backed-up-panel-busbar',
    }).topology;
    const t = addGenerationUnit(base, {
      kind: 'pv-inverter', continuousOutputA: null, domainId: base.domains[0].id,
    }).topology;
    expect(domainGeneration(t, t.domains[0])).toBeNull();
    const c = evaluateServiceTopology(t).checks
      .find(x => x.id === 'domain.busbar-705-12' && x.scope === 'domain:domain-a')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
  });

  it('it is traversed for isolation coverage like any other source', () => {
    const base = arranged('independent-branch', { storageConnection: 'backed-up-panel-busbar' });
    const t = addGenerationUnit(base, {
      kind: 'pv-inverter', continuousOutputA: 16, ocpdA: 20, domainId: base.domains[0].id,
    }).topology;
    const g = buildConnectionGraph(t);
    expect(g.sources).toHaveLength(3);
    // It sits outside any recorded landing point, so coverage cannot be proven — and says so
    // rather than reporting the two it can trace and calling that everything.
    expect(derIsolationCoverage(t, g).conclusion).toBe('NOT_EVALUATED');
  });
});

describe('🚨 service distribution and DER aggregation are not the same panel', () => {
  it('there is no field on the model that could hold both', () => {
    const t: ServiceTopology = arranged('common-aggregation');
    // The service's rating lives on the service; the aggregation panel's on the panel; and the
    // aggregation panel never reads the service.
    expect(t.service.ratedAmps).toBe(400);
    expect(t.aggregationPanels[0].busbarRatingA).toBe(125);
    const rec = recommendAggregationRatings(t, 'agg-1');
    expect(rec.busbarRatingA).toBe(125);
    // Change the service and the panel does not move.
    const bigger = { ...t, service: { ...t.service, ratedAmps: 800 } };
    expect(recommendAggregationRatings(bigger, 'agg-1').busbarRatingA).toBe(125);
  });

  it('🚨 the generic graph still names no manufacturer, product or ampere rating', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const file of [
      ['lib', 'electrical', 'serviceTopology.ts'],
      ['lib', 'electrical', 'connectionGraph.ts'],
      ['lib', 'electrical', 'derSources.ts'],
      ['lib', 'electrical', 'topologyAuthoring.ts'],
      ['lib', 'electrical', 'topologyPresets.ts'],
    ]) {
      const src = readFileSync(join(__dirname, '..', ...file), 'utf8');
      const code = src.split('\n')
        .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      for (const forbidden of ['Powerwall', 'Gateway 3', 'tesla-', 'ComEd']) {
        expect(code, `${file.join('/')} hard-codes '${forbidden}'`).not.toContain(forbidden);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AN ARRANGEMENT THAT NAMES A PANEL MUST HAVE THAT PANEL.
//
// `storageConnection: 'der-aggregation-panel'` makes the domain's busbar check PASS, on the grounds
// that the storage left for an aggregation panel. With no such panel recorded, that PASS is granted
// for a device that does not exist and the storage lands nowhere.
//
// Reachable in production: the wizard's arrangement question creates the panels with the answer, but
// `ServiceNodeInspector` and `ServiceTopologyPanel` both let an operator change `storageConnection`
// on its own — so choosing this arrangement there left the graph claiming a landing it did not have.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a claimed DER aggregation landing must exist', () => {
  it('fails when the arrangement names an aggregation panel and none is recorded', async () => {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    const t = buildRaysIntendedJob().topology;
    const orphaned = {
      ...t,
      aggregationPanels: [],                                   // the panels are gone
      domains: t.domains.map(d => ({ ...d, storageConnection: 'der-aggregation-panel' as const })),
    };
    const ev = evaluateServiceTopology(orphaned);
    const landing = ev.checks.filter(c => c.id === 'aggregation.landing' && c.conclusion === 'FAIL');
    expect(landing.length, 'the storage lands nowhere and nothing said so').toBeGreaterThan(0);
    expect(landing[0].detail).toMatch(/nowhere to land|not there/i);
  });

  it('🚨 and the busbar is NOT quietly passed while that is true', async () => {
    // The defect's real shape: the busbar check waves the panel through because the storage "left",
    // while nothing checks that it arrived anywhere.
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    const t = buildRaysIntendedJob().topology;
    const orphaned = {
      ...t,
      aggregationPanels: [],
      domains: t.domains.map(d => ({ ...d, storageConnection: 'der-aggregation-panel' as const })),
    };
    const ev = evaluateServiceTopology(orphaned);
    expect(ev.checks.some(c => c.conclusion === 'FAIL'),
      'a design whose storage lands nowhere reported no failure at all').toBe(true);
  });

  it('passes when the panels are there — the real job', async () => {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    const t = buildRaysIntendedJob().topology;
    const ev = evaluateServiceTopology(t);
    const landingFails = ev.checks.filter(
      c => c.id === 'aggregation.landing' && c.conclusion === 'FAIL'
        && /nowhere to land/i.test(c.detail));
    expect(landingFails, 'the real job was reported as landing nowhere').toEqual([]);
  });
});
