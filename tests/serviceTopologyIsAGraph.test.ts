// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A 400 A SERVICE IS NOT ONE MAIN PANEL WITH A BIGGER NUMBER ON IT.
//
// Ray has a real upcoming Tesla installation SolarPro could not engineer: 400 A split-phase
// service, two 200 A MSPs, two Gateway 3, two Powerwall 3, two Powerwall 3 Expansion, no
// meter-collar interconnection, ComEd.
//
//   "A Gateway 3 is a 200 A continuous device. A 400 A service cannot be represented as
//    `400 A service → one Gateway → everything`."
//   "FIRST — DO NOT SIMPLY INCREASE serviceAmps TO 400."
//
// The product had one of everything: `mainPanelAmps` / `mainPanelBusAmps` / `mainBreakerAmps` are
// three scalars with no service object behind them; the SLD node union has MAIN_SERVICE_PANEL and
// no service disconnect, no gateway and no backup-domain boundary; and `resolveBatteryBranch`
// states the assumption out loud — "One gateway, one point of connection".
//
// These tests hold the new graph to Ray's own acceptance list. The ones his list numbers 1, 11-14
// (save/reload, SLD, BOM, pricing, permit) are NOT here, because those consumers have not been
// wired yet and a test that pretended otherwise would be the worst thing in this file.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  evaluateServiceTopology, summariseStorage, deriveBonding,
  type ServiceTopology, type TopologyCheck,
} from '@/lib/electrical/serviceTopology';
import { buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { getBatteryById, getBackupInterfaceById } from '@/lib/equipment-db';
import { teslaMultiGatewayDocState } from '@/lib/electrical/adapters/tesla';

const check = (checks: TopologyCheck[], id: string, scope?: string) =>
  checks.find(c => c.id === id && (scope ? c.scope === scope : true));

/** A fully-specified version of Ray's job — everything established, so PASS is reachable. */
function fullySpecified(): ServiceTopology {
  const { topology } = buildTesla400ATwoGateway({
    availableFaultCurrentA: 10_000,
    gatewaySccrA: 10_000,
    calculatedServiceDemandA: 310,
    branchDemandA: [160, 150],
    generationOutputA: [0, 0],
    storageConnection: 'backed-up-panel-busbar',
    // 🚨 "EVERYTHING ESTABLISHED" NOW INCLUDES THE DESIGN DECISION. How the DER reaches the
    // service is a choice somebody has to make, and a job that has not made it is not fully
    // specified — which is exactly what this suite went red to say when the check was added.
    derArrangement: 'independent-branch',
  });
  // Establish the remaining instance facts the fixture deliberately leaves open.
  for (const d of topology.devices) d.sccrA = 22_000;
  for (const p of topology.panels) p.sccrA = 22_000;
  for (const d of topology.domains) d.backedUpDemandA = 100;
  // 🚨 "EVERYTHING ESTABLISHED" ALSO INCLUDES THE ACTUAL PART AND THE UTILITY'S RULING. A calculated
  // minimum rating with no catalogue part behind it is an open selection, and a proven isolation
  // traversal is not a utility approval — so a job that has neither is not fully specified, which is
  // exactly what this suite went red to say when those two checks were added.
  for (const d of topology.devices) d.productId = 'eaton-dg224urk';
  topology.interconnection.isolationArrangementAccepted = true;
  topology.interconnection.isolationArrangementBasis =
    'ComEd interconnection application approved for the arrangement as drawn.';
  return topology;
}

describe('🚨 the catalogue knows the two products that did not exist', () => {
  it('a Backup Gateway 3 is a 200 A continuous, service-entrance-rated device', () => {
    const gw = getBackupInterfaceById('tesla-backup-gateway-3');
    expect(gw, 'the product a 400 A service needs two of is not in the catalogue').toBeTruthy();
    expect(gw!.maxContinuousOutputA).toBe(200);
    expect(gw!.serviceEntranceRated).toBe(true);
    expect(gw!.compatibleBatteries).toContain('tesla-powerwall-3');
  });

  it('🚨 a Powerwall 3 Expansion carries energy and NO AC contribution at all', () => {
    const exp = getBatteryById('tesla-powerwall-3-expansion');
    expect(exp, 'the Expansion is not in the catalogue').toBeTruthy();
    expect(exp!.storageRole).toBe('energy-expansion');
    expect(exp!.expansionHostId).toBe('tesla-powerwall-3');
    expect(exp!.usableCapacityKwh).toBeGreaterThan(0);
    // 🚨 ZERO, NOT ABSENT. A consumer that sums these fields without knowing about `storageRole`
    // still gets the right answer — which is every consumer that exists today.
    expect(exp!.maxContinuousOutputA, 'an Expansion was given an AC output current').toBe(0);
    expect(exp!.backfeedBreakerA, 'an Expansion was given a backfeed breaker').toBe(0);
    expect(exp!.continuousPowerKw).toBe(0);
  });

  it('the Powerwall 3 itself is unchanged — this added a product, it did not edit one', () => {
    const pw = getBatteryById('tesla-powerwall-3')!;
    expect(pw.maxContinuousOutputA).toBe(48);
    expect(pw.backfeedBreakerA).toBe(50);
    expect(pw.usableCapacityKwh).toBe(13.5);
    expect(pw.storageRole ?? 'inverter-unit').toBe('inverter-unit');
  });
});

describe("🚨 Ray's job, as a graph", () => {
  it('survives as TWO gateways, TWO panels, TWO branches and FOUR storage units', () => {
    const { topology } = buildTesla400ATwoGateway();
    expect(topology.service.ratedAmps).toBe(400);
    expect(topology.branches.map(b => b.ratedAmps)).toEqual([200, 200]);
    expect(topology.panels).toHaveLength(2);
    expect(topology.domains).toHaveLength(2);
    // Two Powerwalls and two Expansions — four units, not two and not "2 × something".
    expect(topology.storage).toHaveLength(4);
    expect(topology.storage.filter(u => u.role === 'inverter-unit')).toHaveLength(2);
    expect(topology.storage.filter(u => u.role === 'energy-expansion')).toHaveLength(2);
  });

  it('🚨 each Powerwall/Expansion pairing survives — every expansion names its host', () => {
    const { topology } = buildTesla400ATwoGateway();
    const hosts = new Map(topology.storage.map(u => [u.id, u]));
    const expansions = topology.storage.filter(u => u.role === 'energy-expansion');
    expect(expansions).toHaveLength(2);
    for (const e of expansions) {
      expect(e.attachedToUnitId, `${e.id} is not harnessed to anything`).toBeTruthy();
      expect(hosts.get(e.attachedToUnitId!)!.role).toBe('inverter-unit');
    }
    // And the two expansions are on DIFFERENT hosts — one per domain, which is the arrangement.
    expect(new Set(expansions.map(e => e.attachedToUnitId)).size).toBe(2);
  });

  it('each domain is gateway + branch + panel + its own storage', () => {
    const { topology } = buildTesla400ATwoGateway();
    const [a, b] = topology.domains;
    expect(a.branchId).toBe('branch-a');
    expect(b.branchId).toBe('branch-b');
    expect(a.backedUpPanelIds).toEqual(['msp-1']);
    expect(b.backedUpPanelIds).toEqual(['msp-2']);
    expect(a.storageUnitIds).toHaveLength(2);   // one Powerwall + one Expansion
    expect(b.storageUnitIds).toHaveLength(2);
    expect(a.gateway.id).not.toBe(b.gateway.id);
    expect(a.gateway.continuousRatingA).toBe(200);
  });
});

describe('🚨 power and energy are different things', () => {
  it('aggregate storage energy counts every unit; AC current counts only the inverters', () => {
    const { topology } = buildTesla400ATwoGateway();
    const s = summariseStorage(topology);
    expect(s.inverterUnitCount).toBe(2);
    expect(s.expansionUnitCount).toBe(2);
    // 4 × 13.5 kWh — the Expansions' energy is real and must be in the site total.
    expect(s.totalUsableKwh).toBeCloseTo(54, 6);
    // 🚨 2 × 48 A, NOT 4 × 48 A. This is the arithmetic that would put twice the backfeed on the
    // job, and it is the reason a unit count alone can never be the input.
    expect(s.totalContinuousOutputA, 'the Expansions added inverter current').toBeCloseTo(96, 6);
  });

  it('per domain, each sees only its own', () => {
    const { topology } = buildTesla400ATwoGateway();
    const s = summariseStorage(topology);
    expect(s.byDomain['domain-a'].continuousOutputA).toBeCloseTo(48, 6);
    expect(s.byDomain['domain-a'].usableKwh).toBeCloseTo(27, 6);
    expect(s.byDomain['domain-b'].continuousOutputA).toBeCloseTo(48, 6);
  });

  it('🚨 an Expansion carrying AC current is a FAIL, not silently discarded', () => {
    // Dropping it quietly would make a wrong catalogue row invisible. It is both excluded from the
    // sum AND reported, so the bad data is visible.
    //
    // 🚨 AND THIS IS THE ONLY TEST HERE THAT PROVES THE ROLE FILTER. The catalogue row carries
    // continuousOutputA = 0, so deleting the `role === 'inverter-unit'` filter from
    // `summariseStorage` leaves every other total unchanged and every other assertion green —
    // measured, by deleting it. Two independent defences is the right design; a suite that can
    // only see one of them is not. Do not "simplify" this case away.
    const { topology } = buildTesla400ATwoGateway();
    const exp = topology.storage.find(u => u.role === 'energy-expansion')!;
    exp.continuousOutputA = 48;
    const r = evaluateServiceTopology(topology);
    expect(r.storageSummary.totalContinuousOutputA,
      'a bad expansion row leaked into the AC total').toBeCloseTo(96, 6);
    expect(check(r.checks, 'storage.expansion-contributes-no-ac')!.conclusion).toBe('FAIL');
  });

  it('an Expansion with no host is a FAIL, not attached to whatever was first', () => {
    const { topology } = buildTesla400ATwoGateway();
    topology.storage.find(u => u.role === 'energy-expansion')!.attachedToUnitId = null;
    const r = evaluateServiceTopology(topology);
    expect(check(r.checks, 'storage.expansion-has-a-host')!.conclusion).toBe('FAIL');
  });
});

describe('🚨 the defect this whole model exists to refuse', () => {
  it('400 A through ONE Gateway 3 FAILS, and says why', () => {
    const { topology } = buildTesla400ATwoGateway({ collapseToSingleGateway: true });
    const r = evaluateServiceTopology(topology);
    const c = check(r.checks, 'domain.gateway-passthrough')!;
    expect(c.conclusion, 'a 400 A branch through a 200 A gateway passed').toBe('FAIL');
    expect(c.detail).toMatch(/200 A continuous/);
    expect(r.overall).toBe('FAIL');
  });

  it('and the 400 A branch overloads the 200 A panel behind it too', () => {
    const { topology } = buildTesla400ATwoGateway({ collapseToSingleGateway: true });
    const r = evaluateServiceTopology(topology);
    expect(check(r.checks, 'domain.panel-rating')!.conclusion).toBe('FAIL');
  });

  it('🚨 a 400 A service does NOT make two 200 A branches automatically valid', () => {
    // Each branch carries its own load calculation, and an aggregate one does not stand in for it.
    const { topology } = buildTesla400ATwoGateway({ calculatedServiceDemandA: 310 });
    const r = evaluateServiceTopology(topology);
    expect(check(r.checks, 'service.demand')!.conclusion).toBe('PASS');
    expect(check(r.checks, 'branch.demand', 'branch:branch-a')!.conclusion).toBe('NOT_EVALUATED');
    expect(check(r.checks, 'branch.demand', 'branch:branch-b')!.conclusion).toBe('NOT_EVALUATED');
  });

  it('an over-subscribed branch FAILS on its own calculation', () => {
    const { topology } = buildTesla400ATwoGateway({
      calculatedServiceDemandA: 310, branchDemandA: [240, 150],
    });
    const r = evaluateServiceTopology(topology);
    expect(check(r.checks, 'branch.demand', 'branch:branch-a')!.conclusion).toBe('FAIL');
    expect(check(r.checks, 'branch.demand', 'branch:branch-b')!.conclusion).toBe('PASS');
  });

  it('branches that sum past the service FAIL', () => {
    const { topology } = buildTesla400ATwoGateway();
    topology.branches.forEach(b => { b.ratedAmps = 300; });
    expect(check(evaluateServiceTopology(topology).checks, 'service.branch-sum')!.conclusion).toBe('FAIL');
  });
});

describe('🚨 UNKNOWN MAY NOT BECOME PASS', () => {
  it('a job nobody has measured is NOT_EVALUATED, never PASS', () => {
    const { topology } = buildTesla400ATwoGateway();
    const r = evaluateServiceTopology(topology);
    expect(r.overall, 'an unmeasured job produced a passing engineering report').not.toBe('PASS');
    for (const id of ['service.demand', 'sccr.chain', 'branch.demand']) {
      const c = r.checks.find(x => x.id === id)!;
      expect(c.conclusion, `${id} passed with nothing established`).toBe('NOT_EVALUATED');
      expect(c.requires!.length, `${id} does not say what it needs`).toBeGreaterThan(0);
    }
  });

  it('🚨 no available fault current means NO device has been shown adequate', () => {
    const { topology } = buildTesla400ATwoGateway({ gatewaySccrA: 65_000 });
    const c = check(evaluateServiceTopology(topology).checks, 'sccr.chain')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(c.requires).toContain('service.availableFaultCurrentA');
  });

  it('a device below the available fault current FAILS', () => {
    const topology = fullySpecified();
    topology.service.availableFaultCurrentA = 25_000;
    const c = check(evaluateServiceTopology(topology).checks, 'sccr.chain')!;
    expect(c.conclusion).toBe('FAIL');
    expect(c.detail).toMatch(/below the 25000 A available/);
  });

  it('a gateway with no interrupting rating leaves the chain NOT_EVALUATED', () => {
    const topology = fullySpecified();
    topology.domains[0].gateway.sccrA = null;
    const c = check(evaluateServiceTopology(topology).checks, 'sccr.chain')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    // And it says the thing a breaker amperage alone does not settle.
    expect(c.detail).toMatch(/main breaker selected/);
  });

  it('everything established reaches PASS — the model is not just pessimistic', () => {
    // A panel that can actually take the backfeed: 225 A bus, 150 A main → 120 A allowed.
    const topology = fullySpecified();
    for (const p of topology.panels) { p.busbarRatingA = 225; p.mainBreakerA = 150; }
    const r = evaluateServiceTopology(topology);
    // Everything except the one thing Tesla has not given us.
    const notPass = r.checks.filter(c => c.conclusion !== 'PASS');
    expect(notPass.map(c => c.id)).toEqual(['metering.multi-gateway']);
  });

  it('🚨 a 200 A MSP with a 200 A main does NOT take a Powerwall on its busbar', () => {
    // A real engineering result on Ray's own job, not a modelling artefact: 200 x 1.2 = 240,
    // less the 200 A main leaves 40 A, and one Powerwall 3 is a 50 A breaker. It is reported the
    // moment somebody says the breaker lands on the panel — which is why WHERE it lands is a
    // field and not an assumption.
    const topology = fullySpecified();
    const perPanel = evaluateServiceTopology(topology).checks
      .filter(c => c.id === 'domain.busbar-705-12');
    expect(perPanel).toHaveLength(2);
    expect(perPanel.every(c => c.conclusion === 'FAIL')).toBe(true);
    expect(perPanel[0].detail).toMatch(/40\.0 A allowed/);
  });

  it('🚨 and inside the gateway it is NOT_EVALUATED — a different rule, which we do not hold', () => {
    const topology = fullySpecified();
    for (const d of topology.domains) d.storageConnection = 'gateway-panelboard';
    const c = evaluateServiceTopology(topology).checks.find(x => x.id === 'domain.busbar-705-12')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(c.detail).toMatch(/not the governing limit/);
    expect(c.requires![0]).toMatch(/^manufacturer-limit:/);
  });

  it('unresolved is unresolved — the default state of a job nobody has decided', () => {
    const { topology } = buildTesla400ATwoGateway();
    const c = evaluateServiceTopology(topology).checks.find(x => x.id === 'domain.busbar-705-12')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(c.requires).toContain('domain.storageConnection');
  });
});

describe('🚨 bonding is derived from where the service disconnect is', () => {
  it('one 400 A service disconnect upstream ⇒ one bond there, feeders below', () => {
    const { topology } = buildTesla400ATwoGateway();
    const b = deriveBonding(topology);
    expect(b.bondedAtNodeIds).toEqual(['svc-disco']);
    // Both gateways and both panels are feeder enclosures.
    expect(b.neutralIsolatedNodeIds).toEqual(expect.arrayContaining([
      'domain-a-gateway', 'domain-b-gateway', 'msp-1', 'msp-2',
    ]));
    expect(b.basis).toMatch(/bonding screw removed/i);
    expect(check(evaluateServiceTopology(topology).checks, 'bonding.location')!.conclusion).toBe('PASS');
  });

  it('🚨 the grouped arrangement bonds EACH service disconnect, and nothing below', () => {
    // The other approved topology: the two 200 A devices ARE the service disconnects.
    const { topology } = buildTesla400ATwoGateway();
    topology.devices = [
      { id: 'svc-a', label: 'Service disconnect A', roles: ['service-disconnect'], ratedAmps: 200,
        sccrA: null, lockableOpen: true, visibleOpen: null },
      { id: 'svc-b', label: 'Service disconnect B', roles: ['service-disconnect'], ratedAmps: 200,
        sccrA: null, lockableOpen: true, visibleOpen: null },
    ];
    const b = deriveBonding(topology);
    expect(b.bondedAtNodeIds).toEqual(['svc-a', 'svc-b']);
    expect(b.basis).toMatch(/grouped service/i);
    expect(b.neutralIsolatedNodeIds).not.toContain('svc-a');
  });

  it('no service disconnect ⇒ the bond location is NOT_EVALUATED, not assumed', () => {
    const { topology } = buildTesla400ATwoGateway();
    topology.devices = topology.devices.filter(d => !d.roles.includes('service-disconnect'));
    const r = evaluateServiceTopology(topology);
    const c = check(r.checks, 'bonding.location')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(c.detail).toMatch(/undetermined/);
  });
});

describe('🚨 four disconnect roles, not one disconnectAmps field', () => {
  it('a device holding two roles with no authority is a FAIL', () => {
    const { topology } = buildTesla400ATwoGateway();
    topology.devices = [{
      id: 'combo', label: 'Combined disconnect',
      roles: ['service-disconnect', 'der-isolation-disconnect'],
      ratedAmps: 400, sccrA: null, lockableOpen: true, visibleOpen: true,
    }];
    const c = check(evaluateServiceTopology(topology).checks, 'device.role-combination')!;
    expect(c.conclusion).toBe('FAIL');
  });

  it('and PASSES when an authority names why one device may do both', () => {
    const { topology } = buildTesla400ATwoGateway();
    topology.devices = [{
      id: 'combo', label: 'Combined disconnect',
      roles: ['service-disconnect', 'der-isolation-disconnect'],
      ratedAmps: 400, sccrA: null, lockableOpen: true, visibleOpen: true,
      roleCombinationAuthority: 'ComEd written approval on file for this address',
    }];
    const checks = evaluateServiceTopology(topology).checks;
    expect(checks.find(c => c.id === 'device.role-combination')).toBeUndefined();
  });
});

describe('🚨 ComEd, and the interconnection Ray is not allowed to use', () => {
  it('a meter-collar interconnection on this project FAILS', () => {
    const { topology } = buildTesla400ATwoGateway({ selectMeterCollar: true });
    const c = check(evaluateServiceTopology(topology).checks, 'interconnection.meter-collar')!;
    expect(c.conclusion).toBe('FAIL');
    expect(c.detail).toMatch(/Gateway-based, non-meter-collar topology is required/);
  });

  it('the Gateway-based topology raises no meter-collar check at all', () => {
    const { topology } = buildTesla400ATwoGateway();
    expect(evaluateServiceTopology(topology).checks
      .find(c => c.id === 'interconnection.meter-collar')).toBeUndefined();
  });

  it('the external DER isolation device is required, present, lockable and visible-open', () => {
    const c = check(evaluateServiceTopology(fullySpecified()).checks,
      'interconnection.der-isolation')!;
    expect(c.conclusion).toBe('PASS');
  });

  it('🚨 removing it FAILS — the requirement is not satisfied by the service disconnect', () => {
    const topology = fullySpecified();
    topology.devices = topology.devices.filter(d => !d.roles.includes('der-isolation-disconnect'));
    const c = check(evaluateServiceTopology(topology).checks, 'interconnection.der-isolation')!;
    expect(c.conclusion).toBe('FAIL');
    expect(c.detail).toMatch(/no device in this topology carries that role/);
  });

  it('an isolation device below the available fault current FAILS on SCCR', () => {
    const topology = fullySpecified();
    topology.devices.find(d => d.roles.includes('der-isolation-disconnect'))!.sccrA = 5_000;
    const c = check(evaluateServiceTopology(topology).checks, 'interconnection.der-isolation')!;
    expect(c.conclusion).toBe('FAIL');
    expect(c.detail).toMatch(/below the 10000 A available/);
  });

  it('an unresolved jurisdiction is NOT_EVALUATED, not waved through', () => {
    const { topology } = buildTesla400ATwoGateway();
    topology.interconnection.externalDerIsolationRequired = null;
    const c = check(evaluateServiceTopology(topology).checks, 'interconnection.der-isolation')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
  });
});

describe('🚨 MANUFACTURER DOCUMENT REQUIRED — what Tesla has not told us', () => {
  it('a multi-gateway site names the missing application note and refuses to guess', () => {
    const r = evaluateServiceTopology(fullySpecified());
    const c = check(r.checks, 'metering.multi-gateway')!;
    expect(c.conclusion, 'SolarPro decided multi-gateway metering on its own').toBe('NOT_EVALUATED');
    expect(c.title).toMatch(/MANUFACTURER DOCUMENT REQUIRED/);
    expect(c.detail).toMatch(/Multiple Backup Gateways on a Single Site/);
    expect(c.detail).toMatch(/master/);
  });

  it('the state comes from the asset registry, so flipping it there is what changes the answer', () => {
    const doc = teslaMultiGatewayDocState();
    expect(doc.present, 'the Partner Portal note is claimed present without an archived copy')
      .toBe(false);
    expect(doc.governs).toEqual(expect.arrayContaining([
      'site metering across gateways', 'CT assignment', 'commissioning',
    ]));
  });

  it('a SINGLE-gateway site raises no such check — the document governs multi-gateway sites', () => {
    const { topology } = buildTesla400ATwoGateway({ collapseToSingleGateway: true });
    expect(evaluateServiceTopology(topology).checks
      .find(c => c.id === 'metering.multi-gateway')).toBeUndefined();
  });
});

describe('🚨 the 120% busbar allowance is evaluated PER DOMAIN', () => {
  it('each panel sees only the storage and generation in its own domain', () => {
    const topology = fullySpecified();
    const r = evaluateServiceTopology(topology);
    const perPanel = r.checks.filter(c => c.id === 'domain.busbar-705-12');
    expect(perPanel).toHaveLength(2);
    expect(perPanel.map(c => c.scope)).toEqual(['domain:domain-a', 'domain:domain-b']);
  });

  it('🚨 and it is NOT the whole site summed onto one bus', () => {
    // The old model's "one gateway, one point of connection" would have put 96 A on a single panel.
    const topology = fullySpecified();
    const r = evaluateServiceTopology(topology);
    const c = r.checks.find(x => x.id === 'domain.busbar-705-12')!;
    expect(c.detail, 'both domains were summed onto one busbar').toMatch(/48\.0 A of backfeed/);
  });

  it('a 225 A bus with a 150 A main takes the same 48 A', () => {
    const topology = fullySpecified();
    for (const p of topology.panels) { p.busbarRatingA = 225; p.mainBreakerA = 150; }
    const perPanel = evaluateServiceTopology(topology).checks
      .filter(c => c.id === 'domain.busbar-705-12');
    expect(perPanel.every(c => c.conclusion === 'PASS')).toBe(true);
  });
});

describe('🚨 the graph is generic — Tesla is the proving case, not the model', () => {
  it('serviceTopology.ts names no manufacturer, no product and no 200', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'lib', 'electrical', 'serviceTopology.ts'), 'utf8');
    const code = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    for (const forbidden of ['Powerwall', 'Gateway 3', 'tesla-', 'ComEd']) {
      expect(code, `the generic service graph hard-codes '${forbidden}'`).not.toContain(forbidden);
    }
  });

  it('the adapter writes no rating of its own — every number comes from the catalogue', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'lib', 'electrical', 'adapters', 'tesla.ts'), 'utf8');
    const code = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    // A rating typed into an adapter is a second equipment authority.
    expect(code, 'a continuous rating was typed into the Tesla adapter').not.toMatch(/\b200\b/);
    // It DELEGATES the catalogue reads rather than holding its own copy — two copies of the same
    // lookups is how a UI-built domain and a fixture-built one begin to differ.
    expect(code).toContain('buildDomainFromCatalogue');

    const generic = readFileSync(
      join(__dirname, '..', 'lib', 'electrical', 'topologyAuthoring.ts'), 'utf8');
    expect(generic).toContain('getBackupInterfaceById');
    expect(generic).toContain('getBatteryById');
    // And the generic builder names no manufacturer either.
    const genericCode = generic.split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    for (const forbidden of ['Powerwall', 'tesla-', 'ComEd']) {
      expect(genericCode, `the generic authoring module hard-codes '${forbidden}'`)
        .not.toContain(forbidden);
    }
  });

  it('a 600 A service with three domains evaluates the same way', () => {
    const { topology } = buildTesla400ATwoGateway();
    topology.service.ratedAmps = 600;
    topology.branches.push({
      id: 'branch-c', label: 'Branch C', ratedAmps: 200, ocpdAmps: 200, calculatedDemandA: 120,
    });
    const r = evaluateServiceTopology(topology);
    expect(check(r.checks, 'service.branch-sum')!.conclusion).toBe('PASS');
    expect(check(r.checks, 'branch.demand', 'branch:branch-c')!.conclusion).toBe('PASS');
  });
});
