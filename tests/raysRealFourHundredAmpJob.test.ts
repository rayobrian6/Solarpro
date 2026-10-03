// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE JOB RAY IS ACTUALLY ABOUT TO INSTALL.
//
// Not the maximal case and not an illustration — the specific arrangement he described after live
// testing the 400 A workflow:
//
//   existing Eaton 400 A meter/service assembly, internals NOT verified
//   two 200 A systems, independent; nothing recombined downstream
//   one knife switch IN LINE in each path, ahead of that path's Gateway
//   Gateway 3 + TWO full Powerwall 3 + one generation/combiner panel per system
//   PV DC coupled to the Powerwalls — no microinverter, no PV inverter, no PV AC combiner
//   no meter collar, no common combiner, and NO house-load inventory
//
// 🚨 THE HARDWARE CHANGED ON 2026-10-01 AND THIS FILE CHANGED WITH IT. Ray: "4 full Tesla
// Powerwall 3, 0 Powerwall Expansions, 2 full PW3 per Gateway... customer specifically wants the
// increased inverter/discharge capacity from four full PW3s." Four inverting units is 192 A of AC
// source where two units plus two Expansions were 96 A, on almost the same 54 kWh — which is the
// distinction the Expansion work exists to protect, now exercised from the other side.
//
// Ray's completion target, verbatim: "Ray must be able to (1) create the 400 A / two-200 A topology
// (2) save it (3) reopen it (4) edit it (5) LEAVE DETAILED HOUSE LOADS BLANK (6) generate the SLD
// (7) immediately recognize the real physical system he intends to install."
//
// Two rulings this file holds the model to, because both are the kind that quietly reverses:
//
//   · "Do not invent a common 400 A knife-blade switch or common DER combiner merely because the
//      service is 400 A." Two switches, each rated for ITS path.
//   · "Missing information can never become PASS." An absent load calculation is optional and is
//      still NOT_EVALUATED — what changes is only that it is counted apart and asked for ONCE.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  buildTesla400ATwoGateway, buildRaysIntendedJob,
} from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import {
  evaluateServiceTopology, buildConnectionGraph, derIsolationCoverage, resolveDemands,
  topologyNodeLabel, type ServiceTopology, type LoadModel,
} from '@/lib/electrical/serviceTopology';
import {
  setLoadModel, setPanelLoad, setExistingServiceEquipment, placeDeviceInline,
  selectDeviceProduct, addProtectiveDevice, updateBranch,
  selectAggregationProduct, setStoragePvInput,
} from '@/lib/electrical/topologyAuthoring';
import {
  applyIsolationArrangement, ISOLATION_ARRANGEMENTS, describeArrangementFor,
} from '@/lib/electrical/topologyPresets';
import { buildServiceOverview, groupRequirements } from '@/lib/electrical/topologyOverview';
import { serviceTopologyScheduleRows } from '@/lib/permit/utils/serviceTopologySchedule';
import { equipmentQuantities } from '@/lib/electrical/topologyEquipment';
import { parseServiceTopology, serialiseServiceTopology } from '@/lib/db/serviceTopology';
import { renderSLDProfessional } from '@/lib/sld-professional-renderer';

const check = (t: ServiceTopology, id: string) =>
  evaluateServiceTopology(t).checks.find(c => c.id === id);

/** One sheet input, so any test in this file can render the drawing and read it. */
const SHEET_BASE = {
  projectName: 'RAY 400A TWO SYSTEMS', clientName: 'Ray', address: 'Chicago IL',
  designer: 'SolarPro', drawingDate: '2026-10-01', drawingNumber: 'E-1', revision: 'A',
  scale: 'NOT TO SCALE',
  topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 30, totalStrings: 0, deviceCount: 30,
  panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
  dcWireGauge: '#10', dcConduitType: 'EMT', dcOCPD: 0,
  inverterModel: 'IQ8PLUS-72-2-US', inverterManufacturer: 'Enphase',
  acOutputKw: 8.7, acOutputAmps: 36.2, acWireGauge: '#6', acConduitType: 'EMT',
  acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
  mainPanelAmps: 200, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
  hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};
const sheetOf = (t: ServiceTopology, over: Record<string, unknown> = {}) =>
  renderSLDProfessional({ ...SHEET_BASE, ...over, serviceTopology: t } as never);

const requiresOf = (t: ServiceTopology) => {
  const seen = new Set<string>();
  for (const c of evaluateServiceTopology(t).checks) {
    if (c.conclusion !== 'NOT_EVALUATED') continue;
    for (const r of c.requires ?? []) seen.add(r);
  }
  return seen;
};

describe('two independent 200 A paths, one switch in each', () => {
  it('opening BOTH per-path switches isolates BOTH Powerwalls from the utility', () => {
    const { topology } = buildRaysIntendedJob();
    const cov = derIsolationCoverage(topology);
    expect(cov.conclusion).toBe('PASS');
    expect(cov.isolationDeviceIds).toHaveLength(2);
    // Four inverting Powerwalls now, two per system, each reaching the utility through its own
    // generation panel and gateway — and both switches still cut every one of those paths.
    expect(cov.isolatedSourceIds).toHaveLength(4);
    expect(cov.reachableSourceIds).toEqual([]);
  });

  it('🚨 a switch that only POINTS at the branch leaves the conductor intact — the defect', () => {
    // The distinction the whole `inlineOnNodeId` field exists for. Same two devices, same roles,
    // same ratings; only the placement differs, and the placement is what disconnects.
    const { topology } = buildRaysIntendedJob();
    const beside: ServiceTopology = {
      ...topology,
      devices: topology.devices.map(d => (d.inlineOnNodeId
        // Drop the load side and keep everything else: the device now hangs off the branch instead
        // of sitting in it.
        ? { ...d, inlineOnNodeId: null }
        : d)),
    };
    const cov = derIsolationCoverage(beside);
    expect(cov.conclusion).toBe('FAIL');
    expect(cov.detail).toContain('DER ISOLATION DOES NOT ISOLATE ALL ON-SITE DER');
    expect(cov.reachableSourceIds).toHaveLength(4);
  });

  it('the branch feeder is RE-ROUTED through the switch, not duplicated past it', () => {
    const { topology } = buildRaysIntendedJob();
    const g = buildConnectionGraph(topology);
    const gatewayA = topology.domains[0].gateway.id;
    const knifeA = topology.devices.find(d => d.inlineOnNodeId === gatewayA);
    expect(knifeA).toBeTruthy();
    // Exactly one edge leaves the gateway toward the utility, and it lands on the switch.
    const out = g.edges.filter(e => e.from === gatewayA);
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe(knifeA!.id);
    // And the switch carries on to the branch — the conductor is continuous, just interrupted.
    expect(g.edges.some(e => e.from === knifeA!.id && e.to === topology.domains[0].branchId))
      .toBe(true);
  });

  it('each switch is rated for ITS path, not for the service', () => {
    const { topology } = buildRaysIntendedJob();
    const knives = topology.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
    expect(knives).toHaveLength(2);
    // 🚨 200 A, ON A 400 A SERVICE. Ray: "Do not invent a common 400 A knife-blade switch... merely
    // because the service is 400 A."
    expect(topology.service.ratedAmps).toBe(400);
    for (const k of knives) expect(k.ratedAmps).toBe(200);
    expect(check(topology, 'device.inline-rating')?.conclusion).toBe('PASS');
  });

  it('a switch too small for the path it interrupts FAILS', () => {
    const { topology } = buildRaysIntendedJob();
    const undersized: ServiceTopology = {
      ...topology,
      devices: topology.devices.map(d => (d.inlineOnNodeId ? { ...d, ratedAmps: 100 } : d)),
    };
    const c = evaluateServiceTopology(undersized).checks
      .filter(x => x.id === 'device.inline-rating');
    expect(c.some(x => x.conclusion === 'FAIL')).toBe(true);
  });

  it('a switch in line with a node that is not in the graph says so instead of isolating', () => {
    const { topology } = buildRaysIntendedJob();
    const dangling = placeDeviceInline(topology, topology.devices[1].id, 'a-node-that-never-existed');
    const cov = derIsolationCoverage(dangling);
    expect(cov.conclusion).toBe('NOT_EVALUATED');
    expect(cov.requires).toContain('device.inlineOnNodeId');
  });

  it('the preset builds one switch per path and states that acceptance is NOT established', () => {
    // The storage connection has to be established for coverage to traverse at all — an unresolved
    // landing point is a hole, and a hole is NOT_EVALUATED however good the switches are.
    const { topology } = buildTesla400ATwoGateway({
      derArrangement: 'independent-branch', storageConnection: 'backed-up-panel-busbar',
    });
    const r = applyIsolationArrangement(topology, 'one-per-path');
    expect(r.created).toHaveLength(2);
    expect(r.topology.devices.filter(d => d.roles.includes('der-isolation-disconnect')))
      .toHaveLength(2);
    // Nothing anywhere claims the utility accepts two devices.
    expect(r.unresolved.join(' ')).toMatch(/not established/i);
    expect(derIsolationCoverage(r.topology).conclusion).toBe('PASS');
  });

  it('switching to a common service switch replaces the pair rather than adding a third', () => {
    const { topology } = buildRaysIntendedJob();
    const r = applyIsolationArrangement(topology, 'common-service');
    const iso = r.topology.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
    expect(iso).toHaveLength(1);
    expect(iso[0].ratedAmps).toBe(400);
    expect(ISOLATION_ARRANGEMENTS.map(c => c.id)).toEqual(['one-per-path', 'common-service']);
  });
});

describe('🚨 where the Powerwall breaker lands decides whether the design is legal', () => {
  it('the Powerwall cannot land on a 200 A / 200 A MSP busbar — 705.12(B) FAILS', () => {
    // Ray's real MSPs are 200 A bus with a 200 A main, so the 120% allowance is
    // 200 × 1.2 − 200 = 40 A and a Powerwall 3 needs a 60 A breaker — Tesla's own figure for the
    // 11.5 kW configuration. This is a genuine finding about the job, not a fixture artefact: the
    // breaker has to land somewhere other than that busbar, which on this job is the generation
    // panel, or the MSP's main has to come down.
    //
    // Built WITHOUT the generation panel, because the panel is precisely what makes the question
    // go away: with it, the Powerwalls land in it and the MSP busbar carries no storage at all.
    const { topology } = buildRaysIntendedJob({
      storageConnection: 'backed-up-panel-busbar', generationPanelPerSystem: false,
    });
    const busbar = evaluateServiceTopology(topology).checks
      .filter(c => c.id === 'domain.busbar-705-12');
    expect(busbar).toHaveLength(2);
    for (const c of busbar) expect(c.conclusion).toBe('FAIL');
    expect(busbar[0].citation).toBe('NEC 705.12(B)');
  });

  it('landing in the Gateway makes it a MANUFACTURER question, not a pass', () => {
    // 🚨 AND NOT A PASS EITHER. Inside the controller's own panelboard the governing limit is the
    // manufacturer's, and SolarPro does not hold it — so this is NOT_EVALUATED, which is the honest
    // answer and not the comfortable one.
    const { topology } = buildRaysIntendedJob({ generationPanelPerSystem: false });
    const busbar = evaluateServiceTopology(topology).checks
      .filter(c => c.id === 'domain.busbar-705-12');
    for (const c of busbar) expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(busbar[0].requires?.some(r => r.startsWith('manufacturer-limit:'))).toBe(true);
  });

  it('🚨 landing in the GENERATION PANEL moves the question to that panel, and it PASSES', () => {
    // The actual job. The Powerwalls are not on the MSP busbar and are not in the controller: they
    // are in their own generation panel, so the MSP's 120% allowance has nothing to carry and the
    // panel's own busbar answers for them — 96 A aggregated, 125 A at 125%, on a 125 A bus.
    const { topology } = buildRaysIntendedJob();
    for (const d of topology.domains) expect(d.storageConnection).toBe('der-aggregation-panel');
    const ev = evaluateServiceTopology(topology);
    for (const c of ev.checks.filter(c => c.id === 'domain.busbar-705-12')) {
      expect(c.conclusion).toBe('PASS');
    }
    const agg = ev.checks.filter(c => c.id === 'aggregation.busbar');
    expect(agg).toHaveLength(2);
    for (const c of agg) expect(c.conclusion).toBe('PASS');
    // And the panel is sized from its own two Powerwalls, never from the 400 A service.
    for (const p of topology.aggregationPanels) {
      expect(p.busbarRatingA).toBe(125);
      expect(p.outputOcpdA).toBe(125);
      expect(p.inputs.map(i => i.ocpdA)).toEqual([60, 60]);
    }
  });

  it('🚨 the two generation panels are two panels, one per system — never one shared', () => {
    const { topology } = buildRaysIntendedJob();
    expect(topology.aggregationPanels).toHaveLength(2);
    const owners = topology.aggregationPanels.map(p => p.domainId);
    expect(new Set(owners).size).toBe(2);
    for (const d of topology.domains) {
      const own = topology.aggregationPanels.filter(p => p.domainId === d.id);
      expect(own).toHaveLength(1);
      // Each panel feeds ITS OWN gateway and takes ITS OWN two Powerwalls. Nothing crosses.
      expect(own[0].feedsNodeId).toBe(d.gateway.id);
      expect(own[0].inputs.map(i => i.sourceId).sort()).toEqual([...d.storageUnitIds].sort());
    }
  });

  it('🚨 the Powerwall OCPD is Tesla\'s 60 A, not the 50 A this catalogue used to carry', () => {
    // The live drawing printed "48 A / 50 A OCPD". 48 A continuous with a 50 A device is below the
    // 125% continuous figure AND below Tesla's own table, which gives 60 A at the 11.5 kW setting.
    const { topology } = buildRaysIntendedJob();
    const units = topology.storage.filter(u => u.role === 'inverter-unit');
    expect(units).toHaveLength(4);
    for (const u of units) {
      expect(u.continuousOutputA).toBe(48);
      expect(u.ocpdA).toBe(60);
      expect(u.outputConfigKw).toBe(11.5);
    }
  });

  it('🚨 the Gateway\'s OWN internal panelboard is a third bus, and the feeder is checked on it', () => {
    // Tesla Gateway 3 Install Manual: "The internal panelboard is a 200 A-rated bussing that
    // supports 8x 1-inch breaker spaces (16 circuits)" using "branch circuit breakers up to 125 A
    // maximum". A 125 A generation feeder is therefore AT the manufacturer's limit and a larger one
    // is a failure anybody can see — which is a different question from how much generation that
    // bus may carry in total, and that second question is the one still named as unresolved.
    const { topology } = buildRaysIntendedJob();
    for (const d of topology.domains) {
      expect(d.gateway.internalPanelboard?.busbarRatingA).toBe(200);
      expect(d.gateway.internalPanelboard?.maxBranchBreakerA).toBe(125);
      expect(d.gateway.internalPanelboard?.spaces).toBe(8);
    }
    const landing = evaluateServiceTopology(topology).checks
      .filter(c => c.id === 'aggregation.landing');
    expect(landing).toHaveLength(2);
    for (const c of landing) {
      expect(c.conclusion).toBe('NOT_EVALUATED');
      expect(c.detail).toContain('200 A');
      expect(c.detail).toContain('125 A');
    }

    // 🚨 AND A FEEDER THE MANUFACTURER DOES NOT PERMIT IS A FAIL, NOT ANOTHER UNKNOWN.
    const oversized: ServiceTopology = {
      ...topology,
      aggregationPanels: topology.aggregationPanels.map(p => ({ ...p, outputOcpdA: 175 })),
    };
    const bad = evaluateServiceTopology(oversized).checks
      .filter(c => c.id === 'aggregation.landing');
    for (const c of bad) {
      expect(c.conclusion).toBe('FAIL');
      expect(c.detail).toContain('175 A');
    }
  });

  it('the internal panelboard survives the round trip, or the check loses its limit', () => {
    const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(buildRaysIntendedJob().topology)));
    const back = parseServiceTopology(stored)!.topology;
    for (const d of back.domains) {
      expect(d.gateway.internalPanelboard?.maxBranchBreakerA).toBe(125);
    }
    // Drop it and the landing check must go back to saying it has nothing to size against —
    // never to passing.
    for (const d of stored.topology.domains) delete d.gateway.internalPanelboard;
    const stripped = parseServiceTopology(stored)!.topology;
    const landing = evaluateServiceTopology(stripped).checks
      .filter(c => c.id === 'aggregation.landing');
    expect(landing).toHaveLength(2);
    for (const c of landing) expect(c.conclusion).toBe('NOT_EVALUATED');
  });

  it('a different output configuration moves BOTH the current and the device', () => {
    // 🚨 READ OFF THE PUBLISHED ROW, NOT SCALED. 41.7 A × 1.25 is 52 A, which would select a 60 A
    // device by arithmetic — the same answer Tesla publishes, by luck. 7.6 kW is where the two
    // disagree: 31.7 × 1.25 = 39.6 → 40 A, and Tesla says 40 A. The point is that the row is read.
    const { topology } = buildRaysIntendedJob({ outputConfigKw: 7.6 });
    for (const u of topology.storage.filter(u => u.role === 'inverter-unit')) {
      expect(u.continuousOutputA).toBe(31.7);
      expect(u.ocpdA).toBe(40);
    }
  });
});

describe('the house-load calculation is OPTIONAL, and asked for once', () => {
  it('absent, it is ONE requirement owned by "optional" — not five amperage boxes', () => {
    const { topology } = buildRaysIntendedJob();
    const ov = buildServiceOverview(topology);
    const loadItems = ov.requiredInputs.filter(i => i.owner === 'optional-calculation');
    expect(loadItems).toHaveLength(1);
    expect(loadItems[0].key).toBe('loads.model');

    // 🚨 THE OLD SHAPE, PROVEN GONE. Ray read "Engineering: 8 inputs required" and it included the
    // service demand, both branch demands and both domains' backed-up loads: five requests for one
    // house. None of those tokens is ever asked for again.
    const req = requiresOf(topology);
    expect(req.has('calculatedServiceDemandA')).toBe(false);
    expect(req.has('calculatedDemandA')).toBe(false);
    expect(req.has('backedUpDemandA')).toBe(false);
  });

  it('it is counted APART from the required items', () => {
    const { topology } = buildRaysIntendedJob();
    const ov = buildServiceOverview(topology);
    expect(ov.summary.optionalCount).toBe(1);
    expect(ov.summary.requiredCount).toBe(ov.requiredInputs.length - 1);
    // And the total is never presented as one number of things Ray owes.
    expect(ov.summary.requiredCount + ov.summary.optionalCount).toBe(ov.requiredInputs.length);
  });

  it('🚨 OPTIONAL IS STILL NOT A PASS', () => {
    const { topology } = buildRaysIntendedJob();
    const load = check(topology, 'load.calculation');
    expect(load?.conclusion).toBe('NOT_EVALUATED');
    expect(load?.detail).toContain('LOAD CALCULATION NOT PROVIDED');
    expect(check(topology, 'service.demand')?.conclusion).toBe('NOT_EVALUATED');
    expect(check(topology, 'branch.demand')?.conclusion).toBe('NOT_EVALUATED');
    expect(evaluateServiceTopology(topology).overall).not.toBe('PASS');
  });

  it('one load model derives the service, both branches and both backed-up domains', () => {
    const { topology } = buildRaysIntendedJob();
    const withLoads = setLoadModel(topology, {
      method: 'optional-220-82',
      basis: 'Optional dwelling calculation from the appliance inventory.',
      byPanel: [
        { panelId: 'msp-1', calculatedDemandA: 118 },
        { panelId: 'msp-2', calculatedDemandA: 96 },
      ],
      otherDemandA: null,
    });
    const d = resolveDemands(withLoads);
    expect(d.source).toBe('load-model');
    // 🚨 FOUR NUMBERS, ONE MODEL. Nobody typed 214, and nobody typed either branch figure.
    expect(d.serviceA).toBe(214);
    expect(d.branchA['branch-a']).toBe(118);
    expect(d.branchA['branch-b']).toBe(96);
    expect(d.domainBackedUpA['domain-a']).toBe(118);
    expect(d.domainBackedUpA['domain-b']).toBe(96);

    expect(check(withLoads, 'load.calculation')?.conclusion).toBe('PASS');
    expect(check(withLoads, 'service.demand')?.conclusion).toBe('PASS');
    expect(check(withLoads, 'domain.backed-up-load')?.conclusion).toBe('PASS');
    expect(buildServiceOverview(withLoads).summary.optionalCount).toBe(0);
  });

  it('a branch over its rating still FAILS when the number came from the model', () => {
    const { topology } = buildRaysIntendedJob();
    const over = setPanelLoad(topology, 'msp-1', 240);
    const c = evaluateServiceTopology(setPanelLoad(over, 'msp-2', 90)).checks
      .filter(x => x.id === 'branch.demand');
    expect(c.some(x => x.conclusion === 'FAIL')).toBe(true);
  });

  it('🚨 a PARTIAL load model is not a smaller load', () => {
    const { topology } = buildRaysIntendedJob();
    // Only one of the two panels entered. Summing it as if the other were zero would report a
    // comfortable 118 A on a 400 A service.
    const half = setPanelLoad(topology, 'msp-1', 118);
    const d = resolveDemands(half);
    expect(d.serviceA).toBeNull();
    expect(d.unmodelledPanelIds).toEqual(['msp-2']);
    const c = check(half, 'load.calculation');
    expect(c?.conclusion).toBe('NOT_EVALUATED');
    expect(c?.detail).toContain('MSP #2');
  });

  it('the one load requirement points at the SERVICE, not at whichever branch asked', () => {
    const { topology } = buildRaysIntendedJob();
    const item = buildServiceOverview(topology).requiredInputs.find(i => i.key === 'loads.model');
    // Routed by scope it would send the operator to Branch B to answer a whole-house question.
    expect(item?.focus).toEqual({ kind: 'service', nodeId: 'service', field: 'loads' });
  });

  it('a graph with the old demand SCALARS still resolves from them', () => {
    // Backward compatibility, stated as a test: a design saved before the load model existed keeps
    // working, and reports that its numbers were recorded rather than derived.
    const { topology } = buildTesla400ATwoGateway({
      calculatedServiceDemandA: 180, branchDemandA: [90, 90],
    });
    const d = resolveDemands(topology);
    expect(d.source).toBe('recorded');
    expect(d.serviceA).toBe(180);
    expect(check(topology, 'service.demand')?.conclusion).toBe('PASS');
    expect(check(topology, 'load.calculation')?.conclusion).toBe('PASS');
  });
});

describe('the existing service equipment is read, never designed', () => {
  it('an existing assembly reports CONFIGURATION TO VERIFY and names every missing fact', () => {
    const { topology } = buildRaysIntendedJob();
    const c = check(topology, 'service.existing-equipment');
    expect(c?.conclusion).toBe('NOT_EVALUATED');
    expect(c?.detail).toContain('EXISTING 400 A SERVICE EQUIPMENT — CONFIGURATION TO VERIFY');
    expect(c?.requires).toContain('service.existingEquipment.catalogNumber');
    expect(c?.requires).toContain('service.existingEquipment.mainArrangement');
    expect(c?.requires).toContain('service.existingEquipment.sccrA');
  });

  it('every existing-equipment item is a FIELD VERIFY, not a calculation', () => {
    const { topology } = buildRaysIntendedJob();
    const items = buildServiceOverview(topology).requiredInputs
      .filter(i => i.key.startsWith('service.existingEquipment.'));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.owner).toBe('field-verification');
      expect(i.focus).toMatchObject({ kind: 'service', nodeId: 'service' });
    }
  });

  it('reading it off the equipment resolves it', () => {
    const { topology } = buildRaysIntendedJob();
    const read = setExistingServiceEquipment(topology, {
      catalogNumber: 'CH42B400', mainArrangement: 'Two 200 A mains, factory-grouped',
      feederArrangement: 'Two 200 A outgoing feeders, bottom entry', sccrA: 22000, verified: true,
    });
    expect(check(read, 'service.existing-equipment')?.conclusion).toBe('PASS');
  });

  it('a NEW service has nothing to verify, so it raises no item at all', () => {
    const { topology } = buildTesla400ATwoGateway();
    const declaredNew = setExistingServiceEquipment(topology, null);
    expect(declaredNew.service.existingOrNew).toBe('new');
    expect(declaredNew.service.existingEquipment ?? null).toBeNull();
    expect(check(declaredNew, 'service.existing-equipment')).toBeUndefined();
  });

  it('🚨 …but a service NOBODY called existing or new is not "new": it is asked, and nothing is verified-away', () => {
    const { topology } = buildTesla400ATwoGateway();
    expect(topology.service.existingEquipment ?? null).toBeNull();
    const c = check(topology, 'service.existing-equipment');
    expect(c?.conclusion).toBe('NOT_EVALUATED');
    expect(c?.requires).toEqual(['service.existingOrNew']);
    expect(c?.detail).toContain('EXISTING OR NEW 400 A SERVICE EQUIPMENT — NOT ESTABLISHED');
  });

  it('🚨 SolarPro does not order the existing assembly, or the switches it has not chosen', () => {
    const { topology } = buildRaysIntendedJob();
    // Ray: "Do not automatically add replacement 400 A service distribution equipment." Nothing
    // with no catalogue id is procurable, and the existing service has none.
    const q = equipmentQuantities(topology);
    // 🚨 NO EXPANSION ROW AT ALL ON THIS JOB. Ray: "0 Powerwall Expansions". A BOM that still
    // carried two would be ordering hardware nobody is installing.
    expect(Object.keys(q).sort()).toEqual([
      'tesla-backup-gateway-3', 'tesla-powerwall-3',
    ]);
    expect(q['tesla-backup-gateway-3']).toBe(2);
    expect(q['tesla-powerwall-3']).toBe(4);
    // And the two generation panels are not ordered either, because no part has been selected for
    // them — the requirement is established and the purchase is not.
    expect(topology.aggregationPanels.every(p => !p.productId)).toBe(true);
  });
});

describe('an engineered requirement is not a purchase order', () => {
  it('an unselected device reports the SELECTION open, with the requirement stated', () => {
    const { topology } = buildRaysIntendedJob();
    const c = check(topology, 'device.selection');
    expect(c?.conclusion).toBe('NOT_EVALUATED');
    expect(c?.requires).toContain('device.productId');
    expect(c?.detail).toContain('not a purchase');
  });

  it('selecting a part closes it, and it is ONE item on the screen however many devices', () => {
    const { topology } = buildRaysIntendedJob();
    let t = topology;
    for (const d of topology.devices) t = selectDeviceProduct(t, d.id, 'eaton-dg224urk');
    expect(evaluateServiceTopology(t).checks.filter(c => c.id === 'device.selection')).toHaveLength(0);

    const items = buildServiceOverview(topology).requiredInputs
      .filter(i => i.key === 'device.productId');
    expect(items).toHaveLength(1);
    expect(items[0].owner).toBe('design-decision');
  });
});

describe('the schedule and the screen speak the installer\'s language', () => {
  it('the summary reads "Two 200 A systems", with the models and the switch count', () => {
    const { topology } = buildRaysIntendedJob();
    const s = buildServiceOverview(topology).summary;
    expect(s.serviceAmps).toBe(400);
    expect(s.systemsLabel).toBe('Two 200 A systems');
    expect(s.gatewayModelLabel).toBe('Tesla Backup Gateway 3');
    expect(s.batteryModelLabel).toBe('Tesla Powerwall 3');
    expect(s.invertingUnitCount).toBe(4);
    expect(s.expansionUnitCount).toBe(0);
    expect(s.isolationSwitchCount).toBe(2);
    expect(s.perSystemGenerationPanelCount).toBe(2);
    expect(s.serviceEquipmentIsExisting).toBe(true);
    expect(s.usableKwh).toBeCloseTo(54, 1);
    // 🚨 192 A, NOT 96. Four inverting units, where two units and two Expansions were 96 A on the
    // same energy — the whole reason the two counts are separate fields.
    expect(s.continuousOutputA).toBe(192);
    // 🚨 THE PRODUCT NAME IS COMPOSED FROM THE UNITS ACTUALLY IN THE GRAPH. The architecture member
    // is generic (`dc-coupled-storage`) because the model may name no manufacturer; the SENTENCE an
    // installer reads names the box on the wall.
    expect(s.solarCouplingLabel).toBe('PV DC coupled to Tesla Powerwall 3');
    expect(s.solarCouplingSelected).toBe(true);
  });

  it('a mixed-size service does not claim one system size', () => {
    let { topology } = buildRaysIntendedJob();
    topology = updateBranch(topology, 'branch-b', { ratedAmps: 100 });
    const s = buildServiceOverview(topology).summary;
    expect(s.systemAmps).toBeNull();
    expect(s.systemsLabel).toBe('Two systems');
  });

  it('the arrangement is described with the sizes actually in the graph', () => {
    const { topology } = buildRaysIntendedJob();
    expect(describeArrangementFor(topology, 'independent-branch'))
      .toContain('Two 200 A systems, independent');
    expect(describeArrangementFor(topology, 'common-aggregation')).toContain('400 A service');
  });

  it('🚨 the installer-facing screen leads with the installer\'s words', () => {
    // Every one of these was found by rendering the screen and READING it, not by an assertion.
    // Ray: "Avoid leading with terms like DER, graph node, aggregation topology, domain semantics.
    // Those may remain in Advanced/engineering internals."
    const { topology } = buildRaysIntendedJob();
    const ov = buildServiceOverview(topology);
    expect(ov.summary.derArrangementLabel).toBe('Independent systems');
    expect(ov.summary.derArrangementLabel).not.toMatch(/DER|branch interconnection/);

    // 🚨 AND NO CATALOGUE KEY. The card read "Manufacturer busbar limit for
    // tesla-backup-gateway-3" — a database id, on an installer's screen.
    for (const i of ov.requiredInputs) expect(i.label).not.toMatch(/tesla-|-gateway-3|msp-\d/);

    // The catalogue key only comes up where the Powerwall lands in the controller, which on this
    // job it no longer does — so the variant that DOES is where the words are checked.
    const gwLanding = buildRaysIntendedJob({ generationPanelPerSystem: false });
    const ov2 = buildServiceOverview(gwLanding.topology);
    const mfr = ov2.requiredInputs.find(i => i.key.startsWith('manufacturer-limit:'))!;
    expect(mfr.label).toBe('Manufacturer busbar limit for Tesla Backup Gateway 3');
  });

  it('🚨 an OPTIONAL calculation is not what a 200 A path is waiting on', () => {
    // Both branch cards led with "Full load analysis (dwelling load calculation) required" — the
    // one item nobody is obliged to supply, presented as the blocker on that path.
    const { topology } = buildRaysIntendedJob();
    const ov = buildServiceOverview(topology);
    for (const b of topology.branches) {
      expect(ov.branches[b.id].headline).toContain('optional, not provided');
      expect(ov.branches[b.id].headline).not.toMatch(/required$/);
    }
    // And where something IS genuinely required, that still leads.
    const withLoads = setPanelLoad(setPanelLoad(topology, 'msp-1', 118), 'msp-2', 96);
    const ov2 = buildServiceOverview(withLoads);
    for (const b of withLoads.branches) {
      expect(ov2.branches[b.id].headline ?? '').not.toContain('optional');
    }
  });

  it('🚨 NO SURFACE PRINTS AN INTERNAL ID', () => {
    const { topology } = buildRaysIntendedJob();
    expect(topologyNodeLabel(topology, 'msp-1')).toBe('MSP #1');
    expect(topologyNodeLabel(topology, topology.domains[0].gateway.id))
      .toBe(topology.domains[0].gateway.label);

    const rows = serviceTopologyScheduleRows(topology);
    const switches = rows.filter(r => r.deviceType === 'disconnect' && r.rating === '200 A');
    expect(switches).toHaveLength(2);
    for (const r of switches) {
      // "on the path to branch-a" is a database key handed to an inspector.
      expect(r.notes).not.toMatch(/branch-[ab]\b/);
      expect(r.notes).toMatch(/200 A service path [12]/);
      // 🚨 AND SYSTEM IDENTITY SURVIVES EVEN THOUGH BOTH SWITCHES ARE THE SAME MODEL AND RATING.
      expect(r.domain).toMatch(/System [12]/);
    }
    expect(new Set(switches.map(r => r.domain)).size).toBe(2);
  });
});

describe('save, reopen, edit — the lifecycle Ray could not complete', () => {
  const roundTrip = (t: ServiceTopology): ServiceTopology => {
    const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(t)));
    const back = parseServiceTopology(stored);
    expect(back).toBeTruthy();
    return back!.topology;
  };

  it('🚨 the per-path placement survives — dropping it turns a FAIL into a PASS', () => {
    const { topology } = buildRaysIntendedJob();
    const back = roundTrip(topology);
    expect(back.devices.filter(d => d.inlineOnNodeId)).toHaveLength(2);
    expect(derIsolationCoverage(back).conclusion)
      .toBe(derIsolationCoverage(topology).conclusion);

    // The red proof, run forwards: a reload that forgets the load side reports the arrangement as a
    // bypass. Whichever direction it moves, a save must never change the answer.
    const forgotten: ServiceTopology = {
      ...back,
      devices: back.devices.map(d => (d.inlineOnNodeId ? { ...d, inlineOnNodeId: null } : d)),
    };
    expect(derIsolationCoverage(forgotten).conclusion).toBe('FAIL');
  });

  it('the existing-equipment record, the load model and the selected part all survive', () => {
    const { topology } = buildRaysIntendedJob();
    let t = setExistingServiceEquipment(topology, { catalogNumber: 'CH42B400', sccrA: 22000 });
    t = setPanelLoad(t, 'msp-1', 118, { method: 'optional-220-82', basis: 'Appliance inventory.' });
    t = setPanelLoad(t, 'msp-2', 96);
    t = selectDeviceProduct(t, t.devices[1].id, 'eaton-dg224urk');

    const back = roundTrip(t);
    expect(back.service.existingEquipment?.catalogNumber).toBe('CH42B400');
    expect(back.service.existingEquipment?.sccrA).toBe(22000);
    // 🚨 AND NOT VERIFIED, because it was not. Reading a half-read assembly back as verified is how
    // "CONFIGURATION TO VERIFY" disappears without anybody going to site.
    expect(back.service.existingEquipment?.verified).toBe(false);
    expect(resolveDemands(back).serviceA).toBe(214);
    expect(back.devices[1].productId).toBe('eaton-dg224urk');
    expect(evaluateServiceTopology(back).overall).toBe(evaluateServiceTopology(t).overall);
  });

  it('a graph with NO load model reloads with none — an absent optional stays absent', () => {
    const { topology } = buildRaysIntendedJob();
    const back = roundTrip(topology);
    expect(back.loads ?? null).toBeNull();
    expect(resolveDemands(back).source).toBe('none');
    expect(check(back, 'load.calculation')?.detail).toContain('LOAD CALCULATION NOT PROVIDED');
  });

  it('every branch, panel, gateway, battery, generation panel and switch comes back', () => {
    const back = roundTrip(buildRaysIntendedJob().topology);
    expect(back.branches).toHaveLength(2);
    expect(back.panels).toHaveLength(2);
    expect(back.domains).toHaveLength(2);
    expect(back.storage.filter(u => u.role === 'inverter-unit')).toHaveLength(4);
    expect(back.storage.filter(u => u.role === 'energy-expansion')).toHaveLength(0);
    expect(back.devices).toHaveLength(3);
    expect(back.interconnection.derArrangement).toBe('independent-branch');
    expect(back.pointsOfInterconnection).toHaveLength(2);
    // 🚨 AND THE TWO GENERATION PANELS COME BACK AS TWO SYSTEMS' PANELS, not two site-wide ones.
    expect(back.aggregationPanels).toHaveLength(2);
    expect(back.aggregationPanels.map(p => p.domainId).sort()).toEqual(['domain-a', 'domain-b']);
    for (const p of back.aggregationPanels) expect(p.inputs).toHaveLength(2);
  });

  it('🚨 the solar coupling survives, or every consumer goes back to inferring one', () => {
    const back = roundTrip(buildRaysIntendedJob().topology);
    expect(back.solarCoupling).toBe('dc-coupled-storage');
    expect(check(back, 'pv.coupling')?.conclusion).toBe('PASS');
  });

  it('the commissioned output setting survives, with the current and the device it chose', () => {
    const back = roundTrip(buildRaysIntendedJob().topology);
    for (const u of back.storage.filter(u => u.role === 'inverter-unit')) {
      expect(u.outputConfigKw).toBe(11.5);
      expect(u.continuousOutputA).toBe(48);
      expect(u.ocpdA).toBe(60);
      // The manufacturer's DC input limits come back too, or the DC-coupling check has nothing to
      // compare a string against and would clear it by default.
      expect(u.pvInputLimits?.mppts).toBe(6);
      expect(u.pvInputLimits?.maxStcKw).toBe(20);
    }
  });

  it('🚨 A MISSING SERVICE RATING PRESERVES THE GRAPH — it used to delete it', () => {
    // Ray: "Missing one fact should produce SERVICE RATING REQUIRED — TOPOLOGY PARTIALLY
    // EVALUATED. It should never mean 'pretend the graph doesn't exist.'"
    //
    // `parseServiceTopology` used to open with `if (ratedAmps === null) return null`, so a stored
    // graph with no service rating came back as NO GRAPH AT ALL — every branch, panel, gateway,
    // battery, generation panel and switch discarded on read, silently, and the project fell back
    // to the legacy scalars looking exactly as if nobody had ever built one.
    const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(buildRaysIntendedJob().topology)));
    delete stored.topology.service.ratedAmps;
    const back = parseServiceTopology(stored)?.topology;

    expect(back, 'the graph was discarded for want of one number').toBeTruthy();
    expect(back!.service.ratedAmps).toBeNull();
    // Everything the operator built is still there.
    expect(back!.branches).toHaveLength(2);
    expect(back!.panels).toHaveLength(2);
    expect(back!.domains).toHaveLength(2);
    expect(back!.storage.filter(u => u.role === 'inverter-unit')).toHaveLength(4);
    expect(back!.aggregationPanels).toHaveLength(2);
    expect(back!.devices.filter(d => d.inlineOnNodeId)).toHaveLength(2);
    expect(back!.solarCoupling).toBe('dc-coupled-storage');

    // 🚨 AND THE ENGINEERING IS PARTIAL, NOT ABSENT. The one fact is named; everything that does
    // not depend on it still reaches a conclusion.
    const ev = evaluateServiceTopology(back!);
    const rating = ev.checks.find(c => c.id === 'service.rating')!;
    expect(rating.conclusion).toBe('NOT_EVALUATED');
    expect(rating.requires).toEqual(['service.ratedAmps']);
    expect(ev.checks.find(c => c.id === 'service.branch-sum')).toBeUndefined();
    // DER isolation coverage is a traversal — it does not need the service rating at all.
    expect(ev.checks.find(c => c.id === 'interconnection.der-isolation-coverage')?.conclusion)
      .toBe('PASS');
    // Nor do the generation panels' own busbars.
    for (const c of ev.checks.filter(c => c.id === 'aggregation.busbar')) {
      expect(c.conclusion).toBe('PASS');
    }
    // 🚨 AND NOTHING PRINTS `null A`. The repo compiles with strict:false, so the compiler flagged
    // none of the 38 places that interpolate this number.
    const svg = sheetOf(back!);
    expect(svg).not.toMatch(/null\s*A/);
    expect(svg).toContain('NOT ESTABLISHED');
    for (const r of serviceTopologyScheduleRows(back!)) {
      expect(r.rating ?? '').not.toContain('null');
    }
  });

  it('🚨 RED PROOF — dropping the panel\'s system ownership launders two systems into one site', () => {
    // The same law as `feedsNodeId`: save/reload may never improve a conclusion by forgetting
    // topology. Here the forgetting is subtler — the panels survive, their OWNERS do not — and the
    // result is a drawing that no longer knows which Powerwalls belong to which gateway.
    const { topology } = buildRaysIntendedJob();
    const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(topology)));
    for (const p of stored.topology.aggregationPanels) delete p.domainId;
    const back = parseServiceTopology(stored)!.topology;
    expect(back.aggregationPanels.every(p => !p.domainId)).toBe(true);
    const ov = buildServiceOverview(back);
    expect(ov.summary.perSystemGenerationPanelCount).toBe(0);
    // And the sheet stops drawing them inside their systems: they fall into the shared DER group,
    // which is the arrangement this job explicitly does not have.
    expect(sheetOf(back)).toContain('AGGREGATED DER FEEDER');
  });
});

describe('the SLD shows the system Ray intends to install', () => {
  // Ray's required shape, verbatim:
  //
  //   UTILITY → EXISTING 400 A METER / SERVICE EQUIPMENT
  //     +---- 200 A path A ---- Knife switch A ---- Gateway #1 ---- MSP #1
  //     +---- 200 A path B ---- Knife switch B ---- Gateway #2 ---- MSP #2
  //
  // "Do not show a common downstream combiner unless the actual selected topology contains one."

  const BASE = {
    projectName: 'RAY 400A TWO SYSTEMS', clientName: 'Ray', address: 'Chicago IL',
    designer: 'SolarPro', drawingDate: '2026-09-29', drawingNumber: 'E-1', revision: 'A',
    scale: 'NOT TO SCALE',
    topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
    integratedDcDisconnect: false, totalModules: 30, totalStrings: 0, deviceCount: 30,
    panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
    dcWireGauge: '#10', dcConduitType: 'EMT', dcOCPD: 0,
    inverterModel: 'IQ8PLUS-72-2-US', inverterManufacturer: 'Enphase',
    acOutputKw: 8.7, acOutputAmps: 36.2, acWireGauge: '#6', acConduitType: 'EMT',
    acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
    mainPanelAmps: 200, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
    hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
  };
  type SLDInput = Parameters<typeof renderSLDProfessional>[0];
  const sheet = (t: ServiceTopology, over: Record<string, unknown> = {}) =>
    renderSLDProfessional({ ...BASE, ...over, serviceTopology: t } as unknown as SLDInput);

  it('both paths, both switches, both gateways and both MSPs are on the sheet', () => {
    const { topology } = buildRaysIntendedJob();
    const svg = sheet(topology);
    expect(svg).toContain('MSP #1');
    expect(svg).toContain('MSP #2');
    // Counted by the diagram's own gateway nameplate line — the model name also appears in the
    // equipment schedule printed on the same sheet, which is correct and is not the diagram.
    expect((svg.match(/200 A CONTINUOUS/g) ?? []).length).toBe(2);
    // 🚨 A SWITCH IN A FEEDER IS A SYMBOL IN THE LINE, not another enclosure: the corridor between
    // the gateway column and the service equipment is ~130 uu and no box fits in it. So each path
    // carries an IEEE 315 knife switch, a callout number and a short tag; the full name, the domain
    // and the selection requirement are on the equipment schedule against that callout.
    expect((svg.match(/>ISOLATION</g) ?? []).length).toBe(2);
    expect((svg.match(/>LOCK\/VIS OPEN</g) ?? []).length).toBe(2);
    // The branch's run callout (canonical engine, no site facts on this sheet): its rating and
    // NOT EVALUATED — never a conductor read off the breaker.
    expect((svg.match(/>200 A SERVICE BRANCH FEEDER</g) ?? []).length).toBe(2);
  });

  it('🚨 the existing assembly is drawn as EXISTING, with its unknowns on the sheet', () => {
    const { topology } = buildRaysIntendedJob();
    const svg = sheet(topology);
    expect(svg).toContain('EXISTING 400 A SERVICE EQUIPMENT');
    expect(svg).toContain('CONFIGURATION TO VERIFY');
    expect(svg).toContain('EXISTING — NOT IN SCOPE OF SUPPLY');
    // Ray: "Do not automatically add replacement 400 A service distribution equipment." The sheet
    // must not present it as new service distribution.
    expect(svg).not.toContain('400 A SERVICE DISTRIBUTION');
  });

  it('🚨 no common combiner is drawn, because the selected topology has none', () => {
    const svg = sheet(buildRaysIntendedJob().topology);
    expect(svg).not.toContain('DER AGGREGATION PANEL');
    expect(svg).not.toContain('AGGREGATED DER FEEDER');
  });

  it('an Expansion is a DC extension on the sheet, never an AC source or a breaker', () => {
    // 🚨 THIS JOB HAS NONE, so the drawing must not show one — and the rule it proves is still
    // live, on the arrangement that does have them.
    expect(sheet(buildRaysIntendedJob().topology)).not.toContain('DC EXPANSION');
    const withExpansions = buildRaysIntendedJob({
      powerwallsPerSystem: 1, expansionsPerSystem: 1, generationPanelPerSystem: false,
    }).topology;
    const svg = sheet(withExpansions);
    expect((svg.match(/DC EXPANSION/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(svg).toContain('NO AC OUTPUT · NO OCPD');
  });

  it('🚨 the generation panel is on the sheet, in its system, sized from its own Powerwalls', () => {
    const svg = sheet(buildRaysIntendedJob().topology);
    expect(svg).toContain('GENERATION PANEL — SYSTEM 1');
    expect(svg).toContain('GENERATION PANEL — SYSTEM 2');
    // 125 A on a 400 A service, with the arithmetic printed beside it.
    expect((svg.match(/96 A AGGREGATED · 125 A AT 125%/g) ?? []).length).toBe(2);
    expect((svg.match(/2 BRANCH OCPD @ 60 A/g) ?? []).length).toBe(2);
    expect((svg.match(/125 A GENERATION FEEDER/g) ?? []).length).toBe(2);
    // All four cabinets, each named by its position.
    for (const n of [1, 2, 3, 4]) expect(svg).toContain(`Tesla Powerwall 3 #${n}`);
  });

  it('🚨 a DC-coupled design draws NO microinverter, combiner, inverter or PV AC disconnect', () => {
    // Ray, from the live browser: "SLD still draws Enphase equipment" under a Tesla topology.
    const svg = sheet(buildRaysIntendedJob().topology);
    // The storage is NAMED FROM THE GRAPH — the literal "POWERWALL 3" for every DC-coupled product is gone.
    expect(svg).toContain('PV DC COUPLED TO TESLA POWERWALL 3');
    expect(svg).not.toContain('AC COMBINER');
    expect(svg).not.toContain('IQ8PLUS');
    expect(svg).not.toContain('ENPHASE Q CABLE');
    expect(svg).not.toContain('AC DISCONNECT');
    expect(svg).not.toContain('MICROINVERTER');
    // The strings go to the batteries' PV inputs — and WHICH battery is not decided on this graph,
    // so the sheet says so instead of fanning a DC bus out to all four (System Config gauntlet: "Do
    // not imply a DC bus arrangement that does not match actual string/MPPT assignments").
    expect(svg).toContain('TO TESLA POWERWALL 3 PV INPUTS — DC COUPLED');
    expect(svg).toContain('STRING LANDING TO BE ASSIGNED');
    expect((svg.match(/LANDING TO BE ASSIGNED/g) ?? []).length).toBe(5);   // the tag + each of 4 units
  });

  it('🚨 once the landing is recorded, each unit states its own share and only those units are fed', () => {
    const t = buildRaysIntendedJob().topology;
    const units = t.storage.filter(u => u.role === 'inverter-unit');
    const landed = {
      ...t,
      storage: t.storage.map(u => u.id === units[0].id ? { ...u, pvDcStcKw: 15.4 }
        : u.id === units[1].id ? { ...u, pvDcStcKw: 0.88 }
          : u.role === 'inverter-unit' ? { ...u, pvDcStcKw: 0 } : u),
    };
    const svg = sheet(landed);
    expect(svg).toContain('PV DC IN — 15.40 kW STC');
    expect(svg).toContain('PV DC IN — 0.88 kW STC');
    expect((svg.match(/NO PV ON THIS UNIT/g) ?? []).length).toBe(2);
    expect(svg).not.toContain('LANDING TO BE ASSIGNED');
  });

  it('the SAME project with AC-coupled PV keeps the whole AC chain', () => {
    // 🚨 THE COUPLING DECIDES, NOT THE PRESENCE OF A POWERWALL. Ray: "Do not assume Tesla storage
    // always eliminates Enphase because legitimate AC-coupled Tesla installations exist."
    const { topology } = buildRaysIntendedJob({ solarCoupling: 'ac-coupled-inverter' });
    const svg = sheet(topology);
    expect(svg).toContain('AC COMBINER');
    expect(svg).not.toContain('TO TESLA POWERWALL 3 PV INPUTS — DC COUPLED');
  });

  it('🚨 the sheet asks in WORDS, once, and says which item is optional', () => {
    const svg = sheet(buildRaysIntendedJob().topology);
    // 🚨 NO INTERNAL TOKENS ON A PERMIT SHEET. It printed
    // "REQUIRES service.existingEquipment.catalogNumber, service.existingEquipment.mainArrangement"
    // — TypeScript field paths, for an inspector to read.
    expect(svg).not.toContain('service.existingEquipment.');
    expect(svg).not.toContain('loads.model');
    expect(svg).not.toContain('device.productId');
    expect(svg).toContain('Existing service equipment');
    expect(svg).toContain('model / catalog number');
    // And the dwelling load is ONE line, labelled optional — six checks depend on it, and it used
    // to print "REQUIRES loads.model" six times.
    expect((svg.match(/OPTIONAL, NOT PROVIDED/g) ?? []).length).toBe(1);
    expect(svg).toContain('Full load analysis');
    // And nothing on the outbound sheet passes a verdict on the design.
    for (const banner of ['DESIGN COMPLETE', 'RELEASE GATE', 'NOT FOR CONSTRUCTION']) {
      expect(svg, `${banner} must not appear`).not.toContain(banner);
    }
  });

  it('🚨 the layout audit is clean on EVERY sheet variant — measured, not hand-fed a roomy span', () => {
    // The span this section gets depends on how long the PV chain in front of it is: 784 uu on a
    // micro sheet, 773 with an integrated DC disconnect, 533 with an external one. A test that feeds
    // the audit its own generous number proves nothing about the sheet the product draws — which is
    // how nine overlapping boxes shipped. So the audit is driven from the REAL render here.
    const { topology } = buildRaysIntendedJob();
    const variants: Array<[string, Record<string, unknown>]> = [
      ['micro', {}],
      ['string + integrated DC disconnect',
        { topologyType: 'STRING', ecosystemTopology: 'string', selectedBrand: 'solaredge',
          integratedDcDisconnect: true, totalStrings: 2, deviceCount: 2 }],
      ['string + external DC disconnect',
        { topologyType: 'STRING', ecosystemTopology: 'string', selectedBrand: 'solaredge',
          integratedDcDisconnect: false, totalStrings: 2, deviceCount: 2 }],
    ];
    const logged: string[] = [];
    const realLog = console.log;
    console.log = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
    try {
      for (const [, over] of variants) sheet(topology, over);
    } finally { console.log = realLog; }

    const budgets = logged.filter(l => l.includes('[SLD SERVICE SECTION BUDGET]'));
    expect(budgets, 'the section must report its budget on every render').toHaveLength(3);
    for (const b of budgets) expect(b, `defects on ${b}`).toContain('defects=0');
    expect(logged.filter(l => l.includes('LAYOUT DEFECT'))).toEqual([]);
  });
});

describe('the hybrid sheet does not contradict the service graph', () => {
  // Ray: "If PV is also present, adding PV must not resurrect the old single-service tail."
  //
  // Stated plainly, and this is the one item in his prompt not finished: the multi-source sheet
  // still uses its own horizontal tail (panel → disconnect → POI → MSP → meter) rather than the
  // topology's column layout. What it no longer does is CONTRADICT the graph — the panel it draws
  // is the graph's panel, and everything the graph has that this sheet omits is named on it.
  const BASE = {
    projectName: 'HYBRID', clientName: 'Ray', address: 'Chicago IL', designer: 'SolarPro',
    drawingDate: '2026-09-29', drawingNumber: 'E-1', revision: 'A', scale: 'NOT TO SCALE',
    topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
    integratedDcDisconnect: false, totalModules: 30, totalStrings: 0, deviceCount: 30,
    panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
    dcWireGauge: '#10', dcConduitType: 'EMT', dcOCPD: 0,
    inverterModel: 'IQ8PLUS-72-2-US', inverterManufacturer: 'Enphase',
    acOutputKw: 8.7, acOutputAmps: 36.2, acWireGauge: '#6', acConduitType: 'EMT',
    acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
    // 🚨 A DELIBERATELY WRONG SCALAR. If the sheet draws 125 A the scalar won, and the drawing
    // disagrees with the schedule beside it about the size of the panel the PV lands in.
    mainPanelAmps: 125, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
    hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
    gateways: [
      { id: 'gw-1', label: 'Gateway 1', branches: [{ ocpdA: 20, deviceCount: 15 }] },
      { id: 'gw-2', label: 'Gateway 2', branches: [{ ocpdA: 20, deviceCount: 15 }] },
    ],
  };
  type SLDInput = Parameters<typeof renderSLDProfessional>[0];

  it('the panel it draws is the GRAPH\'s panel, not the mainPanelAmps scalar', () => {
    const { topology } = buildRaysIntendedJob();
    const svg = renderSLDProfessional(
      { ...BASE, serviceTopology: topology } as unknown as SLDInput);
    expect(svg).toContain('200A');
    expect(svg).not.toContain('125A MAIN');
  });

  it('it names every part of the graph it does not draw', () => {
    const { topology } = buildRaysIntendedJob();
    const svg = renderSLDProfessional(
      { ...BASE, serviceTopology: topology } as unknown as SLDInput);
    expect(svg).toContain('NOT SHOWN HERE');
    expect(svg).toContain('MSP #2');
    expect(svg).toContain('BACKUP CONTROLLER');
    // The note wraps, so assert on the words rather than on one unbroken phrase.
    expect(svg).toMatch(/UTILITY\s*<\/text>|UTILITY ISOLATION/);
    expect(svg).toContain('ONE PER PATH');
  });

  it('🚨 and its own EQUIPMENT SCHEDULE reads the graph, not the scalars', () => {
    const { topology } = buildRaysIntendedJob();
    const svg = renderSLDProfessional(
      { ...BASE, serviceTopology: topology } as unknown as SLDInput);
    // It printed "Main Panel 125 A" and "Battery Storage NONE" beside a graph with two 200 A
    // panelboards and two Powerwalls — the contradiction Ray rejected once already, on the sheet
    // nobody had looked at.
    expect(svg).toContain('Service Rating');
    expect(svg).toContain('MSP #1');
    expect(svg).toContain('MSP #2');
    expect(svg).toContain('Storage Capacity');
    // 🚨 FOUR INVERTING UNITS AND NO EXPANSION ROW, because this job has none. The row appears
    // only where expansions exist — a schedule that printed one here would be inventing hardware.
    expect(svg).toContain('4 × Tesla Powerwall 3');
    expect(svg).not.toContain('DC Expansions');
    // The scalar's number is gone from the schedule's Main Panel row.
    expect(svg).not.toMatch(/>Main Panel<[\s\S]{0,400}?>125 A</);
  });

  it('a project with NO graph still gets the legacy sheet, unchanged', () => {
    const svg = renderSLDProfessional({ ...BASE } as unknown as SLDInput);
    expect(svg).not.toContain('NOT SHOWN HERE');
    const { serviceTopology: _drop, ...same } =
      { ...BASE, serviceTopology: null } as unknown as Record<string, unknown>;
    expect(renderSLDProfessional(same as unknown as SLDInput)).toBe(svg);
  });
});

describe('🚨 the bond follows the service arrangement, not the gateway count', () => {
  it('ONE upstream service disconnect ⇒ ONE bond, and both gateways are feeder enclosures', () => {
    // Ray: "Do not put an N-G bond in each Gateway simply because there are two Gateways. Existing
    // service-disconnect/bond location must be determined from the real service arrangement."
    const { topology } = buildRaysIntendedJob();
    const { bonding } = evaluateServiceTopology(topology);
    expect(bonding.bondedAtNodeIds).toEqual(['svc-disco']);
    for (const d of topology.domains) {
      expect(bonding.neutralIsolatedNodeIds).toContain(d.gateway.id);
    }
    for (const p of topology.panels) {
      expect(bonding.neutralIsolatedNodeIds).toContain(p.id);
    }
  });

  it('with NO service disconnect identified it asserts nothing at all', () => {
    const { topology } = buildRaysIntendedJob();
    const noDisco: ServiceTopology = {
      ...topology,
      devices: topology.devices.filter(d => !d.roles.includes('service-disconnect')),
    };
    const { bonding } = evaluateServiceTopology(noDisco);
    expect(bonding.bondedAtNodeIds).toEqual([]);
    expect(bonding.neutralIsolatedNodeIds).toEqual([]);
    expect(check(noDisco, 'bonding.location')?.conclusion).toBe('NOT_EVALUATED');
  });
});

describe('🚨 the job CAN be finished — the model is not merely pessimistic', () => {
  /** Everything a human can actually answer, answered. Nothing invented. */
  function fullyAnswered(): ServiceTopology {
    let t = buildRaysIntendedJob({
      availableFaultCurrentA: 10_000,
      gatewaySccrA: 22_000,
    }).topology;
    t = setExistingServiceEquipment(t, {
      manufacturer: 'Eaton', catalogNumber: 'CH42B400',
      mainArrangement: 'Two 200 A mains, factory-grouped',
      feederArrangement: 'Two 200 A outgoing feeders, bottom entry',
      sccrA: 22_000, verified: true,
    });
    // 🚨 EACH PART WITH ITS OWN NAMEPLATE RATING. This used to select a 200 A DG224URK for EVERY device
    // — including the 400 A service disconnect — and PASSed only because the device kept the seeded
    // 400 A across the part change. A new part now brings its own numbers (selectDeviceProduct), so
    // the 400 A disconnect gets a 400 A switch and each rating is the part's.
    for (const d of t.devices) {
      t = (d.ratedAmps ?? 0) > 200
        ? selectDeviceProduct(t, d.id, 'eaton-dg325urk', { ratedAmps: 400 })
        : selectDeviceProduct(t, d.id, 'eaton-dg224urk', { ratedAmps: 200 });
    }
    // The generation panels: the part actually bought, its nameplate interrupting rating, and the
    // PV the string layout put on each Powerwall.
    for (const p of t.aggregationPanels) t = selectAggregationProduct(t, p.id, 'eaton-ch8l125rp');
    for (const u of t.storage.filter(u => u.role === 'inverter-unit')) {
      t = setStoragePvInput(t, u.id, 7.5);
    }
    t = {
      ...t,
      devices: t.devices.map(d => ({ ...d, sccrA: 22_000 })),
      panels: t.panels.map(p => ({ ...p, sccrA: 22_000 })),
      aggregationPanels: t.aggregationPanels.map(p => ({ ...p, sccrA: 22_000 })),
      interconnection: {
        ...t.interconnection,
        isolationArrangementAccepted: true,
        isolationArrangementBasis: 'ComEd interconnection application approved as drawn.',
        multiGatewayMeteringDoc: {
          title: 'Multiple Backup Gateways on a Single Site — Application Note',
          source: 'Tesla Partner Portal', present: true,
          governs: ['site metering', 'CT assignment'],
        },
      },
    };
    return t;
  }

  it('with every answerable input answered, only the OPTIONAL calculation is outstanding', () => {
    const t = fullyAnswered();
    const notPass = evaluateServiceTopology(t).checks.filter(c => c.conclusion !== 'PASS');
    // 🚨 WHAT THE GENERATION PANEL LANDS IN IS STILL THE MANUFACTURER'S. Nothing here invents how
    // much generation a Gateway 3's internal panelboard accepts, so that stays NOT_EVALUATED —
    // which is the honest end state for this arrangement, not a failure of the design.
    expect(notPass.map(c => c.id).sort())
      .toEqual(['aggregation.landing', 'aggregation.landing',
                'branch.demand', 'branch.demand', 'domain.backed-up-load', 'domain.backed-up-load',
                'load.calculation', 'service.demand']);
    const ov = buildServiceOverview(t);
    expect(ov.summary.optionalCount).toBe(1);
    // What is left required is the one manufacturer question — and it is named, not hidden.
    expect(ov.requiredInputs.filter(i => i.owner !== 'optional-calculation')
      .every(i => i.key.startsWith('manufacturer-document:'))).toBe(true);
  });

  it('adding the load analysis leaves ONLY the manufacturer question', () => {
    let t = fullyAnswered();
    t = setPanelLoad(t, 'msp-1', 118, { method: 'optional-220-82', basis: 'Appliance inventory.' });
    t = setPanelLoad(t, 'msp-2', 96);
    const ov = buildServiceOverview(t);
    expect(ov.summary.optionalCount).toBe(0);
    expect(ov.requiredInputs.map(i => i.key))
      .toEqual(['manufacturer-document:gateway-generation-input']);
    // Everything the load model derives now passes.
    for (const id of ['service.demand', 'branch.demand', 'domain.backed-up-load', 'load.calculation']) {
      expect(evaluateServiceTopology(t).checks.filter(c => c.id === id)
        .every(c => c.conclusion === 'PASS'), id).toBe(true);
    }
  });
});

describe('what is NOT claimed', () => {
  it('nothing asserts the utility accepts two isolation devices', () => {
    const { topology } = buildRaysIntendedJob();
    const ev = evaluateServiceTopology(topology);
    const jurisdiction = buildServiceOverview(topology, ev).requiredInputs
      .filter(i => i.owner === 'jurisdiction-authority');
    // The ruling is still owed, and the DER isolation check does not stand in for it.
    expect(jurisdiction.length).toBeGreaterThan(0);
    expect(ev.overall).not.toBe('PASS');
  });

  it('the Tesla multi-gateway document is still required and still missing', () => {
    const { topology } = buildRaysIntendedJob();
    const c = check(topology, 'metering.multi-gateway');
    expect(c?.conclusion).toBe('NOT_EVALUATED');
    const owners = groupRequirements(buildServiceOverview(topology).requiredInputs)
      .map(g => g.spec.owner);
    expect(owners).toContain('manufacturer-authority');
  });

  it('the needs-input screen groups by WHO OWES IT, optional last', () => {
    const { topology } = buildRaysIntendedJob();
    const groups = groupRequirements(buildServiceOverview(topology).requiredInputs);
    expect(groups.length).toBeGreaterThan(2);
    expect(groups[groups.length - 1].spec.owner).toBe('optional-calculation');
    // Every group says what to do about it — the thing Ray asked for when he rejected five
    // identical text boxes.
    for (const g of groups) expect(g.spec.action.length).toBeGreaterThan(10);
  });
});
