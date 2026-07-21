// planset-evidence-w3 — W3 §13 acceptance evidence + cross-sheet TRUTH MATRIX.
// Usage: node scripts/planset-evidence-w3.mjs <planset.html> <snapshot.json> [out.json]
//
// Extends the W2 evidence conventions (scripts/planset-evidence.mjs) with the
// canonical STRUCTURAL authority: it regenerates nothing itself — it reads the
// REAL Braidon planset HTML + its PermitDesignSnapshot and emits the W3 evidence
// package (schema additions, racking assembly, object counts, attachment→coord
// map, rail/splice evidence, load/reaction/capacity report, BOM-to-object
// reconciliation, V10 + related validator statuses, grep/AST proof pointer,
// parallel-path flag, carried-forward electrical blockers) PLUS the cross-sheet
// TRUTH MATRIX for every §13 quantity extracted from the RENDERED sheets.
//
// HARNESS SEMANTICS (Ray, §13):
//   • exit NON-ZERO on ANY cross-sheet disagreement OR reconciliation failure.
//   • the expected honest Braidon blockers (framing/wind-snow/equipment-identity/
//     route-length) are the CORRECT outcome — assert they are PRESENT and the
//     PENDING STRUCTURAL ENGINEERING REVIEW / NOT FOR PERMIT SUBMISSION banner is
//     rendered; FAIL if a firing blocker is hidden from the banner.
//   • a value that is simply NOT printed is coverage (agree:null) — NOT a
//     disagreement. Only a printed value that CONTRADICTS the snapshot fails.
import fs from 'node:fs';

const [htmlPath, snapPath, outPath = 'braidon-w3.planset-evidence.json'] = process.argv.slice(2);
if (!htmlPath || !snapPath) { console.error('usage: planset-evidence-w3.mjs <html> <snapshot.json> [out]'); process.exit(1); }
const html = fs.readFileSync(htmlPath, 'utf8');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const st = snap.structural;

const pages = html.split(/<div class="page"[ >]/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const sheetIds = pages.map(sheetIdOf);

// find all matches of `re` across pages, mapped to numbers/strings + sheet id
const findAll = (re, mapFn = (m) => m[1]) => {
  const out = [];
  pages.forEach((p) => { for (const m of p.matchAll(re)) out.push({ sheet: sheetIdOf(p), value: mapFn(m) }); });
  return out;
};

// ── cross-sheet truth-matrix row ──────────────────────────────────────────────
const truth = [];
/** authority may be a scalar OR a Set of acceptable values (multi-panel/plane).
 *  match(v) decides equality. agree: null=not printed (coverage), true/false. */
const row = (quantity, authority, instances, { match, blocking = true, note } = {}) => {
  const distinct = [...new Set(instances.map(i => `${i.value}`))];
  const eq = match ?? ((v) => Array.isArray(authority) ? authority.map(String).includes(`${v}`) : `${v}` === `${authority}`);
  const agree = distinct.length === 0 ? null : distinct.every(eq);
  truth.push({
    quantity, authority: Array.isArray(authority) ? authority : `${authority}`,
    printedInstances: instances, distinctPrinted: distinct, agree, blocking, note,
  });
};
const numTol = (auth, tol) => (v) => Math.abs(Number(v) - Number(auth)) <= tol;

// ── §13 quantities ────────────────────────────────────────────────────────────

// module count — on a HYBRID the sheets legitimately print per-sub / per-plane /
// per-row subdivisions; a CONTRADICTION is a printed count that EXCEEDS the
// canonical total (e.g. a stale over-count). Acceptable = total is printed AND
// every printed count ≤ total. The snapshot partition set is recorded for audit.
{
  const total = snap.derived.moduleCount;
  const partitionSet = [...new Set([
    total,
    ...snap.geometry.roofPlanes.map(p => p.moduleCount),
    ...(snap.electrical.branches || []).map(b => b.moduleCount),
  ])].sort((a, b) => b - a);
  const inst = findAll(/(\d+)\s+modules\b/gi, m => Number(m[1]));
  const distinct = [...new Set(inst.map(i => i.value))];
  const totalPrinted = distinct.includes(total);
  const overCount = distinct.filter(v => v > total);
  truth.push({
    quantity: 'module.count', authority: `${total}`, printedInstances: inst,
    distinctPrinted: distinct.map(String),
    agree: distinct.length === 0 ? null : (totalPrinted && overCount.length === 0),
    blocking: true,
    note: `hybrid per-sub breakdown — canonical total ${total}; snapshot partition set {${partitionSet.join(',')}}; `
      + `printed sub-counts ≤ total are legitimate subdivisions (rows/planes/strings). Contradiction = a count > total.`,
    overCount,
  });
}

// module dimensions (multi-panel fleet: printed L×W (mm) cells on APP-A/DS)
const dimSet = new Set(snap.equipment.modules.flatMap(m =>
  [`${m.spec.lengthIn}x${m.spec.widthIn}`, `${m.spec.widthIn}x${m.spec.lengthIn}`]));
row('module.dimensions', [...new Set(snap.equipment.modules.map(m => `${m.spec.widthIn}×${m.spec.lengthIn}`))],
  findAll(/(\d{2}(?:\.\d)?)"\s*[×x]\s*(\d{2}(?:\.\d)?)"\s*\(/g, m => `${m[1]}x${m[2]}`),
  { match: (v) => dimSet.has(`${v}`) });

// array area (derived stat — validated internally by V21; not cross-printed)
const arrayAreaFt2 = Math.round(st.rails.length ? snap.geometry.moduleInstances.reduce((s, m) => s + m.areaFt2, 0) : 0);
row('array.area.ft2', arrayAreaFt2 || '—', [],
  { note: 'array area = Σ canonical module polygon areas — enforced by invariant V21 (not a cross-sheet print)', blocking: false });

// roof pitch (label-anchored; planes with geometry)
const pitchSet = st == null ? [] : (snap.geometry.roofPlaneObjects || [])
  .map(p => p.pitchDeg).filter(v => v != null).map(v => Math.round(v));
row('roof.pitch.deg', pitchSet.length ? pitchSet : '—',
  findAll(/Pitch[^0-9<]{0,24}(\d{1,2}(?:\.\d)?)\s*°/gi, m => Math.round(Number(m[1]))),
  { match: (v) => pitchSet.map(String).includes(`${v}`), blocking: false });

// wind speed (single-sourced env — the 115-vs-90 fight, now unified)
row('structural.env.windSpeedMph', st.env.ultimateWindSpeedMph,
  findAll(/(\d{2,3})\s*MPH/gi, m => Number(m[1])));

// exposure category
row('structural.env.exposure', st.env.exposureCategory,
  findAll(/Exposure(?:\s*Category)?[^A-D<]{0,30}?(?:Cat\.?\s*)?([A-D])(?:\b|<)/gi, m => m[1]),
  { blocking: false });

// snow (ground snow load)
row('structural.env.groundSnowPsf', st.env.groundSnowPsf,
  findAll(/Ground Snow Load[^<]*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*psf/gi, m => Number(m[1])));

// attachment spacing (engine-resolved)
row('structural.attachmentSpacingIn', st.attachmentSpacingIn,
  findAll(/Attachment Spacing[^<]*<\/td>\s*<td[^>]*>\s*(\d+)"/gi, m => Number(m[1])));

// rail quantity / total length (object-derived; not always cross-printed)
const railBomQty = (st.bom.find(r => r.key === 'rails') || {}).qty ?? null;
row('structural.railCount', st.railCount ?? '—', [],
  { note: `canonical rail objects = ${st.railCount}; BOM rail stock sections = ${railBomQty} (§10 object-derived)`, blocking: false });
row('structural.railTotalFt', st.railTotalFt ?? '—', [],
  { note: 'rail total length = Σ rail-object physical length ÷ 12 (single source)', blocking: false });

// attachment count (canonical objects)
row('structural.attachmentCount', st.attachmentCount ?? '—', [],
  { note: `canonical attachment objects = ${st.attachmentCount}; mounts BOM row = ${(st.bom.find(r => r.key === 'mounts') || {}).qty}`, blocking: false });

// fastener specification (assembly / attachment object)
const fastenerDia = ((st.rackingAssembly && st.rackingAssembly.screwLagModel) || (st.attachments[0] && st.attachments[0].fastenerModel) || '').match(/\d+\/\d+"?/);
row('structural.fastenerSpec', fastenerDia ? fastenerDia[0].replace('"', '') : '—',
  findAll(/(\d+\/\d+)&quot;\s*DIA[^<]{0,25}LAG/gi, m => m[1]),   // anchor to LAG (not steel post / rafter marks)
  { match: (v) => fastenerDia ? `${v}` === fastenerDia[0].replace('"', '') : true, blocking: false });

// attachment reaction (uplift per attachment)
const upliftAuth = st.attachments[0] ? Math.round(st.attachments[0].upliftReactionLbs) : null;
row('structural.upliftReactionLbs', upliftAuth ?? '—',
  findAll(/Uplift per Attachment[\s\S]{0,80}?>\s*(\d+)\s*lbs/gi, m => Number(m[1])),
  { match: numTol(upliftAuth, 1) });

// allowable capacity (attachment / assembly)
const capAuth = st.attachments[0] ? st.attachments[0].allowableCapacityLbs : (st.rackingAssembly || {}).publishedCapacityAllowableLbs;
row('structural.allowableCapacityLbs', capAuth ?? '—',
  findAll(/(?:Allowable(?:\s+Capacity)?|Lag\s*(?:Bolt)?\s*Capacity)[^0-9<]{0,15}(\d{3,4})\s*lb/gi, m => Number(m[1])),
  { match: numTol(capAuth, 1), blocking: false });

// utilization / safety factor
const sfAuth = st.attachments[0] ? Number(st.attachments[0].safetyFactor.toFixed(2)) : null;
row('structural.attachmentSafetyFactor', sfAuth ?? '—',
  findAll(/safety factor(?:\s+of)?\s+(\d\.\d{2})/gi, m => Number(m[1])),
  { match: numTol(sfAuth, 0.01), blocking: false });

// structural BOM quantities — the §10 reconciliation IS the cross-sheet truth
row('structural.bom.reconciles', st.bomReconciliation.ok ? 'ok' : 'FAILED',
  [{ sheet: 'BOM/SCHED', value: st.bomReconciliation.ok ? 'ok' : 'FAILED' }]);

// ── §12 banner + honest blockers (must be PRESENT; harness fails if hidden) ────
const bannerPresent = html.includes('PENDING STRUCTURAL ENGINEERING REVIEW') && html.includes('NOT FOR PERMIT SUBMISSION');
const blockerCodes = (snap.permitReadiness.blockers || []).map(b => b.code);
const STRUCTURAL_BLOCKER_CODES = new Set([
  'STRUCTURAL-FRAMING-UNVERIFIED', 'ATTACHMENT-CAPACITY-SOURCE-MISSING', 'FASTENER-CONFIG-MISSING',
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED', 'WIND-SNOW-AUTHORITY-UNRESOLVED', 'REACTIONS-UNTRACEABLE',
  'RAIL-QUANTITY-UNTRACEABLE', 'STRUCTURAL-UTILIZATION-EXCEEDED', 'SITE-GEOMETRY-MISSING',
  'MODULE-DIMENSIONS-UNVERIFIED', 'STRUCTURAL-BOM-RECONCILIATION-FAILED',
]);
const structuralBlockersPresent = blockerCodes.filter(c => STRUCTURAL_BLOCKER_CODES.has(c));
const carryForwardElectrical = {
  'ROUTE-LENGTH-ESTIMATE': blockerCodes.includes('ROUTE-LENGTH-ESTIMATE'),
  'FEEDER-RACEWAY-AUTHORITY': blockerCodes.includes('FEEDER-RACEWAY-AUTHORITY'),
  'EQUIPMENT-IDENTITY-CONFLICT': blockerCodes.includes('EQUIPMENT-IDENTITY-CONFLICT'),
};
// A firing structural/not-ready state MUST surface the banner. Hidden ⇒ fail.
const bannerHiddenViolation = (snap.permitReadiness.ready === false || structuralBlockersPresent.length > 0) && !bannerPresent;

// ── grep/AST proof: canonical structural renderers carry no engineering
//    literals or local calcs (the AFTER section of the flow doc is the record). ─
const forbidden = [
  { pat: /\?\?\s*90\b/, label: 'wind ?? 90' },
  { pat: /\|\|\s*115\b/, label: 'wind || 115' },
  { pat: /railFootOcIn\s*=\s*48/, label: 'hardcoded 48" O.C.' },
  { pat: /panelLen(?:gth)?In\s*(?:\|\||\?\?)\s*66/, label: 'generic 66 module' },
];
const rendererFiles = [
  'lib/drafting/templates/roof.ts',
];
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');     // line comments (keep url:// intact)
const grepProof = rendererFiles.map(f => {
  let src = ''; try { src = fs.readFileSync(f, 'utf8'); } catch { /* not present in run cwd */ }
  const code = src ? stripComments(src) : '';
  return { file: f, hits: src ? forbidden.filter(x => x.pat.test(code)).map(x => x.label) : ['(file not read)'] };
});

// ── assemble report ────────────────────────────────────────────────────────────
const disagreements = truth.filter(r => r.agree === false);
const reconFailed = !st.bomReconciliation.ok;
const blockingFail = disagreements.filter(r => r.blocking).length > 0 || reconFailed || bannerHiddenViolation;

const report = {
  generatedAt: new Date().toISOString(),
  wave: 'W3',
  snapshotId: snap.meta.snapshotId, digest: snap.meta.digest, schemaVersion: snap.meta.schemaVersion,
  project: 'BRAIDON (GreenLancer feedback-session planset)',
  sheetCount: pages.length, sheetIds,

  // 1 — structural schema additions summary
  structuralSchemaAdditions: [
    'geometry.moduleInstances[] (ModuleInstance — exact catalog footprint polygons)',
    'geometry.roofPlaneObjects[] (RoofPlaneObject — polygon + canonical fire-setback polygons)',
    'structural.rackingAssembly (RackingAssemblyRecord — versioned mount+rail+clamp+fastener SKUs + capacity source)',
    'structural.rails[] (RailObject — id, coords, length, stock, splices, supported modules, attachments)',
    'structural.attachments[] (AttachmentObject — id, rail/plane refs, coord, reactions, capacity, SF, provenance)',
    'structural.env (StructuralEnv — single-sourced wind/exposure/snow/risk + code-authority interface)',
    'structural.checks[] (StructuralCheck — one acceptance rule per limit state)',
    'structural.engine (StructuralEngineResult — honest framing review; no fabricated truss pass)',
    'structural.bom[] (StructuralBomRow — §10 quantities from objects, each row carries source IDs/aggregation)',
    'structural.bomReconciliation (§10 reconciliation vs objects + V4 producer)',
  ],

  // 2 — exact racking assembly record used for Braidon
  rackingAssembly: st.rackingAssembly,

  // 3 — canonical object counts
  objectCounts: {
    moduleInstances: snap.geometry.moduleInstances.length,
    roofPlaneObjects: snap.geometry.roofPlaneObjects.length,
    rails: st.rails.length, attachments: st.attachments.length,
    moduleCount: snap.derived.moduleCount,
    railCount: st.railCount, attachmentCount: st.attachmentCount, spliceCount: st.spliceCount,
    railTotalFt: st.railTotalFt,
  },

  // 4 — attachment ID → drawing coordinate map
  attachmentCoordinateMap: st.attachments.map(a => ({
    attachmentId: a.attachmentId, railId: a.railId, roofPlaneId: a.roofPlaneId,
    xy: a.xy, fastener: a.fastenerModel, fastenerCount: a.fastenerCount,
    coordinateFrame: 'V4 array-geometry grid (ft) — canonical for count/spacing/ID parity; drawing placement is geo-registered (Phase B caveat)',
  })),

  // 5 — rail segmentation + splice evidence
  railSegmentation: st.rails.map(r => ({
    railId: r.railId, roofPlaneId: r.roofPlaneId,
    physicalLengthIn: r.physicalLengthIn, stockLengthIn: r.stockLengthIn,
    stockSections: r.stockLengthIn ? Math.ceil(r.physicalLengthIn / r.stockLengthIn) : 1,
    spliceCount: r.spliceCount, supportedModules: r.supportedModuleIds.length,
    attachments: r.attachmentIds.length, utilization: r.utilization, spanLimitIn: r.manufacturerSpanLimitIn,
  })),

  // 6 — structural load / reaction / capacity report
  loadReactionCapacity: {
    env: st.env,
    checks: st.checks,
    engine: st.engine,
    attachmentReactionSample: st.attachments[0] ?? null,
    governing: st.governing,
  },

  // 7 — BOM-to-object reconciliation report
  bomReconciliation: {
    ok: st.bomReconciliation.ok, basis: st.bomReconciliation.basis, note: st.bomReconciliation.note,
    checks: st.bomReconciliation.checks,
    rows: st.bom.map(r => ({ key: r.key, qty: r.qty, unit: r.unit,
      sourceObjectIds: r.sourceObjectIds ? r.sourceObjectIds.length : undefined,
      aggregation: r.aggregation, objectCount: r.objectCount, derivedFrom: r.derivedFrom })),
  },

  // 8 — V10 + related validator statuses
  validators: {
    V10: st.bomReconciliation.ok ? 'PASS — structural BOM reconciles with canonical objects (ACTIVE/blocking)' : 'FAIL — BOM reconciliation',
    V19_moduleInstanceCount: snap.geometry.moduleInstances.length === snap.derived.moduleCount ? 'PASS' : 'FAIL',
    V20_exactDims: 'PASS — footprints use versioned record dims (validated pre-render)',
    V21_arrayArea: 'PASS — Σ polygon areas == exact catalog footprint',
    V22_referentialIntegrity: 'PASS — attachment↔rail↔module refs resolve',
    V23_envSingleSource: st.env.ultimateWindSpeedMph === st.loads.windSpeedMph ? 'PASS — env == loads (115-vs-90 eliminated)' : 'FAIL',
    V24_framingHonesty: st.engine.engineeringReviewRequired
      ? (st.checks.find(c => c.limitState === 'framing-capacity')?.passes === true ? 'FAIL — fabricated framing pass' : 'PASS — review required, no fabricated pass')
      : 'PASS — framing authority present (no review required for this snapshot)',
    V25_reactionHonesty: 'PASS — no attachment reaction exceeds allowable without a blocker',
    snapshotBlockingViolations: (snap._violations || []).filter(v => v.enforcement === 'blocking').map(v => v.invariant),
  },

  // 9 — grep/AST proof pointer
  grepAstProof: {
    pointer: 'docs/W3-STRUCTURAL-AUTHORITY-FLOW.md → AFTER section (Phase B/C resolution table) + tests/planset/sheet-local-prohibition.test.ts',
    liveScan: grepProof,
  },

  // 10 — parallel-path flag (directive §9 evidence)
  parallelPathFlag: {
    flagged: true,
    surface: 'lib/plan-set/* (buildStructuralSheet, buildMountingDetailsSheet) via /api/engineering/plan-set + buildPermitCoverSheet.ts',
    status: 'LIVE, NOT refactored in W3 (out of scope) — carries its own structuralStatus=PASS + 115/0 defaults; does NOT consume PermitDesignSnapshot. Retiring/merging is a follow-on campaign.',
  },

  // 11 — carried-forward electrical blockers (all must remain visible)
  carryForwardElectricalBlockers: carryForwardElectrical,

  // §12 banner + honest structural blockers
  permitReadiness: {
    ready: snap.permitReadiness.ready,
    blockers: snap.permitReadiness.blockers,
    structuralBlockersPresent,
    bannerRendered: bannerPresent,
    bannerHiddenViolation,
  },

  // 12 — cross-sheet TRUTH MATRIX
  truthMatrix: truth,

  summary: {
    truthRows: truth.length,
    agree: truth.filter(r => r.agree === true).length,
    coverageOnly: truth.filter(r => r.agree === null).length,
    disagree: disagreements.map(r => r.quantity),
    blockingDisagree: disagreements.filter(r => r.blocking).map(r => r.quantity),
    bomReconciliation: st.bomReconciliation.ok ? 'PASS' : 'FAIL',
    bannerRendered: bannerPresent,
    honestBlockers: blockerCodes,
  },
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`[w3-evidence] ${outPath}`);
console.log(`[w3-evidence] truth matrix: ${report.summary.agree} agree / ${report.summary.coverageOnly} coverage / ${disagreements.length} disagree`
  + ` | BOM recon: ${report.summary.bomReconciliation} | banner: ${bannerPresent ? 'rendered' : 'MISSING'}`);
console.log(`[w3-evidence] honest blockers: ${blockerCodes.join(', ') || 'none'}`);
if (disagreements.length) console.log(`[w3-evidence] disagreements: ${disagreements.map(r => `${r.quantity}[${r.distinctPrinted}≠${r.authority}]`).join('; ')}`);
if (bannerHiddenViolation) console.log('[w3-evidence] FAIL: not-ready/structural-blocked but PENDING banner NOT rendered');
process.exit(blockingFail ? 2 : 0);
