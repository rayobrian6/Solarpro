/**
 * tests/support/stripSource.ts
 *
 * Source-scan guards in this repo have been defeated in BOTH directions, so the
 * two strippers below are deliberately separate and you must pick the right one.
 *
 *   stripCommentsAndStrings  for scanning IDENTIFIERS and CALL SHAPES.
 *                            e.g. "is plane3DCesiumPtsMap enumerated anywhere
 *                            outside liveRenderedFaces?" — prose naming the map
 *                            must not count, and neither must a string literal.
 *
 *   stripComments            for scanning LITERAL VALUES.
 *                            e.g. "does any `?? 'PASS'` fallback survive?" —
 *                            here the string body IS the thing being searched
 *                            for, and blanking it makes the guard VACUOUS.
 *
 * That second case is not hypothetical: the first version of the
 * engineering-status guard used the identifier stripper to look for `?? 'PASS'`,
 * so `'PASS'` had already been blanked to `'    '` and the assertion passed
 * against a route that still contained the fallback. A guard that cannot fail is
 * worse than no guard, because it reads as coverage.
 *
 * Both preserve byte offsets by replacing removed spans with spaces (newlines
 * and carriage returns are kept, so line-anchored patterns still work).
 *
 * ── WHY THIS FILE IS PARSER-BACKED, AND NOT A CHARACTER LOOP ─────────────────
 *
 * 🚨 THE HAND-ROLLED VERSION BLANKED REAL CODE, SILENTLY, AND GUARDS BUILT ON IT
 *    PASSED WHILE READING WHITESPACE.
 *
 * It walked characters and treated every `'`, `"` and backtick as a string
 * delimiter regardless of context. Three constructs that are ordinary in this
 * codebase therefore opened a "string" that never closed where it thought:
 *
 *   1. AN APOSTROPHE IN JSX TEXT — a possessive or contraction in a sentence a
 *      user reads. Measured on components/design/DesignStudio.tsx: the JSX
 *      element that renders the 3D engine and two of the props passed to it each
 *      went from 1 occurrence in the raw source to 0 after stripping. A guard
 *      looking for them read whitespace; a guard ASSERTING THEIR ABSENCE passed.
 *   2. A QUOTE INSIDE A REGEX LITERAL — so this was never a .tsx-only hole.
 *      Measured on app/api/engineering/sld/pdf/route.ts, whose HTML escaper
 *      contains a regex matching a double quote and another matching an
 *      apostrophe: `sldCombinerFields(` went from 1 to 0, and a guard in
 *      tests/combinerProjectSelection.test.ts had already been downgraded to the
 *      comment-only stripper to work around it without knowing the cause.
 *   3. NESTED TEMPLATE LITERALS — the inner backtick closed the outer template
 *      early and the parity of every backtick after it was inverted.
 *
 * So the scanner is now TypeScript's own parser (`typescript` is already a
 * devDependency and is the same parser `tsc --noEmit` runs). The AST gives the
 * EXACT byte ranges of string bodies, template text chunks, JSX text and regex
 * literals, and comments are then whatever `//` or opening block-comment token
 * appears OUTSIDE those ranges — which is exact, because the only things that
 * can hide or fake a comment opener are literals, and those ranges are now known
 * rather than guessed.
 *
 * DELIBERATE RULINGS, so a future reader does not have to re-derive them:
 *
 *   • JSX TEXT COUNTS AS A STRING. `<p>Ray's roof</p>` is prose a user reads, so
 *     `stripCommentsAndStrings` blanks it and `stripComments` keeps it — exactly
 *     as for `'Ray\'s roof'`. Tag names and attribute names are code and always
 *     survive, which is what makes `<SolarEngine3D` and `geometryLifecycleRef={`
 *     scannable again.
 *   • A TEMPLATE'S `${…}` IS CODE. Only the literal text chunks are blanked. The
 *     old loop blanked the whole template including the embedded expressions,
 *     which hid real calls from identifier scans.
 *   • A REGEX BODY IS KEPT BY BOTH. It is neither prose nor an identifier, and
 *     blanking it would break guards that pin a regex a route actually uses. Its
 *     range is still needed — and is now known — so that a quote or a `//` INSIDE
 *     a regex cannot derail the scan.
 *   • ON UNPARSEABLE INPUT THIS THROWS. If neither the .tsx nor the .ts reading
 *     of the text parses without syntax errors, there is no trustworthy range
 *     data, and returning a best-effort blanking is the exact failure this file
 *     exists to stop: the caller gets whitespace and its assertion passes. A
 *     helper that refuses is safe; one that quietly blanks is not.
 */

import ts from 'typescript';

type Span = [number, number];

interface Scan {
  /** Bytes that are LITERAL TEXT: string bodies, template text chunks, JSX text. */
  text: Span[];
  /** Bytes a comment opener can never be found in: `text` plus regex literals. */
  opaque: Span[];
  /** Comment spans, `//` and block delimiters included. */
  comments: Span[];
}

/**
 * Parsing a 400 KB component is not free and several callers strip the same file
 * more than once, so the last few results are kept. Keyed on the source text, so
 * a changed file can never hit a stale entry.
 */
const cache = new Map<string, Scan>();
const CACHE_LIMIT = 24;

interface ParseDiag { start?: number; messageText?: unknown }
const diagnosticsOf = (sf: ts.SourceFile): ParseDiag[] =>
  (sf as unknown as { parseDiagnostics?: ParseDiag[] }).parseDiagnostics ?? [];

/**
 * TSX and TS disagree about exactly two things: JSX, and angle-bracket type
 * assertions (`<Foo>x`, legal in .ts and impossible in .tsx). Trying both and
 * demanding that one of them parses cleanly identifies the dialect without the
 * caller having to pass a filename, and refuses rather than guessing when
 * neither does.
 */
function parse(src: string): ts.SourceFile {
  const asTsx = ts.createSourceFile('__stripSource__.tsx', src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const tsxErrs = diagnosticsOf(asTsx);
  if (tsxErrs.length === 0) return asTsx;

  const asTs = ts.createSourceFile('__stripSource__.ts', src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const tsErrs = diagnosticsOf(asTs);
  if (tsErrs.length === 0) return asTs;

  const [errs, label] = tsErrs.length <= tsxErrs.length
    ? [tsErrs, 'TS'] as const
    : [tsxErrs, 'TSX'] as const;
  const first = errs[0];
  const line = first?.start != null ? src.slice(0, first.start).split('\n').length : '?';
  const text = typeof first?.messageText === 'string'
    ? first.messageText
    : String((first?.messageText as { messageText?: string } | undefined)?.messageText ?? 'syntax error');
  throw new Error(
    `stripSource: REFUSING to strip input it cannot parse. Best reading (${label}) has ` +
    `${errs.length} syntax error(s); first at line ${line}: ${text}. ` +
    'Returning a best-effort blanking would hand the caller whitespace, and a guard ' +
    'that scans whitespace passes for the wrong reason. Pass real TS/TSX source, or ' +
    'scan the raw text yourself and say in a comment why that is safe.',
  );
}

function scan(src: string): Scan {
  const hit = cache.get(src);
  if (hit) return hit;

  const sf = parse(src);
  const text: Span[] = [];
  const opaque: Span[] = [];

  const push = (arr: Span[], a: number, b: number): void => {
    const lo = Math.max(0, Math.min(a, src.length));
    const hi = Math.max(lo, Math.min(b, src.length));
    if (hi > lo) arr.push([lo, hi]);
  };

  const visit = (node: ts.Node): void => {
    // `node.pos` includes leading trivia; `getStart(sf)` skips it. The source
    // file is passed explicitly because this AST is built without parent
    // pointers, which is what makes parsing a 400 KB component cheap.
    const s = node.getStart(sf);
    const e = node.end;
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        push(text, s + 1, e - 1);                 // inside the quotes/backticks
        break;
      case ts.SyntaxKind.TemplateHead:            // `text${   → drop 1 + 2
        push(text, s + 1, e - 2);
        break;
      case ts.SyntaxKind.TemplateMiddle:          // }text${   → drop 1 + 2
        push(text, s + 1, e - 2);
        break;
      case ts.SyntaxKind.TemplateTail:            // }text`    → drop 1 + 1
        push(text, s + 1, e - 1);
        break;
      case ts.SyntaxKind.JsxText:
        // JSX text owns the whitespace and newlines around it, and there are no
        // delimiters to preserve — the whole node is prose.
        push(text, node.pos, e);
        break;
      case ts.SyntaxKind.RegularExpressionLiteral:
        push(opaque, s, e);                       // protected, but NOT blanked
        break;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  for (const span of text) opaque.push(span);
  opaque.sort((a, b) => a[0] - b[0]);

  // A comment is any `//` or `/*` that is not inside a literal or a regex. That
  // is exhaustive: `a // b` and `a /* b` are not valid expressions, so outside a
  // literal those two byte pairs can only be comment openers.
  const comments: Span[] = [];
  let oi = 0;
  let i = 0;
  while (i < src.length) {
    while (oi < opaque.length && opaque[oi][1] <= i) oi++;
    if (oi < opaque.length && i >= opaque[oi][0]) { i = opaque[oi][1]; continue; }
    const limit = oi < opaque.length ? opaque[oi][0] : src.length;
    if (src[i] === '/' && i + 1 < limit && src[i + 1] === '/') {
      let j = i; while (j < src.length && src[j] !== '\n') j++;
      comments.push([i, j]); i = j; continue;
    }
    if (src[i] === '/' && i + 1 < limit && src[i + 1] === '*') {
      let j = i + 2; while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++;
      comments.push([i, Math.min(j + 2, src.length)]); i = j + 2; continue;
    }
    i++;
  }

  const result: Scan = { text, opaque, comments };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(src, result);
  return result;
}

function blank(src: string, spans: Span[]): string {
  const out = src.split('');
  for (const [a, b] of spans) {
    for (let k = a; k < b && k < out.length; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  }
  return out.join('');
}

/**
 * Removes comments AND string/template/JSX-text bodies. For identifier scans.
 * Throws on input that does not parse — see the header.
 */
export function stripCommentsAndStrings(src: string): string {
  const s = scan(src);
  return blank(src, s.comments.concat(s.text));
}

/**
 * Removes comments ONLY, keeping string, template and JSX text. For
 * literal-value scans. Throws on input that does not parse — see the header.
 */
export function stripComments(src: string): string {
  return blank(src, scan(src).comments);
}
