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
//     battery's own published PV inputs (DC coupled), catalogued microinverters (no DC strings at
//     all), or NOTHING — in which case the answer is UNRESOLVED and no partition exists anywhere.
//   · `canonicalStringPartition` — the partition, from `generateStringConfig` (the NEC 690.7 owner
//     both SLD routes, the plan set and the page's sizing readout already use) against the
//     endpoint's PUBLISHED window, then checked string by string against that window. It never
//     returns a string that breaks a published limit: when the engine's own layout does, it looks for
//     a valid one of the same length-first style, and when none exists it says so.
//   · A chosen PV inverter is ONE MODEL, not one unit. Its published DC input (`dcInputKwMax`) and its
//     inputs (MPPTs × the parallel strings their current limits allow) bound what one unit takes; an
//     array that needs more is laid across the fewest units that take it — never certified onto one
//     unit it would overload (review finding: a 7.6 kW inverter "ENGINEERED" with 16.28 kW DC on it
//     while the sizing engine used two).
//
// Pure and isomorphic: catalogue lookups only, no React, no database.
// ═══════════════════════════════════════════════════════════════════════════

import {
  generateStringConfig, inverterSpecsFromRegistry, moduleSpecsFromRegistry, stringSizingBounds,
} from '@/lib/string-generator';
import { OPTIMIZERS, getInverterById, getMicroinverterById, getOptimizerById } from '@/lib/equipment-db';
import { getBrandProfileByInverterId } from '@/lib/system/brandProfiles';
import type { DcStringLimits } from '@/lib/electrical/dcStringLimits';

/** What the card says while nothing is chosen for the strings to land on. */
export const STRINGING_PENDING = 'Stringing pending equipment selection';

/** Why there is no string assignment on a project with modules and no receiving equipment. */
export const NO_ENDPOINT_REASON =
  'No PV inverter or other DC receiving equipment is chosen, so there is nothing for the strings to '
  + 'land on. The module count is Design\'s; the string assignment follows once the equipment is chosen.';

/** The most units of one chosen PV inverter model the engine lays an array across. */
export const MAX_INVERTER_UNITS = 10;

/**
 * The published DC window of whatever the strings land on. For a PV inverter it is ONE unit's (the
 * engine decides how many units the array needs); a storage window is already the sum of the
 * recorded cabinets (their count is the installer's, not the engine's).
 */
export interface DcWindow {
  maxDcVoltage: number;
  mpptVoltageMin: number;
  mpptVoltageMax: number;
  /** Independent MPPT inputs: of one PV inverter unit, or of every storage cabinet together. */
  mpptChannels: number;
  /** Max operating (Imp) current per MPPT, where published. */
  maxImpPerMpptA?: number | null;
  /** Max short-circuit current per MPPT, where published. */
  maxIscPerMpptA?: number | null;
  maxParallelStringsPerMppt?: number | null;
  /** Optimizer brand ceiling (string length), where published. */
  maxPanelsPerString?: number | null;
  /** Optimizer minimum string length (power optimizers per string), where the model publishes one. */
  minPanelsPerString?: number | null;
  nominalDcVoltage?: number | null;
  acOutputKw?: number | null;
  /** Published maximum DC (STC) input, kW — of one unit (of the whole storage window when summed). */
  dcInputKwMax?: number | null;
  /** Optimizer string power ceiling, W: the inverter's fixed DC bus × the optimizer's max output current. */
  maxStringPowerW?: number | null;
  /** Where these numbers come from. */
  basis: string;
}

export type StringEndpoint =
  | { kind: 'pv-inverter'; inverterId: string; label: string; topology: 'string' | 'optimizer'; window: DcWindow }
  | { kind: 'storage-dc-input'; label: string; unitCount: number; window: DcWindow }
  | { kind: 'microinverter'; inverterId: string; label: string }
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
    /** Every string, grouped by the unit it lands on (unit 0's first). */
    strings: number[];
    /** The receiving unit of each entry of `strings` (always 0 on a storage window). */
    unitOf: number[];
    /** How many units of the chosen model the array needs (1 on a storage window). */
    units: number;
    /** `strings` split by unit. */
    perUnit: number[][];
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
const pos = (v: unknown): number | null => { const n = num(v); return n !== null && n > 0 ? n : null; };

/**
 * The optimizer string power ceiling for a fixed-bus inverter: its nominal DC bus × the optimizer's
 * max output current — the per-string limit the sizing engine documents as SolarEdge's 5,700 W
 * (lib/system/sizingEngine.ts `voltageAwareMaxPPS`). The optimizer is the recorded one, or — none
 * recorded — the most restrictive of the optimizers the inverter's catalogue entry lists as
 * compatible. Null when either number is unpublished: the ceiling is then not established.
 */
function optimizerStringPowerW(
  inv: NonNullable<ReturnType<typeof getInverterById>>,
  optimizerPeripheralId: string | null | undefined,
): { watts: number; basis: string } | null {
  const bus = pos(inv.nominalDcVoltage);
  if (bus === null) return null;
  const recorded = optimizerPeripheralId ? getOptimizerById(optimizerPeripheralId) : undefined;
  const candidates = recorded ? [recorded]
    : OPTIMIZERS.filter(o => (inv.compatibleWith ?? []).includes(o.id));
  const rated = candidates.filter(o => pos(o.maxOutputCurrent) !== null);
  if (rated.length === 0) return null;
  const opt = rated.reduce((a, b) => (b.maxOutputCurrent < a.maxOutputCurrent ? b : a));
  return {
    watts: bus * opt.maxOutputCurrent,
    basis: `${bus} V DC bus × ${opt.maxOutputCurrent} A ${opt.manufacturer} ${opt.model} output`,
  };
}

/** A catalogued PV inverter's own window (one unit). */
function inverterWindow(
  inv: NonNullable<ReturnType<typeof getInverterById>>,
  topology: 'string' | 'optimizer',
  optimizerPeripheralId?: string | null,
): DcWindow {
  const power = topology === 'optimizer' ? optimizerStringPowerW(inv, optimizerPeripheralId) : null;
  // The optimizer string's minimum length is the model's own record (SolarEdge HD-Wave: 8 power
  // optimizers per string). A voltage-bypassed optimizer string has no other lower bound, and without
  // it the length-first fallback wrote a 1-module optimizer string.
  const modelRef = topology === 'optimizer'
    ? getBrandProfileByInverterId(inv.id)?.supportedInverterModels.find(x => x.equipmentDbId === inv.id)
    : undefined;
  return {
    maxDcVoltage: inv.maxDcVoltage,
    mpptVoltageMin: inv.mpptVoltageMin,
    mpptVoltageMax: inv.mpptVoltageMax,
    mpptChannels: inv.mpptChannels,
    maxImpPerMpptA: num(inv.maxInputCurrentPerMppt),
    maxIscPerMpptA: num((inv as { maxShortCircuitCurrent?: number }).maxShortCircuitCurrent),
    maxParallelStringsPerMppt: num(inv.maxParallelStringsPerMppt),
    maxPanelsPerString: num((inv as { maxPanelsPerString?: number }).maxPanelsPerString),
    minPanelsPerString: pos(modelRef?.minPanelsPerString),
    nominalDcVoltage: num(inv.nominalDcVoltage),
    acOutputKw: num(inv.acOutputKw),
    dcInputKwMax: pos(inv.dcInputKwMax),
    maxStringPowerW: power?.watts ?? null,
    basis: `${inv.manufacturer} ${inv.model} (equipment catalogue${power ? `; ${power.basis}` : ''})`,
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
    dcInputKwMax: pos(l.maxStcKw),
    basis: l.basis,
  };
}

/**
 * WHAT THE STRINGS LAND ON. Capability-driven: a catalogued PV inverter with a DC window, a battery
 * that publishes its own PV inputs (and only when the PV is recorded as DC coupled to it), or a
 * catalogued microinverter. Anything else — an empty id, an id the catalogue does not hold, a micro
 * entry with no device, storage that takes no PV — is `none`, and the string assignment is UNRESOLVED.
 */
export function resolveStringEndpoint(args: {
  inverterId?: string | null;
  inverterType?: string | null;
  optimizerPeripheralId?: string | null;
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
    // 🚨 A MICRO ENTRY WITH NO DEVICE IS NOT A MICROINVERTER SYSTEM. It rendered a model-less
    // "Microinverter · 37 panels" row rated at the 0.290 kW-per-module fallback (review finding).
    // No catalogued device ⇒ nothing chosen.
    const m = id ? getMicroinverterById(id) : undefined;
    if (!m) {
      return { kind: 'none', reason: id ? `'${id}' is not a catalogued microinverter. ${NO_ENDPOINT_REASON}`
        : NO_ENDPOINT_REASON };
    }
    return { kind: 'microinverter', inverterId: id, label: `${m.manufacturer} ${m.model}` };
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
  const topology = args.inverterType === 'optimizer' ? 'optimizer' : 'string';
  return {
    kind: 'pv-inverter', inverterId: inv.id, label: `${inv.manufacturer} ${inv.model}`,
    topology, window: inverterWindow(inv, topology, args.optimizerPeripheralId),
  };
}

/** Does this fleet entry give its strings something to land on (or need none — a catalogued micro)? */
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

/**
 * How many strings one MPPT may carry: the published parallel-string count, cut down to what the
 * MPPT's published current limits allow — parallel strings ADD their current on the input they share
 * (review finding: 2 × 10.92 A = 21.84 A was certified onto a 16.9 A MPPT). Optimizer strings are
 * bus-regulated and keep the published count.
 */
export function parallelStringsPerMppt(
  w: DcWindow, m: StringModuleFacts, topology: 'string' | 'optimizer' = 'string',
): { n: number; limitedBy: string | null } {
  const published = Math.max(1, Math.floor(w.maxParallelStringsPerMppt ?? 1));
  if (topology === 'optimizer') return { n: published, limitedBy: null };
  let n = published;
  let limitedBy: string | null = null;
  if (w.maxIscPerMpptA != null && m.isc > 0) {
    const byIsc = Math.floor(w.maxIscPerMpptA / m.isc + 1e-9);
    if (byIsc < n) { n = byIsc; limitedBy = `${m.isc} A Isc per string against ${w.maxIscPerMpptA} A per MPPT`; }
  }
  if (w.maxImpPerMpptA != null && m.imp > 0) {
    const byImp = Math.floor(w.maxImpPerMpptA / m.imp + 1e-9);
    if (byImp < n) { n = byImp; limitedBy = `${m.imp} A Imp per string against ${w.maxImpPerMpptA} A per MPPT`; }
  }
  return { n: Math.max(0, n), limitedBy };
}

/**
 * Strings onto `units` receiving units — each within its inputs and its published DC input — largest
 * string first onto the least-loaded unit. Null when they do not fit, or when a unit would carry
 * nothing (a unit with no strings is not part of the design).
 */
export function allocateStringsToUnits(args: {
  strings: readonly number[]; units: number; slotsPerUnit: number; moduleWatts: number; unitKwMax?: number | null;
}): number[] | null {
  const { strings, units, slotsPerUnit, moduleWatts } = args;
  const cap = args.unitKwMax ?? null;
  if (!(units >= 1) || strings.length < units) return null;
  const order = strings.map((_, i) => i).sort((a, b) => strings[b] - strings[a] || a - b);
  const count = new Array<number>(units).fill(0);
  const kw = new Array<number>(units).fill(0);
  const unitOf = new Array<number>(strings.length).fill(-1);
  for (const i of order) {
    const add = strings[i] * moduleWatts / 1000;
    let best = -1;
    for (let u = 0; u < units; u++) {
      if (count[u] >= slotsPerUnit) continue;
      if (cap !== null && kw[u] + add > cap + 1e-9) continue;
      if (best < 0 || kw[u] < kw[best] - 1e-12) best = u;
    }
    if (best < 0) return null;
    unitOf[i] = best;
    count[best]++;
    kw[best] += add;
  }
  return count.some(c => c === 0) ? null : unitOf;
}

/**
 * Each string against the window it lands on; the published limits it breaks, one line each. With
 * `units` > 1 the window is one unit's and the strings are laid across that many of them (a caller's
 * own `unitOf` is checked instead of allocated).
 */
export function checkStringPartition(args: {
  strings: readonly number[];
  module: StringModuleFacts;
  window: DcWindow;
  designTempMin: number;
  topology?: 'string' | 'optimizer';
  units?: number;
  unitOf?: readonly number[] | null;
}): { checks: StringCheck[]; violations: string[]; bounds: ReturnType<typeof stringSizingBounds>; unitOf: number[] | null } {
  const { strings, module: m, window: w, designTempMin } = args;
  const optimizer = args.topology === 'optimizer';
  const units = Math.max(1, Math.floor(args.units ?? 1));
  const bounds = stringSizingBounds({
    moduleVoc: m.voc, moduleVmp: m.vmp, tempCoeffVoc: m.tempCoeffVoc, tempCoeffVmp: m.tempCoeffVmp ?? null,
    inverterMaxDcVoltage: w.maxDcVoltage, mpptVoltageMin: w.mpptVoltageMin, mpptVoltageMax: w.mpptVoltageMax,
    inverterMaxPanelsPerString: w.maxPanelsPerString ?? null, designTempMinC: designTempMin,
    topology: optimizer ? 'optimizer' : 'string',
  });
  const checks = strings.map(n => ({ modules: n, coldVoc: n * bounds.vocCorrected, hotVmp: n * bounds.vmpHot }));
  const violations: string[] = [];
  const ppm = parallelStringsPerMppt(w, m, optimizer ? 'optimizer' : 'string');
  if (!optimizer) {
    if (w.maxIscPerMpptA != null && m.isc > w.maxIscPerMpptA) {
      violations.push(`Module Isc ${m.isc} A exceeds the ${w.maxIscPerMpptA} A short-circuit limit per MPPT.`);
    }
    if (w.maxImpPerMpptA != null && m.imp > w.maxImpPerMpptA) {
      violations.push(`Module Imp ${m.imp} A exceeds the ${w.maxImpPerMpptA} A operating limit per MPPT.`);
    }
  }
  const slotsPerUnit = Math.max(1, w.mpptChannels) * ppm.n;
  const slots = slotsPerUnit * units;
  if (strings.length > slots) {
    violations.push(`${strings.length} strings need ${strings.length} inputs; `
      + `${units > 1 ? `${units} × ` : ''}${w.basis} provides ${slots}`
      + (ppm.limitedBy ? ` (${ppm.n} string${ppm.n === 1 ? '' : 's'} per MPPT: ${ppm.limitedBy})` : '') + '.');
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
      if (w.minPanelsPerString && c.modules < w.minPanelsPerString) {
        violations.push(`String ${i + 1}: ${c.modules} modules is below the ${w.minPanelsPerString}-optimizer minimum string length.`);
      }
      if (w.maxStringPowerW != null && c.modules * m.watts > w.maxStringPowerW + 1e-9) {
        violations.push(`String ${i + 1}: ${c.modules} × ${m.watts} W = ${c.modules * m.watts} W exceeds the `
          + `${w.maxStringPowerW} W optimizer string power limit.`);
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
  // Per unit: its inputs and its published DC input.
  const totalKw = strings.reduce((a, b) => a + b, 0) * m.watts / 1000;
  let unitOf: number[] | null = args.unitOf ? [...args.unitOf] : null;
  if (unitOf) {
    for (let u = 0; u < units; u++) {
      const mine = strings.filter((_, i) => unitOf![i] === u);
      const kw = mine.reduce((a, b) => a + b, 0) * m.watts / 1000;
      if (mine.length > slotsPerUnit) {
        violations.push(`Unit ${u + 1}: ${mine.length} strings on ${slotsPerUnit} input${slotsPerUnit === 1 ? '' : 's'}.`);
      }
      if (w.dcInputKwMax && kw > w.dcInputKwMax + 1e-9) {
        violations.push(`Unit ${u + 1}: ${kw.toFixed(2)} kW DC exceeds the ${w.dcInputKwMax} kW DC input of ${w.basis}.`);
      }
    }
  } else if (ppm.n > 0 && strings.length <= slots) {
    unitOf = allocateStringsToUnits({ strings, units, slotsPerUnit, moduleWatts: m.watts, unitKwMax: w.dcInputKwMax });
    if (!unitOf) {
      violations.push(`These ${strings.length} strings (${totalKw.toFixed(2)} kW DC) cannot be laid across `
        + `${units > 1 ? `${units} units of ` : ''}${w.basis} within ${slotsPerUnit} input${slotsPerUnit === 1 ? '' : 's'}`
        + (w.dcInputKwMax ? ` and its ${w.dcInputKwMax} kW DC input` : '') + ` per unit.`);
    }
  }
  return { checks, violations, bounds, unitOf };
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
 * The module's facts AS PUBLISHED, or null. Never a defaulted coefficient or current: a fact the
 * catalogue does not carry makes the engine answer UNRESOLVED instead of running on a guess.
 */
export function stringModuleFacts(p: {
  voc?: number | null; vmp?: number | null; isc?: number | null; imp?: number | null; watts?: number | null;
  tempCoeffVoc?: number | null; tempCoeffVmp?: number | null; maxSeriesFuseRating?: number | null;
} | null | undefined): StringModuleFacts | null {
  if (!p) return null;
  const voc = pos(p.voc); const vmp = pos(p.vmp); const isc = pos(p.isc); const imp = pos(p.imp);
  const watts = pos(p.watts); const tc = num(p.tempCoeffVoc);
  if (voc === null || vmp === null || isc === null || imp === null || watts === null || tc === null) return null;
  return {
    voc, vmp, isc, imp, watts, tempCoeffVoc: tc, tempCoeffVmp: num(p.tempCoeffVmp),
    maxSeriesFuseRating: num(p.maxSeriesFuseRating),
  };
}

/**
 * 🚨 THE STRING ASSIGNMENT — OR WHY THERE IS NONE.
 *
 * No endpoint ⇒ UNRESOLVED (no partition, anywhere). Microinverters ⇒ NOT_APPLICABLE (devices and AC
 * branches, never DC strings). Otherwise `generateStringConfig` against the endpoint's published
 * window, every string checked against it; a layout that breaks a limit is replaced by a valid
 * length-first one. A chosen PV inverter takes as many units as the array needs — the fewest whose
 * inputs and published DC input take every string — and when no layout fits (on up to
 * MAX_INVERTER_UNITS units) the answer is INFEASIBLE with the limits it breaks.
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
  if (!m || !(m.voc > 0) || !(m.vmp > 0) || !(m.isc > 0) || !(m.imp > 0) || !(m.watts > 0)
      || !Number.isFinite(m.tempCoeffVoc)) {
    return { status: 'UNRESOLVED', reason: 'The module\'s electrical facts (Voc, Vmp, Isc, Imp, temperature '
      + 'coefficient) are not established, so no string can be checked.' };
  }
  const w = ep.window;
  const topology = ep.kind === 'pv-inverter' ? ep.topology : 'string';
  if (topology === 'optimizer' && !(w.maxStringPowerW != null && w.maxStringPowerW > 0)) {
    return { status: 'UNRESOLVED', reason: `${w.basis} publishes no fixed DC bus or compatible optimizer output `
      + 'current, so the optimizer string power limit is not established and no string can be checked.' };
  }
  const maxUnits = ep.kind === 'pv-inverter' ? MAX_INVERTER_UNITS : 1;
  const ppm = parallelStringsPerMppt(w, m, topology);
  if (ppm.n < 1) {
    // No input of this equipment can take even one string of this module — another unit cannot help.
    const v = checkStringPartition({ strings: [total], module: m, window: w, designTempMin, topology }).violations
      .filter(x => x.startsWith('Module '));
    return {
      status: 'INFEASIBLE',
      reason: `${v.join(' ')} No string of this module fits an input of ${w.basis}.`.trim(),
      violations: v,
    };
  }
  const totalKw = total * m.watts / 1000;
  const generate = (units: number): number[] => generateStringConfig({
    totalModules: total,
    moduleSpecs: moduleSpecsFromRegistry({
      voc: m.voc, vmp: m.vmp, isc: m.isc, imp: m.imp, watts: m.watts,
      tempCoeffVoc: m.tempCoeffVoc, tempCoeffVmp: m.tempCoeffVmp ?? undefined,
      maxSeriesFuseRating: m.maxSeriesFuseRating ?? undefined,
    }),
    inverterSpecs: inverterSpecsFromRegistry({
      maxDcVoltage: w.maxDcVoltage, mpptVoltageMin: w.mpptVoltageMin, mpptVoltageMax: w.mpptVoltageMax,
      mpptChannels: w.mpptChannels * units, maxInputCurrent: w.maxImpPerMpptA ?? undefined,
      maxParallelStringsPerMppt: w.maxParallelStringsPerMppt ?? undefined,
      nominalDcVoltage: w.nominalDcVoltage ?? undefined,
      acOutputKw: w.acOutputKw != null ? w.acOutputKw * units : undefined,
      maxPanelsPerString: w.maxPanelsPerString ?? undefined,
    }),
    designTempMin,
    topology,
  }).strings
    .map(s => s.panelsInString)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const judge = (strings: number[], units: number) =>
    checkStringPartition({ strings, module: m, window: w, designTempMin, topology, units });
  const engineered = (strings: number[], units: number, j: ReturnType<typeof judge>, adjusted: boolean): CanonicalStrings => {
    const unitOf = j.unitOf ?? strings.map(() => 0);
    const perUnit = Array.from({ length: units }, (_, u) => strings.filter((_, i) => unitOf[i] === u));
    return {
      status: 'ENGINEERED',
      strings: perUnit.flat(),
      unitOf: perUnit.flatMap((ss, u) => ss.map(() => u)),
      units,
      perUnit,
      endpoint: ep,
      checks: perUnit.flatMap((_, u) => j.checks.filter((_, i) => unitOf[i] === u)),
      adjustedForValidity: adjusted,
      bounds: {
        minPanelsPerString: j.bounds.minPanelsPerString, maxPanelsPerString: j.bounds.maxPanelsPerString,
        vocCorrected: j.bounds.vocCorrected, vmpHot: j.bounds.vmpHot,
      },
    };
  };

  // Why the last layout tried failed — a string-level reason outranks "one unit's DC input is exceeded".
  let dcOnly: { reason: string; violations: string[] } | null = null;
  let first: { reason: string; violations: string[] } | null = null;
  for (let units = 1; units <= maxUnits; units++) {
    if (w.dcInputKwMax && totalKw > units * w.dcInputKwMax + 1e-9) {
      dcOnly ??= {
        reason: `${totalKw.toFixed(2)} kW DC exceeds the ${w.dcInputKwMax} kW DC input of ${w.basis}.`,
        violations: [`${totalKw.toFixed(2)} kW DC exceeds the ${w.dcInputKwMax} kW DC input.`],
      };
      continue;
    }
    const engine = generate(units);
    const a = judge(engine, units);
    if (engine.length > 0 && engine.reduce((x, y) => x + y, 0) === total && a.violations.length === 0) {
      return engineered(engine, units, a, false);
    }
    // The engine's layout broke a published limit (or did not cover the array). Same style, valid.
    const slots = Math.max(1, w.mpptChannels) * ppm.n * units;
    const powerCap = topology === 'optimizer' && w.maxStringPowerW
      ? Math.floor(w.maxStringPowerW / m.watts + 1e-9) : Number.POSITIVE_INFINITY;
    const max = topology === 'optimizer'
      ? Math.min(w.maxPanelsPerString ?? a.bounds.recommendedPanelsPerString, powerCap)
      : a.bounds.maxPanelsPerString;
    const min = topology === 'optimizer' ? (w.minPanelsPerString ?? 1) : a.bounds.minPanelsPerString;
    const alt = slots > 0 ? lengthFirstValidPartition(total, Math.max(1, min), max, slots) : null;
    if (alt) {
      const b = judge(alt, units);
      if (b.violations.length === 0) return engineered(alt, units, b, true);
      first ??= { reason: `No string layout of ${total} modules fits ${w.basis}.`, violations: b.violations };
    } else {
      first ??= {
        reason: `No string layout of ${total} modules fits ${w.basis}: each string must hold ${min}–${max} modules `
          + `and there are ${slots} inputs.`,
        violations: a.violations,
      };
    }
    // Another unit cannot rescue a string length no partition of the array can use: no string count n
    // has n × min ≤ total ≤ n × max (e.g. every string must be exactly 10 modules and there are 37).
    const lo = Math.max(1, min);
    if (max < lo || Math.ceil(total / max) > Math.floor(total / lo)) break;
  }
  const why = first ?? dcOnly;
  return {
    status: 'INFEASIBLE',
    reason: (why?.reason ?? `No string layout of ${total} modules fits ${w.basis}.`)
      + (maxUnits > 1 ? ` No layout fits on up to ${maxUnits} units of it either.` : ''),
    violations: why?.violations ?? [],
  };
}

/** A stored fleet entry, as the string partition it carries. */
export interface StoredFleetEntry { inverterId: string; type: string; strings: number[] }

/** `engineering_config.inverters` → the entries that have a receiving endpoint, as partitions. */
export function storedFleetPartition(inverters: unknown): StoredFleetEntry[] {
  if (!Array.isArray(inverters)) return [];
  const rows = inverters
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map(x => ({
      inverterId: typeof x.inverterId === 'string' ? x.inverterId : '',
      type: typeof x.type === 'string' ? x.type : 'string',
      strings: (Array.isArray(x.strings) ? x.strings : [])
        .map(s => Number((s as { panelCount?: unknown })?.panelCount) || 0)
        .filter(n => n > 0),
    }));
  return withoutUnresolvedEntries(rows).kept;
}

/**
 * 🚨 THE PARTITION A SHEET DRAWS — the same one the Inverters & Strings card shows.
 *
 * The SLD routes drew a partition of their own (`sizeSystemFromBrand`'s layout, or
 * `generateStringConfig` against posted defaults), so the card said 8/8/8/7/6, the sheet 10/9/9/9 and
 * the BOM ordered a third count (review finding). One rule now, for every consumer:
 *   1. the project's STORED fleet, when it is entirely this endpoint's model, covers exactly the array
 *      and passes the engine's checks — the installer's committed assignment;
 *   2. otherwise the one string engine's partition for the endpoint;
 *   3. otherwise NONE, with why (no endpoint, a micro, or no valid layout).
 */
export function sheetStringPartition(args: {
  endpoint: StringEndpoint;
  moduleCount: number;
  module: StringModuleFacts | null;
  designTempMin: number;
  fleet?: readonly StoredFleetEntry[] | null;
}): { source: 'fleet' | 'canonical'; strings: number[]; perUnit: number[][]; units: number; reason?: undefined }
  | { source: 'none'; reason: string; strings?: undefined; perUnit?: undefined; units?: undefined } {
  const { endpoint: ep, moduleCount, module: m, designTempMin } = args;
  if (ep.kind === 'none') return { source: 'none', reason: ep.reason };
  if (ep.kind === 'microinverter') {
    return { source: 'none', reason: 'Microinverters: devices and AC branches, not DC strings.' };
  }
  const fleet = (args.fleet ?? []).filter(e => e.strings.length > 0);
  if (ep.kind === 'pv-inverter' && m && fleet.length > 0 && fleet.every(e => e.inverterId === ep.inverterId)) {
    const strings = fleet.flatMap(e => e.strings);
    const unitOf = fleet.flatMap((e, u) => e.strings.map(() => u));
    if (strings.reduce((a, b) => a + b, 0) === moduleCount) {
      const c = checkStringPartition({
        strings, module: m, window: ep.window, designTempMin, topology: ep.topology, units: fleet.length, unitOf,
      });
      if (c.violations.length === 0) {
        return { source: 'fleet', strings, perUnit: fleet.map(e => [...e.strings]), units: fleet.length };
      }
    }
  }
  const r = canonicalStringPartition({ moduleCount, module: m, endpoint: ep, designTempMin });
  if (r.status === 'ENGINEERED') return { source: 'canonical', strings: r.strings, perUnit: r.perUnit, units: r.units };
  return { source: 'none', reason: r.reason };
}
