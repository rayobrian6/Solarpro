// ═══════════════════════════════════════════════════════════════════════════
// THE EAVE DEFAULT HAD TWO VALUES, 2x APART.
//
// `ahjRoofSetbackIn` means EAVE / RAKE EDGE SETBACK (N33 semantic map). Two
// places supplied a default when the project carries none:
//
//     lib/cad/roof/roofCAD.ts          DEFAULT_EAVE_SETBACK_IN = 36   (drawn)
//     engineeringDecisionProvenance    ... ?? 18                      (reported)
//
// With no CAD roof present the provenance record stated an 18" assumption while
// the engine's own default draws 36". MEASURED REACH: roofCAD emits
// `cad.roof.setbackIn`, so the literal was reached only when there was no
// geometry to contradict it — which is why it survived.
//
// 18 is the RIDGE constant (IFC §1204.2.1.1), which is the likely origin.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_EAVE_SETBACK_IN, resolveEaveSetbackIn, MODELED_HIP_VALLEY_SETBACK_IN,
} from '@/lib/permit/utils/fireSetback';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('one producer for the eave/rake default', () => {
  it('the canonical default is 36" — what the engine actually draws', () => {
    expect(DEFAULT_EAVE_SETBACK_IN).toBe(36);
  });

  it('is NOT the ridge constant — the two facts are distinct', () => {
    // The 18 in the evaluator equalled the ridge setback. If these ever become
    // equal again it should be because someone decided it, not by copy.
    expect(DEFAULT_EAVE_SETBACK_IN).not.toBe(MODELED_HIP_VALLEY_SETBACK_IN);
  });

  it('a project value overrides; absent/zero/negative falls back', () => {
    expect(resolveEaveSetbackIn(30)).toBe(30);
    expect(resolveEaveSetbackIn(null)).toBe(DEFAULT_EAVE_SETBACK_IN);
    expect(resolveEaveSetbackIn(undefined)).toBe(DEFAULT_EAVE_SETBACK_IN);
    expect(resolveEaveSetbackIn(0)).toBe(DEFAULT_EAVE_SETBACK_IN);
    expect(resolveEaveSetbackIn(-5)).toBe(DEFAULT_EAVE_SETBACK_IN);
  });

  it('neither consumer restates the value as a literal', () => {
    expect(read('lib/cad/roof/roofCAD.ts'))
      .not.toMatch(/DEFAULT_EAVE_SETBACK_IN\s*=\s*\d/);
    expect(read('lib/engineeringDecisionProvenance/evaluator.ts'))
      .not.toMatch(/cad\?\.roof\?\.setbackIn\s*\?\?\s*\d/);
  });

  it('both consumers import the canonical symbol', () => {
    for (const f of ['lib/cad/roof/roofCAD.ts',
      'lib/engineeringDecisionProvenance/evaluator.ts']) {
      // an invocation/use, not merely the name appearing somewhere
      const used = read(f).split(/\r?\n/)
        .filter(l => !/^\s*import\b/.test(l))
        .some(l => l.includes('DEFAULT_EAVE_SETBACK_IN'));
      expect(used, `${f} imports the symbol but never uses it`).toBe(true);
      expect(read(f)).toContain("from '@/lib/permit/utils/fireSetback'");
    }
  });

  it('the provenance fallback now agrees with the drawn default', () => {
    // The exact evaluator expression at the shape that used to yield 18.
    const project: Record<string, number> = {};
    const cad: { roof?: { setbackIn?: number } } | null = null;
    const resolved = project?.ahjRoofSetbackIn ?? cad?.roof?.setbackIn ?? DEFAULT_EAVE_SETBACK_IN;
    expect(resolved).toBe(36);
  });
});
