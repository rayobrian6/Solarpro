// ═══════════════════════════════════════════════════════════════════════════
// 🚨 EACH BACKUP SYSTEM'S EQUIPMENT, WHERE ITS BATTERIES LAND, AND WHICH PANELS ARE BACKED UP —
//    ASKED IN SYSTEM CONFIG, WRITTEN THROUGH THE WRITERS THE SERVICE TOPOLOGY INSPECTOR USES.
//
// The inspector's BACKUP DOMAIN card edits a system's controller, its battery / inverter units and
// their count, and its expansion units; its PANEL card says whether a panel is behind a gateway.
// System Config could do none of that per system: one landing answer was written to every system at
// once, and "What is backed up?" offered only the whole house or nothing. This module is that
// capability in the installer's words:
//
//   · "System 2: which backup controller, batteries and expansion units?"  → `setDomainEquipment`
//     (the writer the inspector's re-equip uses). One system ⇒ asked once, with no "per system".
//   · "System 2: where do its battery AC circuits land?" (only with more than one system)
//     → `answerStorageLanding(t, value, [thatSystem])`.
//   · "Only the panels I choose" (only with more than one panel) → `updatePanel` / `addBackupDomain`
//     / `updateDomain` / `removeBackupDomain`, the authoring the inspector's checkboxes use.
//
// 🚨 ONLY WHAT THE CATALOGUE SAYS FITS IS OFFERED. A controller is offered for a battery when the
// catalogue names the two together — from either row, by id or by family. An expansion is offered
// when the catalogue names that battery as its host. Where the catalogue carries no such fact the
// answer is "NOT EVALUATED — MANUFACTURER INFORMATION REQUIRED" and nothing is offered as though it
// had been verified. No brand name appears in this file.
//
// 🚨 BATTERIES ARE NEVER SPLIT FOR THE INSTALLER. A new system gets exactly the count typed for its
// panel; a count nobody typed is ZERO, not a share of the selection.
//
// Pure: every function is (graph, answer) → { topology } | { refused }, persisted by the page through
// the one write path (`PUT /api/projects/[id]/service-topology`).
// ═══════════════════════════════════════════════════════════════════════════

import {
  BACKUP_INTERFACES, BATTERIES, getBatteryById, getBackupInterfaceById,
  type BackupInterface, type BatterySystem,
} from '@/lib/equipment-db';
import type { ServiceTopology, BackupDomain, StorageUnit } from '@/lib/electrical/serviceTopology';
import type {
  InterviewInput, InterviewItem, InterviewOption, ItemState,
} from '@/lib/electrical/systemConfigInterview';
import { answerBackup, answerStorageLanding, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import {
  setDomainEquipment, setStoragePvInput, addBackupDomain, updatePanel, updateDomain, removeBackupDomain,
} from '@/lib/electrical/topologyAuthoring';
import { applyPerSystemGenerationPanels } from '@/lib/electrical/topologyPresets';

/** Every item id this module emits starts with this; the editor dispatches on it. */
export const SYSTEM_EQUIPMENT_PREFIX = 'equipment.system.';
const EQUIP = `${SYSTEM_EQUIPMENT_PREFIX}equip.`;
const LANDING = `${SYSTEM_EQUIPMENT_PREFIX}landing.`;

export const systemEquipmentItemId = (domainId: string) => `${EQUIP}${domainId}`;
export const systemLandingItemId = (domainId: string) => `${LANDING}${domainId}`;
/** The domain an item of this module is about, and which kind of item it is. */
export function parseSystemEquipmentItemId(id: string): { kind: 'equip' | 'landing'; domainId: string } | null {
  if (id.startsWith(EQUIP)) return { kind: 'equip', domainId: id.slice(EQUIP.length) };
  if (id.startsWith(LANDING)) return { kind: 'landing', domainId: id.slice(LANDING.length) };
  return null;
}

export const NOT_EVALUATED_MFR = 'NOT EVALUATED — MANUFACTURER INFORMATION REQUIRED';

const done = (topology: ServiceTopology, did: string): AnswerResult => ({ ok: true, topology, did });
const refuse = (refused: string): AnswerResult => ({ ok: false, refused });

// ═══════════════════════════════════════════════════════════════════════════
// WHAT THE CATALOGUE SAYS FITS
// ═══════════════════════════════════════════════════════════════════════════

const nameOf = (r: { manufacturer: string; model: string }) => `${r.manufacturer} ${r.model}`;
const isInverterUnit = (b: BatterySystem) => (b.storageRole ?? 'inverter-unit') === 'inverter-unit';
/** The islanding controllers a backed-up system is built around — the inspector's own list. */
const CONTROLLERS = () => BACKUP_INTERFACES.filter(g => g.subcategory === 'gateway_controller' && g.active !== false);

/** The catalogue names this controller and this battery together — from either row, by id or by family. */
function listedTogether(g: BackupInterface, b: BatterySystem): boolean {
  const fromBattery = b.compatibleWith ?? [];
  const fromController = [...(g.compatibleBatteries ?? []), ...(g.compatibleWith ?? [])];
  return fromBattery.includes(g.id)
    || (!!g.ecosystemFamily && fromBattery.includes(g.ecosystemFamily))
    || fromController.includes(b.id)
    || (!!b.ecosystemFamily && fromController.includes(b.ecosystemFamily));
}

export interface CatalogueChoice {
  /** The catalogue carries the fact. False ⇒ nothing is offered as verified. */
  evaluated: boolean;
  /** Only what the catalogue says fits. */
  options: InterviewOption[];
  /** Why nothing is offered, in words. */
  note?: string;
}

/** The backup controllers the catalogue lists as compatible with this battery. */
export function controllersFor(storageProductId: string | null | undefined): CatalogueChoice {
  if (!storageProductId) {
    return { evaluated: false, options: [], note: 'Which controller fits depends on the batteries — choose them first.' };
  }
  const b = getBatteryById(storageProductId);
  if (!b) {
    return { evaluated: false, options: [],
      note: `${NOT_EVALUATED_MFR} — '${storageProductId}' is not in the equipment catalogue, so no controller can be shown to fit it.` };
  }
  const options = CONTROLLERS().filter(g => listedTogether(g, b)).map(g => ({ value: g.id, label: nameOf(g) }));
  return options.length > 0
    ? { evaluated: true, options }
    : { evaluated: false, options: [],
        note: `${NOT_EVALUATED_MFR} — the catalogue lists no backup controller as compatible with ${nameOf(b)}.` };
}

/**
 * The batteries a backed-up system can hold: inverter-class units that can back up loads and that
 * the catalogue lists with at least one backup controller. (The controller is then chosen from what
 * the catalogue lists for the battery chosen — so a system can move from one product family to
 * another in one answer instead of being locked to whatever it holds.)
 */
export function backupBatteries(): InterviewOption[] {
  const controllers = CONTROLLERS();
  return BATTERIES
    .filter(b => b.active !== false && isInverterUnit(b) && b.backupCapable && controllers.some(g => listedTogether(g, b)))
    .map(b => ({ value: b.id, label: nameOf(b) }));
}

/** The expansion units the catalogue names this battery as host for. None ⇒ the question is not asked. */
export function expansionsFor(hostProductId: string | null | undefined): CatalogueChoice {
  const host = hostProductId ? getBatteryById(hostProductId) : undefined;
  if (!host) return { evaluated: false, options: [] };
  const options = BATTERIES
    .filter(b => b.active !== false && b.storageRole === 'energy-expansion'
      && (b.expansionHostId === host.id || (b.compatibleWith ?? []).includes(host.id)))
    .map(b => ({ value: b.id, label: nameOf(b) }));
  return options.length > 0 ? { evaluated: true, options }
    : { evaluated: false, options: [], note: `The catalogue lists no expansion unit for ${nameOf(host)}.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE SYSTEM, READ FROM THE GRAPH
// ═══════════════════════════════════════════════════════════════════════════

export interface SystemEquipmentFacts {
  domain: BackupDomain;
  inverting: StorageUnit[];
  expansions: StorageUnit[];
  /** The one battery product in the system. Null ⇒ none recorded, or more than one model. */
  storageProductId: string | null;
  expansionProductId: string | null;
  mixed: boolean;
}

export function systemEquipmentFacts(t: ServiceTopology, d: BackupDomain): SystemEquipmentFacts {
  const units = d.storageUnitIds.map(id => t.storage.find(u => u.id === id)).filter((u): u is StorageUnit => !!u);
  const inverting = units.filter(u => u.role === 'inverter-unit');
  const expansions = units.filter(u => u.role === 'energy-expansion');
  const essIds = [...new Set(inverting.map(u => u.productId))];
  const expIds = [...new Set(expansions.map(u => u.productId))];
  return {
    domain: d, inverting, expansions,
    storageProductId: essIds.length === 1 ? essIds[0] : null,
    expansionProductId: expIds.length === 1 ? expIds[0] : null,
    mixed: essIds.length > 1 || expIds.length > 1,
  };
}

/** What else in the graph hangs off a system — removing the system would leave these pointing at nothing. */
export function systemDependents(t: ServiceTopology, d: BackupDomain): string[] {
  const gw = d.gateway.id;
  const owned = new Set([d.id, ...d.storageUnitIds]);
  const aggs = (t.aggregationPanels ?? []).filter(a => a.domainId === d.id || a.feedsNodeId === gw
    || a.inputs.some(i => owned.has(i.sourceId)));
  const aggIds = new Set(aggs.map(a => a.id));
  const pois = (t.pointsOfInterconnection ?? []).filter(p => p.connectedToNodeId === gw
    || owned.has(p.derNodeId ?? '') || aggIds.has(p.derNodeId ?? ''));
  const devices = t.devices.filter(x => x.inlineOnNodeId === gw || x.feedsNodeId === gw);
  return [...aggs.map(a => a.label), ...pois.map(p => p.label), ...devices.map(x => x.label)];
}

const freeSystemLabel = (t: ServiceTopology) => {
  const taken = new Set(t.domains.map(d => d.label));
  let n = 1;
  while (taken.has(`System ${n}`)) n++;
  return `System ${n}`;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ═══════════════════════════════════════════════════════════════════════════
// THE QUESTIONS
// ═══════════════════════════════════════════════════════════════════════════

/** Per-system landing wording: this system's own answer, not "one per system". */
const LANDING_OPTIONS: InterviewOption[] = [
  { value: 'der-aggregation-panel', label: 'Its own external generation / combiner panel' },
  { value: 'gateway-panelboard', label: 'Inside its gateway’s own panelboard' },
  { value: 'backed-up-panel-busbar', label: 'On its backed-up panel’s busbar' },
];

function systemEquipmentItem(t: ServiceTopology, d: BackupDomain, single: boolean): InterviewItem {
  const f = systemEquipmentFacts(t, d);
  const ctl = controllersFor(f.storageProductId);
  const exp = expansionsFor(f.storageProductId);
  const essName = f.inverting[0]?.label ?? f.storageProductId ?? 'battery';
  const expName = f.expansions[0]?.label ?? f.expansionProductId ?? 'expansion unit';
  const asksExpansion = exp.evaluated || f.expansions.length > 0;

  // needs-answer: the installer has something to decide. needs-verification: only the manufacturer can.
  const open: string[] = [];
  const unverified: string[] = [];
  if (f.inverting.length === 0) {
    open.push('No batteries are recorded in this system. How many are installed is yours to say — SolarPro '
      + 'does not split the selection across systems.');
  }
  if (f.mixed) open.push('More than one battery or expansion model is recorded in this system. Choose the one installed.');
  if (f.storageProductId && ctl.evaluated && !ctl.options.some(o => o.value === d.gateway.productId)) {
    open.push(`The catalogue does not list ${d.gateway.label} as compatible with ${essName}. Choose a listed `
      + 'controller, or record the manufacturer’s compatibility statement in Advanced.');
  }
  if (f.storageProductId && !ctl.evaluated) unverified.push(`Controller compatibility: ${ctl.note}`);
  if (f.expansions.length > 0 && f.expansionProductId && !exp.options.some(o => o.value === f.expansionProductId)) {
    open.push(`The catalogue does not list ${expName} as an expansion for ${essName}.`);
  }
  if (f.expansions.length > f.inverting.length) {
    open.push(`${plural(f.expansions.length, 'expansion unit', 'expansion units')} and `
      + `${plural(f.inverting.length, 'battery', 'batteries')} — each expansion is harnessed to one battery.`);
  }
  const state: ItemState = open.length > 0 ? 'needs-answer' : unverified.length > 0 ? 'needs-verification' : 'answered';

  const parts = [d.gateway.label,
    f.inverting.length > 0 ? `${f.inverting.length} × ${essName}` : 'no batteries recorded'];
  if (f.expansions.length > 0) parts.push(`${f.expansions.length} × ${expName}`);
  if (f.storageProductId && !ctl.evaluated) parts.push(`controller compatibility ${NOT_EVALUATED_MFR}`);

  const what = asksExpansion ? 'backup controller, batteries and expansion units' : 'backup controller and batteries';
  return {
    id: systemEquipmentItemId(d.id),
    section: 'equipment',
    // One system ⇒ asked once, in plain words. More ⇒ each system by the name the job uses.
    question: single ? `Which ${what} are installed?` : `${d.label}: which ${what}?`,
    state,
    answer: parts.join(' · '),
    source: 'Selected equipment',
    options: ctl.options,
    value: d.gateway.productId,
    why: [...open, ...unverified].join(' ') || undefined,
    owner: state === 'needs-verification' ? 'Manufacturer documentation' : 'Installer (equipment selection)',
    blocks: state === 'answered' ? undefined : ['backup', 'SLD', 'BOM'],
  };
}

function landingItem(d: BackupDomain, units: number): InterviewItem {
  const v = d.storageConnection;
  return {
    id: systemLandingItemId(d.id),
    section: 'behavior',
    question: units > 1 ? `${d.label}: how are its battery AC circuits combined?`
      : `${d.label}: where do its battery AC circuits land?`,
    state: v === 'unresolved' ? 'needs-answer' : 'answered',
    answer: v === 'unresolved' ? undefined : (LANDING_OPTIONS.find(o => o.value === v)?.label ?? v),
    source: v === 'unresolved' ? 'Not established' : 'Installer entered',
    options: LANDING_OPTIONS,
    value: v === 'unresolved' ? null : v,
    why: 'Answered for this system alone; the other systems keep their own answer. Each answer selects a '
      + 'different governing check: a generation panel’s own busbar, the manufacturer’s panelboard limits, '
      + 'or the backed-up panel’s 120% rule.',
    owner: 'Installer',
    blocks: ['busbar check', 'SLD', 'BOM'],
  };
}

/**
 * The questions this module asks, each carrying its own section.
 *
 *  · per system (Equipment): its controller, batteries + count, expansions + count — asked only where
 *    storage exists and a backed-up system has been made.
 *  · per system (Behavior): where its battery AC circuits land — only with more than one system that
 *    holds batteries. The all-systems question stays as the "same for every system" answer.
 */
export function buildSystemEquipmentItems(input: InterviewInput): InterviewItem[] {
  const t = input.topology;
  const storage = input.equipment.storage;
  if (!t || !storage || storage.count <= 0) return [];
  const items: InterviewItem[] = [];
  const single = t.domains.length === 1;
  for (const d of t.domains) items.push(systemEquipmentItem(t, d, single));
  if (storage.backupCapable) {
    const holding = t.domains
      .map(d => ({ d, units: systemEquipmentFacts(t, d).inverting.length }))
      .filter(x => x.units > 0);
    if (holding.length > 1) for (const { d, units } of holding) items.push(landingItem(d, units));
  }
  return items;
}

/** "Whole" / "only some panels" / unanswered, read from the graph. */
export function backupChoiceOf(t: ServiceTopology): 'whole' | 'panels' | null {
  if (t.domains.length === 0) return null;
  const inside = (id: string) => t.domains.some(d => d.backedUpPanelIds.includes(id));
  return t.panels.every(p => p.backedUp && inside(p.id)) ? 'whole' : 'panels';
}

/**
 * Put this module's questions beside the ones they refine, and give "What is backed up?" its
 * per-panel answer.
 *
 * 🚨 THE ONE ADJUSTMENT TO AN EXISTING QUESTION, AND WHY. With more than one panel, "What is backed
 * up, panel by panel?" now also offers "Only the panels I choose" (its question, state and answer
 * are untouched — they already describe a partial backup). The editor for it is this module's, so
 * the battery count of a system has one control (the per-system equipment question), not two.
 */
export function placeSystemEquipmentItems(
  sections: { equipment: InterviewItem[]; behavior: InterviewItem[] },
  items: InterviewItem[],
  input: InterviewInput,
): void {
  const insertAfter = (list: InterviewItem[], anchors: string[], add: InterviewItem[]) => {
    if (add.length === 0) return;
    const at = Math.max(-1, ...anchors.map(a => list.findIndex(i => i.id === a)));
    list.splice(at >= 0 ? at + 1 : list.length, 0, ...add);
  };
  insertAfter(sections.equipment, ['equipment.storage', 'equipment.gateway'], items.filter(i => i.section === 'equipment'));
  insertAfter(sections.behavior, ['behavior.storage-landing'], items.filter(i => i.section === 'behavior'));

  const t = input.topology;
  const backup = sections.behavior.find(i => i.id === 'behavior.backup');
  if (t && backup) {
    const multi = t.panels.length > 1;
    backup.options = [
      { value: 'whole', label: multi ? 'Every panel — whole home' : 'Whole main panel' },
      ...(multi ? [{ value: 'panels', label: 'Only the panels I choose',
        detail: 'Each backed-up panel gets its own system, with the batteries you name for it.' }] : []),
      { value: 'none', label: 'No backup' },
    ];
    backup.value = backupChoiceOf(t);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE ANSWERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * "System 2: which backup controller, batteries and expansion units?"
 *
 * Fields left out keep what the system has. Re-equipped through `setDomainEquipment`, so the units
 * are rebuilt from the catalogue exactly as the inspector's re-equip does — plus three things that
 * writer would otherwise lose:
 *   · the commissioned output setting, kept while the battery product is unchanged;
 *   · the PV recorded on each unit's DC inputs, kept while the batteries themselves are unchanged
 *     (a landing recorded for four units is not a landing for three, so a count change reopens it);
 *   · a system that lands its batteries in its own generation panel gets that panel rebuilt from the
 *     new batteries, so the panel never carries fewer battery circuits than the system has.
 */
export function answerSystemEquipment(
  t: ServiceTopology,
  domainId: string,
  patch: {
    gatewayProductId?: string;
    storageProductId?: string | null;
    storageUnits?: number;
    expansionProductId?: string | null;
    expansionUnits?: number;
  },
): AnswerResult {
  const d = t.domains.find(x => x.id === domainId);
  if (!d) return refuse(`No system '${domainId}'.`);
  const f = systemEquipmentFacts(t, d);
  if (f.mixed && patch.storageProductId === undefined && patch.expansionProductId === undefined) {
    return refuse(`${d.label} has more than one battery or expansion model recorded. Choose the one installed.`);
  }

  const gw = patch.gatewayProductId ?? d.gateway.productId;
  const ess = patch.storageProductId !== undefined ? patch.storageProductId : f.storageProductId;
  const nEss = patch.storageUnits ?? f.inverting.length;
  const exp = patch.expansionProductId !== undefined ? patch.expansionProductId : f.expansionProductId;
  const nExp = patch.expansionUnits ?? f.expansions.length;

  if (![nEss, nExp].every(n => Number.isInteger(n) && n >= 0)) {
    return refuse('A count is a whole number, zero or more.');
  }
  if (nEss > 0 && !ess) return refuse('Choose which battery is installed.');
  // Never rebuilt as "none" because the model could not be read back as one product.
  if (nExp > 0 && !exp) return refuse('Choose which expansion unit is installed.');

  const gwChanged = gw !== d.gateway.productId;
  const essChanged = (ess ?? null) !== f.storageProductId;
  const inverterSetChanged = essChanged || nEss !== f.inverting.length;
  const expChanged = inverterSetChanged || (exp ?? null) !== f.expansionProductId || nExp !== f.expansions.length;
  if (!gwChanged && !expChanged) return refuse(`Nothing to change on ${d.label}.`);

  const essRow = ess ? getBatteryById(ess) : undefined;
  if (ess && essChanged) {
    if (!essRow) return refuse(`${NOT_EVALUATED_MFR} — '${ess}' is not in the equipment catalogue.`);
    if (!isInverterUnit(essRow)) {
      return refuse(`${nameOf(essRow)} is an expansion unit — it extends a battery and cannot be one.`);
    }
    if (!essRow.backupCapable) return refuse(`${nameOf(essRow)} cannot back up loads, so it cannot be a backed-up system’s battery.`);
  }
  const essName = essRow ? nameOf(essRow) : (f.inverting[0]?.label ?? ess ?? 'the battery');

  // The controller and the battery have to be named together by the catalogue whenever either moves.
  if (gwChanged || (essChanged && ess)) {
    if (!ess) return refuse('Which controller fits depends on the batteries — choose them first.');
    const ctl = controllersFor(ess);
    if (!ctl.evaluated) return refuse(ctl.note ?? NOT_EVALUATED_MFR);
    if (!ctl.options.some(o => o.value === gw)) {
      const g = getBackupInterfaceById(gw);
      return refuse(`The catalogue does not list ${g ? nameOf(g) : gw} as compatible with ${essName}. `
        + `Listed: ${ctl.options.map(o => o.label).join(', ')}.`);
    }
  }

  if (nExp > 0 && expChanged) {
    if (!ess) return refuse('An expansion unit extends a battery — choose the battery first.');
    const x = expansionsFor(ess);
    if (!x.options.some(o => o.value === exp)) {
      const row = getBatteryById(exp);
      return refuse(`The catalogue does not list ${row ? nameOf(row) : exp} as an expansion for ${essName}. `
        + (x.evaluated ? `Listed: ${x.options.map(o => o.label).join(', ')}.` : 'Set the expansion units to zero.'));
    }
    if (nExp > nEss) {
      return refuse(`Each expansion unit is harnessed to one battery, so ${plural(nEss, 'battery', 'batteries')} `
        + `can take at most ${nEss}. How many expansions one battery accepts is the manufacturer’s figure: `
        + `${NOT_EVALUATED_MFR}.`);
    }
  }

  const keepConfig = essChanged ? null
    : (f.inverting.find(u => u.outputConfigKw !== undefined && u.outputConfigKw !== null)?.outputConfigKw ?? null);
  const r = setDomainEquipment(t, d.id, {
    gatewayProductId: gw,
    storageProductIds: ess ? Array.from({ length: nEss }, () => ess) : [],
    expansionProductIds: exp && nExp > 0 ? Array.from({ length: nExp }, () => exp) : [],
    outputConfigKw: keepConfig,
  });
  let next = r.topology;

  const notes: string[] = [];
  if (!inverterSetChanged) {
    const rebuilt = systemEquipmentFacts(next, next.domains.find(x => x.id === d.id)!).inverting;
    f.inverting.forEach((u, i) => {
      if (u.pvDcStcKw !== undefined && u.pvDcStcKw !== null && rebuilt[i]) {
        next = setStoragePvInput(next, rebuilt[i].id, u.pvDcStcKw);
      }
    });
  } else if (f.inverting.some(u => u.pvDcStcKw !== undefined && u.pvDcStcKw !== null)) {
    notes.push('which battery receives each PV string must be answered again');
  }
  if (inverterSetChanged && d.storageConnection === 'der-aggregation-panel') {
    const hadProduct = (t.aggregationPanels ?? []).some(a => a.domainId === d.id && !!a.productId);
    next = applyPerSystemGenerationPanels(next, [d.id]).topology;
    notes.push(`its generation panel was rebuilt from the new batteries${hadProduct ? ' — choose its enclosure again' : ''}`);
  }

  const g = getBackupInterfaceById(gw);
  const xRow = exp ? getBatteryById(exp) : undefined;
  const said = [g ? nameOf(g) : gw, `${nEss} × ${essName}`];
  if (nExp > 0) said.push(`${nExp} × ${xRow ? nameOf(xRow) : exp}`);
  return done(next, `${d.label}: ${said.join(' · ')}${notes.length ? ` (${notes.join('; ')})` : ''}`);
}

/** "System 2: where do its battery AC circuits land?" — that system only. */
export function answerSystemLanding(
  t: ServiceTopology,
  domainId: string,
  value: Exclude<BackupDomain['storageConnection'], 'unresolved'>,
): AnswerResult {
  const d = t.domains.find(x => x.id === domainId);
  if (!d) return refuse(`No system '${domainId}'.`);
  const r = answerStorageLanding(t, value, [domainId]);
  return r.ok === false ? r : done(r.topology, `${d.label} battery circuits: ${value}`);
}

export interface BackupEquipment {
  gatewayProductId: string | null;
  storageProductId: string | null;
  /** Every selected unit — used only where there is ONE panel, which can take nothing less. */
  totalUnits?: number;
  /** The batteries the installer named for each panel's NEW system. Missing ⇒ zero, never a share. */
  unitsPerPanel?: Record<string, number>;
}

/**
 * "Only the panels I choose" — the panels named are inside the island, the others are not.
 *
 * A panel joining gets its own system on the service path that feeds it, holding exactly the
 * batteries named for it. A panel leaving is taken out of its system; a system left backing up
 * nothing is removed — unless something else is connected to it (its point of interconnection, its
 * generation panel, an isolation switch in line with its controller), in which case the answer is
 * REFUSED: deleting those is a deliberate edit in Advanced, not a side effect of a checkbox.
 */
export function answerBackedUpPanels(t: ServiceTopology, panelIds: string[], equipment: BackupEquipment): AnswerResult {
  if (t.panels.length < 2) return refuse('This service has one main panel — it is backed up whole or not at all.');
  const unknown = panelIds.find(id => !t.panels.some(p => p.id === id));
  if (unknown) return refuse(`No panel '${unknown}'.`);
  const chosen = new Set(panelIds);
  if (chosen.size === 0) return answerBackupChoice(t, 'none', equipment);

  let next = t;
  for (const p of t.panels.filter(x => !chosen.has(x.id))) {
    for (const d of next.domains.filter(x => x.backedUpPanelIds.includes(p.id))) {
      const rest = d.backedUpPanelIds.filter(x => x !== p.id);
      if (rest.length > 0) { next = updateDomain(next, d.id, { backedUpPanelIds: rest }); continue; }
      const deps = systemDependents(next, d);
      if (deps.length > 0) {
        return refuse(`Taking ${p.label} out of backup removes ${d.label}, and ${deps.join(', ')} `
          + `${deps.length === 1 ? 'is' : 'are'} connected to it. Remove ${d.label} in Advanced, where each piece `
          + 'is edited deliberately.');
      }
      next = removeBackupDomain(next, d.id);
    }
    next = updatePanel(next, p.id, { backedUp: false });
  }

  const joining = t.panels.filter(p => chosen.has(p.id) && !next.domains.some(d => d.backedUpPanelIds.includes(p.id)));
  if (joining.length > 0 && !equipment.gatewayProductId) {
    return refuse('Choose the backup controller / gateway in Equipment first — each backed-up system needs one.');
  }
  for (const p of t.panels.filter(x => chosen.has(x.id))) {
    next = updatePanel(next, p.id, { backedUp: true });
    if (next.domains.some(d => d.backedUpPanelIds.includes(p.id))) continue;
    const branch = next.branches.find(b => (b.panelIds ?? []).includes(p.id))
      ?? next.branches.find(b => !next.domains.some(d => d.branchId === b.id));
    if (!branch) {
      return refuse(`No service path is recorded feeding ${p.label}, so a system for it has nowhere to sit. `
        + 'Answer how the service is distributed first.');
    }
    const units = Math.max(0, Math.floor(equipment.unitsPerPanel?.[p.id] ?? 0));
    next = addBackupDomain(next, {
      branchId: branch.id,
      panelIds: [p.id],
      label: freeSystemLabel(next),
      gatewayProductId: equipment.gatewayProductId as string,
      storageProductIds: equipment.storageProductId
        ? Array.from({ length: units }, () => equipment.storageProductId as string) : [],
    }).topology;
  }
  const backed = next.panels.filter(p => p.backedUp).map(p => p.label);
  return done(next, `Backed up: ${backed.join(', ')}`);
}

/**
 * "Every panel" / "No backup".
 *
 * One panel ⇒ `answerBackup` (the one panel takes every selected unit). More than one ⇒ every panel
 * through `answerBackedUpPanels`, so each new system holds the count named for it and gets a name no
 * other system has. "No backup" is refused while a system has something connected to it, for the
 * same reason a single panel leaving is.
 */
export function answerBackupChoice(
  t: ServiceTopology, choice: 'whole' | 'none', equipment: BackupEquipment,
): AnswerResult {
  if (choice === 'none') {
    const blocked = t.domains.map(d => ({ d, deps: systemDependents(t, d) })).filter(x => x.deps.length > 0);
    if (blocked.length > 0) {
      return refuse(`"No backup" removes every system, and ${blocked.map(x => `${x.d.label} has ${x.deps.join(', ')}`)
        .join('; ')} connected to it. Remove those systems in Advanced, where each piece is edited deliberately.`);
    }
  }
  if (choice === 'whole' && t.panels.length > 1) return answerBackedUpPanels(t, t.panels.map(p => p.id), equipment);
  return answerBackup(t, choice, {
    gatewayProductId: equipment.gatewayProductId,
    storageProductId: equipment.storageProductId,
    totalUnits: equipment.totalUnits ?? 0,
    unitsPerPanel: equipment.unitsPerPanel,
  });
}
