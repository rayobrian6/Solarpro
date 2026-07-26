// ═══════════════════════════════════════════════════════════════════════════
// planset-evidence-bar-wse — BAR (Blocker & Authority Reconciliation) WS-E
// ELECTRICAL rendered-truth harness for directive §4, §5, §7, §8.
//
//   Usage: node scripts/planset-evidence-bar-wse.mjs <planset.html> <snapshot.json> [out.json]
//
// It regenerates NOTHING. It reads the REAL rendered permit package HTML + its
// PermitDesignSnapshot and checks the WS-E permanent gates against the RENDERED
// output and the CANONICAL objects the package exports in its own E-1 evidence
// stamp (data-bar-wse). It never re-derives an ampacity factor, an EGC length or
// a connector count — re-derivation is the drift class this campaign kills; the
// harness compares the RENDERED claim to the EXPORTED canonical object.
//
// Gates enforced (exit NON-ZERO on any failure):
//    4  six-CCC ampacity shows EVERY factor (never a lone multiplied derate)
//    5  missing ampacity input ⇒ PENDING, never PASS
//    6  grounding method explicit — exactly ONE modeled result
//    7  separate-EGC language requires a matching route + BOM quantity
//    9  sealing caps == actual unused connector objects (topology, not branchCount)
//   10  terminators == required cable-end objects
//   11  legend entries == displayed segment wiring methods
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';

const [htmlPath, snapPath, outPath = 'bar-wse.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) {
  console.error('usage: planset-evidence-bar-wse.mjs <html> <snapshot.json> [out]');
  process.exit(1);
}

const rawHtml = fs.readFileSync(htmlPath, 'utf8');
// Value scans run on a COMMENT-STRIPPED, base64-stripped copy: a comment
// documenting a RETIRED claim (or an "EMT"/"PV Wire" byte inside a datasheet
// image blob) must never be read as a live rendered claim.
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
const noB64 = html.replace(/data:image[^"')]+/g, '');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const el = snap.electrical || {};

const results = [];
let failed = 0;
function check(gate, name, pass, detail) {
  const ok = pass === true;
  if (!ok) failed++;
  results.push({ gate, name, pass: ok, detail: detail ?? null });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[gate ${String(gate).padStart(2)}] ${tag}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// ── read the package's OWN exported canonical objects ───────────────────────
function readStamp() {
  const m = noB64.match(/data-bar-wse="([^"]*)"/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]
      .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
  } catch (e) {
    return null;
  }
}
const ev = readStamp();
check(0, 'E-1 exports the BAR WS-E canonical evidence stamp', ev != null,
  ev ? `snapshotId=${ev.snapshotId}` : 'data-bar-wse stamp missing/unparseable');
if (!ev) {
  fs.writeFileSync(outPath, JSON.stringify({ ok: false, results }, null, 2));
  process.exit(1);
}
check(0, 'the exported stamp binds to THIS snapshot',
  ev.snapshotId === (snap.meta || {}).snapshotId,
  `stamp=${ev.snapshotId} snapshot=${(snap.meta || {}).snapshotId}`);

const isMicro = String(el.topology || '').toLowerCase() === 'micro';

// ═══ §4 / gates 4-5 — ampacity evidence ════════════════════════════════════
const amps = ev.ampacityAdjustments || [];
const REQUIRED_AMPACITY_FIELDS = [
  'conductorMaterial', 'insulation', 'insulationRatingC', 'conductorSize',
  'baseTableAmpacityA', 'baseTableTempC', 'terminalTempLimitC', 'terminalTableAmpacityA',
  'currentCarryingCount', 'countAdjustmentFactor', 'countAdjustmentBasis',
  'ambientCorrectionFactor', 'ambientCorrectionBasis', 'correctedAmpacityA',
  'finalAllowableAmpacityA', 'requiredContinuousA', 'requiredContinuousBasis',
  'state', 'necReferences', 'provenance',
];
check(4, 'every rendered section exports an ampacity object', amps.length > 0,
  `${amps.length} sections`);

const shared = amps.filter(a => a.fillApplicable && a.present);
const missingFields = [];
for (const a of amps.filter(x => x.present)) {
  for (const f of REQUIRED_AMPACITY_FIELDS) {
    if (!(f in a)) missingFields.push(`${a.sectionId}.${f}`);
  }
}
check(4, 'each ampacity result carries EVERY directive field', missingFields.length === 0,
  missingFields.slice(0, 6).join(', '));

// The shared multi-CCC raceway must show BOTH adjustments as separate factors.
const multi = shared.filter(a => (a.currentCarryingCount ?? 0) > 3);
check(4, 'the shared >3-CCC raceway itemizes the count adjustment AND the ambient correction',
  multi.length > 0 && multi.every(a =>
    typeof a.countAdjustmentFactor === 'number' && a.countAdjustmentFactor < 1
    && typeof a.ambientCorrectionFactor === 'number'
    && /310\.15\(C\)\(1\)/.test(String(a.countAdjustmentBasis))
    && /310\.15\(B\)\(1\)/.test(String(a.ambientCorrectionBasis))),
  multi.map(a => `${a.sectionId}: ${a.currentCarryingCount}CCC ×${a.countAdjustmentFactor} amb×${a.ambientCorrectionFactor}`).join(' | '));

// The corrected value must be the PRODUCT of the itemized factors (no hidden blob),
// and the final allowable must respect the 110.14(C) terminal cap.
const mathOk = amps.filter(a => a.present && a.correctedAmpacityA != null).every(a => {
  const expectCorr = a.baseTableAmpacityA * a.countAdjustmentFactor * a.ambientCorrectionFactor;
  const corrOk = Math.abs(expectCorr - a.correctedAmpacityA) <= 0.02;
  const capOk = a.finalAllowableAmpacityA
    === Math.min(a.correctedAmpacityA, a.terminalTableAmpacityA);
  return corrOk && capOk;
});
check(4, 'corrected == base × countAdj × ambient, and final == min(corrected, 75 °C terminal)', mathOk);

check(4, 'no sheet prints a bare "derate 0.NN" scalar cell',
  !/·\s*derate\s*0\.\d\d/.test(noB64));
check(4, 'the retired unquantified "TEMPERATURE DERATING NOTE" prose is gone',
  !noB64.includes('TEMPERATURE DERATING NOTE'));

// The canonical block is rendered on E-1 AND PV-4A AND PV-4B (same object).
const blockCount = (noB64.match(/SHARED-RACEWAY AMPACITY ADJUSTMENT/g) || []).length;
check(4, 'the ampacity evidence block renders on E-1 + PV-4A + PV-4B', blockCount >= 3,
  `${blockCount} occurrences`);
for (const ref of ['310.16', '310.15(C)(1)', '310.15(B)(1)', '110.14(C)']) {
  check(4, `the rendered chain cites ${ref}`, noB64.includes(ref));
}
// the rendered factors are the EXPORTED factors (report == rendered)
const hrEv = shared.find(a => a.sectionId === 'BRANCH_HOMERUN_RUN') || shared[0];
if (hrEv) {
  check(4, 'the rendered count/ambient factors EQUAL the exported canonical factors',
    noB64.includes(`×${hrEv.countAdjustmentFactor.toFixed(2)}`)
    && noB64.includes(`×${hrEv.ambientCorrectionFactor.toFixed(2)}`),
    `count=${hrEv.countAdjustmentFactor} ambient=${hrEv.ambientCorrectionFactor}`);
}

// gate 5 — a hole can never be PASS.
const badPass = amps.filter(a => a.state === 'PASS' && (
  a.countAdjustmentFactor == null || a.ambientCorrectionFactor == null
  || a.finalAllowableAmpacityA == null || a.requiredContinuousA == null));
check(5, 'no ampacity result claims PASS on a missing input', badPass.length === 0,
  badPass.map(a => a.sectionId).join(', '));
const holesPending = amps.filter(a =>
  (a.baseTableAmpacityA == null || a.requiredContinuousA == null) && a.state !== 'PENDING');
check(5, 'every incomplete ampacity result is PENDING', holesPending.length === 0,
  holesPending.map(a => a.sectionId).join(', '));

// ═══ §5 / gates 6-7 — grounding authority + BOM quantity ═══════════════════
const g = ev.openAirBranchGrounding || {};
if (isMicro) {
  check(6, 'exactly ONE grounding method is modeled and it is explicit',
    ['separate-conductor', 'integrated-listed', 'none-required'].includes(g.groundingMethod),
    `groundingMethod=${g.groundingMethod}`);
  check(6, 'the grounding result carries its manufacturer + code basis',
    !!g.sourceAuthority && !!g.codeBasis && /250\.122/.test(String(g.codeBasis)),
    `${g.codeBasis}`);

  const assertsSeparate = /SEPARATE\s+(EQUIPMENT GROUNDING CONDUCTOR|EGC)/i.test(noB64)
    || /SEPARATE\s+#?\d+[^.]{0,40}EGC/i.test(noB64);
  if (g.groundingMethod === 'separate-conductor' || assertsSeparate) {
    // gate 7 — the language requires a matching ROUTE ...
    check(7, 'the separate EGC has an enumerated route (segment + branch objects)',
      Array.isArray(g.branchIds) && g.branchIds.length === (el.branches || []).length
      && Array.isArray(g.segmentIds) && g.segmentIds.length > 0,
      `branches=${(g.branchIds || []).length}/${(el.branches || []).length} segments=${(g.segmentIds || []).join(',')}`);
    // ... derived from the SAME cable-path geometry as the trunk ...
    const paths = el.branchCablePaths || [];
    const sumDesigned = Math.round(paths.reduce((s, p) => s + (p.designedInstalledLengthFt || 0), 0) * 10) / 10;
    check(7, 'the EGC length equals Σ BranchCablePath designed-installed (trunk geometry)',
      g.designedInstalledFt != null && Math.abs(g.designedInstalledFt - sumDesigned) <= 0.11,
      `egc=${g.designedInstalledFt} Σpaths=${sumDesigned}`);
    // ... AND a BOM quantity.
    const expectedBom = g.designedInstalledFt != null
      ? Math.ceil(g.designedInstalledFt * g.wasteFactor) : null;
    check(7, 'the BOM footage = designed-installed × documented waste',
      g.bomFootageFt != null && g.bomFootageFt === expectedBom,
      `bom=${g.bomFootageFt} expected=${expectedBom} waste=${g.wasteFactor}`);
    // the rendered sheets state that SAME quantity (report == rendered)
    const qtyHits = (noB64.match(new RegExp(`${g.bomFootageFt}\\s*ft`, 'g')) || []).length;
    check(7, 'the sheets asserting a separate EGC print the SAME footage', qtyHits >= 2,
      `${g.bomFootageFt} ft appears ${qtyHits}×`);
    // no sheet may claim the trunk assembly grounds the branch
    check(6, 'no sheet claims the Q-Cable provides integrated equipment grounding',
      !/Q.?Cable[^.]{0,80}integrated (equipment )?grounding/i.test(noB64));
  }
}

// ═══ §7 / gates 9-10 — caps + terminators from topology ════════════════════
const ct = ev.connectorTopology || {};
if (isMicro) {
  const modules = (el.branches || []).reduce((s, b) => s + (b.moduleCount || 0), 0);
  check(9, 'occupied drops == one per micro/module (the topology basis)',
    ct.occupiedDrops === modules, `drops=${ct.occupiedDrops} modules=${modules}`);
  check(10, 'one cable-end object per branch is enumerated (terminator basis)',
    Array.isArray(ct.perBranch) && ct.perBranch.length === (el.branches || []).length
    && ct.perBranch.every(b => /-END$/.test(String(b.cableEndObjectId))),
    `${(ct.perBranch || []).length} cable-end objects`);
  // Rendered BOM prose must NOT justify caps/terminators as a per-branch constant.
  check(9, 'no BOM/sheet text justifies sealing caps as "1 per AC branch"',
    !/Sealing Cap[^<]{0,160}1 per AC branch/i.test(noB64)
    && !/unused drops \(1 per AC branch\)/i.test(noB64));
  check(9, 'the sealing-cap quantity is stated as topology-derived (or honest PENDING)',
    /NOT 1-per-branch/i.test(noB64) || /drops ordered/i.test(noB64)
    || !/Sealing Cap/i.test(noB64),
    'cap row carries its ordered-vs-occupied derivation');
  check(10, 'terminators are justified by cable-end objects, not a per-branch constant',
    !/Terminator[^<]{0,120}—\s*1 per AC branch end/i.test(noB64) || /FAR-END/i.test(noB64));
}

// ═══ §8 / gate 11 — legend == displayed wiring methods ════════════════════
check(11, 'the stale "Open Air — PV Wire/THWN-2" legend literal is GONE on a micro sheet',
  !isMicro || !noB64.includes('Open Air — PV Wire/THWN-2'));
if (isMicro && ev.openAirWiringMethod) {
  check(11, 'the open-air legend entry names the LISTED assembly actually drawn',
    noB64.includes(`Open Air — ${ev.openAirWiringMethod.wiringMethodLabel}`),
    ev.openAirWiringMethod.wiringMethodLabel);
}
// no method may be advertised that does not exist in the topology
const segs = el.routeSegments || [];
const hasInConduit = segs.some(r => r.raceway && r.raceway !== 'FREE_AIR');
const hasDcInConduit = segs.some(r => /^DC_/.test(String(r.segmentId)) && r.raceway && r.raceway !== 'FREE_AIR');
const e1 = (() => {
  const a = noB64.indexOf('SINGLE-LINE ELECTRICAL DIAGRAM');
  const b = noB64.indexOf('E-1 PHYSICAL CONDUCTOR');
  return a >= 0 && b > a ? noB64.slice(a, b) : noB64;
})();
check(11, 'the in-conduit THWN-2 legend entry appears only when such a segment exists',
  hasInConduit === e1.includes('AC Conductor in Conduit (THWN-2)'),
  `hasInConduit=${hasInConduit}`);
check(11, 'no DC-in-conduit legend entry on a design with no DC-in-conduit segment',
  hasDcInConduit || !e1.includes('DC Conductor in Conduit'),
  `hasDcInConduit=${hasDcInConduit}`);
check(11, 'no generic "PV Wire" legend entry on an all-micro sheet',
  !isMicro || !/PV Wire/.test(e1));

// ── emit ───────────────────────────────────────────────────────────────────
const out = {
  ok: failed === 0,
  snapshotId: (snap.meta || {}).snapshotId ?? null,
  topology: el.topology ?? null,
  gatesRun: results.length,
  gatesFailed: failed,
  results,
  artifacts: {
    // §4 shared-raceway ampacity artifact (the directive deliverable)
    sharedRacewayAmpacity: hrEv ?? null,
    ampacityBySection: amps,
    // §5 Q-Cable grounding authority report
    openAirBranchGrounding: ev.openAirBranchGrounding ?? null,
    // §7 connector / cap / terminator topology
    connectorTopology: ev.connectorTopology ?? null,
    // §8 legend reconciliation
    legend: {
      openAirWiringMethod: ev.openAirWiringMethod ?? null,
      staleLiteralPresent: noB64.includes('Open Air — PV Wire/THWN-2'),
      hasInConduitSegment: hasInConduit,
      hasDcInConduitSegment: hasDcInConduit,
    },
  },
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\n[bar-wse] ${results.length - failed}/${results.length} gates passed → ${outPath}`);
if (failed > 0) {
  console.error(`[bar-wse] FAIL — ${failed} gate(s) failed (fail-closed)`);
  process.exit(1);
}
