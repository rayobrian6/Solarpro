/**
 * lib/engineering/engineeringStatus.ts
 *
 * PASS MUST NOT MEAN "NOTHING OBJECTED".
 *
 * Every electrical verdict in this application is currently the value a variable
 * holds when no enumerated check pushed onto an error list:
 *
 *     lib/electrical-calc.ts:1304
 *       let status: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
 *       if (allErrors.length > 0) status = 'FAIL';
 *       else if (allWarnings.length > 0) status = 'WARNING';
 *
 * PASS is the INITIALISER. So a check that does not exist, a check that was
 * skipped, and a check that ran and was satisfied are all the same answer. That
 * is why "Electrical PASS" can be printed for a design whose CT topology is not
 * represented anywhere: no CT check is enumerated, so nothing objects.
 *
 * And at the aggregation point the same shape appeared again:
 *
 *     app/api/engineering/calculate/route.ts
 *       const electricalStatus = electricalResult?.status ?? 'PASS';
 *       const structuralStatus = structuralResult?.status ?? 'PASS';
 *       let overallStatus: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
 *
 * An engine that never ran was reported as compliant.
 *
 * THE RULE THIS FILE ENFORCES, AND NOTHING ELSE
 *
 *   PASS is only reachable when EVERY engine asked for actually ran.
 *
 * Not-evaluated is `null`, never `'PASS'`. `null` is deliberate rather than a
 * new enum member: three consumer types already declare
 * `'PASS' | 'WARNING' | 'FAIL' | null` (lib/engineering-helpers.ts,
 * lib/system-state.ts, app/engineering/page.tsx) and the UI already renders it
 * as "Not calculated" (StatusBadge). The honest value existed; the aggregator
 * simply never produced it.
 *
 * 🚨 A KNOWN FAILURE OUTRANKS AN UNKNOWN. If one engine reports FAIL and another
 * did not run, the answer is FAIL, not null. You do not get to soften a proven
 * failure by also failing to evaluate something else. Conversely a WARNING does
 * NOT outrank not-evaluated, because "warned, and we did not check the rest" is
 * not a warning — it is an incomplete evaluation.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not decide whether any individual check is correct, and it does not
 * add CT, metering or interconnection checks. It makes the ABSENCE of an
 * evaluation representable, so that when those checks are added their absence
 * can be reported instead of being indistinguishable from compliance. The
 * structural path already had this discipline at one point —
 * `route.ts` emits an `ENGINE_ERROR` on a structural crash with the note
 * "FAIL CLOSED: a thrown engine must never read as a passing stamp" — this
 * generalises it rather than inventing it.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE SAME RULE, ONE LEVEL DOWN: A SINGLE CHECK MUST BE ABLE TO SAY "I DID NOT RUN".
//
// Everything above is about ENGINES. Ray, on the 400 A Tesla service:
//
//   "You found that the current rules engine can only express `error | warning | info | pass`.
//    Do not fake NOT_EVALUATED as a warning string sprinkled into outputs. Strengthen the existing
//    assessment model so engineering conclusions distinguish PASS / FAIL / NOT_EVALUATED-
//    INPUT_REQUIRED, while severity remains a separate presentation concern if necessary."
//
// So a CONCLUSION is what the engineering says, and a SEVERITY is how a screen paints it. They are
// different things and the codebase had only the second. `RuleSeverity` has no member for "the
// available fault current was never established", so that fact could only travel as a warning —
// and a warning is something that was evaluated.
//
// These three types are the shared vocabulary. `lib/electrical/serviceTopology.ts` produces them,
// `lib/rules-engine.ts` carries them alongside its severities, and the UI, the SLD notes and the
// permit read them. One vocabulary, not one per consumer.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What the engineering concluded about one check.
 *
 * 🚨 `NOT_EVALUATED` IS NOT A SOFT FAIL AND NOT A SOFT PASS. It means the check could not run
 * because a governing input or authority is absent, and it always travels with the NAME of what is
 * missing (`requires`). "Unknown may not become PASS."
 */
export type EngineeringConclusion = 'PASS' | 'FAIL' | 'NOT_EVALUATED';

export interface EngineeringCheck {
  id: string;
  /** 'site', or a scoped key like `domain:<id>` / `branch:<id>`, so a panel can group them. */
  scope: string;
  title: string;
  conclusion: EngineeringConclusion;
  detail: string;
  /**
   * The inputs or authorities this check needs. Present ⇔ NOT_EVALUATED, and never empty then:
   * an indeterminate result that cannot say what would resolve it is a dead end.
   */
  requires?: string[];
  citation?: string;
}

/**
 * Fold many checks into one conclusion.
 *
 * 🚨 A KNOWN FAILURE OUTRANKS AN UNKNOWN — the same precedence `resolveOverallStatus` uses above,
 * for the same reason: you do not get to soften a proven failure by also failing to evaluate
 * something else. And an empty set is NOT a pass; nothing was checked.
 */
export function foldConclusions(checks: readonly EngineeringCheck[]): EngineeringConclusion {
  if (!checks || checks.length === 0) return 'NOT_EVALUATED';
  if (checks.some(c => c.conclusion === 'FAIL')) return 'FAIL';
  if (checks.some(c => c.conclusion === 'NOT_EVALUATED')) return 'NOT_EVALUATED';
  return 'PASS';
}

/**
 * How a conclusion is PAINTED. Presentation only — never read this to decide engineering.
 *
 * NOT_EVALUATED maps to 'warning' because that is the loudest thing the existing severity scale
 * can say, and it must not be quieter than a warning. That mapping is exactly why the conclusion
 * has to exist separately: 'warning' cannot be un-read as "we checked and it was nearly fine".
 */
export function conclusionSeverity(c: EngineeringConclusion): 'error' | 'warning' | 'pass' {
  return c === 'FAIL' ? 'error' : c === 'NOT_EVALUATED' ? 'warning' : 'pass';
}

/** Every distinct missing input across a set of checks, for a one-line "what is needed" summary. */
export function requiredInputs(checks: readonly EngineeringCheck[]): string[] {
  const out = new Set<string>();
  for (const c of checks ?? []) {
    if (c.conclusion !== 'NOT_EVALUATED') continue;
    for (const r of c.requires ?? []) out.add(r);
  }
  return [...out].sort();
}

/**
 * The line a UI, an SLD note or a permit prints for an indeterminate result.
 *
 * One phrasing, in one place, so the drawing and the report cannot word it differently.
 */
export function notEvaluatedLabel(checks: readonly EngineeringCheck[]): string | null {
  const needs = requiredInputs(checks);
  if (needs.length === 0) return null;
  return `NOT EVALUATED — ${needs.join(', ')} REQUIRED`;
}

/** Why an engine produced no verdict. */
export type NotEvaluatedReason =
  /** The caller supplied no input for this engine. */
  | 'no-input'
  /** The engine threw. */
  | 'engine-error'
  /** Deliberately not run for this design. */
  | 'skipped'
  /** Governing data the engine requires is unresolved, so it could not run. */
  | 'inputs-unresolved';

export type EngineOutcome =
  | { evaluated: true; status: 'PASS' | 'WARNING' | 'FAIL'; errorCount?: number }
  | { evaluated: false; reason: NotEvaluatedReason };

export interface OverallStatusResult {
  /** `null` means NOT EVALUATED. It is never silently `'PASS'`. */
  status: 'PASS' | 'WARNING' | 'FAIL' | null;
  /** Which engines produced no verdict, and why. Empty when all ran. */
  notEvaluated: Array<{ engine: string; reason: NotEvaluatedReason }>;
  /** A one-line explanation suitable for a UI or a log. */
  basis: string;
}

/** An engine that did not run, expressed so a caller cannot forget the reason. */
export function notEvaluated(reason: NotEvaluatedReason): EngineOutcome {
  return { evaluated: false, reason };
}

/**
 * Fold engine outcomes into one answer.
 *
 * @param engines  keyed by engine name, e.g. `{ electrical: …, structural: … }`
 */
export function resolveOverallStatus(engines: Record<string, EngineOutcome>): OverallStatusResult {
  const entries = Object.entries(engines ?? {});

  // Asking for nothing is not a pass.
  if (entries.length === 0) {
    return { status: null, notEvaluated: [], basis: 'no engines were asked to evaluate' };
  }

  const missing = entries
    .filter(([, o]) => !o?.evaluated)
    .map(([engine, o]) => ({ engine, reason: (o as { reason: NotEvaluatedReason })?.reason ?? 'skipped' }));

  const evaluatedOutcomes = entries
    .map(([, o]) => o)
    .filter((o): o is Extract<EngineOutcome, { evaluated: true }> => !!o?.evaluated);

  // A proven failure is the answer regardless of what else did not run.
  const failed = evaluatedOutcomes.filter(o => o.status === 'FAIL' || (o.errorCount ?? 0) > 0);
  if (failed.length > 0) {
    return {
      status: 'FAIL',
      notEvaluated: missing,
      basis: missing.length > 0
        ? `failed (${failed.length} engine(s)); ${missing.length} other engine(s) did not run`
        : `failed (${failed.length} engine(s))`,
    };
  }

  // Nothing failed, but something did not run: the evaluation is incomplete.
  if (missing.length > 0) {
    return {
      status: null,
      notEvaluated: missing,
      basis: `not evaluated — ${missing.map(m => `${m.engine}: ${m.reason}`).join(', ')}`,
    };
  }

  if (evaluatedOutcomes.some(o => o.status === 'WARNING')) {
    return { status: 'WARNING', notEvaluated: [], basis: 'all engines evaluated; at least one warning' };
  }
  return { status: 'PASS', notEvaluated: [], basis: 'all engines evaluated; no errors or warnings' };
}
