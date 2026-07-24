// ═══════════════════════════════════════════════════════════════════════════
// planset-pagefit.mjs — TRUE geometry-based page-fit gate (CLOSEOUT §15).
//
// `.page { overflow:hidden }` hides content without adding a page, so a
// page-count gate cannot see a clipped page conclusion / footer. This harness
// renders a permit HTML at the fixed 17x11 envelope (96dpi) and, per logical
// sheet, measures the lowest NON-SVG descendant against the printable box
// (11in minus the page's bottom padding). Any element extending meaningfully
// past the box — even clipped under overflow:hidden — is a hard failure.
// SVG-internal geometry (intentional aerial/detail bleed on map sheets) is
// excluded. Exits NON-ZERO when any sheet clips.
//
//   Usage: node scripts/planset-pagefit.mjs <permit.html> [--png <outDir>]
//
// Skips (exit 0 with a notice) when playwright/chromium is unavailable so it is
// safe to wire into environments without a browser binary.
// ═══════════════════════════════════════════════════════════════════════════
import path from 'path';
import fs from 'fs';

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('usage: node scripts/planset-pagefit.mjs <permit.html> [--png <outDir>]');
  process.exit(2);
}
const pngIdx = process.argv.indexOf('--png');
const pngDir = pngIdx > -1 ? process.argv[pngIdx + 1] : null;
const jsonIdx = process.argv.indexOf('--json');
const jsonOut = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null;

const CLIP_TOL_IN = 0.5; // clean full-bleed sheets sit ≤ ~0.38in below the box

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.warn('[pagefit] playwright not installed — skipping geometry page-fit (exit 0).');
  process.exit(0);
}
let browser;
try {
  browser = await chromium.launch();
} catch {
  console.warn('[pagefit] chromium binary unavailable — skipping geometry page-fit (exit 0).');
  process.exit(0);
}

if (pngDir) fs.mkdirSync(pngDir, { recursive: true });

const page = await browser.newPage({ viewport: { width: 1632, height: 1056, deviceScaleFactor: 1 } });
const url = 'file:///' + path.resolve(htmlPath).split(path.sep).join('/');
await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(400);

// §19 (closeout 2026-07-23) — a clip is not only a PAGE-box overrun. A block
// TALLER than its OWN hidden-overflow container (a nested `overflow:hidden` /
// `clip` box) is silently truncated even though the page itself fits, and the
// sheet-level scan (lowest descendant vs page box) cannot see it. This second
// pass measures every vertical clip container by its LAYOUT metrics
// scrollHeight − clientHeight — the exact number of CSS px clipped off the
// bottom. Layout metrics are viewport/scale-invariant (unlike getBoundingClientRect,
// which the planset's fit-to-width scale transform distorts). Reports container
// id/class, its box, the deepest overflowing descendant, and the clip amount.
const INTERNAL_CLIP_TOL_PX = 2;   // < this = sub-pixel/rounding, not a real clip
const report = await page.evaluate((internalTolPx) => {
  const clipsY = (root) => {
    const cs = getComputedStyle(root);
    return cs.overflowY === 'hidden' || cs.overflowY === 'clip'
        || cs.overflow === 'hidden' || cs.overflow === 'clip';
  };
  // For a clip container, measure how much of the clipped overflow is real
  // NON-SVG CONTENT (vs an intentionally-oversized <svg> drawing cropped to a
  // viewport — the same "SVG bleed excluded" rule the page-box scan uses).
  // Scale-corrected: the planset scales to fit width, so rendered rects are
  // divided by the per-page scale to recover layout px. Returns the deepest
  // non-SVG overflow (px) and the element the clip severs.
  const nonSvgClip = (c, scale) => {
    const cr = c.getBoundingClientRect();
    const ccs = getComputedStyle(c);
    const cPadB = parseFloat(ccs.paddingBottom) || 0;
    const contentBottomLayout = c.clientTop + (c.clientHeight - cPadB);
    let over = 0, wEl = '';
    for (const el of c.querySelectorAll('*')) {
      if (el.tagName.toLowerCase() === 'svg' || el.closest('svg')) continue;
      const ecs = getComputedStyle(el);
      if (ecs.position === 'absolute' || ecs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if ((el.textContent || '').trim() === '' && r.height < 4) continue;
      const layoutBottomFromCTop = (r.bottom - cr.top) / scale;
      const ov = layoutBottomFromCTop - contentBottomLayout;
      if (ov > over) { over = ov; wEl = (el.className || el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 40); }
    }
    return { over, wEl };
  };
  const pages = [...document.querySelectorAll('.page')];
  return pages.map((pg, i) => {
    const cs = getComputedStyle(pg);
    const padB = parseFloat(cs.paddingBottom) || 0;
    const pr = pg.getBoundingClientRect();
    const contentBottom = pg.clientHeight - padB;
    let maxBottom = 0, worst = '';
    pg.querySelectorAll('*').forEach(el => {
      if (el.closest('svg') || el.tagName.toLowerCase() === 'svg') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const rel = r.bottom - pr.top;
      if (rel > maxBottom) { maxBottom = rel; worst = (el.className || el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 44); }
    });

    // ── sub-sheet internal clip scan (scale-invariant layout metrics) ──────
    const pgScale = pr.height / pg.offsetHeight;   // rendered/layout (uniform per page)
    const internal = [];
    const containers = [pg, ...pg.querySelectorAll('*')];
    for (const c of containers) {
      if (c.tagName.toLowerCase() === 'svg' || c.closest('svg')) continue;
      if (!clipsY(c)) continue;
      const clipPx = c.scrollHeight - c.clientHeight;   // total px clipped off the bottom
      if (clipPx <= internalTolPx) continue;
      // MEANINGFUL only when real (non-SVG) content is what's severed — an
      // oversized <svg> cropped to its viewport is intentional bleed, not a clip.
      const ns = nonSvgClip(c, pgScale);
      const meaningful = ns.over > internalTolPx;
      internal.push({
        container: (c.className || c.tagName).toString().slice(0, 48),
        containerBox: { scrollHeight: c.scrollHeight, clientHeight: c.clientHeight },
        element: ns.wEl,
        overflowPx: +clipPx.toFixed(1),
        contentOverflowPx: +ns.over.toFixed(1),
        axis: 'y',
        meaningful,
      });
    }
    // meaningful (real content) clips first; SVG-bleed clips are informational
    internal.sort((a, b) => (b.meaningful - a.meaningful) || (b.contentOverflowPx - a.contentOverflowPx));
    const internalTop = internal.slice(0, 6);
    // the GATE fails only on MEANINGFUL (real-content) internal clips.
    const meaningfulWorst = Math.max(0, ...internal.filter(x => x.meaningful).map(x => x.contentOverflowPx));

    const m = (pg.textContent || '').match(/\b(PV-0|RS-1\.\d|RS-1|PV-1B|PV-1|PV-3|PV-4C\.1|PV-4C|E-1|PV-4A|PV-4B|PV-5|PV-6|SCHED-\d|SCHED|APP-A|DS-\d|CERT|PE-1)\b/);
    return { i, sid: m ? m[1] : ('sheet' + i), belowByIn: +((maxBottom - contentBottom) / 96).toFixed(2), worst, hasTb: !!pg.querySelector('.title-block'),
             internalClips: internalTop, internalWorstPx: +meaningfulWorst.toFixed(1) };
  });
}, INTERNAL_CLIP_TOL_PX);

let clipped = 0, noTb = 0, internalClipped = 0;
for (const r of report) {
  if (pngDir) {
    const el = (await page.$$('.page'))[r.i];
    await el.screenshot({ path: path.join(pngDir, String(r.i).padStart(2, '0') + '_' + r.sid.replace(/[^A-Za-z0-9.]/g, '') + '.png') });
  }
  const clip = r.belowByIn > CLIP_TOL_IN;
  const iClip = r.internalWorstPx > 0;
  if (clip) clipped++;
  if (iClip) internalClipped++;
  if (!r.hasTb) noTb++;
  console.log(
    String(r.i).padStart(2), r.sid.padEnd(9),
    'belowBy=' + String(r.belowByIn).padStart(6) + 'in',
    clip ? 'CLIP' : '    ', r.hasTb ? '' : 'NO-TITLE-BLOCK',
    iClip ? 'INTERNAL-CLIP ' + r.internalWorstPx + 'px' : '',
    clip ? '| ' + r.worst : '');
  if (iClip) {
    for (const ic of r.internalClips) {
      console.log('        └─', ic.meaningful ? 'CONTENT' : 'svg-bleed', ic.axis.toUpperCase(),
        'clip=' + ic.overflowPx + 'px content=' + ic.contentOverflowPx + 'px',
        'container[' + ic.container + ']', 'scrollH=' + ic.containerBox.scrollHeight + '/clientH=' + ic.containerBox.clientHeight,
        'el[' + ic.element + ']');
    }
  }
}
console.log(`\n[pagefit] sheets=${report.length} clipped=${clipped} internal-clipped=${internalClipped} missing-title-block=${noTb}`);
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({
    generatedAt: new Date().toISOString(),
    artifact: 'braidon-page-fit-report',
    method: 'Playwright 17×11 (96dpi); per logical sheet, lowest NON-SVG descendant vs printable box (page height − bottom padding); SVG bleed excluded. §19: plus sub-sheet internal-clip scan — every hidden-overflow container vs its own descendants.',
    tolInches: CLIP_TOL_IN,
    internalClipTolPx: INTERNAL_CLIP_TOL_PX,
    sheets: report.length, clipped, internalClipped, missingTitleBlock: noTb,
    perSheet: report.map(r => ({ index: r.i, sheetId: r.sid, belowByIn: r.belowByIn, clipped: r.belowByIn > CLIP_TOL_IN, hasTitleBlock: r.hasTb, worstElement: r.worst || null,
      internalWorstPx: r.internalWorstPx, internalClips: r.internalClips })),
  }, null, 2));
  console.log('[pagefit] wrote', jsonOut);
}
await browser.close();
process.exit(clipped > 0 || noTb > 0 || internalClipped > 0 ? 1 : 0);
