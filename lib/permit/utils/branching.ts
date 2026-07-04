// ============================================================
// AC branch-circuit sizing for microinverter systems.
//
// One source of truth for "how many micros fit on a 20A branch"
// so PV-2B, the circuit schedule, and the E-1 SLD can never
// disagree. The old code hardcoded 16 everywhere — correct only
// for the lowest-output IQ8 units; an IQ8A tops out at 10 per
// NEC 80% loading (20A × 0.8 / 1.53A), so 4×14 on a 53-module
// IQ8A job was a plan-check red flag.
// ============================================================

import { ENPHASE_CAPABILITY_PROFILES } from '@/lib/system/brandCapabilities/enphase';

/** Conservative default when the model is unknown — matches IQ8+/IQ8 base
 *  territory without ever overselling a hotter unit. Never 16. */
const DEFAULT_MAX_PER_BRANCH = 13;

const _norm = (s: string) => s.toLowerCase().replace(/plus/g, '+').replace(/[^a-z0-9+]/g, '');

/**
 * Max microinverters on a standard 20A/240V branch for the given model.
 * Longest-model-name match wins ('IQ8AC' must not resolve via 'IQ8A').
 */
export function microMaxPerBranch(inverterModel?: string | null): number {
  const m = _norm(String(inverterModel ?? ''));
  if (!m) return DEFAULT_MAX_PER_BRANCH;
  let best: number | null = null;
  let bestLen = -1;
  for (const prof of ENPHASE_CAPABILITY_PROFILES) {
    const key = _norm(prof.modelName);
    if (key && m.includes(key) && key.length > bestLen) {
      const v = prof.branchCircuit?.maxMicrosPerBranch;
      if (typeof v === 'number' && v > 0) { best = v; bestLen = key.length; }
    }
  }
  return best ?? DEFAULT_MAX_PER_BRANCH;
}

/** Branch count for a micro system: ceil(modules / per-model branch max). */
export function microBranchCount(totalModules: number, inverterModel?: string | null): number {
  if (!isFinite(totalModules) || totalModules <= 0) return 1;
  return Math.max(1, Math.ceil(totalModules / microMaxPerBranch(inverterModel)));
}

/**
 * Balanced branch sizes — first (total % n) branches get one extra module.
 * 53 modules / 6 branches → [9, 9, 9, 9, 9, 8], never [14, 14, 14, 11].
 */
export function balancedBranchSizes(totalModules: number, branchCount: number): number[] {
  const n = Math.max(1, branchCount);
  const base = Math.floor(totalModules / n);
  const extra = totalModules % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export interface BranchPlanPanel {
  id: string;
  planeId?: string | null;
  arrayId?: string | null;
  row?: number | null;
  col?: number | null;
  lat?: number;
  lng?: number;
}

export interface BranchPlan {
  /** Total AC branch circuits across the whole system. */
  count: number;
  /** Modules per branch, in branch order (B1..Bn). */
  sizes: number[];
  /** panel id → 0-based branch index. */
  assign: Map<string, number>;
}

/**
 * ECONOMICAL branch plan — installer common sense (Ray, 2026-07-03: "the
 * math needs to be logical... owners aren't going to spend extra money on
 * wire to run 5 strings of 4").
 *
 * Rules, in priority order:
 *   1. MINIMUM homeruns: branch count = ceil(total / per-model NEC max) —
 *      never more. Every extra branch is trunk cable, a terminator, and a
 *      breaker slot the owner pays for.
 *   2. Fill within a plane first: each face contributes floor(n/max) FULL
 *      branches wired serpentine on that face.
 *   3. Leftovers merge with the NEAREST leftover group (panel-centroid
 *      distance) — a hip-cap's 4 modules ride the adjacent face's remainder
 *      across one hip, not a runt branch of their own and never a diagonal
 *      run across the whole roof.
 *
 * Melvin (23/22/4/4 @ max 10): 10+10 north, 10+10 south, then 3N+4W and
 * 2S+4E → 6 branches total, the theoretical minimum.
 *
 * Plane grouping key: planeId, else arrayId; no keys at all → one global
 * group (legacy payloads — still NEC-sized, still minimal count).
 */
export function planMicroBranches(
  panels: BranchPlanPanel[],
  inverterModel?: string | null,
): BranchPlan {
  const maxPer = microMaxPerBranch(inverterModel);
  const assign = new Map<string, number>();
  if (!panels?.length) return { count: 1, sizes: [], assign };

  const serp = (group: BranchPlanPanel[]) => [...group].sort((a, b) => {
    const rr = (a.row ?? 0) - (b.row ?? 0);
    if (rr !== 0) return rr;
    const rev = ((a.row ?? 0) % 2) === 1;
    return rev ? (b.col ?? 0) - (a.col ?? 0) : (a.col ?? 0) - (b.col ?? 0);
  });
  const centroid = (ps: BranchPlanPanel[]) => {
    const v = ps.filter(p => isFinite(p.lat as any) && isFinite(p.lng as any));
    if (!v.length) return null;
    return {
      lat: v.reduce((s, p) => s + (p.lat as number), 0) / v.length,
      lng: v.reduce((s, p) => s + (p.lng as number), 0) / v.length,
    };
  };
  const distM = (a: ReturnType<typeof centroid>, b: ReturnType<typeof centroid>) => {
    if (!a || !b) return 0;
    const cos = Math.cos(a.lat * Math.PI / 180);
    return Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * cos);
  };

  const keyOf = (p: BranchPlanPanel) => String(p.planeId ?? p.arrayId ?? '');
  const groups = new Map<string, BranchPlanPanel[]>();
  for (const p of panels) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }

  // Largest plane first → B1 lands on the main field.
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length);

  const sizes: number[] = [];
  let branchIdx = 0;
  // Leftover runs (per plane, already in serpentine order) awaiting merge.
  const leftovers: Array<{ ps: BranchPlanPanel[]; c: ReturnType<typeof centroid> }> = [];

  for (const group of ordered) {
    const sorted = serp(group);
    const fulls = Math.floor(sorted.length / maxPer);
    for (let f = 0; f < fulls; f++) {
      for (let i = 0; i < maxPer; i++) assign.set(String(sorted[f * maxPer + i].id), branchIdx);
      sizes.push(maxPer);
      branchIdx++;
    }
    const rem = sorted.slice(fulls * maxPer);
    if (rem.length) leftovers.push({ ps: rem, c: centroid(rem) });
  }

  // Merge leftovers into EXACTLY ceil(R/max) remainder branches — the count
  // that keeps total homeruns at the theoretical minimum. Seed each branch
  // with the largest remaining leftover, then attach every other leftover to
  // the NEAREST seed with room (panel-centroid distance), so a hip cap joins
  // the face it actually touches instead of forming a runt branch or pairing
  // with the far side of the roof.
  if (leftovers.length) {
    const totalRem = leftovers.reduce((s, l) => s + l.ps.length, 0);
    const remBranches = Math.max(1, Math.ceil(totalRem / maxPer));
    leftovers.sort((a, b) => b.ps.length - a.ps.length);
    const seeds = leftovers.slice(0, remBranches);
    const rest = leftovers.slice(remBranches);
    // Balanced capacity: without a target cap, everything gravitates to one
    // seed and the other stays a runt — the exact waste being eliminated.
    const target = Math.ceil(totalRem / remBranches);
    for (const l of rest) {
      let best = -1, bestD = Infinity;
      for (const cap of [target, maxPer]) {
        for (let i = 0; i < seeds.length; i++) {
          if (seeds[i].ps.length + l.ps.length > cap) continue;
          const d = distM(seeds[i].c, l.c);
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0) break;
      }
      // Nothing fits even at NEC max (many tiny planes) → most room wins.
      if (best < 0) best = seeds.reduce((m, s, i) => s.ps.length < seeds[m].ps.length ? i : m, 0);
      seeds[best].ps.push(...l.ps);
      seeds[best].c = centroid(seeds[best].ps) ?? seeds[best].c;
    }
    for (const s of seeds) {
      for (const p of s.ps) assign.set(String(p.id), branchIdx);
      sizes.push(s.ps.length);
      branchIdx++;
    }
  }

  return { count: branchIdx || 1, sizes, assign };
}
