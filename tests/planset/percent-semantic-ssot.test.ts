// ═══════════════════════════════════════════════════════════════════════════
// D4 — one percentage semantic, for a field that had two.
//
//     lib/equipment-db.ts            efficiency: 97.0   // PERCENT ("// %")
//     system.inverters[].efficiency  0.97               // FRACTION
//
// `${inv.efficiency}%` printed `0.97%` on the equipment schedule — an inverter
// discarding 99% of its input.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPercent, percentLabel, PERCENT_NOT_AVAILABLE } from '@/lib/permit/utils/percentDisplay';

describe('both stored forms normalise to one printed semantic', () => {
  it('a fraction becomes a percent', () => {
    expect(toPercent(0.97)).toBeCloseTo(97, 6);
    expect(percentLabel(0.97)).toBe('97.0%');
  });

  it('a percent is left alone', () => {
    expect(toPercent(97)).toBe(97);
    expect(percentLabel(97)).toBe('97.0%');
    expect(percentLabel(22.53)).toBe('22.5%');
  });

  it('1 is treated as a fraction — 100%, not 1%', () => {
    // The boundary. Nothing in this domain is 1% efficient.
    expect(toPercent(1)).toBe(100);
  });
});

describe('it refuses rather than guessing — this is not a blind multiply', () => {
  it('returns null for values that cannot be a percentage', () => {
    // "if it is small, times a hundred" is how 9.7 becomes 970. Bounded by the
    // physics of a ratio instead.
    for (const v of [0, -1, 101, 970, 9700, NaN, Infinity, null, undefined, 'abc', {}]) {
      expect(toPercent(v as never), `toPercent(${String(v)})`).toBeNull();
      expect(percentLabel(v as never)).toBe(PERCENT_NOT_AVAILABLE);
    }
  });

  it('does NOT rescale an out-of-range value into plausibility', () => {
    // The codebase already shipped "25.8% efficiency (physically impossible for
    // silicon)" from a fabricated module size. A normaliser that silently
    // rescaled anything would have hidden that instead of letting it show.
    expect(toPercent(258)).toBeNull();
    expect(toPercent(25.8)).toBe(25.8);   // in range: printed as-is, not "fixed"
  });
});

describe('no render site formats a percentage by hand any more', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('the equipment/efficiency rows go through the normaliser', () => {
    for (const f of ['lib/permit/sections/compliancePages.ts',
      'lib/permit/sections/structuralPages.ts']) {
      expect(read(f), `${f} still interpolates a raw efficiency with a % sign`)
        .not.toMatch(/\$\{[^}]*\befficiency\b[^}]*\}%/);
    }
  });
});

describe('the rendered package', () => {
  it('prints no sub-1% efficiency', () => {
    let html: string;
    try { html = readFileSync(join(process.cwd(), '_tmp_prod.html'), 'utf8'); } catch { return; }
    const t = html
      .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
    // Temperature coefficients are legitimately fractions of a percent, so scope
    // to the efficiency columns rather than banning "0.x%" outright.
    const effRows = [...t.matchAll(/Efficiency[^%]{0,60}%/gi)].map(m => m[0]);
    for (const row of effRows) {
      expect(row, `sub-1% efficiency printed: ${row}`).not.toMatch(/\b0\.\d+\s*%/);
    }
  });
});
