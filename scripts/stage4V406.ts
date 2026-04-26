/**
 * v47.406 — Stage 4B-3: Final broken-URL cleanup
 *
 * Addresses the final 12 broken URLs from the Stage 4 audit.
 *
 * URL FIXES (11 rows) — all verified HTTP 200 application/pdf:
 *
 * PANELS (6):
 *   - sp-maxeon7-440       → SunPower Maxeon 7 official PDF (cdn.prod.website-files.com)
 *   - sp-maxeon6-400       → SunPower A-Series official PDF (es-media distributor S3)
 *   - jinko-tiger-neo-580  → JinkoSolar US "Eagle 72" 570-590N datasheet (jinkosolar.us, manufacturer)
 *                            Note: DB names it "Tiger Neo 580" but that's the global brand; US SKU is "Eagle 72".
 *   - rec-alpha-pure-430   → REC Group dated subfolder PDF (recgroup.com)
 *   - cs-hiku7-600         → Canadian Solar HiKu7 CS7L-MS datasheet (static.csisolar.com, manufacturer CDN)
 *   - silfab-sil430        → Silfab SIL-430-QD datasheet (krannich-solar.com distributor; Silfab CDN blocks crawlers)
 *   - qcells-peak-duo-400  → Qcells Peak Duo ML-G10+ datasheet (cdn.myced.com / CED distributor)
 *
 * RACKING (4):
 *   - unirac-solarmount  → Unirac SolarMount brochure (unirac.com, manufacturer)
 *   - snapnrack-100      → SnapNrack Series 100 spec sheet (cdn.myced.com / CED distributor)
 *   - rooftech-mini      → Roof Tech RT MINI II brochure (design.roof-tech.us, manufacturer design portal)
 *   - quickmount-classic → IronRidge (successor) QuickMount QMSC Classic Comp datasheet (files.ironridge.com)
 *
 * DEACTIVATION (1 row):
 *   - panel-fence-ps1 (Philadelphia Solar Nexus PS-MNB108) → active: false
 *     philadelphiasolar.com is unreachable (connection timeout). No distributor
 *     mirror found. Following Sungrow/EcoFlow/HM-800 policy.
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
  // Panels (7 rows)
  {
    id: 'sp-maxeon7-440',
    newUrl: 'https://cdn.prod.website-files.com/6627b4a16340c535bfabf896/668bef1148a5bfbf75c79fbe_Sunpower.pdf',
    note: 'SunPower Maxeon 7 datasheet (official PDF from SunPower website CDN)',
  },
  {
    id: 'sp-maxeon6-400',
    newUrl: 'https://es-media-prod.s3.amazonaws.com/media/components/panels/spec-sheets/SunPower_A-Series.pdf',
    note: 'SunPower A-Series (400-425W) datasheet (Energy Sage authorized distributor S3)',
  },
  {
    id: 'jinko-tiger-neo-580',
    newUrl: 'https://jinkosolar.us/wp-content/uploads/2023/06/30mm-EAGLE-72-G6B-JKM570-590N-72HL4-BDV-F30-F2-US-1.pdf',
    note: 'JinkoSolar US Eagle 72 570-590N datasheet (jinkosolar.us manufacturer - US SKU for Tiger Neo 580W)',
  },
  {
    id: 'rec-alpha-pure-430',
    newUrl: 'https://www.recgroup.com/sites/default/files/2025-01/Web_DS%20REC%20Alpha%20Pure%202%20UL_EN%20US%2012122024.pdf',
    note: 'REC Alpha Pure 2 US datasheet (recgroup.com official, dated subfolder accessible)',
  },
  {
    id: 'cs-hiku7-600',
    newUrl: 'https://static.csisolar.com/wp-content/uploads/sites/9/2023/09/26110438/CS-Datasheet-HiKu7_CS7L-MS_v2.7_EN-1.pdf',
    note: 'Canadian Solar HiKu7 CS7L-MS 585-615W datasheet (official CSI Solar CDN)',
  },
  {
    id: 'silfab-sil430',
    newUrl: 'https://krannich-solar.com/fileadmin/user_upload/US/Datasheets/Modules/Silfab/Silfab-SIL-430-QD.pdf',
    note: 'Silfab SIL-430-QD datasheet (Krannich Solar distributor mirror; Silfab CDN blocks crawlers)',
  },
  {
    id: 'qcells-peak-duo-400',
    newUrl: 'https://cdn.myced.com/images/Products/ZZ0000/ZZ3048/00000/ZZ304800232_DS.pdf',
    note: 'Qcells Q.Peak Duo BLK ML-G10+ 385-405 datasheet (CED Electrical Supply distributor mirror)',
  },
  // Racking (4 rows)
  {
    id: 'unirac-solarmount',
    newUrl: 'https://www.unirac.com/document/solarmount-product-brochure/',
    note: 'Unirac SolarMount product brochure (manufacturer direct; returns application/pdf)',
  },
  {
    id: 'snapnrack-100',
    newUrl: 'https://cdn.myced.com/images/Products/ZZ0000/ZZ0849/00000/ZZ084900061_DS.pdf',
    note: 'SnapNrack Series 100 Roof Mount System datasheet (CED distributor mirror)',
  },
  {
    id: 'rooftech-mini',
    newUrl: 'https://design.roof-tech.us/PDF/Brochures/Mini_II_Brochure.pdf',
    note: 'Roof Tech RT Mini II brochure (design.roof-tech.us manufacturer design portal)',
  },
  {
    id: 'quickmount-classic',
    newUrl: 'https://files.ironridge.com/quickmount/QMPV-datasheet-QMSC-ClassicComp-web.pdf',
    note: 'QuickMount QMSC Classic Composition Mount datasheet (IronRidge, successor to QuickMount PV)',
  },
];

const DEACTIVATIONS: Deactivation[] = [
  {
    id: 'panel-fence-ps1',
    note: 'Philadelphia Solar website (philadelphiasolar.com) is unreachable as of v47.406; no distributor mirror found. Following Sungrow/EcoFlow/HM-800 deactivation policy.',
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
      if (!/v47\.406/.test(prev)) {
        lines.splice(j, 0, `${indent}// v47.406 datasheet fix: ${note}`);
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
      lines[j] = `${indent}active: false, // v47.406: ${note}`;
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

  if (!hasActiveField) {
    const closingLine = lines[block.end];
    const indent = (closingLine.match(/^(\s*)/) ?? ['', ''])[1];
    const fieldIndent = indent + '  ';
    lines.splice(block.end, 0, `${fieldIndent}active: false, // v47.406: ${note}`);
    changed = true;
  }

  return changed ? { ok: true, message: `DEACTIVATED: ${id}` } : { ok: false, message: `No changes for ${id}` };
}

function main(): void {
  const content = fs.readFileSync(DB_PATH, 'utf8');
  const lines = content.split('\n');

  console.log('═══ v47.406 — URL Fixes ═══\n');
  let fixedCount = 0;
  for (const f of URL_FIXES) {
    const r = fixUrl(lines, f);
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.message}`);
    if (r.ok) fixedCount++;
  }

  console.log('\n═══ v47.406 — Deactivations ═══\n');
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