// ═══════════════════════════════════════════════════════════════════════════
// ONE PERCENTAGE SEMANTIC, FOR A FIELD THAT HAS TWO.
//
// `efficiency` means different things in two places, and both reach renderers:
//
//     lib/equipment-db.ts          efficiency: 97.0    // PERCENT — `// %`
//     system.inverters[].efficiency        0.97        // FRACTION
//
// so `${inv.efficiency}%` printed `0.97%` on the equipment schedule — an
// inverter that throws away 99% of the power it is given.
//
// ─── WHY THIS IS NOT A BLIND MULTIPLY ──────────────────────────────────────
// "If it is small, times a hundred" is how a 9.7 becomes 970. The rule here is
// BOUNDED by the physics of the quantity:
//
//   * a conversion efficiency is a ratio in (0, 1]; as a percent it is (0, 100]
//   * a value in (0, 1] can only be a fraction — no inverter or module is 1%
//   * a value in (1, 100] is already a percent
//   * anything else is neither, and this refuses to print it as a number
//
// The refusal matters: the codebase has already shipped a "25.8% efficiency
// (physically impossible for silicon)" caused by a fabricated module size. A
// normaliser that silently rescales anything would have hidden that instead of
// letting it show.
// ═══════════════════════════════════════════════════════════════════════════

/** Printed in place of a number that cannot be a percentage. */
export const PERCENT_NOT_AVAILABLE = '—';

/**
 * Normalise an efficiency-like ratio to PERCENT, or null when the input is not
 * a percentage at all.
 *
 * Returns null — never a guess — for NaN, non-finite, <= 0 and > 100.
 */
export function toPercent(value: unknown): number | null {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return null;
  if (n <= 1) return n * 100;     // unambiguously a fraction
  if (n <= 100) return n;         // already a percent
  return null;                    // 970, 9700 — not a percentage; refuse it
}

/** `"97.0%"`, or the honest dash. `digits` defaults to 1 — CEC weighted
 *  efficiencies are quoted to a tenth. */
export function percentLabel(value: unknown, digits = 1): string {
  const p = toPercent(value);
  return p == null ? PERCENT_NOT_AVAILABLE : `${p.toFixed(digits)}%`;
}
