// ═══════════════════════════════════════════════════════════════════════════
// 🚨 "A CORRECT MODEL THAT NO OUTPUT CONSUMES IS NOT YET SOLARPRO FUNCTIONALITY."
//
// Ray, after the service graph landed: "`ServiceTopology` currently exists but has no authority
// until the rest of SolarPro consumes and persists it. Finish the real-project acceptance chain
// before moving on... Prove: `ServiceTopology equipment instances` = `BOM quantities` =
// `pricing quantities`."
//
// This file is the chain, on the real job: two Gateway 3, two Powerwall 3, two Expansion, two
// 200 A MSPs, one 400 A service. The SLD draws it, the BOM buys it, pricing multiplies the same
// numbers, and an Expansion is hardware in all three without ever being a source in any of them.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { buildServiceTopologyGraph } from '@/lib/sld/serviceTopologyGraph';
import {
  equipmentInstancesFromTopology, equipmentQuantities, acSourcesFromTopology, reconcileQuantities,
} from '@/lib/electrical/topologyEquipment';
import { bomFromServiceTopology, pricedQuantitiesFromBom } from '@/lib/bom/topologyBom';
import { evaluateServiceTopology } from '@/lib/electrical/serviceTopology';

const job = (over = {}) => buildTesla400ATwoGateway({
  availableFaultCurrentA: 10_000, gatewaySccrA: 10_000,
  calculatedServiceDemandA: 310, branchDemandA: [160, 150],
  storageConnection: 'gateway-panelboard',
  ...over,
}).topology;

// ── SLD ─────────────────────────────────────────────────────────────────────

describe('🚨 the SLD draws the canonical topology, not a one-off Tesla sheet', () => {
  it('renders utility → meter → isolation → service disconnect → 400 A distribution', () => {
    const g = buildServiceTopologyGraph(job());
    const types = g.nodes.map(n => n.type);
    expect(types).toContain('UTILITY_GRID');
    expect(types).toContain('UTILITY_METER');
    expect(types).toContain('DER_ISOLATION_DISCONNECT');
    expect(types).toContain('SERVICE_DISCONNECT');
    expect(types).toContain('SERVICE_DISTRIBUTION');
    const dist = g.nodes.find(n => n.type === 'SERVICE_DISTRIBUTION')!;
    expect(dist.label).toContain('400 A');
    expect(dist.qty, 'the distribution does not say how many ways it splits').toBe(2);
  });

  it('🚨 TWO gateways, TWO panels, TWO domains — no phantom third, no shared one', () => {
    const g = buildServiceTopologyGraph(job());
    const gateways = g.nodes.filter(n => n.type === 'GATEWAY');
    expect(gateways, 'the sheet drew a different number of gateways than the graph has')
      .toHaveLength(2);
    expect(new Set(gateways.map(n => n.id)).size, 'both domains drew the SAME gateway node').toBe(2);
    expect(g.nodes.filter(n => n.type === 'MAIN_SERVICE_PANEL')).toHaveLength(2);
    expect(g.domains.map(d => d.id)).toEqual(['domain-a', 'domain-b']);
    // Each domain owns its own gateway and its own panel.
    for (const d of g.domains) {
      const mine = g.nodes.filter(n => d.nodeIds.includes(n.id));
      expect(mine.filter(n => n.type === 'GATEWAY')).toHaveLength(1);
      expect(mine.filter(n => n.type === 'MAIN_SERVICE_PANEL')).toHaveLength(1);
    }
  });

  it('🚨 each Expansion is a DC node on a harness with NO OCPD — never an AC source', () => {
    const g = buildServiceTopologyGraph(job());
    const expansions = g.nodes.filter(n => n.type === 'DC_BATTERY_EXPANSION');
    expect(expansions).toHaveLength(2);
    expect(g.nodes.filter(n => n.type === 'ESS_AC_SOURCE')).toHaveLength(2);

    for (const e of expansions) {
      expect(e.ocpdRating, 'an Expansion was drawn with a breaker').toMatch(/None/i);
      // Its run reaches its HOST unit, and that run carries no overcurrent device.
      const seg = g.nodes.find(n => n.id === `run-${e.id}`)!;
      expect(seg.runSegment!.ocpdAmps, 'the DC expansion harness was given an OCPD').toBe(0);
      expect(seg.runSegment!.color).toBe('dc');
      const intoSeg = g.edges.find(x => x.to === seg.id)!;
      const host = g.nodes.find(n => n.id === intoSeg.from)!;
      expect(host.type, 'an Expansion was harnessed to something that is not an inverter unit')
        .toBe('ESS_AC_SOURCE');
    }
  });

  it('the neutral-ground bond is drawn where the topology puts it, once', () => {
    const g = buildServiceTopologyGraph(job());
    const bonds = g.nodes.filter(n => n.type === 'NEUTRAL_GROUND_BOND');
    // One 400 A service disconnect upstream of both gateways ⇒ exactly one bond, and NOT one per
    // gateway because a gateway exists.
    expect(bonds).toHaveLength(1);
    expect(bonds[0].label).toContain('400 A service disconnect');
    expect(g.notes.join(' ')).toMatch(/bonding screw removed/i);
  });

  it('🚨 manufacturer-governed callouts stay unresolved instead of being invented', () => {
    const g = buildServiceTopologyGraph(job());
    const cts = g.nodes.filter(n => n.type === 'CT_METERING');
    expect(cts).toHaveLength(2);
    for (const ct of cts) {
      const u = ct.unresolvedCallouts ?? [];
      expect(u.length, 'the CT arrangement was drawn as settled on a multi-gateway site')
        .toBeGreaterThan(0);
      expect(u[0].label).toMatch(/MANUFACTURER DOCUMENT REQUIRED/);
      expect(u[0].label).toMatch(/Multiple Backup Gateways on a Single Site/);
    }
    expect(g.notes.join('\n')).toMatch(/MANUFACTURER DOCUMENT REQUIRED/);
  });

  it('every device-to-device connection goes through a conductor run', () => {
    const g = buildServiceTopologyGraph(job());
    expect(g.validationErrors).toEqual([]);
    expect(g.hasDirectDeviceEdges, 'a device wired straight to a device').toBe(false);
  });

  it('🚨 the sheet notes carry the SAME indeterminate conclusions as the engineering', () => {
    const t = job();
    const evalResult = evaluateServiceTopology(t);
    const g = buildServiceTopologyGraph(t, evalResult);
    for (const c of evalResult.checks.filter(c => c.conclusion === 'NOT_EVALUATED')) {
      expect(g.notes.join('\n'), `the sheet is silent about '${c.id}'`).toContain(c.title);
    }
  });

  it('a single-gateway topology draws one gateway and no multi-gateway caveat', () => {
    const g = buildServiceTopologyGraph(
      buildTesla400ATwoGateway({ collapseToSingleGateway: true }).topology);
    expect(g.nodes.filter(n => n.type === 'GATEWAY')).toHaveLength(1);
    const cts = g.nodes.filter(n => n.type === 'CT_METERING');
    expect(cts.every(c => (c.unresolvedCallouts ?? []).length === 0)).toBe(true);
  });
});

// ── BOM AND PRICING ─────────────────────────────────────────────────────────

describe('🚨 topology instances = BOM quantities = pricing quantities', () => {
  it('the job resolves to exactly 2 gateways, 2 Powerwalls and 2 Expansions', () => {
    const q = equipmentQuantities(job());
    expect(q).toEqual({
      'tesla-backup-gateway-3': 2,
      'tesla-powerwall-3': 2,
      'tesla-powerwall-3-expansion': 2,
    });
  });

  it('🚨 and the three agree, exactly, with no independent fallback between them', () => {
    const t = job();
    const bom = bomFromServiceTopology(t);
    const priced = pricedQuantitiesFromBom(bom);
    expect(bom.quantities).toEqual(equipmentQuantities(t));
    expect(priced).toEqual(equipmentQuantities(t));
    expect(reconcileQuantities(t, priced), 'pricing disagrees with the topology').toEqual([]);
    expect(reconcileQuantities(t, bom.quantities)).toEqual([]);
  });

  it('a consumer that disagrees is REPORTED with both numbers, not rounded', () => {
    const t = job();
    const bad = { ...equipmentQuantities(t), 'tesla-backup-gateway-3': 1 };
    expect(reconcileQuantities(t, bad)).toEqual([
      { productId: 'tesla-backup-gateway-3', topology: 2, consumer: 1 },
    ]);
  });

  it('🚨 the Expansion buys hardware AND a harness, and is never an AC source', () => {
    const t = job();
    const bom = bomFromServiceTopology(t);
    const exp = bom.items.find(i => i.partNumber === 'tesla-powerwall-3-expansion')!;
    expect(exp, 'the Expansion was not ordered at all').toBeTruthy();
    expect(exp.quantity).toBe(2);
    expect(exp.notes).toMatch(/NO inverter, NO AC ESS breaker/);
    const harness = bom.items.find(i => i.partNumber.endsWith('-harness'))!;
    expect(harness, 'the expansion harness was never ordered').toBeTruthy();
    expect(harness.quantity, 'one harness per expansion').toBe(2);

    // And in every source count it is absent.
    const ac = acSourcesFromTopology(t);
    expect(ac.count, 'an Expansion was counted as an AC source').toBe(2);
    expect(ac.totalContinuousOutputA).toBeCloseTo(96, 6);
    expect(ac.byDomain['domain-a'].count).toBe(1);
    expect(ac.byDomain['domain-b'].count).toBe(1);
    expect(equipmentInstancesFromTopology(t)
      .filter(i => i.kind === 'storage-expansion')
      .every(i => i.contributesAcSource === false && i.continuousOutputA === 0)).toBe(true);
  });

  it('every BOM quantity is a count of instances, never a site scalar', () => {
    // Three domains ⇒ three of everything, with no parameter changed anywhere.
    const t = job();
    const third = JSON.parse(JSON.stringify(t.domains[1]));
    third.id = 'domain-c';
    third.gateway = { ...third.gateway, id: 'domain-c-gateway' };
    third.storageUnitIds = ['domain-c-ess-1', 'domain-c-exp-1'];
    t.domains.push(third);
    t.storage.push(
      { ...t.storage.find(u => u.role === 'inverter-unit')!, id: 'domain-c-ess-1' },
      { ...t.storage.find(u => u.role === 'energy-expansion')!, id: 'domain-c-exp-1',
        attachedToUnitId: 'domain-c-ess-1' },
    );
    const bom = bomFromServiceTopology(t);
    expect(bom.quantities['tesla-backup-gateway-3']).toBe(3);
    expect(bom.quantities['tesla-powerwall-3']).toBe(3);
    expect(bom.quantities['tesla-powerwall-3-expansion']).toBe(3);
    expect(pricedQuantitiesFromBom(bom)).toEqual(bom.quantities);
  });

  it('pricing multiplies the same quantity it was given', () => {
    const bom = bomFromServiceTopology(job());
    for (const item of bom.items) {
      if (item.unitCost === undefined) continue;
      expect(item.totalCost).toBeCloseTo(item.unitCost * item.quantity, 2);
    }
  });
});
