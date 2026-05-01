#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════════
// Stage 2 — Tag 13 remaining untagged inverters with ecosystemBrand.
// Works only on the `lib/equipment-db.ts` file.
//
// Target rows (from auditBrandProfileAlignment.ts):
//   Fronius (4): primo-5.0, -7.6, -8.2, -10.0
//   Sungrow (4): sg5rs, sg7.6rs, sg10rs, sg15rs
//   SMA     (3): sb-5.0, sb-7.7, sb-10.0
//   GoodWe  (2): gw5000-ns, gw10k-ms
//
// (EcoFlow already tagged via str-replace.)
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';

const FILE = path.resolve(__dirname, '..', 'lib', 'equipment-db.ts');

const TAGS: Array<{ id: string; brand: string; family: string }> = [
  // Fronius
  { id: 'fronius-primo-5.0',  brand: 'fronius',  family: 'primo' },
  { id: 'fronius-primo-7.6',  brand: 'fronius',  family: 'primo' },
  { id: 'fronius-primo-8.2',  brand: 'fronius',  family: 'primo' },
  { id: 'fronius-primo-10.0', brand: 'fronius',  family: 'primo' },
  // Sungrow
  { id: 'sungrow-sg5rs',      brand: 'sungrow',  family: 'sg-rs' },
  { id: 'sungrow-sg7.6rs',    brand: 'sungrow',  family: 'sg-rs' },
  { id: 'sungrow-sg10rs',     brand: 'sungrow',  family: 'sg-rs' },
  { id: 'sungrow-sg15rs',     brand: 'sungrow',  family: 'sg-rs' },
  // SMA
  { id: 'sma-sb-5.0',         brand: 'sma',      family: 'sunny-boy' },
  { id: 'sma-sb-7.7',         brand: 'sma',      family: 'sunny-boy' },
  { id: 'sma-sb-10.0',        brand: 'sma',      family: 'sunny-boy' },
  // GoodWe
  { id: 'goodwe-gw5000-ns',   brand: 'goodwe',   family: 'ns' },
  { id: 'goodwe-gw10k-ms',    brand: 'goodwe',   family: 'ms' },
];

let src = fs.readFileSync(FILE, 'utf8');
let changed = 0;
let skipped = 0;
const failures: string[] = [];

for (const { id, brand, family } of TAGS) {
  // Find the block that starts with `id: '<id>'` — note the mix of quoting.
  const idNeedle = `id: '${id}'`;
  const idx = src.indexOf(idNeedle);
  if (idx === -1) {
    failures.push(`[NOT FOUND] ${id}`);
    continue;
  }

  // Check if already has ecosystemBrand within the next ~1000 chars (block scope).
  const window = src.slice(idx, idx + 1200);
  if (/ecosystemBrand:\s*'/m.test(window)) {
    skipped++;
    continue;
  }

  // Find the datasheetUrl line in this block — our anchor.
  const dsMatch = window.match(/(\s*)(datasheetUrl:\s*'[^']+',\n)/);
  if (!dsMatch) {
    failures.push(`[NO DATASHEET ANCHOR] ${id}`);
    continue;
  }
  const dsLine = dsMatch[0];
  const indent = (dsMatch[1] || '    ').replace(/\n/g, '');
  const insertion =
    dsLine +
    `${indent}// v47.400 — ecosystem tag (Stage 2)\n` +
    `${indent}ecosystemBrand: '${brand}',\n` +
    `${indent}ecosystemFamily: '${family}',\n` +
    `${indent}active: true,\n`;

  // Replace ONLY this occurrence (within the block window).
  const blockStart = idx;
  const blockEndRel = window.indexOf(dsLine) + dsLine.length;
  src =
    src.slice(0, blockStart) +
    window.slice(0, window.indexOf(dsLine)) +
    insertion +
    window.slice(window.indexOf(dsLine) + dsLine.length) +
    src.slice(blockStart + 1200);

  changed++;
}

fs.writeFileSync(FILE, src, 'utf8');

console.log(`Tagged:   ${changed}`);
console.log(`Skipped:  ${skipped} (already tagged)`);
if (failures.length) {
  console.log(`Failures: ${failures.length}`);
  for (const f of failures) console.log(`   ${f}`);
}
console.log('Done.');