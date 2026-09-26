// ═══════════════════════════════════════════════════════════════════════════
// THE PERMIT PACKAGE'S ONE INTERCONNECTION RULE.
//
// The design snapshot decides the rule (NEC 705.11 supply-side vs 705.12(B)
// load-side) from `project.interconnectionMethod`, and PV-4A reads that rule.
// But the survey writes FREE TEXT into that field ('Supply-Side (NEC 705.11)',
// 'Load-Side Breaker (NEC 705.12(B)(2)) — max NA', 'Panel Upgrade Required',
// 'See Electrical Engineer'), and the E-1 metering, the permit BOM, the
// computeSystem runs, the legacy electrical calc, the site plan and the general
// notes read the raw value as an exact token — so one surveyed supply-side
// package said "CONS (MODE TBD)" on E-1 and "CONS (TOTAL)" on PV-4A, sized its
// runs as a load-side job, and printed the 705.12 backfeed note beside a 705.11
// tap (review, 2026-09-25).
//
// Every permit consumer now asks THIS. A value that is already a token passes
// through untouched (the page always sends one); anything else resolves by the
// rule. The rule is the predicate the snapshot's own tap topology, tap-connection
// authority and tap-span grade already used (`/SUPPLY|LINE/i`): a line-side tap
// IS a 705.11 connection. Only the rule line itself used to ignore LINE — no
// producer has ever written a LINE value (the page offers four tokens; the survey
// normaliser maps line_side to supply_side), so that alignment moves no real
// design's digest. Imports nothing.
// ═══════════════════════════════════════════════════════════════════════════

/** The tokens the engineering page sends; passed through unchanged. */
const TOKENS = new Set(['LOAD_SIDE', 'SUPPLY_SIDE_TAP', 'MAIN_BREAKER_DERATE', 'PANEL_UPGRADE']);

/** The package's rule: 705.11 for a supply-side (line-side) connection. */
export function interconnectionRuleOf(method: unknown): '705.11' | '705.12(B)' {
  return /SUPPLY|LINE/i.test(String(method ?? '')) ? '705.11' : '705.12(B)';
}

/** A token every permit consumer agrees with the snapshot about. */
export function permitInterconnectionToken(method: unknown): string {
  const raw = String(method ?? '').trim();
  if (TOKENS.has(raw)) return raw;
  return interconnectionRuleOf(raw) === '705.11' ? 'SUPPLY_SIDE_TAP' : 'LOAD_SIDE';
}
