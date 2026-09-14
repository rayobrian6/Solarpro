// ═══════════════════════════════════════════════════════════════════════════
// THE FRAMING MEMBER, AS PRINTED. ONE PRODUCER.
//
// ─── WHAT WAS WRONG ────────────────────────────────────────────────────────
// FIVE sites supplied their own fallback for the SAME fact, and they did not
// agree:
//
//     lib/drafting/templates/roof.ts:1551        ... || '2×4'   <- the outlier
//     lib/drafting/templates/roof.ts:2067        ... || '2x6'
//     lib/drafting/sheetComposition.ts:568       ... || '2x6'
//     lib/permit/sections/structuralPages.ts:853 ... || '2×6'
//     lib/permit/utils/canonical.ts:321          ... || '2×6'
//
// so one package printed `2×4` in the MAIN HOME ROOF DESCRIPTION table and
// `2x6` in SYSTEM DATA — a plan reviewer reading one sheet was told two
// different member sizes for one roof.
//
// ─── THE ACTUAL TRUTH, TRACED ──────────────────────────────────────────────
// On the live Braidon row `project.rafterSize` is `undefined` and
// `project.framingType` is `'unknown'`. The canonical structural projection
// already says so out loud:
//
//     observedFramingLine   "FRAMING GEOMETRY NOT OBSERVED"
//     framingUnverified     true
//
// So BOTH literals were fabricated. The fix is not to choose between them —
// it is to stop inventing a member size that nobody observed.
//
// ─── OBSERVATION IS NOT VERIFICATION ───────────────────────────────────────
// This resolves what was OBSERVED. It says nothing about whether that framing
// has the CAPACITY to carry the array — that is `framingCapacityAuthority`
// (an archived document) and the EOR's review. A sheet printing a member size
// from here must still key a capacity claim on `framingUnverified`.
// ═══════════════════════════════════════════════════════════════════════════

/** Printed where a member size would go when none was ever observed. Matches
 *  the vocabulary of `observedFramingLine` so the sheets agree with each other. */
export const FRAMING_MEMBER_NOT_OBSERVED = 'NOT OBSERVED';

const norm = (v: unknown): string | null => {
  const s = (v ?? '').toString().trim();
  return s && s.toLowerCase() !== 'unknown' ? s : null;
};

/**
 * The nominal framing member as it may be PRINTED.
 *
 * Returns the observed size when the project actually carries one, and
 * `FRAMING_MEMBER_NOT_OBSERVED` otherwise. Never invents a size.
 */
export function resolveFramingMemberLabel(
  project: { rafterSize?: unknown; trussSize?: unknown } | null | undefined,
): string {
  return norm(project?.rafterSize) ?? norm(project?.trussSize) ?? FRAMING_MEMBER_NOT_OBSERVED;
}

/** True when the printed member is the honest placeholder rather than a size —
 *  so a caller can suppress a span/capacity sentence that would read as a
 *  conclusion drawn from a member nobody measured. */
export function isFramingMemberObserved(
  project: { rafterSize?: unknown; trussSize?: unknown } | null | undefined,
): boolean {
  return resolveFramingMemberLabel(project) !== FRAMING_MEMBER_NOT_OBSERVED;
}
