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
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  PROBE_VIEWPORT, DEVICE_SCALE_FACTOR, INTERNAL_TOL_PX, CLIP_TOL_IN,
  preparePrintPage, readEnvelope, measurePages, formatFailure, detectFontAvailability,
} from '../../scripts/lib/pagination-probe.mjs';

/** Deterministic test-output root — the exact HTML measured and a screenshot of
 *  every failing sheet land here, so a reported overflow is always reproducible
 *  from the same bytes rather than from a number in a log. */
const OUT_DIR = path.resolve(__dirname, '../../test-output/pagination-w9');

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function render(profile?: 'permit' | 'full'): { html: string; snap: PermitDesignSnapshot } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  // AAC WS-10 — the page-fit contract is PROFILE-AWARE: the FULL internal
  // package and the compact PERMIT submittal must BOTH fit. Default (no
  // argument) stays the full profile, so every pre-WS-10 assertion below is
  // unchanged.
  if (profile) input.plansetProfile = profile;
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

// ── §18 (gate 18) — RS-1 legibility + every blocker preserved ───────────────
describe('§18 — RS-1 prints every active blocker at the enlarged (≥6.5pt) size', () => {
  const { html, snap } = render();
  const registry = (snap.permitReadiness?.registry ?? []).filter((r: any) => !r.resolved);

  it('the review-status registry has blockers to show (fixture sanity)', () => {
    expect(registry.length).toBeGreaterThan(10);
  });

  it('core RS-1 blocker text is enlarged to an effective >=6.5pt (8.7px)', () => {
    // was 6–6.5px (≈4.9pt) — below the readable floor for a permit reviewer.
    expect(html).toContain('font-size:8.7px');
  });

  it('EVERY active registry blocker code is present on the rendered set (none abbreviated away)', () => {
    for (const b of registry) {
      expect(html, `blocker ${b.code} missing from RS-1`).toContain(b.code);
      // its resolution action / authority path is preserved verbatim (not
      // truncated). RS-1 HTML-escapes the cell, so the comparison escapes too —
      // otherwise a resolution containing a quote (QCABLE-PROCUREMENT-
      // INSUFFICIENT: '"Jumpers required" … does NOT clear this') can never
      // match its own rendered form.
      const escaped = (s: string): string => s
        .replace(/&(?![a-zA-Z0-9#]+;)/g, '&amp;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      if (b.resolutionAction) {
        expect(html, `blocker ${b.code} resolution truncated`).toContain(escaped(b.resolutionAction));
      }
    }
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
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const browserVersion = `chromium ${browser.version()}`;
    try {
      // WS-10: both profiles are measured in the same browser session.
      for (const profile of ['full', 'permit'] as const) {
      const { html, snap } = render(profile);

      // The measured bytes are WRITTEN FIRST and loaded over file:// — the test
      // reports an artifact path + SHA-256 that can be reopened and re-measured
      // by hand, instead of an in-memory string nobody can retrieve.
      const artifactPath = path.join(OUT_DIR, `pagination-w9.${profile}.html`);
      fs.writeFileSync(artifactPath, html, 'utf8');
      const artifactSha256 = crypto.createHash('sha256').update(html, 'utf8').digest('hex');
      const snapshotId = (snap as { meta?: { snapshotId?: string } }).meta?.snapshotId
        ?? (html.match(/PDS-[A-F0-9]{12}/) ?? ['(no snapshot id in artifact)'])[0];

      const page = await browser.newPage({ viewport: PROBE_VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR });
      await page.goto(pathToFileURL(artifactPath).href, { waitUntil: 'load' });
      // every embedded resource settled (the package inlines its assets as
      // data: URIs, so this is the true "all resources" barrier)
      await page.waitForLoadState('networkidle').catch(() => {});
      const env = await preparePrintPage(page);
      const envelope = await readEnvelope(page);

      const probeCtx = {
        artifactPath, artifactSha256, snapshotId, profile,
        sheetCount: envelope.pageCount, env, envelope, browserVersion,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
        savedHtmlPath: artifactPath,
      };
      const envMsg = `[${profile}] ${artifactPath} sha=${artifactSha256.slice(0, 16)} ${browserVersion}`;

      // ── the measurement is only valid inside a verified print envelope ────
      expect(env.mediaPrint, `${envMsg} — print media not active`).toBe(true);
      expect(env.fontsStatus, `${envMsg} — fonts not settled`).toBe('loaded');
      expect(envelope.atPageIs17x11, `${envMsg} — @page is not 17in x 11in: ${envelope.atPageRule}`).toBe(true);
      expect(envelope.allPages17x11, `${envMsg} — .page geometry is not 1632x1056px: ${envelope.pageGeometries.join(' | ')}`).toBe(true);
      expect(envelope.toolbarHidden, `${envMsg} — #sp-toolbar visible under print (display=${envelope.toolbarDisplay})`).toBe(true);
      expect(envelope.sheetsTransformNone, `${envMsg} — #sp-sheets carries a screen transform: ${envelope.sheetsTransform}`).toBe(true);

      // ── the fonts the stylesheet ASKS FOR must actually exist here ────────
      // The package embeds no @font-face. On a host without Arial / Courier New
      // the browser substitutes a metrically different face, dense text blocks
      // rewrap taller, and this scan reports a LAYOUT clip that is really a
      // MISSING FONT. Fail on the environment explicitly rather than let a
      // phantom overflow be attributed to the sheet design.
      const fonts = await detectFontAvailability(page, ['Arial', 'Courier New']);
      for (const [family, info] of Object.entries(fonts as Record<string, { available: boolean; widthPx: number; serifFallbackWidthPx: number }>)) {
        expect(info.available,
          `${envMsg} — FONT "${family}" IS NOT INSTALLED ON THIS HOST (probe width ${info.widthPx}px == serif fallback ${info.serifFallbackWidthPx}px). ` +
          `The planset embeds no @font-face and requests ${family}; a substituted face rewraps text and produces overflow numbers that describe THIS MACHINE, not the sheet. ` +
          `Install the metric-compatible fonts (or run where they exist) before treating any page-fit result as a layout defect.`,
        ).toBe(true);
      }

      const report = await measurePages(page, INTERNAL_TOL_PX);
      expect(report.length, `${envMsg} — page count`).toBe(snap.projectAuthority.sheetIndex.length);
      for (const r of report) expect(r.hasTitleBlock, `${envMsg} page ${r.pageIndex} missing title block`).toBe(true);

      // Every sheet that trips EITHER gate gets a screenshot + a fully
      // provenanced diagnostic block naming the exact offending element.
      const failing = report.filter((r: any) => r.internalWorstPx > INTERNAL_TOL_PX || r.belowByIn > CLIP_TOL_IN);
      for (const r of failing) {
        const shot = path.join(OUT_DIR, `${profile}.${String(r.pageIndex).padStart(2, '0')}.${r.sheetId.replace(/[^\w.-]/g, '_')}.png`);
        await page.locator('.page').nth(r.pageIndex).screenshot({ path: shot }).catch(() => {});
        r.screenshotPath = shot;
      }
      const diagnostics = failing.map((r: any) => formatFailure(probeCtx, r)).join('\n');

      // §19 — no MEANINGFUL sub-sheet internal clip (real content severed by a
      // nested hidden-overflow box). Tolerance is the PRE-EXISTING 2px layout
      // rounding allowance; it is never raised to make a sheet pass.
      const internalClips = failing.filter((r: any) => r.internalWorstPx > INTERNAL_TOL_PX);
      expect(internalClips.map((r: any) => `${r.sheetId} +${r.internalWorstPx}px`),
        `\n[${profile}] INTERNAL-CLIPPED SHEETS\n${diagnostics}\n`).toEqual([]);

      // A page is CLIPPED when a non-SVG element extends meaningfully past the
      // printable box. Clean full-bleed sheets sit ≤ ~0.38in below the content
      // box (the outline/title-block touching the page edge); a genuine clip
      // (an overflowing page conclusion / footer) is >1in. 0.5in cleanly
      // separates the two — the five historically-clipped sheets measured
      // 0.9–4.95in over before this pass.
      const clipped = failing.filter((r: any) => r.belowByIn > CLIP_TOL_IN);
      expect(clipped.map((r: any) => `${r.sheetId} +${r.belowByIn}in`),
        `\n[${profile}] PAGE-BOX CLIPPED SHEETS\n${diagnostics}\n`).toEqual([]);

      await page.close();
      }
    } finally {
      await browser.close();
    }
  }, 180000);
});
