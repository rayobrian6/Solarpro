/**
 * stdSizes.ts — THE one standard-sizes ladder (DATA-AUTHORITY-AUDIT P0-5c / P2-2).
 *
 * Every OCPD / fuse / breaker / disconnect-enclosure "next standard size"
 * lookup in the pipeline resolves through THIS module. Do NOT copy these
 * arrays into another file: 13 divergent copies (missing 110A, capped at
 * 150/200/400, undersized fallbacks) are exactly the defect class this file
 * retires. If a call site has a legitimate PHYSICAL ceiling (fuse class,
 * enclosure family), express it with boundedLadder(maxA) and a comment —
 * never a shorter re-typed array.
 */

/** NEC 240.6(A) standard ampere ratings for fuses and inverse-time breakers,
 *  through 1200 A. (240.6(A) continues 1600–6000 A; extend here if a design
 *  ever needs it — nextStandardOcpd falls back to next-100A above the table.)
 *  DO NOT use Math.ceil(x/5)*5 — 55, 65, 75, 85, 95 A are NOT standard. */
export const NEC_STANDARD_OCPD = [
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175,
  200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1200,
] as const;

/** Next standard NEC 240.6(A) rating ≥ amps. Must NEVER return below the
 *  requested ampacity (NEC 240.4) — above the table, round up to the next
 *  100 A. */
export function nextStandardOcpd(amps: number): number {
  return NEC_STANDARD_OCPD.find(s => s >= amps) ?? Math.ceil(amps / 100) * 100;
}

/** Largest standard NEC 240.6(A) rating ≤ amps (main-breaker derate
 *  suggestions, NEC 705.12(B)(3)(2)). Floors at 15 A. */
export function prevStandardOcpd(amps: number): number {
  for (let i = NEC_STANDARD_OCPD.length - 1; i >= 0; i--) {
    if (NEC_STANDARD_OCPD[i] <= amps) return NEC_STANDARD_OCPD[i];
  }
  return 15;
}

/** Standard safety-switch / disconnect ENCLOSURE ratings (residential /
 *  light-commercial catalog — Square D DU/Eaton DPF families). This is a
 *  hardware-availability ladder, distinct from the OCPD ladder. */
export const STD_DISCONNECT_ENCLOSURES = [30, 60, 100, 200, 400, 600] as const;

/** Next standard disconnect enclosure ≥ amps; above 600 A round up to the
 *  next 100 A (engineered switchboard territory). */
export function nextEnclosure(amps: number): number {
  return STD_DISCONNECT_ENCLOSURES.find(e => e >= amps) ?? Math.ceil(amps / 100) * 100;
}

/** The NEC 240.6(A) ladder truncated at an EXPLICIT physical ceiling
 *  (e.g. a fuse-class or breaker-frame maximum). Use this — with a comment
 *  naming the ceiling — instead of re-typing a shorter array. */
export function boundedLadder(maxA: number): number[] {
  return NEC_STANDARD_OCPD.filter(s => s <= maxA);
}
