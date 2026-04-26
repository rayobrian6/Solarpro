/**
 * Stage 4A — Fronius Primo + SMA Sunny Boy 3.0-7.7 Datasheet Fix (v47.403)
 *
 * All 6 Tier-2 rows previously had HTTP 404 URLs pointing to manufacturer
 * product pages. This script replaces them with verified manufacturer
 * datasheet PDFs (HTTP 200 confirmed prior to execution).
 *
 * Affected rows:
 *   - fronius-primo-5.0, -7.6, -8.2, -10.0   (single PDF covers all 4)
 *   - sma-sb-5.0, sma-sb-7.7                 (single PDF covers both)
 *
 * NOT in this batch:
 *   - sma-sb-10.0 (needs older TL-US distributor mirror - Stage 4B)
 *   - EcoFlow PowerOcean × 3 (Stage 4B)
 *   - GoodWe × 2 (Stage 4B)
 *   - Sungrow SG-RS × 4 (Stage 4C - business decision needed)
 *
 * This script OVERWRITES the existing (broken) datasheetUrl values.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Fix {
  id: string;
  oldUrl: string; // expected current broken value — for safety check
  newUrl: string;
  note: string;
}

const FIXES: Fix[] = [
  // Fronius Primo 208-240 series — single PDF covers 3.8/5.0/6.0/7.6/8.2/10.0/11.4
  {
    id: 'fronius-primo-5.0',
    oldUrl: 'https://www.fronius.com/en-us/usa/photovoltaics/products/all-products/inverters/fronius-primo',
    newUrl: 'https://www.fronius.com/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Primo_UL_EN_CA.pdf',
    note: 'Shared Fronius Primo UL datasheet (covers 3.8-1 through 11.4-1)',
  },
  {
    id: 'fronius-primo-7.6',
    oldUrl: 'https://www.fronius.com/en-us/usa/photovoltaics/products/all-products/inverters/fronius-primo/fronius-primo-7-6-1',
    newUrl: 'https://www.fronius.com/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Primo_UL_EN_CA.pdf',
    note: 'Shared Fronius Primo UL datasheet (covers 3.8-1 through 11.4-1)',
  },
  {
    id: 'fronius-primo-8.2',
    oldUrl: 'https://www.fronius.com/en-us/usa/photovoltaics/products/all-products/inverters/fronius-primo',
    newUrl: 'https://www.fronius.com/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Primo_UL_EN_CA.pdf',
    note: 'Shared Fronius Primo UL datasheet (covers 3.8-1 through 11.4-1)',
  },
  {
    id: 'fronius-primo-10.0',
    oldUrl: 'https://www.fronius.com/en-us/usa/photovoltaics/products/all-products/inverters/fronius-primo',
    newUrl: 'https://www.fronius.com/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Primo_UL_EN_CA.pdf',
    note: 'Shared Fronius Primo UL datasheet (covers 3.8-1 through 11.4-1)',
  },
  // SMA Sunny Boy US-41 series — single PDF covers 3.0 through 7.7
  {
    id: 'sma-sb-5.0',
    oldUrl: 'https://www.sma-america.com/products/solarinverters/sunny-boy-us.html',
    newUrl: 'https://files.sma.de/downloads/SBxx-US-DS-en-41.pdf',
    note: 'Shared SMA Sunny Boy US-41 datasheet (covers 3.0 through 7.7 kW)',
  },
  {
    id: 'sma-sb-7.7',
    oldUrl: 'https://www.sma-america.com/products/solarinverters/sunny-boy-us.html',
    newUrl: 'https://files.sma.de/downloads/SBxx-US-DS-en-41.pdf',
    note: 'Shared SMA Sunny Boy US-41 datasheet (covers 3.0 through 7.7 kW)',
  },
];

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', 'lib', 'equipment-db.ts');

function fix(): void {
  let content = fs.readFileSync(DB_PATH, 'utf8');
  const lines = content.split('\n');

  let applied = 0;
  let mismatches = 0;
  const errors: string[] = [];

  for (const { id, oldUrl, newUrl, note } of FIXES) {
    // Find the line containing `id: '<id>',` then scan forward for datasheetUrl
    const idLineIdx = lines.findIndex((l) => new RegExp(`id:\\s*'${id.replace(/\./g, '\\.').replace(/-/g, '\\-')}'`).test(l));
    if (idLineIdx === -1) {
      errors.push(`❌ NOT FOUND: ${id}`);
      continue;
    }

    // Scan forward up to 40 lines for a datasheetUrl line; stop at the next row's `{` or a `},`
    let dsLineIdx = -1;
    for (let j = idLineIdx; j < Math.min(lines.length, idLineIdx + 40); j++) {
      if (/datasheetUrl:\s*'/.test(lines[j])) {
        dsLineIdx = j;
        break;
      }
      if (j > idLineIdx && /^\s*\},/.test(lines[j])) break;
    }

    if (dsLineIdx === -1) {
      errors.push(`❌ NO datasheetUrl line found for ${id}`);
      continue;
    }

    const currentLine = lines[dsLineIdx];
    // Safety: confirm old URL matches (defensive)
    if (!currentLine.includes(oldUrl)) {
      const currentValueMatch = currentLine.match(/datasheetUrl:\s*'([^']+)'/);
      const currentValue = currentValueMatch ? currentValueMatch[1] : '(unreadable)';
      errors.push(
        `⚠️  MISMATCH ${id}:\n     expected: ${oldUrl}\n     actual:   ${currentValue}`
      );
      mismatches++;
      continue;
    }

    // Replace the URL on that line
    const newLine = currentLine.replace(
      /datasheetUrl:\s*'[^']+'/,
      `datasheetUrl: '${newUrl}'`,
    );
    lines[dsLineIdx] = newLine;

    // Add/replace inline comment on line above if it's an existing "ecosystem tag" line
    // Simpler: insert a new comment line right before the datasheetUrl line
    // (but only if the line above isn't already a v47.403 comment)
    const prevLine = lines[dsLineIdx - 1] ?? '';
    if (!/v47\.403/.test(prevLine)) {
      const indent = (currentLine.match(/^(\s*)/) ?? ['', ''])[1];
      lines.splice(dsLineIdx, 0, `${indent}// v47.403 datasheet fix: ${note}`);
    }

    applied++;
    console.log(`✅ FIXED: ${id}`);
  }

  if (applied > 0) {
    content = lines.join('\n');
    fs.writeFileSync(DB_PATH, content, 'utf8');
    console.log(`\n📝 Wrote ${DB_PATH}`);
  } else {
    console.log(`\n⚠️  No changes written.`);
  }

  console.log(`\n═══ Stage 4A Summary ═══`);
  console.log(`   Applied:     ${applied}`);
  console.log(`   Mismatches:  ${mismatches}`);
  console.log(`   Errors:      ${errors.length}`);
  if (errors.length) {
    console.log(errors.map((e) => '   ' + e).join('\n'));
  }
}

fix();