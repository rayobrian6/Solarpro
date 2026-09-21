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
 * Both preserve byte offsets by replacing removed spans with spaces.
 */

function blankInto(out: string[], from: number, to: number): void {
  for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
}

interface StripOptions { strings: boolean }

function strip(src: string, opts: StripOptions): string {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i; while (j < src.length && src[j] !== '\n') j++;
      blankInto(out, i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      let j = i + 2; while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blankInto(out, i, Math.min(j + 2, src.length)); i = j + 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) break;
        j++;
      }
      if (opts.strings) blankInto(out, i + 1, j);
      i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/** Removes comments AND string/template bodies. For identifier scans. */
export function stripCommentsAndStrings(src: string): string {
  return strip(src, { strings: true });
}

/** Removes comments ONLY, keeping string bodies. For literal-value scans. */
export function stripComments(src: string): string {
  return strip(src, { strings: false });
}
