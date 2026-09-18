// ═══════════════════════════════════════════════════════════════════════════
// THE PER-SHEET RELEASE BANNER — RETIRED 2026-09-18, RAY'S RULING.
//
// This rendered a red status box at the top of PV-1 / PV-1B / PV-3 / PV-4C /
// PV-4C.1: a phase headline, a "PRELIMINARY — NOT FOR CONSTRUCTION · NOT FOR
// PERMIT SUBMISSION" line, the package gate totals, a pointer at RS-1, and a
// bulleted list of outstanding requirements.
//
//     "I tell you to get rid of that shit and you change the words entirely.
//      I said get rid of that bullshit. We know that this isn't ready for
//      permits. I need to send this to the guy who will stamp it."
//
// An earlier pass removed the gate counters and the RS-1 pointer and REWORDED
// the rest. That missed the point: the box itself is the problem. This package
// is sent to an engineer TO BE STAMPED — that is what it is for. Papering every
// drawing with a warning that it is not yet stamped tells the reader nothing he
// does not already know, and it is the first thing a client sees.
//
// WHERE THE INFORMATION LIVES NOW — nothing was lost:
//   • RS-1 / RS-1.1, the internal design-review record, still enumerate every
//     open requirement, its responsible role, its resolution path and its
//     evidence, in full. Those sheets ARE in the design-review package that goes
//     to the engineer, and are excluded from the AHJ permit profile.
//   • Per-field engineering facts still print in place on the sheets that own
//     them — NOT ESTABLISHED, NOT OBSERVED, PENDING STRUCTURAL VERIFICATION —
//     because those are data a reviewer acts on, not status about the package.
//   • The title block still carries the issue state and the revision line, which
//     is ordinary drafting practice.
//
// The function is kept as a NO-OP rather than deleted so that any re-wiring is
// inert by construction: if a sheet is ever pointed back at it, it renders
// nothing instead of quietly restoring the box. Do not give it a body again.
// The PROJECTION it used to read (structuralBanner / bannerRequirementsForSheet
// in snapshot/structuralProjection.ts) is untouched and still feeds RS-1 and the
// release model.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitDesignSnapshot } from '../snapshot/types';
import type { PermitInput } from '../types';
import type { StructuralBanner } from '../snapshot/structuralProjection';

/**
 * RETIRED. Always returns '' — see the file header. Kept so that no call site
 * can resurrect the status box by accident.
 */
export function structuralBannerHtml(
  _src?: PermitDesignSnapshot | StructuralBanner | null | undefined,
  _opts?: { compact?: boolean; input?: PermitInput | null; sheetId?: string | null },
): string {
  return '';
}
