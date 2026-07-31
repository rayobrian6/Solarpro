// ═══════════════════════════════════════════════════════════════════════════
// rgm-model-evidence.ts — the §10 RELEASE-GATE MODEL evidence block.
//
//   Usage: tsx scripts/rgm-model-evidence.ts <snapshot.json> <out.json>
//
// Emits, for ONE real snapshot:
//   • exportReleaseGateEvidence(model)  — releaseSummary / releaseGates /
//     releaseRequirements / requirementToGateMap / readinessAxes /
//     issueStatePredicates / gateRollup / headline (directive §10);
//   • verifyReleaseGateModel(...)       — the independent verification result;
//   • requirementMultisetReconciliation — the exact registry↔requirement
//     multiset, side by side;
//   • antiVacuity[]                     — the directive's ANTI-VACUITY input
//     list evaluated at model level (all seven open · one structural child
//     clears · all structural children clear · one requirement NOT_APPLICABLE
//     with authority · professional approval added · administrative-only hold ·
//     procurement-only hold · no active requirements · an UNKNOWN code fails
//     closed into UNMAPPED_REQUIREMENT and FAILS the verification).
//
// It DERIVES nothing of its own: every number comes from the canonical model in
// lib/permit/snapshot/releaseGates.ts. planset-evidence-rgm.mjs consumes this
// file and compares it to the RENDERED HTML — that comparison is what makes
// "evidence == rendered" checkable.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'fs';
import {
  deriveReleaseGateModel, exportReleaseGateEvidence, verifyReleaseGateModel,
  deriveRequirementStatus, releaseHeadline, NOT_APPLICABLE_AUDIT_PREFIX,
  UNMAPPED_GATE_ID, RELEASE_GATE_DEFINITIONS,
} from '../lib/permit/snapshot/releaseGates';
import { findingTreatmentTable, findingTreatment, ROOT_GATE_TREATMENT } from '../lib/permit/sections/reviewStatus';
import type { PermitReadinessBlocker } from '../lib/permit/snapshot/types';

const [snapPath, outPath = '_tmp_rgm-model-evidence.json'] = process.argv.slice(2);
if (!snapPath) {
  console.error('usage: tsx scripts/rgm-model-evidence.ts <snapshot.json> [out.json]');
  process.exit(1);
}
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const registry: PermitReadinessBlocker[] = snap.permitReadiness?.registry ?? [];

const model = deriveReleaseGateModel({
  registry,
  snapshotId: snap.meta?.snapshotId ?? '',
  snapshotDigest: snap.meta?.digest ?? '',
});
const verification = verifyReleaseGateModel(model, registry, snap.projectAuthority?.issueState ?? null);

// ── requirement multiset reconciliation (§10 deliverable) ────────────────────
const sorted = (xs: string[]): string[] => [...xs].sort();
const activeRegistryCodes = sorted(registry.filter(r => deriveRequirementStatus(r) === 'OPEN').map(r => r.code));
const openRequirementCodes = sorted(model.requirements.filter(q => q.status === 'OPEN').map(q => q.requirementCode));
const reconciliation = {
  registryRecordCount: registry.length,
  activeRegistryCodeCount: activeRegistryCodes.length,
  requirementCount: model.requirements.length,
  openRequirementCount: openRequirementCodes.length,
  activeRegistryCodes,
  openRequirementCodes,
  equal: JSON.stringify(activeRegistryCodes) === JSON.stringify(openRequirementCodes),
  perGate: model.gates.map(g => ({
    gateId: g.gateId, gateCode: g.gateCode, status: g.status,
    unresolved: g.unresolvedCount, total: g.totalRequirementCount,
    codes: g.requirementCodes,
  })),
};

// ═══ ANTI-VACUITY probes (directive "Permanent gates" → ANTI-VACUITY inputs) ══
// Synthetic REGISTRIES only — no snapshot is patched, no authority is invented,
// and a probe can only ever make the model state MORE blocked or explicitly
// audited. Each probe states what MUST be true; a probe that cannot fire is a
// failure of the probe, not a pass of the gate.
const rec = (code: string, over: Partial<PermitReadinessBlocker> = {}): PermitReadinessBlocker => ({
  code,
  severity: 'blocking',
  domain: 'other',
  explanation: `${code} explanation`,
  resolutionAction: `${code} resolution`,
  authorityPath: `authority.${code}`,
  affectedSheets: ['RS-1'],
  justification: '',
  resolved: false,
  resolutionAuditRef: null,
  provenance: { source: 'probe', ref: code },
  payload: null,
  ...over,
} as unknown as PermitReadinessBlocker);

/** The directive's expected Braidon condition: 3/2/1/6/3/2/2 = 7 gates / 19. */
const BRAIDON_19 = [
  'CODE-AUTHORITY-INCOMPLETE', 'PROJECT-AUTHORITY-UNVERIFIED', 'PROJECT-NAME-NONPRODUCTION',
  'EQUIPMENT-IDENTITY-CONFLICT', 'MODULE-EXACT-DATASHEET-PENDING',
  'ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED',
  'FRAMING-AUTHORITY-UNVERIFIED', 'PENDING-RACKING-ASSEMBLY-SELECTION',
  'FASTENER-ASSEMBLY-UNVERIFIED', 'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
  'RACKING-CAPACITY-APPLICABILITY-GAP', 'EQUIPMENT-DOCUMENT-APPLICABILITY',
  'ROUTE-LENGTH-ESTIMATE', 'CONDUIT-FILL-PENDING', 'TAP-CONDUCTOR-LENGTH-PENDING',
  'QCABLE-PROCUREMENT-INSUFFICIENT', 'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED',
  'DESIGNER-OF-RECORD-MISSING', 'ENGINEERING-REVIEW-PENDING',
];

interface Probe { id: string; ok: boolean; detail: string }
const probes: Probe[] = [];
const probe = (id: string, ok: boolean, detail: string): void => { probes.push({ id, ok: !!ok, detail }); };
const modelOf = (reg: PermitReadinessBlocker[]) =>
  deriveReleaseGateModel({ registry: reg, snapshotId: 'PROBE', snapshotDigest: 'p'.repeat(64) });
const gateOf = (m: ReturnType<typeof modelOf>, id: string) => m.gates.find(g => g.gateId === id)!;

// 1 — ALL SEVEN OPEN (the directive's expected Braidon table 3/2/1/6/3/2/2).
{
  const reg = BRAIDON_19.map(c => rec(c));
  const m = modelOf(reg);
  const dist = ['RG-1', 'RG-2', 'RG-3', 'RG-4', 'RG-5', 'RG-6', 'RG-7'].map(id => gateOf(m, id).unresolvedCount);
  probe('all-seven-gates-open-3-2-1-6-3-2-2',
    JSON.stringify(dist) === JSON.stringify([3, 2, 1, 6, 3, 2, 2])
    && m.summary.openGateCount === 7 && m.summary.unresolvedRequirementCount === 19
    && m.summary.advisoryCount === 0 && m.summary.permitReady === false
    && verifyReleaseGateModel(m, reg).length === 0,
    `distribution=${dist.join('/')} headline="${releaseHeadline(m.summary)}"`);
}
// 2 — ONE structural child clears: the gate stays OPEN, the count drops by one.
{
  const reg = BRAIDON_19.map(c => rec(c,
    c === 'FASTENER-ASSEMBLY-UNVERIFIED' ? { resolved: true, resolutionAuditRef: 'AUDIT-0001' } : {}));
  const m = modelOf(reg);
  const g = gateOf(m, 'RG-4');
  probe('one-structural-child-clears-gate-stays-open',
    g.status === 'OPEN' && g.unresolvedCount === 5 && g.totalRequirementCount === 6
    && g.clearedRequirementCodes.includes('FASTENER-ASSEMBLY-UNVERIFIED')
    && m.summary.openGateCount === 7 && m.summary.unresolvedRequirementCount === 18,
    `RG-4 ${g.status} ${g.unresolvedCount}/${g.totalRequirementCount} · summary ${m.summary.openGateCount}/${m.summary.unresolvedRequirementCount}`);
}
// 3 — ALL structural children clear: the gate CLEARS, the others do not.
{
  const structural = BRAIDON_19.filter(c => gateOfCode(c) === 'RG-4');
  const reg = BRAIDON_19.map(c => rec(c,
    structural.includes(c) ? { resolved: true, resolutionAuditRef: `AUDIT-${c}` } : {}));
  const m = modelOf(reg);
  const g = gateOf(m, 'RG-4');
  probe('all-structural-children-clear-gate-clears',
    g.status === 'CLEARED' && g.unresolvedCount === 0 && g.totalRequirementCount === 6
    && m.summary.openGateCount === 6 && m.summary.unresolvedRequirementCount === 13
    && m.summary.permitReady === false,
    `RG-4 ${g.status} ${g.unresolvedCount}/${g.totalRequirementCount} · summary ${m.summary.openGateCount}/${m.summary.unresolvedRequirementCount}`);
}
// 4 — ONE requirement NOT_APPLICABLE on a recorded authority.
{
  const reg = BRAIDON_19.map(c => rec(c,
    c === 'PROJECT-NAME-NONPRODUCTION'
      ? { resolved: true, resolutionAuditRef: `${NOT_APPLICABLE_AUDIT_PREFIX}AUTH-77` } : {}));
  const m = modelOf(reg);
  const q = m.requirements.find(x => x.requirementCode === 'PROJECT-NAME-NONPRODUCTION')!;
  const g = gateOf(m, 'RG-1');
  probe('not-applicable-requirement-with-authority',
    q.status === 'NOT_APPLICABLE' && g.status === 'OPEN' && g.unresolvedCount === 2
    && g.totalRequirementCount === 3 && m.summary.unresolvedRequirementCount === 18,
    `${q.requirementCode}=${q.status} RG-1 ${g.unresolvedCount}/${g.totalRequirementCount}`);
}
// 5 — professional approval added ⇒ RG-7 clears and NOTHING else changes.
{
  const reg = BRAIDON_19.filter(c => c !== 'ENGINEERING-REVIEW-PENDING' && c !== 'DESIGNER-OF-RECORD-MISSING')
    .map(c => rec(c));
  const m = modelOf(reg);
  probe('professional-approval-clears-only-rg7',
    gateOf(m, 'RG-7').status === 'CLEARED' && gateOf(m, 'RG-7').totalRequirementCount === 0
    && m.summary.openGateCount === 6 && m.summary.unresolvedRequirementCount === 17
    && m.summary.permitReady === false && m.issueStatePredicates.readyForEngineeringReview === false,
    `RG-7 ${gateOf(m, 'RG-7').status} · summary ${m.summary.openGateCount}/${m.summary.unresolvedRequirementCount}`);
}
// 6 — ADMINISTRATIVE-ONLY hold: the administrative axis blocks, procurement does not.
{
  const reg = [rec('PROJECT-NAME-NONPRODUCTION')];
  const m = modelOf(reg);
  probe('administrative-only-hold-isolates-its-axis',
    m.summary.openGateCount === 1 && m.readinessAxes.administrativeRelease.ready === false
    && m.readinessAxes.procurement.ready === true
    && gateOf(m, 'RG-1').releaseImpact.administrativeRelease === true,
    `axes permit=${m.readinessAxes.permitSubmission.ready} procurement=${m.readinessAxes.procurement.ready} admin=${m.readinessAxes.administrativeRelease.ready}`);
}
// 7 — PROCUREMENT-only hold: the procurement axis blocks, administrative does not.
{
  const reg = [rec('QCABLE-PROCUREMENT-INSUFFICIENT')];
  const m = modelOf(reg);
  probe('procurement-only-hold-isolates-its-axis',
    m.summary.openGateCount === 1 && m.summary.procurementReady === false
    && m.readinessAxes.administrativeRelease.ready === true,
    `axes permit=${m.readinessAxes.permitSubmission.ready} procurement=${m.readinessAxes.procurement.ready} admin=${m.readinessAxes.administrativeRelease.ready}`);
}
// 8 — NO active requirements: every gate CLEARED, nothing invented.
{
  const m = modelOf([]);
  probe('no-active-requirements-yields-a-clean-model',
    m.summary.openGateCount === 0 && m.summary.unresolvedRequirementCount === 0
    && m.requirements.length === 0 && m.gates.every(g => g.status === 'CLEARED')
    && m.summary.permitReady === true && verifyReleaseGateModel(m, []).length === 0,
    `gates=${m.gates.length} open=${m.summary.openGateCount} permitReady=${m.summary.permitReady}`);
}
// 9 — an UNKNOWN code FAILS CLOSED into UNMAPPED_REQUIREMENT *and* fails the
//     verification. It is never dropped and never softened.
{
  const reg = [...BRAIDON_19, 'SOME-BRAND-NEW-UNMAPPED-CODE'].map(c => rec(c));
  const m = modelOf(reg);
  const u = gateOf(m, UNMAPPED_GATE_ID);
  const errs = verifyReleaseGateModel(m, reg);
  probe('unknown-code-fails-closed-and-fails-the-harness',
    u.status === 'OPEN' && u.unresolvedCount === 1
    && u.requirementCodes.includes('SOME-BRAND-NEW-UNMAPPED-CODE')
    && u.releaseImpact.permitSubmission && u.releaseImpact.procurement
    && u.releaseImpact.engineeringReview && u.releaseImpact.construction
    && u.releaseImpact.administrativeRelease
    && errs.some(e => e.includes('UNMAPPED_REQUIREMENT')),
    `UNMAPPED ${u.status} ${u.unresolvedCount} · verification errors=${errs.length}`);
}

function gateOfCode(code: string): string {
  return model.requirementToGateMap[code]?.gateId
    ?? RELEASE_GATE_DEFINITIONS[RELEASE_GATE_DEFINITIONS.length - 1].gateId;
}

const out = {
  generator: 'scripts/rgm-model-evidence.ts',
  snapshotId: snap.meta?.snapshotId ?? null,
  snapshotDigest: snap.meta?.digest ?? null,
  issueState: snap.projectAuthority?.issueState ?? null,
  permitReadinessReady: snap.permitReadiness?.ready ?? null,
  releaseGateEvidence: exportReleaseGateEvidence(model),
  // RGM §5 / gate 17 — the DECLARED visual treatment table (all seven classes,
  // whether or not this input happens to render every one of them), so the
  // black-and-white legibility gate is never vacuous.
  findingTreatments: {
    rootGate: ROOT_GATE_TREATMENT,
    classes: findingTreatmentTable(),
    byFindingType: Object.fromEntries((
      ['TECHNICAL_CONFLICT', 'VERIFIED_DEFICIENCY', 'PENDING_SELECTION', 'PENDING_DOCUMENT',
        'PENDING_AUTHORITY', 'FIELD_VERIFICATION', 'ADMINISTRATIVE_HOLD', 'PROFESSIONAL_RELEASE',
        'ADVISORY'] as const).map(t => [t, findingTreatment(t).cls])),
  },
  verification: { ok: verification.length === 0, errors: verification },
  requirementMultisetReconciliation: reconciliation,
  antiVacuity: { ok: probes.every(p => p.ok), probes },
};
writeFileSync(outPath, JSON.stringify(out, null, 2));
const bad = probes.filter(p => !p.ok);
console.log(`[rgm-model-evidence] ${outPath} — snapshot ${out.snapshotId} · `
  + `${model.summary.openGateCount} gates / ${model.summary.unresolvedRequirementCount} requirements / `
  + `${model.summary.advisoryCount} advisories · verification ${verification.length === 0 ? 'OK' : 'FAILED'} · `
  + `anti-vacuity ${probes.length - bad.length}/${probes.length}`);
for (const p of bad) console.error(`[rgm-model-evidence] PROBE FAILED ${p.id} — ${p.detail}`);
if (verification.length) for (const e of verification) console.error(`[rgm-model-evidence] VERIFICATION ${e}`);
process.exit(verification.length === 0 && bad.length === 0 ? 0 : 2);
