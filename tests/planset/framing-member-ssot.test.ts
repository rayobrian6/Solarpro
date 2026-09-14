// ═══════════════════════════════════════════════════════════════════════════
// ONE FRAMING MEMBER, ONE PRODUCER — and an unobserved member says so.
//
// Five sites carried their own fallback for the same fact and disagreed:
// roof.ts printed '2×4' in MAIN HOME ROOF DESCRIPTION while sheetComposition
// printed '2x6' in SYSTEM DATA, on ONE package. Traced on the live Braidon row,
// `project.rafterSize` is undefined and `framingType` is 'unknown' — so BOTH
// literals were fabricated, and the canonical projection already said so:
// observedFramingLine = "FRAMING GEOMETRY NOT OBSERVED".
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveFramingMemberLabel, isFramingMemberObserved, FRAMING_MEMBER_NOT_OBSERVED,
} from '@/lib/permit/utils/framingDisplay';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the resolver never invents a member size', () => {
  it('returns the observed size when the project carries one', () => {
    expect(resolveFramingMemberLabel({ rafterSize: '2x8' })).toBe('2x8');
    expect(isFramingMemberObserved({ rafterSize: '2x8' })).toBe(true);
  });

  it('falls back to trussSize before giving up', () => {
    expect(resolveFramingMemberLabel({ trussSize: '2x10' })).toBe('2x10');
  });

  it('says NOT OBSERVED for absent, blank and literal "unknown"', () => {
    // `framingType: 'unknown'` is what the live Braidon row actually carries —
    // the string "unknown" must not be printed as if it were a member size.
    for (const p of [undefined, null, {}, { rafterSize: '' }, { rafterSize: '  ' },
      { rafterSize: 'unknown' }, { rafterSize: 'UNKNOWN' }]) {
      expect(resolveFramingMemberLabel(p as never)).toBe(FRAMING_MEMBER_NOT_OBSERVED);
      expect(isFramingMemberObserved(p as never)).toBe(false);
    }
  });
});

describe('no renderer carries its own framing fallback any more', () => {
  const SITES = [
    'lib/drafting/templates/roof.ts',
    'lib/drafting/sheetComposition.ts',
    'lib/permit/sections/structuralPages.ts',
  ];

  it('none of the three render sites hardcodes a member size fallback', () => {
    for (const f of SITES) {
      const src = read(f);
      expect(src, `${f} still has a '|| 2x4/2x6' framing fallback`)
        .not.toMatch(/(rafterSize|trussSize)[^\n]{0,40}\|\|\s*'2[x\u00d7][46]'/);
    }
  });

  it('each site USES the canonical resolver, not merely imports it', () => {
    for (const f of SITES) {
      const used = read(f).split(/\r?\n/)
        .filter(l => !/^\s*import\b/.test(l))
        .some(l => l.includes('resolveFramingMemberLabel('));
      expect(used, `${f} imports the resolver but never calls it`).toBe(true);
    }
  });
});

describe('the rendered package agrees with itself', () => {
  it('prints no fabricated member size, and no repeated NOT OBSERVED run', () => {
    let html: string;
    try { html = read('_tmp_prod.html'); } catch { return; }
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

    // The cross-section draws one label PER BAY; an unobserved member printed
    // the token four times in a row and read as a broken drawing.
    expect(text).not.toMatch(/(NOT OBSERVED\s*){3,}/);

    // Braidon observes no framing, so no member size may appear as this
    // project's framing. (Base64 font data is excluded by scanning text only.)
    const sizes = [...text.matchAll(/\b2\s*[x\u00d7]\s*[468]\b/gi)].map(m => m[0]);
    expect(sizes, `fabricated member size(s) on the sheets: ${sizes.join(', ')}`).toEqual([]);
  });
});
