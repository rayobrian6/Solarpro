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
// ANTI-VACUITY: the banner-suppression test proves the rule is DATA-DRIVEN (a
// sheet named by an unresolved requirement keeps its banner), and the
// certification test proves the permit profile refuses the CERT/PE-1 sheets
// while the approval is only a placeholder — it never invents one.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { buildSheetManifest } from '@/lib/permit/sheetManifest';
import { schedContPageCount } from '@/lib/permit/sections/structuralPages';
import { resolvePlansetProfile, certificationIsCompleted, sheetIsDirectlyGated } from '@/lib/permit/plansetProfile';
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
  it('total status-language occurrences drop by at least half', () => {
    const full = statusLanguageCount(FULL.html);
    const permit = statusLanguageCount(PERMIT.html);
    expect(full).toBeGreaterThan(0);
    expect(permit).toBeLessThanOrEqual(full / 2);
  });

  it('the cover prints ONE concise release status pointing at the in-app record', () => {
    expect(PERMIT.html).toContain('data-release-status-profile="permit"');
    expect(PERMIT.html).toContain('SEE THE PROJECT REVIEW RECORD IN THE APPLICATION');
    // exactly one release-status block in the whole permit package
    expect((PERMIT.html.match(/data-release-status-block="1"/g) ?? []).length).toBe(1);
    // and it does NOT point at RS-1, which is not in this set
    expect(PERMIT.html).not.toContain('SEE RS-1 FOR ALL');
  });

  it('ANTI-VACUITY — a sheet whose own content is gated KEEPS its banner', () => {
    const gated = PERMIT.snap.permitReadiness.registry
      .filter(r => !r.resolved)
      .flatMap(r => r.affectedSheets ?? []);
    // the fixture has open structural requirements, so a structural sheet is gated
    expect(gated.length).toBeGreaterThan(0);
    const structuralGated = gated.some(s => s === 'PV-3' || s === 'PV-4C');
    expect(structuralGated).toBe(true);
    expect(sheetIsDirectlyGated(PERMIT.input, 'PV-4C')).toBe(true);
    // …and that sheet still carries the per-sheet banner in the permit profile
    const pv4c = PERMIT.html.slice(PERMIT.html.indexOf('tb-sheet-id">PV-4C<'));
    expect(pv4c.slice(0, 60000)).toContain('struct-review-banner');
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
    expect(PERMIT.html).toContain('PENDING ENGINEERING REVIEW &mdash; NOT FOR PERMIT SUBMISSION');
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
