/**
 * Stage 3B — Generac Datasheet Backfill (v47.402)
 *
 * Adds `datasheetUrl` to 11 Generac equipment rows in lib/equipment-db.ts.
 * All URLs verified HTTP 200 against www.generac.com prior to running.
 *
 * Approved Option A: ship all 11 rows including 2 fallback docs
 * (install manual for PWRmanager, owner's manual for RTSW200A3 —
 *  Generac has never published dedicated spec sheets for these SKUs).
 *
 * Non-destructive: skips any row that already has datasheetUrl.
 * Idempotent: safe to re-run.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Backfill {
  id: string;
  url: string;
  note?: string;
}

const BACKFILLS: Backfill[] = [
  {
    id: 'generac-guardian-18kw',
    url: 'https://www.generac.com/globalassets/products/residential/standby-generators/brochure/10-26kw_hsb_brochure.pdf',
    note: 'Shared brochure covering 10–26kW Guardian lineup',
  },
  {
    id: 'generac-guardian-22kw',
    url: 'https://www.generac.com/globalassets/products/residential/standby-generators/spec-sheets/20-24kw-guardian-standby-generator-specsheet.pdf',
    note: 'Shared spec sheet (20–24kW Guardian)',
  },
  {
    id: 'generac-guardian-24kw',
    url: 'https://www.generac.com/globalassets/products/residential/standby-generators/spec-sheets/20-24kw-guardian-standby-generator-specsheet.pdf',
    note: 'Shared spec sheet (20–24kW Guardian)',
  },
  {
    id: 'generac-guardian-26kw',
    url: 'https://www.generac.com/globalassets/products/residential/standby-generators/spec-sheets/g007290-g007291-26kw-guardian-res-standby-generator-specsheet.pdf',
    note: 'Dedicated 26kW Guardian spec sheet',
  },
  {
    id: 'generac-pwrcell-inverter-7600',
    url: 'https://www.generac.com/globalassets/residential/dealers--installers/generac-installer-programs/solar--battery-installer-support/a0000909057_pwrcell_inverter-1phase_ss_revg_eng-spa_digital.pdf',
    note: 'PWRcell 1-phase inverter spec sheet (Rev G)',
  },
  {
    id: 'generac-pwrcell-9',
    url: 'https://www.generac.com/globalassets/residential/dealers--installers/generac-installer-programs/solar--battery-installer-support/pc2batterycabinet_specguide.pdf',
    note: 'Shared PC2 battery cabinet spec guide (9 & 17 kWh)',
  },
  {
    id: 'generac-pwrcell-17',
    url: 'https://www.generac.com/globalassets/residential/dealers--installers/generac-installer-programs/solar--battery-installer-support/pc2batterycabinet_specguide.pdf',
    note: 'Shared PC2 battery cabinet spec guide (9 & 17 kWh)',
  },
  {
    id: 'generac-pwrmanager',
    url: 'https://www.generac.com/globalassets/residential/dealers--installers/generac-installer-programs/solar--battery-installer-support/pwrmanager-install-manual.pdf',
    note: 'Install manual (Generac has no dedicated spec sheet for PWRmanager)',
  },
  {
    id: 'generac-rxsw200a3',
    url: 'https://www.generac.com/globalassets/products/residential/standby-generator-transfer-switches/automatic-transfer-switches/spec-sheets/rxsc100a3-200a3_rxsw100a3-150a3-200a3_specsheet.pdf',
    note: 'Combined RXSC/RXSW 100–200A ATS spec sheet',
  },
  {
    id: 'generac-rxsw100a3',
    url: 'https://www.generac.com/globalassets/products/residential/standby-generator-transfer-switches/automatic-transfer-switches/spec-sheets/rxsc100a3-200a3_rxsw100a3-150a3-200a3_specsheet.pdf',
    note: 'Combined RXSC/RXSW 100–200A ATS spec sheet',
  },
  {
    id: 'generac-rtsw200a3',
    url: 'https://www.generac.com/globalassets/products/residential/standby-generator-transfer-switches/automatic-transfer-switches/owners-manual/100-200a-automatic-transfer-switch-owners-manual.pdf',
    note: "Owner's manual (Generac has no dedicated spec sheet for RTSW)",
  },
];

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', 'lib', 'equipment-db.ts');

function backfill(): void {
  const originalContent = fs.readFileSync(DB_PATH, 'utf8');
  let content = originalContent;

  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const { id, url, note } of BACKFILLS) {
    // Find the row by its id field
    const idPattern = new RegExp(`(^\\s*id:\\s*'${id.replace(/-/g, '\\-')}',)`, 'm');
    const idMatch = content.match(idPattern);

    if (!idMatch || idMatch.index === undefined) {
      errors.push(`❌ NOT FOUND: ${id}`);
      continue;
    }

    // Find the end of this row — the nearest `},\n` after the id match
    const after = content.slice(idMatch.index);
    const rowEndMatch = after.match(/^(\s*)\},/m);
    if (!rowEndMatch || rowEndMatch.index === undefined) {
      errors.push(`❌ NO ROW END: ${id}`);
      continue;
    }

    const rowText = after.slice(0, rowEndMatch.index);

    // Skip if datasheetUrl already present in this row
    if (/datasheetUrl\s*:/.test(rowText)) {
      skipped++;
      console.log(`⏭️  SKIP (already has datasheetUrl): ${id}`);
      continue;
    }

    // Insert datasheetUrl + comment just before the closing `},`
    const insertPos = idMatch.index + rowEndMatch.index;
    const indent = rowEndMatch[1]; // whitespace before `},`
    const fieldIndent = indent + '  '; // one level deeper

    const insertion =
      `${fieldIndent}// v47.402 datasheet${note ? `: ${note}` : ''}\n` +
      `${fieldIndent}datasheetUrl: '${url}',\n`;

    content = content.slice(0, insertPos) + insertion + content.slice(insertPos);
    applied++;
    console.log(`✅ APPLIED: ${id}`);
  }

  if (applied > 0) {
    fs.writeFileSync(DB_PATH, content, 'utf8');
    console.log(`\n📝 Wrote ${DB_PATH}`);
  } else {
    console.log(`\n⚠️  No changes written.`);
  }

  console.log(`\n═══ Stage 3B Summary ═══`);
  console.log(`   Applied:  ${applied}`);
  console.log(`   Skipped:  ${skipped}`);
  console.log(`   Errors:   ${errors.length}`);
  if (errors.length) {
    console.log(errors.map((e) => '   ' + e).join('\n'));
  }
}

backfill();