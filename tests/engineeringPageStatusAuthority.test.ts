// ═══════════════════════════════════════════════════════════════════════════
// THE ENGINEERING PAGE INVENTED TWO ANSWERS THE AUTHORITY HAD ALREADY GIVEN.
//
// Both defects have the same shape: the CLIENT re-derives locally something the
// server (or the rest of the page) already decided, and its local rule is the
// permissive one.
//
//   1. app/engineering/page.tsx runCalc()
//      Discarded calcData.overallStatus — the route's fail-closed fold from
//      lib/engineering/engineeringStatus.ts — and recomputed it with
//      `calcData.structural?.status ?? 'PASS'`, the exact shape the route was
//      fixed to remove. On a hybrid roof+fence project the rebuilt
//      calcData.structural shows the ROOF subset, and the FENCE subset's
//      'WARNING' (analyzeFenceSystem: "always ESTIMATE until PE sign-off")
//      carries an EMPTY errors array — so "no errors + roof PASS" wrote PASS
//      over the route's WARNING. An unstamped fence array badged PASS.
//
//   2. app/engineering/page.tsx saveEngineeringOutputs()
//      Recorded `config.interconnectionMethod ?? 'SUPPLY_SIDE_TAP'` — the only
//      site in the file that defaults that way; all the others coalesce to
//      'LOAD_SIDE'. An absent topology became the MORE PERMISSIVE permit, was
//      written to engineering_runs.interconnection_method, and hydrated back
//      into the design on the next page load.
//
// The behavioural half below runs the OLD rule and the NEW fold against the
// same fixtures, so the promotion is visible as a value, not as prose. The
// source half pins the page to the shared authority — a 17k-line 'use client'
// page cannot be imported into this node-environment suite, so this file
// follows the same source-contract pattern as tests/productionMeterControlWiring
// .test.ts and tests/batteryBackfeedModels.test.ts, and additionally asserts
// that the mirrored fold below is line-for-line the one the page runs.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveOverallStatus,
  notEvaluated,
  type EngineOutcome,
} from '@/lib/engineering/engineeringStatus';
import { stripComments } from './support/stripSource';

const PAGE_PATH = 'app/engineering/page.tsx';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read(PAGE_PATH);
const PAGE_CODE = stripComments(PAGE);

// ── The rule that was there ────────────────────────────────────────────────
// Copied VERBATIM from app/engineering/page.tsx before this change (it is also
// quoted in the comment that replaced it). Kept executable so the promotion is
// demonstrated rather than asserted.
function overallStatusAsThePageUsedToDeriveIt(calcData: any): string {
  const elecErrors = (calcData.electrical?.errors ?? []).filter((e: any) => !e.autoFixed && e.severity !== 'info');
  const structErrors = (calcData.structural?.errors ?? []).filter((e: any) => e?.severity === 'error');
  const elecStatus = calcData.electrical?.status ?? 'PASS';
  const structStatus = calcData.structural?.status ?? 'PASS';
  if (elecErrors.length > 0 || structErrors.length > 0) return 'FAIL';
  if (elecStatus === 'WARNING' || structStatus === 'WARNING') return 'WARNING';
  return 'PASS';
}

// ── The fold the page runs now ─────────────────────────────────────────────
// Mirrors the block in runCalc(). `pins the mirror to the page` below asserts
// each distinctive expression is still present in the real file, so this cannot
// drift into testing itself.
function overallStatusAsThePageFoldsItNow(calcData: any) {
  const engines: Record<string, EngineOutcome> = {};

  const ne: Array<any> = Array.isArray(calcData.statusNotEvaluated) ? calcData.statusNotEvaluated : [];
  for (const m of ne) engines[m?.engine || 'server'] = notEvaluated(m?.reason || 'skipped');

  if (calcData.overallStatus) {
    engines.server = { evaluated: true, status: calcData.overallStatus, errorCount: 0 };
  } else if (ne.length === 0) {
    engines.server = notEvaluated('skipped');
  }

  const subs = calcData.structural?.subSystems as Record<string, any> | undefined;
  if (subs) {
    for (const [key, sub] of Object.entries(subs)) {
      if (!sub?.status) continue;
      engines[`structural:${key}`] = {
        evaluated: true,
        status: sub.status,
        errorCount: ((sub.errors ?? []) as any[]).filter((e: any) => e?.severity === 'error').length,
      };
    }
  }

  return resolveOverallStatus(engines);
}

// ── Fixtures ───────────────────────────────────────────────────────────────

/**
 * Hybrid roof + fence. The route folds only the LEGACY whole-project run, which
 * on a hybrid is the winner-type (fence) run → WARNING. The page then rebuilds
 * calcData.structural so the scalars show the ROOF subset, which is PASS with
 * no errors. The fence subset's WARNING carries an EMPTY errors array —
 * lib/structural-engine-v4.ts analyzeFenceSystem returns
 * `status: 'WARNING'  // always ESTIMATE until PE sign-off`.
 */
const hybridRoofPlusFence = () => ({
  success: true,
  overallStatus: 'WARNING',
  statusNotEvaluated: [],
  statusBasis: 'all engines evaluated; at least one warning',
  electrical: { status: 'PASS', errors: [] },
  structural: {
    status: 'PASS',            // ← the ROOF subset, as rebuilt for display
    errors: [],
    warnings: [],
    subSystems: {
      roof:  { status: 'PASS',    errors: [], warnings: [] },
      fence: { status: 'WARNING', errors: [], warnings: [] },
    },
  },
});

/** The route could not evaluate: no structural block was sent at all. */
const structuralNotEvaluated = () => ({
  success: true,
  overallStatus: null,
  statusNotEvaluated: [{ engine: 'structural', reason: 'no-input' }],
  statusBasis: 'not evaluated — structural: no-input',
  electrical: { status: 'PASS', errors: [] },
  structural: null,
});

/** A ground-pile subset that genuinely failed, on a project whose whole-project
 *  run (and therefore the route's fold) never saw it. */
const hybridWithGroundFailure = () => ({
  success: true,
  overallStatus: 'WARNING',
  statusNotEvaluated: [],
  electrical: { status: 'PASS', errors: [] },
  structural: {
    status: 'PASS',
    errors: [],
    warnings: [],
    subSystems: {
      roof:   { status: 'PASS', errors: [], warnings: [] },
      ground: {
        status: 'FAIL',
        errors: [{ code: 'PILE_EMBEDMENT', message: 'Embedment below frost depth', severity: 'error' }],
        warnings: [],
      },
    },
  },
});

describe('the client cannot promote the route\'s overall status', () => {
  it('🚨 a hybrid roof+fence project: the old rule printed PASS over the route\'s WARNING', () => {
    const calcData = hybridRoofPlusFence();
    // This is the defect, executed. The route said WARNING; the page said PASS.
    expect(overallStatusAsThePageUsedToDeriveIt(calcData)).toBe('PASS');
    expect(calcData.overallStatus).toBe('WARNING');
  });

  it('the fold keeps WARNING — the fence subset has no PE sign-off', () => {
    const r = overallStatusAsThePageFoldsItNow(hybridRoofPlusFence());
    expect(r.status).toBe('WARNING');
  });

  it('🚨 NOT EVALUATED survives the client: it does not become PASS', () => {
    const calcData = structuralNotEvaluated();
    // Old rule: `calcData.structural?.status ?? 'PASS'` on a null structural,
    // then the unconditional `else { 'PASS' }`. A page that evaluated NOTHING
    // structural showed a green badge.
    expect(overallStatusAsThePageUsedToDeriveIt(calcData)).toBe('PASS');

    const r = overallStatusAsThePageFoldsItNow(calcData);
    expect(r.status).toBeNull();
    expect(r.notEvaluated).toEqual([{ engine: 'structural', reason: 'no-input' }]);
  });

  it('a stated PASS from the route is still PASS — the fold is not a downgrade machine', () => {
    const r = overallStatusAsThePageFoldsItNow({
      overallStatus: 'PASS',
      statusNotEvaluated: [],
      electrical: { status: 'PASS', errors: [] },
      structural: { status: 'PASS', errors: [], warnings: [] },   // legacy, no subSystems
    });
    expect(r.status).toBe('PASS');
  });

  it('a sub-system FAIL the route never saw still escalates to FAIL', () => {
    // Regression guard for deleting the local re-derivation: the merge of
    // sub-system errors existed so a fence/ground FAIL reached overall status.
    // It now reaches it as a per-sub engine outcome instead.
    const r = overallStatusAsThePageFoldsItNow(hybridWithGroundFailure());
    expect(r.status).toBe('FAIL');
  });

  it('a known failure outranks an unknown — FAIL is not softened to null', () => {
    const r = overallStatusAsThePageFoldsItNow({
      overallStatus: null,
      statusNotEvaluated: [{ engine: 'electrical', reason: 'engine-error' }],
      structural: {
        status: 'FAIL',
        subSystems: {
          roof: { status: 'FAIL', errors: [{ severity: 'error', code: 'RAFTER_OVERSTRESS' }] },
        },
      },
    });
    expect(r.status).toBe('FAIL');
    expect(r.notEvaluated).toEqual([{ engine: 'electrical', reason: 'engine-error' }]);
  });
});

describe('the page calls the status authority instead of re-deriving', () => {
  it('the page has something to scan', () => {
    expect(PAGE_CODE.length).toBeGreaterThan(100_000);
  });

  it('it imports the one fold', () => {
    expect(PAGE_CODE).toMatch(/resolveOverallStatus[\s\S]{0,120}from '@\/lib\/engineering\/engineeringStatus'/);
    expect(PAGE_CODE).toContain('resolveOverallStatus(');
  });

  it('🚨 the `?? PASS` re-derivation is gone from runCalc', () => {
    // Comments are stripped first — the replacement comment QUOTES the old code,
    // and a scan that read prose as code would pass against the broken file.
    expect(PAGE_CODE).not.toMatch(/calcData\.electrical\?\.status\s*\?\?\s*['"]PASS['"]/);
    expect(PAGE_CODE).not.toMatch(/calcData\.structural\?\.status\s*\?\?\s*['"]PASS['"]/);
    expect(PAGE_CODE).not.toMatch(/calcData\.overallStatus\s*=\s*['"]PASS['"]/);
    expect(PAGE_CODE).not.toMatch(/calcData\.overallStatus\s*=\s*['"]WARNING['"]/);
    expect(PAGE_CODE).not.toMatch(/calcData\.overallStatus\s*=\s*['"]FAIL['"]/);
  });

  it('pins the mirror to the page — the fold above is the fold that runs', () => {
    // If runCalc's fold changes, this fails and the behavioural half above must
    // be brought back into step instead of quietly testing itself.
    expect(PAGE_CODE).toContain('Array.isArray(calcData.statusNotEvaluated) ? calcData.statusNotEvaluated : []');
    expect(PAGE_CODE).toContain("notEvaluated(m?.reason || 'skipped')");
    expect(PAGE_CODE).toContain("{ evaluated: true, status: calcData.overallStatus, errorCount: 0 }");
    expect(PAGE_CODE).toContain("notEvaluated('skipped')");
    expect(PAGE_CODE).toContain('calcData.structural?.subSystems');
    expect(PAGE_CODE).toContain('`structural:${key}`');
    expect(PAGE_CODE).toMatch(/resolveOverallStatus\(_engines\)/);
    expect(PAGE_CODE).toMatch(/calcData\.overallStatus\s*=\s*_folded\.status/);
    expect(PAGE_CODE).toMatch(/calcData\.statusNotEvaluated\s*=\s*_folded\.notEvaluated/);
  });

  it('the not-evaluated metadata is declared on the client type, not dropped', () => {
    expect(PAGE_CODE).toMatch(/statusNotEvaluated\?:\s*Array<\{\s*engine:\s*string;\s*reason:\s*string\s*\}>/);
    expect(PAGE_CODE).toMatch(/statusBasis\?:\s*string/);
  });
});

describe('an absent interconnection topology is not a supply-side tap', () => {
  // Every `config.interconnectionMethod ?? X` coalescence in the page, with the
  // literal each one falls back to.
  const fallbacks = [...PAGE_CODE.matchAll(/config\.interconnectionMethod\s*\?\?\s*([^,;\n)]+)/g)]
    .map(m => m[1].trim());

  it('there are coalescence sites to check', () => {
    expect(fallbacks.length).toBeGreaterThan(5);
  });

  it('🚨 no site defaults to SUPPLY_SIDE_TAP — supply-side is a different permit', () => {
    // The persistence path was the ONLY one that did, and its value round-tripped
    // back into the design through engineering_runs.interconnection_method.
    expect(fallbacks).not.toContain("'SUPPLY_SIDE_TAP'");
    expect(PAGE_CODE).not.toMatch(/interconnectionMethod\s*\?\?\s*['"]SUPPLY_SIDE_TAP['"]/);
  });

  it('every remaining default is LOAD_SIDE (engine boundary) or null (UNRESOLVED)', () => {
    for (const f of fallbacks) {
      expect(["'LOAD_SIDE'", 'null'], `unexpected interconnection fallback: ${f}`).toContain(f);
    }
  });

  it('the persistence path records UNRESOLVED rather than guessing', () => {
    expect(PAGE_CODE).toMatch(/interconnection:\s*config\.interconnectionMethod\s*\?\?\s*null/);
  });

  it('a null topology cannot clobber the live config on hydration', () => {
    // Both round-trip sites must stay truthiness-guarded, or recording null
    // would come back as "unset the design's topology" instead of "unstated".
    expect(PAGE_CODE).toMatch(/if\s*\(run\.interconnectionMethod\)\s*patches\.interconnectionMethod/);
    expect(PAGE_CODE).toMatch(/if\s*\(snap\.interconnectionMethod\)\s*patches\.interconnectionMethod/);
  });
});
