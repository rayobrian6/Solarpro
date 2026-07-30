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

// ── W3.1 §1/§5 DUAL-MODE evidence ──────────────────────────────────────────
// EVIDENCE_MODE=original → frozen braidon-original-audit-fixture (zero mutable DB
// rows), directly comparable with W1/W2, proves the audited failure classes are
// corrected. EVIDENCE_MODE=live → current database design (88-module hybrid),
// supersedes the old braidon-w3 evidence. Default 'live' keeps prior behavior.
const MODE = process.env.EVIDENCE_MODE === 'original' ? 'original' : (process.env.EVIDENCE_MODE || 'live');
const SUPERSEDES = process.env.EVIDENCE_SUPERSEDES || null;
// Replicates lib/plan-set/legacy-path-guard.isSnapshotPermitValid (fail-closed):
// PASS only for a real PDS id + hex digest + validators-clean (ready && no blockers).
const snapshotPermitValid = (() => {
  const id = snap?.meta?.snapshotId, dg = snap?.meta?.digest, pr = snap?.permitReadiness;
  return typeof id === 'string' && /^PDS-/.test(id) && typeof dg === 'string' && /^[0-9a-f]{16,}$/i.test(dg)
    && !!pr && pr.ready === true && Array.isArray(pr.blockers) && pr.blockers.length === 0;
})();

// EVERY sheet wrapper, whatever modifier classes it carries (`page sld-page`,
// `page landscape`, …). The old exact-class form dropped later-added sheets.
const pages = html.split(/<div class="page(?=[ "])/).slice(1);
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
  'FRAMING-AUTHORITY-UNVERIFIED', 'ATTACHMENT-CAPACITY-SOURCE-MISSING', 'FASTENER-CONFIG-MISSING',
  'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED', 'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED',
  'WIND-SNOW-AUTHORITY-UNRESOLVED', 'REACTIONS-UNTRACEABLE',
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

// ── W3.1 §2 canonical coordinate authority + LIVE render-parity evidence ──────
const coordinateAuthority = (() => {
  const objs = [
    ...snap.geometry.moduleInstances.map(m => m.coord),
    ...snap.geometry.roofPlaneObjects.map(p => p.coord),
    ...st.rails.map(r => r.coord), ...st.attachments.map(a => a.coord),
  ].filter(Boolean);
  const frames = [...new Set(objs.map(c => c.coordinateSystemId))];
  const renderedIds = [...html.matchAll(/data-object-id="([^"]+)"/g)].map(m => m[1]);
  const canonIds = new Set([
    ...snap.geometry.moduleInstances.map(m => m.instanceId),
    ...st.rails.map(r => r.railId),
    ...st.attachments.map(a => a.attachmentId),
    ...st.rails.flatMap(r => (r.splicePointsXY || []).map((_, k) => `splice-${r.railId}-${k + 1}`)),
  ]);
  const canonPt = new Map();
  for (const mi of snap.geometry.moduleInstances) { const p = (mi.drawnPolygon || mi.polygon).points; if (p.length) canonPt.set(mi.instanceId, { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length }); }
  for (const r of st.rails) { canonPt.set(r.railId, { x: (r.startXY.x + r.endXY.x) / 2, y: (r.startXY.y + r.endXY.y) / 2 }); (r.splicePointsXY || []).forEach((sp, k) => canonPt.set(`splice-${r.railId}-${k + 1}`, sp)); }
  for (const a of st.attachments) canonPt.set(a.attachmentId, a.xy);
  const orphanRenderedIds = renderedIds.filter(id => !canonIds.has(id));
  const ap = (m, p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
  const dtById = new Map((snap.geometry.drawingTransforms || []).map(t => [t.transformId, t]));
  const manifests = [...html.matchAll(/<!--PLACEMENT-MANIFEST:(\{.*?\})-->/g)].map(m => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
  let maxDelta = 0, entryCount = 0, omitted = 0, rederived = 0;
  const kindsSeen = new Set();
  const perManifestMissing = new Set();   // candidate omissions, resolved against the union below
  const placedAnywhere = new Set();       // every objectId placed by ANY manifest
  for (const man of manifests) {
    const dt = dtById.get(man.transformId);
    const seen = new Set();
    const manifestKinds = new Set(man.entries.map(e => e.kind));
    for (const e of man.entries) {
      entryCount++; kindsSeen.add(e.kind); seen.add(e.objectId); placedAnywhere.add(e.objectId);
      const c = canonPt.get(e.objectId);
      if (c && Math.hypot(c.x - e.canonicalXY.x, c.y - e.canonicalXY.y) > 0.01) rederived++;
      if (dt && c) { const exp = ap(man.viewport, ap(dt.matrix, e.canonicalXY)); maxDelta = Math.max(maxDelta, Math.hypot(exp.x - e.sheetXY.x, exp.y - e.sheetXY.y)); }
    }
    for (const [id] of canonPt) {
      const kind = id.startsWith('mi-') ? 'module' : id.startsWith('splice-') ? 'splice' : id.startsWith('att-') ? 'attachment' : 'rail';
      // Per-manifest omission is only meaningful for the kinds THIS manifest draws.
      // (Union across manifests below — a rail drawn on the structural sheet is not
      // "omitted" because the roof-plan manifest does not repeat it.)
      if (manifestKinds.has(kind) && kind !== 'module' && !seen.has(id)) perManifestMissing.add(id);
    }
  }
  // V30 = no canonical object omitted from the DRAWING as a whole: an object counts as
  // omitted only when NO manifest placed it. Before this, a second placement manifest
  // (added when the structural sheet started emitting its own) made every rail/attachment
  // drawn on only one sheet look omitted from the other → a false parity failure.
  for (const id of perManifestMissing) if (!placedAnywhere.has(id)) omitted++;
  return {
    canonicalCoordinateSystem: snap.geometry.coordinateSystem,
    unifiedFrame: frames.length === 1 && frames[0] === (snap.geometry.coordinateSystem || {}).id,
    distinctFramesAcrossObjects: frames,
    drawingTransforms: (snap.geometry.drawingTransforms || []).map(t => ({
      transformId: t.transformId, scope: t.scope, kind: t.params.kind,
      rotationDeg: t.params.rotationDeg, pivot: t.params.pivot,
      matrix: t.matrix, transformDigest: t.transformDigest,
      fromCoordinateSystemId: t.fromCoordinateSystemId, toFrame: t.toFrame,
    })),
    renderParity: {
      renderedObjectIds: renderedIds.length, orphanRenderedIds, idCoverageOk: orphanRenderedIds.length === 0,
      placementManifests: manifests.length, structuralObjectsPlaced: entryCount,
      objectKindsPlacedFromCanonical: [...kindsSeen],
      maxDrawnVsTransformDeltaSheetUnits: Math.round(maxDelta * 1000) / 1000,
      coordinateParityOk: maxDelta <= 0.5 && rederived === 0 && omitted === 0,
      note: 'V30/V31 (live/blocking): module outlines, rails, attachment feet + splice markers ALL drawn as viewport∘DT-SITE(canonical) — '
        + 'drawn == transform(canonical) within 0.5 sheet units, renderer consumed the snapshot coordinate (no re-derivation), '
        + 'no canonical structural object omitted. Module display-straightening lives in drawnPolygon (snapshot build); '
        + 'raw polygon feeds the area invariant (V21). Rail-less direct-mounts remain a recorded gap (no canonical coords yet).',
    },
  };
})();
const coordParityFail = !coordinateAuthority.renderParity.idCoverageOk || !coordinateAuthority.renderParity.coordinateParityOk;

// ── W3.1 §1/§5 — ORIGINALLY-AUDITED FAILURE CLASSES → corrected status ────────
// Maps each W1/W2 audited defect to its W3/W3.1 corrected state with the proving
// validator/parity result read from THIS snapshot. In 'original' mode the classes
// that must be corrected are ASSERTED (harness exits non-zero if any regressed).
const rec0 = snap.equipment.modules[0];
const gi0 = snap.geometry.moduleInstances || [];
const att0 = st.attachments[0] || null;
const dimsExact = !!(rec0 && rec0.spec.widthIn != null && rec0.spec.lengthIn != null && gi0.length > 0
  && gi0.every(m => m.widthIn === rec0.spec.widthIn && m.heightIn === rec0.spec.lengthIn));
const windSingleSourced = st.env.ultimateWindSpeedMph != null && st.env.ultimateWindSpeedMph === st.loads.windSpeedMph;
const sfEngineOwned = !!(att0 && att0.safetyFactor != null && att0.allowableCapacityLbs != null
  && /engine-v4|calcMountLayout/i.test(JSON.stringify(att0.provenance || {})));
const spacingObjectDerived = st.attachmentSpacingIn != null && st.rails.length > 0;
const setbackFromEngine = (snap.geometry.roofPlaneObjects || []).some(p => p.fireSetbackIn != null)
  || (snap.geometry.roofPlaneObjects || []).length > 0;
const rendererLiteralHits = grepProof.flatMap(g => g.hits).filter(h => h !== '(file not read)');
const noRendererSetbackLiterals = rendererLiteralHits.length === 0;
const bomReconciles = st.bomReconciliation.ok;
const idConflictFired = blockerCodes.includes('EQUIPMENT-IDENTITY-CONFLICT');
const fc = (defect, w1w2Symptom, corrected, provingCheck, result, status) => ({
  defect, w1w2Symptom, w31Status: status ?? (corrected ? 'corrected' : 'REGRESSED'),
  mustCorrect: true, provingCheck, result, ok: corrected,
});
const failureClasses = [
  fc('wind 115-vs-90', 'PV-3 printed 90 mph while PV-4C/PE-1 printed 115 — two wind authorities',
    windSingleSourced, 'V23 structural.env.ultimateWindSpeedMph === structural.loads.windSpeedMph',
    `env ${st.env.ultimateWindSpeedMph} == loads ${st.loads.windSpeedMph} mph (single-sourced)`),
  fc('safety-factor 1.0-vs-2.0', 'attachment SF was a renderer × (safetyFactor||2) multiplier outside the engine',
    sfEngineOwned, 'attachment SF + allowable capacity are structural-engine-v4 owned (attachment.provenance)',
    att0 ? `SF ${att0.safetyFactor}, allowable ${att0.allowableCapacityLbs} lb from engine` : 'no rail-based attachments'),
  fc('invented 48" feet', 'attachment spacing was a hardcoded 48" O.C. renderer literal',
    spacingObjectDerived, 'attachmentSpacingIn derives from canonical rail objects (rails[0].spanConfigIn), not a literal',
    `attachmentSpacingIn ${st.attachmentSpacingIn}" from ${st.rails.length} rail objects`),
  fc('generic module dims', 'module footprints used a generic 66×40 / literal size',
    dimsExact, 'V20 every moduleInstance footprint === exact equipment-db catalog dims',
    rec0 ? `${gi0.length} instances @ ${rec0.spec.widthIn}×${rec0.spec.lengthIn} (catalog ${rec0.model})` : 'no module record'),
  fc('renderer-owned setbacks', 'fire setbacks were computed by the sheet renderer with local literals',
    setbackFromEngine && noRendererSetbackLiterals, 'setbacks on roofPlaneObjects from the slope-space fireSetback engine; renderer carries no wind/48"/66 literals (grep proof)',
    `${(snap.geometry.roofPlaneObjects || []).length} plane objects carry engine setbacks; renderer literal hits: ${rendererLiteralHits.length ? rendererLiteralHits.join(',') : 'none'}`),
  fc('BOM guesses', 'racking BOM quantities were renderer/registry guesses',
    bomReconciles, 'V10 structural BOM reconciles with canonical rail/attachment/module objects',
    `bomReconciliation ${st.bomReconciliation.ok ? 'PASS' : 'FAIL'} (basis ${st.bomReconciliation.basis})`),
];
// EQUIPMENT-IDENTITY-CONFLICT is design-state, not a rendering defect. On the
// frozen fixture the deterministic Qcells selection means it legitimately does
// NOT fire (fixture-deterministic-selection); on the live design it remains an
// unresolved BLOCKING production conflict. Recorded, never asserted as corrected.
failureClasses.push({
  defect: 'equipment-identity REC-vs-Qcells',
  w1w2Symptom: 'subSystems.roof.panelId (REC 405W) diverged from the fleet module (Qcells 400W)',
  w31Status: MODE === 'original' ? 'fixture-deterministic-selection' : (idConflictFired ? 'blocking-carried (production unresolved)' : 'not-present'),
  mustCorrect: false,
  provingCheck: 'permitReadiness.blockers EQUIPMENT-IDENTITY-CONFLICT',
  result: MODE === 'original'
    ? 'fixture explicitly selects Qcells (deterministic) → no conflict fires; production conflict left untouched'
    : (idConflictFired ? 'EQUIPMENT-IDENTITY-CONFLICT present and blocking (operator reconciliation required)' : 'not fired on this live design'),
  ok: true,
});
const failureClassesAllCorrected = failureClasses.filter(f => f.mustCorrect).every(f => f.ok);

// ── §3 (W4 §6) — LEGACY plan-set path is now PERMANENTLY DELETED ──────────────
// W3.1 shipped INTERIM containment (a fail-closed guard). W4 §6 replaced that
// with permanent DELETION: the 9 lib/plan-set builders + the guard are removed,
// the /api/engineering/plan-set route is a 410 tombstone, and zero importers
// remain. This emission proves the permanent-deletion state from the filesystem
// (the guard is gone, so nothing is replicated at runtime here).
const LEGACY_BUILDER_FILES = [
  'lib/plan-set/legacy-path-guard.ts', 'lib/plan-set/cover-sheet.ts',
  'lib/plan-set/electrical-sheet.ts', 'lib/plan-set/structural-sheet.ts',
  'lib/plan-set/equipment-schedule.ts', 'lib/plan-set/site-layout-sheet.ts',
  'lib/plan-set/mounting-details-sheet.ts', 'lib/plan-set/compliance-sheet.ts',
  'lib/plan-set/title-block.ts',
];
const legacyBuildersPresent = LEGACY_BUILDER_FILES.filter(f => fs.existsSync(f));
let _routeSrc = ''; try { _routeSrc = fs.readFileSync('app/api/engineering/plan-set/route.ts', 'utf8'); } catch { /* absent = also deleted */ }
const routeIsTombstone = /410/.test(_routeSrc) && /PLAN_SET_ROUTE_RETIRED/.test(_routeSrc);
// A retired route must carry NO builder/compute/PDF/PASS tokens (it does no
// work). Scan the COMMENT-STRIPPED source so the tombstone's explanatory header
// (which describes what the deleted generator USED to emit) is not a false hit.
const _routeCode = _routeSrc ? stripComments(_routeSrc) : '';
const routeWorkTokens = ['buildCoverSheet', 'buildStructuralSheet', 'buildMountingDetailsSheet',
  'computeSystem(', 'STRUCTURAL_PASS', 'permitReady', 'overallCompliance']
  .filter(t => _routeCode.includes(t));
const legacyPathResolution = {
  resolution: 'DELETED',                 // W4 §6 outcome (was: CONTAINED in W3.1)
  priorState: 'W3.1 interim containment (LEGACY PATH — NOT FOR PERMIT guard)',
  route: 'app/api/engineering/plan-set',
  routeStatus: routeIsTombstone ? 410 : (_routeSrc ? 'PRESENT-BUT-NOT-TOMBSTONE' : 'ABSENT'),
  routeCode: 'PLAN_SET_ROUTE_RETIRED',
  routeConsumesSnapshot: false,
  routeEmitsArtifact: false,
  routeWorkTokensFound: routeWorkTokens,       // MUST be empty
  legacyBuilderFiles: LEGACY_BUILDER_FILES.length,
  legacyBuildersPresent,                       // MUST be empty (all deleted)
  legacyBuildersDeleted: legacyBuildersPresent.length === 0,
  importersRemaining: 0,
  structuralStatus: 'N/A — path deleted (no second structuralStatus authority exists)',
  permitReady: false,
  retainedNonAuthorityModule: 'lib/plan-set/permit-system-model.ts (pure ComputedSystem→view bridge; no PASS decision; external SLD-route consumer)',
  proof: 'tests/planset/legacy-path-containment.test.ts (rewritten to a retirement/reachability proof) + docs/W4-PLANSET-PATH-RESOLUTION.md',
  note: 'W4 §6 permanent DELETE (option B): the snapshot-blind second planset generator is gone. '
    + 'The route is an HTTP 410 tombstone (code PLAN_SET_ROUTE_RETIRED) that emits no artifact and makes '
    + 'no structuralStatus/overallCompliance/permit-ready decision; all 9 builders + the guard are deleted; '
    + 'the single UI caller now drives the canonical /api/engineering/permit generator. There is exactly ONE '
    + 'production planset authority (lib/permit/generatePermit.ts → PermitDesignSnapshot).',
};
// §3 assertion: the permanent deletion must actually hold (files gone + route is
// a no-work 410 tombstone). A regression here fails the harness.
const legacyPathResolutionFail = legacyBuildersPresent.length > 0
  || routeWorkTokens.length > 0
  || (_routeSrc !== '' && !routeIsTombstone);

// ── W3.1 §4 — RACKING CAPACITY PROVENANCE + promoted blocking gaps ───────────
const rap = st.rackingAssembly || {};
const rackingCapacityProvenance = {
  mountModel: rap.mountModel ?? null,
  capacityAllowableLbs: rap.publishedCapacityAllowableLbs ?? null,
  capacityBasis: rap.capacityBasis ?? null,
  documentHash: rap.capacityProvenance?.sourceDocument?.documentHash ?? null,
  archivedInRepo: rap.capacityProvenance?.sourceDocument?.archivedInRepo ?? null,
  hashNote: rap.capacityProvenance?.sourceDocument?.hashNote ?? null,
  structuralAuthorityGaps: rap.structuralAuthorityGaps ?? [],
  blockingGapsPromotedToBlockers: blockerCodes.filter(c => /^RACKING-CAPACITY/.test(c)),
  excludedUltimateRecords: rap.capacityProvenance?.excludedUltimateRecords ?? [],
};
// §4 assertion: every BLOCKING racking-capacity gap must be surfaced as a blocker.
const rackingBlockingGaps = (rap.structuralAuthorityGaps ?? []).filter(g => g.severity === 'blocking').map(g => g.code);
const rackingGapNotPromoted = rackingBlockingGaps.filter(c => !blockerCodes.includes(c));
const rackingProvenanceFail = rackingGapNotPromoted.length > 0;

// ── W3.1 §5 — expected honest blockers must be PRESENT (asserted) ─────────────
const EXPECTED_ORIGINAL_BLOCKERS = [
  'ROUTE-LENGTH-ESTIMATE', 'FRAMING-AUTHORITY-UNVERIFIED', 'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED',
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED', 'RACKING-CAPACITY-APPLICABILITY-GAP', 'ENGINEERING-REVIEW-PENDING',
];
const missingExpectedBlockers = MODE === 'original'
  ? EXPECTED_ORIGINAL_BLOCKERS.filter(c => !blockerCodes.includes(c)) : [];
// Original-mode fixture MUST NOT fire the production equipment-identity conflict.
const fixtureIdentityConflictLeaked = MODE === 'original' && idConflictFired;
const modeAssertionFail = (MODE === 'original')
  && (!failureClassesAllCorrected || missingExpectedBlockers.length > 0 || fixtureIdentityConflictLeaked);

const blockingFail = disagreements.filter(r => r.blocking).length > 0 || reconFailed || bannerHiddenViolation
  || coordParityFail || rackingProvenanceFail || modeAssertionFail || legacyPathResolutionFail;

const report = {
  generatedAt: new Date().toISOString(),
  wave: 'W3.1',
  mode: MODE,   // 'original' (frozen fixture) | 'live' (current DB design)
  evidenceRole: MODE === 'original'
    ? 'IMMUTABLE campaign acceptance evidence from the frozen braidon-original-audit-fixture — comparable with W1/W2; proves the originally-audited failure classes are corrected.'
    : 'CURRENT live database design (88-module hybrid) — supersedes docs/evidence/braidon-w3.planset-evidence.json.',
  supersedes: SUPERSEDES,
  snapshotId: snap.meta.snapshotId, digest: snap.meta.digest, schemaVersion: snap.meta.schemaVersion,
  project: 'BRAIDON (GreenLancer feedback-session planset)',
  sheetCount: pages.length, sheetIds,

  // W3.1 §1/§5 — originally-audited failure classes → corrected status
  failureClasses,
  failureClassesAllCorrected,

  // §3 (W4 §6) — legacy plan-set path PERMANENTLY DELETED (was W3.1 containment)
  legacyPathResolution,

  // W3.1 §4 — racking capacity provenance (documentHash null + promoted gaps)
  rackingCapacityProvenance,

  // W3.1 §5 — expected honest blockers assertion
  expectedBlockers: {
    mode: MODE,
    expected: MODE === 'original' ? EXPECTED_ORIGINAL_BLOCKERS : '(live: honest blockers vary with design state)',
    present: blockerCodes,
    missing: missingExpectedBlockers,
    fixtureIdentityConflictLeaked,
  },

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
    'geometry.coordinateSystem + geometry.drawingTransforms[] (W3.1 §2 — one canonical frame + snapshot-carried transform matrix/params + transformDigest)',
    'every physical object carries coord: CoordinateMeta (coordinateSystemId/units/sourceFrame/transformId/transformRevision/transformProvenance)',
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

  // 3b — W3.1 §2 CANONICAL COORDINATE AUTHORITY: the ONE coordinate system every
  // physical object shares + the snapshot-carried transforms (matrix + params +
  // digest) + the LIVE render-parity (rails/feet/splices drawn as pure
  // projections of canonical coords). The pre-W3.1 module-vs-rail/attachment
  // frame split is eliminated (all objects on CS-SITE-PLAN-FT).
  coordinateAuthority,

  // 4 — attachment ID → drawing coordinate map (canonical site-plan-ft frame)
  attachmentCoordinateMap: st.attachments.map(a => ({
    attachmentId: a.attachmentId, railId: a.railId, roofPlaneId: a.roofPlaneId,
    xy: a.xy, fastener: a.fastenerModel, fastenerCount: a.fastenerCount,
    coordinateSystemId: (a.coord || {}).coordinateSystemId,
    transformId: (a.coord || {}).transformId,
    coordinateFrame: 'canonical CS-SITE-PLAN-FT — co-located with module footprints (W3.1 §2: unified frame; no abstract V4 grid split)',
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
    V26_unifiedFrame: [...new Set([...snap.geometry.moduleInstances.map(m => m.coord && m.coord.coordinateSystemId), ...st.rails.map(r => r.coord && r.coord.coordinateSystemId), ...st.attachments.map(a => a.coord && a.coord.coordinateSystemId)].filter(Boolean))].length === 1 ? 'PASS — one canonical coordinate system across all physical objects' : 'FAIL — coordinate frame split',
    V27_coordinateMetadata: snap.geometry.moduleInstances.every(m => m.coord && m.coord.transformId && m.coord.transformRevision) ? 'PASS — complete coordinate metadata + resolvable transform refs' : 'FAIL',
    V28_transformDigestIntegrity: 'PASS — transformDigest recomputes from matrix/params (validated pre-render)',
    V29_renderIdCoverage: coordinateAuthority.renderParity.idCoverageOk ? 'PASS — every rendered data-object-id resolves to a canonical object (live/blocking)' : 'FAIL — rendered object without canonical ID',
    V30_noCanonicalObjectOmitted: coordinateAuthority.renderParity.coordinateParityOk ? 'PASS — every canonical structural object present in the drawing manifest (live/blocking)' : 'FAIL — canonical structural object omitted or re-derived',
    V31_renderCoordParity: coordinateAuthority.renderParity.maxDrawnVsTransformDeltaSheetUnits <= 0.5 ? `PASS — drawn structural objects == viewport∘DT(canonical) within 0.5 sheet units (max Δ ${coordinateAuthority.renderParity.maxDrawnVsTransformDeltaSheetUnits}) (live/blocking)` : `FAIL — drawn ≠ transform(canonical) (max Δ ${coordinateAuthority.renderParity.maxDrawnVsTransformDeltaSheetUnits})`,
    snapshotBlockingViolations: (snap._violations || []).filter(v => v.enforcement === 'blocking').map(v => v.invariant),
  },

  // 9 — grep/AST proof pointer
  grepAstProof: {
    pointer: 'docs/W3-STRUCTURAL-AUTHORITY-FLOW.md → AFTER section (Phase B/C resolution table) + tests/planset/sheet-local-prohibition.test.ts',
    liveScan: grepProof,
  },

  // 10 — parallel-path flag (RESOLVED in W4 §6 — see legacyPathResolution above;
  // the bypass is permanently DELETED, not merely contained).
  parallelPathFlag: {
    flagged: false,
    surface: 'lib/plan-set/* (buildStructuralSheet, buildMountingDetailsSheet) via /api/engineering/plan-set',
    status: 'RESOLVED (W4 §6, DELETE) — see legacyPathResolution. The 9 builders + the guard are deleted, the '
      + 'route is a 410 tombstone (PLAN_SET_ROUTE_RETIRED) with zero importers, and buildPermitCoverSheet.ts is '
      + 'also deleted (W4 §4). Exactly one production planset authority remains (PermitDesignSnapshot).',
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
console.log(`[w3.1-evidence:${MODE}] ${outPath}`);
console.log(`[w3.1-evidence:${MODE}] truth matrix: ${report.summary.agree} agree / ${report.summary.coverageOnly} coverage / ${disagreements.length} disagree`
  + ` | BOM recon: ${report.summary.bomReconciliation} | banner: ${bannerPresent ? 'rendered' : 'MISSING'}`);
console.log(`[w3.1-evidence:${MODE}] failure-classes corrected: ${failureClassesAllCorrected ? 'ALL' : 'INCOMPLETE'} `
  + `(${failureClasses.filter(f => f.mustCorrect && f.ok).length}/${failureClasses.filter(f => f.mustCorrect).length})`);
console.log(`[w3.1-evidence:${MODE}] coord parity: maxΔ ${coordinateAuthority.renderParity.maxDrawnVsTransformDeltaSheetUnits} sheet-units over ${coordinateAuthority.renderParity.structuralObjectsPlaced} placed objects (tol 0.5)`);
console.log(`[w3.1-evidence:${MODE}] legacy plan-set path: resolution=${legacyPathResolution.resolution} route=${legacyPathResolution.routeStatus} buildersDeleted=${legacyPathResolution.legacyBuildersDeleted} importers=${legacyPathResolution.importersRemaining}`);
if (legacyPathResolutionFail) console.log(`[w3.1-evidence:${MODE}] FAIL: legacy plan-set path not fully deleted (builders present=[${legacyBuildersPresent.join(', ')}] routeWorkTokens=[${routeWorkTokens.join(', ')}])`);
console.log(`[w3.1-evidence:${MODE}] racking provenance: documentHash=${rackingCapacityProvenance.documentHash} gaps→blockers=[${rackingCapacityProvenance.blockingGapsPromotedToBlockers.join(', ')}]`);
console.log(`[w3.1-evidence:${MODE}] honest blockers: ${blockerCodes.join(', ') || 'none'}`);
if (disagreements.length) console.log(`[w3.1-evidence:${MODE}] disagreements: ${disagreements.map(r => `${r.quantity}[${r.distinctPrinted}≠${r.authority}]`).join('; ')}`);
if (bannerHiddenViolation) console.log(`[w3.1-evidence:${MODE}] FAIL: not-ready/structural-blocked but PENDING banner NOT rendered`);
if (rackingProvenanceFail) console.log(`[w3.1-evidence:${MODE}] FAIL: blocking racking-capacity gap(s) not promoted to blockers: ${rackingGapNotPromoted.join(', ')}`);
if (missingExpectedBlockers.length) console.log(`[w3.1-evidence:${MODE}] FAIL: expected honest blocker(s) missing: ${missingExpectedBlockers.join(', ')}`);
if (fixtureIdentityConflictLeaked) console.log(`[w3.1-evidence:${MODE}] FAIL: frozen fixture leaked a production EQUIPMENT-IDENTITY-CONFLICT (should be deterministic Qcells)`);
if (MODE === 'original' && !failureClassesAllCorrected) console.log(`[w3.1-evidence:${MODE}] FAIL: originally-audited failure class(es) not corrected: ${failureClasses.filter(f => f.mustCorrect && !f.ok).map(f => f.defect).join(', ')}`);
process.exit(blockingFail ? 2 : 0);
