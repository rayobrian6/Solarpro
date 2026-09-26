// ═══════════════════════════════════════════════════════════════════════════
// THE FENCE AND GROUND SHEETS ASSERTED "CONFIRMED ADEQUATE" WITH NO GATE
//
// `projectStructuralConclusion` — the authority that decides whether an adequacy
// conclusion may be stated at all — was imported by structuralPages.ts and read ONLY
// inside `pageStructuralRoof`. `pageStructuralFence` and `pageStructuralGround` never
// referenced it, and printed:
//
//     "Post foundation system confirmed adequate for the imposed wind and dead loads"
//     "Ground mount pile/pier capacity confirmed adequate for the imposed wind uplift"
//
// unconditionally. Meanwhile each page's own PAGE CONCLUSION, four lines below, was
// gated on the safety factor — so on a package whose safety factor never computed the
// SAME SHEET said "confirmed adequate" AND "Structural analysis data incomplete —
// verify all parameters". A plan reviewer reads the affirmative sentence.
//
// 🚨 THE RULE WAS ALREADY WRITTEN DOWN IN THIS REPO.
// docs/POST-CAMPAIGN-CORRECTION-2026-07-22.md forbids "confirmed adequate" without an
// approved review, and docs/REPAIR-PASS-ROOT-CAUSE-MAP.md records a DELIVERED PE-1
// printing "…confirmed adequate (safety factor 1.63)" ungated as the defect that
// `certificationApproved` exists to fix. Fence and ground were never brought along.
//
// These drive the real page functions, because the defect was a template branch.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { pageStructuralFence, pageStructuralGround } from '@/lib/permit/sections/structuralPages';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Render one sheet with a chosen attachment safety factor. */
function sheet(kind: 'fence' | 'ground', safetyFactor: number | null | undefined): string {
  const input: any = clone(braidonOriginalAuditFixture);
  input.project.systemType = kind;
  input.compliance = input.compliance ?? {};
  input.compliance.structural = input.compliance.structural ?? {};
  input.compliance.structural.attachment = { ...(input.compliance.structural.attachment ?? {}) };
  if (safetyFactor === undefined) delete input.compliance.structural.attachment.safetyFactor;
  else input.compliance.structural.attachment.safetyFactor = safetyFactor;

  const cad: any = { totalPanels: input.project?.totalPanels ?? 12, roof: { planes: [] } };
  const html = (kind === 'fence' ? pageStructuralFence : pageStructuralGround)(input, cad, 1, 1);
  return String(html).replace(/<[^>]+>/g, ' ').replace(/&sect;/g, '§').replace(/\s+/g, ' ');
}

const ADEQUATE = /confirmed adequate/i;
const INCOMPLETE = /analysis data incomplete/i;

describe.each(['fence', 'ground'] as const)('%s structural sheet — the adequacy gate', (kind) => {
  it('🚨 never says "confirmed adequate" and "analysis data incomplete" on ONE sheet', () => {
    // The defect, stated as the contradiction it is. This needs no argument about which
    // sentence is correct: a sealed sheet cannot assert both.
    for (const sf of [null, undefined, 0.9, 1.5, 2.4] as const) {
      const text = sheet(kind, sf);
      const both = ADEQUATE.test(text) && INCOMPLETE.test(text);
      expect(both, `safetyFactor=${String(sf)}: the sheet asserts adequacy AND incompleteness at once`)
        .toBe(false);
    }
  });

  it('🚨 refuses to assert adequacy when no safety factor was computed', () => {
    for (const sf of [null, undefined] as const) {
      const text = sheet(kind, sf);
      expect(ADEQUATE.test(text),
        `safetyFactor=${String(sf)}: an affirmative foundation conclusion with nothing behind it`)
        .toBe(false);
      // And it says WHY, rather than going quiet.
      expect(text).toMatch(/NOT asserted|not verified|Engineering review required|incomplete/i);
    }
  });

  it('refuses when the computed safety factor is BELOW the minimum, and names the number', () => {
    const text = sheet(kind, 0.9);
    expect(ADEQUATE.test(text)).toBe(false);
    expect(text, 'the reviewer cannot act on a refusal that hides the number it refused on')
      .toMatch(/0\.90/);
    expect(text).toMatch(/BELOW/);
  });

  it('DOES assert adequacy when the safety factor clears the bar — the gate is not a blanket refusal', () => {
    // A gate that never opens is as useless as one that never closes, and would pass
    // every case above vacuously.
    const text = sheet(kind, 2.4);
    expect(ADEQUATE.test(text), 'a design that clears the bar must still get its conclusion')
      .toBe(true);
    expect(INCOMPLETE.test(text)).toBe(false);
  });

  it('the narrative and the page conclusion move together', () => {
    // They were independently gated, which is how they came to disagree.
    const passing = sheet(kind, 2.4);
    const failing = sheet(kind, null);
    expect(passing).toMatch(/adequate to support the proposed|is adequate/i);
    expect(failing).not.toMatch(/adequate to support the proposed PV array without modification/i);
  });
});

describe('the fence sheet does not claim unverified embedment resistance', () => {
  it('🚨 stops asserting the embedment "provides the required resistance" when nothing verified it', () => {
    const failing = sheet('fence', null);
    expect(failing).not.toMatch(/provides the required resistance/i);
    expect(failing).toMatch(/NOT verified/i);
    // …and still says what the embedment IS, so the sheet loses no fact.
    expect(failing).toMatch(/embedment/i);
  });

  it('and still asserts it when the design passes', () => {
    expect(sheet('fence', 2.4)).toMatch(/provides the required resistance/i);
  });
});
