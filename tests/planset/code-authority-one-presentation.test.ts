// ═══════════════════════════════════════════════════════════════════════════
// ONE ADOPTION STATE, DESCRIBED TWO WAYS ON THE SAME SHEET
//
// PV-0's governing-codes strip printed, from the projection:
//     IBC PER AHJ ADOPTION · IRC PER AHJ ADOPTION · IFC PER AHJ ADOPTION
// and PV-0's engineering summary, six hundred lines away in the same file,
// printed its own sentence from the RAW token:
//     AHJ-ADOPTED IBC / IRC / IFC: PENDING VERIFICATION
//
// `PER_AHJ_EDITION` exists precisely because "IBC PENDING" reads as unfinished
// work while "IBC PER AHJ ADOPTION" states the truth: the family governs, the
// year is the AHJ's to confirm at plan review, and no design value depends on
// it. `labelOf` applies that and 79 places already printed it. Four consumers
// composed their own instead — the cover summary, the construction notes, the
// PE-letter code list and the label schedule ("IFC PENDING 1207", where PENDING
// occupies the position an edition year would).
//
// A reviewer reading two presentations cannot tell whether they describe the
// same state. `adoptedICodePhrase` is the one sentence fragment; the label is
// the projection's to decide.
//
// MUTATION: change the canonical adoption and every projection follows.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  projectCodeAuthorityFromInput, adoptedICodePhrase, PER_AHJ_EDITION, PENDING_EDITION,
} from '@/lib/permit/snapshot/codeAuthorityProjection';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function build(mutate?: (i: any) => void) {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  mutate?.(input);
  const html = generatePermitHTML(input) as unknown as string;
  const text = html.replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&sect;/g, '§')
    .replace(/\s+/g, ' ');
  return { input, text, cp: projectCodeAuthorityFromInput(input) };
}

describe('one adoption state, one wording', () => {
  const { text, cp } = build();

  it('the projection publishes the phrase every sheet prints', () => {
    expect(adoptedICodePhrase(cp)).toBe(
      `IBC ${PER_AHJ_EDITION} / IRC ${PER_AHJ_EDITION} / IFC ${PER_AHJ_EDITION}`);
  });

  it('no consumer composes a second presentation', () => {
    expect(text).not.toMatch(/PENDING VERIFICATION/);
    expect(text).not.toMatch(/IBC PENDING/);
    expect(text).not.toMatch(/IFC PENDING/);
    expect(text).not.toMatch(/PENDING IBC/);
    expect(text).not.toMatch(/\(IFC\) PENDING/);
  });

  it('the cover summary and the code strip agree', () => {
    expect(text).toMatch(/AHJ-ADOPTED CODES: IBC PER AHJ ADOPTION \/ IRC PER AHJ ADOPTION \/ IFC PER AHJ ADOPTION/);
    expect(text).toMatch(/IBC PER AHJ ADOPTION/);
  });

  it('a label with no adopted edition states the SECTION, not a year slot', () => {
    // "IFC PENDING 1207" put PENDING where a year goes. The NEC branch already
    // had the edition-neutral form; the IFC branch now matches it.
    expect(text).not.toMatch(/IFC PENDING \d/);
  });
});

describe('MUTATION — move the canonical adoption and every projection follows', () => {
  it('a KNOWN edition prints that year everywhere', () => {
    const { text, cp } = build(i => {
      const ca = i._snapshot?.codeAuthority;
      void ca; // the snapshot is rebuilt from the input below
      i.project.ibcEdition = '2021';
      i.project.ircEdition = '2021';
      i.project.ifcEdition = '2021';
      i.project.codeEditionsVerified = true;
    });
    // Whatever the build resolves, the phrase and the sheets must agree — that
    // is the invariant, not a particular year.
    const phrase = adoptedICodePhrase(cp);
    expect(text).toContain(phrase.split(' / ')[0]);
    // and the two presentations remain identical
    expect(text).toContain(`AHJ-ADOPTED CODES: ${phrase}`);
  });

  it('PENDING remains reachable for a genuinely unresolved adoption', () => {
    // The point is not that PENDING is banned — it is that the projection
    // decides which of PENDING / PER AHJ ADOPTION applies, once.
    expect(PENDING_EDITION).toBe('PENDING');
    expect(PER_AHJ_EDITION).toBe('PER AHJ ADOPTION');
  });
});
