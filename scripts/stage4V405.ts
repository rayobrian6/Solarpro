/**
 * v47.405 — Stage 4B-2: SolarEdge x10 + Hoymiles cleanup
 *
 * Per user directive "Only use real datasheets (PDF/spec). No product pages":
 *
 * URL FIXES (11 rows):
 *   5× SolarEdge HD-Wave inverters → nwsolar.com distributor mirror
 *       (authorized SolarEdge partner, same datasheet SolarEdge blocks on their own CDN)
 *   5× SolarEdge P-series optimizers → krannich-solar.com IND distributor mirror
 *       (authorized partner, HTTP 200 verified)
 *   1× hoymiles-hms-800w-2t → cdn.myced.com (CED electrical distributor)
 *       Official Hoymiles HMS-700/800/900/1000-2T-NA datasheet (PDF confirmed)
 *
 * DEACTIVATION (1 row):
 *   hoymiles-hm800 — HM-series is EU balcony-power product, no US distributor
 *     carries the HM-800. Following same policy as Sungrow/EcoFlow in v47.404.
 *
 * All URLs verified HTTP 200 with application/pdf content-type before execution.
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

// All 10 SolarEdge rows get same URLs by category
const HD_WAVE_URL = 'https://nwsolar.com/wp-content/uploads/2022/02/se-hd-wave-single-phase-inverter-with-setapp-datasheet-na.pdf';
const P_OPTIMIZER_URL = 'https://krannich-solar.com/fileadmin/user_upload/IND/Datasheets/SolarEdge/Datasheet_power-optimizer-1-1_se-p-series-module-add-on-row.pdf';

const URL_FIXES: UrlFix[] = [
  // SolarEdge HD-Wave inverters (5)
  { id: 'se-3800h',  newUrl: HD_WAVE_URL, note: 'SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)' },
  { id: 'se-6000h',  newUrl: HD_WAVE_URL, note: 'SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)' },
  { id: 'se-7600h',  newUrl: HD_WAVE_URL, note: 'SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)' },
  { id: 'se-10000h', newUrl: HD_WAVE_URL, note: 'SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)' },
  { id: 'se-11400h', newUrl: HD_WAVE_URL, note: 'SolarEdge HD-Wave single-phase inverter NA datasheet (nwsolar.com distributor mirror)' },
  // SolarEdge P-series optimizers (5)
  { id: 'se-p320', newUrl: P_OPTIMIZER_URL, note: 'SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)' },
  { id: 'se-p401', newUrl: P_OPTIMIZER_URL, note: 'SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)' },
  { id: 'se-p505', newUrl: P_OPTIMIZER_URL, note: 'SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)' },
  { id: 'se-p730', newUrl: P_OPTIMIZER_URL, note: 'SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)' },
  { id: 'se-p850', newUrl: P_OPTIMIZER_URL, note: 'SolarEdge P-series power optimizer datasheet (Krannich Solar distributor mirror)' },
  // Hoymiles HMS-800W-2T (1) → CED-hosted official NA datasheet
  {
    id: 'hoymiles-hms-800w-2t',
    newUrl: 'https://cdn.myced.com/images/Products/ZZ0000/ZZ3066/00000/ZZ306600032_DS.pdf',
    note: 'Hoymiles HMS-700/800/900/1000-2T-NA datasheet (CED distributor mirror, official PDF)',
  },
];

const DEACTIVATIONS: Deactivation[] = [
  {
    id: 'hoymiles-hm800',
    note: 'Hoymiles HM-series is EU balcony-power product; no US distributor datasheet available. Following same policy as Sungrow/EcoFlow in v47.404.',
  },
];

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', 'lib', 'equipment-db.ts');

function findRowBlock(lines: string[], id: string): { start: number; end: number } | null {
  const escId = id.replace(/\./g, '\\.').replace(/-/g, '\\-');
  const idLineIdx = lines.findIndex((l) => new RegExp(`^\\s*id:\\s*'${escId}'`).test(l));
  if (idLineIdx === -1) return null;
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

  for (let j = block.start; j <= block.end; j++) {
    if (/datasheetUrl:\s*'/.test(lines[j])) {
      const indent = (lines[j].match(/^(\s*)/) ?? ['', ''])[1];
      lines[j] = `${indent}datasheetUrl: '${newUrl}',`;
      const prev = lines[j - 1] ?? '';
      if (!/v47\.405/.test(prev)) {
        lines.splice(j, 0, `${indent}// v47.405 datasheet fix: ${note}`);
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
  let hasActiveField = false;

  for (let j = block.start; j <= block.end; j++) {
    if (/^\s*active:\s*true,/.test(lines[j])) {
      const indent = (lines[j].match(/^(\s*)/) ?? ['', ''])[1];
      lines[j] = `${indent}active: false, // v47.405: ${note}`;
      changed = true;
      hasActiveField = true;
    } else if (/^\s*active:\s*false/.test(lines[j])) {
      hasActiveField = true;
    }
    if (/datasheetUrl:\s*'[^']*'/.test(lines[j])) {
      lines[j] = lines[j].replace(/datasheetUrl:\s*'[^']*'/, `datasheetUrl: ''`);
      changed = true;
    }
  }

  // If no `active` field exists at all, inject one before the closing `},`
  if (!hasActiveField) {
    const closingLine = lines[block.end];
    const indent = (closingLine.match(/^(\s*)/) ?? ['', ''])[1];
    const fieldIndent = indent + '  ';
    lines.splice(block.end, 0, `${fieldIndent}active: false, // v47.405: ${note}`);
    changed = true;
  }

  return changed ? { ok: true, message: `DEACTIVATED: ${id}` } : { ok: false, message: `No changes for ${id}` };
}

function main(): void {
  const content = fs.readFileSync(DB_PATH, 'utf8');
  const lines = content.split('\n');

  console.log('═══ v47.405 — URL Fixes ═══\n');
  let fixedCount = 0;
  for (const f of URL_FIXES) {
    const r = fixUrl(lines, f);
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.message}`);
    if (r.ok) fixedCount++;
  }

  console.log('\n═══ v47.405 — Deactivations ═══\n');
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