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
  evaluateServiceTopology, OPTIONAL_REQUIREMENT_TOKENS, solarCouplingLabel,
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
  | 'field-verification'
  /**
   * 🚨 A CALCULATION NOBODY IS OBLIGED TO RUN.
   *
   * Ray's firm product decision: "Ray is not going to verify every load in every house just to
   * create a valid design... they are optional... Do not say `8 inputs required` when several are
   * calculations or optional." So this owner exists to be COUNTED SEPARATELY — the engineering
   * conclusion behind it is still NOT_EVALUATED and still not a pass.
   */
  | 'optional-calculation';

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
  // Last on purpose: it is the only category nothing is waiting on.
  {
    owner: 'optional-calculation',
    heading: 'Optional — not provided',
    action: 'Not required to finish this design. Run it if the project or the reviewer wants it.',
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
  /**
   * 🚨 "TWO 200 A SYSTEMS", WHICH IS HOW THE JOB IS DESCRIBED ON SITE.
   *
   * Ray read the first summary bar — "2 × service branch · 2 panels · 2 backup domains · 2 gateways"
   * — and could not see his own installation in it. A branch, a panel and a backup domain are three
   * names for one 200 A system as far as the person installing it is concerned, so the bar says that
   * first and keeps the three counts for the engineering view underneath.
   *
   * null when the paths are not all the same size; the count is still exact.
   */
  systemCount: number;
  systemAmps: number | null;
  /** "Two 200 A systems", or null when there are none yet. */
  systemsLabel: string | null;
  /** The gateway model, once, when every domain uses the same one — "Gateway 3". */
  gatewayModelLabel: string | null;
  /** The inverting battery model, once, when they all match — "Powerwall 3". */
  batteryModelLabel: string | null;
  /** How many utility isolation switches the design has. Ray's job: 2. */
  isolationSwitchCount: number;
  /** Is the service equipment already on the wall? Changes what SolarPro may add and price. */
  serviceEquipmentIsExisting: boolean;
  /** Items somebody actually has to resolve. Excludes the optional calculations. */
  requiredCount: number;
  /** Optional calculations nobody is obliged to run. Counted apart, never added to the above. */
  optionalCount: number;
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
  /**
   * How the PV is coupled, in words — "PV DC coupled to Powerwall 3", or "Not selected".
   *
   * 🚨 ONE LINE ON THE SUMMARY BAR SO THE CONTRADICTION CANNOT HIDE. Ray's acceptance list for the
   * real job includes `PV architecture  DC_COUPLED_POWERWALL_3`, and the reason it does is that the
   * screen was silently showing a Tesla topology above an Enphase drawing.
   */
  solarCouplingLabel: string;
  /** Whether the project has recorded a coupling at all. */
  solarCouplingSelected: boolean;
  /** Generation / combiner panels that belong to one system. Ray's job: 2. */
  perSystemGenerationPanelCount: number;
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

// 🚨 THE WORDS ON THE SCREEN ARE THE INSTALLER'S. Ray: "Avoid leading with terms like DER, graph
// node, aggregation topology, domain semantics. Those may remain in Advanced/engineering internals."
// The summary bar read "Independent branch interconnection"; the node it describes is still the
// generic one the engineering and the sheet speak about.
const DER_ARRANGEMENT_LABEL: Record<string, string> = {
  'independent-branch': 'Independent systems',
  'common-aggregation': 'One combined generation panel',
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
export function labelForToken(token: string, t: ServiceTopology): string {
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
    // 🚨 THE NAME ON THE BOX, NOT THE CATALOGUE KEY. It read "Manufacturer busbar limit for
    // tesla-backup-gateway-3" on an installer's screen — the same defect as "backs msp-1", one
    // layer along. The gateways in the graph carry their own labels; use them.
    const id = token.slice('manufacturer-limit:'.length);
    const gw = t.domains.find(d => d.gateway.productId === id)?.gateway.label;
    return `Manufacturer busbar limit for ${gw ?? id}`;
  }
  if (token.startsWith('manufacturer-document:')) {
    const title = token.slice('manufacturer-document:'.length);
    if (title === 'multi-gateway-metering') return 'Manufacturer multi-gateway metering document';
    if (title === 'gateway-generation-input') {
      // The gateway's own name, because this is a question about THAT box.
      const gw = t.domains[0]?.gateway.label;
      return `Manufacturer documentation for generation landing inside ${gw ?? 'the gateway'}`;
    }
    if (title.startsWith('pv-input:')) {
      const id = title.slice('pv-input:'.length);
      const unit = t.storage.find(u => u.productId === id);
      return `Manufacturer PV input specification for ${unit?.label ?? id}`;
    }
    return `Manufacturer document — ${title}`;
  }
  if (token.startsWith('device.role:')) {
    return `A device carrying the ${token.slice('device.role:'.length)} role`;
  }
  if (token.startsWith('aggregation.input-source:')) {
    return `A DER source for the aggregation input '${token.slice('aggregation.input-source:'.length)}'`;
  }
  const FIXED: Record<string, string> = {
    'service.availableFaultCurrentA': 'Available fault current at the service',
    // 🚨 ONE ENTRY FOR THE WHOLE LOAD QUESTION. It used to be five: the service demand, each
    // branch's demand and each domain's backed-up demand, all of which one load model derives.
    'loads.model': 'Full load analysis (dwelling load calculation)',
    'calculatedServiceDemandA': 'Calculated service demand',
    'calculatedDemandA': 'Branch load calculation',
    'ocpdAmps': 'Branch OCPD rating',
    // ── The service assembly that is already on the wall ───────────────────
    'service.existingEquipment.catalogNumber': 'Existing service equipment — model / catalog number',
    'service.existingEquipment.mainArrangement':
      'Existing service equipment — internal main / disconnect arrangement',
    'service.existingEquipment.feederArrangement':
      'Existing service equipment — outgoing feeder arrangement',
    'service.existingEquipment.sccrA': 'Existing service equipment — AIC / SCCR from its nameplate',
    'service.existingEquipment.verified':
      'Existing service equipment — confirmation that it was read on site, not assumed',
    // ── Devices: what they interrupt, and which part was bought ────────────
    'device.inlineOnNodeId': 'Which path the safety switch is in line with',
    'device.ratedAmps': 'Safety switch rating',
    'device.productId': 'The actual switch / disconnect selected to meet the requirement',
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
    'interconnection.isolationArrangementAccepted':
      'Utility / AHJ acceptance of the safety-switch arrangement as drawn',
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
    'aggregation.productId': 'The actual generation / combiner panel selected to meet the requirement',
    // ── How the solar is coupled, and where its strings land ───────────────
    'interconnection.solarCoupling': 'How the new solar connects — DC to the batteries, or its own '
      + 'AC inverter',
    'pv.stringAssignment': 'Which PV strings land on which battery\'s DC inputs',
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
  // 🚨 THE OPTIONAL TOKENS, FROM THE CANONICAL LIST — checked first so nothing else can claim one.
  // The same set decides what the permit readiness treats as non-blocking; a second copy here
  // would be a second answer to "is this holding the job up".
  if (OPTIONAL_REQUIREMENT_TOKENS.has(token)) return 'optional-calculation';
  if (token.startsWith('manufacturer-document:') || token.startsWith('manufacturer-limit:')
      || token.startsWith('sccr:') || token === 'gateway.continuousRatingA') {
    return 'manufacturer-authority';
  }
  if (token === 'service.availableFaultCurrentA') return 'utility-must-provide';
  // Facts about an assembly already on the wall: somebody goes and reads them.
  if (token.startsWith('service.existingEquipment.')) return 'field-verification';
  // Choosing the actual part, and choosing which path a switch sits in, are both the designer's.
  if (token === 'device.productId' || token === 'device.inlineOnNodeId'
      || token === 'aggregation.productId') return 'design-decision';
  if (token.startsWith('interconnection.')) {
    // How the PV is coupled is an architecture the designer picks, like the DER arrangement — not a
    // ruling the jurisdiction hands down, which is what the fall-through would have called it.
    return token === 'interconnection.derArrangement' || token === 'interconnection.solarCoupling'
      ? 'design-decision' : 'jurisdiction-authority';
  }
  // The string layout computes it, once there is an array to lay out. Nobody external owes it.
  if (token === 'pv.stringAssignment') return 'solarpro-can-calculate';
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
  // 🚨 THE LOAD MODEL IS ONE PLACE, WHATEVER SCOPE ASKED FOR IT. A branch's demand check is scoped
  // to that branch, but the answer is not typed into the branch — it is the one load calculation on
  // the service. Routed by scope it would send the operator to Branch B to answer a question about
  // the whole house.
  if (token === 'loads.model') {
    return { kind: 'service', nodeId: 'service', field: 'loads' };
  }
  if (token.startsWith('service.existingEquipment.')) {
    return {
      kind: 'service', nodeId: 'service',
      field: `existingEquipment.${token.slice('service.existingEquipment.'.length)}`,
    };
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

/**
 * The first thing this level needs, in one line. FAIL outranks a missing input.
 *
 * 🚨 AND AN OPTIONAL CALCULATION IS THE LAST THING IT SAYS, NOT THE FIRST. Both of Ray's branch
 * cards led with "Full load analysis (dwelling load calculation) required" — the one item nobody is
 * obliged to supply, presented as what was holding that 200 A path up, on the screen where he reads
 * whether the system is understood. It is still said, and it is said as optional.
 */
function headlineFor(checks: TopologyCheck[], t: ServiceTopology): string | null {
  const failed = checks.find(c => c.conclusion === 'FAIL');
  if (failed) return failed.detail;
  let optional: string | null = null;
  for (const c of checks) {
    if (c.conclusion !== 'NOT_EVALUATED') continue;
    const first = (c.requires ?? [])[0];
    if (!first) continue;
    if (OPTIONAL_REQUIREMENT_TOKENS.has(first)) {
      optional ??= `${labelForToken(first, t)} — optional, not provided`;
      continue;
    }
    return `${labelForToken(first, t)} required`;
  }
  return optional;
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

  // ── THE SYSTEM, AS THE INSTALLER COUNTS IT ────────────────────────────────
  const COUNT_WORD = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const branchSizes = [...new Set(topology.branches.map(b => b.ratedAmps))];
  const systemCount = topology.branches.length;
  const systemAmps = branchSizes.length === 1 ? branchSizes[0] : null;
  const systemsLabel = systemCount === 0 ? null
    : `${COUNT_WORD[systemCount] ?? systemCount} ${systemAmps === null ? '' : `${systemAmps} A `}`
      + `system${systemCount === 1 ? '' : 's'}`;

  // The model name, once, and only when they genuinely all match — two different gateways must not
  // be summarised as one.
  const oneOf = (values: string[]): string | null => {
    const distinct = [...new Set(values.filter(Boolean))];
    return distinct.length === 1 ? distinct[0] : null;
  };
  // The label the GRAPH carries, not a re-derived product name: one authority for what the box is
  // called, and the summary bar cannot disagree with the diagram or the schedule.
  const gatewayModelLabel = oneOf(topology.domains.map(d => d.gateway.label));
  const batteryModelLabel = oneOf(topology.storage
    .filter(u => u.role === 'inverter-unit')
    .map(u => u.label ?? u.productId));

  return {
    summary: {
      serviceAmps: rated,
      voltage: topology.service.voltage,
      phaseLabel: PHASE_LABEL[topology.service.phase] ?? topology.service.phase,
      systemCount,
      systemAmps,
      systemsLabel,
      gatewayModelLabel,
      batteryModelLabel,
      isolationSwitchCount: topology.devices
        .filter(d => d.roles.includes('der-isolation-disconnect')).length,
      serviceEquipmentIsExisting: !!topology.service.existingEquipment,
      requiredCount: requiredInputs.filter(i => i.owner !== 'optional-calculation').length,
      optionalCount: requiredInputs.filter(i => i.owner === 'optional-calculation').length,
      branchCount: topology.branches.length,
      panelCount: topology.panels.length,
      domainCount: topology.domains.length,
      gatewayCount: topology.domains.length,
      aggregationPanelCount: (topology.aggregationPanels ?? []).length,
      poiCount: (topology.pointsOfInterconnection ?? []).length,
      generationUnitCount: (topology.generation ?? []).length,
      derArrangementLabel: DER_ARRANGEMENT_LABEL[topology.interconnection.derArrangement ?? ''] ?? null,
      solarCouplingLabel: solarCouplingLabel(topology.solarCoupling, topology),
      solarCouplingSelected: !!topology.solarCoupling,
      perSystemGenerationPanelCount: (topology.aggregationPanels ?? []).filter(p => p.domainId).length,
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
