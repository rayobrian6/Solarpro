/**
 * scripts/sld-legibility-audit.ts — THE SLD COLLISION AUDIT, as pictures and a list.
 *
 * Ray, 2026-09-26: "Biggest issue I have with the sld is the word bleed and
 * overlays. This should be cleaner to read!!" He judges a sheet by LOOKING at
 * it, so this renders every one-line he can see (tests/support/sldVariantMatrix.ts),
 * counts every label that shares ink with something it should not
 * (tests/support/sldGeometry.ts), and writes what a person or an agent needs to
 * fix them:
 *
 *   report.json   every finding, per variant, with absolute coordinates
 *   report.md     counts per class per variant, the recurring offenders grouped
 *                 by label (with where the label is written in the source), the
 *                 worst 200 findings, and the baseline object for the test
 *   <id>.svg      the renderer's output, byte for byte
 *   <id>.html     that SVG in the REAL permit faces (@font-face from
 *                 lib/permit/fonts/fontPack.ts), with a toggle that outlines
 *                 every finding — what a browser prints, not a guess
 *   <id>.png      150 dpi on the 24 × 18 in sheet (sharp; see RASTER below)
 *   index.html    a contact sheet of every variant
 *
 * Run from the repo root:
 *   npx tsx scripts/sld-legibility-audit.ts --out <dir> [--only <id-substring>] [--no-png]
 * Output defaults to <os tmpdir>/sld-legibility-audit and is refused anywhere
 * inside the repo — these are review artefacts, not source.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve, relative, isAbsolute } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { createRequire } from 'module';

import { buildSldVariantMatrix, renderSldVariant, hybridMeteringComposerPresent, type SldVariant } from '../tests/support/sldVariantMatrix';
import {
  parseSld, auditSld, countByClass, offenderKey, fmtBox, unknownGlyphs,
  COLLISION_CLASSES, COLLISION_CLASS_ORDER, PER_VARIANT_CLASSES, type Finding, type CollisionClass, type SldGeometry,
} from '../tests/support/sldGeometry';
import { fontFaceCss } from '../lib/permit/fonts/fontPack';

const REPO = resolve(__dirname, '..');

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = resolve(arg('--out') ?? join(tmpdir(), 'sld-legibility-audit'));
const ONLY = arg('--only');
const PNG = !argv.includes('--no-png');
{
  const rel = relative(REPO, OUT);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) {
    console.error(`refusing to write audit output inside the repo (${OUT}) — pass --out <dir outside ${REPO}>`);
    process.exit(2);
  }
}
mkdirSync(OUT, { recursive: true });

// The renderer narrates every anchor and every composer logs its inputs; the
// report is the output here.
const quiet = { log: console.log, info: console.info, warn: console.warn, debug: console.debug };
const say = (...a: unknown[]) => quiet.log(...a);
console.log = console.info = console.warn = console.debug = () => {};

// ── RASTER ──────────────────────────────────────────────────────────────────
// sharp/librsvg cannot load a data-URI @font-face, and an unknown family falls
// back to a MONOSPACE face there — a wrong picture. Arial and Courier New are
// the faces Liberation Sans / Mono were drawn to match advance for advance
// (lib/permit/fonts/font-pack.manifest.json), so the PNG's text lands where the
// permit's does; the .html page is the exact-face view. Density: the sheet is
// 2304 uu = 24 in at 96 uu/in, and librsvg takes px at 72 per inch, so 112.5
// renders 150 dots per printed inch.
const DENSITY = 150 * 72 / 96;
interface SharpChain { png(): SharpChain; resize(w: number): SharpChain; toBuffer(): Promise<Buffer>; toFile(p: string): Promise<unknown> }
let sharp: ((input: Buffer, opts?: { density?: number }) => SharpChain) | null = null;
if (PNG) {
  try { sharp = createRequire(join(REPO, 'package.json'))('sharp'); } catch (e) { say('sharp unavailable — no PNGs:', (e as Error).message); }
}
const rasterFaces = (svg: string) => svg
  .replace(/font-family="SolarPro Sans, SolarPro Symbols"/g, 'font-family="Arial, Segoe UI Symbol, sans-serif"')
  .replace(/font-family="SolarPro Mono, SolarPro Symbols"/g, 'font-family="Courier New, Segoe UI Symbol, monospace"')
  .replace(/SolarPro Sans/g, 'Arial').replace(/SolarPro Mono/g, 'Courier New').replace(/SolarPro Symbols/g, 'Segoe UI Symbol');

let FONT_CSS = '';
try { FONT_CSS = fontFaceCss(); } catch (e) { say('fontFaceCss() failed — HTML pages fall back to host faces:', (e as Error).message); }

// ── where a label is written ────────────────────────────────────────────────
const SOURCE_FILES = [
  'lib/sld-professional-renderer.ts', 'lib/sld-device-illustrations.ts', 'lib/sld-symbols.ts', 'lib/sld-brand-emblems.ts',
  'lib/equipment/designMetering.ts', 'lib/equipment/currentTransformers.ts', 'lib/equipment/sldCombinerFields.ts',
  'lib/equipment/integratedBos.ts', 'lib/electrical/acDisconnect.ts', 'lib/permit/utils/sldAdapter.ts',
].filter(f => existsSync(join(REPO, f)));
const SOURCES = SOURCE_FILES.map(f => ({ f, lines: readFileSync(join(REPO, f), 'utf8').split(/\r?\n/) }));
/** Best-effort file:line hints for a printed label. Tiers: the whole label as a
 *  string literal; its longest literal fragment INSIDE a string (numbers are
 *  usually interpolated, so it splits on them); that fragment anywhere in code.
 *  Comment lines never count. A hint, not a proof — read the line. */
function whereWritten(text: string): string[] {
  const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const find = (re: RegExp) => {
    const hits: string[] = [];
    for (const { f, lines } of SOURCES) {
      lines.forEach((l, i) => { if (hits.length < 4 && !/^\s*(\/\/|\*|\/\*)/.test(l) && re.test(l)) hits.push(`${f}:${i + 1}`); });
    }
    return hits;
  };
  const whole = find(new RegExp(`['"\`]${reEsc(text.trim())}['"\`]`));
  if (whole.length) return whole;
  const frags = text.split(/[0-9]+(?:\.[0-9]+)?|["'`]|\$\{[^}]*\}/).map(s => s.trim()).filter(s => (s.match(/[A-Za-z]/g) ?? []).length >= 4)
    .sort((a, b) => b.length - a.length);
  for (const frag of frags.slice(0, 3)) {
    const quoted = find(new RegExp(`['"\`][^'"\`]*${reEsc(frag)}`));
    if (quoted.length) return quoted;
  }
  for (const frag of frags.slice(0, 2)) {
    const any = find(new RegExp(reEsc(frag)));
    if (any.length) return any;
  }
  return [];
}

// ── run ─────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;
const CLASS_COLOR: Record<CollisionClass, string> = {
  TEXT_TEXT: '#d81b60', TEXT_STROKE: '#e53935', TEXT_SYMBOL: '#fb8c00', TEXT_OFFSHEET: '#8e24aa', TEXT_REPEAT: '#1e88e5',
  TEXT_CLEARANCE: '#00897b',
};
const SHORT: Record<CollisionClass, string> = {
  TEXT_TEXT: 'T×T', TEXT_STROKE: 'T×line', TEXT_SYMBOL: 'T×symbol', TEXT_OFFSHEET: 'off-sheet', TEXT_REPEAT: 'repeat',
  TEXT_CLEARANCE: 'near',
};

function overlaySvg(g: SldGeometry, findings: Finding[]): string {
  const vb = g.viewBox;
  const els = findings.map(f => {
    const c = CLASS_COLOR[f.cls];
    const b = f.textBox;
    return `<rect x="${r1(b.x0 - 1)}" y="${r1(b.y0 - 1)}" width="${r1(b.x1 - b.x0 + 2)}" height="${r1(b.y1 - b.y0 + 2)}" fill="${c}" fill-opacity="0.12" stroke="${c}" stroke-width="1"/>`
      + `<circle cx="${r1(f.at[0])}" cy="${r1(f.at[1])}" r="3" fill="none" stroke="${c}" stroke-width="1.2"/>`;
  }).join('');
  return `<svg class="overlay" xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x0} ${vb.y0} ${vb.x1 - vb.x0} ${vb.y1 - vb.y0}" preserveAspectRatio="xMidYMid meet">${els}</svg>`;
}

function variantPage(v: SldVariant, svg: string, g: SldGeometry, findings: Finding[]): string {
  const counts = countByClass(findings);
  const rows = [...findings].sort((a, b) => b.severity - a.severity).map(f =>
    `<tr><td style="color:${CLASS_COLOR[f.cls]}">${f.cls}</td><td>${esc(f.text)}</td><td>${esc(f.other.desc)}</td>`
    + `<td>${r1(f.at[0])}, ${r1(f.at[1])}</td><td>${r1(f.amount)} ${f.unit}</td><td>${esc(f.detail)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(v.id)}</title>
<style>${FONT_CSS}
body{font-family:"SolarPro Sans",Arial,sans-serif;margin:16px;background:#f4f4f4;color:#111}
.sheet{position:relative;background:#fff;box-shadow:0 1px 4px #0003;width:100%;max-width:${Math.ceil(g.width)}px}
.sheet>svg{display:block;width:100%;height:auto}
.sheet .overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none}
#ov:checked ~ .sheet .overlay{display:block}
table{border-collapse:collapse;font-size:12px;margin-top:12px;background:#fff}td,th{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top}
.k{display:inline-block;margin-right:14px}
</style></head><body>
<p><a href="index.html">← all variants</a> · <b>${esc(v.id)}</b> — ${esc(v.title)}</p>
<p>${COLLISION_CLASS_ORDER.map(k => `<span class="k" style="color:${CLASS_COLOR[k]}">${k}: <b>${counts[k]}</b></span>`).join('')}</p>
<input type="checkbox" id="ov" checked> <label for="ov">outline the findings</label>
<div class="sheet">${svg}${overlaySvg(g, findings)}</div>
<table><tr><th>class</th><th>label</th><th>collides with</th><th>at (uu)</th><th>amount</th><th>detail</th></tr>${rows}</table>
</body></html>`;
}

async function main() {
  const t0 = Date.now();
  let variants = buildSldVariantMatrix();
  if (ONLY) variants = variants.filter(v => v.id.includes(ONLY));
  const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim(); } catch { return '?'; } })();
  const dirty = (() => { try { return execSync('git status --porcelain --untracked-files=no', { cwd: REPO }).toString().trim().split('\n').filter(Boolean).length; } catch { return -1; } })();
  say(`SLD legibility audit — ${variants.length} variants → ${OUT}`);

  const results: Array<{ v: SldVariant; counts: Record<CollisionClass, number>; findings: Finding[]; texts: number; families: Record<string, number> }> = [];
  for (const v of variants) {
    let svg: string;
    try { svg = renderSldVariant(v); } catch (e) {
      say(`  ✗ ${v.id}: render threw — ${(e as Error).message}`);
      continue;
    }
    const g = parseSld(svg);
    const findings = auditSld(g, { variant: v.id });
    const counts = countByClass(findings);
    results.push({ v, counts, findings, texts: g.texts.length, families: g.fontFamilies });
    writeFileSync(join(OUT, `${v.id}.svg`), svg);
    writeFileSync(join(OUT, `${v.id}.html`), variantPage(v, svg, g, findings));
    if (sharp) {
      try {
        const buf = await sharp(Buffer.from(rasterFaces(svg)), { density: DENSITY }).png().toBuffer();
        writeFileSync(join(OUT, `${v.id}.png`), buf);
        await sharp(buf).resize(900).png().toFile(join(OUT, `${v.id}.thumb.png`));
      } catch (e) { say(`  png failed for ${v.id}: ${(e as Error).message}`); }
    }
    say(`  ${v.id.padEnd(44)} ${COLLISION_CLASS_ORDER.map(k => `${SHORT[k]} ${String(counts[k]).padStart(3)}`).join('  ')}`);
  }

  // ── totals, offenders ──
  const all = results.flatMap(r => r.findings);
  const totals = countByClass(all);
  const groups = new Map<string, { key: string; cls: CollisionClass; text: string; other: string; findings: Finding[]; variants: Set<string> }>();
  for (const f of all) {
    const key = offenderKey(f);
    let gr = groups.get(key);
    if (!gr) { gr = { key, cls: f.cls, text: f.text, other: f.other.desc, findings: [], variants: new Set() }; groups.set(key, gr); }
    gr.findings.push(f); gr.variants.add(f.variant ?? '');
  }
  const offenders = [...groups.values()].sort((a, b) => b.findings.length - a.findings.length).map(gr => ({
    cls: gr.cls, label: gr.text, hits: gr.other, count: gr.findings.length, variants: gr.variants.size,
    worst: r1(Math.max(...gr.findings.map(f => f.severity))), writtenAt: whereWritten(gr.text),
    example: { variant: gr.findings[0].variant, at: gr.findings[0].at.map(r1), textBox: fmtBox(gr.findings[0].textBox) },
  }));
  const worst = [...all].sort((a, b) => b.severity - a.severity).slice(0, 200);
  const familiesSeen: Record<string, number> = {};
  for (const r of results) for (const [k, n] of Object.entries(r.families)) familiesSeen[k] = (familiesSeen[k] ?? 0) + n;
  const baselineRows = results.map(r => `  '${r.v.id}': [${PER_VARIANT_CLASSES.map(k => r.counts[k]).join(', ')}],`);

  writeFileSync(join(OUT, 'report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), commit, trackedFilesModified: dirty,
    hybridMeteringComposerPresent: hybridMeteringComposerPresent(),
    classes: COLLISION_CLASSES, classOrder: COLLISION_CLASS_ORDER, totals,
    variants: results.map(r => ({ id: r.v.id, title: r.v.title, family: r.v.family, mode: r.v.mode, texts: r.texts, counts: r.counts,
      findings: r.findings.map(f => ({ cls: f.cls, text: f.text, textBox: f.textBox, fontSize: r1(f.fontSize), other: f.other,
        at: f.at, amount: f.amount, unit: f.unit, severity: f.severity, detail: f.detail, textOwner: f.textOwner })) })),
    offenders, fontFamilies: familiesSeen, unknownGlyphs: unknownGlyphs(),
  }, null, 1));

  const md: string[] = [];
  md.push(`# SLD legibility audit`, '',
    `${results.length} variants · commit \`${commit}\`${dirty > 0 ? ` (+${dirty} modified tracked files in the tree)` : ''} · `
    + `hybrid metering composer ${hybridMeteringComposerPresent() ? 'PRESENT (hybrid lanes carry CTs)' : 'absent (hybrid lanes bare)'} · ${new Date().toISOString()}`, '',
    '## Classes', '', '| class | tolerance | meaning |', '|---|---|---|',
    ...COLLISION_CLASS_ORDER.map(k => `| ${k} | ${COLLISION_CLASSES[k].tolerance} ${COLLISION_CLASSES[k].unit} | ${COLLISION_CLASSES[k].description} |`), '',
    '## Totals', '', `| ${COLLISION_CLASS_ORDER.join(' | ')} |`, `|${COLLISION_CLASS_ORDER.map(() => '---').join('|')}|`,
    `| ${COLLISION_CLASS_ORDER.map(k => totals[k]).join(' | ')} |`, '');
  const fontNote = Object.entries(familiesSeen).filter(([f]) => !/sans-serif|serif|monospace/.test(f));
  if (fontNote.length) {
    md.push('## Font fallback', '',
      `${fontNote.map(([f, n]) => `${n} text nodes name \`${f}\``).join('; ')} — no generic family. A page that has not `
      + 'loaded the pack (fontFaceCss(), lib/permit/fonts/fontPack.ts) prints them in the host default, which is a SERIF '
      + 'face in a browser: every box measured here is wrong on that page. The .html pages here load the pack.', '');
  }
  md.push('## Recurring offenders (grouped by label and what it hits)', '',
    '| # | class | label | hits | findings | variants | worst | written at | example |', '|---|---|---|---|---|---|---|---|---|',
    ...offenders.slice(0, 80).map((o, i) => `| ${i + 1} | ${o.cls} | ${o.label.replace(/\|/g, '\\|')} | ${o.hits.replace(/\|/g, '\\|')} | ${o.count} | ${o.variants} | ${o.worst} | ${o.writtenAt.join('<br>') || '—'} | ${o.example.variant} @${o.example.at.join(',')} |`), '');
  md.push('## Per variant', '', `| variant | ${COLLISION_CLASS_ORDER.map(k => SHORT[k]).join(' | ')} | title |`, `|---|${COLLISION_CLASS_ORDER.map(() => '---:').join('|')}|---|`,
    ...results.map(r => `| [${r.v.id}](${r.v.id}.html) | ${COLLISION_CLASS_ORDER.map(k => r.counts[k]).join(' | ')} | ${r.v.title} |`), '');
  md.push('## Worst 200 findings', '', '| # | variant | class | label | collides with | at (uu) | label box | amount |', '|---|---|---|---|---|---|---|---|',
    ...worst.map((f, i) => `| ${i + 1} | ${f.variant} | ${f.cls} | ${f.text.replace(/\|/g, '\\|')} | ${f.other.desc.replace(/\|/g, '\\|')} | ${r1(f.at[0])}, ${r1(f.at[1])} | ${fmtBox(f.textBox)} | ${r1(f.amount)} ${f.unit} |`), '');
  if (unknownGlyphs().length) md.push('## Glyphs measured with the conservative fallback', '', unknownGlyphs().map(c => `\`${c}\` U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(', '), '');
  md.push('## Baseline (tests/sldLegibility.test.ts)', '', '```ts',
    `const BASELINE_TOTALS: Record<CollisionClass, number> = { ${COLLISION_CLASS_ORDER.map(k => `${k}: ${totals[k]}`).join(', ')} };`,
    `// [${PER_VARIANT_CLASSES.join(', ')}]`, ...baselineRows, '```', '');
  writeFileSync(join(OUT, 'report.md'), md.join('\n'));

  // ── contact sheet ──
  const cards = results.map(r => {
    const img = sharp ? `<img src="${r.v.id}.thumb.png" loading="lazy" alt="">` : `<img src="${r.v.id}.svg" loading="lazy" alt="">`;
    return `<a class="card" href="${r.v.id}.html">${img}<div class="t"><b>${esc(r.v.id)}</b><br>${esc(r.v.title)}<br>`
      + COLLISION_CLASS_ORDER.map(k => `<span style="color:${CLASS_COLOR[k]}">${SHORT[k]} ${r.counts[k]}</span>`).join(' · ') + '</div></a>';
  }).join('\n');
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>SLD legibility audit</title>
<style>${FONT_CSS}
body{font-family:"SolarPro Sans",Arial,sans-serif;margin:16px;background:#eee}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px}
.card{background:#fff;text-decoration:none;color:#111;box-shadow:0 1px 3px #0003;display:block}
.card img{width:100%;display:block;border-bottom:1px solid #ddd}.t{padding:6px 8px;font-size:12px}
</style></head><body>
<h2>SLD legibility audit — ${results.length} variants — ${COLLISION_CLASS_ORDER.map(k => `${k} ${totals[k]}`).join(' · ')}</h2>
<p>commit ${esc(commit)} · <a href="report.md">report.md</a> · <a href="report.json">report.json</a></p>
<div class="grid">${cards}</div></body></html>`);

  say(`\ntotals: ${COLLISION_CLASS_ORDER.map(k => `${k} ${totals[k]}`).join(' · ')}`);
  say(`wrote ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch(e => { console.error(e); process.exit(1); });
