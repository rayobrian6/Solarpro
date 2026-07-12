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
import { TRUNK_CABLE_SYSTEMS } from '@/lib/equipment/trunkCable';
import { classifyPanel, type SubSystemPanel } from './subSystems';

/** Conservative default when the model is unknown — matches IQ8+/IQ8 base
 *  territory without ever overselling a hotter unit. Never 16. */
const DEFAULT_MAX_PER_BRANCH = 13;

const _norm = (s: string) => s.toLowerCase().replace(/plus/g, '+').replace(/[^a-z0-9+]/g, '');

// ── Wave 2d: non-Enphase capability profiles ────────────────────
// Model-family hints map a bare model string to its micro ecosystem when the
// caller has no manufacturer field. Sourced from the same single-source trunk
// catalog the BOM uses (lib/equipment/trunkCable.ts) — never a parallel table.
const NON_ENPHASE_MODEL_HINTS: Array<{ re: RegExp; brand: string }> = [
  { re: /(^|[^a-z0-9])(ds3|qs1|qt2|yc600)/, brand: 'APsystems' },
  { re: /(^|[^a-z0-9+])(hms|hmt|hm[0-9])/,  brand: 'Hoymiles' },
  { re: /(^|[^a-z0-9])bdm/,                 brand: 'NEP' },
];

/** Per-model branch max from the trunk-cable catalog (non-Enphase brands).
 *  Returns null when the model/manufacturer doesn't resolve to a cataloged
 *  non-Enphase micro ecosystem — callers then keep the legacy default. */
function nonEnphaseMaxPerBranch(normModel: string, manufacturer?: string | null): number | null {
  const mfr = String(manufacturer ?? '').trim().toLowerCase();
  let system = mfr
    ? TRUNK_CABLE_SYSTEMS.find(s =>
        mfr.includes(s.brand.toLowerCase()) || s.brand.toLowerCase().includes(mfr))
    : undefined;
  if (!system) {
    const hint = NON_ENPHASE_MODEL_HINTS.find(h => h.re.test(normModel));
    if (hint) system = TRUNK_CABLE_SYSTEMS.find(s => s.brand === hint.brand);
  }
  if (!system || system.brand === 'Enphase') return null; // Enphase = profile path
  // Longest-model-key match wins (mirror of the Enphase profile rule).
  let best: number | null = null;
  let bestLen = -1;
  for (const [key, v] of Object.entries(system.deviceBranchLimits ?? {})) {
    const nk = _norm(key);
    if (nk && normModel.includes(nk) && nk.length > bestLen) { best = v; bestLen = nk.length; }
  }
  return best ?? system.maxDevicesPerBranch;
}

/**
 * Max microinverters on a standard 20A/240V branch for the given model.
 * Longest-model-name match wins ('IQ8AC' must not resolve via 'IQ8A').
 * Wave 2d: non-Enphase micro ecosystems (APsystems/Hoymiles/NEP) resolve via
 * the trunk-cable catalog — an APsystems DS3 is 4/branch, never the Enphase-
 * shaped default of 13 (a 20 A-branch NEC violation for that hardware).
 */
export function microMaxPerBranch(inverterModel?: string | null, manufacturer?: string | null): number {
  const m = _norm(String(inverterModel ?? ''));
  if (!m && !manufacturer) return DEFAULT_MAX_PER_BRANCH;
  let best: number | null = null;
  let bestLen = -1;
  for (const prof of ENPHASE_CAPABILITY_PROFILES) {
    const key = _norm(prof.modelName);
    if (key && m.includes(key) && key.length > bestLen) {
      const v = prof.branchCircuit?.maxMicrosPerBranch;
      if (typeof v === 'number' && v > 0) { best = v; bestLen = key.length; }
    }
  }
  if (best != null) return best;
  return nonEnphaseMaxPerBranch(m, manufacturer) ?? DEFAULT_MAX_PER_BRANCH;
}

/** Branch count for a micro system: ceil(modules / per-model branch max). */
export function microBranchCount(totalModules: number, inverterModel?: string | null, manufacturer?: string | null): number {
  if (!isFinite(totalModules) || totalModules <= 0) return 1;
  return Math.max(1, Math.ceil(totalModules / microMaxPerBranch(inverterModel, manufacturer)));
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
  /** Placement-stamped sub-system provenance (Wave 2d fencing — a fence
   *  panel must NEVER share an AC branch with a roof panel). */
  systemType?: string;
  placementType?: string;
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
 *
 * Wave 2d SUB-SYSTEM FENCING (Invariant I-4): panels are partitioned by their
 * placement-stamped systemType FIRST (roof → ground → fence), and the plane/
 * array grouping + leftover-merge runs WITHIN each sub-system only. The
 * leftover-merge can therefore never join fence panels onto a roof branch.
 * Single-system payloads (every panel one sub) take the exact legacy path.
 */
export function planMicroBranches(
  panels: BranchPlanPanel[],
  inverterModel?: string | null,
  manufacturer?: string | null,
): BranchPlan {
  const maxPer = microMaxPerBranch(inverterModel, manufacturer);
  if (!panels?.length) return { count: 1, sizes: [], assign: new Map<string, number>() };

  // ── Sub-system fence: partition first, plan within each sub ────
  const subGroups: Record<'roof' | 'ground' | 'fence', BranchPlanPanel[]> =
    { roof: [], ground: [], fence: [] };
  for (const p of panels) subGroups[classifyPanel(p as unknown as SubSystemPanel)].push(p);
  const presentSubs = (['roof', 'ground', 'fence'] as const).filter(k => subGroups[k].length > 0);

  if (presentSubs.length <= 1) {
    return planBranchesWithinSub(panels, maxPer); // legacy single-system path, byte-identical
  }

  const assign = new Map<string, number>();
  const sizes: number[] = [];
  let offset = 0;
  for (const key of presentSubs) {
    const sub = planBranchesWithinSub(subGroups[key], maxPer);
    for (const [id, idx] of sub.assign) assign.set(id, idx + offset);
    sizes.push(...sub.sizes);
    offset += sub.sizes.length;
  }
  return { count: offset || 1, sizes, assign };
}

/** The pre-Wave-2d branch planner, unchanged — runs over ONE sub-system's
 *  panels (or the whole array on legacy single-system payloads). */
function planBranchesWithinSub(
  panels: BranchPlanPanel[],
  maxPer: number,
): BranchPlan {
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
