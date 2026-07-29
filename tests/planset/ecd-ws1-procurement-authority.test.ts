// ═══════════════════════════════════════════════════════════════════════════
// ECD WS-1 — BOM / PROCUREMENT AUTHORITY (docs/ENGINE-CLOSURE-DIRECTIVE.md
// §1 §2 §3 §4 §5 §10; docs/ECD-ROOT-CAUSE-MAP.md W1-A … W1-F).
//
// Every assertion here is anti-vacuous: it names the exact row, the exact
// state and the exact requirement code, on the REAL frozen Braidon package
// regenerated through the public API — no injected snapshot, no patched HTML.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import { generatePermitHTML } from '@/lib/permit/index';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { SnapshotAuthorityInputs } from '@/lib/permit/snapshot/authorityInputs';
import type { PermitDesignSnapshot, CableExtensionSolution } from '@/lib/permit/snapshot/types';
import { SUPPLY_SIDE_TAP_CANDIDATE_LABEL } from '@/lib/permit/snapshot/types';
import {
  buildProcurementApproval,
  buildProcurementClassificationContextFromSnapshot,
  classifyProcurementAuthority,
  countProcurementStates,
  evaluateCableExtensionPromotion,
  isOrderableForProcurement,
  orderableProcurementExport,
  nonOrderableProcurementExport,
  procurementAuthorityOf,
  EMPTY_PROCUREMENT_CONTEXT,
  type PermitBOMItem,
} from '@/lib/permit/utils/bomForPermit';
import {
  bomLineIdFor, bomLineIdentityKey, stampBomLineIds, auditBomLineIds,
} from '@/lib/bom/bomLineId';
import { PROCUREMENT_AUTHORITY_STATES } from '@/lib/bom-types-v4';
import fs from 'node:fs';
import path from 'node:path';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** SYNTHETIC, clearly-labelled, STRICTER-ONLY allowance (as the RGM harness). */
const INSUFFICIENT_AUTHORITY: SnapshotAuthorityInputs = {
  capacityDocument: null, projectJurisdiction: null, manufacturerDocumentsArchived: null,
  digestInvalidatedByLedger: false, framingCapacityDocument: null, framingProjectApplicabilityKey: null,
  cableExtensionSolutions: [],
  qcableServiceLoopAllowance: {
    allowanceFt: 26,
    documentId: 'SYNTHETIC-ECD-ALLOWANCE (TEST HARNESS RECORD — NOT REAL MANUFACTURER EVIDENCE)',
    note: 'Stricter-only synthetic allowance.', provenance: 'ecd-ws1-test-synthetic-allowance',
  },
  environmentalSource: null,
};

interface Generated { html: string; bom: PermitBOMItem[]; snap: PermitDesignSnapshot }

function generate(opts?: { insufficient?: boolean; solutions?: CableExtensionSolution[] }): Generated {
  const input: any = clone(braidonOriginalAuditFixture);
  const auth: SnapshotAuthorityInputs | null = opts?.insufficient || opts?.solutions
    ? { ...INSUFFICIENT_AUTHORITY, cableExtensionSolutions: opts?.solutions ?? [] }
    : null;
  const html = generatePermitHTML(input, undefined, auth);
  return { html, bom: (input.bom ?? []) as PermitBOMItem[], snap: input._snapshot as PermitDesignSnapshot };
}

let fixture: Generated;
let insufficient: Generated;

beforeAll(() => {
  fixture = generate();
  insufficient = generate({ insufficient: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// W1-A — STABLE ROW IDENTITY (§1's load-bearing prerequisite)
// ═══════════════════════════════════════════════════════════════════════════
describe('W1-A — stable, content-derived bomLineId', () => {
  it('every row has one; none is missing, duplicated, or a hash collision', () => {
    const audit = auditBomLineIds(fixture.bom);
    expect(audit.total).toBe(fixture.bom.length);
    expect(audit.missingIds, 'rows with no bomLineId').toBe(0);
    expect(audit.duplicateIds, 'duplicate bomLineIds').toEqual([]);
    expect(audit.hashCollisions, 'distinct content keys sharing one base id').toEqual([]);
    expect(audit.unique).toBe(audit.total);
  });

  it('covers the two rows that had NO ordinal id at all (§Row-ID inventory 3)', () => {
    // the integrated combiner (appended after the V4 merge) and the open-air EGC
    const combiner = fixture.bom.find(r => r.derivedFrom === 'integrated-bos resolver');
    const openAir = fixture.bom.find(r => String(r.partNumber).startsWith('GRN-OPENAIR'));
    expect(combiner, 'integrated combiner row missing').toBeTruthy();
    expect(openAir, 'open-air branch EGC row missing').toBeTruthy();
    expect(combiner!.id, 'the combiner row still has no ORDINAL id (unchanged)').toBeUndefined();
    expect(openAir!.id).toBeUndefined();
    expect(combiner!.bomLineId, 'but it now has a stable row id').toMatch(/^BOM-[A-Z0-9-]+-[0-9A-F]{8}$/);
    expect(openAir!.bomLineId).toMatch(/^BOM-[A-Z0-9-]+-[0-9A-F]{8}$/);
  });

  it('is CONTENT-derived: insertion and reordering do not change any id', () => {
    const base = fixture.bom.map(r => ({ ...r }));
    const ids = base.map(r => r.bomLineId!);

    // reorder (reverse) — ids must be identical per row
    const reversed = base.slice().reverse().map(r => ({ ...r, bomLineId: undefined }));
    stampBomLineIds(reversed as PermitBOMItem[]);
    for (const r of reversed) {
      const orig = base.find(b => b.partNumber === r.partNumber && b.category === r.category);
      expect(r.bomLineId, `reorder changed ${r.partNumber}`).toBe(orig!.bomLineId);
    }

    // insert a NEW row at the FRONT — every existing id is unchanged
    // (the ordinal `id` scheme renumbered every downstream row here)
    const withInsert = [
      { category: 'label', manufacturer: 'X', model: 'Y', partNumber: 'BRAND-NEW-ROW',
        quantity: 1, unit: 'ea', stageId: 'labels' } as PermitBOMItem,
      ...base.map(r => ({ ...r, bomLineId: undefined })),
    ];
    stampBomLineIds(withInsert as PermitBOMItem[]);
    expect(withInsert.slice(1).map(r => r.bomLineId)).toEqual(ids);
  });

  it('quantity is deliberately NOT part of the identity key', () => {
    const a = { stageId: 'ac', category: 'conduit', partNumber: 'PVC-1', unit: 'ft' };
    expect(bomLineIdFor(a)).toBe(bomLineIdFor({ ...a }));
    // …but the part number IS
    expect(bomLineIdFor(a)).not.toBe(bomLineIdFor({ ...a, partNumber: 'PVC-2' }));
  });

  it('placeholder part numbers fall back to the DESCRIPTION, so nine TBD racking rows do not collide', () => {
    const tbd = fixture.bom.filter(r => String(r.partNumber).toUpperCase() === 'TBD');
    expect(tbd.length, 'anti-vacuity: the design must actually carry TBD rows').toBeGreaterThanOrEqual(7);
    const keys = new Set(tbd.map(r => bomLineIdentityKey(r)));
    expect(keys.size, 'TBD rows collapsed onto one identity key').toBe(tbd.length);
    expect(new Set(tbd.map(r => r.bomLineId)).size).toBe(tbd.length);
  });

  it('two genuinely identical rows get a deterministic collision ordinal, never a silent overwrite', () => {
    const dup: PermitBOMItem[] = [
      { category: 'fuse', manufacturer: 'M', model: 'F', partNumber: 'F-1', quantity: 1, unit: 'ea', stageId: 'ac' },
      { category: 'fuse', manufacturer: 'M', model: 'F', partNumber: 'F-1', quantity: 9, unit: 'ea', stageId: 'ac' },
    ];
    const audit = stampBomLineIds(dup);
    expect(dup[1].bomLineId).toBe(`${dup[0].bomLineId}-2`);
    expect(audit.duplicateIds).toEqual([]);
    expect(audit.hashCollisions, 'same KEY is a duplicate row, not a hash collision').toEqual([]);
  });

  it('the cross-object reference is a REAL row id, not a part number (§6 crossover note)', () => {
    const segs = (fixture.snap as any).electricalProjection ?? null;
    // the projection is exercised through the rendered package; assert on the
    // BOM side that the id the projection computes exists as a real row.
    const openAir = fixture.bom.find(r => String(r.partNumber).startsWith('GRN-OPENAIR'))!;
    const expected = bomLineIdFor({
      stageId: 'ac', category: 'wire', unit: 'ft', partNumber: openAir.partNumber,
    });
    expect(openAir.bomLineId).toBe(expected);
    expect(expected).not.toBe(openAir.partNumber);
    void segs;
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W1-B — ONE STATE PER ROW, FAIL-CLOSED (§2)
// ═══════════════════════════════════════════════════════════════════════════
describe('W1-B — ProcurementAuthorityState consolidation', () => {
  it('exactly one state per row, and the five counts sum to the total (gates 2 + 3)', () => {
    for (const mode of [fixture, insufficient]) {
      const a = buildProcurementApproval(mode.bom);
      expect(a.countsReconcile).toBe(true);
      expect(
        a.verifiedOrderableCount + a.estimatedFieldVerifyCount + a.candidateNonOrderableCount
        + a.quantityPendingCount + a.excludedCount,
      ).toBe(a.totalRowCount);
      for (const r of mode.bom) {
        expect(PROCUREMENT_AUTHORITY_STATES).toContain(r.procurement!.authorityState);
      }
    }
  });

  it('is FAIL-CLOSED: an unflagged row with no rule and an unclassified row are BOTH non-orderable', () => {
    // (the retired rule was literally "an unflagged row is a verified row")
    const unknownCategory: PermitBOMItem = {
      category: 'mystery_widget', manufacturer: 'ACME', model: 'W', partNumber: 'W-1',
      quantity: 4, unit: 'ea', stageId: 'ac', bomLineId: 'BOM-TEST-00000001',
    };
    const rec = classifyProcurementAuthority(unknownCategory, EMPTY_PROCUREMENT_CONTEXT);
    expect(rec.authorityState).toBe('CANDIDATE_NON_ORDERABLE');
    expect(rec.orderable).toBe(false);
    expect(rec.authoritySource).toContain('fail-closed');

    const neverClassified: PermitBOMItem = {
      category: 'label', manufacturer: 'A', model: 'B', partNumber: 'L-1',
      quantity: 1, unit: 'ea', stageId: 'labels',
    };
    expect(neverClassified.procurement).toBeUndefined();
    expect(isOrderableForProcurement(neverClassified)).toBe(false);
  });

  it('nonOrderable / quantityState are PROJECTIONS of the state, never independent inputs', () => {
    for (const r of insufficient.bom) {
      const st = r.procurement!.authorityState;
      if (st === 'VERIFIED_ORDERABLE') {
        expect(r.nonOrderable, `${r.partNumber}`).not.toBe(true);
        expect(r.quantityState).not.toBe('pending');
      } else {
        expect(r.nonOrderable, `${r.partNumber} (${st})`).toBe(true);
      }
      if (st === 'QUANTITY_PENDING') expect(r.quantityState).toBe('pending');
    }
  });

  it('every row carries the full §2 field list with real values', () => {
    for (const r of insufficient.bom) {
      const p = r.procurement!;
      expect(p.bomLineId).toBe(r.bomLineId);
      expect(p.itemIdentity.length).toBeGreaterThan(0);
      expect(p.quantityUnit).toBe(r.unit);
      expect(typeof p.orderable).toBe('boolean');
      expect(p.exportable).toBe(p.orderable);
      expect(p.quantitySource.length).toBeGreaterThan(0);
      expect(p.authoritySource.length).toBeGreaterThan(10);
      expect(p.verificationStatus.length).toBeGreaterThan(0);
      expect(Array.isArray(p.blockingRequirementCodes)).toBe(true);
      expect(Array.isArray(p.affectedRouteIds)).toBe(true);
      expect(Array.isArray(p.affectedEquipmentIds)).toBe(true);
      expect(p.resolutionAction.length).toBeGreaterThan(0);
      expect(p.snapshotId).toBe(insufficient.snap.meta.snapshotId);
      expect(p.snapshotDigest).toBe(insufficient.snap.meta.digest);
    }
  });

  it('per-category rules: the module row is blocked by an OPEN procurement requirement, the micro is not', () => {
    const module = fixture.bom.find(r => r.category === 'solar_panel')!;
    const micro = fixture.bom.find(r => r.category === 'microinverter')!;
    // identity + count are canonical for BOTH …
    expect(module.procurement!.quantitySource).toBe('count-derived');
    expect(micro.procurement!.quantitySource).toBe('count-derived');
    // … but MODULE-EXACT-DATASHEET-PENDING is OPEN and severityPolicy declares
    // it procurement-impacting, so the module row is honestly NOT orderable.
    expect(module.procurement!.blockingRequirementCodes).toContain('MODULE-EXACT-DATASHEET-PENDING');
    expect(module.procurement!.authorityState).toBe('CANDIDATE_NON_ORDERABLE');
    expect(micro.procurement!.blockingRequirementCodes).toEqual([]);
    expect(micro.procurement!.authorityState).toBe('VERIFIED_ORDERABLE');
  });

  it('EQUIPMENT-IDENTITY-CONFLICT (operator-only, live) blocks the module AND the micro row', () => {
    const ctx = {
      ...buildProcurementClassificationContextFromSnapshot(fixture.snap),
      openProcurementRequirementCodes: ['EQUIPMENT-IDENTITY-CONFLICT'],
      openRequirementCodes: ['EQUIPMENT-IDENTITY-CONFLICT'],
      resolutionByCode: { 'EQUIPMENT-IDENTITY-CONFLICT': 'Operator must reconcile the equipment record.' },
    };
    for (const cat of ['solar_panel', 'microinverter']) {
      const row = { ...fixture.bom.find(r => r.category === cat)!, nonOrderable: undefined };
      const rec = classifyProcurementAuthority(row, ctx);
      expect(rec.blockingRequirementCodes, cat).toContain('EQUIPMENT-IDENTITY-CONFLICT');
      expect(rec.authorityState, cat).toBe('CANDIDATE_NON_ORDERABLE');
      expect(rec.orderable).toBe(false);
    }
  });

  it('a requirement whose declared impact EXCLUDES procurement can never block a row', () => {
    // FRAMING-AUTHORITY-UNVERIFIED / CODE-AUTHORITY-INCOMPLETE are OPEN on this
    // package and both declare procurement:false. (CONDUIT-FILL-PENDING was the
    // third anchor until AAC WS-7 made the NEC Ch.9 fill actually reach the
    // snapshot; it is now RESOLVED, so it can no longer witness this rule — the
    // two survivors do, and the assertion that it never blocks a row stands.)
    const openCodes = (fixture.snap.permitReadiness.registry ?? []).filter(b => !b.resolved).map(b => b.code);
    expect(openCodes).toContain('FRAMING-AUTHORITY-UNVERIFIED');
    expect(openCodes).toContain('CODE-AUTHORITY-INCOMPLETE');
    const all = fixture.bom.flatMap(r => r.procurement!.blockingRequirementCodes);
    expect(all).not.toContain('CONDUIT-FILL-PENDING');
    expect(all).not.toContain('FRAMING-AUTHORITY-UNVERIFIED');
    expect(all).not.toContain('CODE-AUTHORITY-INCOMPLETE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W1-C — ONE COUNTER, ONE SCOPE (§1 + §10)
// ═══════════════════════════════════════════════════════════════════════════
describe('W1-C — one counter over one population', () => {
  it('the row-ID multiset reconciles: rendered == approval == export (gate 1)', () => {
    const a = buildProcurementApproval(insufficient.bom);
    const rendered = [...insufficient.html.matchAll(/data-bom-line-id="([^"]+)"/g)].map(m => m[1]);
    const renderedSet = new Set(rendered.filter(Boolean));
    expect(renderedSet.size, 'every population row must render its id somewhere').toBe(a.totalRowCount);
    expect([...renderedSet].sort()).toEqual([...new Set(a.allRowIds)].sort());
    const exportIds = orderableProcurementExport(insufficient.bom).map(r => r.bomLineId!);
    expect(exportIds.sort()).toEqual(a.orderableRowIds.slice().sort());
    for (const id of exportIds) expect(renderedSet.has(id)).toBe(true);
  });

  it('no row disappears: excluded rows are RENDERED but never exported (gates 5 + 19)', () => {
    const excluded = nonOrderableProcurementExport(insufficient.bom);
    expect(excluded.length).toBeGreaterThan(0);
    const exportIds = new Set(orderableProcurementExport(insufficient.bom).map(r => r.bomLineId));
    for (const e of excluded) {
      expect(exportIds.has(e.bomLineId), `${e.partNumber} leaked into the export`).toBe(false);
      expect(insufficient.html, `${e.partNumber} vanished from the package`).toContain(e.bomLineId);
    }
  });

  it('every retired hardcoded / renderer-local count is gone from the rendered package', () => {
    for (const html of [fixture.html, insufficient.html]) {
      expect(html).not.toContain('items are required per NEC / manufacturer specification');
      expect(html).not.toContain('no manual estimates');
      expect(html).not.toMatch(/TOTAL LINE ITEMS \(THIS SCHEDULE/);
      expect(html).not.toMatch(/AUTHORITATIVE PROCUREMENT TOTAL &mdash; ORDERABLE ROWS ONLY: \d+ of \d+/);
    }
  });

  it('the SCHED population row states the FULL BOM total and names the rows scheduled elsewhere', () => {
    const a = buildProcurementApproval(insufficient.bom);
    expect(insufficient.html).toContain(`data-bom-population-total="${a.totalRowCount}"`);
    const shown = Number(insufficient.html.match(/data-bom-rows-shown-here="(\d+)"/)![1]);
    const above = Number(insufficient.html.match(/data-bom-rows-scheduled-above="(\d+)"/)![1]);
    expect(shown + above).toBe(a.totalRowCount);
    expect(above, 'the module row is the one scheduled elsewhere').toBe(1);
  });

  it('§10 — the summary counts are the approval object\'s, and PROCUREMENT READY is NO', () => {
    const a = buildProcurementApproval(insufficient.bom);
    expect(a.procurementReady).toBe(false);
    expect(insufficient.html).toContain('PROCUREMENT AUTHORITY SUMMARY');
    expect(insufficient.html).toContain('PROCUREMENT READY: NO.');
    expect(insufficient.html).toContain(`data-procurement-state-count="VERIFIED_ORDERABLE">${a.verifiedOrderableCount} `);
    expect(insufficient.html).toContain(`data-procurement-state-count="ESTIMATED_FIELD_VERIFY">${a.estimatedFieldVerifyCount} `);
    expect(insufficient.html).toContain(`data-procurement-state-count="CANDIDATE_NON_ORDERABLE">${a.candidateNonOrderableCount} `);
    // the open procurement-impact gates are named, and only those
    for (const c of a.openProcurementRequirementCodes) {
      expect(insufficient.html).toContain(`data-procurement-open-requirement="${c}"`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W1-D — ROUTE-DEPENDENT RECLASSIFICATION (§3, gates 6 + 7)
// ═══════════════════════════════════════════════════════════════════════════
describe('W1-D — route-derived rows are ESTIMATED, never orderable', () => {
  it('ROUTE-LENGTH-ESTIMATE is OPEN and every route-derived row is ESTIMATED_FIELD_VERIFY', () => {
    const open = (fixture.snap.permitReadiness.registry ?? []).filter(b => !b.resolved).map(b => b.code);
    expect(open, 'anti-vacuity: the dependency must actually be open').toContain('ROUTE-LENGTH-ESTIMATE');
    const routeRows = fixture.bom.filter(r => r.procurement!.quantitySource === 'route-derived');
    expect(routeRows.length, 'anti-vacuity: the design must carry route-derived rows').toBeGreaterThanOrEqual(20);
    for (const r of routeRows) {
      // the ONE exception is the open-air EGC, which its OWN grounding authority
      // had already ruled non-orderable for a different (stronger) reason.
      const st = r.procurement!.authorityState;
      expect(st, `${r.partNumber}`).not.toBe('VERIFIED_ORDERABLE');
      if (!String(r.partNumber).startsWith('GRN-OPENAIR')) {
        expect(st, `${r.partNumber}`).toBe('ESTIMATED_FIELD_VERIFY');
        expect(r.procurement!.blockingRequirementCodes).toContain('ROUTE-LENGTH-ESTIMATE');
        expect(r.procurement!.affectedRouteIds.length).toBeGreaterThan(0);
      }
    }
  });

  it('the six "rough-in allowance" sweeps are among them (the directive\'s own trigger phrase)', () => {
    const sweeps = fixture.bom.filter(r => /90° Sweep/i.test(r.model));
    expect(sweeps.length).toBeGreaterThanOrEqual(3);
    for (const s of sweeps) expect(s.procurement!.authorityState).toBe('ESTIMATED_FIELD_VERIFY');
  });

  it('estimated rows are VISIBLE, labeled FIELD VERIFY, and excluded from the export', () => {
    const est = fixture.bom.filter(r => r.procurement!.authorityState === 'ESTIMATED_FIELD_VERIFY');
    const exportIds = new Set(orderableProcurementExport(fixture.bom).map(r => r.bomLineId));
    for (const r of est) {
      expect(fixture.html).toContain(`data-bom-line-id="${r.bomLineId}"`);
      expect(exportIds.has(r.bomLineId)).toBe(false);
    }
    expect(fixture.html).toContain('EST — FIELD VERIFY');
    expect(fixture.html).toContain('data-bom-authority-state="ESTIMATED_FIELD_VERIFY"');
  });

  it('the four fabricated `?? 30` length defaults are gone from the engine source', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/bom-engine-v4.ts'), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/onewayLengthFt\s*\?\?\s*30/);
  });

  it('an ABSENT run length yields an honest QUANTITY_PENDING row — never 30 ft of invented conduit', () => {
    const row: PermitBOMItem = {
      category: 'conduit', manufacturer: 'Generic', model: '1" EMT', partNumber: 'EMT-1-RW9',
      quantity: 0, unit: 'ft', stageId: 'ac', quantitySource: 'unknown',
      bomLineId: 'BOM-CONDUIT-DEADBEEF',
    };
    const rec = classifyProcurementAuthority(row, EMPTY_PROCUREMENT_CONTEXT);
    expect(rec.authorityState).toBe('QUANTITY_PENDING');
    expect(rec.orderable).toBe(false);
    expect(rec.authoritySource).toContain('UNKNOWN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W1-E — Q-CONN + the CableExtensionSolution promotion contract (§4, gates 8+9)
// ═══════════════════════════════════════════════════════════════════════════
describe('W1-E — Q-Cable field-splice connectors', () => {
  const qconn = (g: Generated) => g.bom.filter(r => /^Q-CONN-/.test(String(r.partNumber)));

  it('both are CANDIDATE_NON_ORDERABLE with no verified selected solution', () => {
    for (const g of [fixture, insufficient]) {
      const rows = qconn(g);
      expect(rows.length, 'anti-vacuity: both connector rows must exist').toBe(2);
      for (const r of rows) {
        expect(r.procurement!.authorityState).toBe('CANDIDATE_NON_ORDERABLE');
        expect(r.procurement!.authoritySource).toContain('PROMOTION CONTRACT');
      }
    }
  });

  it('in the insufficiency mode they carry the QCABLE-PROCUREMENT-INSUFFICIENT code', () => {
    for (const r of qconn(insufficient)) {
      expect(r.procurement!.blockingRequirementCodes).toContain('QCABLE-PROCUREMENT-INSUFFICIENT');
    }
  });

  it('they never enter the export and never claim to resolve the deficit (gate 9)', () => {
    const exportIds = new Set(orderableProcurementExport(insufficient.bom).map(r => r.bomLineId));
    for (const r of qconn(insufficient)) expect(exportIds.has(r.bomLineId)).toBe(false);
    // the installation-intent prose is gone from the rendered derivation
    expect(insufficient.html).not.toContain('rows use continuous cable + service loop (cheapest)');
  });

  it('the PROMOTION CONTRACT: only a SELECTED + VERIFIED solution naming the row promotes it', () => {
    const male = qconn(fixture)[0];
    const id = male.bomLineId!;
    const full: CableExtensionSolution = {
      solutionId: 'SYN-EXT-1', kind: 'field-wireable-connector', selectedSku: 'Q-CONN-10M',
      quantity: 1, addedLengthFt: 20, locations: ['br-1'], compatibilityVerified: true,
      compatibleSystemNote: 'Enphase IQ8A / Q Cable',
      manufacturerDocument: {
        documentId: 'SYN-DOC-1', documentClass: 'installation-manual', documentIdentity: 'SYN',
        verificationState: 'verified', status: 'current', archivedInRepo: true,
        sha256: 'a'.repeat(64), coversExtensionSku: 'Q-CONN-10M', compatibleSystem: 'Enphase IQ8A',
        revisionOrDate: '2026-01',
      },
      representedInDrawings: true, representedInSchedules: true, representedInBom: true,
      vdInstallationRecalculated: true, note: null,
      provenance: { source: 'ecd-ws1-test-synthetic-solution' },
      selected: true, manufacturer: 'Enphase', cableSegmentIds: ['br-1'],
      applicability: 'test', verificationState: 'verified', bomLineIds: [id],
    };
    expect(evaluateCableExtensionPromotion(id, [full]).promoted).toBe(true);

    // …and each individually-missing condition refuses
    const refuse = (patch: Partial<CableExtensionSolution>, why: string) => {
      const p = evaluateCableExtensionPromotion(id, [{ ...full, ...patch }]);
      expect(p.promoted, why).toBe(false);
      expect(p.missing.length).toBeGreaterThan(0);
    };
    refuse({ selected: false }, 'a candidate is not a selection');
    refuse({ verificationState: 'candidate' }, 'unverified solution');
    refuse({ selectedSku: null }, 'no exact SKU');
    refuse({ compatibilityVerified: false }, 'compatibility unverified');
    refuse({ manufacturerDocument: null }, 'no manufacturer document');
    refuse({ representedInBom: false }, 'not represented in the BOM');
    refuse({ bomLineIds: ['BOM-SOMETHING-ELSE'] }, 'names a different BOM line');
    expect(evaluateCableExtensionPromotion(id, []).promoted).toBe(false);
  });

  it('END-TO-END: a verified selected solution threaded through the public API promotes the row', () => {
    const probeId = bomLineIdFor({ stageId: 'ac', category: 'connector', partNumber: 'Q-CONN-10M', unit: 'ea' });
    const sol: CableExtensionSolution = {
      solutionId: 'SYN-EXT-E2E', kind: 'field-wireable-connector', selectedSku: 'Q-CONN-10M',
      quantity: 1, addedLengthFt: 40, locations: ['br-1'], compatibilityVerified: true,
      compatibleSystemNote: 'Enphase IQ8A / Q Cable',
      manufacturerDocument: {
        documentId: 'SYN-DOC-E2E', documentClass: 'installation-manual', documentIdentity: 'SYN',
        verificationState: 'verified', status: 'current', archivedInRepo: true,
        sha256: 'b'.repeat(64), coversExtensionSku: 'Q-CONN-10M', compatibleSystem: 'Enphase IQ8A',
        revisionOrDate: '2026-01',
      },
      representedInDrawings: true, representedInSchedules: true, representedInBom: true,
      vdInstallationRecalculated: true, note: null,
      provenance: { source: 'ecd-ws1-test-synthetic-solution' },
      selected: true, manufacturer: 'Enphase', cableSegmentIds: ['br-1'],
      applicability: 'test', verificationState: 'verified', bomLineIds: [probeId],
    };
    const g = generate({ solutions: [sol] });
    const male = g.bom.find(r => r.partNumber === 'Q-CONN-10M')!;
    expect(male.bomLineId).toBe(probeId);
    expect(male.procurement!.authorityState).toBe('VERIFIED_ORDERABLE');
    expect(male.procurement!.authoritySource).toContain('SYN-EXT-E2E');
    // the FEMALE row is NOT named by the solution ⇒ it stays a candidate
    const female = g.bom.find(r => r.partNumber === 'Q-CONN-10F')!;
    expect(female.procurement!.authorityState).toBe('CANDIDATE_NON_ORDERABLE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W1-F — SupplySideTapConnectionAuthority (§5, gate 10)
// ═══════════════════════════════════════════════════════════════════════════
describe('W1-F — the Polaris tap connector', () => {
  const tapRow = (g: Generated) => g.bom.find(r => String(r.partNumber).toUpperCase() === 'IPLD350-3')!;

  it('the authority record exists with HONEST NULLS — nothing is inferred', () => {
    const a = fixture.snap.electrical.supplySideTapConnection!;
    expect(a, 'anti-vacuity: this is a supply-side design').toBeTruthy();
    expect(a.existingServiceConductorSize).toBeNull();
    expect(a.existingServiceConductorMaterial).toBeNull();
    expect(a.existingServiceConductorInsulation).toBeNull();
    expect(a.existingServiceConductorCount).toBeNull();
    expect(a.lugRangeCompatibility, 'must NEVER default to true').toBeNull();
    expect(a.enclosureCompatibility).toBeNull();
    expect(a.manufacturerDocumentId).toBeNull();
    expect(a.verificationStatus).toBe('unverified');
    expect(a.unresolvedFacts.length).toBeGreaterThanOrEqual(5);
    // the product facts that ARE known are recorded
    expect(a.connectorSku).toBe('IPLD350-3');
    expect(a.listedConductorRange).toBeTruthy();
  });

  it('the row is CANDIDATE_NON_ORDERABLE and carries the mandated label', () => {
    const row = tapRow(fixture);
    expect(row.procurement!.authorityState).toBe('CANDIDATE_NON_ORDERABLE');
    expect(row.model).toContain(SUPPLY_SIDE_TAP_CANDIDATE_LABEL);
    expect(fixture.html).toContain(SUPPLY_SIDE_TAP_CANDIDATE_LABEL);
  });

  it('it stays on the design-review schedule but never in an export', () => {
    const row = tapRow(fixture);
    expect(fixture.html).toContain(`data-bom-line-id="${row.bomLineId}"`);
    expect(orderableProcurementExport(fixture.bom).map(r => r.partNumber)).not.toContain('IPLD350-3');
  });

  it('BOTH hardcoded "Verify lug range" literals are gone from lib/', () => {
    // comment-stripped: a comment DOCUMENTING the retired literal is not a live
    // emitted claim (the same convention the rendered-truth harness uses).
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/bom-engine-v4.ts'), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toContain('Verify lug range against actual service conductor size');
    expect(fixture.html).not.toContain('Verify lug range against actual service conductor size');
    expect(insufficient.html).not.toContain('Verify lug range against actual service conductor size');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-cutting invariants
// ═══════════════════════════════════════════════════════════════════════════
describe('ECD WS-1 cross-cutting', () => {
  it('the state distribution is non-vacuous in BOTH modes (every claim has a witness)', () => {
    const f = countProcurementStates(fixture.bom);
    const i = countProcurementStates(insufficient.bom);
    for (const c of [f, i]) {
      expect(c.VERIFIED_ORDERABLE).toBeGreaterThan(0);
      expect(c.ESTIMATED_FIELD_VERIFY).toBeGreaterThan(0);
      expect(c.CANDIDATE_NON_ORDERABLE).toBeGreaterThan(0);
      expect(c.QUANTITY_PENDING).toBeGreaterThan(0);
    }
    // AAC WS-5 (2026-07-27): the base fixture ALSO carries a Q-Cable deficit now
    // — branch B2's ordered drops cannot span its 24.4 ft sub-array bridge, which
    // the old AGGREGATE-only sufficiency check hid behind the other two branches.
    // So the synthetic allowance no longer MOVES a row between the two modes; it
    // only enlarges the same deficit. The invariant that still holds (and is the
    // point of this case) is that the trunk-cable row is non-orderable in the
    // insufficiency mode and the two distributions stay consistent.
    expect(i.VERIFIED_ORDERABLE).toBe(f.VERIFIED_ORDERABLE);
    expect(i.CANDIDATE_NON_ORDERABLE).toBe(f.CANDIDATE_NON_ORDERABLE);
    const trunkI = insufficient.bom.find(r => r.category === 'trunk_cable');
    expect(trunkI?.procurement?.orderable, 'trunk row must be non-orderable in the insufficiency mode').toBe(false);
  });

  it('procurementAuthorityOf never returns VERIFIED_ORDERABLE for an unclassified row', () => {
    const naked: PermitBOMItem = {
      category: 'fuse', manufacturer: 'M', model: 'F', partNumber: 'F-9',
      quantity: 1, unit: 'ea', stageId: 'ac',
    };
    expect(procurementAuthorityOf(naked).authorityState).not.toBe('VERIFIED_ORDERABLE');
  });
});
