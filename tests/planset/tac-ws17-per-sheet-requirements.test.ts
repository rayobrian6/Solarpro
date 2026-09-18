// ═══════════════════════════════════════════════════════════════════════════
// TAC WS-17 — PER-SHEET RELEASE REQUIREMENTS.
//
// The banner printed `banner.blockers` — the whole registry union, capped at 8 —
// on every gated sheet. The sheet id was consulted only to decide SHOW or HIDE,
// never to decide WHAT. The audited package therefore repeated one identical
// eight-item list on PV-1, PV-1B, PV-3 and PV-4C: the site & array plan lectured
// the reviewer about Q-Cable procurement footage, and the attachment detail about
// unmeasured tap conductors. PE-1's certification gate box did the same.
//
// A sheet now enumerates the requirements whose authority is projected onto IT
// (registry affectedSheets; hybrid detail sheets inherit their base sheet), and
// COUNTS the rest. Nothing is hidden — the package totals stay on the gate line
// and the cover's release-status block, and the full list stays in the review
// record / RS-1.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { pendingGroundingAuthority } from '../fixtures/synthetic-pending-grounding';
import {
  structuralBanner, bannerRequirementsForSheet, projectStructuralFromInput,
  type StructuralBanner,
} from '@/lib/permit/snapshot/structuralProjection';
import { structuralBannerHtml } from '@/lib/permit/utils/structuralBanner';
import { requirementAffectsSheet, baseSheetId } from '@/lib/permit/plansetProfile';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(profile = 'design-review', authority?: unknown): { html: string; snap: PermitDesignSnapshot; input: any } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = profile;
  const html = generatePermitHTML(input, undefined, (authority ?? null) as any);
  return { html, snap: input._snapshot, input };
}

// ── RAY'S RULING 2026-09-18 — THE PER-SHEET BANNER AND GATE BOX ARE GONE ─────
// `structuralBannerHtml` is a retired no-op and every drawing call site was
// deleted; `certificationGateBanner` emits a hidden element and nothing visible.
// No outbound sheet enumerates requirements at all any more.
//
// WS-17 survives that removal because it was never a property of the BOX: it is
// that a sheet's requirement set is ITS OWN, not the package union. That set is
// still computed — `bannerRequirementsForSheet` in snapshot/structuralProjection
// is untouched — so each case below asserts the property on the MODEL, and pins
// the removal by asserting the printed form's ABSENCE on the sheet, so the box
// cannot come back unnoticed. The human-readable account of every requirement
// stays on RS-1 / RS-1.1, and that is where it is asserted.

/** The one rendered sheet whose TITLE BLOCK declares this id — never a
 *  `<div class="page">` index, which does not identify a sheet — as the WHOLE
 *  sheet. Splitting on `<div class="page` also cuts at the inner `page-content`
 *  / `page-draw` wrappers, so the chunk carrying the title block holds only the
 *  header; the sheet's BODY is in the chunks that follow it, up to the next
 *  title block. That mattered less while the banner rendered in the header —
 *  now that the assertions are about what a sheet does NOT contain, a helper
 *  that returns 3 kB of frame is a helper that passes for the wrong reason. */
function sheetHtml(html: string, sheetId: string): string {
  const pages: { id: string; html: string }[] = [];
  for (const chunk of html.split(/(?=<div class="page)/)) {
    const id = /tb-sheet-id">\s*([^<]*?)\s*</.exec(chunk)?.[1];
    if (id) pages.push({ id, html: chunk });
    else if (pages.length) pages[pages.length - 1].html += chunk;
  }
  const page = pages.find(p => p.id === sheetId);
  expect(page, `sheet ${sheetId} not found`).toBeTruthy();
  return (page as { html: string }).html;
}

/** The internal review record, which PAGINATES: RS-1 continues onto RS-1.1, so a
 *  requirement code lives in the UNION of every sheet whose id matches /^RS-1/.
 *  Looking only at RS-1 would report a requirement as dropped the moment the
 *  record spilled a page. */
function reviewRecordHtml(html: string): string {
  const parts: string[] = [];
  let inRecord = false;
  for (const chunk of html.split(/(?=<div class="page)/)) {
    const id = /tb-sheet-id">\s*([^<]*?)\s*</.exec(chunk)?.[1];
    if (id) inRecord = /^RS-1/.test(id);
    if (inRecord) parts.push(chunk);
  }
  expect(parts.length, 'no RS-1 sheet found — the review-record assertions would be vacuous').toBeGreaterThan(0);
  return parts.join('');
}

/** Every trace of a PRINTED requirement list on a sheet: a banner/gate bullet
 *  row (with or without its `data-banner-requirement` code), a requirement's
 *  declared one-line `sheetLine`, the package remainder line, or the pointer at
 *  our internal review record. Ray's 2026-09-18 ruling took all four off every
 *  outbound sheet, so the cases that used to READ this list now assert it is
 *  empty — the removal is pinned instead of merely un-asserted. */
function printedRequirementRows(banner: StructuralBanner, html: string, sheetId: string): string[] {
  const page = sheetHtml(html, sheetId);
  const found: string[] = [];
  // 2026-08-28 - the banner rows gained `data-banner-requirement` /
  // `data-banner-advisory` attributes after the style attribute, so the pattern
  // allows trailing attributes. Same rows, richer markup.
  for (const m of page.matchAll(/<li style="margin:0 0 1px 0;[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
    found.push(`row: ${m[1].replace(/<[^>]*>/g, '')}`);
  }
  for (const m of page.matchAll(/data-banner-requirement="([^"]+)"/g)) found.push(`code: ${m[1]}`);
  for (const r of banner.blockers) {
    if (r.sheetLine && page.includes(r.sheetLine)) found.push(`sheetLine: ${r.code}`);
  }
  if (/\+\s*\d+\s*more unresolved|unresolved (release requirement|item)s? elsewhere/.test(page)) {
    found.push('remainder line');
  }
  if (/see sheet RS-1/i.test(page)) found.push('review-record pointer');
  return found;
}

// 2026-08-28 SHEET-LINE MIGRATION - a drawing now carries the requirement's
// one-line `sheetLine`, not the review-record `explanation`. These matchers were
// phrases from the explanation, so they moved to the corresponding sheet line.
// The property under test - a sheet enumerates ITS OWN requirements - is unchanged.
const QCABLE = /BRANCH CABLE SHORT/;
const TAP = /TAP SPAN (UNCONSTRAINED|EXCEEDS)/;
const ROUTE = /RUN LENGTHS ARE ESTIMATES/;
const FRAMING = /STRUCTURAL RELEASE PENDING/;

describe('WS-17 — a sheet enumerates the requirements gating ITS OWN content', () => {
  const DR = gen('design-review');
  // RAY, 2026-09-18 — RS-1 left the outbound set for FULL_INTERNAL. The review
  // record is still the place nothing is dropped; it is just no longer something
  // we send. Outbound assertions stay on DR; record assertions use FULL.
  const FULL = gen('full');

  // 2026-08-28 ROUTE-BOUND MIGRATION - PV-1's own requirement was
  // ROUTE-LENGTH-ESTIMATE, which no longer fires: the DESIGN bounds each
  // un-routed run. WS-17's property is that a sheet enumerates the requirements
  // gating ITS OWN content rather than the package union, and it is asserted
  // here on a sheet the fixture still gates. The rule is unchanged.
  it('PV-3 (attachment detail) carries the FRAMING requirement, NOT Q-Cable procurement, the tap length or the route', () => {
    // RAY'S RULING 2026-09-18 — the banner that PRINTED these rows is retired,
    // so the scoping property is asserted on the model that still computes it
    // (bannerRequirementsForSheet), and the printed list is asserted ABSENT so
    // the box cannot return. The account a human reads stays on RS-1.
    const banner = structuralBanner(DR.snap);
    const per = bannerRequirementsForSheet(banner, 'PV-3');
    expect(banner.blockers.length, 'no active requirement — nothing to scope').toBeGreaterThan(0);
    expect(per.own.length, 'PV-3 owns no requirement — the case would be vacuous').toBeGreaterThan(0);
    const own = per.own.map(r => r.sheetLine ?? r.code);
    expect(own.some(x => FRAMING.test(x))).toBe(true);
    expect(own.some(x => QCABLE.test(x))).toBe(false);
    expect(own.some(x => TAP.test(x))).toBe(false);
    expect(own.some(x => ROUTE.test(x))).toBe(false);
    // NON-VACUITY: those three phrases name requirements this fixture no longer
    // raises, so their absence on its own proves nothing. What proves the
    // scoping is that requirements the package DOES carry, whose authority is
    // projected onto other sheets, are absent from PV-3's set.
    const elsewhere = banner.blockers.filter(r => !per.own.includes(r));
    expect(elsewhere.length, 'PV-3 owns the entire registry — scoping is not exercised').toBeGreaterThan(0);
    for (const r of elsewhere) {
      expect(r.sheets.includes('PV-3'), `${r.code} is projected onto PV-3 yet absent from its set`).toBe(false);
    }
    expect(printedRequirementRows(banner, DR.html, 'PV-3'),
      'PV-3 must print no requirement list — Ray, 2026-09-18').toEqual([]);
  });

  it('PV-3 (attachment detail) carries the structural requirements, NOT the electrical ones', () => {
    // RAY'S RULING 2026-09-18 — asserted on the model; the sheet prints nothing.
    // RETARGETED to the grounding-PENDING package, because the audited fixture
    // raises no ELECTRICAL requirement at all any more: "not the electrical
    // ones" was being proved against an empty electrical set, which is exactly
    // the absent-is-passing shape this repo keeps getting burned by. That
    // package carries QCABLE-GROUNDING-AUTHORITY-UNVERIFIED (E-1 / PV-1B /
    // PV-4B / SCHED), so the exclusion is a real exclusion.
    const P = gen('design-review', pendingGroundingAuthority('wrongConnectorArchitecture'));
    const PFULL = gen('full', pendingGroundingAuthority('wrongConnectorArchitecture'));
    const banner = structuralBanner(P.snap);
    const per = bannerRequirementsForSheet(banner, 'PV-3');
    const notPV3 = banner.blockers.filter(r => r.sheets.length > 0 && !r.sheets.includes('PV-3'));
    expect(notPV3.some(r => /QCABLE/.test(r.code)),
      'the electrical requirement is missing — there is nothing to exclude').toBe(true);
    expect(per.own.length, 'PV-3 owns no requirement — the case would be vacuous').toBeGreaterThan(0);
    const codes = per.own.map(r => r.code);
    expect(codes).toContain('FRAMING-AUTHORITY-UNVERIFIED');
    for (const r of notPV3) expect(codes).not.toContain(r.code);
    const own = per.own.map(r => r.sheetLine ?? r.code);
    expect(own.some(x => QCABLE.test(x))).toBe(false);
    expect(own.some(x => TAP.test(x))).toBe(false);
    expect(own.some(x => ROUTE.test(x))).toBe(false);
    expect(printedRequirementRows(banner, P.html, 'PV-3'),
      'PV-3 must print no requirement list — Ray, 2026-09-18').toEqual([]);
  });

  it('PE-1 gate box no longer prints Q-Cable / tap / route requirements', () => {
    // PE-1 / CERT are rendered by `certificationGateBanner` (certPages.ts), a
    // SEPARATE banner - migrated to the same sheet-line form on 2026-08-28, so
    // the two now agree on wording as well as on scoping.
    // RAY'S RULING 2026-09-18 went further and retired the visible box outright:
    // the letter we send an engineer TO BE STAMPED no longer tells him, in red,
    // that it is unstamped. What survives is one hidden element carrying the
    // release state. So: scoping on the model, box asserted absent, and the
    // machine-readable state asserted where it now lives.
    const banner = structuralBanner(DR.snap);
    const per = bannerRequirementsForSheet(banner, 'PE-1');
    expect(per.own.length, 'PE-1 owns no requirement — the case would be vacuous').toBeGreaterThan(0);
    expect(per.otherCount, 'PE-1 owns the entire registry — scoping is not exercised').toBeGreaterThan(0);
    const own = per.own.map(r => r.sheetLine ?? r.code);
    expect(own.some(x => FRAMING.test(x))).toBe(true);
    expect(own.some(x => QCABLE.test(x))).toBe(false);
    expect(own.some(x => TAP.test(x))).toBe(false);
    expect(own.some(x => ROUTE.test(x))).toBe(false);
    expect(printedRequirementRows(banner, DR.html, 'PE-1'),
      'PE-1 must print no requirement list — Ray, 2026-09-18').toEqual([]);
    const pe = sheetHtml(DR.html, 'PE-1');
    expect(pe, 'the cert state marker is gone — the state would be unobservable')
      .toMatch(/data-cert-gate="1"[^>]*data-release-phase="[A-Z_]+"/);
    // the box's own headline came off with it, and stays off
    expect(pe).not.toContain('NOT FOR PERMIT SUBMISSION');
  });

  it('the banner sheets do not print the SAME list', () => {
    // 2026-08-28 ROUTE-BOUND MIGRATION - PV-1 / PV-1B no longer carry an own
    // requirement, so the differentiation is asserted on sheets that do.
    // RAY'S RULING 2026-09-18 — no sheet prints a list at all now, so the defect
    // this case exists for (ONE identical package-union list repeated on every
    // gated sheet) is pinned twice over: the per-sheet MODEL still differs
    // between the two sheets, and neither sheet prints anything to repeat.
    const banner = structuralBanner(DR.snap);
    const lists = ['PV-3', 'PE-1'].map(id => {
      const own = bannerRequirementsForSheet(banner, id).own;
      expect(own.length, `${id} owns no requirement — two empty lists would differ by nothing`).toBeGreaterThan(0);
      expect(printedRequirementRows(banner, DR.html, id), `${id} must print no requirement list`).toEqual([]);
      return own.map(r => r.code).join('|');
    });
    expect(new Set(lists).size).toBe(lists.length);
  });

  it('nothing is dropped: a gated sheet states its remainder count with a pointer', () => {
    // The RULE is conditional, so the expectation is READ from the banner model
    // per sheet instead of assumed. Asserting a remainder line unconditionally
    // made the test depend on the registry never shrinking — closing ONE
    // requirement anywhere can leave a sheet with no gated content of its own, at
    // which point the compact profile correctly suppresses that sheet's banner
    // entirely and states the package totals once, on the cover. The package
    // total is re-asserted below, so nothing is dropped either way.
    const banner = structuralBanner(DR.snap);
    expect(banner.blockers.length, 'no active requirement — nothing can be dropped or kept').toBeGreaterThan(0);
    // 2026-08-28 ROUTE-BOUND MIGRATION - PV-1 / PV-1B have no own requirement on
    // this fixture any more (the route one closed), so the case is exercised on
    // the sheets that DO own one. The rule is unchanged.
    for (const id of ['PV-3', 'PE-1']) {
      const per = bannerRequirementsForSheet(banner, id);
      // the accounting itself is untouched: own + remainder = the whole registry
      expect(per.own.length + per.otherCount).toBe(banner.blockers.length);
      // ── RAY'S RULING 2026-09-18 ────────────────────────────────────────────
      // The remainder LINE ("+ N more unresolved items elsewhere in this package
      // — see sheet RS-1") is a package count plus a pointer at our internal
      // review record, and both came off the outbound sheets — together with the
      // requirement rows above them. WS-17's property — NOTHING IS DROPPED — is
      // unchanged; it is asserted below against the count PE-1 now carries by
      // machine, and against the review record that lists every requirement.
      expect(printedRequirementRows(banner, DR.html, id),
        `${id} must not PRINT a requirement list or a package remainder line`).toEqual([]);
    }
    // A DRAWING carries no release bookkeeping at all now, printed or hidden:
    // the remainder attribute a previous pass asserted here lives only on the
    // certification sheet's hidden element.
    expect(sheetHtml(DR.html, 'PV-3')).not.toMatch(/data-release-remainder-count=/);
    const carried = /data-cert-gate="1"[^>]*data-release-remainder-count="(\d+)"/.exec(sheetHtml(DR.html, 'PE-1'));
    expect(carried, 'PE-1 carries no machine-readable remainder count').toBeTruthy();
    expect(Number((carried as RegExpExecArray)[1]),
      `PE-1 has ${bannerRequirementsForSheet(banner, 'PE-1').otherCount} other requirement(s) and under-counts them`)
      .toBeGreaterThanOrEqual(bannerRequirementsForSheet(banner, 'PE-1').otherCount);
    // NON-VACUITY OF EVERY `toEqual([])` IN THIS FILE: the same detector must
    // still FIND a printed requirement list where one legitimately remains —
    // RS-1, the internal review record Ray kept — or the absence assertions are
    // passing because the detector went blind, not because the box is gone.
    expect(printedRequirementRows(structuralBanner(FULL.snap), FULL.html, 'RS-1').length,
      'the printed-list detector finds nothing even on RS-1 — absence proves nothing').toBeGreaterThan(0);
    // …and RS-1 is not in the outbound set at all, which is the point.
    expect([...DR.html.matchAll(/tb-sheet-id">\s*([^<]+?)\s*</g)]
      .map(m => m[1]).filter(x => x.startsWith('RS-1'))).toEqual([]);
    // NOTHING IS DROPPED, in the place it now lives: every open requirement is
    // enumerated in full on the internal review record (RS-1, continuing RS-1.1).
    const record = reviewRecordHtml(FULL.html);
    for (const r of banner.blockers) {
      expect(record, `${r.code} is on no sheet and not on the review record`)
        .toContain(`data-release-requirement="${r.code}"`);
    }
  });

  it('NON-VACUOUS: on a package with an extra open requirement, every one of those sheets prints it', () => {
    // A grounding-PENDING package (synthetic wrong-architecture document through
    // the build's authority socket — the live project stays closed on its real
    // archived evidence) puts a requirement on RS-1/E-1/PV-4B that none of these
    // four sheets owns, so all four must state the remainder.
    const P = gen('design-review', pendingGroundingAuthority('wrongConnectorArchitecture'));
    const PFULL = gen('full', pendingGroundingAuthority('wrongConnectorArchitecture'));
    const banner = structuralBanner(P.snap);
    // 2026-08-28 ROUTE-BOUND MIGRATION - PV-1 / PV-1B have no own requirement on
    // this fixture any more (the route one closed), so the case is exercised on
    // the sheets that DO own one. The rule is unchanged.
    const record = reviewRecordHtml(PFULL.html);
    for (const id of ['PV-3', 'PE-1']) {
      const per = bannerRequirementsForSheet(banner, id);
      expect(per.otherCount,
        `${id} owns the entire registry — the remainder case is not exercised`).toBeGreaterThan(0);
      // RAY'S RULING 2026-09-18 — the remainder is carried, not printed, and the
      // rows it remaindered are not printed either. The NON-VACUITY this case
      // exists for is preserved exactly: the remainder branch is genuinely
      // exercised (otherCount > 0 above), and every requirement it stands for is
      // proved to still exist somewhere a reviewer reads — the review record.
      expect(printedRequirementRows(banner, P.html, id),
        `${id} must not PRINT a requirement list or a package remainder line`).toEqual([]);
      for (const r of banner.blockers.filter(x => !per.own.includes(x))) {
        expect(record, `${r.code} is remaindered off ${id} and is on no review-record sheet either`)
          .toContain(`data-release-requirement="${r.code}"`);
      }
    }
    // the count itself survives by machine, on the certification sheet only
    const carried = Number(/data-cert-gate="1"[^>]*data-release-remainder-count="(\d+)"/
      .exec(sheetHtml(P.html, 'PE-1'))?.[1] ?? NaN);
    expect(carried, 'PE-1 carries no remainder count').toBeGreaterThan(0);
    expect(sheetHtml(P.html, 'PV-3')).not.toMatch(/data-release-remainder-count=/);
  });

  it('the package TOTALS are still stated on every banner (gate line unchanged)', () => {
    expect(DR.html).toMatch(/data-release-package-line="1"/);
    // The headline states BLOCKING and ADVISORY as two separate figures
    // ("… / N UNRESOLVED REQUIREMENTS / M ADVISORIES"), so "unresolved requirements" is the
    // BLOCKING count. Counting every unresolved registry row against it only agreed while the
    // advisory count happened to be zero; it silently became wrong the moment one existed
    // (2026-08-27, when a bounded rail envelope made the SKU advisory). Assert both figures.
    const open = DR.snap.permitReadiness.registry.filter(r => !r.resolved);
    const blocking = open.filter(r => r.severity !== 'warning').length;
    const advisory = open.length - blocking;
    // The printed headline lives on RS-1, which is FULL_INTERNAL only now. The
    // OUTBOUND package states the same totals by machine and prints neither.
    expect(FULL.html).toContain(`${blocking} UNRESOLVED REQUIREMENTS`);
    expect(FULL.html).toMatch(new RegExp(`${advisory} ADVISOR(Y|IES)`));
    expect(DR.html).not.toContain('UNRESOLVED REQUIREMENTS');
  });

  it('per-sheet + remainder always reconciles to the full active registry', () => {
    const banner = structuralBanner(DR.snap);
    for (const id of ['PV-1', 'PV-1B', 'PV-3', 'PV-4C', 'PE-1', 'CERT']) {
      const r = bannerRequirementsForSheet(banner, id);
      expect(r.own.length + r.otherCount).toBe(banner.blockers.length);
    }
  });
});

describe('WS-17 — the selector', () => {
  const DR = gen('design-review');
  const banner = projectStructuralFromInput(DR.input).banner;

  it('every requirement carries the sheets its authority is projected onto', () => {
    expect(banner.blockers.length).toBeGreaterThan(0);
    expect(banner.blockers.every(b => Array.isArray(b.sheets))).toBe(true);
    expect(banner.blockers.some(b => b.sheets.length > 0)).toBe(true);
  });

  it('no sheet identity ⇒ never suppress (standalone banner render)', () => {
    const all = bannerRequirementsForSheet(banner, null);
    expect(all.own.length).toBe(banner.blockers.length);
    expect(all.otherCount).toBe(0);
    expect(() => structuralBannerHtml(banner)).not.toThrow();
  });

  it('a sheet with no requirement of its own says so instead of listing another sheet\'s', () => {
    // The compact profiles SUPPRESS the banner entirely on an ungated sheet
    // (sheetIsDirectlyGated), so this branch is reachable in the full profile,
    // where every sheet keeps its banner. No requirement's authority is
    // projected onto the labels sheet.
    const FULL = gen('full');
    // 2026-08-28 - reworded: "Nothing on this sheet is gated". Same statement,
    // one line instead of two, per the drawing-brevity rule.
    // RAY'S RULING 2026-09-18 — and then deleted: `structuralBannerHtml` is a
    // retired no-op, so an ungated sheet no longer SAYS it is ungated, because it
    // prints no banner at all. The property this case guards — a sheet never
    // carries another sheet's requirements — is asserted on the model that still
    // decides it, and the renderer is pinned inert so a body cannot creep back.
    const banner = projectStructuralFromInput(FULL.input).banner;
    expect(banner.blockers.length,
      'no open requirement — an empty package cannot prove anything was suppressed').toBeGreaterThan(0);
    const per = bannerRequirementsForSheet(banner, 'PV-5');
    expect(per.own.length, 'no requirement is projected onto the labels sheet').toBe(0);
    expect(per.otherCount).toBe(banner.blockers.length);
    expect(structuralBannerHtml(banner, { input: FULL.input, sheetId: 'PV-5' })).toBe('');
    expect(structuralBannerHtml(banner)).toBe('');
    // and the REAL rendered sheet carries none of it either
    const pv5 = sheetHtml(FULL.html, 'PV-5');
    expect(printedRequirementRows(banner, FULL.html, 'PV-5')).toEqual([]);
    expect(pv5).not.toMatch(QCABLE);
    // The package state is still CARRIED as the derived phase — not as the two
    // constants this used to pin ('PENDING STRUCTURAL ENGINEERING REVIEW'
    // asserted a structural cause on any not-ready package, including one whose
    // only open item was its project name) and, since Ray's 2026-09-18 ruling,
    // not as a printed phase LABEL either: that label reads "DESIGN COMPLETE —
    // READY FOR PROFESSIONAL REVIEW" as soon as the design closes. It is carried
    // on ONE sheet now — the certification letter's hidden element — and on no
    // drawing, so that is where the attribute is asserted.
    expect(sheetHtml(FULL.html, 'PE-1')).toMatch(/data-cert-gate="1"[^>]*data-release-phase="[A-Z_]+"/);
    expect(pv5).not.toMatch(/data-release-phase="[A-Z_]+"/);
    expect(pv5).not.toMatch(/data-banner-phase-label="1"/);
    expect(pv5).not.toMatch(/DESIGN COMPLETE|DESIGN INCOMPLETE/);
    // the drafting stamp came off the drawings too, and V13 no longer requires
    // the literal anywhere (peLetterIdentity anchors on the cert-state marker)
    expect(pv5).not.toContain('NOT FOR PERMIT SUBMISSION');
  });

  it('a pre-registry snapshot (no per-sheet attribution) falls back to the full list', () => {
    const legacy = { ...banner, blockers: banner.blockers.map(b => ({ ...b, sheets: [] as string[] })) };
    const r = bannerRequirementsForSheet(legacy, 'PV-1');
    expect(r.own.length).toBe(banner.blockers.length);
    expect(r.otherCount).toBe(0);
  });

  it('hybrid detail sheets inherit their base sheet (PV-3G gated by a PV-3 requirement)', () => {
    expect(baseSheetId('PV-3G')).toBe('PV-3');
    expect(baseSheetId('PE-1F')).toBe('PE-1');
    expect(baseSheetId('PV-4B.1')).toBe('PV-4B.1');
    expect(requirementAffectsSheet(['PV-3'], 'PV-3G')).toBe(true);
    expect(requirementAffectsSheet(['PV-3'], 'PV-1')).toBe(false);
    // package-wide (no attribution) belongs to the cover, not to a sheet
    expect(requirementAffectsSheet([], 'PV-1')).toBe(false);
    expect(requirementAffectsSheet(['PV-1'], null)).toBe(true);
  });
});
