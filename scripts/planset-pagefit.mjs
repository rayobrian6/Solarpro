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

const report = await page.evaluate(() => {
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
    const m = (pg.textContent || '').match(/\b(PV-0|RS-1|PV-1B|PV-1|PV-3|PV-4C\.1|PV-4C|E-1|PV-4A|PV-4B|PV-5|PV-6|SCHED-\d|SCHED|APP-A|DS-\d|CERT|PE-1)\b/);
    return { i, sid: m ? m[1] : ('sheet' + i), belowByIn: +((maxBottom - contentBottom) / 96).toFixed(2), worst, hasTb: !!pg.querySelector('.title-block') };
  });
});

let clipped = 0, noTb = 0;
for (const r of report) {
  if (pngDir) {
    const el = (await page.$$('.page'))[r.i];
    await el.screenshot({ path: path.join(pngDir, String(r.i).padStart(2, '0') + '_' + r.sid.replace(/[^A-Za-z0-9.]/g, '') + '.png') });
  }
  const clip = r.belowByIn > CLIP_TOL_IN;
  if (clip) clipped++;
  if (!r.hasTb) noTb++;
  console.log(
    String(r.i).padStart(2), r.sid.padEnd(9),
    'belowBy=' + String(r.belowByIn).padStart(6) + 'in',
    clip ? 'CLIP' : '    ', r.hasTb ? '' : 'NO-TITLE-BLOCK',
    clip ? '| ' + r.worst : '');
}
console.log(`\n[pagefit] sheets=${report.length} clipped=${clipped} missing-title-block=${noTb}`);
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({
    generatedAt: new Date().toISOString(),
    artifact: 'braidon-page-fit-report',
    method: 'Playwright 17×11 (96dpi); per logical sheet, lowest NON-SVG descendant vs printable box (page height − bottom padding); SVG bleed excluded',
    tolInches: CLIP_TOL_IN,
    sheets: report.length, clipped, missingTitleBlock: noTb,
    perSheet: report.map(r => ({ index: r.i, sheetId: r.sid, belowByIn: r.belowByIn, clipped: r.belowByIn > CLIP_TOL_IN, hasTitleBlock: r.hasTb, worstElement: r.worst || null })),
  }, null, 2));
  console.log('[pagefit] wrote', jsonOut);
}
await browser.close();
process.exit(clipped > 0 || noTb > 0 ? 1 : 0);
