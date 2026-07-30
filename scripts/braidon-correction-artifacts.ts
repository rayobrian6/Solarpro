// ═══════════════════════════════════════════════════════════════════════════
// braidon-correction-artifacts — post-campaign correction (2026-07-22) acceptance
// artifacts. Reads a rendered Braidon PermitDesignSnapshot dump and emits the two
// reconciliation evidence files the correction acceptance list requires:
//
//   1. braidon-attachment-reaction-reconciliation.json  (§8)
//      per-attachment id/zone/tributary/dead/snow/uplift + Σtributary vs array
//      area, Σreactions vs applied×area per limit state, ratios, verdict.
//   2. braidon-canonical-segment-report.json            (§3/§5/§6)
//      EVERY canonical route segment + service-topology object: id, raceway,
//      size, conductors, EGC, length+lengthSource, VD, OCPD, constraint states —
//      the EXACT single set every electrical sheet (E-1/PV-4A/PV-4B/SCHED/BOM)
//      projects. Includes the projectCanonicalFeeder read (the sole feeder authority).
//
//   Usage: tsx scripts/braidon-correction-artifacts.ts <snapshot.json> [outDir]
//     -> <outDir>/braidon-attachment-reaction-reconciliation.json
//        <outDir>/braidon-canonical-segment-report.json   (default docs/evidence)
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { projectCanonicalFeeder, routeProvenanceLabel } from '../lib/permit/snapshot/electricalProjection';
import type { PermitDesignSnapshot } from '../lib/permit/snapshot/types';

const [snapPath, outDir = 'docs/evidence'] = process.argv.slice(2);
if (!snapPath) { console.error('usage: braidon-correction-artifacts.ts <snapshot.json> [outDir]'); process.exit(1); }
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as PermitDesignSnapshot;
const r6 = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null);

// ── §8 ATTACHMENT / REACTION RECONCILIATION ──────────────────────────────────
const st = snap.structural;
const rr = st.reactionReconciliation;
const attachments = st.attachments ?? [];
const schedule = attachments.map(a => ({
  attachmentId: a.attachmentId,
  roofPlaneId: a.roofPlaneId,
  railId: a.railId || null,
  zone: a.roofZone,
  substrateMember: a.substrateMember,
  attachmentMethod: a.attachmentMethod,
  fastenerModel: a.fastenerModel,
  fastenerCount: a.fastenerCount,
  tributaryAreaFt2: r6(a.tributaryAreaFt2),
  deadReactionLbs: r6(a.deadReactionLbs),
  snowReactionLbs: r6(a.snowReactionLbs),
  upliftReactionLbs: r6(a.upliftReactionLbs),
  downwardReactionLbs: r6(a.downwardReactionLbs),
  lateralReactionLbs: r6(a.lateralReactionLbs),
  allowableCapacityLbs: r6(a.allowableCapacityLbs),
  utilization: r6(a.utilization),
  safetyFactor: r6(a.safetyFactor),
}));
const sum = (f: (a: typeof schedule[number]) => number | null) =>
  r6(schedule.reduce((t, a) => t + (f(a) ?? 0), 0));

// applied load × array area per limit state (expected) vs Σ attachment reactions (actual)
const area = rr.arrayAreaFt2;
const limitStates = [
  { limitState: 'uplift (0.6W ASD)', appliedPsf: rr.appliedUpliftPsfAsd,
    expectedLbs: area != null && rr.appliedUpliftPsfAsd != null ? r6(area * rr.appliedUpliftPsfAsd) : null,
    actualSumLbs: rr.upliftReactionSumLbs, attachmentSumLbs: sum(a => a.upliftReactionLbs) },
  { limitState: 'snow (roof snow psf)', appliedPsf: rr.appliedSnowPsf,
    expectedLbs: area != null && rr.appliedSnowPsf != null ? r6(area * rr.appliedSnowPsf) : null,
    actualSumLbs: rr.snowReactionSumLbs, attachmentSumLbs: sum(a => a.snowReactionLbs) },
  { limitState: 'dead (added dead psf)', appliedPsf: rr.appliedDeadPsf,
    expectedLbs: area != null && rr.appliedDeadPsf != null ? r6(area * rr.appliedDeadPsf) : null,
    actualSumLbs: rr.deadReactionSumLbs, attachmentSumLbs: sum(a => a.deadReactionLbs) },
].map(ls => ({
  ...ls,
  reactionVsAppliedRatio: ls.expectedLbs && ls.actualSumLbs != null && ls.expectedLbs !== 0
    ? r6(ls.actualSumLbs / ls.expectedLbs) : null,
}));

const reconciliationArtifact = {
  generatedAt: new Date().toISOString(),
  artifact: 'braidon-attachment-reaction-reconciliation',
  section: '§8 structural reconciliation (post-campaign correction 2026-07-22)',
  project: 'BRAIDON (GreenLancer feedback-session planset)',
  snapshotId: snap.meta?.snapshotId, digest: snap.meta?.digest,
  purpose: 'Reconcile the attachment OBJECT count + Σ tributary + Σ reactions back to the applied '
    + 'wind/snow/dead loads over the array footprint. Blocks when the object count and reaction model '
    + 'disagree, or Σ tributary drops below the array footprint (lost load). This is the schedule the '
    + 'audit demanded: 636 ft² / 55.95 psf / 64 attachments must reconcile — not a bare 369 lb/attachment.',
  reconciliation: {
    present: rr.present, ok: rr.ok, verdict: rr.ok ? 'RECONCILED' : 'BLOCKED',
    attachmentCount: rr.attachmentCount,
    reactionModelCount: rr.reactionModelCount,
    countAgrees: rr.attachmentCount === rr.reactionModelCount,
    arrayAreaFt2: r6(rr.arrayAreaFt2),
    tributarySumFt2: r6(rr.tributarySumFt2),
    tributaryVsAreaRatio: rr.arrayAreaFt2 && rr.tributarySumFt2 != null && rr.arrayAreaFt2 !== 0
      ? r6(rr.tributarySumFt2 / rr.arrayAreaFt2) : null,
    tolerance: rr.tolerance,
    limitStates,
    checks: rr.checks,
    note: rr.note,
  },
  attachmentSchedule: schedule,
  scheduleTotals: {
    attachments: schedule.length,
    tributaryAreaFt2: sum(a => a.tributaryAreaFt2),
    deadReactionLbs: sum(a => a.deadReactionLbs),
    snowReactionLbs: sum(a => a.snowReactionLbs),
    upliftReactionLbs: sum(a => a.upliftReactionLbs),
  },
  capacityDisclaimer: 'Attachment allowableCapacityLbs / utilization / safetyFactor are DEMAND-side and '
    + 'gravity/uplift reactions only. The RT-MINI 600 lb allowable is UNVERIFIED / PENDING STRUCTURAL SOURCE '
    + '(RACKING-CAPACITY-SOURCE-NOT-ARCHIVED blocker firing); no capacity PASS is derived from it.',
};

// ── §3/§5/§6 CANONICAL SEGMENT REPORT ────────────────────────────────────────
const el = snap.electrical;
const feeder = projectCanonicalFeeder(snap);
const routeSegments = (el.routeSegments ?? []).map(s => ({
  segmentId: s.segmentId, from: s.from, to: s.to,
  oneWayFt: r6(s.oneWayFt), lengthSource: s.lengthSource,
  raceway: s.raceway, tradeSizeIn: s.tradeSizeIn, fillPct: r6(s.fillPct),
  conductorGauge: s.conductorGauge, egcGauge: s.egcGauge,
  voltageDropPct: r6(s.voltageDropPct), ocpdA: s.ocpdA, tempDeratingFactor: r6(s.tempDeratingFactor),
  provenance: s.provenance?.source ?? null,
}));
const serviceTopology = (el.serviceTopology ?? []).map(o => ({
  objectId: o.objectId, type: o.type, label: o.label, description: o.description,
  conductorSpec: o.conductorSpec, ocpdRatingA: o.ocpdRatingA,
  lengthFt: r6(o.lengthFt), lengthSource: o.lengthSource,
  constraints: o.constraints.map(c => ({ code: c.code, description: c.description, limitFt: c.limitFt, state: c.state })),
  provenance: o.provenance?.source ?? null,
}));

const segmentArtifact = {
  generatedAt: new Date().toISOString(),
  artifact: 'braidon-canonical-segment-report',
  section: '§3 segment authority / §5 service topology / §6 route provenance (correction 2026-07-22)',
  project: 'BRAIDON (GreenLancer feedback-session planset)',
  snapshotId: snap.meta?.snapshotId, digest: snap.meta?.digest,
  purpose: 'The EXACT single set of canonical electrical objects every sheet (E-1/PV-4A/PV-4B/SCHED/BOM) '
    + 'projects. One raceway/size/VD/length per run — the displayed length equals the length used in the '
    + 'formula; the six-object service chain is modelled separately so the ≤10-ft tap rule is never '
    + 'conflated with a downstream feeder run.',
  routeProvenanceLabel: routeProvenanceLabel(snap),
  canonicalFeederProjection: {
    feederSegmentId: feeder.segment?.segmentId ?? null,
    raceway: feeder.raceway, tradeSizeIn: feeder.tradeSizeIn, conduitLabel: feeder.conduitLabel,
    fillPct: r6(feeder.fillPct), voltageDropPct: r6(feeder.voltageDropPct), oneWayFt: r6(feeder.oneWayFt),
    gauge: feeder.gauge, egcGauge: feeder.egcGauge, ocpdA: feeder.ocpdA,
    continuousA: r6(feeder.continuousA), currentA: r6(feeder.currentA),
    conductorCallout: feeder.conductorCallout, lengthSource: feeder.lengthSource,
    hasHole: feeder.hasHole, holes: feeder.holes,
    note: 'This is the ONE feeder read every sheet projects (lib/permit/snapshot/electricalProjection). '
      + 'No sheet derives its own raceway/size/VD; the 3/4"-vs-1"-vs-1-1/4" and 1.11%-vs-0.37% conflicts are gone.',
  },
  routeSegments,
  serviceTopology,
  counts: {
    routeSegments: routeSegments.length,
    serviceTopologyObjects: serviceTopology.length,
    serviceTopologyTypes: serviceTopology.map(o => o.type),
    tapConductorRule: (() => {
      const tap = serviceTopology.find(o => o.type === 'tap-conductors');
      const rule = tap?.constraints.find(c => /705\.11/.test(c.code));
      return rule ? { code: rule.code, limitFt: rule.limitFt, state: rule.state, lengthFt: tap?.lengthFt ?? null } : null;
    })(),
  },
};

fs.mkdirSync(path.resolve(outDir), { recursive: true });
const p1 = path.join(outDir, 'braidon-attachment-reaction-reconciliation.json');
const p2 = path.join(outDir, 'braidon-canonical-segment-report.json');
fs.writeFileSync(p1, JSON.stringify(reconciliationArtifact, null, 2));
fs.writeFileSync(p2, JSON.stringify(segmentArtifact, null, 2));
console.log(`[artifacts] ${p1}`);
console.log(`[artifacts] reconciliation: verdict=${reconciliationArtifact.reconciliation.verdict}`
  + ` attach=${rr.attachmentCount}=${rr.reactionModelCount}? tribΣ=${reconciliationArtifact.reconciliation.tributarySumFt2}ft²`
  + ` area=${reconciliationArtifact.reconciliation.arrayAreaFt2}ft² ratio=${reconciliationArtifact.reconciliation.tributaryVsAreaRatio}`);
console.log(`[artifacts] ${p2}`);
console.log(`[artifacts] segments: ${routeSegments.length} route + ${serviceTopology.length} service-topology`
  + ` | feeder ${feeder.conduitLabel} @ ${r6(feeder.voltageDropPct)}% | provenance "${routeProvenanceLabel(snap)}"`);
