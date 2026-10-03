// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE BATTERY STORAGE CARD — WHAT IT SHOWS, AND THE TWO STORES IT KEEPS IN STEP.
//
// Ray (System Config UX correction V3): "Battery edits in Battery." The card is the home of storage:
// battery model, quantity, expansion packs, the backup controller and how many, how the battery AC
// circuits are combined — and, once the service graph has backup systems, the grouping of those
// batteries into systems ("System 1 · 2 × Powerwall 3 · 1 × Backup Gateway 3").
//
// Two stores hold batteries:
//   · the project selection (`config.batteryId / batteryCount / batteryKwh / backupControllerId`) —
//     the truth until the service graph has a backed-up system;
//   · the service graph (`domains` + `storage`) — the truth from then on. Every edit is an answer
//     through `systemConfigSystemEquipment.ts`, and after each graph write the page mirrors the
//     selection FROM the graph (`batteryConfigMirror`) — while Battery Storage is ON.
//
// 🚨 THE CONTROLLER IS NEVER `config.backupInterfaceId`. That field is the LEGACY backup-interface
// unit: computeSystem draws a BUI → MSP backfeed feeder and a BUI-1 schedule row from it, the BOM
// prices a "Backup Interface Unit" line, and the SLD request carries it. A battery that needs a
// gateway already names it there (GW-n), and the graph's gateways reach the BOM from the graph — so
// the controller chosen here lives in `backupControllerId`, read only by the interview and the graph
// builder (a new system's controller). Writing it into `backupInterfaceId` put Ray's Gateway 3 on the
// schedule twice and a 250 A #4/0 feeder on the drawing that does not exist on site.
//
// 🚨 NOTHING HERE SPLITS BATTERIES. With more than one system the total is read from the systems; a
// change of count is asked per system. "Same model / controller on every system" keeps each system's
// own count. No brand name appears in this file; what fits is the catalogue's.
//
// Pure: no React, no fetch. The page persists through its one write path.
// ═══════════════════════════════════════════════════════════════════════════

import { getBatteryById, getBackupInterfaceById } from '@/lib/equipment-db';
import type { ServiceTopology, BackupDomain } from '@/lib/electrical/serviceTopology';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import {
  answerSystemEquipment, controllersFor, selectionPairOf, systemEquipmentFacts,
} from '@/lib/electrical/systemConfigSystemEquipment';

/** The selection fields the card reads and the mirror writes — a slice of the page's ProjectConfig. */
export interface BatterySelection {
  batteryId: string;
  batteryCount: number;
  /** LEGACY PER-UNIT kWh (the page multiplies by batteryCount for totals). */
  batteryKwh: number;
  batteryBrand?: string;
  batteryModel?: string;
  /** The backup controller / gateway chosen with the battery — read by the interview and the graph builder only. */
  backupControllerId?: string;
  /** LEGACY backup-interface unit (BUI feeder, BUI-1, BOM line). Never written here except cleared when OFF. */
  backupInterfaceId?: string;
}

/** A catalogue row's model name for a compact line; the recorded label / id only when the row is unknown. */
const batteryModelName = (id: string, fallback?: string | null) => getBatteryById(id)?.model ?? fallback ?? id;
const controllerModelName = (id: string, fallback?: string | null) => getBackupInterfaceById(id)?.model ?? fallback ?? id;

// ═══════════════════════════════════════════════════════════════════════════
// WHAT THE GRAPH SAYS IS INSTALLED
// ═══════════════════════════════════════════════════════════════════════════

export interface BatterySystemSummary {
  domainId: string;
  label: string;
  /** "System 1 · 2 × Powerwall 3 · 1 × Backup Gateway 3" */
  line: string;
  batteries: number;
  expansions: number;
  /** The one battery product in the system; null ⇒ none recorded, or more than one model. */
  storageProductId: string | null;
  expansionProductId: string | null;
  gatewayProductId: string;
  mixed: boolean;
}

export interface BatteryGrouping {
  systems: BatterySystemSummary[];
  /** Inverter-class batteries across every system. */
  batteries: number;
  /** DC expansion units across every system — energy, never AC current. */
  expansions: number;
  /** One backup controller per system. */
  controllers: number;
  /** Σ catalogue usable kWh of every battery and expansion; null ⇒ a unit is not in the catalogue. */
  usableKwh: number | null;
  /** The battery every system holding batteries uses; null ⇒ none recorded, or they differ. */
  commonStorageProductId: string | null;
  /** The controller every system uses; null ⇒ they differ. */
  commonGatewayProductId: string | null;
  commonExpansionProductId: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One system in one line: its batteries, its expansion units and its controller. */
export function systemLineOf(t: ServiceTopology, d: BackupDomain): string {
  const f = systemEquipmentFacts(t, d);
  const parts = [d.label];
  if (f.inverting.length === 0) parts.push('no batteries recorded');
  else if (f.mixed) {
    const byProduct = new Map<string, number>();
    for (const u of f.inverting) byProduct.set(u.productId, (byProduct.get(u.productId) ?? 0) + 1);
    for (const [id, n] of byProduct) parts.push(`${n} × ${batteryModelName(id)}`);
  } else {
    parts.push(`${f.inverting.length} × ${batteryModelName(f.storageProductId!, f.inverting[0]?.label)}`);
  }
  if (f.expansions.length > 0) {
    parts.push(`${f.expansions.length} × ${f.expansionProductId
      ? batteryModelName(f.expansionProductId, f.expansions[0]?.label) : 'expansion unit'}`);
  }
  parts.push(`1 × ${controllerModelName(d.gateway.productId, d.gateway.label)}`);
  return parts.join(' · ');
}

/** The graph's batteries grouped by backup system. Null ⇒ the graph has no backup system yet. */
export function batteryGroupingOf(t: ServiceTopology | null | undefined): BatteryGrouping | null {
  if (!t || t.domains.length === 0) return null;
  const systems = t.domains.map((d): BatterySystemSummary => {
    const f = systemEquipmentFacts(t, d);
    return {
      domainId: d.id, label: d.label, line: systemLineOf(t, d),
      batteries: f.inverting.length, expansions: f.expansions.length,
      storageProductId: f.storageProductId, expansionProductId: f.expansionProductId,
      gatewayProductId: d.gateway.productId, mixed: f.mixed,
    };
  });
  const units = t.domains.flatMap(d => {
    const f = systemEquipmentFacts(t, d);
    return [...f.inverting, ...f.expansions];
  });
  let usableKwh: number | null = 0;
  for (const u of units) {
    const row = getBatteryById(u.productId);
    if (!row) { usableKwh = null; break; }
    usableKwh += row.usableCapacityKwh;
  }
  const one = <T>(xs: T[]): T | null => (xs.length > 0 && xs.every(x => x === xs[0]) ? xs[0] : null);
  const holding = systems.filter(s => s.batteries > 0);
  return {
    systems,
    batteries: systems.reduce((s, x) => s + x.batteries, 0),
    expansions: systems.reduce((s, x) => s + x.expansions, 0),
    controllers: systems.length,
    usableKwh,
    commonStorageProductId: holding.some(s => s.mixed) ? null : one(holding.map(s => s.storageProductId)),
    commonGatewayProductId: one(systems.map(s => s.gatewayProductId)),
    commonExpansionProductId: one(systems.filter(s => s.expansions > 0).map(s => s.expansionProductId)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE ANSWER FOR EVERY SYSTEM — THE MODEL AND THE CONTROLLER, NEVER THE COUNT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * "Battery model" / "Backup controller" asked once with more than one system: the same product on
 * every system, each system keeping ITS OWN battery and expansion counts. Each system is re-equipped
 * through `answerSystemEquipment` — so every refusal it has (an unlisted controller / battery
 * pairing, an expansion the new battery does not take, batteries on a panel the other systems share)
 * refuses the whole answer, and nothing is written halfway.
 */
export function answerEverySystemEquipment(
  t: ServiceTopology,
  patch: { gatewayProductId?: string; storageProductId?: string },
): AnswerResult {
  if (t.domains.length === 0) return { ok: false, refused: 'There is no backed-up system to answer this for.' };
  const installed = patch.storageProductId ?? batteryGroupingOf(t)?.commonStorageProductId ?? null;
  let next = t;
  const did: string[] = [];
  for (const d0 of t.domains) {
    const d = next.domains.find(x => x.id === d0.id)!;
    const f = systemEquipmentFacts(next, d);
    const holding = f.inverting.length > 0;
    const p: Parameters<typeof answerSystemEquipment>[2] = {};
    if (patch.gatewayProductId && patch.gatewayProductId !== d.gateway.productId) {
      p.gatewayProductId = patch.gatewayProductId;
      // A system holding no battery yet is still checked against the battery being installed (its
      // count stays the zero it is) — the writer refuses an unlisted pairing in its own words.
      if (!holding && installed) p.storageProductId = installed;
    }
    // A system holding no battery has no battery to change.
    if (patch.storageProductId && holding
      && (f.mixed || patch.storageProductId !== f.storageProductId)) p.storageProductId = patch.storageProductId;
    if (Object.keys(p).length === 0) continue;
    const r = answerSystemEquipment(next, d.id, p);
    if (r.ok === false) return r;
    next = r.topology;
    did.push(r.did);
  }
  if (did.length === 0) {
    const empty = t.domains.every(d => systemEquipmentFacts(t, d).inverting.length === 0);
    return { ok: false, refused: empty && patch.storageProductId && !patch.gatewayProductId
      ? 'No system holds a battery yet — how many each system holds is set for that system, never shared out.'
      : 'Every system already has that equipment.' };
  }
  return { ok: true, topology: next, did: did.join('; ') };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SELECTION BEFORE THE GRAPH HAS SYSTEMS
// ═══════════════════════════════════════════════════════════════════════════

/** The catalogue says this battery needs a backup controller / gateway with it. */
export function batteryNeedsController(batteryId: string | null | undefined): boolean {
  return !!batteryId && !!getBatteryById(batteryId)?.requiresGateway;
}

/**
 * The controller kept when the battery changes: the one recorded, only while the catalogue lists
 * the two together. Otherwise none — the installer chooses again from what fits. Never a pick.
 */
export function controllerAfterBatteryChange(batteryId: string, controllerId: string | null | undefined): string {
  if (!controllerId) return '';
  return controllersFor(batteryId || null).options.some(o => o.value === controllerId) ? controllerId : '';
}

/**
 * What the Battery Model picker writes into the selection: the catalogue's brand, model and per-unit
 * kWh, a seeded count (so the sizing apply path keeps it — "battery units snaps back to 1"), and the
 * controller dropped when the catalogue does not list it with the new battery.
 */
export function selectionAfterBatteryChange(batteryId: string, current: BatterySelection): Partial<BatterySelection> {
  const row = getBatteryById(batteryId);
  const recorded = current.backupControllerId ?? '';
  const keep = controllerAfterBatteryChange(batteryId, recorded);
  return {
    batteryId,
    batteryBrand: row?.manufacturer ?? '',
    batteryModel: row?.model ?? '',
    batteryKwh: row?.usableCapacityKwh ?? 0,
    // Seed a unit count so the battery is "user-owned" and the sizing apply path preserves it
    // instead of reverting to the engine's default of 1. Picking "None" clears the count. (The
    // preserve guard in applySizingRecommendation requires a non-zero count.)
    batteryCount: batteryId ? (current.batteryCount && current.batteryCount > 0 ? current.batteryCount : 1) : 0,
    ...(keep !== recorded ? { backupControllerId: keep } : {}),
  };
}

/**
 * 🚨 THE CONTROLLER THE SELECTION RECORDS FOR ITS BATTERY — READ, NOT TRUSTED.
 *
 * The card's own picker drops a controller the catalogue does not list with a new battery, but it is
 * not the only writer of `batteryId`: the ecosystem picker and the sizing adoption change the
 * battery and leave the controller alone. So the controller is read through the catalogue every
 * time: a controller the catalogue says does NOT fit the recorded battery is not a recorded
 * controller (`id` null — the interview asks again, and no new system is built from it); `unlisted`
 * names it so the card can say why. A battery the catalogue carries no controller fact for keeps
 * what is recorded (its own question says NOT EVALUATED). No battery ⇒ no controller to pair.
 *
 * `backupInterfaceId` is read only as the fallback for a project recorded before
 * `backupControllerId` existed — never written.
 */
export function selectionControllerOf(
  sel: Pick<BatterySelection, 'batteryId' | 'backupControllerId' | 'backupInterfaceId'>,
): { id: string | null; unlisted: string | null } {
  const recorded = sel.backupControllerId || sel.backupInterfaceId || '';
  if (!recorded || !sel.batteryId) return { id: null, unlisted: null };
  const ctl = controllersFor(sel.batteryId);
  if (ctl.evaluated && !ctl.options.some(o => o.value === recorded)) return { id: null, unlisted: recorded };
  return { id: recorded, unlisted: null };
}

/**
 * Battery Storage OFF clears the battery from the selection — the controller with it. Without the
 * controller here a project with no battery kept "Backup Gateway 3" and a new system would be built
 * around it; the legacy `backupInterfaceId` is cleared too, so no BUI feeder, BUI-1 row or BOM line
 * survives a battery the installer removed.
 */
export function batteryOffPatch(): Required<Pick<BatterySelection,
  'batteryId' | 'batteryCount' | 'batteryKwh' | 'batteryBrand' | 'batteryModel' | 'backupControllerId' | 'backupInterfaceId'>> {
  return {
    batteryId: '', batteryCount: 0, batteryKwh: 0, batteryBrand: '', batteryModel: '',
    backupControllerId: '', backupInterfaceId: '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE STORAGE FIGURE — THE CARD AND THE FLOW BAR READ THE SAME TOTAL
// ═══════════════════════════════════════════════════════════════════════════

/** Does any backed-up system in the graph hold a battery? */
export const graphHoldsBatteries = (t: ServiceTopology | null | undefined): boolean =>
  !!t && t.domains.length > 0 && t.storage.some(u => u.role === 'inverter-unit');

/**
 * The usable kWh the page states for storage. Once the graph has backup systems it is the graph's —
 * every battery AND every expansion pack, from the catalogue — never the selection's count × per-unit
 * kWh, which knows nothing of expansions (one Powerwall 3 + one expansion per system is 54 kWh, not
 * 27). Before the graph has systems, the selection's.
 */
export function storageTotalKwh(
  t: ServiceTopology | null | undefined,
  sel: Pick<BatterySelection, 'batteryCount' | 'batteryKwh'>,
): number {
  const g = batteryGroupingOf(t);
  if (g) return g.usableKwh ?? 0;
  return (Number(sel.batteryCount) || 0) * (Number(sel.batteryKwh) || 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE MIRROR — THE SELECTION FOLLOWS THE GRAPH AFTER EVERY GRAPH WRITE, WHILE THE BATTERY IS ON.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What the project selection must become so it says what the graph says. Called by the page's
 * interview write handler after each successful graph write; empty ⇒ nothing to change.
 *
 *  · Battery Storage OFF ⇒ nothing. OFF cleared the selection; the graph may still hold its units
 *    (OFF does not edit the service record), and mirroring them back is the v63 phantom battery —
 *    the toggle reads OFF while the SLD and permit inputs get four Powerwalls again, and the next
 *    reload turns the toggle back ON.
 *  · No backup system in the graph ⇒ nothing: the selection is still the truth.
 *  · Systems but no battery recorded in any ⇒ nothing. The graph cannot tell "zero chosen" from
 *    "not asked yet" — each empty system's own question asks for its count — so a graph with no
 *    battery is an OPEN question, never "no battery on the project". The Battery card never records
 *    one: an edit that would leave every system empty is refused there.
 *  · Otherwise: the count is every inverter-class battery in the graph; the battery and the
 *    controller are the pair the next new system would be built from (`selectionPairOf` — one
 *    system, never two halves); a change of battery brings its catalogue brand, model and per-unit
 *    kWh, exactly as the card's own Battery Model picker does. The controller goes to
 *    `backupControllerId` — NEVER the legacy `backupInterfaceId` (see the header).
 */
export function batteryConfigMirror(
  next: ServiceTopology | null | undefined,
  current: Pick<BatterySelection, 'batteryId' | 'batteryCount'> & Partial<BatterySelection>,
  opts: { batteryEnabled: boolean },
): Partial<BatterySelection> {
  if (!opts.batteryEnabled) return {};
  if (!next || next.domains.length === 0) return {};
  const inverting = next.storage.filter(u => u.role === 'inverter-unit');
  if (inverting.length === 0) return {};
  const pair = selectionPairOf(next);
  const patch: Partial<BatterySelection> = {};
  if (inverting.length !== current.batteryCount) patch.batteryCount = inverting.length;
  const batteryId = pair.unit?.productId ?? null;
  if (batteryId && batteryId !== current.batteryId) {
    const row = getBatteryById(batteryId);
    patch.batteryId = batteryId;
    if (row) {
      patch.batteryBrand = row.manufacturer;
      patch.batteryModel = row.model;
      patch.batteryKwh = row.usableCapacityKwh;
    }
  }
  const gatewayId = pair.gateway?.productId ?? null;
  if (gatewayId && gatewayId !== (current.backupControllerId ?? '')) patch.backupControllerId = gatewayId;
  return patch;
}

/** "4 batteries" / "1 battery" — the card's words. */
export const batteriesInWords = (n: number) => plural(n, 'battery', 'batteries');
