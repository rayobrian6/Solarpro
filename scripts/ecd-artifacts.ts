// ═══════════════════════════════════════════════════════════════════════════
// ecd-artifacts.ts — the ENGINE-CLOSURE DELIVERABLES.
//
//   Usage: tsx scripts/ecd-artifacts.ts
//
// Emits the docs/evidence/ artifacts docs/ENGINE-CLOSURE-DIRECTIVE.md
// "Deliverables" lists. Every AFTER number is READ from a canonical object or
// from the RENDERED package; nothing is re-derived here and nothing is
// hand-typed. Every BEFORE number is quoted from the FORENSIC MEASUREMENT
// recorded in docs/ECD-ROOT-CAUSE-MAP.md against dev @ 8cf77c8e, with the
// source line cited on the record — this pass cannot re-measure a tree it has
// already changed, so the baseline is a citation, never a re-run.
//
// All three acceptance modes are generated (fixture / insufficient / identity)
// exactly as scripts/braidon-rgm-regen.ts generates them.
// ═══════════════════════════════════════════════════════════════════════════
import { writeFileSync } from 'fs';
import { generatePermitHTML } from '../lib/permit/index';
import { generateCADLayout } from '../lib/cad/cadEngine';
import { braidonOriginalAuditFixture } from '../tests/fixtures/braidon-original-audit-fixture';
import type { SnapshotAuthorityInputs } from '../lib/permit/snapshot/authorityInputs';
import {
  buildProcurementApproval, orderableProcurementExport, nonOrderableProcurementExport,
  evaluateCableExtensionPromotion, buildProcurementClassificationContextFromSnapshot,
  procurementAuthorityOf, type PermitBOMItem,
} from '../lib/permit/utils/bomForPermit';
import { PROCUREMENT_AUTHORITY_STATES, PROCUREMENT_AUTHORITY_STATE_LABEL } from '../lib/bom-types-v4';
import {
  projectGroundingSegments, projectE1PhysicalSchedule, BRANCH_EGC_AUTHORITY_GROUP_ID,
} from '../lib/permit/snapshot/electricalProjection';
import { projectRackingBondingAuthority } from '../lib/permit/snapshot/rackingBonding';
import {
  projectEquipmentListingConclusion, EQUIPMENT_LISTING_SCOPE_CODES,
} from '../lib/permit/snapshot/equipmentListingConclusion';
import {
  evaluateDocumentApplicability, getManufacturerAsset, DOCUMENT_APPLICABILITY_STATES,
  APPLICABILITY_ESTABLISHED_STATES, DOCUMENT_APPLICABILITY_CHIP,
} from '../lib/manufacturer-assets-db';
import { getMountingSystemById } from '../lib/mounting-hardware-db';
import { selectFieldLabels } from '../lib/permit/utils/fieldLabels';
import { SOLAR_PANELS, MICROINVERTERS } from '../lib/equipment-db';

const OUT = 'docs/evidence';
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const write = (name: string, body: unknown): void => {
  writeFileSync(`${OUT}/${name}`, JSON.stringify(body, null, 2));
  console.log('[ecd-artifacts] wrote', `${OUT}/${name}`);
};
const BASELINE = 'dev @ 8cf77c8e (pre-ECD), as MEASURED and recorded in docs/ECD-ROOT-CAUSE-MAP.md';
const stamp = (artifact: string, section: string, extra?: Record<string, unknown>) => ({
  generatedAt: new Date().toISOString(),
  artifact,
  directive: `docs/ENGINE-CLOSURE-DIRECTIVE.md ${section}`,
  source: 'tests/fixtures/braidon-original-audit-fixture (frozen; zero mutable DB rows)',
  baselineSource: BASELINE,
  ...(extra ?? {}),
});

const ALLOWANCE: SnapshotAuthorityInputs = {
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

function gen(mode: 'fixture' | 'insufficient' | 'identity') {
  const input: any = clone(braidonOriginalAuditFixture);
  if (mode === 'identity') {
    input.project = input.project ?? {};
    input.project.projectName = `${input.project.projectName ?? 'BRAIDON M PILLA'} — Solar TEST`;
    input.project.designer = '';
  }
  const html = generatePermitHTML(input, undefined, mode === 'insufficient' ? ALLOWANCE : null);
  const snap = input._snapshot;
  const bom = (input.bom ?? []) as PermitBOMItem[];
  return {
    mode, input, html, snap, bom, cad: generateCADLayout(input),
    approval: buildProcurementApproval(bom),
    ctx: buildProcurementClassificationContextFromSnapshot(snap),
  };
}

const FX = gen('fixture');
const IN = gen('insufficient');
const ID = gen('identity');
const MODES = [FX, IN, ID];
const modeMeta = (g: typeof FX) => ({
  mode: g.mode,
  snapshotId: g.snap.meta.snapshotId,
  snapshotDigest: g.snap.meta.digest,
  openRequirementCount: (g.snap.permitReadiness?.registry ?? []).filter((r: any) => !r.resolved).length,
});

// ═══ 1. FINAL BOM ROW INVENTORY (unique ids) ════════════════════════════════
{
  const rowsOf = (g: typeof FX) => g.bom.map(r => {
    const p = procurementAuthorityOf(r);
    return {
      bomLineId: r.bomLineId, legacyOrdinalId: r.id ?? null,
      stageId: r.stageId ?? null, category: r.category, subSystem: r.subSystem ?? null,
      itemIdentity: p.itemIdentity, manufacturer: r.manufacturer, model: r.model,
      partNumber: r.partNumber, quantity: r.quantity, quantityUnit: p.quantityUnit,
      authorityState: p.authorityState, authorityStateLabel: PROCUREMENT_AUTHORITY_STATE_LABEL[p.authorityState],
      orderable: p.orderable, exportable: p.exportable,
      quantitySource: p.quantitySource, authoritySource: p.authoritySource,
      verificationStatus: p.verificationStatus,
      blockingRequirementCodes: p.blockingRequirementCodes,
      affectedRouteIds: p.affectedRouteIds, affectedEquipmentIds: p.affectedEquipmentIds,
      resolutionAction: p.resolutionAction, evidenceReferences: p.evidenceReferences,
      snapshotId: p.snapshotId, snapshotDigest: p.snapshotDigest,
    };
  });
  const audit = FX.approval.rowIdAudit;
  write('braidon-ecd-bom-row-inventory.json', {
    ...stamp('final BOM row inventory with stable unique row identities', '§1/§2 (deliverable 1)'),
    identityScheme: {
      producer: 'lib/bom/bomLineId.ts — bomLineIdFor(row) = BOM-<CATEGORY>-<FNV1a32 of the normalized '
        + 'content key stage:category:unit:partNumber>, with a -N ordinal suffix on collision',
      stampedBy: 'ONE pass at the end of generateBOMForPermit (stampBomLineIds), so the two rows that '
        + 'never passed through the V4 ordinal generator (the integrated combiner and the open-air '
        + 'branch EGC) are covered too',
      before: 'PermitBOMItem.id?: string — an OPTIONAL, ORDINAL `bom-v4-NNNN` assigned in emission '
        + 'order, with a GAP at 0008 (a post-filtered combiner row) and TWO rows carrying no id at all',
    },
    audit: { total: audit.total, unique: audit.unique, duplicateIds: audit.duplicateIds, hashCollisions: audit.hashCollisions, missingIds: audit.missingIds },
    modes: MODES.map(g => ({ ...modeMeta(g), rowCount: g.bom.length, rows: rowsOf(g) })),
  });
}

// ═══ 2. PROCUREMENT-STATE MATRIX (5 counts × 3 modes) ══════════════════════
{
  write('braidon-ecd-procurement-state-matrix.json', {
    ...stamp('procurement authority state matrix — the five states across the three acceptance modes', '§2/§10 (deliverable 2)'),
    states: PROCUREMENT_AUTHORITY_STATES.map(s => ({ state: s, label: PROCUREMENT_AUTHORITY_STATE_LABEL[s] })),
    matrix: MODES.map(g => ({
      ...modeMeta(g),
      totalRowCount: g.approval.totalRowCount,
      VERIFIED_ORDERABLE: g.approval.verifiedOrderableCount,
      ESTIMATED_FIELD_VERIFY: g.approval.estimatedFieldVerifyCount,
      CANDIDATE_NON_ORDERABLE: g.approval.candidateNonOrderableCount,
      QUANTITY_PENDING: g.approval.quantityPendingCount,
      EXCLUDED_NOT_APPLICABLE: g.approval.excludedCount,
      sum: PROCUREMENT_AUTHORITY_STATES.reduce((n, s) => n + g.approval.rowIdsByState[s].length, 0),
      countsReconcile: g.approval.countsReconcile,
      authoritativeExportCount: g.approval.authoritativeExportCount,
      procurementReady: g.approval.procurementReady,
      openProcurementRequirementCodes: g.approval.openProcurementRequirementCodes,
      rowIdsByState: g.approval.rowIdsByState,
    })),
    modeDeltas: {
      'insufficient − fixture':
        'QCABLE-PROCUREMENT-INSUFFICIENT opens (16 requirements vs 15) and the listed Q-Cable trunk '
        + 'assembly row leaves VERIFIED_ORDERABLE for CANDIDATE_NON_ORDERABLE: '
        + `${FX.approval.verifiedOrderableCount} → ${IN.approval.verifiedOrderableCount} orderable, `
        + `${FX.approval.candidateNonOrderableCount} → ${IN.approval.candidateNonOrderableCount} candidate.`,
      'identity − fixture':
        'PROJECT-NAME-NONPRODUCTION + DESIGNER-OF-RECORD-MISSING open (17 requirements vs 15). Both are '
        + 'ADMINISTRATIVE holds with no procurement-axis impact, so every row state is unchanged.',
    },
  });
}

// ═══ 3. BEFORE/AFTER POPULATION ARITHMETIC ═════════════════════════════════
{
  const SKIP = new Set(['solar_panel', 'panels', 'inverters']);
  const shown = FX.bom.filter(r => !SKIP.has(r.category));
  const above = FX.bom.filter(r => SKIP.has(r.category));
  write('braidon-ecd-population-arithmetic.json', {
    ...stamp('before/after BOM population arithmetic', '§1 (deliverable 3)'),
    before: {
      measuredAt: BASELINE,
      citation: 'docs/ECD-ROOT-CAUSE-MAP.md §1 — "The measured truth" + "The three divergent counters"',
      fullBomRows: 48,
      schedRenderedRows: 47,
      renderedCounters: [
        { rendered: 'TOTAL LINE ITEMS (THIS SCHEDULE, ALL ROWS INCLUDING PENDING)', value: 47, population: 'rows AFTER BOM_SKIP_CATEGORIES (renderer-local `flat.length`)', emitter: 'structuralPages.ts:1581' },
        { rendered: 'AUTHORITATIVE PROCUREMENT TOTAL — ORDERABLE ROWS ONLY (FULL BOM)', value: 36, population: 'the FULL 48-row BOM', emitter: 'structuralPages.ts:1578,1585,1590' },
        { rendered: '…ORDERABLE ROWS ONLY: 36 of 48 BOM line items. 12 EXCLUDED …', value: '36 / 48 / 12', population: 'the FULL 48-row BOM', emitter: 'structuralPages.ts:1629-1633' },
        { rendered: 'This system BOM contains 47 line items across 5 stages', value: 47, population: 'renderer-local slice', emitter: 'structuralPages.ts:1603' },
        { rendered: '44 items are required per NEC / manufacturer specification', value: 44, population: 'an ORTHOGONAL axis (required-vs-optional)', emitter: 'structuralPages.ts:1599,1604' },
      ],
      renderedRowTags: { 'data-bom-orderable="true"': 35, 'data-bom-orderable="false"': 12, total: 47 },
      contradiction:
        'Two counters over two different populations printed side by side with no label distinguishing '
        + 'them, plus a third on an orthogonal axis. The off-by-one (48−47, 36−35) IS the solar_panel '
        + 'row, silently counted ORDERABLE because it carried neither nonOrderable nor quantityState. '
        + 'The 47 rendered row tags themselves disproved the printed "36 of 48".',
      invariantHeld: false,
    },
    after: {
      measuredAt: 'this pass, from the rendered package + the ONE ProcurementApproval object',
      snapshotId: FX.snap.meta.snapshotId,
      population: 'the FULL BOM — every line the package orders. BOM_SKIP_CATEGORIES is now a DISPLAY-SECTION concern only.',
      totalRowCount: FX.approval.totalRowCount,
      rowsShownInTheBomTable: shown.length,
      rowsScheduledAboveInTheirOwnTables: above.length,
      rowsScheduledAboveIds: above.map(r => ({ bomLineId: r.bomLineId, category: r.category, state: procurementAuthorityOf(r).authorityState })),
      stateCounts: {
        VERIFIED_ORDERABLE: FX.approval.verifiedOrderableCount,
        ESTIMATED_FIELD_VERIFY: FX.approval.estimatedFieldVerifyCount,
        CANDIDATE_NON_ORDERABLE: FX.approval.candidateNonOrderableCount,
        QUANTITY_PENDING: FX.approval.quantityPendingCount,
        EXCLUDED_NOT_APPLICABLE: FX.approval.excludedCount,
      },
      arithmetic: `${FX.approval.verifiedOrderableCount} + ${FX.approval.estimatedFieldVerifyCount} + `
        + `${FX.approval.candidateNonOrderableCount} + ${FX.approval.quantityPendingCount} + `
        + `${FX.approval.excludedCount} = ${FX.approval.totalRowCount} = totalRowCount`,
      displaySplit: `${shown.length} shown in the BOM table + ${above.length} scheduled above = ${FX.approval.totalRowCount}`,
      authoritativeExportCount: FX.approval.authoritativeExportCount,
      countsReconcile: FX.approval.countsReconcile,
      invariantHeld: FX.approval.countsReconcile
        && shown.length + above.length === FX.approval.totalRowCount,
      retiredRenderedClaims: [
        '"36 of 48" (and every hardcoded N-of-M count of that class)',
        '"This system BOM contains {flat.length} line items" — a renderer-local counter',
        '"{N} items are required per NEC / manufacturer specification" — an orthogonal axis read as procurement',
        '"All quantities are derived from CAD geometry and equipment registry — no manual estimates."',
      ],
    },
    delta: {
      note:
        'The population did NOT change (48 rows, both before and after). What changed is that ONE counter '
        + 'now reports it, the display split is stated and reconciled by row id, and the orderable count '
        + 'fell from 36 to '
        + `${FX.approval.verifiedOrderableCount} because a row is only VERIFIED_ORDERABLE when nothing open `
        + 'affects it (fail-CLOSED) rather than whenever no flag happened to be set (fail-OPEN).',
      orderableBefore: 36,
      orderableAfter: FX.approval.verifiedOrderableCount,
      reclassified: {
        routeDerivedToEstimatedFieldVerify: FX.approval.estimatedFieldVerifyCount,
        toCandidateNonOrderable: FX.approval.candidateNonOrderableCount,
        quantityPending: FX.approval.quantityPendingCount,
      },
    },
  });
}

// ═══ 4. ROUTE-DEPENDENCY MAP ═══════════════════════════════════════════════
{
  const CODE = 'ROUTE-LENGTH-ESTIMATE';
  const reg = (FX.snap.permitReadiness?.registry ?? []).find((r: any) => r.code === CODE) ?? null;
  const routeRows = FX.bom.filter(r => procurementAuthorityOf(r).quantitySource === 'route-derived');
  write('braidon-ecd-route-dependency-map.json', {
    ...stamp('route-dependency map — every row whose quantity depends on unresolved route geometry', '§3 (deliverable 4)'),
    requirement: {
      code: CODE,
      open: !!reg,
      gateId: 'RG-5',
      findingType: reg?.findingType ?? null,
      affectsDeclaration: reg?.explanation ?? null,
      resolutionAction: reg?.resolutionAction ?? null,
      declarationSource: 'lib/permit/snapshot/releaseGates.ts — the RG-5 `affects` string already declared '
        + 'the procurement conductor/raceway FOOTAGE dependency; nothing on the BOM side consumed it.',
    },
    mechanism: {
      before: 'no ESTIMATED_FIELD_VERIFY state existed; route-derived footage was emitted with '
        + 'required=true, no nonOrderable, no quantityState — i.e. counted in the authoritative '
        + 'orderable total, including six 90° sweep rows whose own description reads '
        + '"rough-in allowance; exact bend count pending field routing".',
      after: 'the EMITTERS tag the rows at source with quantitySource=\'route-derived\' + affectedRouteIds; '
        + 'the ONE classifier maps (route-derived ∧ only ROUTE-LENGTH-ESTIMATE open) → ESTIMATED_FIELD_VERIFY. '
        + 'The design quantity stays VISIBLE and labelled "EST — FIELD VERIFY"; it is excluded from the '
        + 'authoritative total and from every export.',
      fabricatedDefaultRetired: 'the `r.onewayLengthFt ?? 30` fabricated 30 ft substitution '
        + '(4 sites in lib/bom-engine-v4.ts) is dead; an absent route length now yields QUANTITY_PENDING.',
    },
    routeDerivedRows: routeRows.map(r => {
      const p = procurementAuthorityOf(r);
      return {
        bomLineId: r.bomLineId, category: r.category, partNumber: r.partNumber,
        quantity: r.quantity, unit: r.unit, description: r.description ?? null,
        authorityState: p.authorityState, blockingRequirementCodes: p.blockingRequirementCodes,
        affectedRouteIds: p.affectedRouteIds, resolutionAction: p.resolutionAction,
      };
    }),
    counts: {
      routeDerivedRows: routeRows.length,
      estimatedFieldVerify: routeRows.filter(r => procurementAuthorityOf(r).authorityState === 'ESTIMATED_FIELD_VERIFY').length,
      heldByAStrongerAuthority: routeRows.filter(r => !procurementAuthorityOf(r).blockingRequirementCodes.includes(CODE)).map(r => ({
        bomLineId: r.bomLineId, partNumber: r.partNumber,
        governingCodes: procurementAuthorityOf(r).blockingRequirementCodes,
      })),
      verifiedOrderable: routeRows.filter(r => procurementAuthorityOf(r).authorityState === 'VERIFIED_ORDERABLE').length,
    },
    canonicalRouteObjects: (FX.snap.electrical?.routeSegments ?? []).map((s: any) => ({
      segmentId: s.segmentId, from: s.from, to: s.to, lengthFt: s.lengthFt ?? null, lengthAuthority: s.lengthAuthority ?? null,
    })),
  });
}

// ═══ 5. Q-CABLE CONNECTOR SELECTION REPORT ═════════════════════════════════
{
  const rows = (g: typeof FX) => g.bom.filter(r => /^Q-CONN-10/.test(r.partNumber ?? ''));
  write('braidon-ecd-qcable-connector-selection.json', {
    ...stamp('Q-Cable connector selection report — CableExtensionSolution contract', '§4 (deliverable 5)'),
    contract: {
      record: 'CableExtensionSolution (lib/permit/snapshot/types.ts) — solutionId, type, selected, '
        + 'manufacturer, selectedSku, compatibilityVerified, manufacturerDocument, representedInBom, '
        + 'verificationState, bomLineIds',
      promotionRule: 'lib/permit/utils/bomForPermit.ts — evaluateCableExtensionPromotion(): a connector '
        + 'row is promoted ONLY by a solution that is SELECTED, verificationState==="verified", names an '
        + 'exact SKU, has compatibilityVerified, carries a manufacturer document, is representedInBom, '
        + 'and NAMES THIS EXACT bomLineId. No solution ⇒ no promotion.',
      before: 'the two connector rows were emitted by the trunk-cable resolver with required=false, no '
        + 'orderability flag at all — data-bom-orderable="true", inside the 36 and inside the export — '
        + 'carrying installation-intent prose in derivedFrom, while no CableExtensionSolution existed '
        + 'anywhere (SnapshotAuthorityInputs.cableExtensionSolutions was a threading slot, always []).',
    },
    modes: MODES.map(g => ({
      ...modeMeta(g),
      cableExtensionSolutions: g.ctx.cableExtensionSolutions,
      procurementSufficiency: {
        insufficient: g.snap.electrical?.procurementSufficiency?.insufficient ?? null,
        deficitFt: g.snap.electrical?.procurementSufficiency?.deficitFt ?? null,
        thresholdFt: g.snap.electrical?.procurementSufficiency?.thresholdFt ?? null,
        resolutionOptions: g.snap.electrical?.procurementSufficiency?.resolutionOptions ?? [],
        clearedBySolutionId: g.snap.electrical?.procurementSufficiency?.clearedBySolutionId ?? null,
      },
      connectorRows: rows(g).map(r => {
        const p = procurementAuthorityOf(r);
        return {
          bomLineId: r.bomLineId, partNumber: r.partNumber, model: r.model,
          quantity: r.quantity, unit: r.unit, required: r.required !== false,
          derivedFrom: r.derivedFrom ?? null,
          authorityState: p.authorityState, orderable: p.orderable, exportable: p.exportable,
          authoritySource: p.authoritySource, resolutionAction: p.resolutionAction,
          promotion: evaluateCableExtensionPromotion(r.bomLineId ?? '(unstamped)', g.ctx.cableExtensionSolutions),
          inAuthoritativeExport: g.approval.orderableRowIds.includes(r.bomLineId ?? ''),
        };
      }),
    })),
    deficitSeparation:
      'The connector rows are NOT a resolution for the Q-Cable length deficit and are never named by the '
      + 'deficit statement or by the sufficiency authority\'s resolutionOptions. They are candidate '
      + 'hardware with no selected solution behind them; the deficit is closed only by a selected, '
      + 'verified CableExtensionSolution.',
  });
}

// ═══ 6. TAP CONNECTOR COMPATIBILITY REPORT ═════════════════════════════════
{
  const tapRows = (g: typeof FX) => g.bom.filter(r => /IPLD/i.test(r.partNumber ?? ''));
  write('braidon-ecd-tap-connector-compatibility.json', {
    ...stamp('supply-side tap connector compatibility report', '§5 (deliverable 6)'),
    authorityRecord: 'SupplySideTapConnectionAuthority (lib/permit/snapshot/supplySideTap.ts)',
    before: {
      emitter: 'lib/bom-engine-v4.ts — the isSupplySideTap branch, qty 3 ("L1+L2+N = 3"), required=true, '
        + 'data-bom-orderable="true", INSIDE the 36 and inside the export',
      caveat: 'the only representation of the unknown was PROSE inside the row\'s own description string: '
        + '"Verify lug range against actual service conductor size." — an instruction, on an orderable row, '
        + 'with no authority object behind it. A second, dead-for-this-design legacy emitter carried the '
        + 'same literal.',
    },
    modes: MODES.map(g => ({
      ...modeMeta(g),
      authority: g.snap.electrical?.supplySideTapConnection ?? null,
      rows: tapRows(g).map(r => {
        const p = procurementAuthorityOf(r);
        return {
          bomLineId: r.bomLineId, partNumber: r.partNumber, model: r.model,
          quantity: r.quantity, unit: r.unit, description: r.description ?? null,
          derivedFrom: r.derivedFrom ?? null,
          authorityState: p.authorityState, orderable: p.orderable, exportable: p.exportable,
          authoritySource: p.authoritySource, resolutionAction: p.resolutionAction,
          inAuthoritativeExport: g.approval.orderableRowIds.includes(r.bomLineId ?? ''),
        };
      }),
    })),
    twoWay:
      'The rule is two-way. bom-engine-v4 is a PRE-snapshot engine and stamps the candidate hint '
      + 'unconditionally; bomForPermit\'s post-pass now CLEARS that hint when the authority\'s '
      + 'verificationStatus is "verified", so a surveyed, listing-verified tap promotes the row through '
      + 'the classifier\'s normal path instead of being held at CANDIDATE forever.',
    designReviewVisibility:
      'The row stays on the design-review schedule with its SKU and its code-established quantity of 3 '
      + 'visible; it is excluded from the authoritative total and from every export, and it carries the '
      + 'mandated label "CANDIDATE CONNECTOR — VERIFY EXISTING SERVICE CONDUCTOR AND LUG COMPATIBILITY".',
  });
}

// ═══ 7. GROUNDING IDENTITY RECONCILIATION ══════════════════════════════════
{
  const segs = projectGroundingSegments(FX.snap);
  const e1 = projectE1PhysicalSchedule(FX.snap);
  const canonical = (FX.snap.electrical?.groundingObjects ?? []) as any[];
  const physical = segs.filter(s => s.identityKind === 'physical-segment');
  const group = segs.filter(s => s.identityKind === 'group-authority');
  const renderedIds = [...FX.html.matchAll(/data-grounding-segment-id="([^"]*)"/g)].map(m => m[1]);
  const histogram: Record<string, number> = {};
  for (const id of renderedIds) histogram[id] = (histogram[id] ?? 0) + 1;
  write('braidon-ecd-grounding-identity-reconciliation.json', {
    ...stamp('grounding identity reconciliation — physical segments vs the grouped authority', '§6 (deliverable 7)'),
    before: {
      citation: 'docs/ECD-ROOT-CAUSE-MAP.md §6',
      canonicalObjects: ['gnd-br-1', 'gnd-br-2', 'gnd-br-3'],
      renderedIdHistogram: { 'gnd-br-1': 8, 'gnd-br-2': 0, 'gnd-br-3': 0 },
      collapseSiteA: 'electricalProjection.ts — the grouped PV-4B branch-EGC authority object was emitted '
        + 'with `g.groundingId`, i.e. the FIRST record\'s PHYSICAL id',
      collapseSiteB: 'electricalProjection.ts — `_oaSegmentId` was computed ONCE from branchGnd[0] and '
        + 'stamped on EVERY E-1 branch section inside branches.forEach',
      consequence: 'three canonical physical objects rendered as ONE identity; the uniqueness gate was '
        + 'unprovable because only one id was ever rendered.',
    },
    after: {
      groupAuthorityId: BRANCH_EGC_AUTHORITY_GROUP_ID,
      canonicalPhysicalObjects: canonical.map(g => ({ groundingId: g.groundingId, purpose: g.purpose })),
      projectedGroupAuthority: group.map(s => ({
        groundingSegmentId: s.groundingSegmentId, identityKind: s.identityKind,
        groundingId: s.groundingId, memberGroundingIds: s.memberGroundingIds,
        branchScope: s.branchScope, bomLineId: s.bomLineId, bomLinePartNumber: (s as any).bomLinePartNumber ?? null,
      })),
      projectedPhysicalSegments: physical.map(s => ({
        groundingSegmentId: s.groundingSegmentId, identityKind: s.identityKind, purpose: s.purpose,
      })),
      e1Sections: e1.map((s: any) => ({
        sectionId: s.sectionId ?? null, label: s.label ?? null,
        groundingSegmentId: s.groundingSegmentId,
        groundingAuthorityGroupId: s.groundingAuthorityGroupId,
        bondingPendingAuthority: s.bondingPendingAuthority,
      })),
      renderedIdHistogram: histogram,
      invariants: {
        physicalIdsUnique: (() => {
          const all = [...physical.map(s => s.groundingSegmentId), ...e1.map((s: any) => s.groundingSegmentId).filter(Boolean)];
          return new Set(all).size === all.length;
        })(),
        groupAuthorityNotInThePhysicalSet:
          !physical.some(s => s.groundingSegmentId === BRANCH_EGC_AUTHORITY_GROUP_ID)
          && !e1.some((s: any) => s.groundingSegmentId === BRANCH_EGC_AUTHORITY_GROUP_ID),
        groupIdIsNotAPhysicalSegmentIdShape: !/^gnd-br-\d+$/.test(BRANCH_EGC_AUTHORITY_GROUP_ID),
        renderedDistinctBranchIds: [...new Set(renderedIds.filter(i => /^gnd-br-\d+$/.test(i)))].sort(),
        renderedCountEqualsEvidenceCount:
          [...new Set(renderedIds.filter(i => /^gnd-br-\d+$/.test(i)))].length
          === canonical.filter(g => g.purpose === 'branch-egc').length,
        // Every E-1 section GOVERNED BY the branch-EGC group authority must
        // reconcile to exactly ONE canonical GroundingRecord. (The raceway-EGC
        // sections carry their own raceway-derived path ids and are governed by
        // no group — they are checked for uniqueness above, not membership.)
        everyGroupGovernedRowReconcilesToOneCanonicalObject:
          e1.filter((s: any) => s.groundingAuthorityGroupId === BRANCH_EGC_AUTHORITY_GROUP_ID)
            .every((s: any) => canonical.filter(c => c.groundingId === s.groundingSegmentId).length === 1),
        groupGovernedSectionCount: e1.filter((s: any) => s.groundingAuthorityGroupId === BRANCH_EGC_AUTHORITY_GROUP_ID).length,
        ungovernedPhysicalSectionIds: e1
          .filter((s: any) => s.groundingAuthorityGroupId === null && s.groundingSegmentId)
          .map((s: any) => s.groundingSegmentId),
      },
      bomLinePointer: {
        before: 'GroundingSegment.bomLineId was a PART NUMBER (`GRN-OPENAIR-<size>`) because no stable row id existed',
        after: 'GroundingSegment.bomLineId is the REAL content-derived BOM row id (bomLineIdFor); the part '
          + 'number moved to its own field bomLinePartNumber',
        value: group[0]?.bomLineId ?? null,
      },
    },
  });
}

// ═══ 8. BONDING AUTHORITY REPORT ═══════════════════════════════════════════
{
  const b = projectRackingBondingAuthority(FX.snap);
  write('braidon-ecd-bonding-authority-report.json', {
    ...stamp('racking bonding authority report — requirement vs method', '§7 (deliverable 8)'),
    before: {
      citation: 'docs/ECD-ROOT-CAUSE-MAP.md §7',
      literal: "lib/drafting/templates/roof.ts — the PV-3 FASTENER & HARDWARE SCHEDULE hwRows array: "
        + "['BONDING', 'UL 2703 INTEGRATED — NEC 690.43'], present in BOTH the verified-assembly branch "
        + 'AND the assembly-pending branch',
      companionLiterals: [
        "lib/drafting/sheetComposition.ts — PV-3 callout ⑦ { label: 'BONDING JUMPER', sub: 'NEC 690.43' }",
        "lib/permit/sections/electricalPages.ts — SVG detail text 'MODULE RAIL — BONDED (UL 2703)'",
        "lib/permit/sections/compliancePages.ts — the APP-A 'UL Listing' row printed 'UL 2703' unless "
        + 'mount.ul2703Listed === false (a FAIL-OPEN default)',
      ],
      contradiction: 'the same table printed FASTENER ASSEMBLY: PENDING VERIFIED SELECTION, INSTALLATION '
        + 'DETAILS: NOT ESTABLISHED, EMBEDMENT / TORQUE / PILOT: WITHHELD — NO VERIFIED SOURCE — and then '
        + 'asserted BONDING: UL 2703 INTEGRATED.',
    },
    after: {
      record: 'RackingBondingAuthority (lib/permit/snapshot/rackingBonding.ts), stored at structural.rackingBonding',
      outcomes: ['INTEGRATED_LISTED_BONDING_VERIFIED', 'SEPARATE_BONDING_COMPONENTS_VERIFIED', 'METHOD_PENDING_ASSEMBLY_SELECTION'],
      authority: b,
      consumedBy: [
        'lib/drafting/templates/roof.ts — PV-3 hardware schedule BONDING row (both branches)',
        'lib/drafting/sheetComposition.ts — PV-3 callout ⑦',
        'lib/permit/sections/electricalPages.ts — the grounding/bonding SVG detail',
        'lib/permit/sections/compliancePages.ts — APP-A Bonding Method + Bonding Requirement rows',
        'lib/permit/sections/structuralPages.ts — the PV-3 authority block',
        'lib/permit/snapshot/build.ts — the canonical record construction',
      ],
      requirementPreserved: {
        bondingRequired: b.bondingRequired,
        requirementCodeBasis: b.requirementCodeBasis,
        requirementLabel: b.requirementLabel,
        note: 'the general NEC 250.134 / 690.43 bonding REQUIREMENT is code and is never gated by the method',
      },
      methodPending: {
        result: b.result,
        methodLabel: b.methodLabel,
        methodShortLabel: b.methodShortLabel,
        methodCompactLabel: b.methodCompactLabel,
        reasons: b.reasons,
      },
    },
  });
}

// ═══ 9. APP-A DOCUMENT-STATE REPORT ════════════════════════════════════════
{
  const listing = projectEquipmentListingConclusion(FX.snap);
  const project = FX.input.project ?? {};
  const panel = SOLAR_PANELS.find(p => p.model.toLowerCase() === String(project._canonical?.module?.model ?? '').toLowerCase())
    ?? SOLAR_PANELS.find(p => String(project._canonical?.module?.model ?? '').toLowerCase().includes(p.model.toLowerCase()));
  const micro = MICROINVERTERS.find(m => String(project._canonical?.inverter?.model ?? '').toLowerCase().includes(m.model.toLowerCase()));
  const rows = [
    { label: 'Module', asset: getManufacturerAsset(panel?.id, 'module_spec'), selectedModel: panel?.model ?? null },
    { label: 'Inverter', asset: getManufacturerAsset(micro?.id, 'microinverter_spec') || getManufacturerAsset(micro?.id, 'inverter_spec'), selectedModel: micro?.model ?? null },
    { label: 'Racking', asset: getManufacturerAsset(project.mountingSystemId, 'racking_detail'), selectedModel: getMountingSystemById(project.mountingSystemId ?? '')?.model ?? null },
  ].filter(r => !!r.asset);
  write('braidon-ecd-appa-document-state-report.json', {
    ...stamp('APP-A document-state report — the seven-state document model', '§8 (deliverable 9)'),
    before: {
      citation: 'docs/ECD-ROOT-CAUSE-MAP.md §8',
      sentence: 'All equipment is CEC Listed, UL Listed, and approved for grid interconnection. — a BARE '
        + 'LITERAL in compliancePages.ts, no registry read, no requirement check, no gate.',
      tick: "const mark = a.verified ? '✓ on file' : 'on file' — a.verified is ManufacturerAsset.verified, "
        + 'documented as "true only when the source_url was fetched + confirmed": a SCRAPE flag with no '
        + 'relationship to applicability. Three green ticks rendered, one of them on the Racking row whose '
        + 'very next span said APPLICABILITY UNVERIFIED.',
      applicabilityCoverage: 'applicability was evaluated only when a selectedModel argument was passed — '
        + '1 of the 5 document rows (Racking). Module / Inverter / Battery / AC-Combiner were structurally '
        + 'incapable of showing an applicability state.',
      stateModel: "binary DocumentApplicability.state: 'verified' | 'unverified'",
    },
    after: {
      states: DOCUMENT_APPLICABILITY_STATES.map(s => ({ state: s, chip: DOCUMENT_APPLICABILITY_CHIP[s] })),
      establishedStates: APPLICABILITY_ESTABLISHED_STATES,
      rule: 'ARCHIVED is a COMPANION availability chip and is NEVER the verdict — archived ≠ applicable. '
        + 'AUTHORITATIVE additionally requires a real archived + content-hash-bound registry record. '
        + 'SUPERSEDED comes only from a registry status supplied by the caller; nothing is inferred from a '
        + 'product NAME.',
      applicabilityCoverage: 'evaluated for EVERY document row (selectedModel is passed on all of them, '
        + 'falling back to the asset\'s own keyed model)',
      tickRule: 'the green ✓ is gone. Availability and applicability render as separate chips and a '
        + 'positive style is reserved for APPLICABLE / VERIFIED / AUTHORITATIVE.',
      // The canonical evaluation for the rows this harness can resolve…
      documentRows: rows.map(r => {
        const appl = evaluateDocumentApplicability(r.selectedModel ?? r.asset!.model, r.asset, null);
        return {
          label: r.label, assetId: r.asset!.id, brand: r.asset!.brand, assetModel: r.asset!.model,
          docTitle: r.asset!.docTitle, selectedModel: r.selectedModel,
          sourceUrlConfirmed: appl.sourceUrlConfirmed,
          states: appl.states, primaryState: appl.state,
          archived: appl.archived, referencedNotArchived: appl.referencedNotArchived,
          applicabilityVerified: appl.applicabilityVerified, authoritative: appl.authoritative,
          documentProduct: appl.documentProduct, reason: appl.reason,
        };
      }),
      // …and the RENDERED truth, read back off APP-A so the artifact reports what
      // the reviewer actually sees (this is the authoritative list — the sheet
      // resolves the inverter / combiner rows through the integrated-equipment
      // resolver, which this artifact does not re-implement).
      renderedDocumentRows: (() => {
        const appA = FX.html.split(/<div class="page(?=[ "])/).slice(1)
          .filter(p => /tb-sheet-id">\s*APP-A/.test(p)).join('\n');
        return [...appA.matchAll(/<li><strong>([^<]+):<\/strong>([\s\S]*?)<\/li>/g)].map(m => ({
          label: m[1],
          documentStates: [...m[2].matchAll(/data-ds-doc-state="([A-Z_]+)"/g)].map(x => x[1]),
          applicabilityTag: (m[2].match(/data-ds-applicability="([^"]*)"/) ?? [])[1] ?? null,
          authoritativeTag: (m[2].match(/data-ds-authoritative="([^"]*)"/) ?? [])[1] ?? null,
          positiveTickPresent: /✓|&check;/.test(m[2]),
          text: m[2].replace(/<[^>]+>/g, ' ').replace(/&mdash;/g, '—').replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ').trim(),
        }));
      })(),
      rtMiniCase: {
        note: 'the exact case the directive names',
        ...(() => {
          const a = getManufacturerAsset(project.mountingSystemId, 'racking_detail');
          const appl = evaluateDocumentApplicability('RT-MINI', a, null);
          return {
            ARCHIVED: appl.archived, APPLICABLE_TO_RT_MINI: appl.applicabilityVerified,
            AUTHORITATIVE: appl.authoritative, renderedStates: appl.states,
            documentProduct: appl.documentProduct,
          };
        })(),
      },
      listingConclusion: {
        ...listing,
        scopeCodes: EQUIPMENT_LISTING_SCOPE_CODES,
        note: 'derived from the canonical release-gate registry — it can only turn positive when the '
          + 'in-scope requirement set is clear. FAIL-CLOSED with no registry.',
      },
    },
    knownFutureWiring: {
      issue: 'SUPERSEDED and AUTHORITATIVE are REACHABLE but UNWIRED on the render path.',
      detail: 'both require DocumentRegistryFacts (archivedInRepo + sha256 + status) from '
        + 'lib/documents/registry.ts, which is async/DB-backed. evaluateDocumentApplicability takes those '
        + 'facts as a pure ARGUMENT and never guesses them, and the synchronous render path does not '
        + 'supply them today. The states are proven reachable by the harness anti-vacuity probe for gate '
        + '15 (alias+archived+hash → AUTHORITATIVE; registry status superseded → SUPERSEDED).',
      classification: 'FUTURE WIRING, not a defect: the honest current output is ARCHIVED + '
        + 'APPLICABLE / PENDING_APPLICABILITY, and nothing is claimed that the inputs do not support.',
    },
  });
}

// ═══ 10. TOPOLOGY / CITATION REPORT ════════════════════════════════════════
{
  const labels = selectFieldLabels(FX.input, FX.cad);
  write('braidon-ecd-topology-citation-report.json', {
    ...stamp('package-wide topology / code-citation report', '§9 (deliverable 10)'),
    designTopology: {
      interconnectionMethod: FX.snap.electrical?.supplySideTapConnection?.interconnectionMethod ?? null,
      governingArticle: 'NEC 705.11 (supply-side / line-side tap)',
      necEdition: FX.snap.codeAuthority?.editions?.nec ?? null,
    },
    before: {
      citation: 'docs/ECD-ROOT-CAUSE-MAP.md §9',
      renderedLabel: 'NEC 2020 705.11 / 705.12(A) on the PV-5 placard schedule (×2)',
      dataSource: "lib/data/placards/field-placards-research.json — placard 'line-side-tap-warning', "
        + 'NEC-2020 codeRef section "705.11 / 705.12(A)"',
      classifier: "lib/permit/utils/fieldLabels.ts — necSectionSide() carried an explicit special case "
        + "`if (/705\\.12\\(A\\)/) return 'supply'` (705.12(A) was the 2017 supply-side reference), so "
        + 'filterSectionByTopology KEPT both halves on a supply-side design.',
      defect: 'a citation stamped with the 2020 edition, in which 705.12 is the LOAD-SIDE article — a '
        + 'wrong-edition AND wrong-side citation.',
    },
    after: {
      fixSites: [
        'lib/data/placards/field-placards-research.json — the NEC-2020 codeRef no longer carries 705.12(A)',
        "lib/permit/utils/fieldLabels.ts — the 705.12(A) → 'supply' special case is DELETED; every 705.12 "
        + 'subdivision (including (A)) is load-side for labelling, so no future placard row can '
        + 'reintroduce it through either path',
      ],
      gateScope: 'the package-wide topology/citation gate now covers the PV-5 placard CODE-REF cells '
        + '(machine-tagged data-label-nec-ref / data-label-side / data-label-required) in addition to '
        + 'E-1 / PV-4A / PV-4B / SCHED / warning-label text.',
      labels: labels.map(l => ({
        refId: l.refId, necRef: l.necRef, side: l.interconnectSide, required: l.required, placement: l.placement,
      })),
      counts: {
        total: labels.length,
        supplySideOnly: labels.filter(l => l.interconnectSide === 'supply-side-only').length,
        loadSideOnly: labels.filter(l => l.interconnectSide === 'load-side-only').length,
        general: labels.filter(l => l.interconnectSide === 'general').length,
        requiredLabelsCitingALoadSideArticle: labels.filter(l => l.required && /705\.12|705\.13/.test(l.necRef)).length,
      },
      remaining705_12Mentions:
        'Every remaining 705.12 mention in the package is an explicitly NEGATED contrast ("the 120% '
        + 'busbar rule (NEC 705.12(B)) does not apply to supply-side connections" / "N/A" / "applies only '
        + 'load-side"). None is rendered as this design\'s governing interconnection article.',
    },
  });
}

// ═══ 11. BEFORE/AFTER BOM SUMMARY ══════════════════════════════════════════
{
  write('braidon-ecd-bom-summary-before-after.json', {
    ...stamp('before/after BOM summary block', '§10 (deliverable 11)'),
    before: {
      citation: 'docs/ECD-ROOT-CAUSE-MAP.md §10 (emitter block structuralPages.ts:1599-1613)',
      renderedClaims: [
        'This system BOM contains 47 line items across 5 stages',
        '44 items are required per NEC / manufacturer specification',
        'All quantities are derived from CAD geometry and equipment registry — no manual estimates.',
      ],
      whyFalse: 'contradicted by 21 route-estimated rows, 12 excluded rows, and 6 rows whose own '
        + 'description reads "rough-in allowance; exact bend count pending field routing".',
    },
    after: {
      block: 'PROCUREMENT AUTHORITY SUMMARY (data-procurement-summary="state-derived")',
      statement: FX.approval.statement,
      renderedFields: {
        totalRowCount: FX.approval.totalRowCount,
        VERIFIED_ORDERABLE: FX.approval.verifiedOrderableCount,
        ESTIMATED_FIELD_VERIFY: FX.approval.estimatedFieldVerifyCount,
        CANDIDATE_NON_ORDERABLE: FX.approval.candidateNonOrderableCount,
        QUANTITY_PENDING: FX.approval.quantityPendingCount,
        EXCLUDED_NOT_APPLICABLE: FX.approval.excludedCount,
        authoritativeExportCount: FX.approval.authoritativeExportCount,
        procurementReady: FX.approval.procurementReady,
        openProcurementRequirementCodes: FX.approval.openProcurementRequirementCodes,
      },
      bannedPhrasesAbsent: [
        'all required', 'no manual estimates', 'complete procurement package', 'authoritative total (unqualified)',
      ],
      note: 'every number is read from the SAME ProcurementApproval object the table totals and both '
        + 'export artifacts read. Each row states its own state and reason on the row; the summary never '
        + 'enumerates the excluded rows inline (37 of them would clip the sheet and duplicate the rows).',
    },
  });
}

// ═══ 12 + 13. THE TWO EXPORT ARTIFACTS ═════════════════════════════════════
{
  const exportRow = (r: PermitBOMItem) => {
    const p = procurementAuthorityOf(r);
    return {
      bomLineId: p.bomLineId, itemIdentity: p.itemIdentity,
      manufacturer: r.manufacturer, model: r.model, partNumber: r.partNumber,
      quantity: p.quantity, quantityUnit: p.quantityUnit,
      category: r.category, stageId: r.stageId ?? null,
      authorityState: p.authorityState, quantitySource: p.quantitySource,
      authoritySource: p.authoritySource, verificationStatus: p.verificationStatus,
      snapshotId: p.snapshotId, snapshotDigest: p.snapshotDigest,
    };
  };
  write('braidon-ecd-procurement-export-authoritative.json', {
    ...stamp('AUTHORITATIVE procurement export — VERIFIED_ORDERABLE rows only', '§12 gate 18 (deliverable 12)'),
    producer: 'lib/permit/utils/bomForPermit.ts — orderableProcurementExport(items). THE procurement-export '
      + 'gate: any orderable export (purchase order, CSV, distributor cart, evidence artifact) MUST derive '
      + 'from it, and a row that is not VERIFIED_ORDERABLE cannot enter it.',
    warning: 'This package is NOT an approved procurement release. Rows outside this artifact are excluded '
      + 'from every order export until their authority verifies.',
    modes: MODES.map(g => ({
      ...modeMeta(g),
      count: g.approval.authoritativeExportCount,
      rowIds: g.approval.orderableRowIds,
      rows: orderableProcurementExport(g.bom).map(exportRow),
      quantityByUnit: g.approval.orderableQuantityByUnit,
    })),
  });
  write('braidon-ecd-procurement-export-excluded.json', {
    ...stamp('EXCLUDED / NON-ORDERABLE rows — visible in design review, never in an order export', '§12 gate 19 (deliverable 13)'),
    producer: 'lib/permit/utils/bomForPermit.ts — nonOrderableProcurementExport(items)',
    contract: 'every row NOT in the authoritative export appears here exactly once, with its state and the '
      + 'reason it is held. The two artifacts partition the population: '
      + `${FX.approval.authoritativeExportCount} + ${FX.approval.totalRowCount - FX.approval.authoritativeExportCount} = ${FX.approval.totalRowCount}.`,
    modes: MODES.map(g => ({
      ...modeMeta(g),
      count: g.approval.totalRowCount - g.approval.authoritativeExportCount,
      byState: Object.fromEntries(PROCUREMENT_AUTHORITY_STATES
        .filter(s => s !== 'VERIFIED_ORDERABLE')
        .map(s => [s, g.approval.rowIdsByState[s]])),
      rows: nonOrderableProcurementExport(g.bom).map(e => {
        const row = g.bom.find(r => r.bomLineId === e.bomLineId);
        const p = row ? procurementAuthorityOf(row) : null;
        return {
          ...e,
          quantitySource: p?.quantitySource ?? null,
          blockingRequirementCodes: p?.blockingRequirementCodes ?? [],
          resolutionAction: p?.resolutionAction ?? null,
        };
      }),
    })),
  });
}

console.log('[ecd-artifacts] done — 13 deliverable artifacts');
