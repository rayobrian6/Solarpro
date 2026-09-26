/**
 * tests/stripSourceIsJsxSafe.test.ts
 *
 * THE HELPER EVERY SOURCE-SCAN GUARD STANDS ON, GUARDED ITSELF.
 *
 * `tests/support/stripSource.ts` blanks comments (and, in the identifier variant,
 * literal text) to whitespace while preserving byte offsets. Roughly fifty guards
 * in this suite scan its output. If it blanks real code, those guards read
 * whitespace: a positive assertion fails against correct source, and — far worse —
 * a NEGATIVE assertion passes against source that still contains the thing it
 * forbids. It reads as coverage and is blind.
 *
 * The hand-rolled version did exactly that. It treated every quote character as a
 * string delimiter regardless of context, so three ordinary constructs opened a
 * "string" that closed in the wrong place and inverted the quote parity of
 * everything after it:
 *
 *   • an apostrophe in JSX text — a possessive in a sentence a user reads
 *   • a quote character inside a regex literal (so this was never .tsx-only)
 *   • a template literal nested inside another template literal
 *
 * Measured on components/design/DesignStudio.tsx at the time: the JSX element
 * rendering the 3D engine, and two of the props handed to it, each went from one
 * occurrence in the raw source to ZERO after the identifier stripper.
 *
 * Section 1 works on tests/fixtures/jsxApostrophe.fixture.tsx — a specimen of all
 * three constructs, with sentinels named for the question each answers. Section 2
 * repeats the measurement on the real component, so the fixture cannot drift away
 * from the thing it stands in for. Section 3 pins the refusal: unparseable input
 * must THROW, because returning a best-effort blanking is the failure mode above.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments, stripCommentsAndStrings } from './support/stripSource';

const ROOT = join(__dirname, '..');
const FIXTURE_PATH = join(ROOT, 'tests', 'fixtures', 'jsxApostrophe.fixture.tsx');
const RAW = readFileSync(FIXTURE_PATH, 'utf8');
const BARE = stripCommentsAndStrings(RAW);
const KEPT = stripComments(RAW);

/** Occurrences of a plain token — no regex, so a sentinel cannot be mis-escaped. */
const n = (src: string, token: string): number => src.split(token).length - 1;

describe('the fixture is really the specimen it claims to be', () => {
  it('carries a raw apostrophe in JSX text, a double slash in JSX text, a quoted regex and a nested template', () => {
    // If someone "tidies" the fixture, every assertion below would pass against
    // a stripper that is broken again, so the specimen is pinned first.
    expect(RAW, 'the possessive in JSX text is gone').toContain("}'s roof");
    expect(RAW, 'the double slash in JSX text is gone').toContain('https://example.test/a//b');
    expect(RAW, 'the regex holding both quote characters is gone').toContain("/['\"]/g");
    expect(RAW, 'the nested template is gone').toMatch(/`head \$\{owner \? `inner /);
  });

  it('both strippers preserve byte offsets and line structure', () => {
    for (const [label, out] of [['identifier stripper', BARE], ['comment stripper', KEPT]] as const) {
      expect(out.length, `${label} changed the length — every offset-based guard is now wrong`)
        .toBe(RAW.length);
      expect(out.split('\n').length, `${label} changed the line count`).toBe(RAW.split('\n').length);
    }
  });
});

describe('🚨 JSX text does not blank the code around it', () => {
  it('an apostrophe in JSX text does not swallow the elements that follow it', () => {
    // THE ORIGINAL DEFECT. The child element and the prop handed to it sit
    // BETWEEN two apostrophes in user-facing JSX text. The old stripper blanked
    // everything between them, so both counts fell to zero.
    expect(n(RAW, '<StripFixtureChild'), 'fixture drift').toBe(2);
    expect(n(BARE, '<StripFixtureChild'), 'JSX element names are code and must survive').toBe(2);
    expect(n(BARE, 'dataSentinelProp={'), 'JSX attribute names are code and must survive').toBe(2);
  });

  it('a double slash in JSX text is not a comment', () => {
    // A URL in a sentence. Treating `//` as a line comment there blanks the rest
    // of the line, including anything a literal-value guard was looking for.
    expect(n(KEPT, 'STRIP_FIXTURE_AFTER_DOUBLE_SLASH'), 'the comment stripper ate JSX text after a URL')
      .toBe(1);
  });

  it('but JSX TEXT ITSELF is a literal — prose must not count as code', () => {
    // Symmetry with a string literal: a sentence a user reads is prose. An
    // identifier scan that counted it would report a usage that does not exist.
    expect(n(BARE, 'STRIP_FIXTURE_JSX_PROSE'), 'JSX prose survived the identifier stripper').toBe(0);
    expect(n(KEPT, 'STRIP_FIXTURE_JSX_PROSE'), 'JSX prose must survive the comment stripper').toBe(1);
  });
});

describe('🚨 a quote inside a regex, and a template inside a template', () => {
  it('a regex literal holding quote characters does not blank the code after it', () => {
    // Measured on app/api/engineering/sld/pdf/route.ts, whose HTML escaper
    // replaces both quote characters: a guard in the combiner suite had already
    // been downgraded to the comment-only stripper to work around this without
    // knowing the cause.
    expect(n(BARE, 'quoteEater'), 'the regex variable itself vanished').toBe(2);
    expect(n(BARE, 'STRIP_FIXTURE_AFTER_REGEX'), 'code after a quoted regex vanished').toBe(2);
  });

  it('a nested template literal does not blank the code after it', () => {
    expect(n(BARE, 'STRIP_FIXTURE_AFTER_NESTED_TEMPLATE'), 'code after a nested template vanished').toBe(2);
  });

  it('and the literal text inside those constructs IS still blanked', () => {
    // The positive control in the other direction: the point of the identifier
    // stripper is that literal text does not count, and a parity slip can leave a
    // string body standing just as easily as it can blank real code.
    expect(n(BARE, 'STRIP_FIXTURE_STRING_BODY'), 'a string body survived the identifier stripper').toBe(0);
    expect(n(BARE, 'STRIP_FIXTURE_ATTRIBUTE_STRING'), 'a JSX attribute string survived').toBe(0);
    expect(n(BARE, 'STRIP_FIXTURE_TEMPLATE_TEXT'), 'template text survived').toBe(0);
    expect(n(KEPT, 'STRIP_FIXTURE_STRING_BODY'), 'the comment stripper must KEEP string bodies').toBe(1);
    expect(n(KEPT, 'STRIP_FIXTURE_TEMPLATE_TEXT'), 'the comment stripper must KEEP template text').toBe(1);
  });

  it('a template’s ${…} is CODE and survives the identifier stripper', () => {
    // The old loop blanked a whole template including its embedded expressions,
    // which hid real calls from identifier scans.
    expect(BARE, 'the interpolated expression was blanked with the surrounding text')
      .toMatch(/\$\{\s*owner\s*\?/);
  });
});

describe('comments are removed by BOTH strippers, wherever they sit', () => {
  it('block, line and JSX-expression comments all go', () => {
    for (const sentinel of [
      'STRIP_FIXTURE_BLOCK_COMMENT',
      'STRIP_FIXTURE_LINE_COMMENT',
      'STRIP_FIXTURE_JSX_EXPRESSION_COMMENT',
    ]) {
      expect(n(RAW, sentinel), `fixture drift: ${sentinel}`).toBe(1);
      expect(n(BARE, sentinel), `${sentinel} survived the identifier stripper`).toBe(0);
      expect(n(KEPT, sentinel), `${sentinel} survived the comment stripper`).toBe(0);
    }
  });

  it('and a division is still not a comment', () => {
    const src = 'const r = a / b; const q = 1 / 2; const z = 3;';
    expect(stripCommentsAndStrings(src)).toBe(src);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE REAL COMPONENT THE DEFECT WAS MEASURED ON
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the measured case, on the real source', () => {
  const STUDIO_RAW = readFileSync(join(ROOT, 'components', 'design', 'DesignStudio.tsx'), 'utf8');
  const STUDIO_BARE = stripCommentsAndStrings(STUDIO_RAW);

  it('the engine render site and its props survive the identifier stripper', () => {
    // These are the three tokens that were measured at 1 in the raw source and 0
    // after stripping. Asserted as a RELATION to the raw count, not as a fixed
    // number, so a legitimate second render site does not fail this — it is the
    // stripper being audited here, not the component.
    for (const token of ['<SolarEngine3D', 'geometryLifecycleRef={', 'roofRestoreResolved={']) {
      const raw = n(STUDIO_RAW, token);
      expect(raw, `${token} is no longer in DesignStudio.tsx — re-anchor this guard`).toBeGreaterThan(0);
      expect(n(STUDIO_BARE, token), `${token} was blanked out of real code`).toBe(raw);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. REFUSAL
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 it refuses input it cannot parse rather than returning whitespace', () => {
  const UNPARSEABLE = [
    ['an unclosed parameter list', 'function f( {'],
    ['punctuation soup', 'const x = ;;; <<< >>>'],
    ['an unclosed JSX element', '<div>'],
    ['not JavaScript at all', 'SELECT * FROM proposals WHERE id = 1;'],
  ] as const;

  for (const [label, src] of UNPARSEABLE) {
    it(`throws on ${label}`, () => {
      expect(() => stripCommentsAndStrings(src)).toThrow(/REFUSING/);
      expect(() => stripComments(src)).toThrow(/REFUSING/);
    });
  }

  it('and the refusal names the line, so the caller can see what it choked on', () => {
    expect(() => stripComments('const ok = 1;\nconst bad = ;;;\n')).toThrow(/line 2/);
  });

  it('valid .ts that is not valid .tsx is still accepted', () => {
    // An angle-bracket type assertion is legal in a .ts file and impossible in a
    // .tsx one. Neither stripper takes a filename, so the dialect is decided by
    // whichever reading parses — and refusing this would break every .ts scan
    // that happens to use one.
    const src = 'const n = <number>someValue; // tail\n';
    expect(stripCommentsAndStrings(src)).toContain('<number>someValue');
    expect(stripCommentsAndStrings(src)).not.toContain('tail');
  });
});
