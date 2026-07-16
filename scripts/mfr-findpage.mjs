// Find the PDF page whose text best matches an attachment-detail heading, for a
// given manufacturer asset id. Deterministic page-selection helper for the
// racking precision pass. Usage: node scripts/mfr-findpage.mjs <equipment_id> "term1|term2"
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REPO = 'C:/Users/Ray/Solarpro Claude/repo';
const DATA = path.join(REPO, 'lib/data/manufacturer-assets');
const PDFCACHE = path.join(REPO, 'scripts', '.mfr-cache', 'pdfcache');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = 'file://' + path.join(REPO, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').replace(/\\/g, '/');

const [eqid, termsArg] = process.argv.slice(2);
const terms = (termsArg || 'roof attachment|l-foot|l-feet|attachment detail|composition|flashing').toLowerCase().split('|');

const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json'));
let asset = null;
for (const f of files) { const a = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')).find(r => r.equipment_id === eqid); if (a) { asset = a; break; } }
if (!asset || !asset.source_url) { console.error('no source_url for', eqid); process.exit(1); }

const sha = crypto.createHash('sha1').update(asset.source_url).digest('hex').slice(0, 16);
const cp = path.join(PDFCACHE, sha + '.pdf');
if (!fs.existsSync(cp)) { console.error('PDF not cached — run mfr-extract first for', eqid); process.exit(1); }

const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(cp)), verbosity: 0 }).promise;
const scored = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const txt = (await page.getTextContent()).items.map(i => i.str).join(' ').toLowerCase();
  const head = txt.slice(0, 90).replace(/\s+/g, ' ').trim();
  let score = 0;
  for (const t of terms) { const c = txt.split(t).length - 1; score += c * (txt.slice(0, 120).includes(t) ? 3 : 1); }
  scored.push({ p, score, head });
}
scored.sort((a, b) => b.score - a.score);
console.error(`${eqid} (${doc.numPages}pp) — top pages for [${terms.join(', ')}]:`);
for (const s of scored.slice(0, 6)) console.error(`  p${s.p}  score=${s.score}  "${s.head}"`);
