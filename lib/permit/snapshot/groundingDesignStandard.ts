// ═══════════════════════════════════════════════════════════════════════════
// P13 WS-1 — THE ARRAY / RACKING BONDING DESIGN STANDARD.
//
// NEC 250.122 sets a MINIMUM equipment-grounding-conductor size. Installing a
// larger conductor is permitted and is ordinary practice for array bonding,
// where the conductor is bare, handled on a roof, and terminated at lay-in lugs.
//
// This module exists so the DESIGN SELECTION has a named, single source that is
// obviously NOT a code result. The failure it prevents is the one this campaign
// called out explicitly: a planset stating "NEC 250.122 requires #10" for a 20 A
// branch, when the table requires #12 and #10 is the installer's standard. Both
// numbers are legitimate; only one of them is the code table's answer, and the
// snapshot stores them in separate fields (calculatedMinimumSize vs
// selectedDesignSize) with the selection carrying its own source and reason.
//
// A project-level override belongs here too when one is introduced — the
// accessor is the seam, so no renderer ever hardcodes a bonding size again.
// ═══════════════════════════════════════════════════════════════════════════

/** The company/project standard conductor for array + racking bonding. */
export const ARRAY_RACK_BONDING_DESIGN_SIZE = '#10 AWG';

/** Human-readable source of that selection, for the record's provenance. */
export const ARRAY_RACK_BONDING_DESIGN_SOURCE = 'project design standard (array/racking bonding)';

/** AWG ordering for "is the installed conductor at least the code minimum?".
 *  Larger conductor ⇒ SMALLER AWG number, so the comparison is on this index and
 *  never on string equality or numeric parsing of the label. */
const AWG_ASCENDING_AREA = [
  '#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG', '#3 AWG',
  '#2 AWG', '#1 AWG', '#1/0 AWG', '#2/0 AWG', '#3/0 AWG', '#4/0 AWG',
];

/** Index of a conductor label in ascending cross-sectional area, or -1. */
export function conductorAreaRank(size: string | null | undefined): number {
  if (!size) return -1;
  const norm = String(size).trim().toUpperCase().replace(/\s+/g, ' ');
  return AWG_ASCENDING_AREA.findIndex(s => s.toUpperCase() === norm);
}

/**
 * Is `installed` at least as large as the code `minimum`?
 * Unknown labels (rank -1) return true — this is an invariant check, not a
 * conductor catalogue, and it must never fail a package over an unrecognised
 * size string. The snapshot validator uses it to refuse an under-sized record.
 */
export function meetsOrExceedsMinimum(
  installed: string | null | undefined,
  minimum: string | null | undefined,
): boolean {
  const i = conductorAreaRank(installed);
  const m = conductorAreaRank(minimum);
  if (i < 0 || m < 0) return true;
  return i >= m;
}
