// ═══════════════════════════════════════════════════════════════════════════
// WHICH WAY DOES THE CURRENT GO — AND WHAT DOES OPENING THAT SWITCH ACTUALLY DISCONNECT?
//
// Ray, on the 400 A ComEd job: "The SLD must make it obvious whether opening the modeled DER
// isolation device actually disconnects every DER source from the utility. Add an engineering
// test: DER ISOLATION COVERAGE. Traverse the topology from every DER source toward utility. PASS
// only if the selected utility isolation arrangement opens every utility path from every DER
// source."
//
// That question cannot be answered by a list of devices. It needs a DIRECTED GRAPH, and this is it.
//
// ═══ IT IS DERIVED, NOT STORED ═══
//
// Every edge below is read off the structural fields the topology already has — a domain names its
// branch and its panels, a storage unit names where it lands, an aggregation panel names what it
// feeds. Nothing new is persisted, so a graph saved before any of this existed still traverses, and
// there is no second copy of the wiring to drift from the first.
//
// ═══ WHAT AN UNRESOLVED EDGE DOES ═══
//
// 🚨 A HOLE IS RECORDED AND THE BEST-KNOWN EDGE IS STILL DRAWN. Leaving the edge out would
// disconnect the source, and a source that reaches nothing looks EXACTLY like a source that is
// properly isolated. That is the failure mode this file exists to prevent, so an unresolved
// landing point adds its edge AND records the hole, and coverage over a graph with holes is
// NOT_EVALUATED — never PASS.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  ServiceTopology, DerSource, PointOfInterconnection, ProtectiveDevice,
} from '@/lib/electrical/serviceTopology';
import { derSources } from '@/lib/electrical/serviceTopology';

export const UTILITY_NODE_ID = 'utility';

export type ConnNodeKind =
  | 'utility' | 'meter' | 'device' | 'service-distribution' | 'branch'
  | 'gateway' | 'panel' | 'der-source' | 'aggregation-panel' | 'point-of-interconnection';

export interface ConnNode {
  id: string;
  label: string;
  kind: ConnNodeKind;
  /** The backup domain this node belongs to, when it belongs to one. */
  domainId?: string | null;
}

export type ConnEdgeKind =
  | 'service-entrance' | 'service-feeder' | 'branch-feeder' | 'gateway-to-panel'
  | 'der-output' | 'aggregation-input' | 'aggregation-output' | 'point-of-interconnection';

export interface ConnEdge {
  id: string;
  /** The DER / premises side. */
  from: string;
  /** The side nearer the utility. */
  to: string;
  kind: ConnEdgeKind;
  ocpdA: number | null;
  /**
   * 🚨 AC ONLY. A DC expansion harness is not a path to the utility and must never be traversed as
   * one; every edge here carries AC by construction, and DC relationships are not edges at all.
   */
  carriesAc: true;
}

export interface UnresolvedConnection {
  /** What is not established, in words. */
  what: string;
  /** The canonical `requires` tokens that would settle it. */
  requires: string[];
  /** The node the hole is attached to, for the UI to focus. */
  nodeId?: string;
}

export interface ConnectionGraph {
  utilityNodeId: string;
  nodes: ConnNode[];
  edges: ConnEdge[];
  /** Every node that can push current toward the utility. */
  sources: DerSource[];
  unresolved: UnresolvedConnection[];
}

/** The default service chain, utility-ward: distribution → service disconnect → DER isolation → meter. */
function defaultChain(t: ServiceTopology): ProtectiveDevice[] {
  const placed = (d: ProtectiveDevice) => typeof d.feedsNodeId === 'string' && d.feedsNodeId.length > 0;
  return [
    ...t.devices.filter(d => d.roles.includes('service-disconnect') && !placed(d)),
    ...t.devices.filter(d => d.roles.includes('der-isolation-disconnect') && !placed(d)),
  ];
}

export function buildConnectionGraph(t: ServiceTopology): ConnectionGraph {
  const nodes: ConnNode[] = [];
  const edges: ConnEdge[] = [];
  const unresolved: UnresolvedConnection[] = [];
  const seen = new Set<string>();

  const node = (n: ConnNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } return n.id; };
  let edgeN = 0;
  const edge = (from: string, to: string, kind: ConnEdgeKind, ocpdA: number | null = null) => {
    edges.push({ id: `e${++edgeN}`, from, to, kind, ocpdA, carriesAc: true });
  };

  node({ id: UTILITY_NODE_ID, label: 'Utility', kind: 'utility' });
  const METER = 'utility-meter';
  node({ id: METER, label: 'Revenue meter', kind: 'meter' });
  edge(METER, UTILITY_NODE_ID, 'service-entrance', t.service.ratedAmps);

  // ── THE SERVICE CHAIN ─────────────────────────────────────────────────────
  const DIST = 'service-distribution';
  node({ id: DIST, label: `${t.service.ratedAmps} A service distribution`, kind: 'service-distribution' });
  let upstream = DIST;
  for (const d of defaultChain(t)) {
    node({ id: d.id, label: d.label, kind: 'device' });
    edge(upstream, d.id, 'service-feeder', d.ratedAmps);
    upstream = d.id;
  }
  edge(upstream, METER, 'service-entrance', t.service.ratedAmps);

  // ── BRANCHES, GATEWAYS, PANELS ────────────────────────────────────────────
  const panelById = new Map(t.panels.map(p => [p.id, p]));
  const domainByBranch = new Map(t.domains.map(d => [d.branchId, d]));

  for (const b of t.branches) {
    node({ id: b.id, label: b.label, kind: 'branch' });
    edge(b.id, DIST, 'branch-feeder', b.ocpdAmps ?? b.ratedAmps);

    const domain = domainByBranch.get(b.id) ?? null;
    if (domain) {
      node({ id: domain.gateway.id, label: domain.gateway.label, kind: 'gateway', domainId: domain.id });
      edge(domain.gateway.id, b.id, 'branch-feeder', domain.gateway.mainBreakerA ?? b.ratedAmps);
      for (const pid of domain.backedUpPanelIds) {
        const p = panelById.get(pid);
        if (!p) continue;
        node({ id: p.id, label: p.label, kind: 'panel', domainId: domain.id });
        edge(p.id, domain.gateway.id, 'gateway-to-panel', p.mainBreakerA);
      }
      continue;
    }

    // A branch with no backup domain feeds its panels directly.
    const fed = (b.panelIds ?? []).map(id => panelById.get(id)).filter(Boolean) as typeof t.panels;
    for (const p of fed) {
      node({ id: p.id, label: p.label, kind: 'panel' });
      edge(p.id, b.id, 'branch-feeder', p.mainBreakerA);
    }
  }

  // Panels nobody claimed still exist; without a feeder they are a hole, not an absence.
  for (const p of t.panels) {
    if (seen.has(p.id)) continue;
    node({ id: p.id, label: p.label, kind: 'panel' });
    unresolved.push({
      what: `${p.label} is not fed by any branch or backup domain in this topology.`,
      requires: ['branch.panelIds'],
      nodeId: p.id,
    });
  }

  // ── DER SOURCES, AND WHERE EACH ONE LANDS ─────────────────────────────────
  const sources = derSources(t);
  const domainById = new Map(t.domains.map(d => [d.id, d]));
  const aggregatedSourceIds = new Set<string>();

  for (const panel of t.aggregationPanels ?? []) {
    node({ id: panel.id, label: panel.label, kind: 'aggregation-panel' });
    for (const input of panel.inputs) {
      const matched = sources.filter(s => s.id === input.sourceId)
        .concat(domainById.has(input.sourceId)
          ? sources.filter(s => s.domainId === input.sourceId) : []);
      if (matched.length === 0) {
        unresolved.push({
          what: `${panel.label} has an input from '${input.sourceId}', which is not a DER source `
            + 'or a backup domain in this topology.',
          requires: [`aggregation.input-source:${input.sourceId}`],
          nodeId: panel.id,
        });
        continue;
      }
      // 🚨 THE TAP POINT DECIDES WHICH NODE'S OUTPUT ACTUALLY ENTERS THE PANEL, and therefore what
      // opening a disconnect on this panel's feeder does and does not cut.
      //
      //   der-output        — the source leaves its domain entirely and lands here. Its default
      //                       landing is replaced, so this is its only path out.
      //   gateway-grid-side — the CONTROLLER's grid side lands here. The source still lands in its
      //                       controller, and the controller's service feed is still there, so the
      //                       source now has TWO paths to the utility. Coverage will say so.
      //   backed-up-busbar  — the island bus lands here. Same two-path consequence, plus the
      //                       island-integrity check when more than one domain does it.
      for (const s of matched) {
        node({ id: s.id, label: s.label, kind: 'der-source', domainId: s.domainId });
        if (input.tap === 'der-output') {
          aggregatedSourceIds.add(s.id);
          edge(s.id, panel.id, 'aggregation-input', input.ocpdA);
          continue;
        }
        const domain = s.domainId ? domainById.get(s.domainId) ?? null : null;
        if (!domain) {
          unresolved.push({
            what: `${panel.label} takes ${s.label} at the ${input.tap.replace(/-/g, ' ')}, but that `
              + 'source is not inside a backup domain, so there is no such tap point.',
            requires: ['aggregation.inputs'],
            nodeId: panel.id,
          });
          continue;
        }
        const tapNode = input.tap === 'gateway-grid-side'
          ? domain.gateway.id
          : domain.backedUpPanelIds.find(id => panelById.has(id)) ?? null;
        if (!tapNode) {
          unresolved.push({
            what: `${panel.label} takes ${domain.label} at its backed-up bus, but that domain backs `
              + 'up no panel in this topology.',
            requires: ['domain.backedUpPanelIds'],
            nodeId: panel.id,
          });
          continue;
        }
        edge(tapNode, panel.id, 'aggregation-input', input.ocpdA);
      }
    }
    if (panel.feedsNodeId) {
      edge(panel.id, panel.feedsNodeId, 'aggregation-output', panel.outputOcpdA);
    } else {
      // 🚨 NO WIRE IS DRAWN FOR A CONNECTION NOBODY CHOSE.
      unresolved.push({
        what: `${panel.label} does not state what its output connects to.`,
        requires: ['aggregation.feedsNodeId'],
        nodeId: panel.id,
      });
    }
  }

  // Devices placed explicitly on a DER path rather than the default service chain.
  for (const d of t.devices) {
    if (!d.feedsNodeId || d.inlineOnNodeId) continue;
    node({ id: d.id, label: d.label, kind: 'device' });
    edge(d.id, d.feedsNodeId, 'service-feeder', d.ratedAmps);
  }


  // Points of interconnection.
  for (const poi of t.pointsOfInterconnection ?? []) {
    node({ id: poi.id, label: poi.label, kind: 'point-of-interconnection' });
    if (poi.derNodeId) edge(poi.derNodeId, poi.id, 'point-of-interconnection', poi.ocpdA);
    if (poi.connectedToNodeId) {
      edge(poi.id, poi.connectedToNodeId, 'point-of-interconnection', poi.ocpdA);
    } else {
      unresolved.push({
        what: `${poi.label} does not state where on the premises wiring it lands.`,
        requires: ['poi.connectedToNodeId'],
        nodeId: poi.id,
      });
    }
  }

  // Sources that no aggregation panel took land where their domain says they land.
  for (const s of sources) {
    if (aggregatedSourceIds.has(s.id)) continue;
    node({ id: s.id, label: s.label, kind: 'der-source', domainId: s.domainId });
    const domain = s.domainId ? domainById.get(s.domainId) ?? null : null;
    if (!domain) {
      unresolved.push({
        what: `${s.label} is not inside a backup domain and no interconnection is recorded for it.`,
        requires: ['der.pointOfInterconnection'],
        nodeId: s.id,
      });
      continue;
    }
    // 🚨 `storageConnection` SAYS WHERE THE STORAGE LANDS, AND NOTHING ELSE.
    //
    // Applied to a PV inverter it answers a question nobody asked: a generator or an inverter in
    // the same domain has its own landing point, and borrowing the battery's made an unrecorded
    // connection look traceable — which would have let isolation coverage PASS over a source whose
    // path nobody had established.
    if (s.kind !== 'ess-inverter'
        && !(t.pointsOfInterconnection ?? []).some(poi => poi.derNodeId === s.id)) {
      unresolved.push({
        what: `${s.label} is inside ${domain.label} but no point of interconnection records where `
          + 'it connects. A backup domain\'s storage connection does not describe where other '
          + 'generation lands.',
        requires: ['der.pointOfInterconnection'],
        nodeId: s.id,
      });
      continue;
    }
    if (domain.storageConnection === 'der-aggregation-panel') {
      // It says it leaves for an aggregation panel and no panel took it: that is a hole, and the
      // source would otherwise sit with no path at all and read as isolated.
      unresolved.push({
        what: `The storage in ${domain.label} is declared to land in a DER aggregation panel, but `
          + 'no aggregation panel in this topology takes it as an input.',
        requires: ['aggregation.inputs'],
        nodeId: s.id,
      });
      continue;
    }
    if (domain.storageConnection === 'backed-up-panel-busbar') {
      const target = domain.backedUpPanelIds.find(id => panelById.has(id));
      if (target) { edge(s.id, target, 'der-output', s.ocpdA); continue; }
    }
    if (domain.storageConnection === 'unresolved') {
      unresolved.push({
        what: `Where the storage in ${domain.label} lands has not been established, so the path `
          + 'from it to the utility is not proven.',
        requires: ['domain.storageConnection'],
        nodeId: s.id,
      });
    }
    // Best-known landing: inside the controller. The edge is drawn either way — an omitted edge
    // would make an unproven source look isolated.
    edge(s.id, domain.gateway.id, 'der-output', s.ocpdA);
  }

  // ── IN-LINE DEVICES: THE CONDUCTOR IS RE-ROUTED THROUGH THEM ──────────────
  //
  // 🚨 A DISCONNECT ADDED BESIDE A CONDUCTOR DISCONNECTS NOTHING. This is Ray's real arrangement —
  //
  //     200 A path A → knife switch A → Gateway #1 → MSP #1
  //
  // — and a device that merely POINTS at the branch is a second stub off it while the original
  // gateway-to-branch conductor stays put. Open both switches and both Powerwalls still have an
  // untouched path to the utility: coverage would report FAIL, correctly, on a bypass the installer
  // never built.
  //
  // So a device that names its LOAD side takes over that node's utility-ward edges. This runs LAST,
  // after every structural edge exists, because the edge being re-routed may belong to a branch, a
  // gateway, a panel, a storage unit or an aggregation panel — and this pass does not care which.
  const labelOf = (id: string) => nodes.find(n => n.id === id)?.label ?? id;
  for (const d of t.devices) {
    if (!d.inlineOnNodeId) continue;
    const target = d.inlineOnNodeId;
    if (!seen.has(target)) {
      unresolved.push({
        what: `${d.label} is declared in line ahead of '${target}', which is not a node in this `
          + 'topology, so what opening it interrupts is not established.',
        requires: ['device.inlineOnNodeId'],
        nodeId: d.id,
      });
      continue;
    }
    node({ id: d.id, label: d.label, kind: 'device' });
    // Only edges that actually LEAVE the node toward the utility — and, when the device also names
    // its upstream, only the one that goes there.
    const moved = edges.filter(e => e.from === target && e.to !== d.id
      && (!d.feedsNodeId || e.to === d.feedsNodeId));
    if (moved.length === 0) {
      unresolved.push({
        what: `${d.label} is in line ahead of ${labelOf(target)}, which has no connection toward `
          + 'the utility in this topology, so the path it interrupts is not established.',
        requires: ['device.inlineOnNodeId'],
        nodeId: d.id,
      });
      // Its own upstream edge is still drawn where it names one, so the device is not silently
      // dropped out of the graph.
      if (d.feedsNodeId) edge(d.id, d.feedsNodeId, 'service-feeder', d.ratedAmps);
      continue;
    }
    for (const e of moved) {
      const wasTo = e.to;
      e.to = d.id;
      edge(d.id, wasTo, e.kind, d.ratedAmps ?? e.ocpdA);
    }
  }

  return { utilityNodeId: UTILITY_NODE_ID, nodes, edges, sources, unresolved };
}

/** Can `from` reach `to` over AC edges, with `cut` node ids removed? */
function reaches(graph: ConnectionGraph, from: string, to: string, cut: ReadonlySet<string>): boolean {
  if (cut.has(from)) return false;
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (cut.has(e.from) || cut.has(e.to)) continue;
    const list = out.get(e.from) ?? [];
    list.push(e.to);
    out.set(e.from, list);
  }
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift() as string;
    if (at === to) return true;
    for (const next of out.get(at) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

export interface DerIsolationCoverage {
  conclusion: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  /** Sources the arrangement provably disconnects. */
  isolatedSourceIds: string[];
  /** Sources that still reach the utility with every isolation device open. */
  reachableSourceIds: string[];
  /** Sources that reach nothing even with everything closed — a hole in the model, not isolation. */
  unreachableSourceIds: string[];
  detail: string;
  requires: string[];
  /** The device ids whose opening was tested. */
  isolationDeviceIds: string[];
}

/**
 * DER ISOLATION COVERAGE — does opening the modelled isolation actually disconnect everything?
 *
 * 🚨 THE ORDER OF THE THREE ANSWERS MATTERS.
 *   1. A source that cannot reach the utility even with every device CLOSED is a hole in the model.
 *      Reporting that as "isolated" is how a missing wire becomes a passing safety check.
 *   2. A graph with an unresolved connection cannot prove coverage ⇒ NOT_EVALUATED, naming it.
 *   3. Only then: open every isolation device and see who still gets out.
 */
export function derIsolationCoverage(
  t: ServiceTopology, graph?: ConnectionGraph,
): DerIsolationCoverage {
  const g = graph ?? buildConnectionGraph(t);
  const isolators = t.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
  const isolationDeviceIds = isolators.map(d => d.id);
  const sourceIds = g.sources.map(s => s.id);
  const labelOf = new Map(g.sources.map(s => [s.id, s.label]));
  const base = {
    isolatedSourceIds: [] as string[],
    reachableSourceIds: [] as string[],
    unreachableSourceIds: [] as string[],
    isolationDeviceIds,
  };

  if (sourceIds.length === 0) {
    return {
      ...base, conclusion: 'PASS',
      detail: 'This topology has no DER source, so there is nothing to isolate from the utility.',
      requires: [],
    };
  }

  const none: ReadonlySet<string> = new Set();
  const unreachable = sourceIds.filter(id => !reaches(g, id, g.utilityNodeId, none));

  // 1 — a NAMED hole explains itself. Reported first when there is one, because "the point of
  // interconnection does not say where it lands" is the cause, and "this source reaches nothing"
  // is only its symptom — an operator handed the symptom has nowhere to go.
  if (g.unresolved.length > 0) {
    return {
      ...base, conclusion: 'NOT_EVALUATED',
      unreachableSourceIds: unreachable,
      detail: 'INTERCONNECTION ARRANGEMENT REQUIRED — opening the isolation device cannot be shown '
        + 'to disconnect every source while the arrangement is incomplete: '
        + g.unresolved.map(u => u.what).join(' '),
      requires: [...new Set(g.unresolved.flatMap(u => u.requires))],
    };
  }

  // 2 — a source that reaches nothing with everything CLOSED is a hole nobody named. It must never
  // read as isolated: a missing wire and a properly isolated source look identical to a traversal.
  if (unreachable.length > 0) {
    return {
      ...base, conclusion: 'NOT_EVALUATED',
      unreachableSourceIds: unreachable,
      detail: `${unreachable.map(id => labelOf.get(id) ?? id).join(', ')} has no traceable path to `
        + 'the utility at all, so whether an isolation device would open that path cannot be '
        + 'determined. This is an incomplete topology, not an isolated source.',
      requires: ['der.pointOfInterconnection'],
    };
  }

  if (isolators.length === 0) {
    return {
      ...base, conclusion: 'NOT_EVALUATED',
      reachableSourceIds: sourceIds,
      detail: 'No device in this topology carries the utility DER isolation role, so no isolation '
        + 'arrangement has been selected to evaluate.',
      requires: ['device.role:der-isolation-disconnect', 'interconnection.isolationArrangement'],
    };
  }

  // 3 — open every isolation device at once and see who still gets out.
  const cut = new Set(isolationDeviceIds);
  const stillReaching = sourceIds.filter(id => reaches(g, id, g.utilityNodeId, cut));
  const isolated = sourceIds.filter(id => !stillReaching.includes(id));

  if (stillReaching.length > 0) {
    return {
      ...base, conclusion: 'FAIL',
      isolatedSourceIds: isolated,
      reachableSourceIds: stillReaching,
      detail: 'DER ISOLATION DOES NOT ISOLATE ALL ON-SITE DER — with '
        + `${isolators.map(d => d.label).join(', ')} open, `
        + `${stillReaching.map(id => labelOf.get(id) ?? id).join(', ')} still has a path to the `
        + 'utility. The arrangement must isolate every source, not the one it was drawn beside.',
      requires: [],
    };
  }

  return {
    ...base, conclusion: 'PASS',
    isolatedSourceIds: isolated,
    detail: `Opening ${isolators.map(d => d.label).join(', ')} disconnects all `
      + `${sourceIds.length} on-site DER source(s) from the utility.`,
    requires: [],
  };
}
