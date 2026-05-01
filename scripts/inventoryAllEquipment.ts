#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════
// scripts/inventoryAllEquipment.ts
// v47.399 — Milestone 1: Master inventory of every equipment row across
//           ALL DB files in the project. Read-only. No mutations.
//
// Output: CSV + console summary, saved to
//         docs/equipment-inventory-v47.399.csv
// ═══════════════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';

interface Row {
  id: string;
  manufacturer: string;
  model: string;
  category: string;
  file: string;
  hasDatasheet: boolean;
  datasheetUrl: string;
  ecosystemBrand: string;
}

const rows: Row[] = [];

// ── Import from equipment-db.ts ─────────────────────────────────────────
import('../lib/equipment-db').then((db) => {
  const sections: Array<[string, any[]]> = [
    ['SOLAR_PANELS', db.SOLAR_PANELS || []],
    ['STRING_INVERTERS', db.STRING_INVERTERS || []],
    ['MICROINVERTERS', db.MICROINVERTERS || []],
    ['OPTIMIZERS', db.OPTIMIZERS || []],
    ['RACKING_SYSTEMS', db.RACKING_SYSTEMS || []],
    ['BATTERIES', db.BATTERIES || []],
    ['GENERATORS', db.GENERATORS || []],
    ['ATS_UNITS', db.ATS_UNITS || []],
    ['BACKUP_INTERFACES', db.BACKUP_INTERFACES || []],
    ['MONITORING_GATEWAYS', db.MONITORING_GATEWAYS || []],
    ['EV_CHARGERS', db.EV_CHARGERS || []],
  ];

  for (const [sectionName, items] of sections) {
    for (const x of items) {
      rows.push({
        id: x.id || '',
        manufacturer: x.manufacturer || '',
        model: x.model || '',
        category: x.category || sectionName.toLowerCase(),
        file: 'equipment-db.ts',
        hasDatasheet: Boolean(x.datasheetUrl && x.datasheetUrl.length > 0),
        datasheetUrl: x.datasheetUrl || '',
        ecosystemBrand: x.ecosystemBrand || '',
      });
    }
  }

  // Also pull mounting-hardware-db, racking-database, equipment-registry-v4
  Promise.all([
    import('../lib/mounting-hardware-db').catch(() => ({} as any)),
    import('../lib/racking-database').catch(() => ({} as any)),
    import('../lib/equipment-registry-v4').catch(() => ({} as any)),
    import('../lib/equipment-registry').catch(() => ({} as any)),
    import('../lib/equipment-extras').catch(() => ({} as any)),
  ]).then(([mounting, racking, regV4, reg, extras]) => {
    // Try to extract from exports that look like equipment arrays
    function absorb(mod: any, fileName: string) {
      if (!mod) return;
      for (const [key, val] of Object.entries(mod)) {
        if (Array.isArray(val) && val.length > 0 && val[0] && typeof val[0] === 'object' &&
            (val[0] as any).manufacturer) {
          for (const x of val as any[]) {
            rows.push({
              id: x.id || `${fileName}::${key}::${x.model || '?'}`,
              manufacturer: x.manufacturer || '',
              model: x.model || x.name || '',
              category: x.category || key.toLowerCase(),
              file: fileName,
              hasDatasheet: Boolean(x.datasheetUrl && x.datasheetUrl.length > 0),
              datasheetUrl: x.datasheetUrl || '',
              ecosystemBrand: x.ecosystemBrand || '',
            });
          }
        }
      }
    }
    absorb(mounting, 'mounting-hardware-db.ts');
    absorb(racking,  'racking-database.ts');
    absorb(regV4,    'equipment-registry-v4.ts');
    absorb(reg,      'equipment-registry.ts');
    absorb(extras,   'equipment-extras.ts');

    printReport();
  });
});

function printReport() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Master Equipment Inventory — v47.399 Milestone 1');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total rows across all DB files: ${rows.length}\n`);

  // By file
  const byFile: Record<string, number> = {};
  for (const r of rows) byFile[r.file] = (byFile[r.file] || 0) + 1;
  console.log('By source file:');
  for (const [f, c] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.toString().padStart(4)}  ${f}`);
  }

  // By category
  console.log('\nBy category:');
  const byCat: Record<string, number> = {};
  for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + 1;
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${c}`);
  }

  // By manufacturer (top 20)
  console.log('\nTop 20 manufacturers (across all files):');
  const byMfr: Record<string, number> = {};
  for (const r of rows) {
    const m = r.manufacturer || '(unknown)';
    byMfr[m] = (byMfr[m] || 0) + 1;
  }
  const sortedMfrs = Object.entries(byMfr).sort((a, b) => b[1] - a[1]);
  for (const [m, n] of sortedMfrs.slice(0, 20)) {
    console.log(`  ${n.toString().padStart(4)}  ${m}`);
  }
  console.log(`\nTotal unique manufacturers: ${sortedMfrs.length}`);

  // Datasheet coverage
  const withDs = rows.filter((r) => r.hasDatasheet).length;
  const withoutDs = rows.length - withDs;
  console.log(`\nDatasheet coverage:`);
  console.log(`  ✓ ${withDs}/${rows.length} rows have datasheetUrl`);
  console.log(`  ✗ ${withoutDs}/${rows.length} rows MISSING datasheetUrl`);

  // Rows without datasheet, grouped by file
  console.log(`\n  Missing-datasheet rows by file:`);
  const missByFile: Record<string, number> = {};
  for (const r of rows.filter((x) => !x.hasDatasheet)) {
    missByFile[r.file] = (missByFile[r.file] || 0) + 1;
  }
  for (const [f, c] of Object.entries(missByFile).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c.toString().padStart(4)}  ${f}`);
  }

  // Duplicate ID detection across files
  const idMap: Record<string, Row[]> = {};
  for (const r of rows) {
    if (!r.id) continue;
    idMap[r.id] = idMap[r.id] || [];
    idMap[r.id].push(r);
  }
  const dupes = Object.entries(idMap).filter(([, rs]) => rs.length > 1);
  console.log(`\nDuplicate IDs across files: ${dupes.length}`);
  if (dupes.length > 0 && dupes.length <= 10) {
    for (const [id, rs] of dupes) {
      console.log(`  "${id}" appears in: ${rs.map((r) => r.file).join(', ')}`);
    }
  } else if (dupes.length > 10) {
    console.log(`  (first 5):`);
    for (const [id, rs] of dupes.slice(0, 5)) {
      console.log(`  "${id}" appears in: ${rs.map((r) => r.file).join(', ')}`);
    }
  }

  // Manufacturer reach across files
  console.log(`\nManufacturer reach — which brands appear in which files:`);
  const mfrToFiles: Record<string, Set<string>> = {};
  for (const r of rows) {
    const m = r.manufacturer || '(unknown)';
    mfrToFiles[m] = mfrToFiles[m] || new Set();
    mfrToFiles[m].add(r.file);
  }
  const multiFile = Object.entries(mfrToFiles)
    .filter(([, files]) => files.size > 1)
    .sort((a, b) => b[1].size - a[1].size);
  console.log(`  ${multiFile.length} manufacturers span multiple DB files`);
  for (const [m, files] of multiFile.slice(0, 15)) {
    console.log(`    ${m.padEnd(24)} in ${[...files].join(', ')}`);
  }

  // Write CSV
  const csvPath = path.join(process.cwd(), 'docs', 'equipment-inventory-v47.399.csv');
  const header = 'id,manufacturer,model,category,file,hasDatasheet,datasheetUrl,ecosystemBrand\n';
  const body = rows
    .map((r) =>
      [
        r.id,
        r.manufacturer,
        r.model.replace(/"/g, "'"),
        r.category,
        r.file,
        r.hasDatasheet ? 'yes' : 'no',
        r.datasheetUrl,
        r.ecosystemBrand,
      ]
        .map((v) => `"${v || ''}"`)
        .join(',')
    )
    .join('\n');
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, header + body);
  console.log(`\n✓ Full inventory written to: docs/equipment-inventory-v47.399.csv`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Inventory complete — READ ONLY. No mutations made.');
  console.log('═══════════════════════════════════════════════════════════════');
}