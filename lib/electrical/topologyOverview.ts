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
  kind: 'service' | 'branch' | 'panel' | 'domain' | 'interconnection' | 'aggregation' | 'poi';
  /** The topology id of the node to select, or 'service' / 'interconnection'. */
  nodeId: string;
  /** The specific field inside that node's inspector, when one answers it. */
  field?: string;
}

/**
 * 🚨 WHO OWES THIS, AND THEREFORE WHAT TO DO ABOUT IT.
 *
 * Ray: "Don't present all five categories as equivalent text boxes." A calculation SolarPro will
 * run once loads are entered, a number only the utility can give, a ruling only the jurisdiction
 * can make, a document only the manufacturer has, and a choice only the designer can make are five
 * different kinds of blocked — and a screen that lists them identically tells an installer nothing
 * about which one they can act on this afternoon.
 *
 * The sixth is the one Ray's list implies rather than names: facts about equipment that is already
 * on the wall, which somebody has to go and read off a label.
 */
export type RequirementOwner =
  | 'solarpro-can-calculate'
  | 'utility-must-provide'
  | 'jurisdiction-authority'
  | 'manufacturer-authority'
  | 'design-decision'
  | 'field-verification';

export interface RequirementOwnerSpec {
  owner: RequirementOwner;
  heading: string;
  /** What an operator can do about this category. */
  action: string;
}

export const REQUIREMENT_OWNERS: ReadonlyArray<RequirementOwnerSpec> = [
  {
    owner: 'design-decision',
    heading: 'Design decision',
    action: 'Yours to choose. Nothing downstream can resolve until it is made.',
  },
  {
    owner: 'solarpro-can-calculate',
    heading: 'SolarPro can calculate',
    action: 'Enter the inputs and SolarPro computes these — they are not blocked on anyone.',
  },
  {
    owner: 'field-verification',
    heading: 'Field verify',
    action: 'Read off the equipment that is already installed.',
  },
  {
    owner: 'utility-must-provide',
    heading: 'Utility must provide',
    action: 'Request from the utility. Nothing on site establishes it.',
  },
  {
    owner: 'jurisdiction-authority',
    heading: 'Jurisdiction / utility authority',
    action: 'A ruling, not a measurement. SolarPro will not assume one.',
  },
  {
    owner: 'manufacturer-authority',
    heading: 'Manufacturer authority',
    action: 'Governed by a document SolarPro does not hold.',
  },
];

export interface RequiredInput {
  /** The canonical `requires` token. Two checks needing the same thing are ONE entry. */
  key: string;
  /** What it is, in words an installer uses. */
  label: string;
  /** Why it is needed — the first check that asked for it. */
  because: string;
  /** Who owes it. */
  owner: RequirementOwner;
  focus: OverviewFocus;
}

export interface RequirementGroup {
  spec: RequirementOwnerSpec;
  items: RequiredInput[];
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
  /** DER aggregation panels. Zero on an independent-branch arrangement, which is complete. */
  aggregationPanelCount: number;
  /** Points of interconnection recorded. */
  poiCount: number;
  /** PV inverters, generators and other non-storage DER. */
  generationUnitCount: number;
  /** How the DER reaches the service, in words — or null when nobody has chosen. */
  derArrangementLabel: string | null;
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
  /** Keyed by DER aggregation panel id. */
  aggregationPanels: Record<string, LevelStatus>;
  /** Keyed by point-of-interconnection id. */
  pois: Record<string, LevelStatus>;
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

const DER_ARRANGEMENT_LABEL: Record<string, string> = {
  'independent-branch': 'Independent branch interconnection',
  'common-aggregation': 'Common DER aggregation',
  'custom': 'Custom engineered topology',
};

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
    // 🚨 THE AGGREGATION PANEL BELONGS IN THIS LOOKUP TOO. Left out, the screen asked an installer
    // for "the interrupting rating for agg-1" — a database id, which is the same defect as printing
    // msp-1 instead of MSP #1.
    const agg = (t.aggregationPanels ?? []).find(a => a.id === id);
    const name = dev?.label ?? gw?.label ?? panel?.label ?? agg?.label ?? id;
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
  if (token.startsWith('aggregation.input-source:')) {
    return `A DER source for the aggregation input '${token.slice('aggregation.input-source:'.length)}'`;
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
    'domain.backedUpPanelIds': 'The panels this backup domain backs up',
    'storage.continuousOutputA': 'Storage continuous output',
    'backedUpDemandA': 'Backed-up load calculation',
    'storage.usableKwh': 'Storage usable energy',
    'branch.panelIds': 'The panelboards this branch feeds',
    'interconnection.meterCollarPermitted': 'Whether the utility permits a meter-collar interconnection',
    'interconnection.externalDerIsolationRequired': 'Whether this utility requires an external DER isolation device',
    'interconnection.isolationArrangement': 'An acceptable utility DER isolation arrangement',
    'device.lockableOpen': 'Isolation device: lockable open',
    'device.visibleOpen': 'Isolation device: visible open',
    // ── The DER side ──────────────────────────────────────────────────────
    'interconnection.derArrangement': 'How the DER systems interconnect with the service',
    'der.continuousOutputA': 'Continuous AC output of every DER source',
    'der.pointOfInterconnection': 'Where this DER source meets the premises wiring',
    // Phrased as a noun so the headline that appends "required" reads as a sentence.
    'poi.relationship': 'The point of interconnection\'s governed arrangement',
    'poi.connectedToNodeId': 'Where on the premises wiring the interconnection lands',
    'poi.supplySideTapConductors': 'Supply-side tap conductors, OCPD and disconnect (NEC 705.11)',
    'aggregation.inputs': 'The DER circuits entering the aggregation panel',
    'aggregation.carriesPremisesLoad': 'Whether the aggregation panel also carries premises load',
    'aggregation.busbarRatingA': 'Aggregation panel busbar rating',
    'aggregation.mainBreakerA': 'Aggregation panel main breaker',
    'aggregation.outputOcpdA': 'Aggregation panel output OCPD',
    'aggregation.feedsNodeId': 'What the aggregation panel\'s output connects to',
    'aggregation.panel': 'The aggregation panel this refers to',
  };
  return FIXED[token] ?? token;
}

/**
 * Who owes a requirement.
 *
 * 🚨 THE SPLIT THAT MATTERS IS "EXISTING EQUIPMENT" vs "EQUIPMENT SOLARPRO IS SIZING". A panel
 * already on the wall has a busbar somebody must go and read; a DER aggregation panel that does not
 * exist yet has one SolarPro computes from the sources feeding it. Same kind of number, completely
 * different thing to do about it.
 */
function ownerForToken(token: string): RequirementOwner {
  if (token.startsWith('manufacturer-document:') || token.startsWith('manufacturer-limit:')
      || token.startsWith('sccr:') || token === 'gateway.continuousRatingA') {
    return 'manufacturer-authority';
  }
  if (token === 'service.availableFaultCurrentA') return 'utility-must-provide';
  if (token.startsWith('interconnection.')) {
    return token === 'interconnection.derArrangement' ? 'design-decision' : 'jurisdiction-authority';
  }
  if (token === 'domain.storageConnection' || token.startsWith('poi.')
      || token === 'der.pointOfInterconnection' || token === 'aggregation.feedsNodeId'
      || token === 'aggregation.carriesPremisesLoad' || token.startsWith('aggregation.input-source:')
      || token === 'aggregation.inputs' || token === 'branch.panelIds'
      || token === 'domain.backedUpPanelIds' || token.startsWith('device.role:')) {
    return 'design-decision';
  }
  if (token === 'calculatedServiceDemandA' || token === 'calculatedDemandA'
      || token === 'backedUpDemandA' || token.startsWith('aggregation.')) {
    return 'solarpro-can-calculate';
  }
  // Everything left describes equipment that is already installed.
  return 'field-verification';
}

/** Group the requirements by who owes them, dropping the categories nothing lands in. */
export function groupRequirements(items: readonly RequiredInput[]): RequirementGroup[] {
  return REQUIREMENT_OWNERS
    .map(spec => ({ spec, items: items.filter(i => i.owner === spec.owner) }))
    .filter(g => g.items.length > 0);
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
  if (check.scope.startsWith('aggregation:')) {
    return {
      kind: 'aggregation', nodeId: check.scope.slice('aggregation:'.length),
      field: token.startsWith('aggregation.') ? token.slice('aggregation.'.length) : token,
    };
  }
  if (check.scope.startsWith('poi:')) {
    return {
      kind: 'poi', nodeId: check.scope.slice('poi:'.length),
      field: token.startsWith('poi.') ? token.slice('poi.'.length) : token,
    };
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

  // 🚨 A SITE-SCOPED CHECK CAN STILL NEED A NODE-LEVEL ANSWER.
  //
  // DER isolation coverage is scoped to the site and its `requires` name a domain's storage
  // connection, an aggregation panel's output or a point of interconnection's landing. Those fell
  // through to the catch-all and sent the operator to the SERVICE inspector, where none of them
  // can be answered — and the guard that was supposed to catch it accepted 'service' as a legal
  // destination for anything.
  if (token.startsWith('domain.')) {
    const field = token.slice('domain.'.length);
    const wanting = field === 'storageConnection'
      ? t.domains.find(d => d.storageConnection === 'unresolved')
      : undefined;
    const target = wanting ?? t.domains[0];
    if (target) return { kind: 'domain', nodeId: target.id, field };
  }
  if (token.startsWith('aggregation.')) {
    const target = (t.aggregationPanels ?? [])[0];
    if (target) return { kind: 'aggregation', nodeId: target.id, field: token.slice('aggregation.'.length) };
  }
  if (token.startsWith('poi.') || token === 'der.pointOfInterconnection') {
    const target = (t.pointsOfInterconnection ?? [])[0];
    if (target) {
      return {
        kind: 'poi', nodeId: target.id,
        field: token.startsWith('poi.') ? token.slice('poi.'.length) : token,
      };
    }
    // No point of interconnection exists yet, so the place to create one is the interconnection
    // node — not the service.
    return { kind: 'interconnection', nodeId: 'interconnection', field: token };
  }
  if (token.startsWith('der.') || token.startsWith('branch.')) {
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

  const aggregationPanels: Record<string, LevelStatus> = {};
  for (const a of topology.aggregationPanels ?? []) {
    const cs = evalResult.checks.filter(c => c.scope === `aggregation:${a.id}`);
    aggregationPanels[a.id] = { conclusion: foldConclusions(cs), headline: headlineFor(cs, topology) };
  }

  const pois: Record<string, LevelStatus> = {};
  for (const poi of topology.pointsOfInterconnection ?? []) {
    const cs = evalResult.checks.filter(c => c.scope === `poi:${poi.id}`);
    pois[poi.id] = { conclusion: foldConclusions(cs), headline: headlineFor(cs, topology) };
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
        owner: ownerForToken(token),
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
      aggregationPanelCount: (topology.aggregationPanels ?? []).length,
      poiCount: (topology.pointsOfInterconnection ?? []).length,
      generationUnitCount: (topology.generation ?? []).length,
      derArrangementLabel: DER_ARRANGEMENT_LABEL[topology.interconnection.derArrangement ?? ''] ?? null,
      invertingUnitCount: storage.inverterUnitCount,
      expansionUnitCount: storage.expansionUnitCount,
      usableKwh: storage.totalUsableKwh,
      continuousOutputA: storage.totalContinuousOutputA,
    },
    allocation,
    site,
    branches,
    domains,
    aggregationPanels,
    pois,
    requiredInputs,
    evaluation: evalResult,
  };
}
