// PDF -> PNG page extraction for the manufacturer asset library.
// Fetches each verified source PDF (browser UA), renders the target detail/cut-sheet
// page with pdfjs-dist + @napi-rs/canvas, trims + optimizes with sharp, writes to
// repo public/manufacturer-assets/<id>.png. Pure Node, no system deps.
//
// Usage: node extract.mjs [--limit N] [--only id1,id2] [--filecat modules.json]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';

const REPO = 'C:/Users/Ray/Solarpro Claude/repo';
const DATA = path.join(REPO, 'lib/data/manufacturer-assets');
const OUT  = path.join(REPO, 'public/manufacturer-assets');
const CACHE = path.join(REPO, 'scripts', '.mfr-cache');
const PDFCACHE = path.join(CACHE, 'pdfcache');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PDFCACHE, { recursive: true });

const args = process.argv.slice(2);
const getArg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i+1] : null; };
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : Infinity;
const ONLY = getArg('--only') ? new Set(getArg('--only').split(',')) : null;
const FILECAT = getArg('--filecat');

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = 'file://' + path.join(REPO, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').replace(/\\/g,'/');
const STD_FONTS = 'file://' + path.join(REPO, 'node_modules/pdfjs-dist/standard_fonts/').replace(/\\/g,'/');

class NodeCanvasFactory {
  create(w, h) { const canvas = createCanvas(Math.ceil(w), Math.ceil(h)); return { canvas, context: canvas.getContext('2d') }; }
  reset(cc, w, h) { cc.canvas.width = Math.ceil(w); cc.canvas.height = Math.ceil(h); }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const PAGE_OVERRIDE = getArg('--page') ? parseInt(getArg('--page')) : null;
function parsePage(pageRef) {
  if (!pageRef) return 1;
  const m = String(pageRef).match(/\d+/);
  return m ? Math.max(1, parseInt(m[0])) : 1;
}
// Precedence: CLI --page > manifest render_page (curated exact page) > parsed page_ref.
function targetPage(a) {
  if (PAGE_OVERRIDE) return PAGE_OVERRIDE;
  if (a.render_page) return Math.max(1, parseInt(a.render_page));
  return parsePage(a.page_ref);
}

async function fetchPdf(url) {
  const sha = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const cp = path.join(PDFCACHE, sha + '.pdf');
  if (fs.existsSync(cp) && fs.statSync(cp).size > 1000) return fs.readFileSync(cp);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/pdf,*/*', 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!ct.includes('pdf') && buf.slice(0, 5).toString() !== '%PDF-') throw new Error(`not-pdf (ct=${ct}, head=${buf.slice(0,8).toString('hex')})`);
    fs.writeFileSync(cp, buf);
    return buf;
  } finally { clearTimeout(to); }
}

async function renderPage(buf, pageNum, scale = 2.0) {
  const canvasFactory = new NodeCanvasFactory();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), canvasFactory,
    standardFontDataUrl: STD_FONTS, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const p = Math.min(pageNum, doc.numPages);
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale });
  const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: context, viewport, canvasFactory }).promise;
  const png = canvas.toBuffer('image/png');
  await doc.destroy();
  return { png, actualPage: p, numPages: doc.numPages };
}

// Collect assets
const FILES = FILECAT ? [FILECAT] : ['roof_racking.json','ground_racking.json','modules.json','string_inverters.json','microinverters.json','batteries.json'];
let assets = [];
for (const f of FILES) {
  const arr = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  for (const r of arr) assets.push({ ...r, _file: f });
}
assets = assets.filter(a => a.source_url && /^https?:\/\//.test(a.source_url));
if (ONLY) assets = assets.filter(a => ONLY.has(a.equipment_id));

const results = [];
let done = 0;
for (const a of assets) {
  if (done >= LIMIT) break;
  done++;
  const id = `${a.category}:${a.equipment_id}`.toLowerCase().replace(/[^a-z0-9:_-]+/g,'-');
  const fname = id.replace(/:/g,'_') + '.png';
  const outPath = path.join(OUT, fname);
  const pageNum = targetPage(a);
  try {
    const buf = await fetchPdf(a.source_url);
    const { png, actualPage, numPages } = await renderPage(buf, pageNum);
    // trim whitespace + cap width for reasonable file size
    await sharp(png).trim({ threshold: 12 }).resize({ width: 1400, withoutEnlargement: true })
      .png({ palette: true, quality: 82, compressionLevel: 9 }).toFile(outPath);
    const kb = Math.round(fs.statSync(outPath).size/1024);
    results.push({ id: a.equipment_id, ok: true, page: actualPage, numPages, file: `/manufacturer-assets/${fname}`, kb });
    console.error(`OK   ${a.equipment_id.padEnd(28)} p${actualPage}/${numPages} ${kb}KB`);
  } catch (e) {
    results.push({ id: a.equipment_id, ok: false, err: String(e.message||e).slice(0,80), url: a.source_url });
    console.error(`FAIL ${a.equipment_id.padEnd(28)} ${String(e.message||e).slice(0,70)}`);
  }
}

fs.writeFileSync(path.join(CACHE, 'extract_results.json'), JSON.stringify(results, null, 2));
const ok = results.filter(r=>r.ok).length;
console.error(`\n=== ${ok}/${results.length} extracted -> ${OUT} ===`);
