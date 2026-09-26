// ═══════════════════════════════════════════════════════════════════════════
// HOW MANY OF THIS DEVICE DOES THE PROJECT PHYSICALLY NEED?
//
// Ray, 2026-09-26: "Capacity determines multiplicity. Topology determines
// assignment." — do not model one device per site, per array, per brand or per
// system. Every device that has a physical limit states it here as a
// `CapacityProfile`; the design states what it asks of the device as a list of
// `CapacityLoad`s (one per branch circuit, string, battery…); this module
// answers with the number of device instances and which loads land on which.
//
// It knows nothing about any brand. A profile is a list of limits, a load is a
// list of demands against the same dimensions, and the answer is:
//
//   · count — the SMALLEST number of instances that can take every load whole
//     (a branch circuit is never split between two devices), never less than
//     ⌈Σ demand ÷ limit⌉ on any dimension;
//   · instances — which loads each instance takes, keeping a group (an array)
//     on one instance whenever that costs no extra instance, and otherwise
//     filling instances in design order (never an even split of amperes);
//   · bounds / governing — every limit's total, its ⌈Σ ÷ max⌉ and its source,
//     so a sheet can say WHY the count is what it is;
//   · oversized — a load no single instance can take (one branch over a limit):
//     it sits alone on an instance and is reported, never silently dropped.
//
// Pure, deterministic, no I/O. Brand adapters (e.g. lib/equipment/
// enphaseGatewayMultiplicity.ts) build the profile and the loads.
// ═══════════════════════════════════════════════════════════════════════════

/** A physical quantity one device instance can carry only so much of. */
export type CapacityDimension =
  /** Σ rated continuous AC output current of what lands on the instance (A). */
  | 'continuousCurrentA'
  /** Σ ratings of the branch-circuit OCPDs landing on the instance (A). */
  | 'branchOcpdSumA'
  /** 2-pole branch breaker positions used. */
  | 'branchPositions'
  /** Σ DC (STC) input power (W). */
  | 'dcInputW'
  /** Σ AC output power (W). */
  | 'acOutputW'
  /** MPPT inputs used. */
  | 'mpptInputs'
  /** String inputs (terminal pairs) used. */
  | 'stringInputs'
  /** Devices communicating through / controlled by the instance. */
  | 'devices'
  /** Battery units on one controller / PCS channel. */
  | 'batteryUnits';

export interface CapacityLimit {
  dimension: CapacityDimension;
  /** The most ONE instance may carry. > 0. */
  max: number;
  /** Where the number comes from, as a sheet would cite it. */
  source: string;
  basis: 'manufacturer' | 'installer-rule' | 'code';
}

export interface CapacityProfile {
  /** Catalogue id of the device (or topology) one instance is. */
  deviceId: string;
  /** e.g. "Enphase IQ Combiner 5C". */
  deviceLabel: string;
  /** What one instance is called on a drawing: 'GATEWAY', 'INVERTER'… */
  instanceNoun: string;
  limits: CapacityLimit[];
}

export interface CapacityLoad {
  /** Stable id, e.g. 'B3' or 'ground:B1'. */
  id: string;
  /** The array / lane this load belongs to. Loads of one group stay on one
   *  instance whenever that costs no extra instance. */
  group?: string;
  /** What this load takes of each dimension (absent ⇒ 0). */
  demand: Partial<Record<CapacityDimension, number>>;
}

export interface CapacityInstance {
  /** 1-based. */
  index: number;
  /** In design order. */
  loadIds: string[];
  /** Groups present on this instance, in design order. */
  groups: string[];
  /** Σ demand per limited dimension. */
  totals: Partial<Record<CapacityDimension, number>>;
}

export interface CapacityBound {
  dimension: CapacityDimension;
  total: number;
  max: number;
  /** ⌈total ÷ max⌉ — no arrangement can use fewer instances. */
  lowerBound: number;
  source: string;
  basis: CapacityLimit['basis'];
}

export interface MultiplicitySolution {
  deviceId: string;
  deviceLabel: string;
  instanceNoun: string;
  /** 0 ⇔ nothing to carry. */
  count: number;
  instances: CapacityInstance[];
  bounds: CapacityBound[];
  /**
   * What set the count: the limit whose ⌈Σ ÷ max⌉ equals it; 'packing' when
   * whole loads cannot be arranged into that many (a branch cannot be split);
   * 'oversized' when a load exceeds a limit on its own; 'none' for count ≤ 1
   * with nothing binding.
   */
  governing:
    | { kind: 'limit'; dimension: CapacityDimension; source: string; basis: CapacityLimit['basis'] }
    | { kind: 'packing' }
    | { kind: 'oversized' }
    | { kind: 'none' };
  /** Loads that exceed a limit on their own. Each sits alone on an instance. */
  oversized: Array<{ loadId: string; dimension: CapacityDimension; demand: number; max: number }>;
}

// Floating-point slack: 80 A of branches made of 1.21 A units must fit 80 A.
const EPS = 1e-9;
const fitsUnder = (value: number, max: number) => value <= max + EPS * Math.max(1, Math.abs(max));
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** The most loads of this demand vector's smallest members one instance can
 *  hold on one dimension — a pigeonhole bound that ⌈Σ ÷ max⌉ misses when every
 *  load is just over max ÷ k (16 × 15 A on 80 A: 5 per instance, so 4 not 3). */
function maxItemsPerInstance(values: number[], max: number): number {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
  let sum = 0;
  let n = 0;
  for (const v of sorted) {
    if (!fitsUnder(sum + v, max)) break;
    sum += v;
    n++;
  }
  return n;
}

interface PackState {
  bins: number[][];     // per bin, per limit index: Σ demand
  members: number[][];  // per bin: load indices
}

/** Exact feasibility of k instances by depth-first search with symmetry
 *  breaking; null when infeasible or the node budget runs out. */
function packExactly(
  loads: number[][], limits: CapacityLimit[], k: number, budget: { nodes: number },
): number[][] | null {
  const n = loads.length;
  // Hardest first: the largest share of any one limit.
  const order = loads.map((d, i) => ({ i, s: Math.max(0, ...d.map((v, j) => v / limits[j].max)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.i);
  const state: PackState = { bins: [], members: [] };
  const place = (pos: number): boolean => {
    if (pos === n) return true;
    if (--budget.nodes < 0) return false;
    const li = order[pos];
    const d = loads[li];
    const seen = new Set<string>();
    for (let b = 0; b < state.bins.length; b++) {
      const bin = state.bins[b];
      const key = bin.map(round6).join('|');
      if (seen.has(key)) continue;   // an identical bin was already tried
      seen.add(key);
      if (!d.every((v, j) => fitsUnder(bin[j] + v, limits[j].max))) continue;
      d.forEach((v, j) => { bin[j] += v; });
      state.members[b].push(li);
      if (place(pos + 1)) return true;
      state.members[b].pop();
      d.forEach((v, j) => { bin[j] -= v; });
      if (budget.nodes < 0) return false;
    }
    if (state.bins.length < k) {
      state.bins.push(d.slice());
      state.members.push([li]);
      if (place(pos + 1)) return true;
      state.bins.pop();
      state.members.pop();
    }
    return false;
  };
  return place(0) ? state.members.map(m => m.slice().sort((a, b) => a - b)) : null;
}

/** First-fit decreasing — always a valid packing, used when the exact search
 *  runs out of budget. */
function packFirstFitDecreasing(loads: number[][], limits: CapacityLimit[]): number[][] {
  const order = loads.map((d, i) => ({ i, s: Math.max(0, ...d.map((v, j) => v / limits[j].max)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.i);
  const bins: number[][] = [];
  const members: number[][] = [];
  for (const li of order) {
    const d = loads[li];
    let b = bins.findIndex(bin => d.every((v, j) => fitsUnder(bin[j] + v, limits[j].max)));
    if (b < 0) { bins.push(d.map(() => 0)); members.push([]); b = bins.length - 1; }
    d.forEach((v, j) => { bins[b][j] += v; });
    members[b].push(li);
  }
  return members.map(m => m.sort((a, b) => a - b));
}

/**
 * The arrangement a drawing reads best, at exactly `k` instances, or null when
 * this rule cannot reach k: whole groups on one instance where they fit (first
 * fit, in design order, opening a new instance only while fewer than k are
 * open), a group too big for any one instance filled in design order.
 */
function packGroupsInOrder(
  loads: number[][], groups: string[], limits: CapacityLimit[], k: number, fillOnly: boolean,
): number[][] | null {
  const bins: number[][] = [];
  const members: number[][] = [];
  const fits = (b: number, d: number[]) => d.every((v, j) => fitsUnder(bins[b][j] + v, limits[j].max));
  const add = (b: number, li: number) => { loads[li].forEach((v, j) => { bins[b][j] += v; }); members[b].push(li); };
  const open = () => { bins.push(limits.map(() => 0)); members.push([]); return bins.length - 1; };

  const groupOrder: string[] = [];
  const byGroup = new Map<string, number[]>();
  loads.forEach((_d, i) => {
    const g = fillOnly ? '' : groups[i];
    if (!byGroup.has(g)) { byGroup.set(g, []); groupOrder.push(g); }
    byGroup.get(g)!.push(i);
  });

  for (const g of groupOrder) {
    const idx = byGroup.get(g)!;
    const sum = limits.map((_l, j) => idx.reduce((s, i) => s + loads[i][j], 0));
    // Whole group on one instance.
    let target = -1;
    for (let b = 0; b < bins.length && target < 0; b++) {
      if (sum.every((v, j) => fitsUnder(bins[b][j] + v, limits[j].max))) target = b;
    }
    if (target < 0 && bins.length < k && sum.every((v, j) => fitsUnder(v, limits[j].max))) target = open();
    if (target >= 0) { idx.forEach(i => add(target, i)); continue; }
    // Too big for one instance: fill in design order — the last open instance
    // first, then new ones.
    for (const i of idx) {
      let b = bins.length ? bins.length - 1 : -1;
      if (b < 0 || !fits(b, loads[i])) {
        b = -1;
        for (let c = 0; c < bins.length && b < 0; c++) if (fits(c, loads[i])) b = c;
      }
      if (b < 0) {
        if (bins.length >= k) return null;
        b = open();
        if (!fits(b, loads[i])) return null;
      }
      add(b, i);
    }
  }
  return bins.length === k ? members : null;
}

export interface SolveOptions {
  /** DFS node budget for the exact search (default 200 000). */
  nodeBudget?: number;
}

/**
 * Solve how many instances of `profile` the `loads` need, and which loads land
 * on each. See the block comment at the top of this file.
 */
export function solveMultiplicity(
  profile: CapacityProfile,
  loads: readonly CapacityLoad[],
  options: SolveOptions = {},
): MultiplicitySolution {
  const limits = profile.limits.filter(l => Number.isFinite(l.max) && l.max > 0);
  const base = {
    deviceId: profile.deviceId, deviceLabel: profile.deviceLabel, instanceNoun: profile.instanceNoun,
  };
  const vectors = loads.map(l => limits.map(lim => Math.max(0, Number(l.demand[lim.dimension] ?? 0) || 0)));
  const groups = loads.map(l => l.group ?? '');

  const bounds: CapacityBound[] = limits.map((lim, j) => {
    const total = round6(vectors.reduce((s, v) => s + v[j], 0));
    return {
      dimension: lim.dimension, total, max: lim.max,
      lowerBound: total > EPS ? Math.ceil(total / lim.max - EPS) : 0,
      source: lim.source, basis: lim.basis,
    };
  });

  if (loads.length === 0) {
    return { ...base, count: 0, instances: [], bounds, governing: { kind: 'none' }, oversized: [] };
  }

  // A load over a limit on its own: it takes an instance by itself and is reported.
  const oversized: MultiplicitySolution['oversized'] = [];
  const fitIdx: number[] = [];
  const aloneIdx: number[] = [];
  vectors.forEach((v, i) => {
    const over = v.findIndex((x, j) => !fitsUnder(x, limits[j].max));
    if (over >= 0) {
      oversized.push({ loadId: loads[i].id, dimension: limits[over].dimension, demand: v[over], max: limits[over].max });
      aloneIdx.push(i);
    } else {
      fitIdx.push(i);
    }
  });

  const sub = fitIdx.map(i => vectors[i]);
  const subGroups = fitIdx.map(i => groups[i]);
  // Lower bound: ⌈Σ ÷ max⌉ and the pigeonhole bound, over every limit.
  let lower = sub.length ? 1 : 0;
  limits.forEach((lim, j) => {
    const vals = sub.map(v => v[j]);
    const total = vals.reduce((s, x) => s + x, 0);
    if (total > EPS) lower = Math.max(lower, Math.ceil(total / lim.max - EPS));
    const perInst = maxItemsPerInstance(vals, lim.max);
    const nonZero = vals.filter(x => x > 0).length;
    if (perInst > 0 && nonZero > 0) lower = Math.max(lower, Math.ceil(nonZero / perInst));
  });

  let members: number[][] = [];
  if (sub.length) {
    const ffd = packFirstFitDecreasing(sub, limits);
    let k = lower;
    let found: number[][] | null = null;
    const budget = { nodes: options.nodeBudget ?? 200_000 };
    for (; k < ffd.length && !found; k++) {
      found = packExactly(sub, limits, k, budget);
      if (!found && budget.nodes < 0) break;   // out of budget: FFD is the answer
      if (found) break;
    }
    const count = found ? k : ffd.length;
    // The arrangement a drawing reads best at that count.
    members = packGroupsInOrder(sub, subGroups, limits, count, false)
      ?? packGroupsInOrder(sub, subGroups, limits, count, true)
      ?? found
      ?? ffd;
    // Back to the caller's indices.
    members = members.map(m => m.map(x => fitIdx[x]));
  }
  for (const i of aloneIdx) members.push([i]);
  // Instances in design order of their first load.
  members = members.map(m => m.slice().sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);

  const instances: CapacityInstance[] = members.map((m, idx) => {
    const totals: Partial<Record<CapacityDimension, number>> = {};
    limits.forEach((lim, j) => { totals[lim.dimension] = round6(m.reduce((s, i) => s + vectors[i][j], 0)); });
    const gs: string[] = [];
    for (const i of m) if (loads[i].group != null && !gs.includes(loads[i].group!)) gs.push(loads[i].group!);
    return { index: idx + 1, loadIds: m.map(i => loads[i].id), groups: gs, totals };
  });

  const count = instances.length;
  const binding = bounds
    .filter(b => b.lowerBound === count && count > 1)
    // The tightest limit first: highest utilisation of its own capacity.
    .sort((a, b) => (b.total / (b.max * count)) - (a.total / (a.max * count)))[0];
  const governing: MultiplicitySolution['governing'] =
    oversized.length ? { kind: 'oversized' }
    : binding ? { kind: 'limit', dimension: binding.dimension, source: binding.source, basis: binding.basis }
    : count > 1 ? { kind: 'packing' }
    : { kind: 'none' };

  return { ...base, count, instances, bounds, governing, oversized };
}

const DIMENSION_WORDS: Record<CapacityDimension, { what: string; unit: string }> = {
  continuousCurrentA: { what: 'continuous output current', unit: 'A' },
  branchOcpdSumA: { what: 'total branch breaker rating', unit: 'A' },
  branchPositions: { what: 'branch breaker positions', unit: '' },
  dcInputW: { what: 'DC input', unit: 'W' },
  acOutputW: { what: 'AC output', unit: 'W' },
  mpptInputs: { what: 'MPPT inputs', unit: '' },
  stringInputs: { what: 'string inputs', unit: '' },
  devices: { what: 'devices', unit: '' },
  batteryUnits: { what: 'battery units', unit: '' },
};

const fmt = (x: number) => (Math.abs(x - Math.round(x)) < 1e-6 ? String(Math.round(x)) : x.toFixed(2));

/** One sentence a sheet can print: why this many. */
export function explainMultiplicity(s: MultiplicitySolution): string {
  const noun = s.deviceLabel;
  if (s.count === 0) return `No ${noun} required.`;
  const head = `${s.count} × ${noun}`;
  if (s.governing.kind === 'limit') {
    const g = s.governing;
    const b = s.bounds.find(x => x.dimension === g.dimension)!;
    const w = DIMENSION_WORDS[g.dimension];
    return `${head}: ${w.what} ${fmt(b.total)}${w.unit ? ` ${w.unit}` : ''} exceeds the `
      + `${fmt(b.max)}${w.unit ? ` ${w.unit}` : ''} one instance supports (${g.source}).`;
  }
  if (s.governing.kind === 'packing') {
    return `${head}: whole circuits cannot be arranged onto fewer without exceeding a limit `
      + '(a circuit is never split between two devices).';
  }
  if (s.governing.kind === 'oversized') {
    const o = s.oversized[0];
    const w = DIMENSION_WORDS[o.dimension];
    return `${head}: ${o.loadId} alone needs ${fmt(o.demand)}${w.unit ? ` ${w.unit}` : ''} of ${w.what}, `
      + `over the ${fmt(o.max)}${w.unit ? ` ${w.unit}` : ''} limit — redesign required.`;
  }
  return `${head}: within every limit of one instance.`;
}
