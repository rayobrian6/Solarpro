// ═══════════════════════════════════════════════════════════════════════════
// 🚨 WHERE EACH SYSTEM CONFIG QUESTION LIVES, AND WHAT IS STILL REQUIRED — ONE ORDER, ONE COUNT.
//
// Ray (System Config UX correction V3, 2026-10-03):
//
//   "We do not want a second questionnaire layered on top of System Config. The existing System
//    Config sections must become smarter and absorb the engineering questions that naturally belong
//    there. At the bottom, one compact ENGINEERING READINESS panel for leftovers, unresolved items,
//    manufacturer constraints and release readiness."
//
// `buildSystemConfigInterview` still decides WHAT is asked (relevance, answers, sources, release).
// This module only decides WHERE each item is asked — its home card — and the ONE ordered list of
// required, unresolved items that the guided strip, [Answer Next] and the readiness panel all read,
// so the strip, the panel and the dialog can never disagree about "N required answers".
//
// Pure and isomorphic. It computes no engineering and writes nothing.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  InterviewItem, SystemConfigInterview, SectionId,
} from '@/lib/electrical/systemConfigInterview';
import type { TopologyCheck } from '@/lib/electrical/serviceTopology';
import { LOAD_ANALYSIS_ITEM_ID } from '@/lib/electrical/systemConfigLoadAnalysis';
import {
  DISCONNECT_ITEM_PREFIX, METER_COLLAR_ITEM_ID, MULTI_GATEWAY_DOC_ITEM_ID, ROLE_NOUN,
  UTILITY_ITEM_PREFIX, disconnectItemId, disconnectRoleOf,
} from '@/lib/electrical/systemConfigUtilityDisconnects';
import { SYSTEM_EQUIPMENT_PREFIX, parseSystemEquipmentItemId } from '@/lib/electrical/systemConfigSystemEquipment';

// ── Homes ───────────────────────────────────────────────────────────────────

/** The System Config card an item is asked in. Each item has exactly one. */
export type CardHome = 'summary' | 'service' | 'battery' | 'inverters' | 'systemConfig' | 'readiness';

/** The DOM id of each home card's wrapper — what the guided strip scrolls to and rings. */
export const CARD_ANCHOR: Readonly<Record<CardHome, string>> = {
  summary: 'sc-card-summary',
  service: 'sc-card-service',
  battery: 'sc-card-battery',
  inverters: 'sc-card-inverters',
  systemConfig: 'sc-card-system-config',
  readiness: 'engineering-readiness',
};

/** The card's name, as its heading reads. */
export const CARD_TITLE: Readonly<Record<CardHome, string>> = {
  summary: 'Engineering Summary',
  service: 'Existing Electrical Service',
  battery: 'Battery Storage',
  inverters: 'Inverters & Strings',
  systemConfig: 'System Configuration',
  readiness: 'Engineering Readiness',
};

const NEEDS_PREFIX = 'engineering.needs.';
const EXISTING_EQUIPMENT_NEED = `${NEEDS_PREFIX}service.existingEquipment.`;
const DER_ISOLATION_ITEM = disconnectItemId('der-isolation-disconnect');
/**
 * "Assign PV strings to storage inputs" — what the engine waits on while a unit's PV input has no
 * landing. With more than one unit `behavior.pv-landing` asks it (and this need is dropped as the
 * same answer twice); with ONE unit nothing else asks it, so the need itself is the question, and it
 * is asked where the strings are: the Inverters & Strings card's String assignment editor.
 */
export const PV_STRING_ASSIGNMENT_NEED = `${NEEDS_PREFIX}pv.stringAssignment`;

/**
 * Where an interview item is asked (SYSCONFIG V3 spec, "Where every interview item lives now").
 * Anything not named there is a leftover, and leftovers belong to the readiness panel.
 */
export function homeOf(itemId: string): CardHome {
  const id = itemId;
  if (id === 'design.pv-array') return 'summary';
  // A module conflict / stale string assignment is a required action, not a fact to restate.
  if (id.startsWith('design.')) return 'readiness';
  if (id.startsWith('service.') || id.startsWith(EXISTING_EQUIPMENT_NEED)) return 'service';
  if (id === 'equipment.storage' || id === 'equipment.gateway' || id.startsWith(SYSTEM_EQUIPMENT_PREFIX)
    || id === 'behavior.storage-landing') return 'battery';
  if (id === 'equipment.pv-inverter' || id === 'behavior.pv-connection' || id === 'behavior.pv-landing'
    || id === PV_STRING_ASSIGNMENT_NEED) {
    return 'inverters';
  }
  if (id === 'behavior.backup' || id === 'behavior.systems' || id === 'behavior.interconnection'
    || id === 'behavior.isolation' || id.startsWith(UTILITY_ITEM_PREFIX)
    // The utility isolation switch is the part behind "UTILITY ISOLATION [Select Equipment]".
    || id === DER_ISOLATION_ITEM) return 'systemConfig';
  return 'readiness';
}

/** The anchor id of the card an item is asked in. */
export const anchorOf = (itemId: string): string => CARD_ANCHOR[homeOf(itemId)];

// ── What is required ────────────────────────────────────────────────────────

const isLoadAnalysis = (id: string) => id === LOAD_ANALYSIS_ITEM_ID || id.startsWith(`${LOAD_ANALYSIS_ITEM_ID}.`);

/**
 * Is this item a REQUIRED, unresolved one?
 *
 *  · needs-answer / fails — always (every open question; a FAIL is never optional to fix).
 *  · needs-verification — when the engineering names it as what a required check waits on
 *    (`engineering.needs.*`, built only from non-optional requirements), or when the item itself
 *    states what it blocks.
 *  · The optional load analysis never enters — unless it FAILS (its own module's rule: "a FAIL is
 *    not optional to fix"). Its verdict rows are verdicts, not questions, and never enter.
 *  · The overall verdict is a summary of the rest, never an action of its own.
 */
export function isRequiredUnresolved(item: InterviewItem): boolean {
  if (item.id === 'engineering.overall') return false;
  if (isLoadAnalysis(item.id)) {
    return item.state === 'fails' && !item.id.startsWith(`${LOAD_ANALYSIS_ITEM_ID}.check.`);
  }
  if (item.state === 'needs-answer' || item.state === 'fails') return true;
  if (item.state === 'needs-verification') {
    return item.id.startsWith(NEEDS_PREFIX) || (item.blocks?.length ?? 0) > 0;
  }
  return false;
}

/**
 * An `engineering.needs.<token>` that a question already asks, by token. Where that question is
 * itself in the queue, the need is the same answer stated twice and is dropped — no fact is asked
 * twice. Where it is not, the need stays: nothing the engine waits on disappears.
 */
const NEED_ASKED_BY: ReadonlyArray<[token: string | ((t: string) => boolean), asks: (id: string) => boolean]> = [
  ['service.availableFaultCurrentA', id => id === 'service.fault-current'],
  ['service.existingEquipment.verified', id => id === 'service.existing'],
  ['panel.busbarRatingA', id => id.startsWith('service.panel.')],
  ['panel.mainBreakerA', id => id.startsWith('service.panel.')],
  ['pv.stringAssignment', id => id === 'behavior.pv-landing'],
  ['interconnection.solarCoupling', id => id === 'behavior.pv-connection'],
  ['interconnection.derArrangement', id => id === 'behavior.systems'],
  ['interconnection.externalDerIsolationRequired', id => id === 'behavior.isolation'],
  ['interconnection.isolationArrangement', id => id === 'behavior.isolation' || id === DER_ISOLATION_ITEM],
  ['interconnection.isolationArrangementAccepted', id => id === 'behavior.isolation'],
  ['interconnection.meterCollarPermitted', id => id === METER_COLLAR_ITEM_ID],
  ['poi.relationship', id => id === 'behavior.interconnection'],
  ['domain.storageConnection', id => id === 'behavior.storage-landing' || parseSystemEquipmentItemId(id)?.kind === 'landing'],
  ['domain.backedUpPanelIds', id => id === 'behavior.backup'],
  [t => t.startsWith('manufacturer-document:') && /multi|gateways on a single site/i.test(t),
    id => id === MULTI_GATEWAY_DOC_ITEM_ID],
];

function needAskedBy(token: string, id: string): boolean {
  // "A device carrying the <role> role" is the disconnect editor for that role.
  if (token.startsWith('device.role:')) return id === `${DISCONNECT_ITEM_PREFIX}${token.slice('device.role:'.length)}`;
  for (const [match, asks] of NEED_ASKED_BY) {
    if (typeof match === 'string' ? match === token : match(token)) return asks(id);
  }
  return false;
}

const GROUP_ORDER: ReadonlyArray<CardHome> = ['service', 'battery', 'inverters', 'systemConfig', 'readiness'];
const SECTION_ORDER: ReadonlyArray<SectionId> = ['design', 'service', 'equipment', 'behavior', 'engineering'];

/** Every item the interview holds, in section order. */
export function allInterviewItems(interview: Pick<SystemConfigInterview, 'sections'>): InterviewItem[] {
  return [...interview.sections]
    .sort((a, b) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id))
    .flatMap(s => s.items);
}

/** One item by id, from the live interview (null when it is no longer asked). */
export function findInterviewItem(
  interview: Pick<SystemConfigInterview, 'sections'>, itemId: string | null | undefined,
): InterviewItem | null {
  if (!itemId) return null;
  return allInterviewItems(interview).find(i => i.id === itemId) ?? null;
}

/**
 * THE ONE ORDERED LIST of required, unresolved items: every open question plus the required
 * engineering items (disconnect roles to answer, what the engine still waits on, FAILs), with
 * duplicates removed. Design conflicts first, then service → battery → inverters → system
 * configuration → readiness; within a card, the interview's own order.
 */
export function requiredQueue(interview: Pick<SystemConfigInterview, 'sections' | 'openQuestions'>): InterviewItem[] {
  const all = allInterviewItems(interview);
  const ids = new Set<string>();
  const picked: InterviewItem[] = [];
  // Every open question is required by definition, whatever its state reads.
  for (const i of [...all.filter(isRequiredUnresolved), ...interview.openQuestions]) {
    if (ids.has(i.id)) continue;
    ids.add(i.id);
    picked.push(i);
  }
  const deduped = picked.filter(i => {
    if (!i.id.startsWith(NEEDS_PREFIX)) return true;
    const token = i.id.slice(NEEDS_PREFIX.length);
    return !picked.some(q => q !== i && !q.id.startsWith(NEEDS_PREFIX) && needAskedBy(token, q.id));
  });
  const rank = (i: InterviewItem) => (i.section === 'design' ? 0 : 1 + GROUP_ORDER.indexOf(homeOf(i.id)));
  const order = new Map(all.map((i, k) => [i.id, k]));
  const sorted = deduped
    .map((i, k) => ({ i, k }))
    .sort((a, b) => rank(a.i) - rank(b.i)
      || (order.get(a.i.id) ?? a.k) - (order.get(b.i.id) ?? b.k))
    .map(x => x.i);
  // 🚨 ONE SITE VISIT IS ONE ACTION. Ray (V3): "Existing service equipment · Field verification 4 items
  // required [Verify]" — the model number, the main and feeder arrangements, the AIC/SCCR and "read on
  // site" are read off the same equipment in one visit, and answered in one Verify dialog. Listed as five
  // required answers they buried everything else. They stay five facts; they are ONE next action, which
  // opens that dialog.
  const ee = sorted.filter(i => i.id.startsWith(EXISTING_EQUIPMENT_NEED));
  if (ee.length <= 1) return sorted;
  const grouped: InterviewItem = { ...ee[0], question: `${VERIFY_EXISTING_GROUP} (${ee.length} items)` };
  return sorted.filter(i => !ee.includes(i) || i === ee[0]).map(i => (i === ee[0] ? grouped : i));
}

/** The one next action that stands for every existing-service-equipment field reading. */
export const VERIFY_EXISTING_GROUP = 'Verify the existing service equipment';

// ── What to call the next action ────────────────────────────────────────────

const NEED_LABEL: Readonly<Record<string, string>> = {
  'service.existingEquipment.sccrA': 'Confirm service equipment AIC/SCCR',
  'service.existingEquipment.catalogNumber': 'Record the service equipment catalog number',
  'service.existingEquipment.mainArrangement': 'Verify the service main / disconnect arrangement',
  'service.existingEquipment.feederArrangement': 'Verify the service feeder arrangement',
  'service.existingEquipment.verified': 'Confirm the service equipment was read on site',
  'service.availableFaultCurrentA': 'Get the available fault current from the utility',
  'pv.stringAssignment': 'Assign PV strings to storage inputs',
  'interconnection.solarCoupling': 'Record how the PV connects',
  'interconnection.derArrangement': 'Choose how the systems connect',
  'interconnection.externalDerIsolationRequired': 'Record the utility isolation requirement',
  'interconnection.isolationArrangement': 'Choose the utility isolation arrangement',
  'interconnection.isolationArrangementAccepted': 'Confirm utility isolation acceptance',
  'interconnection.meterCollarPermitted': 'Record the meter-collar ruling',
  'poi.relationship': 'Choose the interconnection method',
  'domain.storageConnection': 'Choose where the battery AC circuits land',
  'domain.backedUpPanelIds': 'Choose what is backed up',
  'device.productId': 'Choose the actual disconnect parts',
  'device.inlineOnNodeId': 'Place each safety switch on its path',
  'device.ratedAmps': 'Enter each safety switch rating',
  'aggregation.productId': 'Choose the generation panel part',
  'gateway.continuousRatingA': 'Confirm the gateway continuous rating',
  'panel.busbarRatingA': 'Enter the panel busbar rating',
  'panel.mainBreakerA': 'Enter the panel main breaker',
};

const ITEM_LABEL: Readonly<Record<string, string>> = {
  'design.pv-array': 'Place the PV modules in Design',
  'design.module-conflict': 'Resolve the module conflict with Design',
  'design.assignment-stale': 'Re-derive the PV strings for the design',
  'service.rating': 'Enter the service rating',
  'service.system': 'Confirm the electrical system',
  'service.distribution': 'Choose how the service is distributed',
  'service.fault-current': 'Get the available fault current from the utility',
  'service.existing': 'Verify the existing service equipment on site',
  'equipment.pv-inverter': 'Choose the PV inverter (or None)',
  'equipment.gateway': 'Choose the backup controller / gateway',
  'behavior.pv-connection': 'Choose where the PV connects',
  'behavior.pv-landing': 'Assign PV strings to storage inputs',
  'behavior.storage-landing': 'Choose the battery AC aggregation',
  'behavior.backup': 'Choose what is backed up',
  'behavior.systems': 'Choose how the systems connect',
  'behavior.interconnection': 'Choose the interconnection method',
  [METER_COLLAR_ITEM_ID]: 'Record the meter-collar ruling',
  [MULTI_GATEWAY_DOC_ITEM_ID]: 'Provide the multi-gateway manufacturer document',
};

/** "MSP #1: main breaker and busbar rating?" → "MSP #1". */
const subjectOf = (question: string) => question.split(':')[0].trim();

/**
 * The next action, in the installer's words — short enough for one line of the readiness panel and
 * the guided strip ("Assign PV strings to storage inputs", "Confirm service equipment AIC/SCCR").
 */
export function nextActionLabel(item: InterviewItem): string {
  const id = item.id;
  if (id.startsWith(EXISTING_EQUIPMENT_NEED) && item.question.startsWith(VERIFY_EXISTING_GROUP)) return item.question;
  if (id === 'behavior.isolation') {
    return item.value === 'yes' && item.state === 'needs-verification' ? 'Confirm utility isolation acceptance'
      : item.value === 'yes' ? 'Select the utility isolation equipment'
        : 'Record the utility isolation requirement';
  }
  if (ITEM_LABEL[id]) return ITEM_LABEL[id];
  if (id.startsWith('service.panel.')) return `Enter ${subjectOf(item.question)} main breaker and busbar`;
  const sys = parseSystemEquipmentItemId(id);
  if (sys) {
    const who = item.question.includes(':') ? `${subjectOf(item.question)} ` : '';
    return sys.kind === 'landing' ? `Choose where ${who}battery AC circuits land`
      : item.state === 'needs-verification' ? `Confirm ${who}controller compatibility with the manufacturer`
        : `Confirm ${who}batteries and backup controller`;
  }
  const role = disconnectRoleOf(id);
  if (role) {
    const noun = ROLE_NOUN[role.role];
    if (role.role === 'ess-disconnect' && item.state === 'needs-verification' && /None recorded/.test(item.answer ?? '')) {
      return 'Confirm whether the storage needs its own disconnect';
    }
    return item.state === 'fails' ? `Replace the ${noun.toLowerCase()} — its rating does not fit`
      : item.state === 'needs-answer' ? (/None recorded|no switch placed/i.test(item.answer ?? '')
        ? `Add the ${noun.toLowerCase()}` : `Choose the ${noun.toLowerCase()} part`)
        : `Confirm the ${noun.toLowerCase()} rating and SCCR`;
  }
  if (id.startsWith(NEEDS_PREFIX)) {
    const token = id.slice(NEEDS_PREFIX.length);
    if (NEED_LABEL[token]) return NEED_LABEL[token];
    if (token.startsWith('sccr:')) return `Confirm the SCCR of ${item.question.replace(/^Interrupting rating \(SCCR\) for /, '')}`;
    if (token.startsWith('calculation-method:')) return 'Have an engineer establish the calculation method';
    if (token.startsWith('manufacturer-limit:') || token.startsWith('manufacturer-document:')) return `Get the ${lowerFirst(item.question)}`;
    if (token.startsWith('device.role:')) return `Add ${lowerFirst(item.question)}`;
    return `Provide: ${item.question}`;
  }
  if (isLoadAnalysis(id)) return 'Resolve the failing load analysis';
  if (id.startsWith('engineering.')) return item.state === 'fails' ? `Resolve: ${item.question}` : `Review: ${item.question}`;
  return item.question.replace(/\?$/, '');
}

const lowerFirst = (s: string) => (s.length > 1 && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

// ── The verdicts, counted ───────────────────────────────────────────────────

export interface ReadinessCounts {
  pass: number;
  fail: number;
  notEvaluated: number;
}

/** PASS / FAIL / NOT EVALUATED, counted from the engine's own checks — every check, once. */
export function readinessCounts(checks: ReadonlyArray<Pick<TopologyCheck, 'conclusion'>> | null | undefined): ReadinessCounts {
  const c = checks ?? [];
  return {
    pass: c.filter(x => x.conclusion === 'PASS').length,
    fail: c.filter(x => x.conclusion === 'FAIL').length,
    notEvaluated: c.filter(x => x.conclusion === 'NOT_EVALUATED').length,
  };
}

export interface ReleaseStatus {
  kind: 'BLOCKED' | 'ELIGIBLE' | 'COMPLETE';
  /** "BLOCKED — 3 required answers" / "ELIGIBLE — 2 items to review" / "COMPLETE". */
  label: string;
  /** Required answers (BLOCKED), items to review (ELIGIBLE), 0 (COMPLETE). */
  count: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The release status, from the interview's own release state (never re-derived) and the queue.
 *
 * ELIGIBLE is not COMPLETE: release-eligible with anything still to look at (a ruling to verify, a
 * recorded figure an analysis superseded) says how many, and "COMPLETE" is said only when nothing is.
 */
export function releaseStatus(
  interview: Pick<SystemConfigInterview, 'sections' | 'openQuestions' | 'release'>,
  queue: ReadonlyArray<InterviewItem> = requiredQueue(interview),
): ReleaseStatus {
  if (!interview.release.releaseReady) {
    const n = queue.length;
    return n > 0
      ? { kind: 'BLOCKED', label: `BLOCKED — ${plural(n, 'required answer', 'required answers')}`, count: n }
      : { kind: 'BLOCKED', label: `BLOCKED — ${plural(interview.release.blockers.length, 'blocker', 'blockers')}`,
        count: interview.release.blockers.length };
  }
  const review = new Set(queue.map(i => i.id));
  for (const i of allInterviewItems(interview)) {
    if (i.id === 'engineering.overall') continue;
    if (i.state === 'needs-verification' || i.state === 'derived' || i.state === 'needs-answer' || i.state === 'fails') review.add(i.id);
  }
  return review.size > 0
    ? { kind: 'ELIGIBLE', label: `ELIGIBLE — ${plural(review.size, 'item to review', 'items to review')}`, count: review.size }
    : { kind: 'COMPLETE', label: 'COMPLETE', count: 0 };
}
