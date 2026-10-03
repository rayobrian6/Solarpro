// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE BATTERY STORAGE CARD — WHAT IT SHOWS, AND THE TWO STORES IT KEEPS IN STEP.
//
// Ray (System Config UX correction V3): "Battery edits in Battery." The card is the home of storage:
// battery model, quantity, expansion packs, the backup controller and how many, how the battery AC
// circuits are combined — and, once the service graph has backup systems, the grouping of those
// batteries into systems ("System 1 · 2 × Powerwall 3 · 1 × Backup Gateway 3").
//
// Two stores hold batteries:
//   · the project selection (`config.batteryId / batteryCount / batteryKwh / backupInterfaceId`) —
//     the truth until the service graph has a backed-up system;
//   · the service graph (`domains` + `storage`) — the truth from then on. Every edit is an answer
//     through `systemConfigSystemEquipment.ts`, and after each graph write the page mirrors the
//     selection FROM the graph (`batteryConfigMirror`) so the two never disagree.
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

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE MIRROR — THE SELECTION FOLLOWS THE GRAPH AFTER EVERY GRAPH WRITE.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What the project selection must become so it says what the graph says. Called by the page's
 * interview write handler after each successful graph write; empty ⇒ nothing to change.
 *
 *  · No backup system in the graph ⇒ nothing: the selection is still the truth.
 *  · Systems but no battery recorded in any ⇒ nothing: a system awaiting its count is not "zero
 *    batteries on the project" (the per-system question asks for it).
 *  · Otherwise: the count is every inverter-class battery in the graph; the battery and the
 *    controller are the pair the next new system would be built from (`selectionPairOf` — one
 *    system, never two halves); a change of battery brings its catalogue brand, model and per-unit
 *    kWh, exactly as the card's own Battery Model picker does.
 */
export function batteryConfigMirror(
  next: ServiceTopology | null | undefined,
  current: Pick<BatterySelection, 'batteryId' | 'batteryCount'> & Partial<BatterySelection>,
): Partial<BatterySelection> {
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
  if (gatewayId && gatewayId !== (current.backupInterfaceId ?? '')) patch.backupInterfaceId = gatewayId;
  return patch;
}

/** "4 batteries" / "1 battery" — the card's words. */
export const batteriesInWords = (n: number) => plural(n, 'battery', 'batteries');
