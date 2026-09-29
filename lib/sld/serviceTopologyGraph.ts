// ═══════════════════════════════════════════════════════════════════════════
// THE CANONICAL SERVICE GRAPH, DRAWN.
//
// Ray: "Extend the existing SLD authority to represent this topology. **Do not build a one-off
// Tesla drawing.**"
//
// So this renders a `ServiceTopology` — any service topology — into the SLD vocabulary that
// `lib/topology-engine.ts` already owns: `SLDNode`, `SLDEdge`, and the RUN_SEGMENT invariant that
// every device-to-device connection passes through a conductor run. It names no manufacturer and
// reads no catalogue; it draws what the graph says.
//
// For Ray's fixture it produces, structurally:
//
//   UTILITY → meter → DER isolation → service disconnect → 400 A SERVICE DISTRIBUTION
//        ├─ 200 A branch feeder → GATEWAY #1 → 200 A feeder → MSP #1     (domain A)
//        │       ESS AC SOURCE #1 ──AC──┘        EXPANSION #1 ──DC harness──┘(to the Powerwall)
//        └─ 200 A branch feeder → GATEWAY #2 → 200 A feeder → MSP #2     (domain B)
//                ESS AC SOURCE #2 ──AC──┘        EXPANSION #2 ──DC harness──┘
//
// ═══ THE THREE THINGS THIS MUST NOT DRAW ═══
//
//   · NO EXPANSION AC BREAKER. An expansion reaches its host over the manufacturer's DC harness.
//     Its run segment carries `ocpdAmps: 0` and the node is `DC_BATTERY_EXPANSION`, never
//     `ESS_AC_SOURCE`, so nothing downstream — BOM, schedule, backfeed — can pick it up as a
//     source.
//   · NO PHANTOM THIRD GATEWAY. Gateways come from `topology.domains`, one each. There is no
//     count, no default and no "add one for the site".
//   · NO SHARED SINGLE GATEWAY. Each domain's gateway is its own node with its own id, its own
//     branch feeder and its own panel.
//
// ═══ AND WHAT IT REFUSES TO DRAW ═══
//
// Callouts governed by an authority SolarPro does not hold are attached to the node as
// `unresolvedCallouts` and rendered verbatim. A structurally complete diagram with an honest
// "MANUFACTURER DOCUMENT REQUIRED" on the metering callout is a usable drawing; the same diagram
// with an invented CT arrangement is a liability.
// ═══════════════════════════════════════════════════════════════════════════

import type { SLDNode, SLDEdge, RunSegment } from '@/lib/topology-engine';
import {
  evaluateServiceTopology,
  type ServiceTopology, type TopologyEvaluation,
} from '@/lib/electrical/serviceTopology';
import { notEvaluatedLabel } from '@/lib/engineering/engineeringStatus';

export interface ServiceSldDomain {
  id: string;
  label: string;
  /** Every node inside this domain's boundary, in drawing order. */
  nodeIds: string[];
}

export interface ServiceSldGraph {
  nodes: SLDNode[];
  edges: SLDEdge[];
  /** Domain boundaries. A grouping, not a device — see `SLDNode.domainId`. */
  domains: ServiceSldDomain[];
  /** Sheet notes, including every unresolved authority. */
  notes: string[];
  /** True when a device-to-device edge slipped in. Must be false for a permit-grade sheet. */
  hasDirectDeviceEdges: boolean;
  validationErrors: string[];
}

/** A conductor run with nothing computed. Ampacity belongs to the conductor authority, not here. */
function run(id: string, label: string, opts: Partial<RunSegment> = {}): RunSegment {
  return {
    id, label,
    conductorCount: 0, conductorGauge: '', conductorMaterial: 'CU', conductorInsulation: '',
    egcGauge: '', neutralRequired: true,
    conduitType: '', conduitSize: '', conduitFillPercent: 0, onewayLengthFt: 0,
    continuousCurrent: 0, requiredAmpacity: 0, effectiveAmpacity: 0,
    tempDeratingFactor: 1, conduitFillDeratingFactor: 1,
    ocpdAmps: 0,
    voltageDropPct: 0, voltageDropVolts: 0,
    ampacityPass: false, voltageDropPass: false, overallPass: false,
    necReferences: [],
    conductorCallout: '',
    color: 'ac',
    ...opts,
  };
}

/**
 * Render a service topology as an SLD graph.
 *
 * @param evaluation optional; when omitted it is computed, so the sheet's unresolved callouts and
 *                   the engineering report can never disagree about what is unresolved.
 */
export function buildServiceTopologyGraph(
  topology: ServiceTopology,
  evaluation?: TopologyEvaluation,
): ServiceSldGraph {
  const evalResult = evaluation ?? evaluateServiceTopology(topology);
  const nodes: SLDNode[] = [];
  const edges: SLDEdge[] = [];
  const notes: string[] = [];
  const domains: ServiceSldDomain[] = [];
  const validationErrors: string[] = [];

  let order = 0;
  const add = (n: Omit<SLDNode, 'layoutOrder'> & { layoutOrder?: number }): SLDNode => {
    const node = { ...n, layoutOrder: n.layoutOrder ?? order++ } as SLDNode;
    nodes.push(node);
    return node;
  };
  /** Device → run → device. The invariant is satisfied by construction, never by convention. */
  const link = (fromId: string, seg: SLDNode, toId: string) => {
    edges.push({ from: fromId, to: seg.id });
    edges.push({ from: seg.id, to: toId });
  };

  const panelById = new Map(topology.panels.map(p => [p.id, p]));
  const branchById = new Map(topology.branches.map(b => [b.id, b]));
  const storageById = new Map(topology.storage.map(u => [u.id, u]));
  const amps = (v: number | null | undefined) => (typeof v === 'number' ? `${v} A` : 'NOT EVALUATED');

  // ── UTILITY → METER ───────────────────────────────────────────────────────
  const utility = add({
    id: 'utility', type: 'UTILITY_GRID',
    label: `Utility service — ${topology.service.ratedAmps} A, ${topology.service.voltage} V `
      + `${topology.service.phase === 'split-240' ? 'split phase' : topology.service.phase}`,
    ratedCurrent: `${topology.service.ratedAmps} A`,
    ratedVoltage: `${topology.service.voltage} V`,
  });
  const meter = add({ id: 'utility-meter', type: 'UTILITY_METER', label: 'Revenue meter' });
  link(utility.id, add({
    id: 'run-utility-meter', type: 'RUN_SEGMENT', label: 'Service entrance conductors',
    runSegment: run('SERVICE_ENTRANCE_RUN', 'Service entrance conductors',
      { ocpdAmps: topology.service.ratedAmps }),
  }), meter.id);

  // ── UTILITY DER ISOLATION, WHERE ONE IS REQUIRED ──────────────────────────
  //
  // Drawn where the topology has one. Its ABSENCE when the utility requires it is an engineering
  // FAIL, reported by the evaluation — the drawing does not invent a device to make itself tidy.
  let upstreamId = meter.id;
  const isolators = topology.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
  for (const d of isolators) {
    const n = add({
      id: d.id, type: 'DER_ISOLATION_DISCONNECT',
      label: d.label,
      ratedCurrent: amps(d.ratedAmps),
      ocpdRating: d.sccrA === null ? 'SCCR NOT EVALUATED' : `${d.sccrA} A SCCR`,
      necReference: d.locationNote ?? undefined,
      unresolvedCallouts: d.sccrA === null
        ? [{ field: 'sccr', label: 'NOT EVALUATED — INTERRUPTING RATING REQUIRED', requires: [`sccr:${d.id}`] }]
        : undefined,
    });
    link(upstreamId, add({
      id: `run-${d.id}`, type: 'RUN_SEGMENT', label: 'To utility isolation',
      runSegment: run('DER_ISOLATION_RUN', 'To utility isolation', { ocpdAmps: d.ratedAmps ?? 0 }),
    }), n.id);
    upstreamId = n.id;
  }

  // ── SERVICE DISCONNECT(S) ─────────────────────────────────────────────────
  const serviceDisconnects = topology.devices.filter(d => d.roles.includes('service-disconnect'));
  const bondedIds = new Set(evalResult.bonding.bondedAtNodeIds);
  for (const d of serviceDisconnects) {
    const n = add({
      id: d.id, type: 'SERVICE_DISCONNECT',
      label: d.label,
      ratedCurrent: amps(d.ratedAmps),
      ocpdRating: d.sccrA === null ? 'SCCR NOT EVALUATED' : `${d.sccrA} A SCCR`,
      unresolvedCallouts: d.sccrA === null
        ? [{ field: 'sccr', label: 'NOT EVALUATED — INTERRUPTING RATING REQUIRED', requires: [`sccr:${d.id}`] }]
        : undefined,
    });
    link(upstreamId, add({
      id: `run-${d.id}`, type: 'RUN_SEGMENT', label: 'To service disconnect',
      runSegment: run('SERVICE_DISCONNECT_RUN', 'To service disconnect', { ocpdAmps: d.ratedAmps ?? 0 }),
    }), n.id);
    upstreamId = n.id;
  }

  // ── THE NEUTRAL-GROUND BOND, WHERE THE TOPOLOGY PUTS IT ───────────────────
  //
  // 🚨 ONE BOND PER SERVICE ENCLOSURE, AND NOT ONE PER GATEWAY BECAUSE A GATEWAY EXISTS.
  // Ray: "There may be exactly the bonds permitted by the selected service arrangement." The list
  // comes from `deriveBonding`, so the drawing and the engineering cannot differ about it.
  for (const id of evalResult.bonding.bondedAtNodeIds) {
    const host = nodes.find(n => n.id === id);
    const bond = add({
      id: `bond-${id}`, type: 'NEUTRAL_GROUND_BOND',
      label: `Neutral-ground bond at ${host?.label ?? id}`,
      necReference: 'NEC 250.24 / 250.142',
    });
    edges.push({ from: id, to: bond.id });
  }
  if (evalResult.bonding.bondedAtNodeIds.length === 0) {
    notes.push('NOT EVALUATED — SERVICE DISCONNECT REQUIRED: the neutral-ground bond location '
      + 'cannot be shown until the service point is identified.');
  } else {
    notes.push(evalResult.bonding.basis);
  }

  // ── THE SERVICE SPLIT ─────────────────────────────────────────────────────
  const distribution = add({
    id: 'service-distribution', type: 'SERVICE_DISTRIBUTION',
    label: `${topology.service.ratedAmps} A service distribution`,
    ratedCurrent: `${topology.service.ratedAmps} A`,
    qty: topology.branches.length,
  });
  link(upstreamId, add({
    id: 'run-distribution', type: 'RUN_SEGMENT', label: 'To service distribution',
    runSegment: run('SERVICE_DISTRIBUTION_RUN', 'To service distribution',
      { ocpdAmps: topology.service.ratedAmps }),
  }), distribution.id);

  // ── ONE PATH PER BRANCH ───────────────────────────────────────────────────
  for (const branch of topology.branches) {
    const domain = topology.domains.find(d => d.branchId === branch.id) ?? null;
    const domainNodeIds: string[] = [];

    // The branch feeder leaves the distribution at the branch's own OCPD.
    const feeder = add({
      id: `run-${branch.id}`, type: 'RUN_SEGMENT',
      label: `${branch.label} feeder — ${branch.ratedAmps} A`,
      runSegment: run('BRANCH_FEEDER_RUN', `${branch.label} feeder`,
        { ocpdAmps: branch.ocpdAmps ?? branch.ratedAmps }),
      domainId: domain?.id,
    });

    if (!domain) {
      // A branch with no backup domain still gets drawn — partial backup is a real arrangement.
      const panel = topology.panels.find(p => !p.backedUp);
      const target = panel ? add({
        id: panel.id, type: 'MAIN_SERVICE_PANEL', label: panel.label,
        ratedCurrent: amps(panel.busbarRatingA), ocpdRating: amps(panel.mainBreakerA),
      }) : null;
      if (target) link(distribution.id, feeder, target.id);
      else validationErrors.push(`${branch.label} feeds nothing in this topology.`);
      continue;
    }

    // GATEWAY — one per domain, from the domain, never from a count.
    const gw = domain.gateway;
    const gwNode = add({
      id: gw.id, type: 'GATEWAY',
      label: gw.label,
      model: gw.productId,
      ratedCurrent: amps(gw.continuousRatingA),
      ocpdRating: amps(gw.mainBreakerA),
      necReference: gw.serviceEntranceRated ? 'Service entrance rated' : undefined,
      domainId: domain.id,
      unresolvedCallouts: gw.sccrA === null
        ? [{ field: 'sccr', label: 'NOT EVALUATED — INTERRUPTING RATING REQUIRED (depends on the '
            + 'main breaker fitted)', requires: [`sccr:${gw.id}`] }]
        : undefined,
    });
    link(distribution.id, feeder, gwNode.id);
    domainNodeIds.push(feeder.id, gwNode.id);

    // METERING / CT — its arrangement may be manufacturer-governed on a multi-gateway site.
    const doc = topology.interconnection.multiGatewayMeteringDoc;
    const multiGateway = topology.domains.length > 1;
    const ct = add({
      id: `ct-${domain.id}`, type: 'CT_METERING',
      label: `${domain.label} metering CTs`,
      domainId: domain.id,
      unresolvedCallouts: multiGateway && !(doc?.present)
        ? [{
            field: 'ct-arrangement',
            label: `MANUFACTURER DOCUMENT REQUIRED — ${doc?.title ?? 'multi-gateway application note'}`,
            requires: [`manufacturer-document:${doc?.title ?? 'multi-gateway-metering'}`],
          }]
        : undefined,
    });
    edges.push({ from: gwNode.id, to: ct.id });   // a sensing association, not a conductor run
    domainNodeIds.push(ct.id);

    // GATEWAY → MSP
    for (const pid of domain.backedUpPanelIds) {
      const p = panelById.get(pid);
      if (!p) { validationErrors.push(`${domain.label} names panel '${pid}', which does not exist.`); continue; }
      const pNode = add({
        id: p.id, type: p.backedUp ? 'MAIN_SERVICE_PANEL' : 'SUBPANEL',
        label: p.label,
        ratedCurrent: amps(p.busbarRatingA),
        ocpdRating: amps(p.mainBreakerA),
        domainId: domain.id,
      });
      const seg = add({
        id: `run-${gw.id}-${p.id}`, type: 'RUN_SEGMENT',
        label: `${gw.label} to ${p.label}`,
        runSegment: run('GATEWAY_TO_PANEL_RUN', `${gw.label} to ${p.label}`,
          { ocpdAmps: p.mainBreakerA ?? branch.ratedAmps }),
        domainId: domain.id,
      });
      link(gwNode.id, seg, pNode.id);
      domainNodeIds.push(seg.id, pNode.id);
    }

    // ── STORAGE ─────────────────────────────────────────────────────────────
    //
    // The AC source lands where the topology says it lands. Unresolved means the connection is
    // drawn to the gateway and the callout says so, rather than a guess in either direction.
    const units = domain.storageUnitIds.map(id => storageById.get(id)).filter(Boolean) as typeof topology.storage;
    const acTargetId = domain.storageConnection === 'backed-up-panel-busbar'
      ? (domain.backedUpPanelIds[0] ?? gwNode.id)
      : gwNode.id;

    for (const u of units.filter(x => x.role === 'inverter-unit')) {
      const n = add({
        id: u.id, type: 'ESS_AC_SOURCE',
        label: `ESS ${u.productId}`,
        model: u.productId,
        ratedCurrent: amps(u.continuousOutputA),
        ocpdRating: amps(u.ocpdA),
        ratedPower: u.usableKwh === null ? undefined : `${u.usableKwh} kWh`,
        domainId: domain.id,
        unresolvedCallouts: domain.storageConnection === 'unresolved'
          ? [{ field: 'point-of-connection',
               label: 'NOT EVALUATED — POINT OF CONNECTION REQUIRED (gateway panelboard or panel busbar)',
               requires: ['domain.storageConnection'] }]
          : undefined,
      });
      const seg = add({
        id: `run-${u.id}`, type: 'RUN_SEGMENT',
        label: `${u.productId} AC connection`,
        runSegment: run('ESS_AC_RUN', `${u.productId} AC connection`, { ocpdAmps: u.ocpdA ?? 0 }),
        domainId: domain.id,
      });
      link(n.id, seg, acTargetId);
      domainNodeIds.push(n.id, seg.id);
    }

    // 🚨 AND THE EXPANSIONS: DC, TO THEIR HOST, WITH NO OCPD.
    for (const u of units.filter(x => x.role === 'energy-expansion')) {
      const hostId = u.attachedToUnitId;
      const n = add({
        id: u.id, type: 'DC_BATTERY_EXPANSION',
        label: `DC expansion ${u.productId}`,
        model: u.productId,
        ratedPower: u.usableKwh === null ? undefined : `${u.usableKwh} kWh`,
        // Stated, so a reader cannot wonder whether one was left off by accident.
        ocpdRating: 'None — DC extension of its host unit',
        domainId: domain.id,
      });
      if (!hostId || !storageById.has(hostId)) {
        validationErrors.push(`${u.id} is a DC expansion with no host unit to connect to.`);
        domainNodeIds.push(n.id);
        continue;
      }
      const seg = add({
        id: `run-${u.id}`, type: 'RUN_SEGMENT',
        label: 'DC expansion harness',
        runSegment: run('DC_EXPANSION_HARNESS_RUN', 'DC expansion harness',
          { ocpdAmps: 0, color: 'dc', neutralRequired: false }),
        domainId: domain.id,
      });
      link(hostId, seg, n.id);
      domainNodeIds.push(seg.id, n.id);
    }

    domains.push({ id: domain.id, label: domain.label, nodeIds: domainNodeIds });
  }

  // ── NOTES: EVERY UNRESOLVED AUTHORITY, ONCE ───────────────────────────────
  const indeterminate = evalResult.checks.filter(c => c.conclusion === 'NOT_EVALUATED');
  const label = notEvaluatedLabel(indeterminate);
  if (label) notes.push(label);
  for (const c of indeterminate) notes.push(`${c.title}: ${c.detail}`);
  for (const c of evalResult.checks.filter(c => c.conclusion === 'FAIL')) {
    notes.push(`FAIL — ${c.title}: ${c.detail}`);
  }

  // ── THE RUN_SEGMENT INVARIANT, CHECKED RATHER THAN TRUSTED ────────────────
  //
  // Two exceptions are associations, not conductor runs, and are declared here rather than being
  // quietly tolerated: a bond marker on its enclosure, and metering CTs sensing a gateway.
  const typeOf = new Map(nodes.map(n => [n.id, n.type]));
  const isAssociation = (e: SLDEdge) =>
    typeOf.get(e.to) === 'NEUTRAL_GROUND_BOND' || typeOf.get(e.to) === 'CT_METERING';
  const direct = edges.filter(e =>
    typeOf.get(e.from) !== 'RUN_SEGMENT' && typeOf.get(e.to) !== 'RUN_SEGMENT' && !isAssociation(e));
  for (const e of direct) {
    validationErrors.push(`Direct device-to-device edge ${e.from} → ${e.to} (no conductor run).`);
  }

  return {
    nodes, edges, domains, notes,
    hasDirectDeviceEdges: direct.length > 0,
    validationErrors,
  };
}
