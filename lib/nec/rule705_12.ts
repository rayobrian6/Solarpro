// ═══════════════════════════════════════════════════════════════════════════
// NEC 705.12(B)(2) — the 120% rule, once.
//
// The allowance for a load-side interconnection is
//
//     (busbar rating × 1.2) − main breaker rating
//
// It takes TWO ratings. `lib/engineering/reportGenerator.ts` used to decide
// load-side vs supply-side from `backfeedBreakerAmps <= busRating * 0.2`, with
// ONE field (`project_physical_data.panel_rating_amps`) standing in for both the
// busbar and the main breaker — so the test was only equivalent to the code where
// the main breaker happens to equal the busbar rating, and `× 0.2` is not a rule
// the NEC states anywhere.
//
// 🚨 'supply-side' IS NOT A LABEL — IT IS A DIFFERENT SCOPE OF WORK.
// `lib/bom-engine-v4.ts` SUPPLY_SIDE_TAP deletes the backfed breaker and adds
// three NSI Polaris IPLD350-3 insulated multi-tap connectors plus a fused AC
// disconnect that must now BE the OCPD, and `lib/computed-system.ts` imposes the
// 705.11(C) ≤10 ft placement constraint on that disconnect. Getting this wrong
// quotes and draws a utility-coordinated line-side tap the job does not need.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maximum PV/storage backfeed breaker permitted on a load-side connection,
 * per NEC 705.12(B)(2): (busbar × 1.2) − main breaker.
 *
 * Both ratings are required. A caller that has only one of them has NOT
 * established the allowance and must report the interconnection method as
 * unresolved — see {@link resolveInterconnectionMethod}.
 */
export function maxLoadSideBackfeedA(busRatingA: number, mainBreakerA: number): number {
  return (busRatingA * 1.2) - mainBreakerA;
}

export type InterconnectionSide = 'load-side' | 'supply-side' | 'unresolved';

export interface InterconnectionResolution {
  side: InterconnectionSide;
  /** The printed derivation, or the reason it could not be established. */
  basis: string;
  /** null when the allowance could not be computed. */
  maxLoadSideBackfeedA: number | null;
}

/**
 * Decide the interconnection side from what is actually known.
 *
 * A surveyed interconnection point wins — an inspector at the panel is better
 * evidence than arithmetic over two nameplate numbers.
 *
 * Otherwise BOTH the busbar rating and the main breaker rating are required. When
 * either is missing the answer is `'unresolved'`, NOT a default: the previous code
 * fabricated a 200 A busbar when the survey was silent and then stated a
 * conclusion from it, which is exactly what
 * `app/api/engineering/sld/pdf/route.ts` refuses to do for panelBusRating on the
 * grounds that "a caller that genuinely has no value must NOT get a fabricated
 * one". The same reasoning applies here, and more sharply, because the conclusion
 * changes the scope of work.
 */
export function resolveInterconnectionMethod(opts: {
  surveyedPoint?: string | null;
  busRatingA?: number | null;
  mainBreakerA?: number | null;
  backfeedBreakerA: number;
}): InterconnectionResolution {
  const p = opts.surveyedPoint;
  if (p === 'load_side' || p === 'main_panel') {
    return {
      side: 'load-side',
      basis: `Field-captured interconnection point: ${p}`,
      maxLoadSideBackfeedA: (opts.busRatingA && opts.mainBreakerA)
        ? maxLoadSideBackfeedA(opts.busRatingA, opts.mainBreakerA) : null,
    };
  }
  if (p === 'supply_side' || p === 'sub_panel') {
    return {
      side: 'supply-side',
      basis: `Field-captured interconnection point: ${p}`,
      maxLoadSideBackfeedA: null,
    };
  }

  const bus = Number(opts.busRatingA) || 0;
  const main = Number(opts.mainBreakerA) || 0;
  if (bus <= 0 || main <= 0) {
    const missing = [bus <= 0 ? 'busbar rating' : null, main <= 0 ? 'main breaker rating' : null]
      .filter(Boolean).join(' and ');
    return {
      side: 'unresolved',
      basis: `NEC 705.12(B)(2) not evaluated — ${missing} not established. `
           + 'Interconnection method requires a site survey or an operator entry; '
           + 'it is NOT derived from an assumed service size.',
      maxLoadSideBackfeedA: null,
    };
  }

  const allowance = maxLoadSideBackfeedA(bus, main);
  const fits = opts.backfeedBreakerA <= allowance;
  return {
    side: fits ? 'load-side' : 'supply-side',
    basis: `NEC 705.12(B)(2): (${bus}A bus × 1.2) − ${main}A main = ${allowance}A max backfeed; `
         + `${opts.backfeedBreakerA}A ${fits ? '≤' : '>'} ${allowance}A`,
    maxLoadSideBackfeedA: allowance,
  };
}
