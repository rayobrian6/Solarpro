// 🚨 WHAT A PRELIMINARY ESTIMATE ASSUMED, so it can never be mistaken for an engineered design.
//
// Ray: "Preliminary/default workflows may suggest a path to the user. They may not persist an
// engineering decision that was never made."
//
// `app/api/engineering/preliminary/route.ts` upserts an engineering report for a prospect whose
// service nobody has surveyed. The estimate needs a shape to compute against, so each assumption is
// NAMED here and travels with the output — the fact, what was assumed, why, and which stage owns the
// real answer. A reader can then tell an estimate from a design without knowing the codebase.
//
// It lives in lib/ rather than in the route because a Next.js route module may export only its HTTP
// handlers; any other export fails the generated route-type check at build time.

/**
 * Every fact this route assumed because a prospect has no design yet. Carried on the output so the
 * estimate can be told apart from an engineered result by anything that reads it.
 */
export const PRELIMINARY_ASSUMPTIONS = [
  { fact: 'Point of interconnection', assumed: 'Not determined',
    why: 'Nobody has surveyed the service. It decides whether NEC 705.12(B) or 705.11 governs.',
    owner: 'Service topology, once the service is recorded.' },
  { fact: 'PV conversion architecture', assumed: 'Microinverter',
    why: 'A typical residential assumption for an estimate, not a selection.',
    owner: 'Equipment selection in System Config.' },
  { fact: 'Service rating', assumed: `200 A`,
    why: 'The most common residential service. Not measured on this site.',
    owner: 'Service topology.' },
] as const;
