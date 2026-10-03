// ═══════════════════════════════════════════════════════════════════════════
// 🚨 WHICH BATTERY RECEIVES EACH PV STRING — A RECOMMENDATION, NEVER A SILENT ANSWER.
//
// Ray (System Config UX correction V3): "PV STRINGS · 37 modules · 5 strings · DC coupled to
// Powerwall 3 · String assignment [Review]" → "String i → PW3 #n", plus "Recommended assignment
// available [Accept] [Edit]". The recommendation is deterministic, respects each unit's PUBLISHED PV
// input limits, and is written only when the installer clicks Accept.
//
// The interview's own rule still holds (`behavior.pv-landing`): "Which strings land on which unit is
// a wiring decision — SolarPro does not split the array evenly to fill this in." This module does not
// fill anything in. It PROPOSES an assignment the installer can accept, edit or ignore; the only write
// is `answerPvLanding`, called from a click.
//
// What the recommendation respects, per unit, from that unit's own `pvInputLimits`:
//   · MPPT count — each string occupies one MPPT input. Paralleling two strings on one MPPT doubles
//     its current, and the partition sized every string against the per-MPPT current, so it is never
//     proposed.
//   · Max PV STC kW the unit accepts — the sum of its strings' STC never exceeds it.
//   · The voltage window is NOT re-checked here: the partition (`deriveStorageDcStrings`) was derived
//     against the storage's published window, so every string already fits it.
// And it spreads the load: strings are placed largest first, each on the least-loaded unit that can
// still take it (unit order breaks ties), backtracking only where that greedy order dead-ends. Same
// inputs ⇒ same answer, always.
//
// No assignment fits ⇒ null with the reason, in the installer's words. Never a partial assignment,
// never a unit over its published limit.
//
// Pure and isomorphic: no React, no catalogue lookup — the limits travel on the graph's units.
// ═══════════════════════════════════════════════════════════════════════════

import type { PvInputLimits, ServiceTopology, StorageUnit } from '@/lib/electrical/serviceTopology';

/** A unit the strings can land on: an inverting storage unit with (ideally) published PV inputs. */
export interface AssignableUnit {
  id: string;
  label?: string | null;
  productId?: string | null;
  pvInputLimits?: PvInputLimits | null;
  /** The PV STC already recorded on this unit (kW), if any — for reading an existing landing back. */
  pvDcStcKw?: number | null;
}

export interface StringAssignmentInput {
  /** Panel count of each derived string, in the engine's order. */
  strings: readonly number[];
  /** STC watts of one module. Null ⇒ not established. */
  moduleWatts: number | null;
  /** The inverting units, in graph order. */
  units: readonly AssignableUnit[];
}

export type StringAssignment =
  | {
    ok: true;
    /** The unit id each string lands on, by string index. */
    unitOf: string[];
    /** Strings per unit (panel counts, string order) — exactly `answerPvLanding`'s argument. */
    perUnit: Record<string, number[]>;
    /** PV STC per unit, kW (every unit present; 0 ⇒ no PV lands on it). */
    unitKw: Record<string, number>;
  }
  | { ok: false; reason: string };

/** How many partial assignments the search may try before it gives up and says so. */
const SEARCH_BUDGET = 200_000;

/** The inverting units of a graph, in order — the only units that can receive strings. */
export function invertingUnits(t: ServiceTopology | null | undefined): StorageUnit[] {
  return (t?.storage ?? []).filter(u => u.role === 'inverter-unit');
}

/**
 * "Tesla Powerwall 3 #1" — numbered across the whole site in graph order, and, where the site has
 * more than one backed-up system, which system it belongs to.
 */
export function unitDisplayLabels(t: ServiceTopology | null | undefined): Record<string, string> {
  const units = invertingUnits(t);
  const multi = (t?.domains.length ?? 0) > 1;
  const out: Record<string, string> = {};
  units.forEach((u, k) => {
    const system = multi ? t!.domains.find(d => d.storageUnitIds.includes(u.id))?.label ?? null : null;
    out[u.id] = `${u.label ?? u.productId} #${k + 1}${system ? ` (${system})` : ''}`;
  });
  return out;
}

/** STC watts of `modules` modules — the same rounding `answerPvLanding` records (per unit, not per string). */
const stcW = (modules: number, watts: number) => Math.round(modules * watts);
const capW = (l: PvInputLimits) => Math.round(l.maxStcKw * 1000);
/** The most modules a unit can take without its STC exceeding `cap` watts. */
const maxModulesUnder = (cap: number, watts: number) => {
  let m = Math.floor(cap / watts) + 1;
  while (m > 0 && stcW(m, watts) > cap) m--;
  return m;
};

/** Strings per unit, in string order, for `answerPvLanding`. Every unit is present. */
export function stringsPerUnit(
  strings: readonly number[], unitOf: readonly (string | null | undefined)[], unitIds: readonly string[],
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const id of unitIds) out[id] = [];
  strings.forEach((n, i) => { const u = unitOf[i]; if (u && out[u]) out[u].push(n); });
  return out;
}

/** PV STC per unit (kW), the same rounding `answerPvLanding` records. */
export function unitKwOf(perUnit: Record<string, number[]>, moduleWatts: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, ns] of Object.entries(perUnit)) {
    out[id] = stcW(ns.reduce((a, b) => a + b, 0), moduleWatts) / 1000;
  }
  return out;
}

/**
 * Where an assignment breaks a unit's PUBLISHED limits (MPPT count, kW STC), one line each — empty
 * when it fits. A unit that publishes no limits is not judged here: the engineering reports it NOT
 * EVALUATED rather than this guessing. Unassigned strings are counted by the editor, not here.
 */
export function assignmentViolations(
  input: StringAssignmentInput, unitOf: readonly (string | null | undefined)[],
  labels: Record<string, string> = {},
): string[] {
  const { strings, moduleWatts, units } = input;
  const out: string[] = [];
  for (const u of units) {
    const mine = strings.filter((_, i) => unitOf[i] === u.id);
    const l = u.pvInputLimits ?? null;
    const name = labels[u.id] ?? u.label ?? u.id;
    if (!l) continue;
    if (mine.length > l.mppts) {
      out.push(`${name} has ${l.mppts} MPPT inputs; ${mine.length} strings are assigned to it.`);
    }
    if (moduleWatts && moduleWatts > 0) {
      const w = stcW(mine.reduce((s, n) => s + n, 0), moduleWatts);
      if (w > capW(l)) {
        out.push(`${name} accepts ${l.maxStcKw} kW STC; ${(w / 1000).toFixed(2)} kW is assigned to it.`);
      }
    }
  }
  return out;
}

/** A unit, in modules: how many it may take (from its kW STC limit) and how many MPPT inputs it has. */
interface Slot { id: string; capModules: number; mppts: number }

/**
 * The search both the recommendation and the read-back use: strings largest first, each on the
 * least-loaded unit that can still take it, with identical units tried once (they are
 * interchangeable). `exact` ⇒ every unit must end at exactly its cap (reading a recorded landing back).
 * Everything is counted in whole modules, so no rounding can make two runs disagree.
 */
function search(
  strings: readonly number[], slots: readonly Slot[], exact: boolean,
): { unitOf: string[] } | 'exhausted' | null {
  const order = strings.map((_, i) => i).sort((a, b) => strings[b] - strings[a] || a - b);
  const load = slots.map(() => 0);
  const used = slots.map(() => 0);
  const at: number[] = new Array(strings.length).fill(-1);
  // The modules not yet placed — an exact read-back prunes on it.
  const suffix: number[] = new Array(order.length + 1).fill(0);
  for (let k = order.length - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + strings[order[k]];
  let nodes = 0;

  const go = (k: number): boolean | 'exhausted' => {
    if (k === order.length) return !exact || slots.every((s, j) => load[j] === s.capModules);
    if (exact && slots.reduce((room, s, j) => room + (s.capModules - load[j]), 0) !== suffix[k]) return false;
    const i = order[k];
    const n = strings[i];
    const candidates = slots.map((_, j) => j)
      .filter(j => used[j] < slots[j].mppts && load[j] + n <= slots[j].capModules)
      .sort((a, b) => load[a] - load[b] || a - b);
    const tried = new Set<string>();
    for (const j of candidates) {
      const key = `${load[j]}|${used[j]}|${slots[j].capModules}|${slots[j].mppts}`;
      if (tried.has(key)) continue;
      tried.add(key);
      if (++nodes > SEARCH_BUDGET) return 'exhausted';
      load[j] += n; used[j] += 1; at[i] = j;
      const r = go(k + 1);
      if (r === true || r === 'exhausted') return r;
      load[j] -= n; used[j] -= 1; at[i] = -1;
    }
    return false;
  };

  const r = go(0);
  if (r === 'exhausted') return 'exhausted';
  if (!r) return null;
  return { unitOf: at.map(j => slots[j].id) };
}

/**
 * The recommended assignment of the derived strings to the inverting units, or the reason there is
 * none. Deterministic; never exceeds a unit's published MPPT count or PV STC limit.
 */
export function recommendStringAssignment(input: StringAssignmentInput): StringAssignment {
  const { strings, moduleWatts, units } = input;
  if (strings.length === 0 || strings.some(n => !(Number.isInteger(n) && n > 0))) {
    return { ok: false, reason: 'The strings have not been derived yet, so there is nothing to assign.' };
  }
  if (!(typeof moduleWatts === 'number' && moduleWatts > 0)) {
    return { ok: false, reason: 'The module wattage is not established, so no unit’s PV limit can be checked.' };
  }
  if (units.length === 0) {
    return { ok: false, reason: 'There is no battery with PV inputs to land the strings on.' };
  }
  const unpublished = units.filter(u => !u.pvInputLimits);
  if (unpublished.length > 0) {
    const names = [...new Set(unpublished.map(u => u.label ?? u.productId ?? u.id))].join(', ');
    return { ok: false, reason: `${names} publishes no PV input limits. SolarPro does not recommend landing `
      + 'strings on an input it cannot check — assign them by hand once the limits are known.' };
  }
  const slots: Slot[] = units.map(u => ({
    id: u.id, capModules: maxModulesUnder(capW(u.pvInputLimits!), moduleWatts), mppts: u.pvInputLimits!.mppts,
  }));
  const mppts = slots.reduce((s, x) => s + x.mppts, 0);
  if (strings.length > mppts) {
    return { ok: false, reason: `${strings.length} strings need ${strings.length} MPPT inputs; the ${units.length} `
      + `unit${units.length === 1 ? '' : 's'} publish ${mppts}.` };
  }
  const kw = (w: number) => (w / 1000).toFixed(2);
  const totalW = stcW(strings.reduce((s, n) => s + n, 0), moduleWatts);
  const capTotalW = units.reduce((s, u) => s + capW(u.pvInputLimits!), 0);
  if (totalW > capTotalW) {
    return { ok: false, reason: `The array is ${kw(totalW)} kW STC; the units accept ${kw(capTotalW)} kW in total.` };
  }
  const largest = Math.max(...strings);
  const maxCapW = Math.max(...units.map(u => capW(u.pvInputLimits!)));
  if (stcW(largest, moduleWatts) > maxCapW) {
    return { ok: false, reason: `A ${largest}-module string (${kw(stcW(largest, moduleWatts))} kW STC) is more than `
      + `any unit accepts (${kw(maxCapW)} kW).` };
  }
  const found = search(strings, slots, false);
  if (!found || found === 'exhausted') {
    return { ok: false, reason: 'No assignment fits every unit’s published PV inputs (MPPT count and kW STC). '
      + 'Assign the strings by hand, or revise the string design.' };
  }
  const perUnit = stringsPerUnit(strings, found.unitOf, slots.map(s => s.id));
  return { ok: true, unitOf: found.unitOf, perUnit, unitKw: unitKwOf(perUnit, moduleWatts) };
}

/**
 * Read a RECORDED landing back as "string i → unit", when the graph's per-unit PV STC can be
 * reproduced exactly from the derived strings. Null when nothing is recorded, or when the record no
 * longer matches these strings (the design changed) — it is then shown as recorded, not guessed at.
 */
export function recordedStringAssignment(input: StringAssignmentInput): string[] | null {
  const { strings, moduleWatts, units } = input;
  if (strings.length === 0 || !(typeof moduleWatts === 'number' && moduleWatts > 0) || units.length === 0) return null;
  if (units.some(u => u.pvDcStcKw === null || u.pvDcStcKw === undefined)) return null;
  const slots: Slot[] = [];
  for (const u of units) {
    const recordedW = Math.round((u.pvDcStcKw as number) * 1000);
    const m = Math.round(recordedW / moduleWatts);
    // A record no whole number of these modules produces is not a landing of these strings.
    if (stcW(m, moduleWatts) !== recordedW) return null;
    // The record is read back as it is — not bounded by MPPTs, so an over-full unit shows as one.
    slots.push({ id: u.id, capModules: m, mppts: strings.length });
  }
  const found = search(strings, slots, true);
  return found && found !== 'exhausted' ? found.unitOf : null;
}

/** Do two assignments land every string on the same unit? */
export const sameAssignment = (a: readonly (string | null | undefined)[] | null, b: readonly (string | null | undefined)[] | null) =>
  !!a && !!b && a.length === b.length && a.every((u, i) => !!u && u === b[i]);
