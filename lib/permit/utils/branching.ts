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

/** MANUFACTURER's maximum branch OCPD for the model (Ray D-1: never exceeded;
 *  the snapshot validator fails closed on any branch above it). Enphase
 *  profiles carry the published figure; unknown models default to the 20 A
 *  standard residential branch basis. */
export function microBranchMaxOcpdA(inverterModel?: string | null, manufacturer?: string | null): number {
  const m = _norm(String(inverterModel ?? ''));
  let best: number | null = null;
  let bestLen = -1;
  for (const prof of ENPHASE_CAPABILITY_PROFILES) {
    const key = _norm(prof.modelName);
    if (key && m.includes(key) && key.length > bestLen) {
      const v = (prof.branchCircuit as { maxBranchOcpdA?: number } | undefined)?.maxBranchOcpdA;
      if (typeof v === 'number' && v > 0) { best = v; bestLen = key.length; }
    }
  }
  return best ?? 20;
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
  /** Plane-facing stamp — the geometric plane-grouping fallback when
   *  planeId/arrayId are absent (production payloads). */
  azimuth?: number | null;
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
 * BRANCH PLAN — Ray's binding D-1 ruling (2026-07-20, PermitDesignSnapshot
 * campaign): MANUFACTURER AUTHORITY governs. Branch count = ceil(N / the
 * manufacturer's max units per branch), sizes balanced, and the assignment
 * optimizes ROUTING (plane-contiguous serpentine walk, nearest-plane chain)
 * while never letting physical roof grouping define an electrical branch
 * boundary. 31 IQ8A → 11/10/10 @ 20 A. Economy still holds (minimum
 * homeruns — Ray 2026-07-03), but no plane rule may create an extra branch
 * or an over-limit branch.
 *
 * Wave 2d SUB-SYSTEM FENCING (Invariant I-4) is unchanged: panels partition
 * by placement-stamped systemType FIRST (roof → ground → fence) and the plan
 * runs WITHIN each sub-system — a fence panel never shares an AC branch with
 * a roof panel.
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

  // Plane membership = the 3D design's truth (Ray, 2026-07-20: "look at the
  // roof layout… that logic should be the source of truth, obtained from 3d
  // design"). planeId/arrayId when stamped; production payloads often arrive
  // without them, but every placed panel carries its plane's AZIMUTH stamp —
  // bucket by facing (45° sectors) so a hip roof's N/S/E/W faces group
  // correctly instead of collapsing into one global pool.
  const keyOf = (p: BranchPlanPanel) => {
    const k = p.planeId ?? p.arrayId;
    if (k != null && String(k) !== '') return String(k);
    const az = Number((p as { azimuth?: number | null }).azimuth);
    return isFinite(az) ? 'az' + ((Math.round((((az % 360) + 360) % 360) / 45) * 45) % 360) : '';
  };
  const groups = new Map<string, BranchPlanPanel[]>();
  for (const p of panels) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }

  // ═══ D-1 MANUFACTURER-AUTHORITY PLAN (Ray's binding ruling 2026-07-20) ═══
  // "Physical roof grouping does not define electrical branch boundaries. The
  // branch-assignment engine must optimize routing while satisfying
  // manufacturer limits." Supersedes the plane-contained split, the
  // single-branch-per-plane ×1.5/30 A allowance, and the tiny-cap merge rules.
  //
  //   1. Branch count = ceil(N / manufacturer maxPerBranch) — the minimum
  //      legal homerun count. 31 IQ8A (max 11) → 3 branches.
  //   2. Sizes are BALANCED (11/10/10, never 11/11/9-runt shapes).
  //   3. ROUTING: planes are a routing preference only. Order planes largest
  //      first, then chain each next plane by nearest centroid; serpentine
  //      within each plane; concatenate into one walk and chunk it into the
  //      balanced sizes. Branches stay plane-contiguous except at chunk
  //      boundaries, where a branch may cross onto the adjacent plane —
  //      which D-1 explicitly permits.
  //
  // Every branch is ≤ maxPer, so every branch OCPD is within the
  // manufacturer's published branch basis (validated fail-closed by the
  // snapshot validator, V5/V5a).
  const ordered: BranchPlanPanel[][] = [];
  {
    const remaining = [...groups.values()].sort((a, b) => b.length - a.length);
    let cursor = remaining.shift();
    while (cursor) {
      ordered.push(cursor);
      if (!remaining.length) break;
      const cc = centroid(cursor);
      let bi = 0, bd = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = distM(cc, centroid(remaining[i]));
        if (d < bd) { bd = d; bi = i; }
      }
      cursor = remaining.splice(bi, 1)[0];
    }
  }

  const walk: BranchPlanPanel[] = [];
  for (const group of ordered) walk.push(...serp(group));

  const k = Math.max(1, Math.ceil(walk.length / maxPer));
  const sizes = balancedBranchSizes(walk.length, k);
  let off = 0;
  sizes.forEach((sz, bi) => {
    for (let i = 0; i < sz; i++) assign.set(String(walk[off + i].id), bi);
    off += sz;
  });
  return { count: sizes.length || 1, sizes, assign };
}
