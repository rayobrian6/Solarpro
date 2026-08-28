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

/** Bullets inside the banner / gate box on a given sheet's page. */
function bulletsOn(html: string, sheetId: string): string[] {
  const pages = html.split(/(?=<div class="page)/);
  const page = pages.find(p => new RegExp(`tb-sheet-id">\\s*${sheetId.replace('.', '\\.')}\\s*<`).test(p));
  expect(page, `sheet ${sheetId} not found`).toBeTruthy();
  return [...(page as string).matchAll(/<li style="margin:0 0 1px 0;[^"]*">([\s\S]*?)<\/li>/g)]
    .map(m => m[1].replace(/<[^>]*>/g, ''));
}

const QCABLE = /Q-Cable procurement is SHORT/;
const TAP = /tap-conductor length is not measured/;
const ROUTE = /no routed geometry in the CAD model/;
const FRAMING = /EXISTING FRAMING CAPACITY NOT VERIFIED/;

describe('WS-17 — a sheet enumerates the requirements gating ITS OWN content', () => {
  const DR = gen('design-review');

  // 2026-08-28 ROUTE-BOUND MIGRATION - PV-1's own requirement was
  // ROUTE-LENGTH-ESTIMATE, which no longer fires: the DESIGN bounds each
  // un-routed run. WS-17's property is that a sheet enumerates the requirements
  // gating ITS OWN content rather than the package union, and it is asserted
  // here on a sheet the fixture still gates. The rule is unchanged.
  it('PV-3 (attachment detail) carries the FRAMING requirement, NOT Q-Cable procurement, the tap length or the route', () => {
    const b = bulletsOn(DR.html, 'PV-3');
    expect(b.some(x => FRAMING.test(x))).toBe(true);
    expect(b.some(x => QCABLE.test(x))).toBe(false);
    expect(b.some(x => TAP.test(x))).toBe(false);
    expect(b.some(x => ROUTE.test(x))).toBe(false);
  });

  it('PV-3 (attachment detail) carries the structural requirements, NOT the electrical ones', () => {
    const b = bulletsOn(DR.html, 'PV-3');
    expect(b.some(x => FRAMING.test(x))).toBe(true);
    expect(b.some(x => QCABLE.test(x))).toBe(false);
    expect(b.some(x => TAP.test(x))).toBe(false);
    expect(b.some(x => ROUTE.test(x))).toBe(false);
  });

  it('PE-1 gate box no longer prints Q-Cable / tap / route requirements', () => {
    const b = bulletsOn(DR.html, 'PE-1');
    expect(b.some(x => FRAMING.test(x))).toBe(true);
    expect(b.some(x => QCABLE.test(x))).toBe(false);
    expect(b.some(x => TAP.test(x))).toBe(false);
    expect(b.some(x => ROUTE.test(x))).toBe(false);
  });

  it('the banner sheets do not print the SAME list', () => {
    // 2026-08-28 ROUTE-BOUND MIGRATION - PV-1 / PV-1B no longer carry an own
    // requirement, so the differentiation is asserted on sheets that do.
    const lists = ['PV-3', 'PE-1'].map(id =>
      bulletsOn(DR.html, id).filter(x => !/more unresolved release requirement/.test(x)).join('|'));
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
    // 2026-08-28 ROUTE-BOUND MIGRATION - PV-1 / PV-1B have no own requirement on
    // this fixture any more (the route one closed), so the case is exercised on
    // the sheets that DO own one. The rule is unchanged.
    for (const id of ['PV-3', 'PE-1']) {
      const per = bannerRequirementsForSheet(banner, id);
      const bullets = bulletsOn(DR.html, id);
      const rem = bullets.find(x => /unresolved release requirement/.test(x)
        && /elsewhere in this package/.test(x));
      if (per.own.length === 0) {
        // no gated content of its own ⇒ no requirement list at all on this sheet
        expect(bullets.filter(x => /unresolved release requirement/.test(x))).toEqual([]);
        continue;
      }
      if (per.otherCount > 0) {
        expect(rem, `${id} has ${per.otherCount} other requirement(s) and no remainder line`).toBeTruthy();
        // the printed remainder = this sheet's own capped overflow + the
        // requirements that gate other sheets, so it can only be ≥ otherCount
        const printed = Number(/\+\s*(\d+)\s+more/.exec(rem as string)?.[1] ?? NaN);
        expect(printed).toBeGreaterThanOrEqual(per.otherCount);
      } else {
        expect(rem, `${id} printed a remainder line with nothing remaining`).toBeFalsy();
      }
    }
  });

  it('NON-VACUOUS: on a package with an extra open requirement, every one of those sheets prints it', () => {
    // A grounding-PENDING package (synthetic wrong-architecture document through
    // the build's authority socket — the live project stays closed on its real
    // archived evidence) puts a requirement on RS-1/E-1/PV-4B that none of these
    // four sheets owns, so all four must state the remainder.
    const P = gen('design-review', pendingGroundingAuthority('wrongConnectorArchitecture'));
    const banner = structuralBanner(P.snap);
    // 2026-08-28 ROUTE-BOUND MIGRATION - PV-1 / PV-1B have no own requirement on
    // this fixture any more (the route one closed), so the case is exercised on
    // the sheets that DO own one. The rule is unchanged.
    for (const id of ['PV-3', 'PE-1']) {
      expect(bannerRequirementsForSheet(banner, id).otherCount,
        `${id} owns the entire registry — the remainder case is not exercised`).toBeGreaterThan(0);
      const rem = bulletsOn(P.html, id).find(x => /unresolved release requirement/.test(x)
        && /elsewhere in this package/.test(x));
      expect(rem, `${id} has no remainder line`).toBeTruthy();
    }
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
    expect(DR.html).toContain(`${blocking} UNRESOLVED REQUIREMENTS`);
    expect(DR.html).toMatch(new RegExp(`${advisory} ADVISOR(Y|IES)`));
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
    const html = structuralBannerHtml(projectStructuralFromInput(FULL.input).banner,
      { input: FULL.input, sheetId: 'PV-5' });
    expect(html).toContain('No unresolved requirement is projected onto this sheet');
    expect(html).not.toMatch(QCABLE);
    // the package state is still stated
    expect(html).toContain('PENDING STRUCTURAL ENGINEERING REVIEW');
    expect(html).toContain('NOT FOR PERMIT SUBMISSION');
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
