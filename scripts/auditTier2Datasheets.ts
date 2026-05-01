/**
 * Stage 4 Audit — Tier-2 datasheet coverage & URL verification
 *
 * For each ecosystem-tagged Tier-2 inverter (EcoFlow/Fronius/Sungrow/SMA/GoodWe):
 *   - Extract id, manufacturer, model, datasheetUrl
 *   - Report URL status (present vs missing)
 *
 * Does NOT make HTTP requests — just extracts structured data so we can
 * review coverage and decide which URLs to verify/replace.
 */

import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', 'lib', 'equipment-db.ts');

const TIER2_BRANDS = ['ecoflow', 'fronius', 'sungrow', 'sma', 'goodwe'];

interface RowSummary {
  id: string;
  manufacturer: string;
  model: string;
  ecosystemBrand: string;
  datasheetUrl: string | null;
}

function audit(): RowSummary[] {
  const content = fs.readFileSync(DB_PATH, 'utf8');

  // Split into rows by the `{` ... `},` boundary.
  // Simpler approach: scan for each ecosystemBrand match and walk backward to find id/mfg/model.
  const results: RowSummary[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/ecosystemBrand:\s*'([a-z0-9-]+)'/);
    if (!m) continue;
    const brand = m[1];
    if (!TIER2_BRANDS.includes(brand)) continue;

    // Walk backward up to 40 lines to find the enclosing id/manufacturer/model and datasheetUrl
    let id = '', manufacturer = '', model = '', datasheetUrl: string | null = null;
    for (let j = i; j >= Math.max(0, i - 40); j--) {
      const line = lines[j];
      if (!id) {
        const idm = line.match(/id:\s*'([^']+)'/);
        if (idm) id = idm[1];
      }
      const mfg = line.match(/manufacturer:\s*'([^']+)',\s*model:\s*'([^']+)'/);
      if (mfg) {
        manufacturer = mfg[1];
        model = mfg[2];
      }
      const ds = line.match(/datasheetUrl:\s*'([^']+)'/);
      if (ds && !datasheetUrl) datasheetUrl = ds[1];

      // Stop when we hit opening brace of row
      if (/^\s*\{\s*$/.test(line) && id) break;
    }

    results.push({
      id,
      manufacturer,
      model,
      ecosystemBrand: brand,
      datasheetUrl,
    });
  }

  return results;
}

const rows = audit();
console.log(`\n═══ Tier-2 Datasheet Audit (${rows.length} rows) ═══\n`);

// Group by brand
const byBrand = new Map<string, RowSummary[]>();
for (const r of rows) {
  if (!byBrand.has(r.ecosystemBrand)) byBrand.set(r.ecosystemBrand, []);
  byBrand.get(r.ecosystemBrand)!.push(r);
}

for (const [brand, items] of Array.from(byBrand.entries()).sort()) {
  console.log(`\n── ${brand.toUpperCase()} (${items.length} rows) ──`);
  for (const r of items) {
    const hasDS = r.datasheetUrl ? '✅' : '❌';
    console.log(`  ${hasDS} ${r.id}`);
    console.log(`     ${r.manufacturer} ${r.model}`);
    console.log(`     URL: ${r.datasheetUrl ?? '(none)'}`);
  }
}

const total = rows.length;
const withDS = rows.filter((r) => r.datasheetUrl).length;
console.log(`\n═══ Summary: ${withDS}/${total} have datasheetUrl ═══\n`);