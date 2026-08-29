// ═══════════════════════════════════════════════════════════════════════════
// THE STRUCTURAL CONCLUSION AUTHORITY (2026-08-29)
//
// PE-1 printed, five rows apart, in one table:
//
//     RESULT           ENGINEERING REVIEW REQUIRED — NO FRAMING PASS/FAIL
//                      CONCLUSION ISSUED (no utilization asserted)
//     GOVERNING CHECK  bending — 60% (PASS)
//
// The 60% was `structural.rafter.utilizationRatio`, computed from DEFAULTED
// span, species and spacing — the thing the review record calls "NOT engineering
// authority" — printed with a PASS on the sheet an engineer of record seals, and
// filed inside the "Lag Bolt Attachment Capacity Analysis" block so it read as
// the attachment verdict.
//
// It survived because `certPages.ts` and `structuralPages.ts` each derived the
// gates and ratios independently. PV-4C gated the Governing Check on the FRAMING
// review state and printed "REVIEW REQ."; PE-1 gated the identical cell on the
// CAPACITY gate, which was closed, so the framing ratio leaked through. Same
// concept, two implementations, two answers, one package.
//
// §13 of structural-closeout-co-c is the test that should have caught it. Its
// only negative assertion was `not.toContain('confirms the existing framing has
// adequate capacity')` — a sentence, not a number — so a bare "60% (PASS)"
// sailed through. These assertions are about TOKENS: a percentage or a PASS
// must not exist on a framing conclusion that was never computed.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  projectStructuralFromInput, projectStructuralConclusion,
  type StructuralProjection,
} from '@/lib/permit/snapshot/structuralProjection';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const input: any = clone(braidonOriginalAuditFixture);
// The DESIGN-REVIEW profile: the one the application actually generates, and the
// one the audited PDF came from. The full profile renders the PE letter through a
// different, shorter sheet variant, so auditing per-sheet there tests the wrong
// artifact.
input.plansetProfile = 'design-review';
const HTML: string = generatePermitHTML(input) as unknown as string;
const PROJ = projectStructuralFromInput(input);

const TEXT = HTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('a conclusion belongs to the check that produced it', () => {
  it('the fixture framing is genuinely unverified', () => {
    expect(projectStructuralConclusion(PROJ, null).framingReviewRequired).toBe(true);
  });

  it('an unverified framing carries NO conclusion object at all', () => {
    // The renderer cannot print what it was never handed. This is the structural
    // reason the defect cannot recur, as opposed to a renderer remembering to
    // check a flag.
    const c = projectStructuralConclusion(PROJ, {
      bendingMoment: 700, allowableBendingMoment: 1000,
      deflection: 0.2, allowableDeflection: 0.5, utilizationRatio: 0.6,
    });
    expect(c.framingReviewRequired).toBe(true);
    expect(c.framing, 'a 60% ratio must not survive an unverified framing').toBeNull();
    expect(c.framingGoverningCheckLabel).toMatch(/REVIEW REQUIRED/);
    expect(c.framingGoverningCheckLabel).not.toMatch(/\d+%/);
    expect(c.framingGoverningCheckLabel).not.toMatch(/PASS/);
  });

  it('an ABSENT calculation is not a passing one', () => {
    // `_bendPass = _bendRatio == null || _bendRatio <= 1.0` made a missing
    // computation read as a pass, so with both ratios null the sheet could
    // assert "bending — (PASS)" having computed nothing.
    const verified = {
      ...PROJ,
      engine: { ...(PROJ.engine ?? {}), engineeringReviewRequired: false },
    } as unknown as StructuralProjection;
    const c = projectStructuralConclusion(verified, {
      bendingMoment: null, allowableBendingMoment: null,
      deflection: null, allowableDeflection: null, utilizationRatio: null,
    });
    expect(c.framing).toBeNull();
    expect(c.framingGoverningCheckLabel).not.toMatch(/PASS/);
  });

  it('a verified framing DOES state its conclusion — the gate is not a blanket refusal', () => {
    const verified = {
      ...PROJ,
      engine: { ...(PROJ.engine ?? {}), engineeringReviewRequired: false },
    } as unknown as StructuralProjection;
    const c = projectStructuralConclusion(verified, {
      bendingMoment: 700, allowableBendingMoment: 1000,
      deflection: 0.2, allowableDeflection: 0.5, utilizationRatio: 0.6,
    });
    expect(c.framing).not.toBeNull();
    expect(c.framing!.utilizationPct).toBeCloseTo(60, 5);
    expect(c.framing!.passes).toBe(true);
    expect(c.framingGoverningCheckLabel).toMatch(/bending — 60% \(PASS\)/);
  });

  it('the ATTACHMENT check never borrows a framing ratio or a framing gate', () => {
    // The old cell printed the framing ratio inside the attachment block, and its
    // PASS was `_bendPass && _deflPass && _lagPass` — so a framing failure could
    // condemn a sound attachment, and a framing pass could flatter a weak one.
    const c = projectStructuralConclusion(PROJ, {
      bendingMoment: 5000, allowableBendingMoment: 1000,   // framing FAILS at 500%
      deflection: 5, allowableDeflection: 0.5, utilizationRatio: 5.0,
    });
    expect(c.attachmentGoverningCheckLabel).not.toMatch(/bending|deflection/);
    if (c.attachment?.safetyFactor != null) {
      // the attachment verdict follows the attachment's own numbers
      expect(c.attachment.passes).toBe(c.attachment.safetyFactor >= c.attachment.threshold);
      expect(c.attachmentGoverningCheckLabel).toMatch(/withdrawal/);
    }
  });
});

describe('the rendered package - no framing conclusion escapes onto any sheet', () => {
  it('nowhere in the package does a framing limit state carry a percentage', () => {
    // The exact leak: `bending - 60% (PASS)`. Asserted over the WHOLE package
    // rather than one sheet, because the defect was a renderer nobody thought to
    // look at printing a number a different renderer correctly withheld.
    expect(TEXT).not.toMatch(/(bending|deflection)\s*[\u2014-]\s*\d+\s*%/i);
  });

  it('and no framing check carries a bare PASS', () => {
    expect(TEXT).not.toMatch(/(bending|deflection)[^.]{0,40}\(PASS\)/i);
  });

  it('the framing state is still stated honestly', () => {
    expect(TEXT).toMatch(/NO FRAMING PASS\/FAIL CONCLUSION ISSUED/i);
    expect(TEXT).toMatch(/REVIEW REQ/i);
  });

  it('the attachment check still reports its OWN result', () => {
    // The repair must not silence a conclusion that IS established: the
    // withdrawal check has a verified capacity and may state its verdict.
    expect(TEXT).toMatch(/Governing Check\s+(withdrawal|CAPACITY SOURCE UNVERIFIED)/i);
    expect(TEXT).toMatch(/withdrawal \u2014 SF [\d.]+ \u2265 [\d.]+ \(PASS\)/);
  });
});
