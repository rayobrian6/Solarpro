// planset-evidence — machine-verifiable cross-sheet agreement report (Deliverable G).
// Usage: node scripts/planset-evidence.mjs <planset.html> <snapshot.json> [out.json]
//
// For each canonical value class, extracts EVERY printed instance from the
// rendered package and compares it to the PermitDesignSnapshot authority.
// agree:false rows are the W2+ projection worklist (until a value class's
// wave lands, disagreement is EXPECTED and measured — never hidden).
// Exit code: 0 = report written; 2 = report written AND blocking-class
// disagreements exist (branch counts / OCPD / snapshot stamp).
import fs from 'node:fs';

const [htmlPath, snapPath, outPath = 'planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) { console.error('usage: planset-evidence.mjs <html> <snapshot.json> [out]'); process.exit(1); }
const html = fs.readFileSync(htmlPath, 'utf8');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

const pages = html.split(/<div class="page"[ >]/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';

const findAll = (re, mapFn = (m) => m[1]) => {
  const out = [];
  pages.forEach((p) => {
    for (const m of p.matchAll(re)) out.push({ sheet: sheetIdOf(p), value: mapFn(m) });
  });
  return out;
};

const rows = [];
const add = (name, authority, instances, blocking = false) => {
  const uniq = [...new Set(instances.map(i => `${i.value}`))];
  const agree = uniq.length > 0 && uniq.every(u => `${u}` === `${authority}`);
  rows.push({ value: name, authority: `${authority}`, printedInstances: instances,
              distinctPrinted: uniq, agree, blocking });
};

// snapshot stamp presence (V12)
const sid = snap.meta.snapshotId;
add('snapshot.stamp', sid,
  pages.map(p => ({ sheet: sheetIdOf(p), value: p.includes(sid) ? sid : 'MISSING' })), true);

// branch count + per-branch OCPDs (V5a class)
add('electrical.branchCount', snap.derived.branchCount,
  findAll(/(\d+)\s+branches/gi), true);
const ocpds = (snap.electrical.branches ?? []).map(b => b.ocpdA);
add('electrical.branchOcpdMaxA', Math.max(0, ...ocpds),
  findAll(/B\d+<\/td><td>\d+\s*(?:&times;|×)\s*microinverter.*?fw7">(\d+)A/gis,
    m => Number(m[1])).map(r => ({ ...r, value: r.value }))
    .reduce((acc, r) => { acc.push(r); return acc; }, [])
    .map(r => r) // keep instances; authority compare = max
    , true);
// fix: compare max printed vs authority max
{
  const last = rows[rows.length - 1];
  const maxPrinted = Math.max(0, ...last.printedInstances.map(i => Number(i.value) || 0));
  last.agree = last.printedInstances.length > 0 && maxPrinted <= Number(last.authority);
  last.distinctPrinted = [...new Set(last.printedInstances.map(i => `${i.value}`))];
}

// feeder / backfeed OCPD — BLOCKING as of W2 (V9 feeder class activated:
// every sheet's feeder OCPD is a snapshot projection now)
add('electrical.feeder.ocpdA', snap.electrical.feeder.ocpdA,
  findAll(/(\d+)A\s*(?:PV\s*BREAKER|FUSED\s*[—-]\s*TAP OCPD|BACKFEED)/gi, m => Number(m[1])), true);

// module count + dc watts
add('derived.moduleCount', snap.derived.moduleCount,
  findAll(/(\d+)\s+(?:&times;|×|)\s*(?:modules|Modules|MODULES)\b/g, m => Number(m[1])));
add('derived.dcKw', (snap.derived.dcWattsStc / 1000).toFixed(2),
  findAll(/(\d+\.\d{2})\s*kW\s*(?:DC|dc)\b/g));

// NEC edition
add('project.ahj.adoptedCodes.nec', snap.project.ahj.adoptedCodes.nec,
  findAll(/NEC\s+(20\d\d)/g));

// wind speed
add('structural.loads.windSpeedMph', snap.structural.loads.windSpeedMph,
  findAll(/(\d{2,3})\s*MPH/gi, m => Number(m[1])));

// module watts
const mod = snap.equipment.modules[0];
if (mod) add('equipment.module.wattsStc', mod.spec.wattsStc,
  findAll(/(?:&times;|×)\s*(\d{3})W\b/g, m => Number(m[1])));

const report = {
  generatedAt: new Date().toISOString(),
  snapshotId: sid, digest: snap.meta.digest, schemaVersion: snap.meta.schemaVersion,
  sheetCount: pages.length,
  deferredViolations: snap._violations ?? null,
  // D-2 parity matrix — engine-of-record vs computeSystem shadow (from the snapshot)
  parityMatrix: snap.electrical?.shadowParity ?? null,
  values: rows,
  summary: {
    total: rows.length,
    agree: rows.filter(r => r.agree).length,
    disagree: rows.filter(r => !r.agree).map(r => r.value),
    blockingDisagree: rows.filter(r => !r.agree && r.blocking).map(r => r.value),
  },
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`[evidence] ${outPath}: ${report.summary.agree}/${report.summary.total} agree; disagreements: ${report.summary.disagree.join(', ') || 'none'}`);
process.exit(report.summary.blockingDisagree.length ? 2 : 0);
