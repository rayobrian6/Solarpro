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
