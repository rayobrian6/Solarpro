// ═══════════════════════════════════════════════════════════════
// Per-subsystem FLEET helpers — Wave 3 of
// docs/ARCHITECTURE-per-subsystem-equipment.md (FROZEN CONTRACT v1.0).
//
// A "fleet" = the subset of config.inverters belonging to ONE SubSystemKey
// (tag = derived cache per §1.1; an untagged inverter belongs to the caller's
// fallback key — the §1.5 inherit chain, never a bare 'roof' default).
//
// These are the primitives every Wave-3 page watcher uses to write into ONE
// sub's fleet only (I-4: a fence CAD edit can never nuke roof engineering):
//
//   • inverterFleetKey / partitionFleet / fleetKeys / fleetPanelTotal
//   • stampFleet     — tag a rebuilt fleet (inverters + strings) with its key
//   • replaceSubFleet — swap ONE sub's fleet in place, all others untouched
//
// Pure, dependency-free (only the Wave-1a contract module). Safe for client
// and server bundles.
// ═══════════════════════════════════════════════════════════════

import {
  SUB_SYSTEM_KEYS,
  isSubSystemKey,
  type SubSystemKey,
} from './subSystemEquipment';

/** Structural inverter shape — page InverterConfig and raw DB payloads both satisfy it. */
export interface FleetInverterLike {
  id?: string;
  subSystemKey?: SubSystemKey;
  inverterId?: string;
  type?: string;
  strings?: Array<{
    panelCount?: number;
    subSystemKey?: SubSystemKey;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

/** The key an inverter belongs to: its tag, else the caller's inherit-chain fallback. */
export function inverterFleetKey(
  inv: FleetInverterLike | null | undefined,
  fallbackKey: SubSystemKey,
): SubSystemKey {
  return isSubSystemKey(inv?.subSystemKey) ? inv!.subSystemKey! : fallbackKey;
}

/** Partition inverters into per-sub fleets (original array order preserved inside each fleet). */
export function partitionFleet<T extends FleetInverterLike>(
  inverters: readonly T[] | null | undefined,
  fallbackKey: SubSystemKey,
): Partial<Record<SubSystemKey, T[]>> {
  const out: Partial<Record<SubSystemKey, T[]>> = {};
  for (const inv of inverters ?? []) {
    const key = inverterFleetKey(inv, fallbackKey);
    (out[key] ??= []).push(inv);
  }
  return out;
}

/** Present fleet keys in the fixed contract order roof > ground > fence (§1.4). */
export function fleetKeys(
  inverters: readonly FleetInverterLike[] | null | undefined,
  fallbackKey: SubSystemKey,
): SubSystemKey[] {
  const part = partitionFleet(inverters, fallbackKey);
  return SUB_SYSTEM_KEYS.filter(k => (part[k]?.length ?? 0) > 0);
}

/** Σ panelCount across a fleet's strings. */
export function fleetPanelTotal(inverters: readonly FleetInverterLike[] | null | undefined): number {
  let total = 0;
  for (const inv of inverters ?? []) {
    for (const s of inv?.strings ?? []) total += s?.panelCount ?? 0;
  }
  return total;
}

/**
 * Tag every inverter (and its strings) in a rebuilt fleet with its sub key.
 * OVERWRITES existing tags — used exactly when a watcher has rebuilt this
 * fleet FOR this sub, so the tag is authoritative by construction. Pure.
 */
export function stampFleet<T extends FleetInverterLike>(
  inverters: readonly T[],
  key: SubSystemKey,
): T[] {
  return inverters.map(inv => ({
    ...inv,
    subSystemKey: key,
    ...(Array.isArray(inv.strings)
      ? { strings: inv.strings.map(s => ({ ...s, subSystemKey: key })) }
      : {}),
  }));
}

/**
 * Replace ONE sub's fleet inside the full inverter array (I-4 write scope):
 * the replacement (stamped with `key`) lands at the position of the first
 * inverter it replaces — or is appended when the sub had no fleet yet.
 * Every other sub's inverters are the SAME object references, untouched.
 */
export function replaceSubFleet<T extends FleetInverterLike>(
  inverters: readonly T[] | null | undefined,
  key: SubSystemKey,
  replacement: readonly T[],
  fallbackKey: SubSystemKey,
): T[] {
  const stamped = stampFleet(replacement, key);
  const src = inverters ?? [];
  const out: T[] = [];
  let inserted = false;
  for (const inv of src) {
    if (inverterFleetKey(inv, fallbackKey) === key) {
      if (!inserted) {
        out.push(...stamped);
        inserted = true;
      }
      // subsequent members of the old fleet are dropped (replaced)
    } else {
      out.push(inv);
    }
  }
  if (!inserted) out.push(...stamped);
  return out;
}
