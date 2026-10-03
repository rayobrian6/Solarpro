// ═══════════════════════════════════════════════════════════════════════════
// 🚨 UTILITY FACTS AND DISCONNECTING MEANS — the Service Topology inspector's "INTERCONNECTION AND
//    THE FOUR DISCONNECT ROLES", asked as an installer's questions in System Config.
//
// Three things an installer has to be able to say without opening the graph editor:
//
//   1. Does the utility / AHJ permit a meter collar here? A three-state RULING (permitted / not
//      permitted / not established), owned by the utility and the AHJ — never by the equipment and
//      never assumed. A collar is offered only where it is not prohibited, and a collar chosen while
//      permission is not established reads NEEDS VERIFICATION, never answered.
//   2. The disconnecting means — service disconnect, utility isolation switch, gateway isolation,
//      battery disconnect: what exists for each, where it sits, and the part chosen for it.
//      🚨 THE REQUIREMENT IS NOT THE PART, AND THE SEED IS NOT THE REQUIREMENT. The only required
//      rating stated is the one the engine derives for a device in line ahead of something
//      (`inlineRequirementA`); otherwise it reads "rating not established". A device's recorded
//      rating is the part's, shown as such — the Service Topology tab seeds new devices with the
//      service rating, which is not a calculation and is never presented as one. Devices added here
//      carry NO rating until the installer states the part's.
//   3. More than one gateway on one service ⇒ MANUFACTURER DOCUMENT REQUIRED for site metering and
//      coordination. SolarPro does not decide those without it.
//
// The utility isolation REQUIREMENT stays where it is asked already (`behavior.isolation`); this
// module states and edits the switch(es) themselves and never asks "is it required?" a second time.
//
// Every edit is a writer that already exists — `topologyAuthoring.ts` (addProtectiveDevice,
// removeProtectiveDevice, placeDeviceInline, placeDevice, selectDeviceProduct,
// updateProtectiveDevice, setInterconnection, updatePointOfInterconnection) and the role catalogue
// in `topologyPresets.ts` (DISCONNECT_ROLES). Nothing here builds a graph object.
//
// Pure and isomorphic, like the interviewer it plugs into.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  InterviewInput, InterviewItem, InterviewOption, ItemState, FactSource,
} from '@/lib/electrical/systemConfigInterview';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import type {
  ServiceTopology, ProtectiveDevice, DeviceRole, TopologyEvaluation,
} from '@/lib/electrical/serviceTopology';
import { inlineRequirementA, topologyNodeLabel, deviceCheckScope } from '@/lib/electrical/serviceTopology';
import { foldConclusions } from '@/lib/engineering/engineeringStatus';
import {
  addProtectiveDevice, removeProtectiveDevice, placeDeviceInline, placeDevice,
  selectDeviceProduct, updateProtectiveDevice, setInterconnection, updatePointOfInterconnection,
} from '@/lib/electrical/topologyAuthoring';
import { DISCONNECT_ROLES, type DisconnectRoleSpec } from '@/lib/electrical/topologyPresets';

const done = (topology: ServiceTopology, did: string): AnswerResult => ({ ok: true, topology, did });
const refuse = (refused: string): AnswerResult => ({ ok: false, refused });

// ── Item ids ────────────────────────────────────────────────────────────────

export const UTILITY_ITEM_PREFIX = 'behavior.utility.';
export const DISCONNECT_ITEM_PREFIX = 'engineering.disconnect.';
export const METER_COLLAR_ITEM_ID = 'behavior.utility.meter-collar';
export const MULTI_GATEWAY_DOC_ITEM_ID = 'engineering.disconnect.multi-gateway-doc';
export const disconnectItemId = (role: DeviceRole): string => `${DISCONNECT_ITEM_PREFIX}${role}`;
/** The role an `engineering.disconnect.<role>` item is about, or null. */
export function disconnectRoleOf(itemId: string): DisconnectRoleSpec | null {
  if (!itemId.startsWith(DISCONNECT_ITEM_PREFIX)) return null;
  const role = itemId.slice(DISCONNECT_ITEM_PREFIX.length);
  return DISCONNECT_ROLES.find(r => r.role === role) ?? null;
}

export const METER_COLLAR_OPTIONS: InterviewOption[] = [
  { value: 'permitted', label: 'Permitted — the utility / AHJ allows a meter collar here' },
  { value: 'not-permitted', label: 'Not permitted' },
  { value: 'unknown', label: 'Not established yet' },
];

/** The installer's words for each disconnecting-means role. The spec's own text says where it sits. */
const ROLE_QUESTION: Record<DisconnectRoleSpec['role'], string> = {
  'service-disconnect': 'Service disconnect — what is it, and where does it sit?',
  'der-isolation-disconnect': 'Utility isolation switch — which switch, where it sits, and what part',
  'gateway-isolation': 'Gateway isolation switch — is there one ahead of a gateway?',
  'ess-disconnect': 'Battery disconnect / overcurrent protection',
};

/**
 * What a device of each role is called on the job — and therefore its label, which every surface
 * prints. Matches the utility isolation switches `applyIsolationArrangement` already names.
 */
export const ROLE_NOUN: Record<DisconnectRoleSpec['role'], string> = {
  'service-disconnect': 'Service disconnect',
  'der-isolation-disconnect': 'Utility isolation switch',
  'gateway-isolation': 'Gateway isolation switch',
  'ess-disconnect': 'Battery disconnect',
};

const COUNT_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

// ── What a disconnect IS, stated precisely ──────────────────────────────────

export interface DisconnectFacts {
  deviceId: string;
  label: string;
  inlineOnNodeId: string | null;
  /** Where it sits, in the installer's words. */
  placement: string;
  /** The engine's required rating for this device — present only for a device in line ahead of something. */
  requirementA: number | null;
  /** "200 A — what MSP #1 carries" | "rating not established …". Never the seeded service rating. */
  requirement: string;
  partSelected: boolean;
  part: string;
  /** The device's own recorded rating — the part's, not the requirement. */
  rating: string;
  sccrEstablished: boolean;
  sccr: string;
  /** In line ahead of a node whose rating nobody has established. */
  requirementOpen: boolean;
  /** The engine's own in-line rating verdict for THIS device (matched by id), when it reached one. */
  verdict: 'PASS' | 'FAIL' | 'NOT_EVALUATED' | null;
  /** The engine failed this device's SCCR against the available fault current (`sccr.chain`, or
   *  `interconnection.der-isolation` for a utility isolation switch). */
  sccrBelowFaultCurrent: boolean;
  line: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Did the engine FAIL this device's interrupting rating against the available fault current? Read
 * from the engine's own FAILs, never recomputed: `sccr.chain` lists each device under the available
 * fault current as "<label> (<SCCR> A)", and `interconnection.der-isolation` states
 * "<label> SCCR <SCCR> A is below …" for an isolator. The device's SCCR is part of the match, and the
 * FAIL condition is that SCCR against one site-wide fault current, so a namesake with the same SCCR
 * fails for the same reason and one with a different SCCR is not matched.
 */
function sccrFailNamesDevice(d: ProtectiveDevice, evaluation?: TopologyEvaluation | null): boolean {
  if (typeof d.sccrA !== 'number') return false;
  const chain = new RegExp(`(^|, )${escapeRe(`${d.label} (${d.sccrA} A)`)}(, | below )`);
  const iso = new RegExp(`(^|; )${escapeRe(`${d.label} SCCR ${d.sccrA} A is below`)}`);
  return (evaluation?.checks ?? []).some(c => c.conclusion === 'FAIL' && (
    (c.id === 'sccr.chain' && chain.test(c.detail))
    || (c.id === 'interconnection.der-isolation' && d.roles.includes('der-isolation-disconnect') && iso.test(c.detail))));
}

/** Where a device sits, in words — the same targets the Service Topology inspector offers. */
export function placementWords(t: ServiceTopology, inlineOnNodeId: string | null | undefined): string {
  if (!inlineOnNodeId) return 'on the service conductors';
  const dom = t.domains.find(d => d.gateway.id === inlineOnNodeId);
  if (dom) return `ahead of ${dom.gateway.label} (${dom.label})`;
  return `ahead of ${topologyNodeLabel(t, inlineOnNodeId)}`;
}

export function describeDisconnect(
  t: ServiceTopology, d: ProtectiveDevice, evaluation?: TopologyEvaluation | null,
): DisconnectFacts {
  const inline = d.inlineOnNodeId ?? null;
  const requirementA = inline ? inlineRequirementA(t, inline) : null;
  const where = inline ? topologyNodeLabel(t, inline) : null;
  const requirement = requirementA !== null
    ? `${requirementA} A — what ${where} carries`
    : inline
      ? `rating not established — ${where} has no established rating`
      : 'rating not established';
  // 🚨 THIS device's verdict, matched by the device's own scope — never by a label another device
  // may share. Should more than one ever match, the worst conclusion stands (a FAIL is never hidden).
  const own = (evaluation?.checks ?? [])
    .filter(c => c.id === 'device.inline-rating' && c.scope === deviceCheckScope(d.id));
  const verdict = own.length > 0 ? foldConclusions(own) : null;
  const sccrBelowFaultCurrent = sccrFailNamesDevice(d, evaluation);
  const part = d.productId ? `part ${d.productId}` : 'part not selected';
  // A number recorded with no part chosen (a seeded one, say) is the device's recorded rating — not
  // a part's nameplate and not a requirement — and reads as exactly that.
  const rating = typeof d.ratedAmps !== 'number' ? 'part rating not stated'
    : d.productId ? `rated ${d.ratedAmps} A` : `recorded rating ${d.ratedAmps} A — not from a part`;
  const sccrEstablished = typeof d.sccrA === 'number';
  const sccr = !sccrEstablished ? 'SCCR not established'
    : d.productId ? `${d.sccrA} A SCCR` : `recorded SCCR ${d.sccrA} A — not from a part`;
  const placement = placementWords(t, inline);
  return {
    deviceId: d.id,
    label: d.label,
    inlineOnNodeId: inline,
    placement,
    requirementA,
    requirement,
    partSelected: !!d.productId,
    part,
    rating,
    sccrEstablished,
    sccr,
    requirementOpen: !!inline && requirementA === null,
    verdict,
    sccrBelowFaultCurrent,
    line: `${d.label} — ${placement} · requirement: ${requirement} · ${part} · ${rating} · ${sccr}`
      + (verdict === 'FAIL' ? ' · FAILS — the device is smaller than what it is in line with' : '')
      + (sccrBelowFaultCurrent ? ' · FAILS — SCCR below the available fault current' : ''),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE QUESTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function buildUtilityDisconnectsItems(input: InterviewInput): InterviewItem[] {
  const t = input.topology;
  if (!t) return [];
  const items: InterviewItem[] = [];
  const eq = input.equipment;
  const hasPv = (input.pvArray.moduleCount ?? 0) > 0;
  const storageSelected = !!eq.storage && eq.storage.count > 0;
  const ic = t.interconnection;

  // ── 1 · METER COLLAR — a utility / AHJ ruling ───────────────────────────
  // Asked under the same condition as "Where does the system connect?", and only while it matters:
  // the connection is still open, a collar is in use, or the ruling has already been recorded.
  // Once the system connects some other way, an unrecorded collar ruling is nobody's question.
  if (hasPv || storageSelected) {
    const permitted = ic.meterCollarPermitted ?? null;
    const pois = t.pointsOfInterconnection ?? [];
    const collarUsed = ic.meterCollarSelected || pois.some(p => p.relationship === 'meter-collar');
    const connectionOpen = !collarUsed
      && !(pois.length > 0 && pois.every(p => p.relationship !== 'unresolved'));
    if (permitted !== null || collarUsed || connectionOpen) {
      items.push({
        id: METER_COLLAR_ITEM_ID,
        section: 'behavior',
        question: 'Does the utility / AHJ permit a meter-collar connection here?',
        state: permitted === null ? 'needs-verification' : 'answered',
        // Nothing recorded ⇒ no answer stated (the card's summary must not read "Not established").
        answer: permitted === true ? 'Permitted — as recorded from the utility / AHJ'
          : permitted === false ? 'Not permitted' : undefined,
        source: permitted === null ? 'Utility / AHJ ruling required' : 'Installer entered',
        options: METER_COLLAR_OPTIONS,
        value: permitted === true ? 'permitted' : permitted === false ? 'not-permitted' : 'unknown',
        why: collarUsed
          ? 'A meter collar is chosen as the connection. The utility and the AHJ decide whether it is '
            + 'allowed — the equipment does not — and SolarPro never assumes they said yes.'
          : 'A meter collar is only a choice where the utility and the AHJ allow it. Recorded as not '
            + 'permitted, it is never offered; not established, choosing it stays NEEDS VERIFICATION.',
        owner: 'Utility / AHJ',
        blocks: collarUsed && permitted !== true ? ['meter-collar connection', 'permit'] : undefined,
      });
    }
  }

  // ── 2 · THE DISCONNECTING MEANS ──────────────────────────────────────────
  const isolationRequired = ic.externalDerIsolationRequired ?? null;
  const storageInGraph = t.storage.some(u => u.role === 'inverter-unit');
  for (const spec of DISCONNECT_ROLES) {
    const devices = t.devices.filter(d => d.roles.includes(spec.role));
    // Asked where the role can exist on THIS service — never a gateway switch with no gateway, never
    // a battery disconnect with no battery. The utility isolation switch follows the utility's
    // answer to behavior.isolation; it is not re-asked here.
    const relevant = devices.length > 0 || (
      spec.role === 'service-disconnect' ? true
        : spec.role === 'der-isolation-disconnect' ? isolationRequired === true
          : spec.role === 'gateway-isolation' ? t.domains.length > 0
            : storageInGraph || storageSelected);
    if (relevant) items.push(disconnectRoleItem(t, spec, devices, input.evaluation ?? null));
  }

  // ── 3 · MORE THAN ONE GATEWAY ON ONE SERVICE ─────────────────────────────
  if (t.domains.length > 1) {
    const doc = ic.multiGatewayMeteringDoc;
    const present = !!doc && doc.present;
    const governs = doc && doc.governs.length > 0
      ? doc.governs : ['site metering', 'CT assignment', 'gateway coordination'];
    items.push({
      id: MULTI_GATEWAY_DOC_ITEM_ID,
      section: 'engineering',
      question: `${COUNT_WORD[t.domains.length] ?? t.domains.length} gateways on one service — what governs `
        + 'site metering and coordination?',
      state: present ? 'answered' : 'needs-verification',
      answer: present
        ? `${doc!.title} (${doc!.source})`
        : `MANUFACTURER DOCUMENT REQUIRED — ${doc
          ? `${doc.title} (${doc.source})` : 'the gateway manufacturer’s multi-gateway application note'}`,
      source: 'Manufacturer specification',
      why: `The manufacturer’s multi-gateway document governs ${governs.join(', ')} when more than one `
        + 'gateway is on one service. SolarPro will not decide those without it — no gateway is assumed '
        + 'to lead and no meter values are summed.',
      owner: 'Manufacturer — supply the multi-gateway document',
      blocks: present ? undefined : governs,
    });
  }
  return items;
}

function disconnectRoleItem(
  t: ServiceTopology, spec: DisconnectRoleSpec, devices: ProtectiveDevice[],
  evaluation: TopologyEvaluation | null,
): InterviewItem {
  const base = {
    id: disconnectItemId(spec.role),
    section: 'engineering' as const,
    question: ROLE_QUESTION[spec.role],
  };
  if (devices.length === 0) {
    if (spec.role === 'service-disconnect') {
      return {
        ...base,
        state: 'needs-answer',
        answer: 'None recorded',
        source: 'Not established',
        why: `${spec.where} Where it sits is where the neutral-ground bond belongs, so until one is `
          + 'recorded the bond location is NOT EVALUATED. SolarPro does not assume which breaker it is.',
        owner: 'Installer',
        blocks: ['neutral-ground bond location', 'SLD', 'permit'],
      };
    }
    if (spec.role === 'der-isolation-disconnect') {
      return {
        ...base,
        state: 'needs-answer',
        answer: 'Required by the utility — no switch placed yet',
        source: 'Not established',
        why: 'The requirement is the utility’s answer above ("Does the utility require an external, '
          + 'lockable disconnect?"). This is the switch itself: add it, say where it sits, choose the part.',
        owner: 'Installer',
        blocks: ['isolation check', 'permit'],
      };
    }
    if (spec.role === 'ess-disconnect') {
      return {
        ...base,
        state: 'needs-verification',
        answer: 'None recorded — NOT EVALUATED — MANUFACTURER INFORMATION REQUIRED',
        source: 'Manufacturer specification',
        why: 'Whether the storage needs its own disconnecting means beyond what its listing provides '
          + 'is a manufacturer-listing and AHJ question. SolarPro does not decide it, and does not '
          + 'assume the answer is no.',
        owner: 'Storage manufacturer / AHJ',
      };
    }
    // Gateway isolation is a service convenience no check requires: none is a complete design.
    return {
      ...base,
      state: 'answered',
      answer: 'None in this design — optional; it lets one gateway be serviced without dropping the rest of the site',
    };
  }

  const facts = devices.map(d => describeDisconnect(t, d, evaluation));
  const tooSmall = facts.some(f => f.verdict === 'FAIL');
  const sccrLow = facts.some(f => f.sccrBelowFaultCurrent);
  const fails = tooSmall || sccrLow;
  const noPart = facts.some(f => !f.partSelected);
  const gaps = facts.some(f => !f.sccrEstablished || f.requirementOpen
    || typeof devices.find(d => d.id === f.deviceId)?.ratedAmps !== 'number');
  const state: ItemState = fails ? 'fails' : noPart ? 'needs-answer' : gaps ? 'needs-verification' : 'answered';
  const source: FactSource = noPart ? 'Not established' : 'Installer entered';
  return {
    ...base,
    state,
    answer: facts.map(f => f.line).join(' | '),
    source,
    why: fails
      ? [
        tooSmall ? 'A device is smaller than what it is in line with. Choose a part rated for that path.' : '',
        sccrLow ? 'A device’s SCCR is below the available fault current at the service. Choose a part whose '
          + 'interrupting rating is at least that.' : '',
      ].filter(Boolean).join(' ')
      : noPart
        ? 'A requirement is not a purchase: nothing is ordered or drawn as a specific device until the '
          + 'part is chosen.'
        : 'The part’s rating and interrupting rating (SCCR) come from the part itself. Until they are '
          + 'stated, the checks that need them report NOT EVALUATED.',
    owner: 'Installer (choose the part; read its rating and SCCR off it)',
    blocks: state === 'answered' ? undefined : ['disconnect checks', 'SLD', 'BOM'],
  };
}

/**
 * The generic "engineering still needs …" rows this slice now asks in installer words. Each is
 * dropped only where an item here states the same thing, so nothing is asked twice and nothing
 * the engine needs disappears.
 */
export function supersededByUtilityDisconnects(input: InterviewInput, items: InterviewItem[]): Set<string> {
  const drop = new Set<string>();
  const t = input.topology;
  if (!t) return drop;
  const has = (id: string) => items.some(i => i.id === id);
  if (has(METER_COLLAR_ITEM_ID)) drop.add('engineering.needs.interconnection.meterCollarPermitted');
  if (has(disconnectItemId('service-disconnect'))) drop.add('engineering.needs.device.role:service-disconnect');
  if (has(disconnectItemId('der-isolation-disconnect'))) drop.add('engineering.needs.device.role:der-isolation-disconnect');
  // Every device is listed under its role ⇒ its placement, part, rating and SCCR are asked there.
  if (t.devices.length > 0 && t.devices.every(d => d.roles.length > 0)) {
    for (const k of ['device.productId', 'device.inlineOnNodeId', 'device.ratedAmps']) drop.add(`engineering.needs.${k}`);
    for (const d of t.devices) drop.add(`engineering.needs.sccr:${d.id}`);
  }
  if (has(MULTI_GATEWAY_DOC_ITEM_ID)) {
    const doc = t.interconnection.multiGatewayMeteringDoc;
    drop.add(`engineering.needs.manufacturer-document:${doc ? doc.title : 'multi-gateway-metering'}`);
  }
  return drop;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE ANSWERS — each one existing writer, (graph, answer) → { topology } | { refused }
// ═══════════════════════════════════════════════════════════════════════════

/**
 * "Does the utility / AHJ permit a meter collar here?" — three states, never a checkbox.
 *
 * Recorded as NOT permitted, a collar already chosen is withdrawn — the flag cleared exactly as the
 * Service Topology inspector clears it, and every meter-collar point of interconnection returned to
 * 'unresolved' — so "Where does the system connect?" is asked again rather than left standing on an
 * arrangement the utility has prohibited. Nothing is chosen in its place.
 */
export function answerMeterCollarPermitted(t: ServiceTopology, permitted: boolean | null): AnswerResult {
  let next = setInterconnection(t, {
    meterCollarPermitted: permitted,
    ...(permitted === false ? { meterCollarSelected: false } : {}),
  });
  let withdrawn = 0;
  if (permitted === false) {
    for (const poi of next.pointsOfInterconnection ?? []) {
      if (poi.relationship !== 'meter-collar') continue;
      next = updatePointOfInterconnection(next, poi.id, { relationship: 'unresolved' });
      withdrawn++;
    }
  }
  const wasSelected = t.interconnection.meterCollarSelected;
  return done(next, permitted === true ? 'Meter collar: permitted (as recorded from the utility / AHJ)'
    : permitted === null ? 'Meter collar: permission not established'
      : `Meter collar: not permitted${wasSelected || withdrawn > 0
        ? ' — the meter-collar connection was withdrawn; answer where the system connects again' : ''}`);
}

/**
 * Add a disconnecting means for a role — the same writer and the same role defaults the inspector
 * uses, with ONE deliberate difference: no rating. The inspector seeds the service rating, which is
 * a number nobody read off a part and would let an in-line rating check pass on it. The engine's
 * requirement is shown instead, and the part's own rating is recorded with the part.
 */
export function answerAddDisconnect(t: ServiceTopology, role: DeviceRole): AnswerResult {
  const spec = DISCONNECT_ROLES.find(r => r.role === role);
  if (!spec) return refuse(`'${role}' is not a disconnecting-means role.`);
  if (role === 'gateway-isolation' && t.domains.length === 0) {
    return refuse('There is no gateway on this service to isolate.');
  }
  // A label no other device already carries — the engine's per-device checks are titled by it.
  const noun = ROLE_NOUN[spec.role];
  let n = t.devices.filter(d => d.roles.includes(role)).length;
  let label = n === 0 ? noun : `${noun} ${n + 1}`;
  while (t.devices.some(d => d.label === label)) label = `${noun} ${++n + 1}`;
  const r = addProtectiveDevice(t, {
    label,
    roles: [role],
    ratedAmps: null,
    lockableOpen: spec.lockableOpen,
    visibleOpen: spec.visibleOpen,
    locationNote: spec.where,
  });
  return done(r.topology, `${label} added — say where it sits and choose the part`);
}

export function answerRemoveDisconnect(t: ServiceTopology, deviceId: string): AnswerResult {
  const d = t.devices.find(x => x.id === deviceId);
  if (!d) return refuse(`No disconnect '${deviceId}'.`);
  return done(removeProtectiveDevice(t, deviceId), `${d.label} removed`);
}

/** The places a device can sit — exactly the inspector's list: the service conductors, a gateway, a panel. */
export function disconnectPlacements(t: ServiceTopology): InterviewOption[] {
  return [
    { value: '', label: 'On the service conductors' },
    ...t.domains.map(dom => ({ value: dom.gateway.id, label: `Ahead of ${dom.gateway.label} (${dom.label})` })),
    ...t.panels.map(p => ({ value: p.id, label: `Ahead of ${p.label}` })),
  ];
}

/**
 * "Where does it sit?" — in line ahead of a gateway or a panel, or on the service conductors.
 * Exactly the inspector's two writes: `placeDeviceInline`, then `placeDevice` with the upstream side
 * following from the path (the branch that feeds a gateway it now sits ahead of).
 */
export function answerDisconnectPlacement(
  t: ServiceTopology, deviceId: string, inlineOnNodeId: string | null,
): AnswerResult {
  const d = t.devices.find(x => x.id === deviceId);
  if (!d) return refuse(`No disconnect '${deviceId}'.`);
  const target = inlineOnNodeId || null;
  if (target && !t.domains.some(x => x.gateway.id === target) && !t.panels.some(p => p.id === target)) {
    return refuse('A disconnect can sit ahead of a gateway or a panel on this service, or on the service conductors.');
  }
  let next = placeDeviceInline(t, d.id, target);
  const dom = t.domains.find(x => x.gateway.id === target);
  next = placeDevice(next, d.id, dom ? dom.branchId : (target ? d.feedsNodeId ?? null : null));
  return done(next, `${d.label}: ${placementWords(next, target)}`);
}

/**
 * The part chosen to meet the requirement, and what is read off it — its rating and its
 * interrupting rating. Blank is "not stated", never zero; a calculated requirement never fills these.
 *
 * 🚨 A NEW PART BRINGS ITS OWN NUMBERS. When the part changes (or is cleared), whatever rating and
 * SCCR the device carried were not read off THIS part — a seeded service or path rating, or the
 * previous part's — so each is reset to not stated unless the same answer states it. Otherwise the
 * engine's in-line rating check would pass against a copy of the requirement.
 */
export function answerDisconnectPart(
  t: ServiceTopology, deviceId: string,
  patch: { productId?: string | null; ratedAmps?: number | null; sccrA?: number | null },
): AnswerResult {
  const d = t.devices.find(x => x.id === deviceId);
  if (!d) return refuse(`No disconnect '${deviceId}'.`);
  for (const [k, v] of [['rating', patch.ratedAmps], ['interrupting rating', patch.sccrA]] as const) {
    if (v !== undefined && v !== null && (!Number.isFinite(v) || v <= 0)) {
      return refuse(`The part’s ${k} must be a positive number of amperes, or left blank.`);
    }
  }
  let next = t;
  const ratings: Partial<ProtectiveDevice> = {};
  let partChanged = false;
  let newPart: string | null = d.productId ?? null;
  if (patch.productId !== undefined) {
    newPart = patch.productId?.trim() || null;
    partChanged = newPart !== (d.productId ?? null);
    // The shared writer clears the old part's / the seed's numbers on a part change (see
    // selectDeviceProduct) unless this write states them.
    next = selectDeviceProduct(next, d.id, newPart, { ratedAmps: patch.ratedAmps, sccrA: patch.sccrA });
  } else {
    if (patch.ratedAmps !== undefined) ratings.ratedAmps = patch.ratedAmps;
    if (patch.sccrA !== undefined) ratings.sccrA = patch.sccrA;
    if (Object.keys(ratings).length > 0) next = updateProtectiveDevice(next, d.id, ratings);
  }
  if (partChanged && newPart === null) {
    return done(next, `${d.label}: part cleared — its rating and SCCR cleared with it`);
  }
  const unstated = partChanged && (patch.ratedAmps === undefined || patch.sccrA === undefined);
  return done(next, `${d.label}: part recorded${unstated
    ? ' — read its rating and SCCR off the part; nothing the device carried before is kept' : ''}`);
}
