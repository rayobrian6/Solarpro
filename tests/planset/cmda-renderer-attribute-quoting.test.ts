// ═══════════════════════════════════════════════════════════════════════════
// CMDA §R — RENDERER ATTRIBUTE QUOTING.
//
// The shipped Braidon artifact contains:
//
//     style="font-family:"SolarPro Mono","SolarPro Symbols";font-size:6.4px;"
//              ─────────┬────────────────────────────────┬─
//              the attribute ENDS at the first inner quote
//
// An HTML parser closes `style` there; the rest becomes stray attributes, the
// declared font never applies, and the markup is invalid. Forty-six call sites
// across six renderer sources hand-wrote the stack that way.
//
// FIXED AT THE SOURCE: `CSS_FONT_*_STACK` in fonts/fontPack.ts spell the family
// names with SINGLE quotes, which nest safely inside a double-quoted attribute.
// This test proves generated HTML is clean AND that no source file re-introduces
// the construction — because a fix that only cleans today's output would be
// re-broken by the next call site.
//
// RENDERING CORRECTNESS ONLY. Nothing here touches module authority semantics.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  MALFORMED_STYLE_FONT_FAMILY_RE,
  CSS_FONT_SANS_STACK, CSS_FONT_MONO_STACK, CSS_FONT_SYMBOLS_STACK, CSS_FONT_SANS_UI_STACK,
} from '@/lib/permit/fonts/fontPack';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function renderedHtml(): string {
  const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  input.generatedAtIso = '2026-08-07T12:00:00.000Z';
  input.plansetProfile = 'full';
  (input.project as Record<string, unknown>).projectName = 'CMDA RENDERER FIXTURE';
  return generatePermitHTML(input as never, undefined, undefined as never);
}

/** Every `style="…"` attribute in the document, as the parser would delimit it. */
function styleAttributes(html: string): string[] {
  return [...html.matchAll(/style="([^"]*)"/g)].map(m => m[1]);
}

describe('CMDA §R · the font stack constants are the only correct spelling', () => {
  it('the constants use single quotes, so they nest inside a double-quoted attribute', () => {
    for (const stack of [CSS_FONT_SANS_STACK, CSS_FONT_MONO_STACK, CSS_FONT_SYMBOLS_STACK, CSS_FONT_SANS_UI_STACK]) {
      expect(stack).not.toContain('"');
      expect(stack).toContain("'");
      expect(`style="font-family:${stack};"`).not.toMatch(MALFORMED_STYLE_FONT_FAMILY_RE);
    }
    expect(CSS_FONT_SANS_STACK).toBe("'SolarPro Sans','SolarPro Symbols'");
    expect(CSS_FONT_MONO_STACK).toBe("'SolarPro Mono','SolarPro Symbols'");
  });

  it('the malformed detector actually detects the shipped defect (anti-vacuity)', () => {
    expect('style="font-family:"SolarPro Mono","SolarPro Symbols";font-size:6.4px;"')
      .toMatch(MALFORMED_STYLE_FONT_FAMILY_RE);
    expect('style="font-family:\'SolarPro Mono\',\'SolarPro Symbols\';font-size:6.4px;"')
      .not.toMatch(MALFORMED_STYLE_FONT_FAMILY_RE);
  });
});

describe('CMDA §R · generated HTML contains no malformed style attribute', () => {
  it('the full permit set renders with valid attribute quoting', () => {
    const html = renderedHtml();
    expect(html.length).toBeGreaterThan(10_000);
    expect(html).not.toMatch(MALFORMED_STYLE_FONT_FAMILY_RE);
    // and no style attribute anywhere carries a stray double quote
    const bad = styleAttributes(html).filter(s => s.includes('"'));
    expect(bad, `malformed style attributes: ${bad.slice(0, 3).join(' | ')}`).toEqual([]);
    // the corrected spelling IS present — proving the fixture exercises the sites
    expect(html).toContain("font-family:'SolarPro");
  }, 300_000);

  it('every emitted font-family names a pack family with single quotes', () => {
    const html = renderedHtml();
    // Read the declarations from the PARSED attribute values, not from the raw
    // document — a regex over raw HTML runs past the closing quote of the final
    // declaration and reports the next tag as part of the family.
    const families = styleAttributes(html)
      .flatMap(attr => attr.split(';'))
      .map(d => d.trim())
      .filter(d => d.toLowerCase().startsWith('font-family:'))
      .map(d => d.slice('font-family:'.length).trim());
    expect(families.length).toBeGreaterThan(0);
    for (const f of families) {
      // THE defect: a double quote inside the attribute value. `var(--mono)` and
      // other unquoted forms are legitimate and deliberately not constrained here.
      expect(f, `malformed font-family declaration: ${f}`).not.toContain('"');
    }
    // …and where a pack family IS named inline, it is single-quoted.
    const named = families.filter(f => f.includes('SolarPro'));
    expect(named.length).toBeGreaterThan(0);
    for (const f of named) expect(f).toMatch(/'SolarPro (Sans|Mono|Symbols)'/);
  }, 300_000);
});

describe('CMDA §R · no renderer source may re-introduce the construction', () => {
  it('scans every renderer source for a double-quoted family inside style="…"', () => {
    const roots = ['lib/permit/sections', 'lib/drafting', 'lib/permit/utils'];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const e of entries) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue;
        const src = readFileSync(p, 'utf8');
        for (const line of src.split('\n')) {
          if (MALFORMED_STYLE_FONT_FAMILY_RE.test(line)) offenders.push(`${p}: ${line.trim().slice(0, 120)}`);
        }
      }
    };
    for (const r of roots) walk(r);
    expect(offenders, `use CSS_FONT_*_STACK from fonts/fontPack instead:\n${offenders.join('\n')}`).toEqual([]);
  });
});
