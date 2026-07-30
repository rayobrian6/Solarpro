// ═══════════════════════════════════════════════════════════════════════════
// TAC WS-13 — the GEC field label, and the label count that did not add up.
//
//  (a) PV-5 printed "GROUNDING ELECTRODE CONDUCTOR — DO NOT DISCONNECT" from an
//      unconditional `() => true` predicate, while PV-4B on the same package
//      stated that the interconnection bonds to the EXISTING service grounding
//      electrode system and adds no separate GEC or new electrode. The label
//      asserted a conductor that does not exist and cited 690.47 (grounding
//      electrode systems) as its authority. The canonical truth was already in
//      the snapshot: groundingObjects `gnd-gec` { purpose:'gec', required:false,
//      method:'none-required' } — the same record PV-4B reads.
//
//      The 250.119 identification requirement itself still applies (equipment
//      grounding conductors and array bonding points exist on every system), so
//      the label stays — with honest wording and the applicable citation.
//
//  (b) The header read "1 SITE-COMPUTED + 10 STANDARD (12 OF 19 DATASET LABELS
//      APPLY)". Both halves were true and 1 + 10 ≠ 12: the labels SUPERSEDED by
//      the site-computed rating cards and the permanent power-source placard
//      were subtracted from the decal count and then silently uncounted.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { selectFieldLabels } from '@/lib/permit/utils/fieldLabels';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(profile = 'design-review', mutate?: (i: any) => void) {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = profile;
  if (mutate) mutate(input);
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot, input };
}

const textOf = (html: string): string => html
  .replace(/<[^>]*>/g, ' ')
  .replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

describe('WS-13(a) — the GEC label follows the canonical grounding object', () => {
  const PKG = gen();

  it('the snapshot says no GEC is added by this interconnection', () => {
    const gec = PKG.snap.electrical.groundingObjects.find(g => g.purpose === 'gec');
    expect(gec).toBeTruthy();
    expect(gec!.required).toBe(false);
    expect(gec!.method).toBe('none-required');
  });

  it('no sheet claims a grounding ELECTRODE conductor exists', () => {
    expect(PKG.html).not.toContain('GROUNDING ELECTRODE CONDUCTOR — DO NOT DISCONNECT');
  });

  it('the identification label still renders, worded for equipment grounding / bonding', () => {
    expect(PKG.html).toContain('EQUIPMENT GROUNDING &amp; BONDING — DO NOT DISCONNECT');
  });

  it('the citation drops 690.47 (grounding electrode systems) when no GEC exists', () => {
    const lbl = selectFieldLabels(PKG.input, (PKG.input as any)._cad ?? { systemType: 'roof', roof: { planes: [] } } as any)
      .find(l => l.refId === 'grounding-electrode-conductor-marking');
    expect(lbl).toBeTruthy();
    expect(lbl!.required).toBe(true);                 // 250.119 identification applies
    expect(lbl!.necRef).toContain('250.119');
    expect(lbl!.necRef).toContain('690.43');
    expect(lbl!.necRef).not.toContain('690.47');
  });

  it('a design that DOES add a GEC keeps the GEC wording and the 690.47 citation', () => {
    const { input, html } = gen('design-review');
    // Mutate the ATTACHED snapshot's canonical record, then re-select labels from
    // it — the label follows the grounding object, nothing else.
    const snap = clone(input._snapshot) as any;
    const gec = snap.electrical.groundingObjects.find((g: any) => g.purpose === 'gec');
    gec.required = true; gec.method = 'gec-to-new-electrode';
    input._snapshot = snap;
    const lbl = selectFieldLabels(input, { systemType: 'roof', roof: { planes: [] } } as any)
      .find(l => l.refId === 'grounding-electrode-conductor-marking')!;
    expect(lbl.lines.join(' ')).toContain('GROUNDING ELECTRODE CONDUCTOR');
    expect(lbl.necRef).toContain('690.47');
    // sanity: the un-mutated package really did print the other wording
    expect(html).toContain('EQUIPMENT GROUNDING &amp; BONDING — DO NOT DISCONNECT');
  });
});

describe('WS-13(b) — the label count reconciles', () => {
  const PKG = gen();
  const t = textOf(PKG.html);

  it('the old non-reconciling header form is gone', () => {
    expect(t).not.toMatch(/SITE-COMPUTED \+ \d+ STANDARD/);
  });

  it('the header states applicability and the delivery breakdown', () => {
    const m = /(\d+) OF (\d+) DATASET LABELS \((\d+) DECALS? · (\d+) CARDS? · (\d+) ON CARD\/PLACARD\)/.exec(t);
    expect(m, 'header count line not found').toBeTruthy();
    const [, applies, total, decals, , superseded] = (m as RegExpExecArray).map(Number);
    // THE arithmetic the old header failed: decals + superseded == applies
    expect(decals + superseded).toBe(applies);
    expect(applies).toBeLessThanOrEqual(total);
  });

  it('the schedule footnote closes the same arithmetic', () => {
    const m = /(\d+) \+ (\d+) YES\* = (\d+) of (\d+) apply, (\d+) N\/A/.exec(t);
    expect(m, 'accounting line not found').toBeTruthy();
    const [, decals, yesStar, applies, total, na] = (m as RegExpExecArray).map(Number);
    expect(decals + yesStar).toBe(applies);
    expect(applies + na).toBe(total);
  });

  it('header and footnote agree with the selector', () => {
    const labels = selectFieldLabels(PKG.input, { systemType: 'roof', roof: { planes: [] } } as any);
    const applies = labels.filter(l => l.required).length;
    expect(t).toContain(`${applies} OF ${labels.length} DATASET LABELS`);
    expect(t).toMatch(new RegExp(`= ${applies} of ${labels.length} apply, ${labels.length - applies} N/A`));
  });
});
