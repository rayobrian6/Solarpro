// lib/system/calcDcAcRatio.ts — Phase B2: Decision Consistency Lock
//
// Canonical DC/AC ratio computation used everywhere in the codebase.
// Eliminates all independent inline `dcKw / acKw` expressions.
//
// Rules:
//   - Returns 0 when acKw is 0 or falsy (avoids divide-by-zero).
//   - Both arguments are in the SAME unit (both kW or both W).
//   - Does NOT clamp or validate — callers compare the result against
//     DC_AC_TARGET constants from dcAcConstants.ts.

/**
 * Compute the DC/AC ratio for a solar system.
 *
 * @param dcKw  Total DC array power in kW (or W — unit must match acKw).
 * @param acKw  Total AC inverter output in kW (or W — unit must match dcKw).
 * @returns     dcKw / acKw, or 0 when acKw is 0 / falsy.
 */
export function calcDcAcRatio(dcKw: number, acKw: number): number {
  if (!acKw || acKw === 0) return 0;
  return dcKw / acKw;
}