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

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE STATES THAT ARE NOT A CHOICE OF ARTICLE, AND WHICH THIS FILE USED TO DESTROY.
//
// Ray, 2026-10-02: "For relationships where SolarPro deliberately cannot map to one generic NEC
// scalar, preserve that state. Examples include UNRESOLVED, MANUFACTURER_INTEGRATED,
// METER_COLLAR. Do not force them through a LOAD_SIDE/SUPPLY_SIDE compatibility field merely
// because an old engine only understands two choices."
//
// `permitInterconnectionToken` was `TOKENS.has(raw) ? raw : (rule === '705.11' ? SUPPLY : LOAD)`
// — so EVERY value that was not literally one of the four, and did not match /SUPPLY|LINE/,
// became `'LOAD_SIDE'`. An interconnection nobody had established was handed NEC 705.12(B) on
// the SEALED permit, in three places, by this one expression. The collapse was invisible
// because the output was a perfectly valid token.
//
// A PW3 whose PV lands on its DC inputs through a listed gateway is the real case: it is not a
// field tap and it is not a breaker on a busbar, and calling it load-side asserts a 120% busbar
// calculation against a connection that has no busbar.
// ═══════════════════════════════════════════════════════════════════════════
const UNMAPPABLE = new Set(['UNRESOLVED', 'MANUFACTURER_INTEGRATED', 'METER_COLLAR']);

/** True when the recorded relationship is deliberately not one of the two NEC articles. */
export function isUnmappableInterconnection(method: unknown): boolean {
  return UNMAPPABLE.has(String(method ?? '').trim().toUpperCase());
}

/**
 * The package's rule: 705.11 for a supply-side (line-side) connection, 705.12(B) for a load-side
 * one — and `'not-established'` when the relationship cannot be expressed as either.
 *
 * 🚨 THE THIRD RETURN IS THE POINT. This was a two-value function, so every caller's `=== '705.11'
 * ? … : …` quietly cited 705.12(B) for an unestablished interconnection. Widening the type made
 * the compiler name every one of those callers.
 */
export function interconnectionRuleOf(method: unknown): '705.11' | '705.12(B)' | 'not-established' {
  if (isUnmappableInterconnection(method)) return 'not-established';
  const raw = String(method ?? '').trim();
  // An absent value is not a load-side connection either. Nobody has said.
  if (!raw) return 'not-established';
  return /SUPPLY|LINE/i.test(raw) ? '705.11' : '705.12(B)';
}

/**
 * A token every permit consumer agrees with the snapshot about.
 *
 * Preserves the unmappable states verbatim rather than flattening them, and returns
 * `'UNRESOLVED'` — never `'LOAD_SIDE'` — when nothing was recorded.
 */
export function permitInterconnectionToken(method: unknown): string {
  const raw = String(method ?? '').trim();
  if (TOKENS.has(raw)) return raw;
  const upper = raw.toUpperCase();
  if (UNMAPPABLE.has(upper)) return upper;
  if (!raw) return 'UNRESOLVED';
  const rule = interconnectionRuleOf(raw);
  if (rule === 'not-established') return 'UNRESOLVED';
  return rule === '705.11' ? 'SUPPLY_SIDE_TAP' : 'LOAD_SIDE';
}
