// ---------------------------------------------------------------------------
// D5 - the cover banner cut mid-predicate.
//
//     DESIGN INCOMPLETE - 2 design requirements outstanding: project legal
//     authority and wind / exposure / risk / snow criteria not.
//
// "criteria not" is a sentence stopped inside its own verb. The cap sliced 46
// characters out of a full clause and trimmed to a word boundary, which lands
// wherever it lands - 30 of the declaration titles exceed the cap, so this was
// never a one-off. A previous pass removed the ellipsis, which fixed the
// punctuation and left the truncation.
//
// The titles are all <noun phrase> <predicate>, so cutting at the PREDICATE
// yields the noun phrase the sentence actually wants.
//
// NOTE: every pattern here is built with new RegExp from a plain string. A
// shell heredoc eats one backslash level, and that has already turned an
// intended whitespace class into the LETTER s twice in this campaign.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WS = String.raw`\s`;
const load = (p: string): string | null => {
  try { return readFileSync(join(process.cwd(), p), 'utf8'); } catch { return null; }
};
function sheetText(html: string): string {
  return html
    .replace(new RegExp('<(style|script)[^>]*>[' + WS + WS.toUpperCase() + ']*?<' + String.raw`\/` + '\\1>', 'gi'), ' ')
    .replace(new RegExp('<[^>]+>', 'g'), ' ')
    .replace(new RegExp('&#39;', 'g'), "'")
    .replace(new RegExp('&[a-z]+;', 'g'), ' ')
    .replace(new RegExp(WS + '+', 'g'), ' ');
}

describe('the cover banner reads as English', () => {
  const html = load('_tmp_prod.html');

  it('does not end a clause on a dangling function word', () => {
    if (!html) return;
    const t = sheetText(html);
    // 2026-09-18 -- the label is now 'ISSUED FOR ENGINEERING REVIEW'. It used to
    // be 'DESIGN INCOMPLETE', printed twice because the statement repeated it.
    const banner = t.match(new RegExp('outstanding:[^.]*[.]'));
    expect(banner, 'the outstanding-requirements statement is missing').toBeTruthy();
    const s = banner![0];
    // the exact defect
    expect(s).not.toMatch(new RegExp('criteria not[.]'));
    // and its general form: no clause ending on a bare function word
    const DANGLE = new RegExp(WS + '(not|is|are|the|a|an|and|or|of|to|by|for|from|with|on|in|at)[.]', 'i');
    expect(s, `banner ends on a dangling word: ${s}`).not.toMatch(DANGLE);
  });

  it('still names every outstanding requirement', () => {
    if (!html) return;
    const t = sheetText(html);
    // it must stay informative, not merely grammatical
    expect(t).toMatch(new RegExp('design requirements outstanding: .+ and .+[.]'));
    expect(t).toMatch(new RegExp('project legal authority', 'i'));
    expect(t).toMatch(new RegExp('snow criteria', 'i'));
  });

  it('carries no ellipsis immediately before the full stop', () => {
    if (!html) return;
    expect(sheetText(html)).not.toMatch(new RegExp('[.]{4}'));
  });
});

describe('the label generator is driven by the predicate, not a character count', () => {
  const src = readFileSync(join(process.cwd(), 'lib/permit/snapshot/releasePhase.ts'), 'utf8');

  it('cuts at a predicate boundary, trims dangling words, and honours an explicit label', () => {
    expect(src).toContain('PREDICATE_BOUNDARY');
    expect(src).toContain('DANGLING');
    expect(src).toContain('shortTitle');
  });

  it('the boundary pattern is a whitespace class, not the literal letter s', () => {
    // The failure mode this campaign hit twice: the emitted source, not the intent.
    const i = src.indexOf('PREDICATE_BOUNDARY');
    expect(src.slice(i, i + 120)).toContain(String.raw`\\s+(?:`);
    expect(src.indexOf(String.fromCharCode(8))).toBe(-1);   // no stray backspace byte
  });
});
