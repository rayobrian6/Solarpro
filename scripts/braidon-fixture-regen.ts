// ═══════════════════════════════════════════════════════════════════════════
// braidon-fixture-regen.ts — W3.1 §1/§5 FROZEN-FIXTURE acceptance generator.
//
// Runs the FULL permit engine over the IMMUTABLE braidon-original-audit-fixture
// (tests/fixtures/braidon-original-audit-fixture.ts) and writes the rendered
// planset HTML + the PermitDesignSnapshot dump. Reads ZERO mutable DB rows — the
// fixture is a self-contained in-repo record of the ORIGINAL audited Braidon
// design. Feeds scripts/planset-evidence-w3.mjs in EVIDENCE_MODE=original.
//
//   Usage: tsx scripts/braidon-fixture-regen.ts [outBase]
//     -> <outBase>.html + <outBase>.snapshot.json   (default _tmp_braidon_original)
// ═══════════════════════════════════════════════════════════════════════════
import { writeFileSync } from 'fs';
import { generatePermitHTML } from '../lib/permit/index';
import { braidonOriginalAuditFixture } from '../tests/fixtures/braidon-original-audit-fixture';

function main() {
  // Deep clone so the imported immutable fixture object is never mutated by the
  // engine's in-place enrichment.
  const input: any = JSON.parse(JSON.stringify(braidonOriginalAuditFixture));

  const html = generatePermitHTML(input);
  const outBase = process.argv[2] || '_tmp_braidon_original';
  const htmlOut = outBase.endsWith('.html') ? outBase : `${outBase}.html`;
  writeFileSync(htmlOut, html);
  console.log('[fixture-regen] wrote', htmlOut, (html.length / 1024).toFixed(0) + 'KB');

  const snap = input._snapshot;
  if (!snap) {
    console.error('[fixture-regen] NO snapshot attached — generation predates W1 wiring? FAIL');
    process.exit(1);
  }
  const snapOut = htmlOut.replace(/\.html$/, '') + '.snapshot.json';
  writeFileSync(snapOut, JSON.stringify({ ...snap, _violations: input._snapshotViolations ?? [] }, null, 2));

  const branches = (snap.electrical.branches || []).map((b: any) => b.moduleCount);
  const blockers = (snap.permitReadiness.blockers || []).map((b: any) => b.code);
  console.log('[fixture-regen] wrote', snapOut,
    '| snapshot', snap.meta.snapshotId, 'digest', snap.meta.digest.slice(0, 16) + '…');
  console.log('[fixture-regen] modules', snap.derived.moduleCount,
    '| dcKw', (snap.derived.dcWattsStc / 1000).toFixed(2),
    '| module', snap.equipment.modules[0]?.model,
    '| inverter', snap.equipment.microInverters[0]?.model,
    '| branches', JSON.stringify(branches));
  console.log('[fixture-regen] blockers:', blockers.join(', ') || 'none');
}
main();
