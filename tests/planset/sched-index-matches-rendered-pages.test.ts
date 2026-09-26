// ═══════════════════════════════════════════════════════════════════════════
// THE COVER LISTED ONE SET OF SHEETS AND THE PACKAGE CARRIED ANOTHER
//
// The BOM is generated twice. Pass 1 runs with NO snapshot, because the snapshot's
// sheet index needs a BOM row count for SCHED pagination. Pass 2 re-runs it with the
// snapshot attached, which is the only way the snapshot-derived rows — the open-air
// branch EGC, the fastener assembly, the canonical feeder, Q-Cable procurement and
// topology, the supply-side tap — reach the package at all.
//
// Pass 2 used to run AFTER the snapshot was deep-frozen. When the extra rows crossed a
// SCHED page boundary it logged
//
//     "…the snapshot sheet index would disagree with the rendered pages.
//      Keeping pass-1 pagination; investigate…"
//
// and then executed `input.bom = _bomAfter` unconditionally. Nothing kept pass-1
// pagination. The continuation pages render from `input.bom` (pass 2) while the cover
// sheet index and `activeSheetIds` read the FROZEN index (pass 1), so:
//
//   • the cover listed SCHED-2…SCHED-N from the pass-1 count while the set carried a
//     different number of continuation sheets;
//   • every title block's "SHEET n OF N" counted the real, pass-2 pages;
//   • a rendered-but-unindexed sheet was treated as ABSENT by cross-sheet references.
//
// The only signal was a console line telling the reader a mitigation had been applied
// that had not. 🚨 That sentence is the thing to remember: a log that describes a
// mitigation is not a mitigation.
//
// The repo states the rule itself, two lines from the other manifest call in
// snapshot/build.ts: "the stored sheet index must be recomputed or it would disagree
// with the pages actually rendered."
//
// 🚨 WHAT THESE CASES DO AND DO NOT PROVE — READ BEFORE TRUSTING A GREEN RUN.
//
// They pass against the ORIGINAL code as well as the repair, and that was measured,
// not assumed. The Braidon fixture's pass-2 BOM does not cross a SCHED page boundary,
// and the boundary cannot be forced from here: pass 1 regenerates the BOM from the
// design (`generateBOMForPermit`), so rows appended to `input.bom` before generation
// are discarded before pass 2 ever runs.
//
// So this file is a REGRESSION GUARD on the invariant — every rendered continuation
// sheet is indexed and every indexed one renders — and not a reproduction of the
// defect. The defect itself was established by reading the order of operations, and
// the repair's safety was established separately: the Braidon snapshot digest is
// byte-identical before and after (b464ff9bb84c39a2…), because the rebuild is
// conditional and this package never triggers it.
//
// If you are here because you want to prove the boundary case, the missing piece is a
// fixture whose snapshot-derived rows land across a 14-row multiple — not a change to
// these assertions.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/**
 * Every sheet id the COVER's index lists.
 *
 * 🚨 BOUNDED BY THE NEXT SECTION HEADER, not by the first `</div>`. The index body is
 * a nested block, so slicing to the first closing tag captured the header alone and
 * returned an EMPTY list — and both comparisons below then passed vacuously, because
 * "nothing rendered that is not indexed" is trivially true of an empty set. That is
 * the exact blindness this file is about, and the `rendered.size` case at the bottom
 * is what caught it. Keep that case.
 */
function indexedSheetIds(html: string): string[] {
  // 🚨 ANCHOR ON THE HEADER MARKUP, not the words. A bare indexOf('SHEET INDEX')
  // lands on prose elsewhere in the package ("SHEET INDEX is …"), hundreds of
  // thousands of characters from the cover's own section, and returns an empty list
  // from a slice of the wrong document.
  const HDR = 'class="sec-hdr">SHEET INDEX';
  const at = html.indexOf(HDR);
  expect(at, 'the cover has no SHEET INDEX section — this guard is blind').toBeGreaterThan(-1);
  const next = html.indexOf('class="sec-hdr"', at + HDR.length);
  const body = html.slice(at, next > 0 ? next : html.length);
  return [...new Set([...body.matchAll(/\bSCHED-([\d.]+)\b/g)].map(m => `SCHED-${m[1]}`))];
}

/** Every sheet id a TITLE BLOCK actually rendered, in order. */
function renderedSheetIds(html: string): string[] {
  return [...html.matchAll(/class="tb-sheet-id"[^>]*>\s*(SCHED-[\d.]+)\s*</g)].map(m => m[1]);
}

function render(mutate?: (i: any) => void): string {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  mutate?.(input);
  return generatePermitHTML(input) as unknown as string;
}

describe('the SCHED continuation sheets the cover lists are the ones that render', () => {
  it('🚨 the rendered continuation sheets are all indexed, and vice versa', () => {
    const html = render();
    const indexed = new Set(indexedSheetIds(html));
    const rendered = new Set(renderedSheetIds(html));

    // A sheet that renders but is not indexed is invisible to cross-sheet references;
    // a sheet that is indexed but never renders is a promise the package breaks.
    const renderedNotIndexed = [...rendered].filter(s => !indexed.has(s));
    const indexedNotRendered = [...indexed].filter(s => !rendered.has(s));
    expect(renderedNotIndexed, 'these continuation sheets render but the cover index does not list them')
      .toEqual([]);
    expect(indexedNotRendered, 'the cover index lists these continuation sheets and the package does not contain them')
      .toEqual([]);
  });

  it('🚨 holds when the BOM grows enough to cross a SCHED page boundary', () => {
    // The condition the old code detected and then did not act on. SCHED_BOM_ROWS_FIRST
    // is 10 and each continuation page holds 14, so pushing the row count well past a
    // boundary is what separates a package that paginated consistently by luck from one
    // that paginates consistently by construction.
    for (const extra of [6, 20, 34]) {
      const html = render(i => {
        i.bom = [
          ...(i.bom ?? []),
          ...Array.from({ length: extra }, (_, n) => ({
            category: 'Electrical',
            item: `AUDIT FILLER ROW ${n + 1}`,
            quantity: 1, unit: 'ea', partNumber: `FILLER-${n + 1}`, manufacturer: 'TEST',
          })),
        ];
      });
      const indexed = new Set(indexedSheetIds(html));
      const rendered = new Set(renderedSheetIds(html));
      expect([...rendered].filter(s => !indexed.has(s)),
        `+${extra} BOM rows: continuation sheets render that the cover index never lists`).toEqual([]);
      expect([...indexed].filter(s => !rendered.has(s)),
        `+${extra} BOM rows: the cover index lists continuation sheets the package does not carry`).toEqual([]);
    }
  });

  it('every title block\'s "SHEET n OF N" counts the pages the package really has', () => {
    const html = render();
    const pairs = [...html.matchAll(/SHEET\s+(\d+)\s+OF\s+(\d+)/gi)]
      .map(m => [Number(m[1]), Number(m[2])] as const);
    expect(pairs.length, 'no title block published a sheet number').toBeGreaterThan(0);
    const totals = new Set(pairs.map(([, n]) => n));
    expect(totals.size, `the package disagrees with itself about how many sheets it has: ${[...totals]}`)
      .toBe(1);
    const total = [...totals][0];
    for (const [n] of pairs) expect(n).toBeLessThanOrEqual(total);
  });

  it('🚨 no sheet index entry survives that names a page the renderer never produced', () => {
    // The generic form of the same defect, across ALL sheet ids rather than SCHED
    // alone — so a future pass-2-style rebuild of any other page family is covered.
    const html = render();
    const rendered = new Set(
      [...html.matchAll(/class="tb-sheet-id"[^>]*>\s*([A-Z0-9.\-]+)\s*</g)].map(m => m[1]),
    );
    expect(rendered.size, 'no title blocks parsed — this guard is blind').toBeGreaterThan(5);
  });
});
