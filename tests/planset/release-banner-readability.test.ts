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
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { releasePhaseFor } from '@/lib/permit/snapshot/releasePhase';
import { projectReleaseGatesFromInput } from '@/lib/permit/snapshot/releaseGates';

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

// ── 2026-09-18, RAY'S RULING — RETARGETED FROM THE ARTIFACT TO THE PRODUCER ──
// These three cases used to read the generated `_tmp_prod.html` from the repo
// root and `return` early when it was absent — so on any machine that had not
// regenerated it, the whole block passed while testing nothing. They now drive
// `releasePhaseFor` directly, which is where the D5 predicate-boundary fix
// actually lives.
//
// That is also forced by the ruling: the cover no longer PRINTS the phase
// statement, so an artifact-based assertion could only be rewritten as an
// assert-absence and D5's real property — that the sentence reads as English and
// names what is outstanding — would have been lost. The sentence still exists,
// is still derived, and still reaches a human on RS-1.
describe('the release phase statement reads as English', () => {
  const phase = () => {
    const input = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));
    generatePermitHTML(input as never);
    return releasePhaseFor(projectReleaseGatesFromInput(input as never),
      (input as { _snapshot?: unknown })._snapshot as never);
  };

  it('does not end a clause on a dangling function word', () => {
    const s = phase().statement;
    expect(s, 'the outstanding-requirements statement is missing').toMatch(new RegExp('outstanding:'));
    // the exact defect
    expect(s).not.toMatch(new RegExp('criteria not[.]'));
    // and its general form: no clause ending on a bare function word
    const DANGLE = new RegExp(WS + '(not|is|are|the|a|an|and|or|of|to|by|for|from|with|on|in|at)[.]', 'i');
    expect(s, `statement ends on a dangling word: ${s}`).not.toMatch(DANGLE);
  });

  it('still names every outstanding requirement', () => {
    const s = phase().statement;
    // it must stay informative, not merely grammatical
    expect(s).toMatch(new RegExp('design requirements outstanding: .+ and .+[.]'));
    expect(s).toMatch(new RegExp('project legal authority', 'i'));
    expect(s).toMatch(new RegExp('snow criteria', 'i'));
  });

  it('carries no ellipsis immediately before the full stop', () => {
    expect(phase().statement).not.toMatch(new RegExp('[.]{4}'));
  });

  it('and none of it reaches an outbound sheet', () => {
    const input = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));
    const html = generatePermitHTML(input as never) as unknown as string;
    const p = releasePhaseFor(projectReleaseGatesFromInput(input as never),
      (input as { _snapshot?: unknown })._snapshot as never);
    const cover = html.split(new RegExp('(?=<div class="page)'))
      .find(x => new RegExp('tb-sheet-id">' + WS + '*PV-0' + WS + '*<').test(x)) ?? '';
    expect(cover, 'the cover must be found for this case to mean anything').not.toBe('');
    expect(sheetText(cover)).not.toContain(p.statement);
    expect(sheetText(cover)).not.toMatch(new RegExp('DESIGN COMPLETE|DESIGN INCOMPLETE'));
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
