// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-10 — PLANSET COMPACTION / OUTPUT PROFILE.
//
// The directive's rule: the planset must get SMALLER as automation improves,
// and it may NEVER get smaller by hiding unresolved engineering. These tests
// hold both halves of that at once:
//
//   • the PERMIT profile drops the internal sheets (RS-1(.n), the SCHED
//     procurement continuations, APP-A, the unsigned CERT/PE-1 placeholders),
//     merges PV-6 onto PV-5 and moves DS-n into a manufacturer attachment
//     appendix;
//   • and the SNAPSHOT is unchanged by that: identical release registry,
//     identical requirement codes, identical BOM. Page removal cannot drop a
//     registry requirement.
//   • the FULL profile is byte-identical to the pre-WS-10 output, so the
//     in-app package, the goldens and the RGM/ECD/BAR harnesses are untouched.
//
// ANTI-VACUITY: the banner-suppression pair proves the rule is DATA-DRIVEN (a
// sheet named by an unresolved requirement resolves to its OWN requirements, a
// sheet named by none resolves to nothing), and the certification test proves
// the permit profile refuses the CERT/PE-1 sheets while the approval is only a
// placeholder — it never invents one.
//
// RAY'S RULING 2026-09-18 — internal release bookkeeping is OFF the outbound
// sheets: no per-sheet status box, and no printed "NOT FOR PERMIT SUBMISSION"
// anywhere on the package. The three assertions that pinned that printed form
// are now assert-ABSENCE, and the state they stood for is read from the cover's
// hidden release-status block (phase + non-submittable-preview marker). The
// readable account of every open requirement is unchanged on RS-1/RS-1.1.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { buildSheetManifest } from '@/lib/permit/sheetManifest';
import { schedContPageCount } from '@/lib/permit/sections/structuralPages';
import { resolvePlansetProfile, certificationIsCompleted, sheetIsDirectlyGated, requirementAffectsSheet } from '@/lib/permit/plansetProfile';
// RAY'S RULING 2026-09-18 — the per-sheet status box is retired, but the MODEL
// behind it (which requirements are projected onto which sheet) is untouched and
// still feeds RS-1 and the release model. The banner-suppression test below now
// asserts that model directly instead of a box that no longer renders.
import { structuralBanner, bannerRequirementsForSheet } from '@/lib/permit/snapshot/structuralProjection';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function render(profile?: 'permit' | 'full'): { html: string; snap: PermitDesignSnapshot; input: any } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  if (profile) input.plansetProfile = profile;
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot, input };
}

const sheetIds = (h: string): string[] =>
  [...h.matchAll(/tb-sheet-id">\s*([^<]+?)\s*</g)].map(m => m[1]);

const STATUS_PHRASES = [
  'PENDING ENGINEERING REVIEW', 'NOT FOR PERMIT SUBMISSION', 'RELEASE STATUS',
  'UNRESOLVED', 'RELEASE GATE', 'BLOCKER',
];
function statusLanguageCount(html: string): number {
  const up = html.toUpperCase();
  return STATUS_PHRASES.reduce((n, p) => n + (up.split(p).length - 1), 0);
}

// 2026-09-18 — several assertions below became assert-ABSENCE of printed status
// language. They MUST measure the visible text: the raw HTML keeps developer
// comments that NARRATE the retired bookkeeping ("…NOT FOR PERMIT SUBMISSION…"),
// and a comment describing something we removed must never read as the thing
// still printing. Same construction the (4) status-language test does inline.
const visibleText = (html: string): string => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .toUpperCase();

// Split at the PHYSICAL page boundary — `class="page"` / `class="page ` — the
// same token the (7) page-count assertion matches. Splitting on the bare prefix
// would also cut at `class="page-body"`, i.e. inside every sheet, and a search
// for a requirement on "the RS-1 page" would then miss the whole sheet body.
const pagesOf = (html: string): string[] => html.split(/(?=<div class="page[ "])/);
/** RS-1 paginates onto RS-1.1(.n): the review record is the UNION of those sheets. */
const rs1Html = (html: string): string =>
  pagesOf(html).filter(p => /tb-sheet-id">\s*RS-1/.test(p)).join('\n');

const FULL = render('full');
const PERMIT = render('permit');
const DEFAULT = render();

// ── 1. internal sheets are excluded from the permit output ──────────────────
describe('WS-10 (1) — the permit profile carries the compact drawing set only', () => {
  const ids = sheetIds(PERMIT.html);

  it('drops RS-1 and every RS-1.n continuation', () => {
    expect(ids.filter(i => i.startsWith('RS-1'))).toEqual([]);
    expect(sheetIds(FULL.html).filter(i => i.startsWith('RS-1')).length).toBeGreaterThan(0);
  });

  // ── D3 (Planset 17) — REPLACED ───────────────────────────────────────────
  // This used to assert `ids.filter(i => /^SCHED-\d+$/).toEqual([])` — that the
  // permit profile drops the BOM continuations. It was green while 38 of the 48
  // canonical procurement rows were absent from the AHJ-facing artifact, so it
  // was not protecting a contract, it was pinning a defect. The compact profile
  // legitimately needs continuation sheets; what must be asserted is that the
  // continuation is COMPLETE and CONSISTENT, not that it is forbidden.
  it('carries the equipment schedule AND every continuation the BOM requires', () => {
    expect(ids).toContain('SCHED');
    const cont = ids.filter(i => /^SCHED-\d+$/.test(i));
    // schedContPageCount is the single source the manifest and page assembly share
    const expected = schedContPageCount(PERMIT.input.bom);
    expect(cont.length, `permit SCHED continuations: got ${cont.length}, BOM needs ${expected}`).toBe(expected);
    // contiguous and correctly numbered: SCHED-2, SCHED-3, …
    expect(cont).toEqual(Array.from({ length: expected }, (_u, i) => `SCHED-${i + 2}`));
  });

  it('drops APP-A (the duplicate reference to the datasheets that follow it)', () => {
    expect(ids).not.toContain('APP-A');
    expect(sheetIds(FULL.html)).toContain('APP-A');
  });

  it('merges PV-6 onto PV-5 as ONE labels/placards/directory sheet', () => {
    expect(ids).not.toContain('PV-6');
    expect(ids).toContain('PV-5');
    // the merge is a COMPOSITION, not a deletion: the plaque, its directory rows
    // and its specification are all present on the merged sheet.
    expect(PERMIT.html).toContain('data-merged-sheet="PV-6"');
    expect(PERMIT.html).toContain('DISCONNECTING MEANS');
    expect(PERMIT.html).toContain('EMERGENCY SHUTDOWN PROCEDURE');
    expect(PERMIT.html).toContain('PLACARD SPECIFICATION');
  });

  it('keeps the whole core drawing set (nothing an AHJ reviews is removed)', () => {
    for (const id of ['PV-0', 'PV-1', 'PV-1B', 'PV-3', 'PV-4C', 'E-1', 'PV-4A', 'PV-4B', 'PV-5', 'SCHED']) {
      expect(ids, `${id} missing from the permit set`).toContain(id);
    }
  });

  it('the permit set is materially shorter than the internal package', () => {
    expect(ids.length).toBeLessThan(sheetIds(FULL.html).length);
    // D3: the cap moved 16 → 20. The permit set is compact because it drops the
    // REVIEW registry (RS-1.n), PV-6, APP-A and the CERT placeholders — not
    // because it drops procurement rows. The BOM continuations it now carries
    // are content the AHJ is entitled to, so they count against this ceiling
    // honestly rather than being suppressed to keep a number down.
    expect(ids.length).toBeLessThanOrEqual(20);
  });
});

// ── 2. the procurement BOM stays available OUTSIDE the permit set ───────────
describe('WS-10 (2) — the BOM is snapshot-bound and unchanged by the profile', () => {
  it('the snapshot BOM is identical under both profiles', () => {
    // the structural BOM is the snapshot-bound quantity source the schedule projects.
    expect(PERMIT.snap.structural.bom.length).toBeGreaterThan(0);
    expect(JSON.stringify(PERMIT.snap.structural.bom)).toBe(JSON.stringify(FULL.snap.structural.bom));
    expect(JSON.stringify(PERMIT.snap.structural.bomReconciliation)).toBe(JSON.stringify(FULL.snap.structural.bomReconciliation));
  });

  // ── D3 (Planset 17) — REPLACED ───────────────────────────────────────────
  // This asserted the permit SCHED points at the PROJECT RECORD rather than at
  // a sheet, and `not.toContain('CONTINUED ON NEXT SHEET')`. Both were true of
  // the old behaviour and both described a schedule that omitted 38 of 48 rows.
  // Pointing a reviewer at an in-app record is not a substitute for printing the
  // schedule. Now the continuation names the SHEET the rows are actually on, and
  // the assertion is that EVERY canonical row is rendered exactly once.
  it('renders every canonical BOM row exactly once, under every profile', () => {
    const rendered = (html: string): string[] =>
      [...html.matchAll(/data-bom-line-id="([^"]+)"/g)].map(m => m[1]);
    for (const [name, pkg] of [['permit', PERMIT], ['full', FULL]] as const) {
      const ids = rendered(pkg.html);
      const uniq = new Set(ids);
      expect(ids.length, `${name}: no rendered BOM rows at all`).toBeGreaterThan(0);
      expect(uniq.size, `${name}: duplicate BOM rows across continuation sheets — ${ids.length} rendered, ${uniq.size} unique`).toBe(ids.length);
    }
    // and the two profiles render the SAME row set — the compact profile drops
    // sheets, never procurement lines.
    expect(new Set(rendered(PERMIT.html))).toEqual(new Set(rendered(FULL.html)));
  });

  it('the continuation points at the next SHEET, not at an off-artifact record', () => {
    expect(PERMIT.html).toContain('CONTINUED ON NEXT SHEET');
    expect(FULL.html).toContain('CONTINUED ON NEXT SHEET');
    // the retired misdirection is gone
    expect(PERMIT.html).not.toContain('FULL PROCUREMENT BILL OF MATERIALS IN THE PROJECT RECORD');
  });
});

// ── 3. the DS pages become a separate manufacturer attachment appendix ──────
describe('WS-10 (3) — DS-n is an appendix, not a numbered drawing sheet', () => {
  const idx = PERMIT.snap.projectAuthority.sheetIndex;

  it('every DS sheet is tagged section:appendix; no drawing sheet is', () => {
    const ds = idx.filter(s => /^DS-\d+$/.test(s.id));
    expect(ds.length).toBeGreaterThan(0);
    for (const s of ds) expect(s.section).toBe('appendix');
    for (const s of idx.filter(s => !/^DS-\d+$/.test(s.id))) expect(s.section).not.toBe('appendix');
  });

  it('the appendix follows the whole drawing set', () => {
    const firstAppendix = idx.findIndex(s => s.section === 'appendix');
    const lastDrawing = idx.map(s => s.section === 'appendix').lastIndexOf(false);
    expect(firstAppendix).toBeGreaterThan(lastDrawing);
  });

  it('the cover indexes the appendix under its own heading', () => {
    expect(PERMIT.html).toContain('MANUFACTURER ATTACHMENTS (APPENDIX — NOT DRAWING SHEETS)');
    expect(FULL.html).not.toContain('MANUFACTURER ATTACHMENTS (APPENDIX');
  });

  it('the FULL profile keeps DS-n inline as before (no appendix tagging)', () => {
    expect(FULL.snap.projectAuthority.sheetIndex.some(s => s.section === 'appendix')).toBe(false);
  });
});

// ── 4. the repeated package-status language is materially reduced ───────────
describe('WS-10 (4) — one cover statement, not a package headline on every sheet', () => {
  it('total status-language occurrences drop, and release BOOKKEEPING is zero', () => {
    const full = statusLanguageCount(FULL.html);
    const permit = statusLanguageCount(PERMIT.html);
    expect(full).toBeGreaterThan(0);
    // The ≤ full/2 ratio this used to assert has stopped measuring WS-10. Both
    // profiles lost their printed release bookkeeping on 2026-09-18 (Ray's
    // ruling), and the FULL profile lost more of it — so the residual count is
    // now dominated by per-sheet title-block boilerplate ("PENDING ENGINEERING
    // REVIEW" and the drafting stamp, once per sheet on 22 sheets), which is the
    // same on both profiles by construction and was never what WS-10 was about.
    // A ratio over that boilerplate would pin the sheet COUNT, not the language.
    expect(permit).toBeLessThan(full);
    // The property that actually matters is absolute, and is now assertable:
    // NO release bookkeeping reaches the submittal at all.
    //
    // Measured on the VISIBLE TEXT. The raw HTML carries developer comments that
    // narrate retired behaviour ("…NOT the BLOCKER LIST. The retired banner
    // printed 8 verbatim BLOCKER messages…"), and a comment describing a defect
    // we removed must never be read as the defect still being present.
    const visible = PERMIT.html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .toUpperCase();
    // NOTE the bookkeeping phrases are specific. A bare "UNRESOLVED" is NOT one:
    // the submittal legitimately says "Unresolved: existing service-entrance
    // conductor SIZE not surveyed", which is an honest engineering fact of the
    // same class as NOT SURVEYED / NOT ESTABLISHED and is exactly what the
    // engineer is being asked to look at. Banning the word would delete that.
    for (const p of ['RELEASE STATUS', 'RELEASE GATE', 'BLOCKER',
      'UNRESOLVED REQUIREMENT', 'UNRESOLVED DESIGN REQUIREMENT', 'UNRESOLVED ITEM',
      'OPEN DESIGN GATE', 'DESIGN COMPLETE', 'DESIGN INCOMPLETE',
      'OUTPUT PROFILE', 'PROCUREMENT READY']) {
      expect(visible, `"${p}" must not appear on the permit submittal`).not.toContain(p);
    }
    // …while the honest issue state and drafting stamp remain
    expect(PERMIT.html).toMatch(/PENDING ENGINEERING REVIEW/);
    // RAY'S RULING 2026-09-18 — this line pinned the PRINTED "NOT FOR PERMIT
    // SUBMISSION" headline (per-sheet banner, cover CALC BASIS paragraph, the
    // PE-1/CERT gate box). All three came OFF the outbound sheets, and that
    // removal is the point of the ruling — so the assertion inverts: the printed
    // form is now pinned ABSENT and cannot silently return. The property it
    // stood for (this output is not the submittal) is machine-readable on the
    // cover's hidden release-status block, asserted immediately below and again
    // in the sibling "carries one release-status record" case.
    expect(visible).not.toContain('NOT FOR PERMIT SUBMISSION');
    const stateBlock = /<div[^>]*data-release-status-block="1"[^>]*>/.exec(PERMIT.html);
    // NON-VACUITY: exec() yields null if the block is gone, and every attribute
    // read off it would then be `undefined` — which proves nothing at all.
    expect(stateBlock, 'the permit cover carries no machine-readable release state').not.toBeNull();
    // permit profile + pending review ⇒ explicitly a NON-SUBMITTABLE PREVIEW
    expect(stateBlock![0]).toContain('data-permit-submission-preview="1"');
    const phase = /data-release-phase="([A-Z_]+)"/.exec(stateBlock![0]);
    expect(phase, 'the release-status block states no release phase').not.toBeNull();
    expect(phase![1]).not.toBe('ISSUED_FOR_PERMIT');
  });

  it('the cover CARRIES one release-status record and prints no release status', () => {
    // RAY'S RULING 2026-09-18 — WS-10 reduced the cover to ONE concise printed
    // release status. That count is now ZERO: nothing about our internal release
    // state prints on an outbound set at all. The structural property WS-10 was
    // built on — exactly one release-status block, on the cover, and no dangling
    // pointer at a sheet this profile does not carry — is unchanged.
    expect(PERMIT.html).toContain('data-release-status-profile="permit"');
    expect((PERMIT.html.match(/data-release-status-block="1"/g) ?? []).length).toBe(1);
    // no pointer of either wording, and no dangling RS-1 reference
    expect(PERMIT.html).not.toContain('SEE THE PROJECT REVIEW RECORD IN THE APPLICATION');
    expect(PERMIT.html).not.toContain('SEE RS-1 FOR ALL');
    expect(PERMIT.html).not.toContain('SEE SHEET RS-1');
    // RS-1 is not in the permit set, so the block must not claim it is
    expect(PERMIT.html).not.toContain('data-release-record-sheet=');
    // RAY'S RULING 2026-09-18 — "the submittal still states that it may not be
    // submitted" no longer has a printed form anywhere on an outbound sheet.
    // This becomes the assert-ABSENCE half of this case's own title ("prints no
    // release status"), measured on the VISIBLE text; the CARRIES half is the
    // hidden record below. The readable account of every open item is unchanged
    // on RS-1/RS-1.1, which this profile deliberately does not carry.
    const printed = visibleText(PERMIT.html);
    // NON-VACUITY: a not.toContain against an over-stripped (empty) extraction
    // passes for anything. Anchor on text the submittal certainly prints.
    expect(printed, 'the visible-text extraction came back empty').toContain('PENDING ENGINEERING REVIEW');
    expect(printed).not.toContain('NOT FOR PERMIT SUBMISSION');
    const block = /<div[^>]*data-release-status-block="1"[^>]*>/.exec(PERMIT.html)?.[0];
    // NON-VACUITY: without the block, both attribute assertions read `undefined`.
    expect(block, 'the one release-status record is missing entirely').toBeTruthy();
    expect(block!).toContain('data-permit-submission-preview="1"');
    expect(block!).toMatch(/style="display:\s*none;?"/);   // CARRIED as data, not printed
  });

  it('ANTI-VACUITY — a sheet whose own content is gated is still MODELLED as gated', () => {
    const gated = PERMIT.snap.permitReadiness.registry
      .filter(r => !r.resolved)
      .flatMap(r => r.affectedSheets ?? []);
    // the fixture has open structural requirements, so a structural sheet is gated
    expect(gated.length).toBeGreaterThan(0);
    const structuralGated = gated.some(s => s === 'PV-3' || s === 'PV-4C');
    expect(structuralGated).toBe(true);
    expect(sheetIsDirectlyGated(PERMIT.input, 'PV-4C')).toBe(true);
    // ── RAY'S RULING 2026-09-18 ──────────────────────────────────────────────
    // "…and that sheet still carries the per-sheet banner" has no printed form
    // any more: structuralBannerHtml() is retired to a no-op and every call site
    // on PV-1/PV-1B/PV-3/PV-4C(.1) is deleted, so the old slice-for-
    // 'struct-review-banner' can only fail. It was never the box that mattered —
    // the anti-vacuity property is that suppression is DATA-DRIVEN, i.e. that the
    // per-sheet requirement→sheet attribution still resolves PV-4C to its OWN
    // open requirements (and, in the sibling case, a clean sheet to none). That
    // model is untouched, so assert it directly.
    const banner = structuralBanner(PERMIT.snap);
    const own = bannerRequirementsForSheet(banner, 'PV-4C');
    // NON-VACUITY: an empty `own` would make the every() below pass trivially,
    // and would itself be the failure this case exists to catch.
    expect(own.own.length, 'PV-4C resolves to NO requirements of its own — the per-sheet model went vacuous').toBeGreaterThan(0);
    expect(own.own.every(r => requirementAffectsSheet(r.sheets, 'PV-4C'))).toBe(true);
    // WHERE THE READABLE ACCOUNT LIVES NOW: RS-1/RS-1.1 in the internal package
    // still enumerate every one of those requirements in full. Removing the box
    // must not have removed the account.
    const rs1 = rs1Html(FULL.html);
    expect(rs1.length, 'no RS-1 sheet found in the FULL package — the account has nowhere to live').toBeGreaterThan(0);
    for (const r of own.own) expect(rs1, `${r.code} is gating PV-4C but is not stated on RS-1`).toContain(r.code);
    // …and the retired box prints on NO sheet, under EITHER profile.
    expect(PERMIT.html).not.toContain('struct-review-banner');
    expect(FULL.html).not.toContain('struct-review-banner');
  });

  it('ANTI-VACUITY — suppression is data-driven, not blanket', () => {
    // a sheet named by NO unresolved requirement is not directly gated
    const named = new Set(PERMIT.snap.permitReadiness.registry.filter(r => !r.resolved)
      .flatMap(r => r.affectedSheets ?? []));
    const unnamed = ['PV-4A', 'PV-4B', 'E-1', 'SCHED'].filter(s => !named.has(s));
    expect(unnamed.length).toBeGreaterThan(0);
    for (const s of unnamed) expect(sheetIsDirectlyGated(PERMIT.input, s)).toBe(false);
  });
});

// ── 5. genuine unresolved requirements stay VISIBLE on the permit set ───────
describe('WS-10 (5) — unresolved work is stated, never hidden', () => {
  it('the cover names every open release gate and the real requirement count', () => {
    const open = PERMIT.snap.permitReadiness.registry.filter(r => !r.resolved);
    expect(open.length).toBeGreaterThan(0);
    expect(PERMIT.html).toMatch(new RegExp(`data-release-requirement-count="\\d+"`));
    // the printed count is the model's, not a shrunken one
    const m = PERMIT.html.match(/data-release-requirement-count="(\d+)"/);
    expect(Number(m?.[1])).toBeGreaterThan(0);
    // 2026-08-28 RELEASE-PHASE MIGRATION — that pairing was a HARDCODED literal
    // printed on every unissued package regardless of state, which is exactly
    // what the phase model replaced. The property this line stood for — the
    // cover states the package is not submittable — is asserted from the phase.
    expect(PERMIT.html).toMatch(/data-release-phase="(DESIGN_INCOMPLETE|AWAITING_PROFESSIONAL_REVIEW|AWAITING_SEAL_AND_ISSUE)"/);
    // RAY'S RULING 2026-09-18 — the printed pairing is gone for good: no outbound
    // sheet says NOT FOR PERMIT SUBMISSION. The phase assertion on the line above
    // IS the surviving property (an unissued phase == not submittable), so this
    // line converts to an assert-ABSENCE that pins the removal instead of a
    // literal that now only re-asserts the phase in words the reader is told not
    // to print. The unresolved work itself is still stated — per-field on the
    // sheets, and in full on RS-1/RS-1.1 in the internal package.
    const printed = visibleText(PERMIT.html);
    // NON-VACUITY: an empty extraction would satisfy not.toContain trivially.
    expect(printed, 'the visible-text extraction came back empty').toContain('PENDING ENGINEERING REVIEW');
    expect(printed).not.toContain('NOT FOR PERMIT SUBMISSION');
  });

  it('the permit profile never reaches an ISSUED identity while gates are open', () => {
    expect(PERMIT.snap.permitReadiness.ready).toBe(false);
    expect(PERMIT.html).not.toContain('ISSUED FOR PERMIT');
  });
});

// ── 6. page removal cannot drop a registry requirement ──────────────────────
describe('WS-10 (6) — registry integrity across profiles', () => {
  it('the release registry is byte-identical under both profiles', () => {
    expect(JSON.stringify(PERMIT.snap.permitReadiness.registry))
      .toBe(JSON.stringify(FULL.snap.permitReadiness.registry));
  });

  it('every requirement code survives the compaction', () => {
    const full = FULL.snap.permitReadiness.registry.map(r => r.code).sort();
    const permit = PERMIT.snap.permitReadiness.registry.map(r => r.code).sort();
    expect(permit).toEqual(full);
  });

  it('the blocking list and readiness verdict are identical', () => {
    expect(PERMIT.snap.permitReadiness.blockers).toEqual(FULL.snap.permitReadiness.blockers);
    expect(PERMIT.snap.permitReadiness.ready).toBe(FULL.snap.permitReadiness.ready);
  });

  it('a requirement whose only sheet was removed is STILL in the registry', () => {
    const removed = new Set(sheetIds(FULL.html).filter(id => !sheetIds(PERMIT.html).includes(id)));
    expect(removed.size).toBeGreaterThan(0);
    const orphaned = FULL.snap.permitReadiness.registry
      .filter(r => (r.affectedSheets ?? []).length > 0
        && (r.affectedSheets ?? []).every(s => removed.has(s)));
    // whatever those are, they are all still present in the permit registry
    for (const r of orphaned) {
      expect(PERMIT.snap.permitReadiness.registry.some(x => x.code === r.code)).toBe(true);
    }
  });
});

// ── 7. both profiles generate; the composition matches the manifest ─────────
describe('WS-10 (7) — profile plumbing', () => {
  it('the engine default is the FULL profile (no caller changes by accident)', () => {
    expect(resolvePlansetProfile(undefined)).toBe('full');
    expect(resolvePlansetProfile({} as never)).toBe('full');
    expect(DEFAULT.html.length).toBe(FULL.html.length);
    expect(DEFAULT.snap.meta.digest).toBe(FULL.snap.meta.digest);
  });

  it('an unknown profile value falls back to FULL rather than silently compacting', () => {
    expect(resolvePlansetProfile({ plansetProfile: 'tiny' } as never)).toBe('full');
  });

  it('physical page count == sheet index under BOTH profiles', () => {
    for (const r of [FULL, PERMIT]) {
      const pages = (r.html.match(/<div class="page[ "]/g) ?? []).length;
      expect(pages).toBe(r.snap.projectAuthority.sheetIndex.length);
      expect((r.html.match(/class="title-block"/g) ?? []).length).toBe(pages);
    }
  });

  it('the manifest builder branches the same way the page assembly does', () => {
    const permitIds = buildSheetManifest({
      pv1Title: 'A', pv3Title: 'B', profile: 'permit',
      datasheets: [{ id: 'DS-1', title: 'x' }], schedContCount: 3, reviewStatusContCount: 2,
    }).map(s => s.id);
    expect(permitIds).not.toContain('RS-1');
    expect(permitIds).not.toContain('RS-1.1');
    // D3: the manifest now emits the BOM continuations on the compact profiles
    // too — schedContCount: 3 above must produce SCHED-2/3/4, exactly as the
    // page assembly does. This assertion previously required their ABSENCE,
    // which is what kept the sheet index agreeing with a truncated package.
    expect(permitIds).toContain('SCHED-2');
    expect(permitIds).toContain('SCHED-3');
    expect(permitIds).toContain('SCHED-4');
    expect(permitIds).not.toContain('APP-A');
    expect(permitIds).not.toContain('PV-6');
    expect(permitIds).not.toContain('CERT');
    expect(permitIds).not.toContain('PE-1');
    expect(permitIds[permitIds.length - 1]).toBe('DS-1');
  });
});

// ── 8. the certification sheets: applicable AND completed only ──────────────
describe('WS-10 (8) — CERT / PE-1 are permit documents only when actually signed', () => {
  it('the fixture has no digest-bound approval, so the permit set omits them', () => {
    expect(certificationIsCompleted(PERMIT.input)).toBe(false);
    expect(sheetIds(PERMIT.html)).not.toContain('CERT');
    expect(sheetIds(PERMIT.html)).not.toContain('PE-1');
    // the FULL package still carries the placeholders for internal review
    expect(sheetIds(FULL.html)).toContain('CERT');
    expect(sheetIds(FULL.html)).toContain('PE-1');
  });

  it('the requirement they represent is NOT dropped with the sheets', () => {
    const codes = PERMIT.snap.permitReadiness.registry.map(r => r.code);
    expect(codes).toContain('ENGINEERING-REVIEW-PENDING');
  });

  it('an approval bound to a DIFFERENT digest still does not qualify', () => {
    const fake: any = { _snapshot: { meta: { snapshotId: 'PDS-TEST', digest: 'abc' }, certification: { engineeringReviewApproved: { reviewedDigest: 'zzz', approvedAtIso: 'x' } } } };
    expect(certificationIsCompleted(fake)).toBe(false);
    fake._snapshot.certification.engineeringReviewApproved.reviewedDigest = 'abc';
    expect(certificationIsCompleted(fake)).toBe(true);
  });
});
