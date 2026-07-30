// ═══════════════════════════════════════════════════════════════════════════
// repair-pass-artifacts — emits the docs/evidence/ acceptance artifacts from the
// REPAIRED live PermitDesignSnapshot + rendered package HTML. Every report reads
// the CANONICAL object model (no re-derivation); the attachment-reaction artifact
// INDEPENDENTLY recomputes the envelope totals from the per-attachment objects
// and compares them to the snapshot reconciliation (fails loud on divergence).
//
//   Usage: node scripts/repair-pass-artifacts.mjs <snapshot.json> <package.html>
//   Writes docs/evidence/braidon-*.json (+ physical-page-count) — READ-ONLY on the repo.
import fs from 'node:fs';
import path from 'node:path';

const [snapPath, htmlPath] = process.argv.slice(2);
if (!snapPath || !htmlPath) { console.error('usage: repair-pass-artifacts.mjs <snapshot.json> <package.html>'); process.exit(1); }
const repoRoot = process.cwd();
const EVID = path.resolve(repoRoot, 'docs/evidence');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const rawHtml = fs.readFileSync(htmlPath, 'utf8');
const el = snap.electrical || {};
const st = snap.structural || {};
const pa = snap.projectAuthority || {};
const pr = snap.permitReadiness || {};
const meta = snap.meta || {};
const write = (name, obj) => { fs.writeFileSync(path.join(EVID, name), JSON.stringify(obj, null, 2)); console.log('  wrote docs/evidence/' + name); };
const round = (n, d = 3) => (typeof n === 'number' && isFinite(n)) ? Math.round(n * 10 ** d) / 10 ** d : n;

const DISCLAIMER = 'Live-mode artifact from the REPAIRED snapshot ' + meta.snapshotId + ' (digest ' + (meta.digest || '').slice(0, 16)
  + '…). NOT historical: it describes the current live Braidon design, not the originally-delivered PDS-310… package. '
  + 'Digests differ across regens because inputs drift (wind/Nearmap/module resolution), not because the engine is nondeterministic.';
const stamp = { generatedAt: new Date().toISOString(), snapshotId: meta.snapshotId, digest: meta.digest, engineVersion: meta.engineVersion, disclaimer: DISCLAIMER };

// ── 1. Canonical segment report (full per-segment fields + topology edges) ─────
const segments = el.routeSegments || [];
const svc = Object.values(el.serviceTopology || {});
const topoEdges = svc.flatMap(d => (d.conductorSegmentIds || d.segmentIds || []).map(sid => ({
  device: d.deviceId || d.id, role: d.function || d.role || d.serviceFunction, segmentId: sid,
  upstream: d.upstream ?? null, downstream: d.downstream ?? null,
})));
write('braidon-canonical-segment-report.json', {
  ...stamp, role: 'W1/W2 — ONE canonical ElectricalRouteSegment per physically distinct section; every field enumerated. Service-topology graph edges reference canonical segment IDs.',
  topology: el.topology, engineOfRecord: el.engineOfRecord,
  segmentCount: segments.length,
  segments: segments.map(s => ({ ...s })),
  serviceTopology: svc.map(d => ({ ...d })),
  serviceTopologyEdges: topoEdges,
  feeder: el.feeder,
  gaps: el.gaps || [],
});

// ── 2. Grounding-object report ────────────────────────────────────────────────
write('braidon-grounding-report.json', {
  ...stamp, role: 'W2 — canonical grounding/bonding objects (EGC + equipment bonding), each referencing its segment + code/listing basis.',
  count: (el.groundingObjects || []).length,
  groundingObjects: (el.groundingObjects || []).map(g => ({ ...g })),
});

// ── 3. BOM-to-object reconciliation ───────────────────────────────────────────
write('braidon-bom-to-object-reconciliation.json', {
  ...stamp, role: 'W4/W10 — every structural BOM row derives from canonical objects (objectCount/derivedFrom/provenance); reconciliation asserts row⇔object agreement.',
  structuralBom: (st.bom || []).map(r => ({ key: r.key, category: r.category, item: r.item, qty: r.qty, unit: r.unit, partNumber: r.partNumber, objectCount: r.objectCount, derivedFrom: r.derivedFrom, aggregation: r.aggregation })),
  bomReconciliation: st.bomReconciliation || null,
});

// ── 4. Equipment/document projection report (APP-A field → document map) ───────
const appA = [];
for (const m of rawHtml.matchAll(/data-app-a-field="([^"]*)"([^>]*)>([^<]*)</g)) {
  const attrs = m[2];
  appA.push({
    fieldPath: m[1],
    renderedValue: m[3].trim(),
    verify: (attrs.match(/data-verify="([^"]*)"/) ?? [])[1] ?? null,
    equipmentRecordId: (attrs.match(/data-eq-id="([^"]*)"/) ?? [])[1] ?? null,
    sku: (attrs.match(/data-sku="([^"]*)"/) ?? [])[1] ?? null,
    documentRecordId: (attrs.match(/data-doc-id="([^"]*)"/) ?? [])[1] ?? null,
  });
}
write('braidon-equipment-document-projection.json', {
  ...stamp, role: 'W5 — APP-A projects ONLY from versioned verified equipment/document records; each displayed value carries equipment record ID + exact SKU + document record ID + verification state.',
  appAFieldCount: appA.length,
  everyFieldProvenanceComplete: appA.every(f => f.verify !== 'verified-document' || (f.equipmentRecordId && f.documentRecordId && f.sku)),
  appAFieldToDocumentMap: appA,
  equipmentSummary: pa.equipmentSummary || null,
});

// ── 5. Racking assembly report (pending state honest) ─────────────────────────
const ra = st.rackingAssembly || {};
write('braidon-racking-assembly-report.json', {
  ...stamp, role: 'W6 — the exact selected RackingAssembly. RT-MINI mount is rail_paired; rail SKU / span-cantilever authority and capacity document are PENDING — reported honestly, no fabrication.',
  assemblyId: ra.assemblyId, mount: { manufacturer: ra.mountManufacturer, model: ra.mountModel, sku: ra.mountSku },
  rail: { manufacturer: ra.railManufacturer, model: ra.railModel, sku: ra.railSku, stockLengthIn: ra.railStockLengthIn, spanCantileverSource: ra.spanCantileverSource },
  fastener: { model: ra.screwLagModel, qtyPerMount: ra.screwLagQtyPerMount, embedmentIn: ra.embedmentRequirementIn, pilotHole: ra.pilotHoleRequired },
  capacity: { publishedAllowableLbs: ra.publishedCapacityAllowableLbs, basis: ra.capacityBasis, source: ra.capacitySource, datasheetRevision: ra.datasheetRevision, ul2703: ra.ul2703ListingBasis, iccEs: ra.iccEsReport },
  mixedManufacturer: ra.mixedManufacturer, assemblySupported: ra.assemblySupported, assemblyVerification: ra.assemblyVerification,
  structuralAuthorityGaps: ra.structuralAuthorityGaps || [], capacityProvenance: ra.capacityProvenance || null,
  pendingStateHonest: ra.assemblySupported !== true,
  notes: ra.notes,
});

// ── 6. Attachment reaction artifact — INDEPENDENT recompute from objects ───────
const atts = st.attachments || [];
const sum = (f) => atts.reduce((a, x) => a + (Number(x[f]) || 0), 0);
const indep = {
  attachmentCount: atts.length,
  tributarySumFt2: round(sum('tributaryAreaFt2')),
  upliftReactionSumLbs: round(sum('upliftReactionLbs')),
  deadReactionSumLbs: round(sum('deadReactionLbs')),
  snowReactionSumLbs: round(sum('snowReactionLbs')),
  distinctZones: [...new Set(atts.map(a => a.roofZone))],
  distinctTributary: [...new Set(atts.map(a => round(a.tributaryAreaFt2)))],
};
const rr = st.reactionReconciliation || {};
const recomputeMatches = {
  attachmentCount: indep.attachmentCount === rr.attachmentCount,
  tributarySum: Math.abs(indep.tributarySumFt2 - (rr.tributarySumFt2 ?? NaN)) < 0.5,
  upliftSum: Math.abs(indep.upliftReactionSumLbs - (rr.upliftReactionSumLbs ?? NaN)) < 1,
  deadSum: Math.abs(indep.deadReactionSumLbs - (rr.deadReactionSumLbs ?? NaN)) < 1,
};
const recomputeOk = Object.values(recomputeMatches).every(Boolean);
write('braidon-attachment-reaction-reconciliation.json', {
  ...stamp, role: 'W7 — per-attachment reaction artifact (id/rail/plane/zone/tributary/pressure/basis/reactions/capacity/provenance). This harness INDEPENDENTLY recomputes the envelope totals from the objects and compares to the snapshot reconciliation.',
  basisLabel: 'CONSERVATIVE SCREENING ENVELOPE — every mount (end mounts included) charged a full interior tributary; Σ tributary ≥ array footprint is intentional and documented, not an exact geometric distribution.',
  loadBasis: st.loads || null, governing: st.governing || null,
  snapshotReconciliation: rr,
  independentRecompute: indep,
  recomputeMatchesSnapshot: recomputeMatches,
  recomputeOk,
  attachments: atts.map(a => ({ attachmentId: a.attachmentId, railId: a.railId, roofPlaneId: a.roofPlaneId, coord: a.coord ?? a.xy, roofZone: a.roofZone, zoneModel: a.zoneModel, tributaryAreaFt2: a.tributaryAreaFt2, zonePressurePsf: a.zonePressurePsf, loadBasis: a.loadBasis, upliftReactionLbs: a.upliftReactionLbs, downwardReactionLbs: a.downwardReactionLbs, deadReactionLbs: a.deadReactionLbs, lateralReactionLbs: a.lateralReactionLbs, allowableCapacityLbs: a.allowableCapacityLbs, safetyFactor: a.safetyFactor, utilization: a.utilization, provenance: a.provenance })),
});
if (!recomputeOk) { console.error('  ✗ FAIL: independent reaction recompute diverges from snapshot reconciliation', recomputeMatches); process.exitCode = 3; }

// ── 7. Structural basis reconciliation ────────────────────────────────────────
write('braidon-structural-basis-reconciliation.json', {
  ...stamp, role: 'W7/W8 — one canonical load basis per check (ASD/LRFD, wind pressure basis, load combination, zone pressure, adjustments); the 3.0× band is retired for separate closure/envelope/lost-load/duplicate-area/count checks.',
  loads: st.loads || null, governing: st.governing || null, env: st.env || null,
  reactionReconciliation: rr,
  reconciliationChecks: (rr.checks || []).map(c => ({ name: c.name, limitState: c.limitState, expected: c.expected, actual: c.actual, ratio: c.ratio, ok: c.ok, basis: c.basis })),
  tolerance: rr.tolerance,
  note: rr.note,
});

// ── 8. Active blocker registry dump ───────────────────────────────────────────
const registry = (pr.registry || []).filter(r => !r.resolved);
write('braidon-active-blocker-registry.json', {
  ...stamp, role: 'W10 — canonical PermitReadinessBlocker registry (every active release blocker). RS-1 renders ALL of these; the harness gate 14 proves none is omitted.',
  ready: pr.ready === true,
  activeCount: registry.length,
  blockingCount: registry.filter(r => r.severity === 'blocking').length,
  advisoryCount: registry.filter(r => r.severity !== 'blocking').length,
  registry: registry.map(r => ({ code: r.code, severity: r.severity, domain: r.domain, authorityPath: r.authorityPath, affectedSheets: r.affectedSheets, explanation: r.explanation, resolutionAction: r.resolutionAction, provenance: r.provenance, createdAtIso: r.createdAtIso, createdVersion: r.createdVersion, resolved: r.resolved })),
});

// ── 9. Equipment-reconciliation audit evidence (NONE EXISTS — conflict ACTIVE) ─
const conflict = registry.find(r => r.code === 'EQUIPMENT-IDENTITY-CONFLICT') || null;
write('braidon-equipment-reconciliation-audit.json', {
  ...stamp, role: 'W10 — equipment-reconciliation audit evidence. STATE: NO reconciliation record exists. The REC-405 vs Qcells-400 identity conflict is ACTIVE and UNRESOLVED (no operator reconciliation occurred; migration 110/114 written but not run by Ray).',
  reconciliationRecordExists: false,
  conflictActive: !!conflict,
  conflict: conflict ? { code: conflict.code, domain: conflict.domain, explanation: conflict.explanation, resolutionAction: conflict.resolutionAction, resolved: conflict.resolved } : null,
  statement: 'NONE EXISTS — the equipment-identity conflict is surfaced (RS-1 + banner union + issue-state gate) and requires OPERATOR reconciliation; it is NEVER auto-resolved and is not hidden by any renderer.',
});

// ── 10. Physical page-count report (manifest vs rendered; screenshots appended later) ──
const pages = rawHtml.split(/<div class="page(?: sld-page)?"[ >]/).slice(1);
const sheetIds = pages.map(p => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?');
const manifestIds = (pa.sheetIndex || []).map(s => s.id);
write('braidon-physical-page-count.json', {
  ...stamp, role: 'W9 — one physical page per logical sheet. Rendered logical sheet set === manifest; Playwright element-screenshot count (appended by the shoot step) must equal this.',
  logicalSheetCount: pages.length, renderedSheetIds: sheetIds,
  manifestSheetCount: manifestIds.length, manifestSheetIds: manifestIds,
  renderedEqualsManifest: JSON.stringify(sheetIds) === JSON.stringify(manifestIds),
  everySheetTitled: sheetIds.every(id => id && id !== '?'),
  playwrightScreenshotCount: null,
  note: 'screenshots dir + count filled by scripts/planset-shoot after the Chromium element-screenshot pass.',
});

console.log('[repair-pass-artifacts] done. reaction recompute ok=' + recomputeOk);
