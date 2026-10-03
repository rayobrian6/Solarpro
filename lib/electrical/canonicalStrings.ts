// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE STRING ENGINE: DESIGN MODULES + MODULE FACTS + RECEIVING EQUIPMENT + MANUFACTURER LIMITS
//    + CLIMATE → THE STRING ASSIGNMENT. AND WITHOUT RECEIVING EQUIPMENT, NO ASSIGNMENT AT ALL.
//
// Ray (closure brief §2/§3): "physical modules known ≠ string architecture known. Before a valid
// receiving endpoint exists: module count = known; string assignment = UNRESOLVED / NOT ENGINEERED.
// … No UI component gets to make a convenience split."
//
// Found in the browser on a fresh 37 × 440 W project with no PV inverter and no storage: the
// Inverters & Strings card read "String Inverter · 37 panels · 16.28 kW DC · 2 strings (20/17)". The
// chain (production page, console-traced): Smart Defaults fired on the factory fleet before the
// project loaded → the sync-pipeline PANEL COUNT FIX, holding that stale fleet, wrote ONE 37-module
// string onto the loaded inverter-less entry → the v61.6 runtime guard handed it to
// `electricallyNormalizeInverterConfig`, which, finding no brand profile for an empty inverter id,
// split it at its "conservative" 20 → 20 / 17. Autosave stored it.
//
// This module is the one answer to "how are these modules strung?":
//   · `resolveStringEndpoint` — WHAT the strings land on: a catalogued PV inverter's MPPTs, a
//     battery's own published PV inputs (DC coupled), module-level microinverters (no DC strings at
//     all), or NOTHING — in which case the answer is UNRESOLVED and no partition exists anywhere.
//   · `canonicalStringPartition` — the partition, from `generateStringConfig` (the NEC 690.7 owner
//     both SLD routes, the plan set and the page's sizing readout already use) against the
//     endpoint's PUBLISHED window, then checked string by string against that window. It never
//     returns a string that breaks a published limit: when the engine's own layout does, it looks for
//     a valid one of the same length-first style, and when none exists it says so.
//
// Pure and isomorphic: catalogue lookups only, no React, no database.
// ═══════════════════════════════════════════════════════════════════════════

import {
  generateStringConfig, inverterSpecsFromRegistry, moduleSpecsFromRegistry, stringSizingBounds,
} from '@/lib/string-generator';
import { getInverterById, getMicroinverterById } from '@/lib/equipment-db';
import type { DcStringLimits } from '@/lib/electrical/dcStringLimits';

/** What the card says while nothing is chosen for the strings to land on. */
export const STRINGING_PENDING = 'Stringing pending equipment selection';

/** Why there is no string assignment on a project with modules and no receiving equipment. */
export const NO_ENDPOINT_REASON =
  'No PV inverter or other DC receiving equipment is chosen, so there is nothing for the strings to '
  + 'land on. The module count is Design\'s; the string assignment follows once the equipment is chosen.';

/** The published DC window of whatever the strings land on. Per unit for voltages; MPPTs add up. */
export interface DcWindow {
  maxDcVoltage: number;
  mpptVoltageMin: number;
  mpptVoltageMax: number;
  /** Independent MPPT inputs available to the array (every receiving unit's, summed). */
  mpptChannels: number;
  /** Max operating (Imp) current per MPPT, where published. */
  maxImpPerMpptA?: number | null;
  /** Max short-circuit current per MPPT, where published. */
  maxIscPerMpptA?: number | null;
  maxParallelStringsPerMppt?: number | null;
  /** Optimizer brand ceiling (string length), where published. */
  maxPanelsPerString?: number | null;
  nominalDcVoltage?: number | null;
  acOutputKw?: number | null;
  /** Where these numbers come from. */
  basis: string;
}

export type StringEndpoint =
  | { kind: 'pv-inverter'; inverterId: string; label: string; topology: 'string' | 'optimizer'; window: DcWindow }
  | { kind: 'storage-dc-input'; label: string; unitCount: number; window: DcWindow }
  | { kind: 'microinverter'; inverterId: string | null; label: string | null }
  | { kind: 'none'; reason: string };

export interface StringModuleFacts {
  voc: number; vmp: number; isc: number; imp: number; watts: number;
  tempCoeffVoc: number; tempCoeffVmp?: number | null; maxSeriesFuseRating?: number | null;
}

/** One string, measured against the window it lands on. */
export interface StringCheck {
  modules: number;
  /** Σ Voc at the design low (NEC 690.7(A)), V. */
  coldVoc: number;
  /** Σ Vmp at the engine's hot-cell basis, V — the MPPT lower bound. */
  hotVmp: number;
}

export type CanonicalStrings =
  | {
    status: 'ENGINEERED';
    strings: number[];
    endpoint: Exclude<StringEndpoint, { kind: 'none' } | { kind: 'microinverter' }>;
    checks: StringCheck[];
    bounds: { minPanelsPerString: number; maxPanelsPerString: number; vocCorrected: number; vmpHot: number };
    /** True when the engine's own layout broke a published limit and a valid one replaced it. */
    adjustedForValidity: boolean;
  }
  | { status: 'UNRESOLVED'; reason: string }
  | { status: 'NOT_APPLICABLE'; reason: string }
  | { status: 'INFEASIBLE'; reason: string; violations: string[] };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A catalogued PV inverter's own window. */
function inverterWindow(inv: NonNullable<ReturnType<typeof getInverterById>>): DcWindow {
  return {
    maxDcVoltage: inv.maxDcVoltage,
    mpptVoltageMin: inv.mpptVoltageMin,
    mpptVoltageMax: inv.mpptVoltageMax,
    mpptChannels: inv.mpptChannels,
    maxImpPerMpptA: num(inv.maxInputCurrentPerMppt),
    maxIscPerMpptA: num((inv as { maxShortCircuitCurrent?: number }).maxShortCircuitCurrent),
    maxParallelStringsPerMppt: num(inv.maxParallelStringsPerMppt),
    maxPanelsPerString: num((inv as { maxPanelsPerString?: number }).maxPanelsPerString),
    nominalDcVoltage: num(inv.nominalDcVoltage),
    acOutputKw: num(inv.acOutputKw),
    basis: `${inv.manufacturer} ${inv.model} (equipment catalogue)`,
  };
}

/** The storage's published PV input window (`dcStringLimits`), as the engine's window. */
export function storageWindow(l: DcStringLimits): DcWindow {
  return {
    maxDcVoltage: l.maxDcVoltage,
    mpptVoltageMin: l.mpptVoltageMin,
    mpptVoltageMax: l.mpptVoltageMax,
    mpptChannels: l.mpptChannels,
    maxImpPerMpptA: l.maxInputCurrentPerMppt,
    maxIscPerMpptA: l.maxIscPerMpptA ?? null,
    maxParallelStringsPerMppt: 1,
    basis: l.basis,
  };
}

/**
 * WHAT THE STRINGS LAND ON. Capability-driven: a catalogued PV inverter with a DC window, a battery
 * that publishes its own PV inputs (and only when the PV is recorded as DC coupled to it), or a
 * microinverter. Anything else — an empty id, an id the catalogue does not hold, storage that takes no
 * PV — is `none`, and the string assignment is UNRESOLVED.
 */
export function resolveStringEndpoint(args: {
  inverterId?: string | null;
  inverterType?: string | null;
  coupling?: string | null;
  storageLimits?: DcStringLimits | null;
  storageLabel?: string | null;
}): StringEndpoint {
  if (args.coupling === 'dc-coupled-storage') {
    if (!args.storageLimits) {
      return { kind: 'none', reason: 'The PV is DC coupled to storage that publishes no PV input limits, so '
        + 'no string can be checked against it.' };
    }
    return {
      kind: 'storage-dc-input', label: args.storageLabel ?? 'storage PV inputs',
      unitCount: args.storageLimits.unitCount, window: storageWindow(args.storageLimits),
    };
  }
  const id = String(args.inverterId ?? '').trim();
  if (args.inverterType === 'micro') {
    const m = id ? getMicroinverterById(id) : undefined;
    return { kind: 'microinverter', inverterId: id || null, label: m ? `${m.manufacturer} ${m.model}` : null };
  }
  if (!id) return { kind: 'none', reason: NO_ENDPOINT_REASON };
  const inv = getInverterById(id);
  if (!inv) {
    const m = getMicroinverterById(id);
    if (m) return { kind: 'microinverter', inverterId: id, label: `${m.manufacturer} ${m.model}` };
    return { kind: 'none', reason: `'${id}' is not a catalogued PV inverter, so its inputs are not known. `
      + NO_ENDPOINT_REASON };
  }
  if (!(inv.maxDcVoltage > 0 && inv.mpptVoltageMin > 0 && inv.mpptVoltageMax > 0 && inv.mpptChannels > 0)) {
    return { kind: 'none', reason: `${inv.manufacturer} ${inv.model} publishes no complete DC input window.` };
  }
  return {
    kind: 'pv-inverter', inverterId: inv.id, label: `${inv.manufacturer} ${inv.model}`,
    topology: args.inverterType === 'optimizer' ? 'optimizer' : 'string', window: inverterWindow(inv),
  };
}

/** Does this fleet entry give its strings something to land on (or need none — a micro)? */
export function fleetEntryHasEndpoint(entry: { inverterId?: unknown; type?: unknown } | null | undefined): boolean {
  if (!entry) return false;
  return resolveStringEndpoint({
    inverterId: typeof entry.inverterId === 'string' ? entry.inverterId : null,
    inverterType: typeof entry.type === 'string' ? entry.type : null,
  }).kind !== 'none';
}

/**
 * 🚨 A FLEET ENTRY WITH NOTHING FOR ITS STRINGS TO LAND ON IS NOT A FLEET ENTRY.
 *
 * It is the "choose a PV inverter" state, and everything it carries is a partition sized against no
 * input — the 20 / 17 stored on fresh projects. Dropped (never re-split) wherever a fleet is loaded or
 * written; the module count is Design's and does not live on it.
 */
export function withoutUnresolvedEntries<T extends { inverterId?: unknown; type?: unknown }>(
  inverters: readonly T[] | null | undefined,
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const inv of inverters ?? []) (fleetEntryHasEndpoint(inv) ? kept : dropped).push(inv);
  return { kept, dropped };
}

/** Each string against the window it lands on; the published limits it breaks, one line each. */
export function checkStringPartition(args: {
  strings: readonly number[];
  module: StringModuleFacts;
  window: DcWindow;
  designTempMin: number;
  topology?: 'string' | 'optimizer';
}): { checks: StringCheck[]; violations: string[]; bounds: ReturnType<typeof stringSizingBounds> } {
  const { strings, module: m, window: w, designTempMin } = args;
  const optimizer = args.topology === 'optimizer';
  const bounds = stringSizingBounds({
    moduleVoc: m.voc, moduleVmp: m.vmp, tempCoeffVoc: m.tempCoeffVoc, tempCoeffVmp: m.tempCoeffVmp ?? null,
    inverterMaxDcVoltage: w.maxDcVoltage, mpptVoltageMin: w.mpptVoltageMin, mpptVoltageMax: w.mpptVoltageMax,
    inverterMaxPanelsPerString: w.maxPanelsPerString ?? null, designTempMinC: designTempMin,
    topology: optimizer ? 'optimizer' : 'string',
  });
  const checks = strings.map(n => ({ modules: n, coldVoc: n * bounds.vocCorrected, hotVmp: n * bounds.vmpHot }));
  const violations: string[] = [];
  const slots = Math.max(1, w.mpptChannels) * Math.max(1, w.maxParallelStringsPerMppt ?? 1);
  if (strings.length > slots) {
    violations.push(`${strings.length} strings need ${strings.length} inputs; ${w.basis} provides ${slots}.`);
  }
  checks.forEach((c, i) => {
    if (!(Number.isInteger(c.modules) && c.modules > 0)) {
      violations.push(`String ${i + 1} has ${c.modules} modules.`);
      return;
    }
    if (optimizer) {
      if (w.maxPanelsPerString && c.modules > w.maxPanelsPerString) {
        violations.push(`String ${i + 1}: ${c.modules} modules exceeds the ${w.maxPanelsPerString}-module ceiling.`);
      }
      return;
    }
    if (c.coldVoc > w.maxDcVoltage + 1e-9) {
      violations.push(`String ${i + 1}: ${c.modules} × ${bounds.vocCorrected.toFixed(1)} V = ${c.coldVoc.toFixed(1)} V `
        + `at ${designTempMin} °C exceeds the ${w.maxDcVoltage} V maximum input (NEC 690.7).`);
    }
    if (c.hotVmp < w.mpptVoltageMin - 1e-9) {
      violations.push(`String ${i + 1}: ${c.modules} × ${bounds.vmpHot.toFixed(1)} V = ${c.hotVmp.toFixed(1)} V hot `
        + `Vmp is below the ${w.mpptVoltageMin} V MPPT minimum.`);
    }
  });
  if (!optimizer) {
    if (w.maxIscPerMpptA != null && m.isc > w.maxIscPerMpptA) {
      violations.push(`Module Isc ${m.isc} A exceeds the ${w.maxIscPerMpptA} A short-circuit limit per MPPT.`);
    }
    if (w.maxImpPerMpptA != null && m.imp > w.maxImpPerMpptA) {
      violations.push(`Module Imp ${m.imp} A exceeds the ${w.maxImpPerMpptA} A operating limit per MPPT.`);
    }
  }
  return { checks, violations, bounds };
}

/**
 * A valid partition in the engine's own length-first style (full-length strings first, the remainder
 * spread so every string stays inside [min, max]), with the fewest strings the inputs allow — or null
 * when no partition of `total` modules fits.
 */
export function lengthFirstValidPartition(total: number, min: number, max: number, slots: number): number[] | null {
  if (!(total > 0 && min >= 1 && max >= min)) return null;
  for (let n = Math.ceil(total / max); n <= slots; n++) {
    if (n * min > total || n * max < total) continue;
    const out: number[] = [];
    let left = total;
    for (let i = 0; i < n; i++) {
      const s = Math.min(max, left - (n - 1 - i) * min);
      out.push(s);
      left -= s;
    }
    return out;
  }
  return null;
}

/**
 * 🚨 THE STRING ASSIGNMENT — OR WHY THERE IS NONE.
 *
 * No endpoint ⇒ UNRESOLVED (no partition, anywhere). Microinverters ⇒ NOT_APPLICABLE (devices and AC
 * branches, never DC strings). Otherwise `generateStringConfig` against the endpoint's published
 * window, every string checked against it; a layout that breaks a limit is replaced by a valid
 * length-first one, and when none exists the answer is INFEASIBLE with the limits it breaks.
 */
export function canonicalStringPartition(args: {
  moduleCount: number | null | undefined;
  module: StringModuleFacts | null | undefined;
  endpoint: StringEndpoint;
  designTempMin: number;
}): CanonicalStrings {
  const { endpoint: ep, module: m, designTempMin } = args;
  if (ep.kind === 'none') return { status: 'UNRESOLVED', reason: ep.reason };
  if (ep.kind === 'microinverter') {
    return { status: 'NOT_APPLICABLE', reason: 'Microinverters convert each module on the roof: the design has '
      + 'devices and AC branches, not DC strings.' };
  }
  const total = args.moduleCount ?? 0;
  if (!(Number.isInteger(total) && total > 0)) {
    return { status: 'UNRESOLVED', reason: 'The module count is not established — Design places the modules.' };
  }
  if (!m || !(m.voc > 0) || !(m.vmp > 0) || !(m.isc > 0) || !(m.watts > 0) || !Number.isFinite(m.tempCoeffVoc)) {
    return { status: 'UNRESOLVED', reason: 'The module\'s electrical facts (Voc, Vmp, Isc, temperature coefficient) '
      + 'are not established, so no string can be checked.' };
  }
  const w = ep.window;
  const topology = ep.kind === 'pv-inverter' ? ep.topology : 'string';
  const result = generateStringConfig({
    totalModules: total,
    moduleSpecs: moduleSpecsFromRegistry({
      voc: m.voc, vmp: m.vmp, isc: m.isc, imp: m.imp, watts: m.watts,
      tempCoeffVoc: m.tempCoeffVoc, tempCoeffVmp: m.tempCoeffVmp ?? undefined,
      maxSeriesFuseRating: m.maxSeriesFuseRating ?? undefined,
    }),
    inverterSpecs: inverterSpecsFromRegistry({
      maxDcVoltage: w.maxDcVoltage, mpptVoltageMin: w.mpptVoltageMin, mpptVoltageMax: w.mpptVoltageMax,
      mpptChannels: w.mpptChannels, maxInputCurrent: w.maxImpPerMpptA ?? undefined,
      maxParallelStringsPerMppt: w.maxParallelStringsPerMppt ?? undefined,
      nominalDcVoltage: w.nominalDcVoltage ?? undefined,
      acOutputKw: w.acOutputKw ?? undefined,
      maxPanelsPerString: w.maxPanelsPerString ?? undefined,
    }),
    designTempMin,
    topology,
  });
  const engine = result.strings
    .map(s => s.panelsInString)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const judge = (strings: number[]) => checkStringPartition({ strings, module: m, window: w, designTempMin, topology });
  const first = judge(engine);
  const sum = engine.reduce((a, b) => a + b, 0);
  const bounds = {
    minPanelsPerString: first.bounds.minPanelsPerString, maxPanelsPerString: first.bounds.maxPanelsPerString,
    vocCorrected: first.bounds.vocCorrected, vmpHot: first.bounds.vmpHot,
  };
  if (engine.length > 0 && sum === total && first.violations.length === 0) {
    return { status: 'ENGINEERED', strings: engine, endpoint: ep, checks: first.checks, bounds, adjustedForValidity: false };
  }
  // The engine's layout broke a published limit (or did not cover the array). Same style, valid.
  const slots = Math.max(1, w.mpptChannels) * Math.max(1, w.maxParallelStringsPerMppt ?? 1);
  const max = topology === 'optimizer'
    ? (w.maxPanelsPerString ?? first.bounds.recommendedPanelsPerString)
    : first.bounds.maxPanelsPerString;
  const min = topology === 'optimizer' ? 1 : first.bounds.minPanelsPerString;
  const alt = lengthFirstValidPartition(total, Math.max(1, min), max, slots);
  if (alt) {
    const second = judge(alt);
    if (second.violations.length === 0) {
      return { status: 'ENGINEERED', strings: alt, endpoint: ep, checks: second.checks, bounds, adjustedForValidity: true };
    }
    return { status: 'INFEASIBLE', reason: `No string layout of ${total} modules fits ${w.basis}.`, violations: second.violations };
  }
  return {
    status: 'INFEASIBLE',
    reason: `No string layout of ${total} modules fits ${w.basis}: each string must hold ${min}–${max} modules `
      + `and there are ${slots} inputs.`,
    violations: first.violations,
  };
}
