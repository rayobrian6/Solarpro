// ═══════════════════════════════════════════════════════════════════════════
// rgm-grayscale-shot.mjs — the BLACK-AND-WHITE legibility artefact (gate 17).
//
//   Usage: node scripts/rgm-grayscale-shot.mjs <planset.html> <outDir>
//
// Renders every RS-1 / RS-1.n sheet and the cover with `filter: grayscale(1)`
// applied to the page, so the finding-type treatments can be judged exactly as a
// monochrome print or photocopy shows them. The harness's gate-17 signature
// check proves the treatments differ in hue-free channels; these PNGs are what a
// human looks at to confirm it.
//
// Skips (exit 0 with a notice) when playwright/chromium is unavailable.
// ═══════════════════════════════════════════════════════════════════════════
import path from 'path';
import fs from 'fs';

const [htmlPath, outDir] = process.argv.slice(2);
if (!htmlPath || !outDir) {
  console.error('usage: node scripts/rgm-grayscale-shot.mjs <permit.html> <outDir>');
  process.exit(2);
}
let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.warn('[rgm-grayscale] playwright not installed — skipping (exit 0).');
  process.exit(0);
}
let browser;
try { browser = await chromium.launch(); } catch {
  console.warn('[rgm-grayscale] chromium binary unavailable — skipping (exit 0).');
  process.exit(0);
}
fs.mkdirSync(outDir, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1632, height: 1056, deviceScaleFactor: 1 } });
await page.goto('file:///' + path.resolve(htmlPath).split(path.sep).join('/'), { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(300);
// desaturate EVERYTHING — this is the monochrome-print simulation.
await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' });
await page.waitForTimeout(120);

const sheets = await page.evaluate(() => [...document.querySelectorAll('.page')]
  .map((p, i) => ({ i, id: (p.querySelector('.tb-sheet-id')?.textContent ?? '?').trim() })));
let written = 0;
for (const s of sheets) {
  if (!/^RS-1/.test(s.id) && s.id !== 'PV-0') continue;
  const el = (await page.$$('.page'))[s.i];
  const file = path.join(outDir, `grayscale_${String(s.i).padStart(2, '0')}_${s.id.replace(/[^A-Za-z0-9.]/g, '')}.png`);
  await el.screenshot({ path: file });
  written++;
  console.log(`[rgm-grayscale] ${file}`);
}
await browser.close();
console.log(`[rgm-grayscale] ${written} grayscale sheet(s) written to ${outDir}`);
process.exit(0);
