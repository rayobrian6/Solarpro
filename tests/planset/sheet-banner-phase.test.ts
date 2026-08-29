// ═══════════════════════════════════════════════════════════════════════════
// THE PER-SHEET RELEASE BANNER (2026-08-28)
//
// Three defects, one of them a false statement on a construction drawing:
//
//   1. A RELEASED package still printed "NOT FOR PERMIT SUBMISSION" on PV-3 and
//      PV-4C. `show` was `notReady || structuralBlockers.length > 0`, and
//      `structuralBlockers` had no severity filter while STRUCTURAL_BLOCKER_CODES
//      contains PENDING-RACKING-ASSEMBLY-SELECTION — an advisory that by design
//      never gates `ready`. So an unpinned rail part number kept a signed, sealed
//      package marked not-for-submission forever.
//   2. The headline was two constants, so a package awaiting only a signature
//      read exactly like one missing ten facts, and a package whose only open
//      item was its project NAME was told it had a structural problem.
//   3. A row printed the registry EXPLANATION — 134 words of
//      "GOVERNING-CANDIDATE ENVELOPE … 21600 in-lb against a demand of 2433 in-lb
//      (M = w·L²/8 …)" — on an attachment detail, for an ADVISORY.
//
// The first is the one these tests exist for. It is the direction of error
// nobody catches, because a red banner never looks like a bug.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { structuralBanner } from '@/lib/permit/snapshot/structuralProjection';
import { structuralBannerHtml } from '@/lib/permit/utils/structuralBanner';
import {
  REQUIREMENT_DECLARATIONS, SHEET_LINE_MAX_CHARS,
} from '@/lib/permit/snapshot/releaseGates';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** A snapshot stub carrying exactly the registry rows a case needs. */
const snapWith = (
  rows: Array<{ code: string; severity: 'blocking' | 'warning'; sheets?: string[] }>,
  ready: boolean,
) => ({
  derived: { moduleCount: 31 },
  permitReadiness: {
    ready,
    blockers: rows.filter(r => r.severity === 'blocking').map(r => ({ code: r.code, message: 'x' })),
    registry: rows.map(r => ({
      code: r.code, severity: r.severity, resolved: false,
      explanation: `LONG EXPLANATION for ${r.code} — `.repeat(12),
      affectedSheets: r.sheets ?? ['PV-3', 'PV-4C'],
    })),
  },
  meta: { snapshotId: 'S', digest: 'd'.repeat(64) },
}) as unknown as PermitDesignSnapshot;

describe('an ADVISORY may decorate a banner — it may not summon one', () => {
  it('a RELEASED package with only an advisory shows NO banner', () => {
    const b = structuralBanner(snapWith(
      [{ code: 'PENDING-RACKING-ASSEMBLY-SELECTION', severity: 'warning' }], true));
    expect(b.show, 'a signed, sealed package must not say NOT FOR PERMIT SUBMISSION').toBe(false);
  });

  it('…and the rendered HTML is empty, not merely quieter', () => {
    const html = structuralBannerHtml(snapWith(
      [{ code: 'PENDING-RACKING-ASSEMBLY-SELECTION', severity: 'warning' }], true));
    expect(html).toBe('');
  });

  it('a BLOCKING structural requirement still shows it (the gate is not disabled)', () => {
    const b = structuralBanner(snapWith(
      [{ code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' }], false));
    expect(b.show).toBe(true);
  });

  it('a not-ready package shows it even with no structural requirement at all', () => {
    const b = structuralBanner(snapWith(
      [{ code: 'PROJECT-AUTHORITY-UNVERIFIED', severity: 'blocking', sheets: ['PV-0'] }], false));
    expect(b.show).toBe(true);
  });

  it('the advisory still RIDES a banner the package has earned', () => {
    const b = structuralBanner(snapWith([
      { code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' },
      { code: 'PENDING-RACKING-ASSEMBLY-SELECTION', severity: 'warning' },
    ], false));
    expect(b.show).toBe(true);
    expect(b.blockers.map(x => x.code)).toContain('PENDING-RACKING-ASSEMBLY-SELECTION');
    // …carrying its severity, which used to be dropped on the way here
    expect(b.blockers.find(x => x.code === 'PENDING-RACKING-ASSEMBLY-SELECTION')!.severity)
      .toBe('warning');
  });
});

describe('the headline is DERIVED, never a constant', () => {
  it('the retired constants appear nowhere in a rendered banner', () => {
    const html = structuralBannerHtml(snapWith(
      [{ code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' }], false));
    expect(html).not.toContain('PENDING STRUCTURAL ENGINEERING REVIEW');
  });

  it('a package awaiting only a SIGNATURE is a workflow state, not a defect', () => {
    // FRAMING-AUTHORITY-UNVERIFIED is residualMode PROFESSIONAL_APPROVAL, so it
    // is the professional lane — the exact case the phase model was written for.
    const b = structuralBanner(snapWith(
      [{ code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' }], false));
    expect(b.kind).toBe('workflow');
    // Either awaiting phase is a workflow state; which one depends on whether a
    // review record covers the digest, which this stub does not model. The
    // property under test is the KIND - a signature is not a defect.
    expect(['AWAITING_PROFESSIONAL_REVIEW', 'AWAITING_SEAL_AND_ISSUE']).toContain(b.phaseId);
    expect(b.line1).toMatch(/AWAITING/);
    const html = structuralBannerHtml(b);
    expect(html).toContain('data-release-phase-kind="workflow"');
    // and it is NOT painted in the defect red
    expect(html).not.toContain('#b91c1c');
  });

  it('a package missing DATA is a defect, and looks like one', () => {
    const b = structuralBanner(snapWith([
      { code: 'PROJECT-AUTHORITY-UNVERIFIED', severity: 'blocking', sheets: ['PV-0'] },
      { code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' },
    ], false));
    expect(b.kind).toBe('defect');
    expect(structuralBannerHtml(b)).toContain('#b91c1c');
  });

  it('the two states are visually DISTINCT — that is the whole point', () => {
    const workflow = structuralBannerHtml(snapWith(
      [{ code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' }], false));
    const defect = structuralBannerHtml(snapWith([
      { code: 'PROJECT-AUTHORITY-UNVERIFIED', severity: 'blocking', sheets: ['PV-0'] },
      { code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' },
    ], false));
    const border = (h: string) => h.match(/border:2px solid (#[0-9a-f]{6})/)![1];
    expect(border(workflow)).not.toBe(border(defect));
  });

  it('fails CLOSED — no snapshot means it reads as a defect, not as reassurance', () => {
    const b = structuralBanner(null);
    expect(b.kind).toBe('defect');
    expect(b.line2).toMatch(/NOT FOR PERMIT SUBMISSION/);
  });
});

describe('a drawing carries ONE line per requirement', () => {
  it('every declaration that can reach a banner sheet has a short sheetLine', () => {
    const BANNER_SHEETS = new Set(['PV-1', 'PV-1B', 'PV-3', 'PV-4C']);
    const offenders: string[] = [];
    for (const [code, d] of Object.entries(REQUIREMENT_DECLARATIONS)) {
      if (!d.sheetLine) continue;
      if (d.sheetLine.length > SHEET_LINE_MAX_CHARS) {
        offenders.push(`${code} (${d.sheetLine.length} chars)`);
      }
    }
    expect(offenders, 'a drawing line must stay a callout, not become a paragraph').toEqual([]);
    // and the guard is non-vacuous
    expect(Object.values(REQUIREMENT_DECLARATIONS).filter(d => d.sheetLine).length)
      .toBeGreaterThan(20);
    expect(BANNER_SHEETS.size).toBeGreaterThan(0);
  });

  it('the row prints the sheetLine, NOT the explanation', () => {
    const html = structuralBannerHtml(snapWith(
      [{ code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' }], false));
    expect(html).toContain('STRUCTURAL RELEASE PENDING');
    expect(html).toContain('Licensed review of existing framing capacity required');
    expect(html).not.toContain('LONG EXPLANATION');
  });

  it('an UNDECLARED code names itself and points at the record — never the paragraph', () => {
    const html = structuralBannerHtml(snapWith(
      [{ code: 'SOME-BRAND-NEW-STRUCTURAL-CODE', severity: 'blocking' }], false));
    expect(html).not.toContain('LONG EXPLANATION');
    expect(html).toMatch(/SOME-BRAND-NEW-STRUCTURAL-CODE|Nothing on this sheet is gated/);
  });

  it('an advisory row is LABELLED, so it cannot read as a release blocker', () => {
    const html = structuralBannerHtml(snapWith([
      { code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' },
      { code: 'PENDING-RACKING-ASSEMBLY-SELECTION', severity: 'warning' },
    ], false));
    expect(html).toContain('data-banner-advisory="1"');
    expect(html).toContain('ADVISORY');
  });
});

describe('the real package', () => {
  const build = () => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    const html = generatePermitHTML(input as never);
    return { html, snap: (input as { _snapshot?: PermitDesignSnapshot })._snapshot! };
  };

  it('NO drawing sheet prints a formula, a candidate shortlist or an in-lb figure', () => {
    const { html } = build();
    const pages = html.replace(/<!--[\s\S]*?-->/g, '').split(/(?=<div class="page)/);
    for (const page of pages) {
      const id = page.match(/tb-sheet-id">\s*([A-Z0-9.\-]+)\s*</)?.[1] ?? '';
      if (!/^(PV|E|SCHED)/.test(id)) continue;      // drawing sheets only
      const text = page.replace(/<[^>]+>/g, ' ');
      expect(text, `${id} prints a formula`).not.toMatch(/M = w/);
      expect(text, `${id} prints an in-lb derivation`).not.toMatch(/\d+\s*in-lb/);
      expect(text, `${id} prints a distributor shortlist`).not.toMatch(/Span-screened listed candidates/);
    }
  });

  it('the detail is NOT lost — the review record still carries it in full', () => {
    const { html, snap } = build();
    const rail = snap.permitReadiness.registry.find(r => r.code === 'PENDING-RACKING-ASSEMBLY-SELECTION');
    expect(rail, 'the fixture must still carry the advisory').toBeTruthy();
    // the full explanation survives on the snapshot …
    expect(rail!.explanation).toMatch(/M = w/);
    // … and is printed somewhere in the package (the review record)
    expect(html.replace(/<!--[\s\S]*?-->/g, '')).toMatch(/M = w/);
  });

  it('PV-3 reads as the owner asked: condition — action, one line each', () => {
    const { html } = build();
    const page = html.split(/(?=<div class="page)/)
      .find(p => /tb-sheet-id">\s*PV-3\s*</.test(p))!;
    const rows = [...page.matchAll(/data-banner-requirement="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)]
      .map(m => ({ code: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() }));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.text.length, `${r.code} is too long for a drawing: ${r.text}`)
        .toBeLessThanOrEqual(SHEET_LINE_MAX_CHARS + 12);   // + the ADVISORY prefix
      expect(r.text, `${r.code} has no action`).toMatch(/—|-/);
    }
  });
});
