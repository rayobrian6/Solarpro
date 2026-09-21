/**
 * tests/engineeringStatusAuthority.test.ts
 *
 * PASS MUST NOT BE THE ABSENCE OF KNOWLEDGE.
 *
 * The four proven shapes this replaces, all verified in source:
 *
 *   lib/electrical-calc.ts:1304   `let status = 'PASS'` — the INITIALISER, so a
 *                                 check that does not exist reads as compliance
 *   calculate/route.ts            `electricalResult?.status ?? 'PASS'` — an
 *                                 engine that never ran reported as compliant
 *   calculate/route.ts            `let overallStatus = 'PASS'` — same shape one
 *                                 level up
 *   electrical-calc.ts:950        a failed interconnection check upgraded back
 *                                 to `interconnectionPasses = true`
 *
 * This file pins the aggregator. It does NOT claim the individual checks are
 * correct — that is the CT/interconnection work — it claims that the absence of
 * an evaluation can now be told apart from a passing one, which is the
 * precondition for any of those checks meaning anything.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOverallStatus, notEvaluated, type EngineOutcome } from '@/lib/engineering/engineeringStatus';
import { stripComments } from './support/stripSource';

const ok: EngineOutcome = { evaluated: true, status: 'PASS', errorCount: 0 };
const warn: EngineOutcome = { evaluated: true, status: 'WARNING', errorCount: 0 };
const fail: EngineOutcome = { evaluated: true, status: 'FAIL', errorCount: 2 };

describe('an engine that did not run can never read as compliant', () => {
  it('AN ABSENT ENGINE IS NOT A PASS', () => {
    const r = resolveOverallStatus({ electrical: notEvaluated('no-input'), structural: ok });
    expect(r.status).toBeNull();
    expect(r.status).not.toBe('PASS');
    expect(r.notEvaluated).toEqual([{ engine: 'electrical', reason: 'no-input' }]);
    expect(r.basis).toMatch(/not evaluated/);
  });

  it('a CRASHED engine is not a pass', () => {
    const r = resolveOverallStatus({ electrical: notEvaluated('engine-error'), structural: ok });
    expect(r.status).toBeNull();
    expect(r.notEvaluated[0].reason).toBe('engine-error');
  });

  it('UNRESOLVED GOVERNING DATA is not a pass', () => {
    // The case the CT work will need: an engine that could not run because a
    // value it governs on is unknown. Unknown must stay unknown.
    const r = resolveOverallStatus({ electrical: notEvaluated('inputs-unresolved') });
    expect(r.status).toBeNull();
    expect(r.basis).toMatch(/inputs-unresolved/);
  });

  it('asking for NOTHING is not a pass either', () => {
    // The degenerate case that an `every()` over an empty list would call true.
    expect(resolveOverallStatus({}).status).toBeNull();
  });
});

describe('a real verdict still means what it says', () => {
  it('everything evaluated and clean is PASS', () => {
    const r = resolveOverallStatus({ electrical: ok, structural: ok });
    expect(r.status).toBe('PASS');
    expect(r.notEvaluated).toEqual([]);
  });

  it('everything evaluated with a warning is WARNING', () => {
    expect(resolveOverallStatus({ electrical: warn, structural: ok }).status).toBe('WARNING');
  });

  it('a FAIL is a FAIL', () => {
    expect(resolveOverallStatus({ electrical: fail, structural: ok }).status).toBe('FAIL');
  });

  it('errorCount alone forces FAIL even when the engine called itself PASS', () => {
    // Defends against an engine whose own status field drifts from its errors —
    // which is exactly what electrical-calc.ts:950 does when it pushes an issue
    // and then sets interconnectionPasses = true.
    const inconsistent: EngineOutcome = { evaluated: true, status: 'PASS', errorCount: 1 };
    expect(resolveOverallStatus({ electrical: inconsistent }).status).toBe('FAIL');
  });
});

describe('precedence — which unknown outranks which', () => {
  it('A KNOWN FAILURE OUTRANKS AN UNKNOWN', () => {
    // You do not get to soften a proven failure by also failing to evaluate
    // something else.
    const r = resolveOverallStatus({ electrical: fail, structural: notEvaluated('engine-error') });
    expect(r.status).toBe('FAIL');
    // …and the incomplete evaluation is still reported, not swallowed.
    expect(r.notEvaluated).toEqual([{ engine: 'structural', reason: 'engine-error' }]);
    expect(r.basis).toMatch(/did not run/);
  });

  it('AN UNKNOWN OUTRANKS A WARNING', () => {
    // "warned, and we did not check the rest" is not a warning, it is an
    // incomplete evaluation. Reporting WARNING here would understate it.
    const r = resolveOverallStatus({ electrical: warn, structural: notEvaluated('no-input') });
    expect(r.status).toBeNull();
  });

  it('a missing reason degrades to skipped rather than to evaluated', () => {
    const r = resolveOverallStatus({ electrical: { evaluated: false } as any });
    expect(r.status).toBeNull();
    expect(r.notEvaluated[0].reason).toBe('skipped');
  });
});

describe('the aggregation site no longer defaults to PASS', () => {
  // 🚨 stripComments, NOT stripCommentsAndStrings. The identifier stripper
  // blanks string BODIES, so a search for `?? 'PASS'` would look at `?? '    '`
  // and pass against a route that still had the fallback. The first version of
  // this guard did exactly that.
  const ROUTE = stripComments(
    readFileSync(join(__dirname, '..', 'app', 'api', 'engineering', 'calculate', 'route.ts'), 'utf8'),
  );

  it('the route has something to scan', () => {
    expect(ROUTE.length).toBeGreaterThan(5_000);
    expect(ROUTE).toContain('resolveOverallStatus');
  });

  it('no `?? PASS` / `|| PASS` fallback survives in the aggregator', () => {
    // Comments and strings are stripped first: this repo has been bitten in both
    // directions by source scans that read prose as code.
    expect(ROUTE).not.toMatch(/\?\?\s*['"]PASS['"]/);
    expect(ROUTE).not.toMatch(/\|\|\s*['"]PASS['"]/);
  });

  it('overallStatus is not initialised to PASS', () => {
    expect(ROUTE).not.toMatch(/overallStatus[^=\n]*=\s*['"]PASS['"]/);
  });
});
