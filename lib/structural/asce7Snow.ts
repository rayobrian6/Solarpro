// ═══════════════════════════════════════════════════════════════════════════
// ASCE 7-22 §7 — THE ROOF SNOW LOAD, AND THE SLOPE FACTOR IT ACTUALLY USES
//
// ── THE DEFECT ────────────────────────────────────────────────────────────
// Both structural engines computed the slope factor as
//
//     const Cs = pitchDeg <= 5 ? 1.0 : Math.cos(pitchDeg × π/180);
//
// under a comment citing "ASCE 7-22 Section 7.4". cos(θ) is not any curve in
// Figure 7.4-1. The real factor depends on the roof's THERMAL condition and on
// whether its surface is SLIPPERY:
//
//   · a WARM roof (Ct ≤ 1.0) with an UNOBSTRUCTED SLIPPERY surface sheds snow,
//     so Cs falls linearly from 1.0 at 5° to 0 at 70°;
//   · a warm roof that is NOT slippery holds it: Cs = 1.0 to 30°, then falls
//     linearly to 0 at 70°.
//
// Asphalt shingle is the textbook non-slippery surface. On the audited job —
// 3.6:12 ≈ 16.5°, shingle, heated dwelling — the correct Cs is 1.0 and
// pf = 0.7 × 23.284 = 16.30 psf. The engine applied cos(16.5°) = 0.959 and
// published 15.6 psf: a 4.3% UNDERSTATEMENT of a design load, in the
// unconservative direction, on a number a plan reviewer recomputes in one line.
//
// ── THE RULE ──────────────────────────────────────────────────────────────
// The slope factor is read from the figure, the branch taken is RECORDED, and
// slipperiness is a property of the roof covering rather than an assumption. A
// covering nobody recognises is treated as NON-SLIPPERY, which is the
// conservative direction: it keeps the snow on the roof.
//
// Source: ASCE/SEI 7-22 §7.3 (pf), §7.4 and Figure 7.4-1 (Cs).
// ═══════════════════════════════════════════════════════════════════════════

/** Roof coverings ASCE 7 treats as UNOBSTRUCTED SLIPPERY surfaces (§7.4). */
const SLIPPERY_COVERINGS = [
  'metal', 'standing seam', 'slate', 'glass', 'rubber', 'membrane', 'bituminous membrane',
  'tpo', 'epdm', 'pvc membrane',
];

/**
 * Is this roof covering an unobstructed slippery surface?
 *
 * ASPHALT SHINGLE IS NOT. Nor is wood shake, tile, or a gravel-surfaced
 * built-up roof. An unrecognised covering returns false — the conservative
 * answer, because a non-slippery roof retains more snow.
 */
export function isSlipperyRoofSurface(roofCovering: string | null | undefined): boolean {
  const s = String(roofCovering ?? '').toLowerCase();
  if (!s) return false;
  // shingle / shake / tile are explicitly obstructed surfaces; check first so a
  // "metal shingle" does not read as slippery on the word "metal".
  if (/shingle|shake|tile|gravel|ballast/.test(s)) return false;
  return SLIPPERY_COVERINGS.some(k => s.includes(k));
}

export interface SnowSlopeFactor {
  Cs: number;
  /** true ⇒ the roof sheds; drives which curve of Fig. 7.4-1 applies. */
  slippery: boolean;
  /** the pitch at which Cs begins to fall for this curve. */
  breakDeg: number;
  /** the branch taken, for the sheet and the review record. */
  basis: string;
}

/**
 * ASCE 7-22 Figure 7.4-1 — the slope factor for a WARM roof (Ct ≤ 1.0).
 * `Ct > 1.0` (an unheated or ventilated cold roof) shifts the curves; those
 * cases are not asserted here and fall back to the warm-roof curve with the
 * basis saying so, rather than inventing a factor.
 */
export function snowSlopeFactor(pitchDeg: number, roofCovering: string | null | undefined, Ct = 1.0): SnowSlopeFactor {
  const slippery = isSlipperyRoofSurface(roofCovering);
  const breakDeg = slippery ? 5 : 30;
  const zeroDeg = 70;
  const p = Number.isFinite(pitchDeg) ? Math.max(0, pitchDeg) : 0;

  let Cs: number;
  if (p <= breakDeg) Cs = 1.0;
  else if (p >= zeroDeg) Cs = 0;
  else Cs = 1 - (p - breakDeg) / (zeroDeg - breakDeg);

  const surface = slippery ? 'unobstructed slippery' : 'non-slippery';
  const basis = Ct > 1.0
    ? `ASCE 7-22 Fig. 7.4-1, warm-roof curve applied to a ${surface} surface at ${p.toFixed(1)}° `
      + `(Ct = ${Ct.toFixed(1)} indicates a cold roof; the cold-roof curve is not asserted here)`
    : `ASCE 7-22 Fig. 7.4-1, warm roof (Ct = ${Ct.toFixed(1)}), ${surface} surface: `
      + `Cs = 1.0 to ${breakDeg}°, then linear to 0 at ${zeroDeg}°. At ${p.toFixed(1)}° ⇒ Cs = ${Cs.toFixed(3)}.`;

  return { Cs, slippery, breakDeg, basis };
}

export interface RoofSnowLoad {
  /** pf — flat-roof snow load, psf (§7.3). */
  flatRoofPsf: number;
  /** ps — sloped-roof snow load, psf (§7.4). */
  roofSnowPsf: number;
  Cs: number; Ce: number; Ct: number; Is: number;
  slippery: boolean;
  /** the full derivation, so the sheet can print what a reviewer would redo. */
  derivation: string;
}

/**
 * pf = 0.7 · Ce · Ct · Is · pg, then ps = Cs · pf.
 * Every factor is named and carried out, because "15.6 psf" with no derivation
 * is exactly how a cos(θ) slope factor survived behind a §7.4 citation.
 */
export function calcRoofSnow(args: {
  groundSnowPsf: number;
  pitchDeg: number;
  roofCovering?: string | null;
  Ce?: number; Ct?: number; Is?: number;
}): RoofSnowLoad {
  const Ce = args.Ce ?? 1.0;
  const Ct = args.Ct ?? 1.0;
  const Is = args.Is ?? 1.0;
  const pg = Number.isFinite(args.groundSnowPsf) ? args.groundSnowPsf : 0;
  const slope = snowSlopeFactor(args.pitchDeg, args.roofCovering, Ct);
  const flatRoofPsf = 0.7 * Ce * Ct * Is * pg;
  const roofSnowPsf = slope.Cs * flatRoofPsf;
  return {
    flatRoofPsf, roofSnowPsf,
    Cs: slope.Cs, Ce, Ct, Is,
    slippery: slope.slippery,
    derivation:
      `pf = 0.7 × Ce ${Ce.toFixed(1)} × Ct ${Ct.toFixed(1)} × Is ${Is.toFixed(1)} × pg ${pg.toFixed(2)} psf `
      + `= ${flatRoofPsf.toFixed(2)} psf (ASCE 7-22 §7.3); `
      + `ps = Cs ${slope.Cs.toFixed(3)} × pf = ${roofSnowPsf.toFixed(2)} psf. ${slope.basis}`,
  };
}
