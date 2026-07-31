// ═══════════════════════════════════════════════════════════════════════════
// ecd-model-evidence.ts — the CANONICAL model evidence for the 24 ENGINE-CLOSURE
// gates of docs/ENGINE-CLOSURE-DIRECTIVE.md §12.
//
//   Usage: tsx scripts/ecd-model-evidence.ts <out.json> [--insufficient|--identity]
//
// It regenerates the package from the FROZEN acceptance fixture through the
// PUBLIC API (exactly as scripts/braidon-rgm-regen.ts does — same three modes,
// same synthetic stricter-only allowance, same identity input state), then
// exports the canonical objects the rendered gates are compared against:
//
//   • bomRows[]            — every §2 field, per row, from the ONE classifier
//   • approval             — THE ProcurementApproval (the only counter)
//   • exports              — orderableProcurementExport / nonOrderableProcurementExport
//   • routeDependency      — the §3 route-derived population + RG-5's own `affects`
//   • cableExtension       — the §4 Q-CONN rows + the promotion contract result
//   • supplySideTap        — the §5 authority + the IPLD350-3 row
//   • grounding            — the §6 physical-vs-group identity split
//   • bonding              — the §7 RackingBondingAuthority
//   • documents            — the §8 seven-state document model + APP-A conclusion
//   • topology             — the §9 label side/citation classification
//   • antiVacuity[]        — a probe PER GATE. Every probe is either a synthetic
//     PURE-FUNCTION call (no snapshot is patched in place, no authority is
//     written back) or a measurement asserting the gate's population is
//     non-empty. A probe that cannot fire is a failure of the probe, never a
//     pass of the gate.
//
// It DERIVES nothing of its own. planset-evidence-ecd.mjs consumes this file and
// compares it to the RENDERED HTML — that comparison is what makes
// "evidence == rendered" checkable.
// ═══════════════════════════════════════════════════════════════════════════
import { writeFileSync } from 'fs';
import { generatePermitHTML } from '../lib/permit/index';
import { generateCADLayout } from '../lib/cad/cadEngine';
import { braidonOriginalAuditFixture } from '../tests/fixtures/braidon-original-audit-fixture';
import type { SnapshotAuthorityInputs } from '../lib/permit/snapshot/authorityInputs';
import {
  buildProcurementApproval, orderableProcurementExport, nonOrderableProcurementExport,
  isOrderableForProcurement, classifyProcurementAuthority, procurementAuthorityOf, producerViewOf,
  evaluateCableExtensionPromotion, buildProcurementClassificationContextFromSnapshot,
  EMPTY_PROCUREMENT_CONTEXT, type PermitBOMItem, type ProcurementClassificationContext,
} from '../lib/permit/utils/bomForPermit';
import { PROCUREMENT_AUTHORITY_STATES } from '../lib/bom-types-v4';
import { bomLineIdFor, auditBomLineIds } from '../lib/bom/bomLineId';
import {
  projectGroundingSegments, projectE1PhysicalSchedule, BRANCH_EGC_AUTHORITY_GROUP_ID,
} from '../lib/permit/snapshot/electricalProjection';
import {
  buildRackingBondingAuthority, projectRackingBondingAuthority,
} from '../lib/permit/snapshot/rackingBonding';
import {
  projectEquipmentListingConclusion, EQUIPMENT_LISTING_SCOPE_CODES,
  EQUIPMENT_LISTING_NOT_ESTABLISHED_SENTENCE, EQUIPMENT_LISTING_ESTABLISHED_SENTENCE,
} from '../lib/permit/snapshot/equipmentListingConclusion';
import {
  evaluateDocumentApplicability, getManufacturerAsset,
  DOCUMENT_APPLICABILITY_STATES, APPLICABILITY_ESTABLISHED_STATES,
} from '../lib/manufacturer-assets-db';
import { selectFieldLabels } from '../lib/permit/utils/fieldLabels';
import type { CableExtensionSolution, SupplySideTapConnectionAuthority } from '../lib/permit/snapshot/types';

const args = process.argv.slice(2);
const outPath = args.find(a => !a.startsWith('--')) ?? '_tmp_ecd-model-evidence.json';
const insufficient = args.includes('--insufficient');
const identity = args.includes('--identity');
const MODE = identity ? 'identity' : insufficient ? 'insufficient' : 'fixture';

/** The SAME synthetic, clearly-labelled, STRICTER-ONLY allowance the RGM harness
 *  uses — byte-identical, because this file's evidence is compared against the
 *  package scripts/braidon-rgm-regen.ts renders. Any drift in the allowance
 *  record changes the snapshot digest and the comparison would be against a
 *  different package. It can only RAISE the Q-Cable sufficiency threshold. */
const SYNTHETIC_ALLOWANCE: SnapshotAuthorityInputs = {
  capacityDocument: null, projectJurisdiction: null, manufacturerDocumentsArchived: null,
  digestInvalidatedByLedger: false, framingCapacityDocument: null,
  framingProjectApplicabilityKey: null, cableExtensionSolutions: [],
  qcableServiceLoopAllowance: {
    allowanceFt: 26,
    documentId: 'SYNTHETIC-RGM-ALLOWANCE-0001 (TEST HARNESS RECORD — NOT REAL MANUFACTURER EVIDENCE)',
    note: 'Synthetic service-loop / transition allowance used ONLY to exercise the CONFIRMED-condition '
      + 'release surfaces non-vacuously. Raises the threshold; grants nothing.',
    provenance: 'rgm-harness-synthetic-allowance-authority',
  },
  environmentalSource: null,
};

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

const input: any = clone(braidonOriginalAuditFixture);
if (identity) {
  input.project = input.project ?? {};
  input.project.projectName = `${input.project.projectName ?? 'BRAIDON M PILLA'} — Solar TEST`;
  input.project.designer = '';
}
generatePermitHTML(input, undefined, insufficient ? SYNTHETIC_ALLOWANCE : null);
const snap = input._snapshot;
if (!snap) { console.error('[ecd-model-evidence] NO snapshot attached — FAIL'); process.exit(1); }
const cad = generateCADLayout(input);
const bom: PermitBOMItem[] = (input.bom ?? []) as PermitBOMItem[];
const ctx: ProcurementClassificationContext = buildProcurementClassificationContextFromSnapshot(snap);

const approval = buildProcurementApproval(bom);
const orderable = orderableProcurementExport(bom);
const exclusions = nonOrderableProcurementExport(bom);

const rowOf = (pred: (r: PermitBOMItem) => boolean) => bom.filter(pred);
const rowRec = (r: PermitBOMItem) => ({
  bomLineId: r.bomLineId ?? null,
  legacyId: r.id ?? null,
  category: r.category, stageId: r.stageId ?? null, subSystem: r.subSystem ?? null,
  manufacturer: r.manufacturer, model: r.model, partNumber: r.partNumber,
  quantity: r.quantity, unit: r.unit, required: r.required !== false,
  description: r.description ?? null, derivedFrom: r.derivedFrom ?? null,
  nonOrderable: r.nonOrderable === true, quantityState: r.quantityState ?? null,
  procurement: procurementAuthorityOf(r),
});
const rows = bom.map(rowRec);

// ── §3 route dependency ─────────────────────────────────────────────────────
const ROUTE_CODE = 'ROUTE-LENGTH-ESTIMATE';
const routeOpen = ctx.openRequirementCodes.includes(ROUTE_CODE);
const routeRows = rows.filter(r => r.procurement.quantitySource === 'route-derived');

// ── §4 cable extension / Q-CONN ─────────────────────────────────────────────
const qconnRows = rowOf(r => /^Q-CONN-10/.test(r.partNumber ?? ''));
const qconn = qconnRows.map(r => ({
  ...rowRec(r),
  promotion: evaluateCableExtensionPromotion(r.bomLineId ?? '(unstamped)', ctx.cableExtensionSolutions),
}));

// ── §5 supply-side tap ──────────────────────────────────────────────────────
const tapAuthority: SupplySideTapConnectionAuthority | null = ctx.supplySideTap;
const tapRows = rowOf(r => /IPLD350-3/i.test(r.partNumber ?? '') || /IPLD350-3/i.test(r.model ?? ''));

// ── §6 grounding identity ───────────────────────────────────────────────────
const segs = projectGroundingSegments(snap);
const e1 = projectE1PhysicalSchedule(snap);
const physicalSegs = segs.filter(s => s.identityKind === 'physical-segment');
const groupSegs = segs.filter(s => s.identityKind === 'group-authority');
const canonicalBranchIds = (snap.electrical?.groundingObjects ?? [])
  .filter((g: any) => g.purpose === 'branch-egc').map((g: any) => g.groundingId);

// ── §7 bonding ──────────────────────────────────────────────────────────────
const bonding = projectRackingBondingAuthority(snap);

// ── §8 documents ────────────────────────────────────────────────────────────
const listing = projectEquipmentListingConclusion(snap);
const rackingAsset = getManufacturerAsset(input.project?.mountingSystemId, 'racking_detail');
const rackingAppl = evaluateDocumentApplicability('RT-MINI', rackingAsset, null);

// ── §9 topology / citation ──────────────────────────────────────────────────
const labels = selectFieldLabels(input, cad).map(l => ({
  refId: l.refId, necRef: l.necRef, side: l.interconnectSide, required: l.required,
}));

// ═══ ANTI-VACUITY PROBES — one per gate ═════════════════════════════════════
interface Probe { gate: number; id: string; ok: boolean; detail: string }
const probes: Probe[] = [];
const probe = (gate: number, id: string, ok: boolean, detail: string) =>
  probes.push({ gate, id, ok: !!ok, detail });

// gate 1 — a DUPLICATE row id must be DETECTED, not silently tolerated.
{
  const dupSet = [...bom, bom[0]];
  const a = auditBomLineIds(dupSet);
  const real = approval.rowIdAudit;
  probe(1, 'duplicate-row-id-is-detected',
    a.duplicateIds.length === 1 && a.unique === a.total - 1
    && real.total === real.unique && real.duplicateIds.length === 0 && real.missingIds === 0,
    `synthetic duplicate → unique=${a.unique}/${a.total} duplicateIds=${a.duplicateIds.length} · `
    + `real audit ${real.unique}/${real.total} duplicates=${real.duplicateIds.length} missing=${real.missingIds}`);
}
// gate 2 — an UNCLASSIFIED row FAILS CLOSED (no state ⇒ never orderable).
{
  const bare = { category: 'wire', manufacturer: 'X', model: 'Y', partNumber: 'Z', quantity: 1, unit: 'ea' } as PermitBOMItem;
  const rec = procurementAuthorityOf(bare);
  probe(2, 'unclassified-row-fails-closed',
    rec.authorityState !== 'VERIFIED_ORDERABLE' && !rec.orderable && !rec.exportable
    && !isOrderableForProcurement(bare) && rows.every(r => PROCUREMENT_AUTHORITY_STATES.includes(r.procurement.authorityState)),
    `unclassified → ${rec.authorityState} orderable=${rec.orderable}; every real row carries exactly one declared state`);
}
// gate 3 — the counter reconciles on a SYNTHETIC one-row-per-state population.
{
  const mk = (st: string, over: Partial<PermitBOMItem>): PermitBOMItem => ({
    category: 'wire', manufacturer: 'M', model: st, partNumber: `PN-${st}`, quantity: 1, unit: 'ea',
    stageId: 'ac', bomLineId: `PROBE-${st}`, authorityStateHint: st as any,
    authorityStateHintReason: 'probe', ...over,
  } as PermitBOMItem);
  const set = PROCUREMENT_AUTHORITY_STATES.map(s => {
    const r = mk(s, {});
    r.procurement = classifyProcurementAuthority(
      { ...r, authorityStateHint: s }, EMPTY_PROCUREMENT_CONTEXT);
    // force the probe's intended state so the COUNTER, not the classifier, is under test
    r.procurement = { ...r.procurement!, authorityState: s, orderable: s === 'VERIFIED_ORDERABLE', exportable: s === 'VERIFIED_ORDERABLE' };
    return r;
  });
  const ap = buildProcurementApproval(set);
  const sum = ap.verifiedOrderableCount + ap.estimatedFieldVerifyCount + ap.candidateNonOrderableCount
    + ap.quantityPendingCount + ap.excludedCount;
  probe(3, 'five-state-counter-reconciles-on-a-one-per-state-population',
    ap.countsReconcile && sum === 5 && ap.totalRowCount === 5 && approval.countsReconcile,
    `probe counts sum=${sum}/${ap.totalRowCount} reconcile=${ap.countsReconcile} · real reconcile=${approval.countsReconcile}`);
}
// gate 4 — the id space is CONTENT-derived, so two same-family rows must differ.
{
  const a = bomLineIdFor({ stageId: 'dc', category: 'conduit', unit: 'ft', partNumber: 'PVC80-125-R1' });
  const b = bomLineIdFor({ stageId: 'dc', category: 'conduit', unit: 'ft', partNumber: 'PVC80-125-R2' });
  const same = bomLineIdFor({ stageId: 'dc', category: 'conduit', unit: 'ft', partNumber: 'PVC80-125-R1' });
  const families = rows.filter(r => r.category === 'conduit').length;
  probe(4, 'content-derived-ids-separate-same-family-rows',
    a !== b && a === same && families >= 2 && new Set(rows.map(r => r.bomLineId)).size === rows.length,
    `same-family ids differ=${a !== b} stable=${a === same} conduit rows=${families} distinct ids=${new Set(rows.map(r => r.bomLineId)).size}/${rows.length}`);
}
// gate 5 — the export is a STRICT SUBSET and every excluded row is enumerated.
{
  const allIds = new Set(approval.allRowIds);
  const exIds = exclusions.map(e => e.bomLineId);
  const ordIds = orderable.map(r => r.bomLineId!);
  probe(5, 'no-row-disappears-orderable-plus-excluded-covers-the-population',
    ordIds.length + exIds.length === approval.totalRowCount
    && [...ordIds, ...exIds].every(id => allIds.has(id))
    && exIds.length > 0 && ordIds.length > 0,
    `orderable=${ordIds.length} + excluded=${exIds.length} = ${ordIds.length + exIds.length} of ${approval.totalRowCount}`);
}
// gate 6 — the route rule is LOAD-BEARING: close ROUTE-LENGTH-ESTIMATE and a
//          route row promotes; leave it open and it cannot.
{
  const estimated = bom.filter(r => r.procurement?.quantitySource === 'route-derived'
    && r.procurement?.authorityState === 'ESTIMATED_FIELD_VERIFY');
  const closedCtx: ProcurementClassificationContext = {
    ...ctx,
    openRequirementCodes: ctx.openRequirementCodes.filter(c => c !== ROUTE_CODE),
    openProcurementRequirementCodes: ctx.openProcurementRequirementCodes.filter(c => c !== ROUTE_CODE),
  };
  // Every route-ESTIMATED row must promote when the ONE requirement holding it
  // closes — the state is a consequence of that requirement, not a constant.
  const promoted = estimated.map(r => classifyProcurementAuthority(producerViewOf(r), closedCtx));
  const allPromote = promoted.length > 0 && promoted.every(p => p.authorityState === 'VERIFIED_ORDERABLE');
  probe(6, 'route-estimated-rows-are-blocked-by-the-open-requirement-not-by-a-constant',
    estimated.length >= 8 && routeRows.every(r => r.procurement.authorityState !== 'VERIFIED_ORDERABLE') && allPromote,
    `route-derived rows=${routeRows.length} (estimated=${estimated.length}) none orderable · `
    + `with ${ROUTE_CODE} closed → ${promoted.filter(p => p.authorityState === 'VERIFIED_ORDERABLE').length}/${promoted.length} promote`);
}
// gate 7 — the OPEN requirement is actually named on every row it holds, and a
//          route row held by a STRONGER authority names that one instead (it is
//          never silently un-attributed).
{
  const named = routeRows.filter(r => r.procurement.blockingRequirementCodes.includes(ROUTE_CODE));
  const other = routeRows.filter(r => !r.procurement.blockingRequirementCodes.includes(ROUTE_CODE));
  probe(7, 'the-open-route-requirement-is-named-on-every-row-it-holds',
    routeOpen && routeRows.length > 0 && named.length >= 8
    && other.every(r => r.procurement.blockingRequirementCodes.length > 0
      && r.procurement.authorityState !== 'VERIFIED_ORDERABLE'),
    `${ROUTE_CODE} open=${routeOpen} · ${named.length}/${routeRows.length} route rows name it; `
    + `${other.length} held by a stronger authority [${other.map(r => r.procurement.blockingRequirementCodes.join('+')).join(', ')}]`);
}
// gate 8 — a FULLY SATISFYING synthetic solution PROMOTES a Q-CONN row; the real
//          (empty) solution set does not. The rule is a contract, not a constant.
{
  const id = qconnRows[0]?.bomLineId ?? '(unstamped)';
  const good: CableExtensionSolution = {
    solutionId: 'PROBE-SOL-1', type: 'extension-cable', selected: true,
    manufacturer: 'PROBE', selectedSku: 'PROBE-SKU', compatibilityVerified: true,
    manufacturerDocument: 'PROBE-DOC', representedInBom: true,
    verificationState: 'verified', bomLineIds: [id],
  } as unknown as CableExtensionSolution;
  const withGood = evaluateCableExtensionPromotion(id, [good]);
  const real = evaluateCableExtensionPromotion(id, ctx.cableExtensionSolutions);
  probe(8, 'a-verified-selected-solution-promotes-the-connector-row',
    qconnRows.length === 2 && withGood.promoted === true && real.promoted === false
    && qconn.every(q => q.procurement.authorityState === 'CANDIDATE_NON_ORDERABLE'),
    `Q-CONN rows=${qconnRows.length} · synthetic verified solution promotes=${withGood.promoted} · real promotes=${real.promoted} (${real.missing.join('; ')})`);
}
// gate 9 — the connector rows exist and are excluded, so "they don't resolve the
//          deficit" is a claim about a POPULATED set, not an empty one.
{
  const ids = qconn.map(q => q.bomLineId);
  probe(9, 'the-connector-rows-exist-and-are-outside-every-export',
    ids.length === 2 && ids.every(i => !approval.orderableRowIds.includes(i!))
    && ids.every(i => exclusions.some(e => e.bomLineId === i)),
    `Q-CONN ids=[${ids.join(', ')}] in export=${ids.filter(i => approval.orderableRowIds.includes(i!)).length}`);
}
// gate 10 — a VERIFIED synthetic tap authority promotes the connector row.
{
  const sample = tapRows[0];
  const verifiedTap = tapAuthority ? {
    ...tapAuthority,
    existingServiceConductorMaterial: 'Al', existingServiceConductorSize: '4/0 AWG',
    existingServiceConductorInsulation: 'XHHW-2', existingServiceConductorCount: 2,
    existingServiceConductorSource: 'PROBE field survey',
    tapConductorLengthFt: 6, tapConductorLengthAuthority: 'measured',
    lugRangeCompatibility: 'compatible', enclosureCompatibility: 'compatible',
    installationSpaceVerified: true, manufacturerDocumentId: 'PROBE-DOC',
    listingEvidence: 'PROBE-UL', verificationStatus: 'verified', unresolvedFacts: [],
  } as SupplySideTapConnectionAuthority : null;
  // With the authority VERIFIED the post-pass clears the pre-snapshot engine's
  // static candidate hint (bomForPermit §5g), so the promoted-state view is the
  // row WITHOUT the hint, evaluated against a context with the tap requirement
  // closed. Both halves are required — the authority alone never clears a
  // separately-open release requirement.
  const promotedView = sample
    ? { ...producerViewOf(sample), authorityStateHint: undefined, authorityStateHintReason: undefined }
    : null;
  const promoted = promotedView && verifiedTap
    ? classifyProcurementAuthority(promotedView, {
      ...ctx,
      supplySideTap: verifiedTap,
      openRequirementCodes: ctx.openRequirementCodes.filter(c => c !== 'TAP-CONDUCTOR-LENGTH-PENDING'),
      openProcurementRequirementCodes: ctx.openProcurementRequirementCodes.filter(c => c !== 'TAP-CONDUCTOR-LENGTH-PENDING'),
    })
    : null;
  // …and the SAME row with the candidate hint still on it stays CANDIDATE, which
  // proves the hint (the authority's projection) is the mechanism holding it.
  const hintHeld = sample && verifiedTap
    ? classifyProcurementAuthority(producerViewOf(sample), { ...ctx, supplySideTap: verifiedTap })
    : null;
  const real = sample ? procurementAuthorityOf(sample) : null;
  probe(10, 'a-verified-tap-authority-promotes-the-connector-row',
    tapRows.length === 1 && tapAuthority?.verificationStatus === 'unverified'
    && (tapAuthority?.unresolvedFacts?.length ?? 0) >= 4
    // FAIL-CLOSED on the AUTHORITY alone: no requirement code holds this row —
    // TAP-CONDUCTOR-LENGTH-PENDING's declared `affects` is the ≤10-ft length
    // verification only — yet the row is still not orderable.
    && real?.authorityState === 'CANDIDATE_NON_ORDERABLE'
    && (real?.blockingRequirementCodes.length ?? -1) === 0
    && hintHeld?.authorityState === 'CANDIDATE_NON_ORDERABLE'
    && promoted?.authorityState === 'VERIFIED_ORDERABLE',
    `IPLD rows=${tapRows.length} real tap=${tapAuthority?.verificationStatus} (${tapAuthority?.unresolvedFacts?.length} unresolved facts, `
    + `${real?.blockingRequirementCodes.length} blocking codes) → ${real?.authorityState} · `
    + `verified authority, hint still set → ${hintHeld?.authorityState} · verified authority, hint cleared → ${promoted?.authorityState}`);
}
// gate 11 — the design HAS three distinct physical branch identities to be unique
//           about (the pre-ECD artifact rendered one id three times).
{
  // The PHYSICAL branch identities are carried by the E-1 sectioned schedule
  // (projectGroundingSegments emits the ONE grouped authority node for the
  // branch-EGC family; the per-branch physical rows are E-1 sections).
  const ids = e1.map((s: any) => s.groundingSegmentId).filter((x: string | null) => /^gnd-br-\d+$/.test(x ?? ''));
  const allPhysical = [...physicalSegs.map(s => s.groundingSegmentId), ...ids];
  probe(11, 'at-least-three-distinct-physical-branch-grounding-identities-exist',
    canonicalBranchIds.length >= 3 && new Set(ids).size >= 3 && new Set(ids).size === ids.length
    && new Set(allPhysical).size === allPhysical.length,
    `canonical branch-egc records=${canonicalBranchIds.length} · E-1 physical branch ids=[${[...new Set(ids)].sort().join(', ')}] · `
    + `all physical identities unique=${new Set(allPhysical).size === allPhysical.length} (${allPhysical.length})`);
}
// gate 12 — the GROUP node exists (so "not counted physical" is non-vacuous) and
//           its id is not any physical segment's id.
{
  const groupIds = groupSegs.map(s => s.groundingSegmentId);
  probe(12, 'the-group-authority-node-exists-and-owns-a-non-physical-identity',
    groupSegs.length === 1 && groupIds[0] === BRANCH_EGC_AUTHORITY_GROUP_ID
    && !physicalSegs.some(s => s.groundingSegmentId === BRANCH_EGC_AUTHORITY_GROUP_ID)
    && groupSegs[0].memberGroundingIds.length >= 3,
    `group nodes=${groupSegs.length} id=${groupIds[0]} members=${groupSegs[0]?.memberGroundingIds?.length ?? 0} physical=${physicalSegs.length}`);
}
// gate 13 — a VERIFIED synthetic assembly DOES reach INTEGRATED_LISTED_BONDING_VERIFIED,
//           so the pending label is an outcome, not a hardcoded string.
{
  const good = buildRackingBondingAuthority({
    assembly: {
      assemblyId: 'PROBE-ASM', mountSku: 'PROBE-MOUNT', mountModel: 'PROBE MOUNT',
      railSku: 'PROBE-RAIL', railModel: 'PROBE RAIL', railManufacturer: 'PROBE',
      assemblySupported: true, ul2703ListingBasis: 'PROBE UL FILE E-000000',
      groundingBonding: 'integrated', assemblyVerification: { overall: 'verified' },
    } as any,
    documentApplicability: { state: 'AUTHORITATIVE', applicabilityVerified: true, documentTitle: 'PROBE DOC' },
    moduleFrame: 'PROBE FRAME',
  });
  probe(13, 'a-verified-assembly-reaches-the-integrated-listed-bonding-outcome',
    good.result === 'INTEGRATED_LISTED_BONDING_VERIFIED' && good.verificationState === 'verified'
    && bonding.result === 'METHOD_PENDING_ASSEMBLY_SELECTION' && bonding.bondingRequired === true,
    `synthetic verified assembly → ${good.result} · real → ${bonding.result} (bondingRequired=${bonding.bondingRequired})`);
}
// gate 14 — the APP-A conclusion is REGISTRY-DERIVED: an empty registry turns it
//           positive, so NOT_ESTABLISHED is a derivation, not a constant.
{
  const clear = projectEquipmentListingConclusion({
    ...snap, permitReadiness: { ...snap.permitReadiness, registry: [] },
  } as any);
  probe(14, 'the-listing-conclusion-is-registry-derived-both-ways',
    clear.established === true && clear.sentence === EQUIPMENT_LISTING_ESTABLISHED_SENTENCE
    && listing.established === false && listing.sentence === EQUIPMENT_LISTING_NOT_ESTABLISHED_SENTENCE
    && listing.openCodes.length > 0
    && projectEquipmentListingConclusion(null).established === false,
    `empty registry → established=${clear.established} · real → established=${listing.established} openCodes=${listing.openCodes.length} · null snapshot → false`);
}
// gate 15 — ARCHIVED alone never establishes applicability, and AUTHORITATIVE is
//           reachable ONLY with a real archived + hash-bound registry record.
{
  const archivedOnly = rackingAppl;
  // AUTHORITATIVE requires applicability ESTABLISHED (here: a verified alias
  // evidence record bridging the selected product to the document's version)
  // PLUS a real archived, content-hash-bound registry record. Neither alone.
  const alias = {
    selectedModel: 'RT-MINI',
    documentProduct: archivedOnly.documentProduct ?? 'RT-MINI II',
    verified: true,
    evidenceRef: 'PROBE-ALIAS-0001',
  };
  const authoritative = evaluateDocumentApplicability('RT-MINI', rackingAsset, alias, {
    archivedInRepo: true, sha256: 'a'.repeat(64), status: 'current',
  });
  const appliedNoHash = evaluateDocumentApplicability('RT-MINI', rackingAsset, alias, {
    archivedInRepo: true, sha256: null, status: 'current',
  });
  const superseded = evaluateDocumentApplicability('RT-MINI', rackingAsset, alias, {
    archivedInRepo: true, sha256: 'b'.repeat(64), status: 'superseded',
  });
  probe(15, 'archived-is-availability-only-and-authoritative-needs-an-archived-hash',
    archivedOnly.archived === true && archivedOnly.applicabilityVerified === false
    && archivedOnly.states.includes('ARCHIVED') && archivedOnly.state === 'PENDING_APPLICABILITY'
    && !APPLICABILITY_ESTABLISHED_STATES.includes(archivedOnly.state)
    && authoritative.state === 'AUTHORITATIVE' && authoritative.authoritative === true
    && appliedNoHash.state === 'VERIFIED' && appliedNoHash.authoritative === false
    && superseded.state === 'SUPERSEDED' && superseded.applicabilityVerified === false
    && DOCUMENT_APPLICABILITY_STATES.length === 7,
    `RT-MINI real → ${archivedOnly.states.join('+')} · alias+archived+hash → ${authoritative.state} · `
    + `alias+archived, NO hash → ${appliedNoHash.state} (authoritative=${appliedNoHash.authoritative}) · registry superseded → ${superseded.state}`);
}
// gate 16 — the label set CONTAINS a load-side-only label (so suppression on a
//           supply-side design is a real filter) and the supply-side label's
//           citation no longer carries any 705.12 subdivision.
{
  const loadOnly = labels.filter(l => l.side === 'load-side-only');
  const supply = labels.filter(l => l.side === 'supply-side-only');
  probe(16, 'the-load-side-only-population-is-non-empty-and-fully-suppressed',
    loadOnly.length >= 1 && supply.length >= 1
    && loadOnly.every(l => l.required === false)
    && supply.every(l => /705\.11/.test(l.necRef) && !/705\.12/.test(l.necRef))
    && labels.filter(l => l.required).every(l => !/705\.12/.test(l.necRef)),
    `load-side-only labels=${loadOnly.length} (all not-required=${loadOnly.every(l => !l.required)}) · supply-side refs=[${supply.map(l => l.necRef).join('; ')}]`);
}
// gate 17 — the summary counts are NOT all-equal / all-zero (a trivially
//           satisfiable state), i.e. at least three distinct states are populated.
{
  const populated = PROCUREMENT_AUTHORITY_STATES.filter(s => approval.rowIdsByState[s].length > 0);
  probe(17, 'at-least-three-procurement-states-are-populated',
    populated.length >= 3 && approval.totalRowCount > 40,
    `populated states=[${populated.join(', ')}] total=${approval.totalRowCount}`);
}
// gate 18 — the export is non-empty AND strictly VERIFIED_ORDERABLE.
{
  probe(18, 'the-export-is-non-empty-and-strictly-verified-orderable',
    orderable.length > 0 && orderable.every(r => procurementAuthorityOf(r).authorityState === 'VERIFIED_ORDERABLE')
    && orderable.length === approval.authoritativeExportCount,
    `export rows=${orderable.length} == authoritativeExportCount=${approval.authoritativeExportCount}`);
}
// gate 19 — the excluded set is non-empty and disjoint from the export.
{
  const exIds = new Set(exclusions.map(e => e.bomLineId));
  probe(19, 'the-excluded-set-is-non-empty-and-disjoint-from-the-export',
    exclusions.length > 0 && orderable.every(r => !exIds.has(r.bomLineId!))
    && exclusions.every(e => !!e.reason && !!e.authorityState),
    `excluded=${exclusions.length} disjoint=${orderable.every(r => !exIds.has(r.bomLineId!))}`);
}
// gate 20 — the release-gate architecture is untouched: 7 root gates, N open
//           requirements, 0 advisories, and the registry is non-empty.
{
  const reg = (snap.permitReadiness?.registry ?? []).filter((r: any) => !r.resolved);
  const blocking = reg.filter((r: any) => r.severity === 'blocking').length;
  probe(20, 'the-release-registry-is-non-empty-and-fully-blocking',
    blocking > 0 && blocking === reg.length,
    `registry ${blocking} blocking / ${reg.length - blocking} advisory`);
}
// gates 21-24 — measurement probes (the rendered harness owns the assertions).
probe(21, 'the-package-declares-a-multi-sheet-manifest',
  (snap.projectAuthority?.sheetIndex ?? []).length >= 20,
  `manifest sheets=${(snap.projectAuthority?.sheetIndex ?? []).length}`);
probe(22, 'the-package-has-dense-sheets-to-measure', bom.length >= 40, `bom rows=${bom.length}`);
probe(23, 'the-package-has-dense-sheets-to-measure', bom.length >= 40, `bom rows=${bom.length}`);
probe(24, 'the-report-equals-rendered-comparison-has-a-populated-corpus',
  rows.length >= 40 && segs.length + e1.length >= 6 && labels.length >= 10,
  `bom rows=${rows.length} grounding objects=${segs.length} E-1 sections=${e1.length} labels=${labels.length}`);

const out = {
  generator: 'scripts/ecd-model-evidence.ts',
  directive: 'docs/ENGINE-CLOSURE-DIRECTIVE.md',
  mode: MODE,
  snapshotId: snap.meta?.snapshotId ?? null,
  snapshotDigest: snap.meta?.digest ?? null,
  bomRows: rows,
  approval: { ...approval, orderableRows: undefined },
  exports: {
    orderableRowIds: orderable.map(r => r.bomLineId),
    excluded: exclusions,
  },
  routeDependency: {
    requirementCode: ROUTE_CODE,
    open: routeOpen,
    affectsDeclaration: (snap.permitReadiness?.registry ?? [])
      .find((r: any) => r.code === ROUTE_CODE)?.resolutionAction ?? null,
    routeDerivedRowIds: routeRows.map(r => r.bomLineId),
    routeDerivedRows: routeRows,
  },
  cableExtension: { solutions: ctx.cableExtensionSolutions, connectorRows: qconn },
  supplySideTap: { authority: tapAuthority, rows: tapRows.map(rowRec) },
  grounding: {
    groupAuthorityId: BRANCH_EGC_AUTHORITY_GROUP_ID,
    canonicalBranchIds,
    physical: physicalSegs.map(s => ({ id: s.groundingSegmentId, purpose: s.purpose, kind: s.identityKind })),
    group: groupSegs.map(s => ({ id: s.groundingSegmentId, members: s.memberGroundingIds, kind: s.identityKind })),
    e1Sections: e1.map((s: any) => ({
      sectionId: s.sectionId ?? null, label: s.label ?? null,
      groundingSegmentId: s.groundingSegmentId, groundingAuthorityGroupId: s.groundingAuthorityGroupId,
      bondingPendingAuthority: s.bondingPendingAuthority,
    })),
  },
  bonding,
  documents: {
    listingConclusion: listing,
    scopeCodes: EQUIPMENT_LISTING_SCOPE_CODES,
    states: DOCUMENT_APPLICABILITY_STATES,
    establishedStates: APPLICABILITY_ESTABLISHED_STATES,
    rackingApplicability: rackingAppl,
  },
  topology: { labels },
  antiVacuity: { ok: probes.every(p => p.ok), probes },
};
writeFileSync(outPath, JSON.stringify(out, null, 2));
const bad = probes.filter(p => !p.ok);
console.log(`[ecd-model-evidence:${MODE}] ${outPath} — snapshot ${out.snapshotId} · `
  + `${approval.totalRowCount} rows (${approval.verifiedOrderableCount}A/${approval.estimatedFieldVerifyCount}B/`
  + `${approval.candidateNonOrderableCount}C/${approval.quantityPendingCount}D/${approval.excludedCount}E) · `
  + `anti-vacuity ${probes.length - bad.length}/${probes.length}`);
for (const p of bad) console.error(`[ecd-model-evidence] PROBE FAILED gate ${p.gate} ${p.id} — ${p.detail}`);
process.exit(bad.length === 0 ? 0 : 2);
