// ═══════════════════════════════════════════════════════════════════════════
// THE SERVICE, AS AN ELECTRICIAN READS IT.
//
// Ray tested the first Service Topology screen and rejected its UX:
//
//   "Right now the page exposes the internal graph-building primitives directly... then large walls
//    of PASS / NOT EVALUATED text. This is too difficult to operate on a real job. SolarPro knows
//    the topology. It needs to show it visually and guide the user through building it."
//   "The installer should see the electrical system first and the data structure second."
//
// So this file turns the canonical `ServiceTopology` + its canonical `TopologyEvaluation` into the
// things a screen needs to SAY: a summary bar, the service allocation, a status word per level, and
// a short list of what is still required — each item knowing WHERE to send the operator.
//
// 🚨 IT IS A PROJECTION, NOT A SECOND MODEL. Every number here is read from the topology or from
// `evaluateServiceTopology`; nothing is re-derived and nothing is decided. Ray: "Do not create a
// second simplified service model merely to make the screen easier." In particular the engineering
// CONCLUSION is never changed — `NOT_EVALUATED` stays `NOT_EVALUATED` in the model and is merely
// WORDED as "Needs input" for a reader. `conclusionWord` is the only place that translation happens.
// ═══════════════════════════════════════════════════════════════════════════

import {
  evaluateServiceTopology,
  type ServiceTopology, type TopologyEvaluation, type TopologyCheck,
} from '@/lib/electrical/serviceTopology';
import { foldConclusions, type EngineeringConclusion } from '@/lib/engineering/engineeringStatus';

/** Where a requirement sends the operator. `nodeId` addresses a node in the visual topology. */
export interface OverviewFocus {
  kind: 'service' | 'branch' | 'panel' | 'domain' | 'interconnection';
  /** The topology id of the node to select, or 'service' / 'interconnection'. */
  nodeId: string;
  /** The specific field inside that node's inspector, when one answers it. */
  field?: string;
}

export interface RequiredInput {
  /** The canonical `requires` token. Two checks needing the same thing are ONE entry. */
  key: string;
  /** What it is, in words an installer uses. */
  label: string;
  /** Why it is needed — the first check that asked for it. */
  because: string;
  focus: OverviewFocus;
}

export interface LevelStatus {
  conclusion: EngineeringConclusion;
  /** One short line: the first thing this level needs, or the first thing that failed. */
  headline: string | null;
}

export interface ServiceAllocation {
  ratedAmps: number;
  /** The sum of the branch ratings actually in the graph. */
  allocatedAmps: number;
  /** rated − allocated, floored at 0. */
  unallocatedAmps: number;
  /** allocated − rated, floored at 0. Non-zero is an engineering FAIL, already reported. */
  overAllocatedAmps: number;
  /**
   * The action that would close the gap, when a whole equal branch would close it.
   * `null` when the service is fully allocated, over-allocated, or the remainder is not a clean
   * multiple — the screen then offers "Add a branch" without claiming a size.
   */
  suggestedBranchAmps: number | null;
  suggestedBranchCount: number;
}

export interface ServiceSummary {
  serviceAmps: number;
  voltage: number;
  phaseLabel: string;
  branchCount: number;
  panelCount: number;
  domainCount: number;
  gatewayCount: number;
  invertingUnitCount: number;
  expansionUnitCount: number;
  /** Aggregate usable energy, or null when a unit does not state it. */
  usableKwh: number | null;
  /** 🚨 FROM THE INVERTING UNITS ONLY. An expansion adds energy, never current. */
  continuousOutputA: number | null;
}

export interface ServiceOverview {
  summary: ServiceSummary;
  allocation: ServiceAllocation;
  site: LevelStatus;
  /** Keyed by branch id. */
  branches: Record<string, LevelStatus>;
  /** Keyed by domain id. */
  domains: Record<string, LevelStatus>;
  /** Distinct, deduplicated, ordered: the site's requirements first. */
  requiredInputs: RequiredInput[];
  evaluation: TopologyEvaluation;
}

/**
 * How a conclusion is WORDED for an installer.
 *
 * 🚨 THE CONCLUSION ITSELF IS UNTOUCHED. Ray: "The UI can translate NOT_EVALUATED into Needs input
 * for normal users. Do not change the engineering conclusion itself." So this is a label function
 * and nothing reads it back to decide anything.
 */
export function conclusionWord(c: EngineeringConclusion): 'Ready' | 'Needs input' | 'Fails' {
  return c === 'PASS' ? 'Ready' : c === 'FAIL' ? 'Fails' : 'Needs input';
}

const PHASE_LABEL: Record<string, string> = {
  'split-240': '120/240 V split phase',
  'wye-208': '120/208 V wye',
  'wye-480': '277/480 V wye',
};

/**
 * The human name for one `requires` token.
 *
 * Tokens that carry an id (`sccr:<device>`, `manufacturer-limit:<product>`,
 * `manufacturer-document:<title>`) are resolved against the topology so the line names the actual
 * device rather than an internal id.
 */
function labelForToken(token: string, t: ServiceTopology): string {
  if (token.startsWith('sccr:')) {
    const id = token.slice(5);
    const dev = t.devices.find(d => d.id === id);
    const gw = t.domains.find(d => d.gateway.id === id)?.gateway;
    const panel = t.panels.find(p => p.id === id);
    const name = dev?.label ?? gw?.label ?? panel?.label ?? id;
    return `Interrupting rating (SCCR) for ${name}`;
  }
  if (token.startsWith('manufacturer-limit:')) {
    return `Manufacturer busbar limit for ${token.slice('manufacturer-limit:'.length)}`;
  }
  if (token.startsWith('manufacturer-document:')) {
    const title = token.slice('manufacturer-document:'.length);
    return title === 'multi-gateway-metering'
      ? 'Manufacturer multi-gateway metering document'
      : `Manufacturer document — ${title}`;
  }
  if (token.startsWith('device.role:')) {
    return `A device carrying the ${token.slice('device.role:'.length)} role`;
  }
  const FIXED: Record<string, string> = {
    'service.availableFaultCurrentA': 'Available fault current at the service',
    'calculatedServiceDemandA': 'Calculated service demand',
    'calculatedDemandA': 'Branch load calculation',
    'ocpdAmps': 'Branch OCPD rating',
    'panel.busbarRatingA': 'Panel busbar rating',
    'panel.mainBreakerA': 'Panel main breaker',
    'gateway.continuousRatingA': 'Gateway continuous rating',
    'domain.storageConnection': 'Storage point of connection',
    'domain.generationOutputA': 'Generation output in the domain',
    'storage.continuousOutputA': 'Storage continuous output',
    'backedUpDemandA': 'Backed-up load calculation',
    'storage.usableKwh': 'Storage usable energy',
    'interconnection.meterCollarPermitted': 'Whether the utility permits a meter-collar interconnection',
    'interconnection.externalDerIsolationRequired': 'Whether this utility requires an external DER isolation device',
    'device.lockableOpen': 'Isolation device: lockable open',
    'device.visibleOpen': 'Isolation device: visible open',
  };
  return FIXED[token] ?? token;
}

/**
 * Which node answers a requirement.
 *
 * The check's SCOPE does most of the work. A panel field asked inside a domain scope is resolved to
 * the actual panel by matching the check title against the panel labels — the titles are composed
 * from those same labels — and falls back to the domain's first backed-up panel, which is exact
 * whenever a domain backs up one panel and approximate only when it backs up several.
 */
function focusFor(check: TopologyCheck, token: string, t: ServiceTopology): OverviewFocus {
  if (token.startsWith('interconnection.')) {
    return { kind: 'interconnection', nodeId: 'interconnection', field: token.split('.')[1] };
  }
  if (token === 'service.availableFaultCurrentA') {
    return { kind: 'service', nodeId: 'service', field: 'availableFaultCurrentA' };
  }
  if (token === 'calculatedServiceDemandA') {
    return { kind: 'service', nodeId: 'service', field: 'calculatedServiceDemandA' };
  }
  if (check.scope.startsWith('branch:')) {
    return { kind: 'branch', nodeId: check.scope.slice('branch:'.length), field: token };
  }
  if (check.scope.startsWith('domain:')) {
    const domainId = check.scope.slice('domain:'.length);
    if (token.startsWith('panel.')) {
      const domain = t.domains.find(d => d.id === domainId);
      const named = t.panels.find(p => check.title.startsWith(`${p.label} `));
      const panelId = named?.id ?? domain?.backedUpPanelIds[0] ?? domainId;
      return { kind: 'panel', nodeId: panelId, field: token.slice('panel.'.length) };
    }
    return { kind: 'domain', nodeId: domainId, field: token };
  }
  if (token.startsWith('sccr:')) {
    const id = token.slice(5);
    if (t.panels.some(p => p.id === id)) return { kind: 'panel', nodeId: id, field: 'sccrA' };
    const domain = t.domains.find(d => d.gateway.id === id);
    if (domain) return { kind: 'domain', nodeId: domain.id, field: 'gateway.sccrA' };
    return { kind: 'service', nodeId: 'service', field: 'devices' };
  }
  if (token.startsWith('manufacturer-document:') || token.startsWith('device.role:')
      || token.startsWith('device.')) {
    return { kind: 'interconnection', nodeId: 'interconnection', field: token };
  }
  return { kind: 'service', nodeId: 'service', field: token };
}

/** The first thing this level needs, in one line. FAIL outranks a missing input. */
function headlineFor(checks: TopologyCheck[], t: ServiceTopology): string | null {
  const failed = checks.find(c => c.conclusion === 'FAIL');
  if (failed) return failed.detail;
  for (const c of checks) {
    if (c.conclusion !== 'NOT_EVALUATED') continue;
    const first = (c.requires ?? [])[0];
    if (first) return `${labelForToken(first, t)} required`;
  }
  return null;
}

export function buildServiceOverview(
  topology: ServiceTopology,
  evaluation?: TopologyEvaluation,
): ServiceOverview {
  const evalResult = evaluation ?? evaluateServiceTopology(topology);
  const storage = evalResult.storageSummary;

  const allocatedAmps = topology.branches.reduce((n, b) => n + (b.ratedAmps || 0), 0);
  const rated = topology.service.ratedAmps;
  const unallocated = Math.max(0, rated - allocatedAmps);

  // 🚨 THE 400 A SPLIT, MADE OBVIOUS. Ray: "the service says 400 A while only 1 branch totalling
  // 200 A exists. That is technically truthful but visually confusing." When the remainder is a
  // whole multiple of the branches already drawn, the screen can offer the exact action.
  const firstBranch = topology.branches[0]?.ratedAmps ?? 0;
  const canSuggest = unallocated > 0 && firstBranch > 0 && unallocated % firstBranch === 0;
  const allocation: ServiceAllocation = {
    ratedAmps: rated,
    allocatedAmps,
    unallocatedAmps: unallocated,
    overAllocatedAmps: Math.max(0, allocatedAmps - rated),
    suggestedBranchAmps: canSuggest ? firstBranch : null,
    suggestedBranchCount: canSuggest ? unallocated / firstBranch : 0,
  };

  const siteChecks = evalResult.checks.filter(c => c.scope === 'site');
  const site: LevelStatus = {
    conclusion: evalResult.overall,
    headline: headlineFor(evalResult.checks, topology),
  };

  const branches: Record<string, LevelStatus> = {};
  for (const b of topology.branches) {
    const cs = evalResult.checks.filter(c => c.scope === `branch:${b.id}`);
    branches[b.id] = { conclusion: foldConclusions(cs), headline: headlineFor(cs, topology) };
  }

  // A multi-gateway site's unresolved manufacturer authority is scoped 'site' in the engineering
  // (it governs the site's metering as a whole) but it is DRAWN on every domain's CT callout. The
  // domain card says the same thing the sheet says, rather than the operator having to connect a
  // site-level sentence to the CTs they are looking at.
  const multiGatewayDocCheck = topology.domains.length > 1
    ? siteChecks.find(c => c.id === 'metering.multi-gateway' && c.conclusion !== 'PASS') ?? null
    : null;

  const domains: Record<string, LevelStatus> = {};
  for (const d of topology.domains) {
    const cs = evalResult.checks.filter(c => c.scope === `domain:${d.id}`);
    const withDoc = multiGatewayDocCheck ? [...cs, multiGatewayDocCheck] : cs;
    domains[d.id] = {
      conclusion: foldConclusions(withDoc),
      headline: headlineFor(withDoc, topology),
    };
  }

  // ── WHAT IS STILL REQUIRED, ONCE EACH ─────────────────────────────────────
  const seen = new Set<string>();
  const requiredInputs: RequiredInput[] = [];
  const ordered = [
    ...evalResult.checks.filter(c => c.scope === 'site'),
    ...evalResult.checks.filter(c => c.scope !== 'site'),
  ];
  for (const c of ordered) {
    if (c.conclusion !== 'NOT_EVALUATED') continue;
    for (const token of c.requires ?? []) {
      if (seen.has(token)) continue;
      seen.add(token);
      requiredInputs.push({
        key: token,
        label: labelForToken(token, topology),
        because: `${c.title} — ${c.detail}`,
        focus: focusFor(c, token, topology),
      });
    }
  }

  return {
    summary: {
      serviceAmps: rated,
      voltage: topology.service.voltage,
      phaseLabel: PHASE_LABEL[topology.service.phase] ?? topology.service.phase,
      branchCount: topology.branches.length,
      panelCount: topology.panels.length,
      domainCount: topology.domains.length,
      gatewayCount: topology.domains.length,
      invertingUnitCount: storage.inverterUnitCount,
      expansionUnitCount: storage.expansionUnitCount,
      usableKwh: storage.totalUsableKwh,
      continuousOutputA: storage.totalContinuousOutputA,
    },
    allocation,
    site,
    branches,
    domains,
    requiredInputs,
    evaluation: evalResult,
  };
}
