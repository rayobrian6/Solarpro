// ═══════════════════════════════════════════════════════════════════════════
// NEC Table 250.66 — Grounding Electrode Conductor for AC Systems
//
// ONE authority for the GEC size. Before this module the rule existed THREE
// times in the repo and the three copies DISAGREED AT EVERY RUNG — and none of
// them was indexed on what Table 250.66 is actually indexed on.
//
// What they did (all keyed on the OCPD/breaker rating, which is not an input to
// this table at all):
//
//     lib/bom-engine-v4.ts:2128   <=60 -> #6, <=100 -> #4, else #2
//     lib/bom-engine-v4.ts:3347   (same expression, duplicated)
//     lib/computed-plan.ts:286    a third, different set of rungs
//
// 🚨 Table 250.66 is keyed on the SIZE OF THE LARGEST UNGROUNDED SERVICE-ENTRANCE
// CONDUCTOR (or the equivalent area for parallel conductors) — not on an
// overcurrent device. An OCPD rating and a service-entrance conductor size are
// different quantities, so the old copies were not "an approximation of the
// table"; they were indexed on the wrong axis.
//
// The live copy BILLED the result: `${gecGauge} Bare Copper GEC`, 50 ft,
// necReference 'NEC 250.66'. On a 200 A service it emitted 50 ft of #2 bare
// copper — several hundred dollars and four gauge steps above the #6 that
// 250.66(A) caps a rod-only GEC at — and on a service above 350 kcmil the same
// line was UNDERSIZED against the table.
//
// Sources: NEC Table 250.66 and 250.66(A). Copper column only; this product does
// not currently emit an aluminium GEC.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Conductor sizes in ascending area order, as the rest of the repo spells them.
 * Index order IS the size order, so "which of these two is smaller" is a
 * comparison of indices — see {@link smallerConductor}.
 */
export const GEC_SIZE_ORDER = [
  '#8 AWG', '#6 AWG', '#4 AWG', '#2 AWG',
  '#1/0 AWG', '#2/0 AWG', '#3/0 AWG',
] as const;

export type GecSize = typeof GEC_SIZE_ORDER[number];

/**
 * NEC 250.66(A) — where the GEC's sole connection is to a rod, pipe or plate
 * electrode (250.52(A)(5) or (A)(7)), that portion "shall not be required to be
 * larger than 6 AWG copper".
 *
 * This is a CAP, not a minimum. Where the table calls for #8 (a service
 * conductor of 2 AWG or smaller) #8 still satisfies the code — 250.66(A) does
 * not push a smaller conductor up to #6.
 */
export const ROD_ONLY_GEC_MAX: GecSize = '#6 AWG';

/** Circular-mil area of the service-entrance conductor sizes Table 250.66 bands on. */
const SERVICE_CONDUCTOR_KCMIL: Record<string, number> = {
  '#14 AWG': 4.11, '#12 AWG': 6.53, '#10 AWG': 10.38, '#8 AWG': 16.51,
  '#6 AWG': 26.24, '#4 AWG': 41.74, '#3 AWG': 52.62, '#2 AWG': 66.36,
  '#1 AWG': 83.69, '#1/0 AWG': 105.6, '#2/0 AWG': 133.1, '#3/0 AWG': 167.8,
  '#4/0 AWG': 211.6,
};

/** Normalises '4/0', '4/0 AWG', '#4/0 awg', '250 kcmil', '250 KCMIL' etc. */
function areaKcmil(size: string): number | null {
  const raw = String(size ?? '').trim();
  if (!raw) return null;

  const kcmil = raw.match(/^(\d+(?:\.\d+)?)\s*(?:kcmil|mcm)$/i);
  if (kcmil) return Number(kcmil[1]);

  const key = `#${raw.replace(/^#/, '').replace(/\s*AWG$/i, '').trim()} AWG`;
  const found = Object.entries(SERVICE_CONDUCTOR_KCMIL)
    .find(([k]) => k.toLowerCase() === key.toLowerCase());
  return found ? found[1] : null;
}

/**
 * Table 250.66, copper. `serviceConductorSize` is the LARGEST UNGROUNDED
 * SERVICE-ENTRANCE CONDUCTOR — an AWG string ('#2 AWG', '4/0') or a kcmil
 * string ('350 kcmil').
 *
 * Returns null when the size cannot be resolved. A caller must NOT convert that
 * refusal into a default gauge silently: an unresolved service conductor means
 * the table has not been consulted, and `lib/permit` treats a fabricated
 * absence as a defect in its own right.
 */
export function gecSizeForServiceConductor(serviceConductorSize: string): GecSize | null {
  const kcmil = areaKcmil(serviceConductorSize);
  if (kcmil === null) return null;

  // Bands are on the conductor's area, so #1 and #1/0 share a row and the
  // "over 3/0 through 350 kcmil" row covers 4/0 as well as 250 and 350 kcmil.
  if (kcmil <= SERVICE_CONDUCTOR_KCMIL['#2 AWG'])   return '#8 AWG';   // 2 AWG or smaller
  if (kcmil <= SERVICE_CONDUCTOR_KCMIL['#1/0 AWG']) return '#6 AWG';   // 1 or 1/0 AWG
  if (kcmil <= SERVICE_CONDUCTOR_KCMIL['#3/0 AWG']) return '#4 AWG';   // 2/0 or 3/0 AWG
  if (kcmil <= 350)                                 return '#2 AWG';   // over 3/0 through 350 kcmil
  if (kcmil <= 600)                                 return '#1/0 AWG'; // over 350 through 600 kcmil
  if (kcmil <= 1100)                                return '#2/0 AWG'; // over 600 through 1100 kcmil
  return '#3/0 AWG';                                                   // over 1100 kcmil
}

/** The smaller of two conductor sizes by area. Used to apply a cap, not a floor. */
export function smallerConductor(a: GecSize, b: GecSize): GecSize {
  return GEC_SIZE_ORDER.indexOf(a) <= GEC_SIZE_ORDER.indexOf(b) ? a : b;
}

export interface GecResolution {
  /** The size to install and to bill. */
  size: GecSize;
  /** What decided it, for the printed derivation on the sheet. */
  basis: string;
  /** True when 250.66(A) reduced the table's value. */
  cappedByRodOnly: boolean;
}

/**
 * Resolve the GEC for a PV interconnection.
 *
 * `rodOnly` means the GEC's sole connection is to the rod/pipe/plate electrode
 * this BOM just added — which is the case for every electrode system
 * bom-engine-v4 emits, since it emits a 250.52(A)(5) ground rod and nothing else.
 * When it is true, 250.66(A) caps the result at #6 copper.
 *
 * When `serviceConductorSize` is absent the table cannot be consulted. For a
 * rod-only electrode that is still answerable: #6 satisfies 250.66(A) for ANY
 * service-entrance conductor, and where the table would have allowed #8 (a
 * service conductor of 2 AWG or smaller — a service far below anything this
 * product designs for) #6 is merely larger than required. So the fallback is
 * compliant in every case and can never be undersized, which is the direction
 * that matters. The basis string says so rather than implying the table ran.
 */
export function resolveGec(opts: {
  serviceConductorSize?: string | null;
  rodOnly: boolean;
}): GecResolution {
  const fromTable = opts.serviceConductorSize
    ? gecSizeForServiceConductor(opts.serviceConductorSize)
    : null;

  if (fromTable === null) {
    if (opts.rodOnly) {
      return {
        size: ROD_ONLY_GEC_MAX,
        basis: 'NEC 250.66(A) — sole connection to a rod electrode, not required to exceed #6 Cu '
             + '(service-entrance conductor size not supplied, so Table 250.66 was not consulted)',
        cappedByRodOnly: true,
      };
    }
    // No table input and no rod-only cap to fall back on. Take the largest row
    // rather than inventing a middle one: an oversized GEC is a cost, an
    // undersized one is a violation on a purchased conductor.
    return {
      size: '#3/0 AWG',
      basis: 'NEC Table 250.66 — service-entrance conductor size not supplied; '
           + 'largest row taken because an undersized GEC is a code violation',
      cappedByRodOnly: false,
    };
  }

  if (opts.rodOnly) {
    const capped = smallerConductor(fromTable, ROD_ONLY_GEC_MAX);
    return {
      size: capped,
      basis: capped === fromTable
        ? `NEC Table 250.66 — ${opts.serviceConductorSize} service-entrance conductor`
        : `NEC 250.66(A) — Table 250.66 calls for ${fromTable} on a ${opts.serviceConductorSize} `
          + 'service-entrance conductor; sole connection is to a rod electrode, so capped at #6 Cu',
      cappedByRodOnly: capped !== fromTable,
    };
  }

  return {
    size: fromTable,
    basis: `NEC Table 250.66 — ${opts.serviceConductorSize} service-entrance conductor`,
    cappedByRodOnly: false,
  };
}
