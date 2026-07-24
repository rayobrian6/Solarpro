// ═══════════════════════════════════════════════════════════════════════════
// W9 (RP-D / CLOSEOUT §15/§16) — PAGE COMPOSITION, TRUE PAGE-FIT & ISSUE WORDING.
//
// Every logical sheet fits ONE 17x11 physical page (or is a formally numbered
// continuation sheet). `.page{overflow:hidden}` HIDES content without adding a
// page, so the old `pages==manifest` gate is insufficient — a page conclusion or
// footer taller than the printable box is silently clipped and the count never
// changes. Three layers:
//
//   • a cheap STATIC layer that ALWAYS runs (physical .page count == manifest,
//     one title block per page, fixed @page geometry, the formal continuation
//     sheets — PV-4C.1 / SCHED-n — carry title blocks + manifest entries, and
//     the compact reaction schedule is present);
//   • a TRUE GEOMETRY page-fit layer (Chromium): per logical sheet it compares
//     the rendered bounding box of every non-SVG descendant against the page's
//     printable box (11in minus the bottom padding). ANY element whose bottom
//     extends meaningfully past the printable box — even clipped under
//     overflow:hidden — FAILS. SVG-internal geometry (intentional aerial/detail
//     bleed on map sheets) is excluded. Skips gracefully if chromium is absent;
//   • §16 issue-wording agreement (always-on static): the cover engineering
//     summary is DERIVED from the issue-state accessor, never the hard-coded
//     "Issued for permit review" while the set is pending review.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function render(): { html: string; snap: PermitDesignSnapshot } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot };
}

const countMatches = (h: string, re: RegExp) => (h.match(re) ?? []).length;

describe('W9 static — physical pages match the manifest, one title block each', () => {
  const { html, snap } = render();
  // A physical sheet opens with `<div class="page"...>` OR a class variant
  // (`page cover-compact`, `page cert-compact`, `page sld-page`) — but NEVER
  // `page-body` / `page-content` (those follow with `-`). Match the page-start.
  const pageCount = countMatches(html, /<div class="page[ "]/g);
  const titleBlockCount = countMatches(html, /class="title-block"/g);
  const manifest = snap.projectAuthority.sheetIndex;

  it('every physical .page carries exactly one title block', () => {
    expect(pageCount).toBeGreaterThan(0);
    expect(titleBlockCount).toBe(pageCount);
  });

  it('physical page count == manifest (sheet-index) count', () => {
    expect(pageCount).toBe(manifest.length);
  });

  it('RS-1 review-status sheet is a formal manifest entry', () => {
    expect(manifest.map(s => s.id)).toContain('RS-1');
  });

  it('the @page/.page geometry is the fixed 17x11 envelope with clipped overflow', () => {
    expect(html).toMatch(/\.page\s*\{[^}]*width:\s*17in/);
    expect(html).toMatch(/\.page\s*\{[^}]*height:\s*11in/);
    expect(html).toMatch(/\.page\s*\{[^}]*overflow:\s*hidden/);
  });

  it('PV-4C uses the grouped/compact reaction schedule (no 40-row overflow)', () => {
    expect(html).toContain('Grouped by Load Case');
  });

  // ── §15 formal continuations: each carries a title block AND a manifest entry
  //    (so page count can never silently disagree with the sheet index). ──
  it('PV-4C.1 roof-structural continuation is a formal titled manifest sheet', () => {
    const ids = manifest.map(s => s.id);
    expect(ids).toContain('PV-4C.1');
    // it follows PV-4C directly and precedes the electrical section (E-1)
    expect(ids.indexOf('PV-4C.1')).toBe(ids.indexOf('PV-4C') + 1);
    expect(ids.indexOf('PV-4C.1')).toBeLessThan(ids.indexOf('E-1'));
    // the continuation renders its own PV-4C.1 title block on a physical page
    expect(html).toContain('PV-4C.1');
    expect(html).toContain('STRUCTURAL CALCULATIONS (CONT.)');
  });

  it('long BOMs paginate onto capped SCHED continuation sheets (SCHED-2 …)', () => {
    const ids = manifest.map(s => s.id);
    // this fixture BOM (46 line items) spills onto two continuation sheets
    expect(ids).toContain('SCHED-2');
    expect(ids).toContain('SCHED-3');
    // continuation ids are contiguous right after SCHED
    expect(ids.indexOf('SCHED-2')).toBe(ids.indexOf('SCHED') + 1);
    expect(ids.indexOf('SCHED-3')).toBe(ids.indexOf('SCHED-2') + 1);
  });
});

describe('W9 §16 — issue wording is derived, never a hard-coded "Issued for permit review"', () => {
  const { html, snap } = render();
  // the snapshot stores the derived state as projectAuthority.issueState; the
  // renderer projects it to pa.issueStatus (same value, projection alias).
  const issue = (snap.projectAuthority as { issueState?: string }).issueState ?? 'DESIGN DRAFT';

  it('the pending set does NOT print "Issued for permit review" on the cover', () => {
    // Braidon is PENDING ENGINEERING REVIEW — the permit-issue sentence must not
    // appear anywhere in the package while the derived state is not ISSUED.
    expect(issue).not.toBe('ISSUED FOR PERMIT');
    expect(html).not.toContain('Issued for permit review');
  });

  it('the cover engineering summary states the honest design-review disposition', () => {
    expect(html).toContain('DESIGN REVIEW PACKAGE — NOT FOR PERMIT SUBMISSION');
    // and it carries the DERIVED issue-state string (single source of truth)
    expect(html).toContain(issue);
  });
});

// ── TRUE GEOMETRY PAGE-FIT VALIDATOR (Chromium) ─────────────────────────────
// The definitive check: rendered element geometry vs the printable box. Any
// non-SVG element extending past the printable bottom — even clipped under
// overflow:hidden — is a failure. Mirrors scripts/planset-pagefit.mjs.
describe('W9 Chromium — no logical sheet clips content past the printable box', () => {
  it('every .page fits within the 11in printable box (Playwright; skips if unavailable)', async (ctx) => {
    let chromium: typeof import('playwright').chromium | undefined;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      ctx.skip();
      return;
    }
    let browser: import('playwright').Browser | undefined;
    try {
      browser = await chromium.launch();
    } catch {
      ctx.skip();
      return;
    }
    try {
      const { html, snap } = render();
      const page = await browser.newPage({ viewport: { width: 1700, height: 1120 }, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      const report = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.page')) as HTMLElement[];
        return pages.map((pg, i) => {
          const cs = getComputedStyle(pg);
          const padB = parseFloat(cs.paddingBottom) || 0;
          const pr = pg.getBoundingClientRect();
          const contentBottom = pg.clientHeight - padB; // px, inside the padding box
          // lowest non-SVG descendant bottom, relative to the page top
          let maxBottom = 0;
          let worst = '';
          pg.querySelectorAll('*').forEach(el => {
            // intentional aerial/detail SVG bleed is not content clipping
            if (el.closest('svg') || el.tagName.toLowerCase() === 'svg') return;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            const relBottom = r.bottom - pr.top;
            if (relBottom > maxBottom) {
              maxBottom = relBottom;
              worst = (el.className || el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 44);
            }
          });
          const belowByIn = (maxBottom - contentBottom) / 96;
          return { i, belowByIn: +belowByIn.toFixed(3), worst, hasTitleBlock: !!pg.querySelector('.title-block') };
        });
      });

      // physical page count agrees with the manifest
      expect(report.length).toBe(snap.projectAuthority.sheetIndex.length);
      for (const r of report) expect(r.hasTitleBlock, `page ${r.i} missing title block`).toBe(true);

      // A page is CLIPPED when a non-SVG element extends meaningfully past the
      // printable box. Clean full-bleed sheets sit ≤ ~0.38in below the content
      // box (the outline/title-block touching the page edge); a genuine clip
      // (an overflowing page conclusion / footer) is >1in. 0.5in cleanly
      // separates the two — the five historically-clipped sheets measured
      // 0.9–4.95in over before this pass.
      const CLIP_TOL_IN = 0.5;
      const clipped = report
        .map(r => ({ ...r, id: snap.projectAuthority.sheetIndex[r.i]?.id ?? String(r.i) }))
        .filter(r => r.belowByIn > CLIP_TOL_IN);
      const detail = clipped.map(r => `${r.id}: +${r.belowByIn}in [${r.worst}]`).join('  |  ');
      expect(clipped, `clipped sheets: ${detail}`).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120000);
});
