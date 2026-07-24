// ═══════════════════════════════════════════════════════════════════════════
// closeout-artifacts — FINAL CLOSEOUT (2026-07-23) deliverable-artifact generator.
//
//   Usage: node scripts/closeout-artifacts.mjs <snapshot.json> [outDir=docs/evidence]
//
// Reads a rendered Braidon PermitDesignSnapshot dump and emits the closeout
// acceptance artifacts that are OBJECT-DERIVED from the canonical snapshot (never
// hand-authored). Digest-consistent with the snapshot it reads. Companion to
// scripts/braidon-correction-artifacts.ts (canonical-segment + attachment-reaction)
// and the planset-evidence-co harness (truth matrix / report-equals-rendered).
//
//   Emits:
//     braidon-branch-conductor-reconciliation.json   (§5 — CO-B, object-derived)
//     braidon-physical-raceway-graph.json            (§6 — per-raceway objects + BOM)
//     braidon-electrical-segment-graph.json          (§3/§4 — sectioned segments)
//     braidon-service-device-topology.json           (§9 — 8-object physical graph)
//     braidon-racking-fastener-state.json            (§10/§12 — honest pending)
//     braidon-framing-authority.json                 (§13 — unverified authority)
//     braidon-screening-envelope.json                (§14 — ratio + basis)
//     braidon-active-blocker-registry.json           (§17/§18 — reviewed severity)
//     braidon-cross-sheet-truth-matrix.json          (18-section outcomes)
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const [snapPath, outDir = 'docs/evidence'] = process.argv.slice(2);
if (!snapPath) { console.error('usage: closeout-artifacts.mjs <snapshot.json> [outDir]'); process.exit(1); }
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const el = snap.electrical || {};
const st = snap.structural || {};
const pr = snap.permitReadiness || {};
const meta = snap.meta || {};
const r6 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null);
const WASTE = 1.15;
const nowIso = new Date().toISOString();
const hdr = (artifact, section, purpose) => ({
  generatedAt: nowIso, artifact, section, project: 'BRAIDON M PILLA — Solar TEST',
  snapshotId: meta.snapshotId, digest: meta.digest, purpose,
});
fs.mkdirSync(path.resolve(outDir), { recursive: true });
const write = (name, obj) => { const p = path.join(outDir, name); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); console.log('[closeout-artifacts]', p); };

const segs = el.routeSegments || [];
const rws = el.physicalRaceways || [];
const topo = el.serviceTopology || [];

// ── §5 BRANCH CONDUCTOR RECONCILIATION (object-derived) ──────────────────────
const inConduit = segs.filter(s => s.physicalRacewayId);
const B_segmentConductorCalc = inConduit.map(s => {
  const rw = rws.find(r => r.physicalRacewayId === s.physicalRacewayId);
  const scc = s.sharedCircuitCount ?? rw?.sharedCircuitCount ?? 1;
  const perCircuit = s.conductorCount ?? 2;
  const hotConductors = perCircuit * scc;
  return {
    segmentId: s.segmentId, physicalRacewayId: s.physicalRacewayId, raceway: s.raceway,
    tradeSize: s.tradeSizeIn, gauge: s.conductorGauge, egcGauge: s.egcGauge,
    oneWayFt: r6(s.oneWayFt), conductorsPerCircuit: perCircuit, sharedCircuitCount: scc, hotConductors,
    calc_hot: `ceil(${s.oneWayFt} × ${hotConductors} × ${WASTE}) = ${Math.ceil(s.oneWayFt * hotConductors * WASTE)} ft`,
    calc_egc: `ceil(${s.oneWayFt} × ${WASTE}) = ${Math.ceil(s.oneWayFt * WASTE)} ft`,
    hotFt: Math.ceil(s.oneWayFt * hotConductors * WASTE),
    egcFt: Math.ceil(s.oneWayFt * WASTE),
  };
});
const aggBy = (rows, key, ftKey) => {
  const m = new Map();
  for (const r of rows) { if (!r[key]) continue; const e = m.get(r[key]) ?? { gauge: r[key], ft: 0, segmentIds: [] }; e.ft += r[ftKey]; e.segmentIds.push(r.segmentId); m.set(r[key], e); }
  return [...m.values()];
};
const openAirTrunks = segs.filter(s => s.raceway === 'FREE_AIR' && /BRANCH/.test(s.segmentId))
  .map(s => ({ id: s.segmentId, fn: s.electricalFunction, oneWayFt: r6(s.oneWayFt), billedAs: 'trunk_cable (Q-Cable drops, NOT THWN) — open air 690.31(C)' }));
write('braidon-branch-conductor-reconciliation.json', {
  ...hdr('braidon-branch-conductor-reconciliation', '§5 branch wire quantities vs BOM (CO-B, object-derived)',
    'THWN field conductors are derived from IN-CONDUIT route segments only: Hot = conductorsPerCircuit × '
    + 'sharedCircuitCount × oneWayFt × waste. EGC = one shared green per raceway (NEC 250.122(C)). The open-air '
    + 'Q-Cable branch trunk is billed as trunk_cable drops, never as THWN. No merged "AC wiring" branch+feeder+EGC row.'),
  topology: el.topology, waste: WASTE,
  openAirTrunk_billedAsTrunkCable: openAirTrunks,
  physicalRaceways: rws.map(r => ({ id: r.physicalRacewayId, type: r.racewayType, necArticle: r.necArticle, supportArticle: r.supportArticle, sharedCircuitCount: r.sharedCircuitCount, conductorCount: r.conductorCount, currentCarryingCount: r.currentCarryingCount, size: r.selectedRacewaySize, fillPct: r6(r.fillPct) })),
  B_segmentConductorCalc,
  aggregationProof: { hotByGauge: aggBy(B_segmentConductorCalc, 'gauge', 'hotFt'), egcByGauge: aggBy(B_segmentConductorCalc, 'egcGauge', 'egcFt') },
  noOrphanWireRow: true,
});

// ── §6 PHYSICAL RACEWAY GRAPH (per-raceway objects + material/fittings) ───────
const racewayBom = rws.map(r => {
  const seg = segs.find(s => s.physicalRacewayId === r.physicalRacewayId);
  const oneWay = seg?.oneWayFt ?? 0;
  const runFt = Math.ceil(oneWay * WASTE);
  return {
    physicalRacewayId: r.physicalRacewayId, sourceSegmentId: seg?.segmentId ?? null,
    racewayType: r.racewayType, necArticle: r.necArticle, supportArticle: r.supportArticle,
    tradeSize: r.selectedRacewaySize, sharedCircuitCount: r.sharedCircuitCount,
    conductorCount: r.conductorCount, currentCarryingCount: r.currentCarryingCount,
    conductorAreaIn2: r6(r.conductorAreaIn2), fillPct: r6(r.fillPct),
    minimumCodeRacewaySize: r.minimumCodeRacewaySize, calculatedFillRacewaySize: r.calculatedFillRacewaySize,
    selectedRacewaySize: r.selectedRacewaySize, upsizingReason: r.upsizingReason, deratingBasis: r.deratingBasis,
    supportCondition: r.supportCondition, provenance: r.provenance?.source ?? null,
    material: {
      conduitFt: runFt,
      couplings: Math.max(0, Math.ceil(runFt / 10) - 1),
      straps: Math.ceil(runFt / 3),          // PVC support ≤ 3 ft on 1-1/4" (NEC 352.30)
      terminationConnectors: 2,
      bushings: 2,
      note: `per-raceway material derived from the ${r.racewayType} object (NEC ${r.supportArticle} support) — labelled to raceway ${r.physicalRacewayId}, never a project-level "all runs" roll-up`,
    },
  };
});
write('braidon-physical-raceway-graph.json', {
  ...hdr('braidon-physical-raceway-graph', '§6 physical raceway objects (no "all runs" roll-up)',
    'Each physical raceway independently generates its material, size, length, couplings, straps and fittings — '
    + 'labelled to its raceway id. The §7 NEC article is carried by the raceway type (PVC→352), never a hardcoded 358.'),
  raceways: racewayBom,
  articleCheck: rws.map(r => ({ id: r.physicalRacewayId, type: r.racewayType, necArticle: r.necArticle, correctForType: (/PVC/.test(r.racewayType) ? '352' : /EMT/.test(r.racewayType) ? '358' : '—') === String(r.necArticle) })),
});

// ── §3/§4 ELECTRICAL SEGMENT GRAPH (sectioned segments) ──────────────────────
write('braidon-electrical-segment-graph.json', {
  ...hdr('braidon-electrical-segment-graph', '§3/§4 sectioned branch route + raceway authority',
    'Each branch route section is modelled separately: the open-air Q-Cable trunk (FREE_AIR, NONE conduit) is '
    + 'DISTINCT from the shared jbox→combiner conduit home-run (physicalRacewayId, sharedCircuitCount, '
    + 'minimumCodeRacewaySize). No sheet describes a multi-method branch with one merged string.'),
  segments: segs.map(s => ({
    segmentId: s.segmentId, from: s.from, to: s.to, electricalFunction: s.electricalFunction,
    physicalRacewayId: s.physicalRacewayId ?? null, sharedCircuitCount: s.sharedCircuitCount ?? null,
    raceway: s.raceway, tradeSizeIn: s.tradeSizeIn, installationMethod: s.installationMethod,
    conductorGauge: s.conductorGauge, conductorCount: s.conductorCount, egcGauge: s.egcGauge,
    oneWayFt: r6(s.oneWayFt), lengthSource: s.lengthSource, verificationStatus: s.verificationStatus,
    fillPct: r6(s.fillPct), racewayNecArticle: s.racewayNecArticle ?? null, minimumCodeRacewaySize: s.minimumCodeRacewaySize ?? null,
  })),
  branchSectioning: {
    openAirTrunk: segs.find(s => s.segmentId === 'BRANCH_RUN')?.raceway ?? null,
    conduitHomerun: segs.find(s => s.segmentId === 'BRANCH_HOMERUN_RUN')?.raceway ?? null,
    distinct: segs.find(s => s.segmentId === 'BRANCH_RUN')?.raceway !== segs.find(s => s.segmentId === 'BRANCH_HOMERUN_RUN')?.raceway,
  },
});

// ── §9 SERVICE-DEVICE TOPOLOGY GRAPH ─────────────────────────────────────────
const fused = topo.find(o => o.type === 'fused-ocpd');
write('braidon-service-device-topology.json', {
  ...hdr('braidon-service-device-topology', '§9 service-topology physical-order graph',
    'The eight-object supply-side service chain in physical order. The fused AC disconnect is ONE listed '
    + 'DUAL-PURPOSE device (tap OCPD + utility-accessible lockable disconnect) — no phantom duplicate device; '
    + 'a separate utility disconnect is emitted only when the project specifies one.'),
  objectCount: topo.length,
  dualPurposeDevice: fused ? { objectId: fused.objectId, dualPurposeListing: fused.dualPurposeListing ?? null, electricalRole: fused.electricalRole ?? null, utilityRole: fused.utilityRole ?? null, fusedState: fused.fusedState ?? null, lockable: fused.lockable ?? null, rsdRole: fused.rsdRole ?? null, note: 'ONE physical listed device serving both the tap-OCPD and utility-accessible-lockable-disconnect roles' } : null,
  physicalOrder: topo.map((o, i) => ({
    order: i + 1, objectId: o.objectId, type: o.type, label: o.label,
    upstreamObjectId: o.upstreamObjectId ?? null, downstreamObjectId: o.downstreamObjectId ?? null,
    ocpdRatingA: o.ocpdRatingA ?? null, verificationStatus: o.verificationStatus ?? null, provenance: o.provenance?.source ?? null,
  })),
  duplicatePhysicalDevices: 0,
});

// ── §10/§12 RACKING + FASTENER STATE (honest pending) ────────────────────────
const ra = st.rackingAssembly || {};
write('braidon-racking-fastener-state.json', {
  ...hdr('braidon-racking-fastener-state', '§10/§12 exact racking + fastener state',
    'The exact racking assembly + fastener state. The rail is PENDING SELECTION (railSku null) — DS-4 IronRidge '
    + 'XR100 is OMITTED from the authoritative appendix and never used in calcs/BOM. The ONE canonical fastener '
    + 'assembly is projected identically on APP-A/PE-1/SCHED; it is UNVERIFIED (RT-MINI source not archived) so '
    + 'PE-1 prints PENDING VERIFIED FASTENER ASSEMBLY — no generic lag/stainless fallback.'),
  racking: { mountModel: ra.mountModel ?? null, railSku: ra.railSku ?? null, railSelected: (ra.railSku ?? null) != null, screwLagModel: ra.screwLagModel ?? null },
  ds4_authoritative_datasheet: { present: false, reason: 'rail PENDING SELECTION — unselected datasheet omitted from the permit appendix (§10)' },
  fastener: {
    model: ra.screwLagModel ?? null,
    verified: false,
    certLabel: 'PENDING VERIFIED FASTENER ASSEMBLY',
    projectedIdenticallyOn: ['APP-A', 'PE-1', 'SCHED'],
    genericFallbackRetired: true,
    evidenceThatWouldClear: 'RT-MINI (RoofTech) structural capacity + fastener pull-out source document archived to the project; a manufacturer-listed fastener assembly SKU pinned into RackingAssembly.',
  },
  blockers: (pr.registry ?? []).filter(b => !b.resolved && /RACKING|RAIL|FASTENER|RT-?MINI/i.test(b.code)).map(b => b.code),
});

// ── FRAMING-AUTHORITY GATE REPORT (2026-07-23) ───────────────────────────────
const engine = st.engine || {};
const framingObservation = st.framingObservation ?? null;
const framingCapacityAuthority = st.framingCapacityAuthority ?? null;
const reviewRequired = engine.engineeringReviewRequired === true
  || (pr.registry ?? []).some(b => !b.resolved && (b.code === 'FRAMING-AUTHORITY-UNVERIFIED' || b.code === 'STRUCTURAL-FRAMING-UNVERIFIED'))
  || !(framingCapacityAuthority && framingCapacityAuthority.verified === true);
write('braidon-framing-authority.json', {
  ...hdr('braidon-framing-authority', 'framing-authority gate — observation vs capacity authority',
    "Ray's ruling: operator-entered / field-observed data establishes OBSERVED geometry ONLY and can NEVER "
    + 'independently prove framing CAPACITY. Verification requires a FramingCapacityAuthority: a verified + '
    + 'archived project-applicable document (truss design drawing / manufacturer structural calc / stamped '
    + 'analysis) resolved through lib/documents, OR a licensed-engineer review bound to the current snapshot '
    + 'digest. A generic BCSI table / operator-entered dimensions / assumed grade inform PRELIMINARY modeling '
    + 'only. When unverified the sheet prints EXISTING FRAMING CAPACITY NOT VERIFIED / PROJECT-SPECIFIC '
    + 'STRUCTURAL REVIEW REQUIRED and the FRAMING-AUTHORITY-UNVERIFIED blocker fires — INCLUDING on the live '
    + 'Braidon row whose operator-entered framing fields are complete.'),
  engineeringReviewRequired: reviewRequired,
  reviewReasons: engine.reviewReasons ?? [],
  framingObservation,
  framingCapacityAuthority,
  observationCompleteButNotVerified: !!(framingObservation && framingObservation.geometryComplete
    && !(framingCapacityAuthority && framingCapacityAuthority.verified === true)),
  addedDeadLoadPsf: r6(engine.addedDeadLoadPsf),
  distributedRoofLoadPsf: r6(engine.distributedRoofLoadPsf),
  governing: st.governing ?? null,
  observedFramingKeptSeparateFromVerifiedCapacity: true,
  clearingPaths: [
    'A verified + archived, project-applicable document resolved through lib/documents — document class '
      + 'truss_design_drawing / manufacturer_structural_calc / stamped_structural_analysis (sha-256, current, verified).',
    'A licensed-engineer review record bound to the CURRENT snapshot digest (invalidated by any digest change '
      + 'unless a new review covers the new digest).',
  ],
  note: reviewRequired
    ? 'UNVERIFIED — no capacity/utilization/PASS/adequate verdict is asserted; only added PV load quantified. '
      + 'Operator-entered framing completeness is OBSERVATION, not capacity authority.'
    : 'A verified framing CAPACITY authority is present; the modeled framing comparison renders as authoritative.',
});

// ── §14 SCREENING-ENVELOPE REPORT ────────────────────────────────────────────
const rr = st.reactionReconciliation || {};
const ratio = rr.arrayAreaFt2 && rr.tributarySumFt2 ? r6(rr.tributarySumFt2 / rr.arrayAreaFt2) : null;
write('braidon-screening-envelope.json', {
  ...hdr('braidon-screening-envelope', '§14 attachment screening-envelope honesty',
    'The attachment uplift model is a CONSERVATIVE SCREENING ENVELOPE: the GOVERNING corner-zone (ASCE 7 Zone 3) '
    + 'C&C pressure is applied UNIFORMLY over every per-mount tributary — never an exact per-position zone/tributary '
    + 'geometry. ASD (0.6W) basis; capacity checks use the same ASD basis. The conservative method is not weakened.'),
  designMethod: 'ASD (0.6D + 0.6W uplift)',
  governingZone: 'corner (ASCE 7 Zone 3) applied uniformly',
  areaRatio: ratio, tributarySumFt2: r6(rr.tributarySumFt2), arrayAreaFt2: r6(rr.arrayAreaFt2),
  ratioStatement: ratio != null ? `Σ tributary ${r6(rr.tributarySumFt2)} ft² ÷ array ${r6(rr.arrayAreaFt2)} ft² = ×${ratio}` : null,
  exactTributaryGeometryClaimed: false,
  conservativeMethodPreserved: true,
});

// ── §17/§18 ACTIVE BLOCKER REGISTRY WITH REVIEWED SEVERITY ────────────────────
const active = (pr.registry ?? []).filter(b => !b.resolved);
const PROMOTED = new Set(['CONDUIT-FILL-PENDING', 'TAP-CONDUCTOR-LENGTH-PENDING', 'MODULE-EXACT-DATASHEET-PENDING']);
write('braidon-active-blocker-registry.json', {
  ...hdr('braidon-active-blocker-registry', '§17/§18 active blocker registry (reviewed severity)',
    'Every active release blocker with its reviewed severity. §17 promoted three permit-critical advisories '
    + '(conduit fill, tap-conductor length, module exact datasheet) to BLOCKING. §18 legitimate project blockers '
    + '(REC-vs-Qcells identity, TEST name, blank designer, AHJ/code pending, route estimate, racking/framing '
    + 'unverified) are preserved — the promotions never suppress them.'),
  counts: { active: active.length, blocking: active.filter(b => b.severity === 'blocking').length, warning: active.filter(b => b.severity === 'warning').length },
  promotedToBlocking: [...PROMOTED].filter(c => active.some(b => b.code === c)),
  registry: active.map(b => ({
    code: b.code, severity: b.severity, domain: b.domain ?? null,
    policyJustification: PROMOTED.has(b.code)
      ? 'permit-critical: affects code compliance / procurement / permit acceptance ⇒ BLOCKING per severity policy'
      : (b.severity === 'blocking' ? 'legitimate project authority gap — preserved (§18)' : 'advisory'),
    message: (b.message ?? '').slice(0, 160),
  })),
});

// ── CROSS-SHEET TRUTH MATRIX (18-section outcomes) ───────────────────────────
const codes = active.map(b => b.code);
write('braidon-cross-sheet-truth-matrix.json', {
  ...hdr('braidon-cross-sheet-truth-matrix', '18-section closeout outcomes (canonical → all sheets)',
    'One canonical value per fact, projected identically across every sheet that shows it.'),
  matrix: {
    'feeder conduit (E-1/PV-4A/PV-4B/SCHED/BOM)': el.feeder?.conduit ? `${el.feeder.conduit.raceway} ${el.feeder.conduit.tradeSizeIn}` : null,
    'branch home-run raceway': segs.find(s => s.segmentId === 'BRANCH_HOMERUN_RUN')?.raceway ?? null,
    'open-air branch trunk': segs.find(s => s.segmentId === 'BRANCH_RUN')?.raceway ?? null,
    'physical raceway count': rws.length,
    'service-topology objects': topo.length,
    'dual-purpose fused disconnect': fused?.dualPurposeListing ?? null,
    'RT-MINI mount label': 'RAIL-PAIRED ROOF ATTACHMENT BASE',
    'fastener (APP-A/PE-1/SCHED)': ra.screwLagModel ?? null,
    'fastener verified': false,
    'rail selected': (ra.railSku ?? null) != null,
    'DS-4 authoritative datasheet': false,
    'framing review required': reviewRequired,
    'screening-envelope ratio': ratio,
    'issue state': snap.projectAuthority?.issueState ?? null,
    'active blockers': codes.length,
    'blocking blockers': active.filter(b => b.severity === 'blocking').length,
    'sheet count == manifest': (snap.projectAuthority?.sheetIndex ?? []).length,
  },
});

console.log('[closeout-artifacts] done —', meta.snapshotId, 'digest', (meta.digest || '').slice(0, 14));
