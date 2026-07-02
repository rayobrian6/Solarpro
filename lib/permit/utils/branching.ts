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
 * PLANE-AWARE branch plan — the installer-truth rule (Ray, 2026-07-03):
 * an AC branch is a physical daisy-chain on ONE roof face; crews do not run
 * a trunk over the ridge to the opposite side of the roof. So branches are
 * planned PER PLANE: each plane's modules chunk into ceil(n/max) balanced
 * branches, and a branch NEVER spans planes — small hip-cap planes get their
 * own (short) branch rather than piggybacking across the roof.
 *
 * Plane grouping key: planeId, else arrayId. When NO panel carries either
 * (legacy payloads), falls back to one global group (old behavior, still
 * NEC-sized). Plane order: largest first, so B1 is the main field. Within a
 * plane: serpentine (row, then col alternating) — the physical wiring order.
 */
export function planMicroBranches(
  panels: BranchPlanPanel[],
  inverterModel?: string | null,
): BranchPlan {
  const maxPer = microMaxPerBranch(inverterModel);
  const assign = new Map<string, number>();
  if (!panels?.length) return { count: 1, sizes: [], assign };

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
  for (const group of ordered) {
    // Serpentine within the plane (alternate col direction per row).
    const sorted = [...group].sort((a, b) => {
      const rr = (a.row ?? 0) - (b.row ?? 0);
      if (rr !== 0) return rr;
      const rev = ((a.row ?? 0) % 2) === 1;
      return rev ? (b.col ?? 0) - (a.col ?? 0) : (a.col ?? 0) - (b.col ?? 0);
    });
    const nBranches = Math.max(1, Math.ceil(sorted.length / maxPer));
    const planeSizes = balancedBranchSizes(sorted.length, nBranches);
    let cursor = 0;
    planeSizes.forEach(sz => {
      for (let i = 0; i < sz; i++) assign.set(String(sorted[cursor + i].id), branchIdx);
      cursor += sz;
      sizes.push(sz);
      branchIdx++;
    });
  }
  return { count: branchIdx || 1, sizes, assign };
}
