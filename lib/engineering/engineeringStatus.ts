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
