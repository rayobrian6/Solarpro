/**
 * v47.404 — Stage 4B Batch 1 + Stage 4C Sungrow Deactivation
 *
 * Per user directive "Only use real datasheets (PDF/spec). No product pages":
 *
 * A) Fix 3 rows with verified manufacturer PDFs:
 *    - goodwe-gw5000-ns  → GoodWe DNS datasheet
 *    - goodwe-gw10k-ms   → GoodWe MS-US datasheet (explicitly US market)
 *    - sma-sb-10.0       → SMA SB TL-US via EcoDirect distributor mirror
 *                          (SMA no longer publishes this discontinued product)
 *
 * B) Deactivate 7 rows that have no US-market datasheet available:
 *    - sungrow-sg5rs, sg7.6rs, sg10rs, sg15rs (no US residential catalog)
 *    - ecoflow-power-ocean-5kw, -10kw, -20kw (no US catalog)
 *    For each: set active: false AND clear datasheetUrl to '' to remove
 *    broken links from UI.
 *
 * Safe to re-run: finds each row by unique id, idempotent updates.
 */

import * as fs from 'fs';
import * as path from 'path';

interface UrlFix {
  id: string;
  newUrl: string;
  note: string;
}

interface Deactivation {
  id: string;
  note: string;
}

const URL_FIXES: UrlFix[] = [
  {
    id: 'goodwe-gw5000-ns',
    newUrl: 'https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_DNS_Datasheet-EN.pdf',
    note: 'GoodWe DNS series datasheet (official manufacturer PDF)',
  },
  {
    id: 'goodwe-gw10k-ms',
    newUrl: 'https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_MS-US_Datasheet-EN.pdf',
    note: 'GoodWe MS-US datasheet (explicitly US-market 5-10kW single phase)',
  },
  {
    id: 'sma-sb-10.0',
    newUrl: 'https://s3.amazonaws.com/ecodirect_docs/SMA/SunnyBoy_TL-US.pdf',
    note: 'SMA Sunny Boy 6000-9000 TL-US distributor mirror (EcoDirect; SMA discontinued this product)',
  },
];

const DEACTIVATIONS: Deactivation[] = [
  // Sungrow SG-RS — no US residential product catalog per audit 2026-04-26
  { id: 'sungrow-sg5rs',    note: 'Sungrow has no US residential catalog; deactivated pending SKU confirmation' },
  { id: 'sungrow-sg7.6rs',  note: 'Sungrow has no US residential catalog; deactivated pending SKU confirmation' },
  { id: 'sungrow-sg10rs',   note: 'Sungrow has no US residential catalog; deactivated pending SKU confirmation' },
  { id: 'sungrow-sg15rs',   note: 'Sungrow has no US residential catalog; deactivated pending SKU confirmation' },
  // EcoFlow PowerOcean — no US catalog (AU/EU only as of audit)
  { id: 'ecoflow-power-ocean-5kw',  note: 'EcoFlow PowerOcean is AU/EU-only; deactivated pending US launch' },
  { id: 'ecoflow-power-ocean-10kw', note: 'EcoFlow PowerOcean is AU/EU-only; deactivated pending US launch' },
  { id: 'ecoflow-power-ocean-20kw', note: 'EcoFlow PowerOcean Pro is AU/EU-only; deactivated pending US launch' },
];

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', 'lib', 'equipment-db.ts');

function findRowBlock(lines: string[], id: string): { start: number; end: number } | null {
  const idLineIdx = lines.findIndex((l) =>
    new RegExp(`^\\s*id:\\s*'${id.replace(/\./g, '\\.').replace(/-/g, '\\-')}'`).test(l)
  );
  if (idLineIdx === -1) return null;

  // Row end: next `},` at matching indent level, or end of array
  for (let j = idLineIdx + 1; j < Math.min(lines.length, idLineIdx + 80); j++) {
    if (/^\s*\},\s*$/.test(lines[j])) {
      return { start: idLineIdx, end: j };
    }
  }
  return null;
}

function fixUrl(lines: string[], { id, newUrl, note }: UrlFix): { ok: boolean; message: string } {
  const block = findRowBlock(lines, id);
  if (!block) return { ok: false, message: `NOT FOUND: ${id}` };

  // Find datasheetUrl line within block
  for (let j = block.start; j <= block.end; j++) {
    if (/datasheetUrl:\s*'/.test(lines[j])) {
      const indent = (lines[j].match(/^(\s*)/) ?? ['', ''])[1];
      lines[j] = `${indent}datasheetUrl: '${newUrl}',`;
      // Insert comment above if not already v47.404
      const prev = lines[j - 1] ?? '';
      if (!/v47\.404/.test(prev)) {
        lines.splice(j, 0, `${indent}// v47.404 datasheet fix: ${note}`);
      }
      return { ok: true, message: `FIXED: ${id}` };
    }
  }
  return { ok: false, message: `NO datasheetUrl line in ${id}` };
}

function deactivate(lines: string[], { id, note }: Deactivation): { ok: boolean; message: string } {
  const block = findRowBlock(lines, id);
  if (!block) return { ok: false, message: `NOT FOUND: ${id}` };

  let changed = false;

  // Find & patch active: true → false
  // Find & clear datasheetUrl → ''
  for (let j = block.start; j <= block.end; j++) {
    if (/^\s*active:\s*true,/.test(lines[j])) {
      const indent = (lines[j].match(/^(\s*)/) ?? ['', ''])[1];
      lines[j] = `${indent}active: false, // v47.404: ${note}`;
      changed = true;
    }
    if (/datasheetUrl:\s*'[^']*'/.test(lines[j])) {
      lines[j] = lines[j].replace(/datasheetUrl:\s*'[^']*'/, `datasheetUrl: ''`);
      changed = true;
    }
  }

  if (!changed) return { ok: false, message: `No changes needed for ${id} (already deactivated?)` };
  return { ok: true, message: `DEACTIVATED: ${id}` };
}

function main(): void {
  const content = fs.readFileSync(DB_PATH, 'utf8');
  const lines = content.split('\n');

  console.log('═══ v47.404 — URL Fixes ═══\n');
  let fixedCount = 0;
  for (const f of URL_FIXES) {
    const r = fixUrl(lines, f);
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.message}`);
    if (r.ok) fixedCount++;
  }

  console.log('\n═══ v47.404 — Deactivations ═══\n');
  let deactCount = 0;
  for (const d of DEACTIVATIONS) {
    const r = deactivate(lines, d);
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.message}`);
    if (r.ok) deactCount++;
  }

  fs.writeFileSync(DB_PATH, lines.join('\n'), 'utf8');

  console.log(`\n═══ Summary ═══`);
  console.log(`   URL fixes:      ${fixedCount}/${URL_FIXES.length}`);
  console.log(`   Deactivations:  ${deactCount}/${DEACTIVATIONS.length}`);
  console.log(`   Total changes:  ${fixedCount + deactCount}`);
  console.log(`📝 Wrote ${DB_PATH}`);
}

main();