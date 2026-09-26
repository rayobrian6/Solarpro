/**
 * lib/structural/meanRoofHeightAuthority.ts
 *
 * ONE ANSWER TO "HOW TALL IS THIS BUILDING", WITH ITS PROVENANCE.
 *
 * 🚨 WHY THIS EXISTS — THE PERMIT'S WIND ANALYSIS WAS HARDCODED TO 15 FT.
 *
 * `lib/permit/utils/structuralInput.ts` read
 *
 *     meanRoofHeight: 15,
 *
 * with no fallback chain, no project read and no comment, sitting between a wind
 * speed sourced from the canonical site, an exposure category sourced from the
 * canonical site, and a span whose last-resort literal is a NAMED
 * `NON_AUTHORITATIVE_NOMINAL_SPAN_FT` precisely so a number cannot masquerade as
 * authority. That 15 then travelled all the way to a sealed sheet:
 *
 *     heightFt → Kz → qz = 0.00256·Kz·Kzt·Kd·Ke·V² → net uplift
 *              → uplift per attachment → attachment count and spacing
 *
 * and PV-4C printed the velocity pressure, the net uplift, the uplift per
 * attachment and even the coefficient row `Kz 0.85 · Kzt 1.00 · Kd 0.85` — every
 * one of them derived from a building height nobody had entered and no sheet
 * disclosed. The sheet's own comment says the derivation is printed so "the
 * engineer being asked to seal it" can check the number; what he could check was
 * a 15 ft building.
 *
 * MAGNITUDE, from `velocityPressureCoefficient` in ./asce7Wind.ts — Kz rises with
 * height, and qz is linear in Kz, so for Exposure C:
 *
 *     1 storey  ~15 ft   Kz 0.85    (what was always used)
 *     2 storeys ~25 ft   Kz 0.94    qz and uplift understated by 10.6 %
 *     3 storeys ~35 ft   Kz 1.04    qz and uplift understated by 22.4 %
 *
 * Exposure B is worse (0.57 → 0.76, 33 %). The attachment schedule is under-designed
 * by the same margin, and the failure is in the unsafe direction.
 *
 * 🚨 AND A WRONG CHANGELOG HAD ALREADY TALKED THE FIX OUT OF EXISTENCE.
 * `lib/version.ts` records "Stage 15.0 (v54.0) — Engineering page audit:
 * meanRoofHeight wired to ASCE 7-22 Kz calc (was hardcoded 15 ft)". That is TRUE of
 * the engineering page — `app/api/engineering/calculate/subSystemStructural.ts` does
 * read the operator's value — and FALSE of the permit, which is the document that
 * gets sealed. One path was wired, the note said "wired", and the other path kept
 * the literal.
 *
 * WHAT THIS RESOLVER DOES, and what it refuses to do:
 *
 *   1. REAL GEOMETRY FIRST. Canonical wall planes carry `estimatedHeightM`. The
 *      LOWEST full wall is the eave line — a gable-end wall plane runs up to the
 *      ridge and is taller, so a maximum would silently report the ridge as the
 *      eave. ASCE 7-22 §26.3 then defines the mean roof height as the average of
 *      the eave height and the highest point of the roof, except that for roof
 *      slopes of 10° or less the eave height is used.
 *
 *   2. STOREY COUNT SECOND, AND NEVER SILENTLY. `stories` is a classification, not
 *      a measurement, so a height derived from it is reported `established: false`
 *      with the convention spelled out. The convention is the app's own, already
 *      documented in app/engineering/page.tsx: "1-story≈15ft, 2-story≈25ft,
 *      3-story≈35ft" — i.e. 10 ft per storey plus 5 ft to mid-roof. Making it
 *      explicit here is not a new authority; it is the existing convention stopping
 *      being invisible.
 *
 *   3. A NAMED NOMINAL LAST. Still 15 ft, so nothing about an unmeasured building
 *      changes today, but `established: false` and a basis sentence that says so —
 *      which is what lets PV-4C disclose it instead of printing a derived-looking
 *      pressure.
 *
 *   4. IT NEVER CLAMPS A BAD ESTIMATE INTO RANGE. A wall height that lands outside
 *      the range the product itself offers (8–60 ft, app/engineering/page.tsx)
 *      is REJECTED and the reason travels, rather than being quietly pulled to the
 *      nearest limit — a clamped number is a fabrication wearing a measurement's
 *      provenance.
 *
 * The basis comes in two forms, the same split `projectGoverningRoofSlope` uses:
 * `basis` carries everything for the review trail and the logs, `sheetBasis` is
 * safe to print — no ids, no internal object paths. A plane UUID has reached a
 * stamped sheet in this repo before.
 */

const M_TO_FT = 3.28084;

/** The range the product itself offers for a mean roof height (app/engineering). */
export const MEAN_ROOF_HEIGHT_MIN_FT = 8;
export const MEAN_ROOF_HEIGHT_MAX_FT = 60;

/**
 * The last-resort height. Named, never inlined, so it cannot pass for a measurement.
 * Unchanged from the literal it replaces, so an unmeasured building's numbers do not
 * move — only what the sheet says about them.
 */
export const NON_AUTHORITATIVE_NOMINAL_MEAN_ROOF_HEIGHT_FT = 15;

/** Feet per storey, and the rise to mid-roof — the app's own documented convention. */
const FT_PER_STOREY = 10;
const FT_STOREY_TO_MID_ROOF = 5;

/** ASCE 7-22 §26.3: at or below this slope the eave height IS the mean roof height. */
const EAVE_GOVERNS_AT_OR_BELOW_DEG = 10;

export interface MeanRoofHeightAuthority {
  /** The mean roof height to analyse with, in feet. Always finite and positive. */
  heightFt: number;
  /**
   * TRUE only when this came from the building's own modelled geometry.
   *
   * A storey-count derivation and the nominal are both FALSE: they are defensible
   * assumptions, and a sheet that prints a wind pressure derived from an assumption
   * has to say which.
   */
  established: boolean;
  /** Full provenance — review trail and logs. May name ids and internal fields. */
  basis: string;
  /** Sheet-safe provenance: no ids, no internal object paths. */
  sheetBasis: string;
  /** Which of the three sources answered. */
  source: 'operator' | 'wall_geometry' | 'storey_count' | 'nominal';
}

export interface MeanRoofHeightArgs {
  /**
   * The height the OPERATOR set on the Structural tab, in feet.
   *
   * 🚨 THIS WINS, and the order is the one this file's neighbours already use:
   * `rafterSpFt = input.project.rafterSpan || _geomSpanFt || NOMINAL` — the operator's
   * own field first, then geometry, then a named nominal. A person choosing "2-storey"
   * or typing 26 is stating something about the building; `estimatedHeightM` on a wall
   * plane calls itself an estimate. Preferring the estimate over the statement would be
   * the placement rule inverted.
   */
  operatorStatedFt?: number | null;
  /** Canonical wall planes. `estimatedHeightM` is the wall's height above grade. */
  wallPlanes?: ReadonlyArray<{ id?: string; estimatedHeightM?: number | null }> | null;
  /** Building storey count, when the model classified one. */
  stories?: number | null;
  /** The GOVERNING roof slope, already resolved by projectGoverningRoofSlope. */
  roofSlopeDeg?: number | null;
  /** Roof span in feet, for the ridge rise. */
  roofSpanFt?: number | null;
}

/** Round to one decimal — the precision the sheets print. */
const r1 = (n: number) => Math.round(n * 10) / 10;

export function projectMeanRoofHeight(args: MeanRoofHeightArgs): MeanRoofHeightAuthority {
  const notes: string[] = [];

  // ── 0. What the operator actually said ────────────────────────────────────
  const stated = Number(args.operatorStatedFt);
  if (Number.isFinite(stated) && stated > 0) {
    if (stated >= MEAN_ROOF_HEIGHT_MIN_FT && stated <= MEAN_ROOF_HEIGHT_MAX_FT) {
      const heightFt = r1(stated);
      return {
        heightFt,
        established: true,
        basis: `mean roof height ${heightFt} ft — entered by the operator on the Structural tab`,
        sheetBasis: 'as entered for this building on the structural input (ASCE 7-22 §26.3)',
        source: 'operator',
      };
    }
    // Out of the range the control itself offers. Reported, never clamped — the same
    // rule the geometry branch follows, for the same reason.
    notes.push(
      `an operator-entered height of ${r1(stated)} ft is outside the ${MEAN_ROOF_HEIGHT_MIN_FT}–${MEAN_ROOF_HEIGHT_MAX_FT} ft range and was NOT used`,
    );
  }

  // ── 1. The building's own modelled geometry ───────────────────────────────
  const wallHeightsFt = (args.wallPlanes ?? [])
    .map(w => (typeof w?.estimatedHeightM === 'number' ? w.estimatedHeightM * M_TO_FT : NaN))
    .filter(h => Number.isFinite(h) && h > 0);

  if (wallHeightsFt.length > 0) {
    // 🚨 THE LOWEST WALL, NOT THE TALLEST. A gable-end wall plane runs to the ridge,
    // so a maximum here would report the ridge height as the eave and then add half a
    // ridge rise on top of it — an over-tall building, dressed as a measurement.
    const eaveFt = Math.min(...wallHeightsFt);
    const slopeDeg = Number.isFinite(args.roofSlopeDeg as number) ? Number(args.roofSlopeDeg) : 0;
    const spanFt = Number.isFinite(args.roofSpanFt as number) && Number(args.roofSpanFt) > 0
      ? Number(args.roofSpanFt) : 0;

    let heightFt = eaveFt;
    let how = `eave ${r1(eaveFt)} ft (lowest of ${wallHeightsFt.length} modelled wall plane${wallHeightsFt.length === 1 ? '' : 's'})`;

    if (slopeDeg > EAVE_GOVERNS_AT_OR_BELOW_DEG && spanFt > 0) {
      // Ridge rise over half the span, then the ASCE average of eave and ridge.
      const riseFt = (spanFt / 2) * Math.tan((slopeDeg * Math.PI) / 180);
      if (Number.isFinite(riseFt) && riseFt > 0) {
        heightFt = eaveFt + riseFt / 2;
        how = `${how} + half the ${r1(riseFt)} ft ridge rise at ${r1(slopeDeg)}° over a ${r1(spanFt)} ft span`;
      }
    } else if (slopeDeg > 0 && slopeDeg <= EAVE_GOVERNS_AT_OR_BELOW_DEG) {
      how = `${how}; ASCE 7-22 §26.3 uses the eave height at slopes of ${EAVE_GOVERNS_AT_OR_BELOW_DEG}° or less`;
    } else if (spanFt <= 0) {
      how = `${how}; no roof span on file, so the ridge rise could not be added`;
    }

    heightFt = r1(heightFt);

    // 🚨 REJECTED, NOT CLAMPED. See the header: pulling an out-of-range estimate to
    // the nearest limit would hand a fabricated number this branch's provenance.
    if (heightFt >= MEAN_ROOF_HEIGHT_MIN_FT && heightFt <= MEAN_ROOF_HEIGHT_MAX_FT) {
      return {
        heightFt,
        established: true,
        basis: `mean roof height ${heightFt} ft from the canonical building model — ${how}`,
        // The row prints the VALUE; this is the derivation beneath it, so it does not
        // restate the number. Keeping both made the cell read "23.1 ft / 23.1 ft - eave...".
        sheetBasis: `${how} (ASCE 7-22 §26.3)`,
        source: 'wall_geometry',
      };
    }
    notes.push(
      `modelled wall geometry gave ${heightFt} ft, outside the ${MEAN_ROOF_HEIGHT_MIN_FT}–${MEAN_ROOF_HEIGHT_MAX_FT} ft range and NOT used`,
    );
  }

  // ── 2. The storey count — a classification, so never `established` ────────
  const stories = Number(args.stories);
  if (Number.isFinite(stories) && stories >= 1) {
    const whole = Math.floor(stories);
    const heightFt = whole * FT_PER_STOREY + FT_STOREY_TO_MID_ROOF;
    if (heightFt >= MEAN_ROOF_HEIGHT_MIN_FT && heightFt <= MEAN_ROOF_HEIGHT_MAX_FT) {
      const how = `assumed from ${whole} storey${whole === 1 ? '' : 's'} at ${FT_PER_STOREY} ft per storey + ${FT_STOREY_TO_MID_ROOF} ft to mid-roof`;
      return {
        heightFt,
        established: false,
        basis: [`mean roof height ${heightFt} ft — ${how}; no modelled wall heights on file`, ...notes].join('; '),
        sheetBasis: `${how}. NOT a measured height.`,
        source: 'storey_count',
      };
    }
    notes.push(`${whole} storeys implies ${heightFt} ft, outside the analysable range and NOT used`);
  }

  // ── 3. The named nominal ──────────────────────────────────────────────────
  return {
    heightFt: NON_AUTHORITATIVE_NOMINAL_MEAN_ROOF_HEIGHT_FT,
    established: false,
    basis: [
      `mean roof height ${NON_AUTHORITATIVE_NOMINAL_MEAN_ROOF_HEIGHT_FT} ft — NOMINAL. No modelled wall heights and no storey count reached the permit`,
      ...notes,
    ].join('; '),
    sheetBasis: `NOMINAL — no building height on file. NOT a measured height.`,
    source: 'nominal',
  };
}
