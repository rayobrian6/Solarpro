// ═══════════════════════════════════════════════════════════════
// Wave 6.3 — hybrid DO-NOT-SUBMIT banner retirement gate.
// docs/ARCHITECTURE-per-subsystem-equipment.md §3 Wave 6 + Addendum B.
//
// The Phase-0 banner flips OFF only when a COMPUTED condition holds —
// never a blind removal:
//
//   ready ⇔ per-sub STRUCTURAL authority present
//             (compliance.structural.subSystems[key] for EVERY present sub)
//         ∧ per-sub ELECTRICAL authority present
//             (conductorAuthority.subSystems covers every present sub)
//         ∧ the Wave-6 golden 3-brand hybrid fixture is green
//             (WAVE6_GOLDEN_FIXTURE_GREEN, backed by CI)
//
// A hybrid missing ANY sub's authority keeps the softened banner and the
// cover lists exactly what is missing. The Phase-0 loud console.warn in
// canonical.ts is intentionally KEPT — hybrid detection stays loud in logs
// even when the deliverable is submission-ready.
//
// Ray rulings that gated retirement are resolved (Addendum B, 2026-07-12):
//   1. shared trench / separate conduits (BOM dedups trench, never raceways);
//   2. legacy backfeed: always recompute (no freeze flag).
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { buildConductorAuthority } from '../utils/conductorAuthority';
import { hybridSheetSections, SUB_LABEL } from './subSystemSheets';
import type { SubSystemKey } from '../utils/subSystems';

/**
 * TRUE once tests/planset/wave6-golden-hybrid.test.ts (the contract's
 * acceptance case: Enphase micro roof + Solis string ground + SolFence
 * optimizer fence, three distinct panel models, full generatePermitHTML)
 * is green in CI. Flip to false to re-arm the banner fleet-wide without
 * touching the per-project authority checks.
 */
export const WAVE6_GOLDEN_FIXTURE_GREEN = true;

export interface HybridSubmissionGate {
  /** All present subs carry structural + electrical authority AND the golden fixture is green. */
  ready: boolean;
  /** Human-readable missing-authority items (empty when ready). */
  missing: string[];
  /** The present sub keys the gate evaluated (roof > ground > fence order). */
  presentKeys: SubSystemKey[];
}

/**
 * Compute the banner gate for one hybrid render. PURE read — no engine runs
 * besides the shared (pure) conductor authority builder every electrical
 * sheet already uses; identical inputs ⇒ identical verdict.
 */
export function hybridSubmissionGate(input: PermitInput, cad: CADModel): HybridSubmissionGate {
  const presentKeys = hybridSheetSections(cad).map(s => s.key);
  const missing: string[] = [];

  // ── Per-sub STRUCTURAL authority (stored by generatePermit's per-sub V4 loop) ──
  const structSubs = ((input.compliance?.structural as { subSystems?: Record<string, unknown> } | undefined)
    ?.subSystems) ?? {};
  for (const key of presentKeys) {
    if (!structSubs[key]) {
      missing.push(`${SUB_LABEL[key]} structural analysis (compliance.structural.subSystems.${key})`);
    }
  }

  // ── Per-sub ELECTRICAL authority (conductorAuthority.subSystems) ──
  try {
    const auth = buildConductorAuthority(input, cad);
    const authKeys = new Set((auth.subSystems ?? []).map(s => (s as { key?: string }).key));
    for (const key of presentKeys) {
      if (!authKeys.has(key)) {
        missing.push(`${SUB_LABEL[key]} conductor authority (conductorAuthority.subSystems.${key})`);
      }
    }
  } catch (e) {
    missing.push(`conductor authority computation failed (${(e as Error)?.message ?? e})`);
  }

  // ── Golden-fixture gate (CI-backed constant) ──
  if (!WAVE6_GOLDEN_FIXTURE_GREEN) {
    missing.push('Wave-6 golden hybrid fixture not yet green (tests/planset/wave6-golden-hybrid.test.ts)');
  }

  return { ready: missing.length === 0, missing, presentKeys };
}
