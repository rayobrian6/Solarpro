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
//
// ── 2026-09-18, RAY'S RULING — THE BANNER ITSELF IS RETIRED ─────────────────
//
//     "I tell you to get rid of that shit and you change the words entirely.
//      I said get rid of that bullshit. We know that this isn't ready for
//      permits. I need to send this to the guy who will stamp it."
//
// structuralBannerHtml() is now a no-op that returns '' for every input, and
// every call site on PV-1 / PV-1B / PV-3 / PV-4C / PV-4C.1 is gone. So the seven
// cases below that read the RENDERED banner were asserting against '', which is
// exactly the vacuity this repo keeps being burned by: `not.toContain(x)` passes
// trivially on an empty string, and `h.match(...)![1]` throws.
//
// They are RETARGETED, not softened. Each one now pins two things:
//   1. the RETIREMENT — the renderer returns '' for a defect phase, a workflow
//      phase, an undeclared code, an advisory and a real PV-3, so a re-wiring
//      cannot quietly bring the box back; and
//   2. the PROPERTY the banner used to carry, where it lives now — the phase and
//      its kind in the hidden data-release-phase-kind attribute (cover block +
//      PE-1 cert gate), the phase COLOUR in RELEASE_PHASE_STYLE (which the cert
//      sheet still reads), the one-line-per-requirement rule in the
//      structuralBanner / bannerRequirementsForSheet projection (untouched by the
//      ruling, still feeding the release model), and the human-readable account
//      + the ADVISORY labelling on RS-1 / RS-1.1, the internal review record the
//      engineer receives.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { structuralBanner, bannerRequirementsForSheet } from '@/lib/permit/snapshot/structuralProjection';
import { structuralBannerHtml } from '@/lib/permit/utils/structuralBanner';
import { releasePhaseFor, RELEASE_PHASE_STYLE } from '@/lib/permit/snapshot/releasePhase';
import {
  REQUIREMENT_DECLARATIONS, SHEET_LINE_MAX_CHARS, projectReleaseGatesFromInput,
} from '@/lib/permit/snapshot/releaseGates';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// ── 2026-09-18 — the real package, built ONCE, plus a strict sheet splitter ──
// NB the loose /(?=<div class="page)/ split used further down also cuts on
// `<div class="page-…">` children, which detaches a sheet's BODY from the title
// block that names it. That is harmless where a sheet id is only used to SKIP a
// fragment, but it is fatal when looking FOR content on a named sheet — the
// RS-1 fragment it returns holds the title block and none of the requirement
// rows. The strict form splits only on the page element itself.
const strictPages = (html: string): string[] => html.split(/(?=<div class="page"[ >])/);
const sheetIdOf = (page: string): string =>
  page.match(/tb-sheet-id">\s*([A-Z0-9.\-]+)\s*</)?.[1] ?? '';

let _pkg: { html: string; snap: PermitDesignSnapshot; input: Record<string, unknown> } | null = null;
const pkg = () => {
  if (!_pkg) {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    const html = generatePermitHTML(input as never) as unknown as string;
    _pkg = { html, snap: (input as { _snapshot?: PermitDesignSnapshot })._snapshot!, input };
  }
  return _pkg;
};

/** The RS-1 sheets — RS-1 paginates onto RS-1.n, so a requirement may sit on
 *  either; every caller takes the UNION and asserts it is non-empty first. */
const rsPages = (): string[] => strictPages(pkg().html).filter(p => /^RS-1/.test(sheetIdOf(p)));

/** One RS-1 requirement row, or null. indexOf is checked against -1 BEFORE it is
 *  used as a slice bound — a -1 would silently yield a tail slice, and an
 *  assertion against that tail is the classic false green. */
const rsRequirementRow = (rs: string, code: string): string | null => {
  const i = rs.indexOf(`data-release-requirement="${code}"`);
  if (i < 0) return null;
  const j = rs.indexOf('</tr>', i);
  return j < 0 ? null : rs.slice(i, j);
};

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
    // ── 2026-09-18, RAY'S RULING ────────────────────────────────────────────
    // These two used to read the rendered banner for
    // data-release-phase-kind="workflow" and for the absence of the defect red.
    // The renderer is retired, so both would now be measuring '' — and the
    // absence half would pass for ANY string. The retirement is pinned here; the
    // phase kind itself is asserted where it moved to (the hidden
    // data-release-phase-kind attribute) in 'where the banner's facts live now'.
    expect(structuralBannerHtml(b), 'the retired renderer must stay inert').toBe('');
    // …and "not painted in the defect red" is now a property of the phase
    // palette the CERT sheet still takes its colour from, not of a sheet box.
    expect(RELEASE_PHASE_STYLE[b.kind].border).not.toBe(RELEASE_PHASE_STYLE.defect.border);
  });

  it('a package missing DATA is a defect, and looks like one', () => {
    const b = structuralBanner(snapWith([
      { code: 'PROJECT-AUTHORITY-UNVERIFIED', severity: 'blocking', sheets: ['PV-0'] },
      { code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' },
    ], false));
    expect(b.kind).toBe('defect');
    // 2026-09-18, RAY'S RULING — was .toContain('#b91c1c') on the rendered
    // banner. No sheet paints a release box any more, so "looks like one" is
    // asserted on the phase palette (still read by certPages) plus the
    // retirement of the renderer itself.
    expect(structuralBannerHtml(b)).toBe('');
    expect(RELEASE_PHASE_STYLE[b.kind].fg).toBe('#b91c1c');
  });

  it('the two states are visually DISTINCT — that is the whole point', () => {
    // 2026-09-18, RAY'S RULING — this compared the BORDER COLOUR of two rendered
    // banners. Both renders are now '', so `h.match(...)![1]` throws outright.
    // The distinction is real and still exists one layer up: the projection
    // derives a different kind, a different phase label, and the palette those
    // kinds index gives different ink. Asserted there; the retirement of the box
    // is asserted alongside it so it cannot come back on a drawing.
    const workflow = structuralBanner(snapWith(
      [{ code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' }], false));
    const defect = structuralBanner(snapWith([
      { code: 'PROJECT-AUTHORITY-UNVERIFIED', severity: 'blocking', sheets: ['PV-0'] },
      { code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' },
    ], false));
    expect(workflow.kind).toBe('workflow');
    expect(defect.kind).toBe('defect');
    expect(workflow.line1).not.toBe(defect.line1);
    expect(RELEASE_PHASE_STYLE[workflow.kind].border).not.toBe(RELEASE_PHASE_STYLE[defect.kind].border);
    expect(structuralBannerHtml(workflow)).toBe('');
    expect(structuralBannerHtml(defect)).toBe('');
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
    // 2026-09-18, RAY'S RULING — this read the rendered ROW. There is no row on
    // any sheet now, so the sheetLine-not-the-paragraph rule is asserted on the
    // projection that produced it (bannerRequirementsForSheet is untouched by
    // the ruling and still feeds RS-1 and the release model). The paragraph's
    // home is RS-1 — pinned in 'where the banner's facts live now'.
    const b = structuralBanner(snapWith(
      [{ code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' }], false));
    const rows = bannerRequirementsForSheet(b, 'PV-3').own;
    expect(rows.length, 'no rows ⇒ the case would assert nothing').toBeGreaterThan(0);
    const r = rows.find(x => x.code === 'FRAMING-AUTHORITY-UNVERIFIED');
    expect(r, 'the requirement under test must be in the projection').toBeTruthy();
    expect(r!.sheetLine).toContain('STRUCTURAL RELEASE PENDING');
    expect(r!.sheetLine).toContain('Licensed review of existing framing capacity required');
    expect(r!.sheetLine!.length).toBeLessThanOrEqual(SHEET_LINE_MAX_CHARS);
    expect(r!.sheetLine).not.toContain('LONG EXPLANATION');
    // the paragraph is still CARRIED — as `message`, the field the line exists to
    // replace — so the non-fallback is proven against a paragraph that is there.
    expect(r!.message).toContain('LONG EXPLANATION');
    expect(structuralBannerHtml(b), 'and nothing of this reaches a drawing').toBe('');
  });

  it('an UNDECLARED code names itself and points at the record — never the paragraph', () => {
    // 2026-09-18, RAY'S RULING — the rendered fallback is gone with the box, so
    // the property moves to the projection: an undeclared code yields a NULL
    // sheetLine (it never borrows `message`) while still naming itself.
    const b = structuralBanner(snapWith(
      [{ code: 'SOME-BRAND-NEW-STRUCTURAL-CODE', severity: 'blocking' }], false));
    const rows = bannerRequirementsForSheet(b, 'PV-3').own;
    expect(rows.length, 'no rows ⇒ the case would assert nothing').toBeGreaterThan(0);
    const r = rows.find(x => x.code === 'SOME-BRAND-NEW-STRUCTURAL-CODE');
    expect(r, 'the undeclared code must survive the projection under its own name').toBeTruthy();
    expect(r!.sheetLine, 'an undeclared code has no drawing line — and never borrows the paragraph')
      .toBeNull();
    expect(r!.message).toContain('LONG EXPLANATION');
    expect(structuralBannerHtml(b)).toBe('');
  });

  it('an advisory row is LABELLED, so it cannot read as a release blocker', () => {
    // 2026-09-18, RAY'S RULING — was data-banner-advisory="1" + 'ADVISORY' in the
    // rendered sheet banner. The labelling moved with the account to RS-1 /
    // RS-1.1, the review record the engineer receives: the advisory row carries
    // data-finding-type="ADVISORY" and the advisory TREATMENT, and a blocking row
    // on the same record does not — which is the property, stated both ways.
    const rs = rsPages();
    expect(rs.length, 'no RS-1 sheet ⇒ nothing to read').toBeGreaterThan(0);
    const u = rs.join('');
    const adv = rsRequirementRow(u, 'PENDING-RACKING-ASSEMBLY-SELECTION');
    const blocking = rsRequirementRow(u, 'FRAMING-AUTHORITY-UNVERIFIED');
    expect(adv, 'the advisory must be on the review record at all').toBeTruthy();
    expect(blocking, 'and so must a blocking row, to contrast it against').toBeTruthy();
    expect(adv!).toContain('data-finding-type="ADVISORY"');
    expect(adv!).toContain('data-finding-treatment="advisory"');
    expect(adv!).toContain('ADVISORY');
    expect(blocking!).not.toContain('data-finding-treatment="advisory"');
    // and the severity the label is derived from still reaches the projection
    const b = structuralBanner(snapWith([
      { code: 'FRAMING-AUTHORITY-UNVERIFIED', severity: 'blocking' },
      { code: 'PENDING-RACKING-ASSEMBLY-SELECTION', severity: 'warning' },
    ], false));
    expect(b.blockers.find(x => x.code === 'PENDING-RACKING-ASSEMBLY-SELECTION')!.severity)
      .toBe('warning');
    expect(structuralBannerHtml(b)).toBe('');
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
    // ── 2026-09-18, RAY'S RULING ────────────────────────────────────────────
    // PV-3 carries NO requirement rows now — the box came off the drawing
    // entirely, so the old matchAll found nothing and its loop passed on an
    // empty list. Split in two: the REMOVAL is pinned as an explicit absence on
    // the real sheet (so it cannot silently return), and the condition — action
    // rule is asserted on the lines themselves, which still exist in the
    // projection and whose full account still reaches the engineer on RS-1.
    const { html, snap } = pkg();
    const page = strictPages(html).find(p => sheetIdOf(p) === 'PV-3');
    expect(page, 'PV-3 must be in the package for the absence to mean anything').toBeTruthy();
    expect(page!.length, 'an empty PV-3 fragment would make every absence vacuous')
      .toBeGreaterThan(1000);
    expect(page!, 'the requirement rows came off PV-3').not.toContain('data-banner-requirement=');
    expect(page!, 'and so did the submission-status line').not.toContain('NOT FOR PERMIT SUBMISSION');
    expect(page!, 'and the phase headline with it').not.toContain('STRUCTURAL RELEASE PENDING');
    // the lines themselves are unchanged and still one drawing line each …
    const rows = bannerRequirementsForSheet(structuralBanner(snap), 'PV-3').own;
    expect(rows.length, 'no PV-3 requirements ⇒ the loop below asserts nothing').toBeGreaterThan(0);
    const rs = rsPages();
    expect(rs.length, 'no RS-1 sheet ⇒ nothing to check the account against').toBeGreaterThan(0);
    const u = rs.join('');
    for (const r of rows) {
      expect(r.sheetLine, `${r.code} lost its one-line form`).toBeTruthy();
      expect(r.sheetLine!.length, `${r.code} is too long for a drawing: ${r.sheetLine}`)
        .toBeLessThanOrEqual(SHEET_LINE_MAX_CHARS);
      expect(r.sheetLine!, `${r.code} has no action`).toMatch(/—|-/);
      // … and the full account is on the review record, not lost with the box
      expect(u, `${r.code} is missing from RS-1 / RS-1.1`)
        .toContain(`data-release-requirement="${r.code}"`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2026-09-18, RAY'S RULING — WHERE THE BANNER'S FACTS LIVE NOW.
//
// Added with the retirement above: the cases that used to read those facts off a
// drawing now assert the retirement, so this block is what stops the retirement
// from being a LOSS. Each fact the box carried is pinned at its new address.
// ═══════════════════════════════════════════════════════════════════════════
describe("where the banner's facts live now", () => {
  it('the phase and its kind survive as hidden, machine-readable attributes', () => {
    const { html, input } = pkg();
    const expected = releasePhaseFor(
      projectReleaseGatesFromInput(input as never),
      pkg().snap as never);
    // the PE-1 / CERT gate marker …
    const gate = /data-cert-gate="1"[^>]*data-release-phase="([A-Z_]+)"[^>]*data-release-phase-kind="([a-z]+)"/
      .exec(html);
    expect(gate, 'no certification state marker ⇒ the captures below would be undefined').toBeTruthy();
    expect(gate![1]).toBe(expected.id);
    expect(gate![2]).toBe(expected.kind);
    // … and the cover's hidden provenance block, which must not disagree with it
    const cover = /data-release-status-block="1"[\s\S]{0,400}?data-release-phase="([A-Z_]+)"[\s\S]{0,200}?data-release-phase-kind="([a-z]+)"/
      .exec(html);
    expect(cover, 'no cover release-status block ⇒ nothing to compare').toBeTruthy();
    expect(cover![1]).toBe(expected.id);
    expect(cover![2]).toBe(expected.kind);
    // both are invisible: the ruling is that this reaches a machine, not a reader
    expect(html).toContain('data-cert-gate="1"');
    expect(/data-cert-gate="1"[^>]*style="display:none;"/.test(html)).toBe(true);
  });

  it('RS-1 still carries the whole account — every open requirement, in full', () => {
    const { snap } = pkg();
    const open = (snap.permitReadiness.registry ?? []).filter(r => !r.resolved);
    expect(open.length, 'no open requirements ⇒ this case proves nothing').toBeGreaterThan(0);
    const rs = rsPages();
    expect(rs.length, 'no RS-1 sheet ⇒ the account has nowhere to live').toBeGreaterThan(0);
    const u = rs.join('');
    for (const r of open) {
      // an empty explanation would make the toContain below pass on anything
      expect(r.explanation.length, `${r.code} has no explanation to look for`).toBeGreaterThan(20);
      const row = rsRequirementRow(u, r.code);
      expect(row, `${r.code} is not on the review record`).toBeTruthy();
      // the human paragraph the drawing was never supposed to print lives HERE
      expect(row!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
        `${r.code} is listed without its explanation`)
        .toContain(r.explanation.replace(/\s+/g, ' ').slice(0, 60));
    }
  });

  it('NO drawing sheet carries a release-status box any more', () => {
    const { html } = pkg();
    const drawings = strictPages(html).filter(p => /^(PV|E|SCHED)/.test(sheetIdOf(p)));
    expect(drawings.length, 'no drawing sheets ⇒ the absences below are vacuous')
      .toBeGreaterThan(5);
    for (const page of drawings) {
      const id = sheetIdOf(page);
      expect(page, `${id} still renders banner requirement rows`).not.toContain('data-banner-requirement=');
      expect(page, `${id} still renders the advisory banner marker`).not.toContain('data-banner-advisory=');
      expect(page, `${id} still prints the submission-status line`).not.toContain('NOT FOR PERMIT SUBMISSION');
      expect(page, `${id} still prints the retired phase headline`)
        .not.toContain('PENDING STRUCTURAL ENGINEERING REVIEW');
    }
  });
});
