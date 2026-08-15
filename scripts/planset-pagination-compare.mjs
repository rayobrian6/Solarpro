// ═══════════════════════════════════════════════════════════════════════════
// planset-pagination-compare.mjs — measure TWO artifacts with ONE ruler.
//
// Answers the only question a bare overflow number cannot: is a reported clip a
// property of the ARTIFACT, or of the measurement? It runs the identical probe
// (scripts/lib/pagination-probe.mjs — the same module the W9 suite gate uses)
// against two permit HTML files under a verified print envelope, and reports
// hash, snapshot, sheet count, per-sheet overflow and the per-sheet text delta.
//
//   node scripts/planset-pagination-compare.mjs <A.html> <B.html> [--sheets PV-0,PV-4B,SCHED]
//
// Reading the result:
//   A passes, B fails  → the rendering code regressed.
//   both pass          → the pagination TEST or its fixture is defective.
//   both fail          → a real layout defect; repair the source.
// Exits non-zero if either artifact clips.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  PROBE_VIEWPORT, DEVICE_SCALE_FACTOR, INTERNAL_TOL_PX, CLIP_TOL_IN,
  preparePrintPage, readEnvelope, measurePages, formatFailure,
} from './lib/pagination-probe.mjs';

const argv = process.argv.slice(2);
const files = argv.filter(a => !a.startsWith('--'));
if (files.length < 2) {
  console.error('usage: node scripts/planset-pagination-compare.mjs <A.html> <B.html> [--sheets PV-0,PV-4B,SCHED]');
  process.exit(2);
}
const sIdx = argv.indexOf('--sheets');
const FOCUS = sIdx > -1 ? argv[sIdx + 1].split(',').map(s => s.trim()) : ['PV-0', 'PV-4B', 'SCHED'];

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.warn('[compare] playwright not installed — skipping (exit 0).'); process.exit(0); }
let browser;
try { browser = await chromium.launch(); }
catch { console.warn('[compare] chromium binary unavailable — skipping (exit 0).'); process.exit(0); }
const browserVersion = `chromium ${browser.version()}`;

/** Measure one artifact end-to-end and return its full record. */
async function measureArtifact(file) {
  const abs = path.resolve(file);
  const bytes = fs.readFileSync(abs);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const text = bytes.toString('utf8');
  const snapshotId = (text.match(/PDS-[A-F0-9]{12}/) ?? ['(none)'])[0];

  const page = await browser.newPage({ viewport: PROBE_VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR });
  await page.goto(pathToFileURL(abs).href, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const env = await preparePrintPage(page);
  const envelope = await readEnvelope(page);
  const report = await measurePages(page, INTERNAL_TOL_PX);

  // per-sheet normalized text, for the DOM/text delta
  const sheetText = await page.evaluate(() => {
    const SHEET_RE = /\b(PV-0|RS-1\.\d|RS-1|PV-1B|PV-1|PV-3|PV-4C\.1|PV-4C|E-1|PV-4A|PV-4B\.1|PV-4B|PV-5|PV-6|SCHED-\d|SCHED|APP-A|DS-\d|CERT|PE-1)\b/;
    const out = {};
    Array.from(document.querySelectorAll('.page')).forEach((pg, i) => {
      const m = (pg.textContent || '').match(SHEET_RE);
      const id = m ? m[1] : `sheet${i}`;
      if (!(id in out)) out[id] = {
        text: (pg.textContent || '').replace(/\s+/g, ' ').trim(),
        elementCount: pg.querySelectorAll('*').length,
      };
    });
    return out;
  });
  await page.close();

  const ctx = {
    artifactPath: abs, artifactSha256: sha256, snapshotId, profile: '(as-rendered)',
    sheetCount: envelope.pageCount, env, envelope, browserVersion,
    deviceScaleFactor: DEVICE_SCALE_FACTOR, savedHtmlPath: abs,
  };
  return { abs, sha256, snapshotId, env, envelope, report, sheetText, ctx };
}

const results = [];
for (const f of files) results.push(await measureArtifact(f));
await browser.close();

const LABEL = ['A', 'B', 'C', 'D'];
let failed = false;

console.log('═'.repeat(78));
console.log('PAGINATION COMPARISON — one probe, verified print envelope');
console.log('═'.repeat(78));
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  console.log(`\nArtifact ${LABEL[i]}`);
  console.log(`  path            : ${r.abs}`);
  console.log(`  sha256          : ${r.sha256}`);
  console.log(`  snapshot        : ${r.snapshotId}`);
  console.log(`  sheet count     : ${r.envelope.pageCount}`);
  console.log(`  @page           : ${r.envelope.atPageRule} (17x11=${r.envelope.atPageIs17x11})`);
  console.log(`  .page geometry  : ${r.envelope.pageGeometries.join(' | ')} (all 17x11=${r.envelope.allPages17x11})`);
  console.log(`  toolbar hidden  : ${r.envelope.toolbarHidden} (display=${r.envelope.toolbarDisplay})`);
  console.log(`  #sp-sheets xform: ${r.envelope.sheetsTransform} (none=${r.envelope.sheetsTransformNone})`);
  console.log(`  media           : print=${r.env.mediaPrint} screen=${r.env.mediaScreen}`);
  console.log(`  fonts.status    : ${r.env.fontsStatus} (${r.env.fontsSize} faces)`);
  console.log(`  viewport / dsf  : ${PROBE_VIEWPORT.width}x${PROBE_VIEWPORT.height} / ${DEVICE_SCALE_FACTOR} (dpr=${r.env.dpr})`);
  console.log(`  browser         : ${browserVersion}`);

  const bad = r.report.filter(x => x.internalWorstPx > INTERNAL_TOL_PX || x.belowByIn > CLIP_TOL_IN);
  console.log(`  VERDICT         : ${bad.length === 0 ? 'CLEAN — no sheet clips' : `${bad.length} CLIPPED SHEET(S)`}`);
  if (bad.length) {
    failed = true;
    for (const rec of bad) console.log(formatFailure(r.ctx, rec));
  }
}

// ── per-sheet overflow table, side by side ─────────────────────────────────
console.log(`\n${'─'.repeat(78)}`);
console.log('PER-SHEET OVERFLOW (px internal / in page-box)');
console.log('─'.repeat(78));
const allIds = [...new Set(results.flatMap(r => r.report.map(x => x.sheetId)))];
const cell = (r, id) => {
  const rec = r.report.find(x => x.sheetId === id);
  return rec ? `${String(rec.internalWorstPx).padStart(7)}px ${String(rec.belowByIn).padStart(7)}in` : '        —         ';
};
console.log('sheet'.padEnd(10) + results.map((_, i) => `artifact ${LABEL[i]}`.padEnd(20)).join(''));
for (const id of allIds) {
  console.log(id.padEnd(10) + results.map(r => cell(r, id).padEnd(20)).join(''));
}

// ── focused text delta ────────────────────────────────────────────────────
if (results.length >= 2) {
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`TEXT / DOM DELTA on ${FOCUS.join(', ')} (artifact A vs B)`);
  console.log('─'.repeat(78));
  const [a, b] = results;
  for (const id of FOCUS) {
    const ta = a.sheetText[id], tb = b.sheetText[id];
    if (!ta || !tb) { console.log(`${id}: present in A=${!!ta} B=${!!tb}`); continue; }
    const same = ta.text === tb.text;
    console.log(`\n${id}: text ${same ? 'IDENTICAL' : 'DIFFERS'} · elements A=${ta.elementCount} B=${tb.elementCount} · chars A=${ta.text.length} B=${tb.text.length}`);
    if (!same) {
      // first divergence point, with context
      let k = 0; while (k < ta.text.length && k < tb.text.length && ta.text[k] === tb.text[k]) k++;
      console.log(`  first divergence at char ${k}:`);
      console.log(`    A: …${JSON.stringify(ta.text.slice(Math.max(0, k - 60), k + 90))}`);
      console.log(`    B: …${JSON.stringify(tb.text.slice(Math.max(0, k - 60), k + 90))}`);
    }
  }
}

console.log(`\n${'═'.repeat(78)}`);
console.log(failed ? 'RESULT: at least one artifact CLIPS' : 'RESULT: all artifacts CLEAN');
process.exit(failed ? 1 : 0);
