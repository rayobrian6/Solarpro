// ═══════════════════════════════════════════════════════════════════════════
// W9 (RP-D) — PAGE COMPOSITION & PAGINATION.
//
// Every logical sheet fits ONE 17x11 physical page (or is a formally numbered
// continuation sheet). No browser-overflow unnumbered pages. Two layers:
//   • a cheap STATIC check that ALWAYS runs (physical .page count == manifest
//     count, every page has a title block, the @page geometry is fixed, PV-4C
//     uses the grouped/compact reaction schedule);
//   • a Chromium (Playwright) render check that measures per-.page overflow and
//     SKIPS GRACEFULLY when playwright/chromium is unavailable.
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
  // (`page sld-page`, `page cad-appendix-preview-page`) — but NEVER `page-body`
  // / `page-content` (those follow with `-`). Match the page-start only.
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
    // cheap CSS/height static guard — the fixed page box that pagination relies on.
    expect(html).toMatch(/\.page\s*\{[^}]*width:\s*17in/);
    expect(html).toMatch(/\.page\s*\{[^}]*height:\s*11in/);
    expect(html).toMatch(/\.page\s*\{[^}]*overflow:\s*hidden/);
  });

  it('PV-4C uses the grouped/compact reaction schedule (no 40-row overflow)', () => {
    expect(html).toContain('Grouped by Load Case');
  });
});

describe('W9 Chromium — no logical sheet overflows its physical page', () => {
  it('each .page renders within the 11in box (Playwright; skips if unavailable)', async (ctx) => {
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
      // browser binary not installed in this environment
      ctx.skip();
      return;
    }
    try {
      const { html, snap } = render();
      const page = await browser.newPage({ viewport: { width: 1700, height: 1120 }, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      const report = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.page')) as HTMLElement[];
        return pages.map((p, i) => ({
          index: i,
          scrollH: p.scrollHeight,
          clientH: p.clientHeight,
          hasTitleBlock: !!p.querySelector('.title-block'),
        }));
      });

      // physical page count agrees with the manifest
      expect(report.length).toBe(snap.projectAuthority.sheetIndex.length);

      const TOL = 6; // px — sub-pixel rounding
      const overflowing = report.filter(r => r.scrollH > r.clientH + TOL);
      const missingTb = report.filter(r => !r.hasTitleBlock);
      const labels = overflowing.map(r => `${snap.projectAuthority.sheetIndex[r.index]?.id ?? r.index}: ${r.scrollH}>${r.clientH}`);
      expect(overflowing, `overflowing sheets: ${labels.join(', ')}`).toEqual([]);
      expect(missingTb.map(r => r.index)).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120000);
});
