// ═══════════════════════════════════════════════════════════════
// Attachment Capacity — ONE source of truth for the rooftop PV
// attachment (foot / standoff) uplift design check, normalized so
// EVERY brand/component sizes consistently.
//
// The problem it fixes: mount uplift ratings in the hardware catalog
// are published on DIFFERENT bases — some ULTIMATE (mean load-to-
// failure), some ALLOWABLE (ASD, safety factor already applied). The
// structural engine applied a single hardcoded SF (2.0) to all of
// them, so an allowable-basis mount (e.g. IronRidge FlashFoot2, whose
// published number is already the ASD allowable) was charged a second
// safety factor — ~3.3× over-conservative — while an ultimate-basis
// mount was about right. Two designs under identical load reported
// very different attachment counts purely from the basis mismatch.
//
// Correct check (ASCE 7-22 §2.4, ASD): the attachment demand is the
// ASD net uplift 0.6·W − 0.6·D over the mount's tributary area, and
// the capacity is the ASD ALLOWABLE. ASCE 7-22 wind pressures are
// STRENGTH level, so the 0.6 converts them to ASD. For ultimate-basis
// ratings, allowable = ultimate / Ω.
//
//   T_asd = 0.6 · W_strength · tributary   (dead relief 0.6·D omitted → conservative)
//   P_allow = basis==='allowable' ? capacity : capacity / Ω
//   PASS ⟺ T_asd ≤ P_allow      (reported SF = P_allow / T_asd, PASS ≥ 1.0)
//
// Sources: IronRidge FlashFoot2 Certification Letter (3,203 lb avg
// ultimate → 1,067 lb allowable via SF 3.0, ASTM D1761-12); CA DSA
// IR 16-8 / ICC-ES AC428 §3.2.5 (allowable = avg of 4 tests ÷ 3);
// ASCE 7-22 §2.4 (0.6D + 0.6W). See
// lib/data/structural/attachment-capacity-basis-research.json.
// ═══════════════════════════════════════════════════════════════

export type CapacityBasis = 'ultimate' | 'allowable';

/**
 * Ultimate → ASD-allowable safety factor for tension/withdrawal-governed
 * attachments (lag pullout from wood). Documented value = 3.0 (AC428 §3.2.5;
 * FF2 certification). Conservative: yields the lowest allowable. Only justify a
 * lower value against a product's own stamped structural report.
 */
export const OMEGA_ULTIMATE_TO_ALLOWABLE = 3.0;

/** ASD load-combination factor on wind (ASCE 7-22 §2.4, 0.6D + 0.6W). */
export const ASD_WIND_FACTOR = 0.6;

/**
 * Minimum acceptable reported safety factor. Both demand and capacity are ASD,
 * so the design rule is simply T_asd ≤ P_allow → SF ≥ 1.0. (The safety margin
 * lives inside the allowable capacity, not in an extra multiplier here.)
 */
export const MIN_ATTACHMENT_SF = 1.0;

/**
 * Normalize a stored mount uplift capacity to its ASD ALLOWABLE value.
 * An unset basis is treated as 'ultimate' (applies the /Ω reduction) so an
 * un-verified rating is handled CONSERVATIVELY rather than silently trusted.
 */
export function allowableUpliftLbs(
  capacityLbs: number,
  basis: CapacityBasis | undefined,
): number {
  const b: CapacityBasis = basis ?? 'ultimate';
  return b === 'allowable' ? capacityLbs : capacityLbs / OMEGA_ULTIMATE_TO_ALLOWABLE;
}

/**
 * ASD net-uplift demand at one attachment, from the STRENGTH-level ASCE 7-22
 * C&C uplift pressure and the mount's tributary area. Dead-load relief (0.6·D)
 * is conservatively omitted.
 */
export function asdUpliftDemandLbs(
  strengthUpliftPsf: number,
  tributaryAreaFt2: number,
): number {
  return ASD_WIND_FACTOR * strengthUpliftPsf * tributaryAreaFt2;
}
