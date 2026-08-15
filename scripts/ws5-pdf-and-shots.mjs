// ═══════════════════════════════════════════════════════════════════════════
// ws5-pdf-and-shots.mjs — AUTHORITATIVE Chromium PDFs + per-sheet screenshots.
//
// Renders a planset HTML at the exact 17×11in envelope under PRINT media (the
// only media the page-fit ruler and the sheets themselves are laid out for; a
// screen-media capture measures a different machine — see the post-sync repair
// report) and writes:
//   • <base>.pdf                 — the authoritative package
//   • <base>_shots/<n>_<id>.png  — one screenshot per logical sheet
//
//   Usage: node scripts/ws5-pdf-and-shots.mjs <planset.html> <outBase> [sheetFilter]
//
// Exits NON-ZERO on any failure. Skips (exit 0 with a notice) when
// playwright/chromium is unavailable, so it is safe in browserless environments
// — and says so out loud rather than silently succeeding.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const [htmlPath, outBase, sheetFilter] = process.argv.slice(2);
if (!htmlPath || !outBase) {
  console.error('usage: ws5-pdf-and-shots.mjs <planset.html> <outBase> [sheetFilter]');
  process.exit(1);
}

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.log('[ws5-pdf] playwright unavailable — SKIPPED (no PDF, no shots)'); process.exit(0); }

const abs = resolve(htmlPath);
if (!existsSync(abs)) { console.error(`[ws5-pdf] not found: ${abs}`); process.exit(1); }

const shotsDir = `${outBase}_shots`;
mkdirSync(dirname(resolve(outBase)), { recursive: true });
mkdirSync(shotsDir, { recursive: true });

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  console.log(`[ws5-pdf] chromium could not launch (${e.message}) — SKIPPED`);
  process.exit(0);
}

const page = await browser.newPage({ viewport: { width: 1632, height: 1056 } });
await page.goto(pathToFileURL(abs).href, { waitUntil: 'networkidle' });

// PRINT MEDIA. The sheets are laid out for print; measuring or capturing under
// screen media reports the browser, not the drawing.
await page.emulateMedia({ media: 'print' });

const pdfPath = `${outBase}.pdf`;
await page.pdf({
  path: pdfPath,
  width: '17in',
  height: '11in',
  printBackground: true,
  preferCSSPageSize: false,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});
console.log(`[ws5-pdf] wrote ${pdfPath}`);

const sheets = await page.$$eval('#sp-sheets > .page, .page', els =>
  els.map((el, i) => ({
    i,
    id: (el.querySelector('.tb-sheet-id')?.textContent ?? `sheet-${i}`).trim(),
  })));
console.log(`[ws5-pdf] ${sheets.length} sheet(s) detected`);

let shot = 0;
for (const s of sheets) {
  if (sheetFilter && !new RegExp(sheetFilter, 'i').test(s.id)) continue;
  const handle = (await page.$$('#sp-sheets > .page, .page'))[s.i];
  if (!handle) continue;
  const safe = s.id.replace(/[^A-Za-z0-9._-]/g, '_');
  const out = `${shotsDir}/${String(s.i).padStart(2, '0')}_${safe}.png`;
  await handle.screenshot({ path: out });
  shot++;
}
console.log(`[ws5-pdf] wrote ${shot} sheet screenshot(s) to ${shotsDir}/`);

await browser.close();
