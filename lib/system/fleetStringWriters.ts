// ═══════════════════════════════════════════════════════════════════════════
// 🚨 WHAT A FLEET WRITER MAY PUT IN `config.inverters[*].strings` — AND WHEN IT MAY PUT NOTHING.
//
// Closure brief §2/§3: "physical modules known ≠ string architecture known", and ONE string engine.
// Every page writer that (re)builds a fleet's strings for a module count goes through `fleetUnitsFor`
// (or its two thin views below), so the rule is testable without mounting the page:
//
//   · a chosen PV inverter is strung by the one string engine (`canonicalStringPartition`), across
//     as many units of it as the array needs — one fleet entry per unit;
//   · a catalogued micro carries its modules on ONE entry (devices and AC branches, never DC strings);
//   · nothing for the strings to land on ⇒ null: the caller writes NO entry;
//   · a chosen inverter the engine cannot string (INFEASIBLE, or a module fact not established) ⇒
//     null with the engine's reason: NO partition. It used to write the whole array as one string
//     (`[moduleCount]`), which the runtime guard then "repaired" from defaulted facts, dropping modules
//     (review finding: SMA SB 7.7 → 10 / 9, 19 of 37 modules).
//
// `sizeSystemFromBrand` is no longer a string writer here: it sized an inverter-less fleet from
// `selectedBrand` ("FIX 2"), fell back to a 14-cap even split, and — for a chosen inverter — drew its
// own partition that disagreed with the engine on 41 of 48 catalogued inverters (review probe).
//
// Pure: catalogue lookups and the engine only.
// ═══════════════════════════════════════════════════════════════════════════

import {
  canonicalStringPartition, resolveStringEndpoint, stringModuleFacts,
} from '@/lib/electrical/canonicalStrings';
import {
  buildInverterConfig, buildStringConfig, type BuildStringOptions, type InverterConfig,
} from './buildInverterConfig';
import type { SubSystemKey } from './subSystemEquipment';

export interface WriterPanel {
  voc?: number; vmp?: number; isc?: number; imp?: number; watts?: number;
  tempCoeffVoc?: number; tempCoeffVmp?: number; maxSeriesFuseRating?: number;
}

export type FleetUnits =
  | { units: number[][]; reason: null }
  | { units: null; reason: string; kind: 'no-endpoint' | 'not-engineered' };

/**
 * THE strings for a fleet built for `inverterId` over `moduleCount` modules, one array per physical
 * unit — or null with the reason there are none (the caller writes no entry and no partition).
 */
export function fleetUnitsFor(args: {
  inverterId: string | null | undefined;
  inverterType: string | null | undefined;
  optimizerPeripheralId?: string | null;
  moduleCount: number;
  panel: WriterPanel | null | undefined;
  designTempMin: number;
}): FleetUnits {
  if (!(args.moduleCount > 0)) {
    return { units: null, kind: 'not-engineered', reason: 'The module count is not established — Design places the modules.' };
  }
  const endpoint = resolveStringEndpoint({
    inverterId: args.inverterId, inverterType: args.inverterType, optimizerPeripheralId: args.optimizerPeripheralId,
  });
  if (endpoint.kind === 'none') return { units: null, kind: 'no-endpoint', reason: endpoint.reason };
  if (endpoint.kind === 'microinverter') return { units: [[args.moduleCount]], reason: null };
  const r = canonicalStringPartition({
    moduleCount: args.moduleCount, module: stringModuleFacts(args.panel), endpoint, designTempMin: args.designTempMin,
  });
  if (r.status === 'ENGINEERED') return { units: r.perUnit, reason: null };
  return { units: null, kind: 'not-engineered', reason: r.reason };
}

/**
 * The fleet entries `fleetUnitsFor` describes — one `InverterConfig` per physical unit, built by the
 * central builders — or null with the reason no entry may be written (the caller writes none, and for
 * an explicit installer action shows the reason). Every page writer that creates a fleet for a chosen
 * inverter goes through this.
 */
export function canonicalFleetEntries(args: {
  inverterId: string | null | undefined;
  inverterType: InverterConfig['type'];
  optimizerPeripheralId?: string | null;
  moduleCount: number;
  panel: WriterPanel | null | undefined;
  designTempMin: number;
  /** Per-string fields every string carries (panel, wiring, mounting). */
  stringFields?: Omit<BuildStringOptions, 'index' | 'panelCount' | 'existingId' | 'label'>;
  /** Entry ids to keep, unit by unit; new units get `${idPrefix}-u<n>`. */
  existingIds?: ReadonlyArray<string | undefined>;
  idPrefix?: string;
  deviceRatioOverride?: number;
  subSystemKey?: SubSystemKey;
}): { entries: InverterConfig[]; reason: null } | { entries: null; reason: string; kind: 'no-endpoint' | 'not-engineered' } {
  const r = fleetUnitsFor(args);
  if ('kind' in r) return { entries: null, reason: r.reason, kind: r.kind };
  const prefix = args.idPrefix ?? `inv-${Date.now()}`;
  const entries = r.units.map((counts, u) => buildInverterConfig({
    existingId: args.existingIds?.[u] ?? `${prefix}-u${u}`,
    inverterId: String(args.inverterId),
    type: args.inverterType,
    strings: counts.map((panelCount, i) => buildStringConfig({
      ...(args.stringFields ?? {}),
      index: i,
      existingId: `${prefix}-u${u}-s${i}`,
      panelCount,
      ...(args.subSystemKey ? { subSystemKey: args.subSystemKey } : {}),
    })),
    ...(args.optimizerPeripheralId ? { optimizerPeripheralId: args.optimizerPeripheralId } : {}),
    ...(args.deviceRatioOverride !== undefined ? { deviceRatioOverride: args.deviceRatioOverride } : {}),
    ...(args.subSystemKey ? { subSystemKey: args.subSystemKey } : {}),
  }));
  return { entries, reason: null };
}

/**
 * Flat view of `fleetUnitsFor` (every unit's strings, unit 0's first) — or null when no partition may
 * be written. Never `[moduleCount]` for a PV inverter.
 */
export function entryStringsFor(args: {
  inverterId: string | null | undefined;
  inverterType: string | null | undefined;
  optimizerPeripheralId?: string | null;
  moduleCount: number;
  panel: WriterPanel | null | undefined;
  designTempMin: number;
}): number[] | null {
  const r = fleetUnitsFor(args);
  return r.units ? r.units.flat() : null;
}

/**
 * Re-sized strings (with the physical unit each belongs to) for an existing non-micro fleet whose
 * Design count changed — from the fleet's OWN chosen inverter through the one string engine, or null
 * (keep the fleet as it is). Every string of the result is inside the inverter's published window and
 * together they cover exactly `moduleCount` modules (the engine's own gate).
 *
 * `systemType` and `selectedBrand` are accepted only so callers' signatures stay unchanged: a brand is
 * not equipment, and it never sizes an inverter-less fleet.
 */
export function resizeFleetStrings(args: {
  inverter: { inverterId?: string | null; type?: string | null; optimizerPeripheralId?: string | null } | null | undefined;
  moduleCount: number;
  systemType?: string;
  panel: WriterPanel | null | undefined;
  designTempMin: number;
  selectedBrand?: string;
}): Array<{ panelCount: number; inverterIndex: number }> | null {
  const inv = args.inverter;
  if (!inv || inv.type === 'micro') return null;
  const r = fleetUnitsFor({
    inverterId: inv.inverterId, inverterType: inv.type, optimizerPeripheralId: inv.optimizerPeripheralId,
    moduleCount: args.moduleCount, panel: args.panel, designTempMin: args.designTempMin,
  });
  if (!r.units) return null;
  return r.units.flatMap((ss, u) => ss.map(panelCount => ({ panelCount, inverterIndex: u })));
}
