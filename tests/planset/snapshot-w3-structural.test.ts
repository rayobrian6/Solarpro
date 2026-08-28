import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import { contentRevision } from '@/lib/permit/snapshot/digest';
import { buildRackingAssembly } from '@/lib/permit/snapshot/rackingAssembly';
import { runSnapshotStructuralEngine, isFramingVerified } from '@/lib/permit/snapshot/structuralEngine';
import {
  buildFramingObservation, resolveFramingCapacityAuthority,
  type FramingCapacityDocumentEvidence,
} from '@/lib/permit/snapshot/framingAuthority';
import { pickVerifiedDocument, toFramingClearanceEvidence } from '@/lib/documents/registry';
import type { RegistryDocument } from '@/lib/documents/types';
import { deriveStructuralBom, reconcileStructuralBom } from '@/lib/permit/snapshot/structuralBom';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Build the real Braidon-like snapshot by running the full permit engine and
 *  reading the stashed authority object (generatePermit sets input._snapshot). */
function realSnapshot(mutate?: (p: any) => void): PermitDesignSnapshot {
  const input = clone(roofProject) as any;
  if (mutate) mutate(input);
  generatePermitHTML(input);
  return input._snapshot as PermitDesignSnapshot;
}

describe('W3 structural authority — canonical objects on the real snapshot', () => {
  const snap = realSnapshot();
  const gi = snap.geometry.moduleInstances;
  const rec = snap.equipment.modules[0];

  it('module-count invariant: one canonical instance per module', () => {
    expect(gi.length).toBe(snap.geometry.modules.length);
    expect(gi.length).toBe(snap.derived.moduleCount);
    expect(gi.length).toBeGreaterThan(0);
  });

  it('exact-dims invariant: every footprint uses the versioned record dims (no generic 66×40)', () => {
    expect(rec.spec.widthIn).toBeTruthy();
    expect(rec.spec.lengthIn).toBeTruthy();
    for (const m of gi) {
      expect(m.widthIn).toBe(rec.spec.widthIn);
      expect(m.heightIn).toBe(rec.spec.lengthIn);
      expect(m.equipmentRevision).toBeTruthy();
    }
  });

  it('array area = Σ canonical module polygon areas (exact catalog footprint)', () => {
    const per = (rec.spec.widthIn! * rec.spec.lengthIn!) / 144;
    const sum = gi.reduce((s, m) => s + m.areaFt2, 0);
    expect(sum).toBeCloseTo(gi.length * per, 1); // per-instance areas are rounded to 3 dp

    for (const m of gi) expect(m.areaFt2).toBeCloseTo(per, 3);
  });

  it('rail ↔ attachment reconciliation math holds', () => {
    const st = snap.structural;
    expect(st.rails.length).toBeGreaterThan(0);
    expect(st.attachments.length).toBeGreaterThan(0);
    const railIds = new Set(st.rails.map(r => r.railId));
    for (const a of st.attachments) expect(railIds.has(a.railId)).toBe(true);
    // Σ rail attachment refs = attachment objects
    const refSum = st.rails.reduce((s, r) => s + r.attachmentIds.length, 0);
    expect(refSum).toBe(st.attachments.length);
    // every module supported by a rail
    const supported = new Set(st.rails.flatMap(r => r.supportedModuleIds));
    for (const m of snap.geometry.modules) expect(supported.has(m.moduleId)).toBe(true);
    // scheduled rail length mirror = Σ physical rail lengths
    const railFt = st.rails.reduce((s, r) => s + r.physicalLengthIn, 0) / 12;
    expect(st.railTotalFt).toBeCloseTo(Math.round(railFt * 100) / 100, 2);
    expect(st.railCount).toBe(st.rails.length);
    expect(st.spliceCount).toBe(st.rails.reduce((s, r) => s + r.spliceCount, 0));
  });

  it('environmental authority is single-sourced (no 115-vs-90 split)', () => {
    expect(snap.structural.env.ultimateWindSpeedMph).toBe(snap.structural.loads.windSpeedMph);
  });

  it('framing-authority-unverified blocker fires (no verified capacity authority)', () => {
    const codes = snap.permitReadiness.blockers.map(b => b.code);
    expect(codes).toContain('FRAMING-AUTHORITY-UNVERIFIED');   // canonical (framing-authority gate)
    expect(codes).not.toContain('STRUCTURAL-FRAMING-UNVERIFIED'); // legacy code retired from emission
    expect(snap.structural.engine.engineeringReviewRequired).toBe(true);
    expect(snap.structural.framingCapacityAuthority).toBeNull();
    const framing = snap.structural.checks.find(c => c.limitState === 'framing-capacity');
    expect(framing?.passes).toBeNull(); // never a fabricated pass
  });

  it('carry-forward electrical blockers remain', () => {
    const codes = snap.permitReadiness.blockers.map(b => b.code);
    expect(codes).toContain('ROUTE-LENGTH-ESTIMATE');
    expect(snap.permitReadiness.ready).toBe(false);
  });

  it('the real snapshot is internally consistent (no blocking invariant violations)', () => {
    expect(blockingViolations(validatePermitDesignSnapshot(snap))).toEqual([]);
  });
});

describe('W3 §10 — structural BOM derived from canonical objects', () => {
  const snap = realSnapshot();
  const st = snap.structural;

  it('every structural BOM row is quantity-traceable (source object IDs or aggregation)', () => {
    expect(st.bom.length).toBeGreaterThan(0);
    for (const r of st.bom) {
      const hasSource = (r.sourceObjectIds !== undefined) || (r.aggregation !== undefined);
      expect(hasSource, `row ${r.key} must carry source IDs or an aggregation ref`).toBe(true);
      expect(r.derivedFrom).toBeTruthy();
    }
  });

  it('rail/mount/splice/clamp/bonding rows equal the object quantities', () => {
    const q = (k: string) => st.bom.find(r => r.key === k)?.qty ?? -1;
    // mounts = attachment objects
    expect(q('mounts')).toBe(st.attachments.length);
    // splices = Σ rail.spliceCount
    expect(q('railSplices')).toBe(st.rails.reduce((s, r) => s + r.spliceCount, 0));
    // rails = Σ ceil(len ÷ stock)
    const railGeom = st.rails.reduce((s, r) => s + Math.ceil(r.physicalLengthIn / (r.stockLengthIn || r.physicalLengthIn)), 0);
    expect(q('rails')).toBe(railGeom);
    // mid clamps = Σ (modules_on_rail − 1) — actual module adjacency
    expect(q('midClamps')).toBe(st.rails.reduce((s, r) => s + Math.max(0, r.supportedModuleIds.length - 1), 0));
    // end clamps = 2 × rails
    expect(q('endClamps')).toBe(2 * st.rails.length);
    // bonding = one per module instance
    expect(q('bondingClips')).toBe(snap.geometry.moduleInstances.length);
    // lag bolts = Σ attachment.fastenerCount
    expect(q('lagBolts')).toBe(st.attachments.reduce((s, a) => s + (a.fastenerCount ?? 0), 0));
  });

  it('reconciliation passes and cross-checks the V4 producer (single-system scope)', () => {
    expect(st.bomReconciliation.ok).toBe(true);
    expect(st.bomReconciliation.basis).toBe('object-vs-engine'); // roofProject is single-system → scope matches
    // includes the V4 producer cross-checks, all ok
    const v4Checks = st.bomReconciliation.checks.filter(c => /v4-calcRackingBOM/.test(c.name));
    expect(v4Checks.length).toBeGreaterThan(0);
    for (const c of v4Checks) expect(c.ok, `${c.name} exp ${c.expected} act ${c.actual}`).toBe(true);
  });

  it('a fabricated BOM quantity FAILS reconciliation (V10 would block)', () => {
    const objects = {
      rails: st.rails, attachments: st.attachments,
      moduleInstances: snap.geometry.moduleInstances, rackingAssembly: st.rackingAssembly,
    };
    const rows = deriveStructuralBom(objects);
    // tamper with one row (a renderer guess)
    const tampered = rows.map(r => r.key === 'mounts' ? { ...r, qty: r.qty + 7 } : r);
    const recon = reconcileStructuralBom(tampered, objects);
    expect(recon.ok).toBe(false);
    expect(recon.checks.some(c => c.name === 'mounts-vs-attachment-objects' && !c.ok)).toBe(true);
  });
});

describe('W3 — RT-MINI capacity sourcing (600 allowable is authority)', () => {
  it('RT-MINI cites the 600 lb ASD allowable and records the 900-ultimate discrepancy', () => {
    const a = buildRackingAssembly(getMountingSystemById('rooftech-mini'))!;
// 2026-08-28 RT-MINI MIGRATION - 613.2 is the PE letter's own allowable for
    // the governing rafter assembly; 600 was that number rounded down and
    // attributed to no document.
    expect(a.publishedCapacityAllowableLbs).toBe(613.2);
    expect(a.capacityBasis).toBe('allowable');
    expect(a.capacitySource).toBeTruthy();
    expect(a.notes.join(' ')).toMatch(/613\.2 lb ASD ALLOWABLE/);
    expect(a.notes.join(' ')).toMatch(/NOT structural authority/);
    // RT-MINI has no own rail spec → compatible rail (documented) → supported.
    expect(a.mixedManufacturer).toBe(true);
    expect(a.assemblySupported).toBe(true);
    expect(a.recordRevision).toBeTruthy();
  });

  it('IronRidge XR100 is a same-manufacturer railed assembly at its 500 lb allowable', () => {
    const a = buildRackingAssembly(getMountingSystemById('ironridge-xr100'))!;
    expect(a.capacityBasis).toBe('allowable');
    expect(a.publishedCapacityAllowableLbs).toBe(500);
    expect(a.mixedManufacturer).toBe(false);
    expect(a.railModel).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FRAMING-AUTHORITY GATE (2026-07-23) — the seven §7 regression tests.
// Contract: framing is VERIFIED only by a FramingCapacityAuthority (verified +
// archived project-applicable document, or a digest-bound engineer review).
// Operator-entered field COMPLETENESS is OBSERVATION, never capacity authority.
// ═══════════════════════════════════════════════════════════════════════════
describe('FRAMING-AUTHORITY GATE — observation vs capacity authority', () => {
  const baseResult: any = {
    mountLayout: { safetyFactor: 1.49, mountCapacityLbs: 500, upliftPerMountLbs: 336,
      downwardPerMountLbs: 0, mountsPerRail: 4, mountSpacingIn: 48, tributaryAreaPerMountFt2: 5.3 },
    railAnalysis: undefined,
    rafterAnalysis: { bendingMomentDemandFtLbs: 200, bendingMomentCapacityFtLbs: 520,
      overallUtilization: 0.38, totalLoadPsf: 18, framingType: 'truss', size: '2x6',
      spacingIn: 24, species: 'Douglas Fir-Larch' },
    arrayGeometry: { railSpacingIn: 40.9 },
    snow: { roofSnowLoadPsf: 0 }, wind: { roofZone: 'zone1', netUpliftPressurePsf: 20, netDownwardPressurePsf: 15 },
    addedDeadLoadPsf: 3.2,
  };
  const baseInput: any = { panelCount: 12, panelWeightLbs: 49, rackingWeightPerPanelLbs: 4,
    framingType: 'truss', rafterSize: '2x6' };
  // The live Braidon operator-complete framing (truss / 2x6 / 24" / DF-L / 12 ft).
  const OPERATOR_COMPLETE = { framingType: 'truss', rafterSize: '2x6', rafterSpacing: 24,
    rafterSpecies: 'Douglas Fir-Larch', rafterSpan: 12 };
  const DIGEST = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  // a clearly-SYNTHETIC verified+archived truss document (never committed as real evidence)
  const trussDocEvidence = (over: Partial<FramingCapacityDocumentEvidence> = {}): FramingCapacityDocumentEvidence => ({
    documentId: 'TEST-DOC-truss-0001', documentClass: 'truss_design_drawing',
    documentIdentity: '[TEST] Truss design drawing — synthetic',
    sha256: 'a'.repeat(64), verificationState: 'verified', status: 'current', archivedInRepo: true,
    issuer: 'Acme Truss Co. (TEST)', revisionOrDate: 'Rev A 2026-01-01',
    projectApplicability: 'project 4030b664', memberOrTrussIdentity: 'T1 common truss',
    designLoads: '20 psf LL + 15 psf DL', allowableCapacities: 'per sealed drawing',
    bearingConditions: '2 bearing walls', deflectionLimits: 'L/240', engineerOrManufacturerVerification: 'sealed',
    hasFramingCapacityClaim: true, ...over,
  });

  // ── §7.1 — operator-complete fields DON'T clear. ──────────────────────────
  it('§7.1 operator-complete framing fields do NOT verify capacity (no authority ⇒ review required)', () => {
    expect(isFramingVerified(null)).toBe(false);
    const out = runSnapshotStructuralEngine(baseResult, baseInput, OPERATOR_COMPLETE, null);
    expect(out.framingVerified).toBe(false);
    expect(out.engine.engineeringReviewRequired).toBe(true);
    const framing = out.checks.find(c => c.limitState === 'framing-capacity')!;
    expect(framing.passes).toBeNull();
    expect(framing.demand).toBeNull();      // no numeric framing capacity while unverified
    const att = out.checks.find(c => c.limitState === 'attachment-uplift')!;
    expect(att.passes).toBe(true);          // attachment check verified regardless
    expect(out.engine.passes).toBeNull();   // added-PV-load calcs unaffected but no framing PASS
    expect(out.engine.moduleDeadLoadLbs).not.toBeNull();
  });

  // ── §7.2 — observation populates without a PASS. ──────────────────────────
  it('§7.2 operator data populates the observation record but asserts NO pass', () => {
    const obs = buildFramingObservation({ ...OPERATOR_COMPLETE, source: 'operator-entered' })!;
    expect(obs.framingType).toBe('truss');
    expect(obs.nominalMemberSizeIn).toBe('2x6');
    expect(obs.spacingIn).toBe(24);
    expect(obs.measuredSpanFt).toBe(12);
    expect(obs.geometryComplete).toBe(true);      // OBSERVATION completeness ONLY
    expect(obs.source).toBe('operator-entered');
    expect(obs.observer).toBeNull();              // honest null (bare DB row)
    expect(obs.observedAtIso).toBeNull();
    // completeness never constructs a capacity authority
    expect(resolveFramingCapacityAuthority({})).toBeNull();
  });

  // ── §7.3 — a generic BCSI table CANNOT be capacity authority. ─────────────
  it('§7.3 a generic BCSI table cannot construct a FramingCapacityAuthority', () => {
    // a BCSI screening default: not a framing-capacity document class, and no
    // framing capacity claim → resolver returns null.
    const bcsi = trussDocEvidence({ documentClass: 'bcsi_generic_table' as any, hasFramingCapacityClaim: false });
    expect(resolveFramingCapacityAuthority({ documentEvidence: bcsi, projectApplicabilityKey: '4030b664' })).toBeNull();
    // even a framing-class doc that only screens (no capacity claim) fails
    const screenOnly = trussDocEvidence({ hasFramingCapacityClaim: false });
    expect(resolveFramingCapacityAuthority({ documentEvidence: screenOnly, projectApplicabilityKey: '4030b664' })).toBeNull();
  });

  // ── §7.4 — an archived, applicable truss document CLEARS (through registry). ─
  it('§7.4 a verified+archived applicable truss document clears (resolved through lib/documents)', () => {
    // registry-shaped synthetic record → registry filter → clearance evidence → authority
    const doc: RegistryDocument = {
      id: 'TEST-DOC-truss-0001', documentClass: 'truss_design_drawing',
      manufacturerOrIssuer: 'Acme Truss Co. (TEST)', equipmentId: null,
      equipmentModelApplicability: 'project 4030b664', title: '[TEST] Truss design drawing',
      revision: 'Rev A', documentDate: '2026-01-01', archivedFileIdentity: 'test.pdf',
      archivedInRepo: true, sha256: 'a'.repeat(64), source: 'test', jurisdictionBoundary: null,
      applicabilityNotes: 'project 4030b664', status: 'current', supersedesId: null, supersededById: null,
      extractedClaims: { framing: { projectApplicability: 'project 4030b664', memberOrTrussIdentity: 'T1',
        allowableCapacities: 'per drawing', hasFramingCapacityClaim: true } },
      verificationState: 'verified', reviewer: 'test', verifiedBy: 'test', verifiedAt: '2026-01-02',
      verificationNotes: null, createdBy: 'test', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    };
    const picked = pickVerifiedDocument([doc], {
      documentClass: ['truss_design_drawing', 'manufacturer_structural_calc', 'stamped_structural_analysis'],
      equipmentModel: '4030b664', requireFramingCapacity: true, projectApplicabilityKey: '4030b664',
    });
    expect(picked?.id).toBe('TEST-DOC-truss-0001');
    const evidence = toFramingClearanceEvidence(picked)!;
    const auth = resolveFramingCapacityAuthority({ documentEvidence: evidence, projectApplicabilityKey: '4030b664' });
    expect(auth).not.toBeNull();
    expect(auth!.kind).toBe('archived-document');
    expect(auth!.verified).toBe(true);
    expect(isFramingVerified(auth)).toBe(true);
    const out = runSnapshotStructuralEngine(baseResult, baseInput, OPERATOR_COMPLETE, auth);
    expect(out.engine.engineeringReviewRequired).toBe(false);
    const chk = out.checks.find(c => c.limitState === 'framing-capacity')!;
    expect(chk.passes).toBe(true);
    expect(chk.dcRatio).toBeCloseTo(0.38, 2);
    expect(out.engine.passes).toBe(true);
  });

  // ── §7.5 — a digest-bound engineer review CLEARS. ─────────────────────────
  it('§7.5 a licensed-engineer review bound to the current digest clears', () => {
    const review = { reviewedSnapshotDigest: DIGEST, reviewerName: 'Jane Roe, PE',
      reviewerLicense: 'PE-12345', licenseState: 'IL', approvedAtIso: '2026-07-23T00:00:00Z' };
    // D45 — the caller must ASSERT that currentDigest was obtained independently
    // of the review record. Here it genuinely is: the test supplies DIGEST, and
    // separately constructs a review that happens to name it.
    const auth = resolveFramingCapacityAuthority({
      reviewEvidence: review, currentDigest: DIGEST, currentDigestIsIndependent: true,
    });
    expect(auth).not.toBeNull();
    expect(auth!.kind).toBe('engineer-review');
    expect(auth!.reviewedSnapshotDigest).toBe(DIGEST);
    expect(isFramingVerified(auth)).toBe(true);
    const out = runSnapshotStructuralEngine(baseResult, baseInput, OPERATOR_COMPLETE, auth);
    expect(out.engine.engineeringReviewRequired).toBe(false);
    expect(out.checks.find(c => c.limitState === 'framing-capacity')!.passes).toBe(true);
  });

  // ── §7.6 — a digest CHANGE invalidates a prior review. ────────────────────
  it('§7.6 a snapshot digest change invalidates the prior review (no longer covered)', () => {
    const review = { reviewedSnapshotDigest: DIGEST, reviewerName: 'Jane Roe, PE',
      reviewerLicense: 'PE-12345', licenseState: 'IL', approvedAtIso: '2026-07-23T00:00:00Z' };
    // review covers the OLD digest; the current digest changed → not covered → null
    const changed = 'ffffffff' + DIGEST.slice(8);
    // Independence IS asserted, so this test proves the DIGEST MISMATCH refuses —
    // not merely that the independence assertion was missing. Without the flag
    // the call would return null for the wrong reason and the test would be
    // vacuous for the behaviour it names.
    const auth = resolveFramingCapacityAuthority({
      reviewEvidence: review, currentDigest: changed, currentDigestIsIndependent: true,
    });
    expect(auth).toBeNull();
    const out = runSnapshotStructuralEngine(baseResult, baseInput, OPERATOR_COMPLETE, auth);
    expect(out.engine.engineeringReviewRequired).toBe(true);  // invalidated → review required again
  });

  // ── §7.5b (PHASE A / D45) — the tautology guard itself. ───────────────────
  // In production BOTH sides of the comparison came from coverage.reviewedDigest
  // (structuralResolvers.ts:938 and :944 → structuralAuthority.ts:214-215), so
  // `x === x` could not fail and an approval of a SUPERSEDED design cleared a
  // safety:true requirement. A caller that cannot show its digest is independent
  // must be refused even when the values match.
  it('§7.5b a matching digest does NOT clear when independence is not asserted (D45)', () => {
    const reviewedDigest = DIGEST;
    const review = { reviewedSnapshotDigest: reviewedDigest, reviewerName: 'Jane Roe, PE',
      reviewerLicense: 'PE-12345', licenseState: 'IL', approvedAtIso: '2026-07-23T00:00:00Z' };
    // Exactly the production shape: currentDigest copied off the same record.
    const auth = resolveFramingCapacityAuthority({ reviewEvidence: review, currentDigest: reviewedDigest });
    expect(auth).toBeNull();
    // …and it is the ASSERTION that is missing, not the match: flipping the flag
    // on the identical inputs clears. This pins the refusal to the right cause.
    const asserted = resolveFramingCapacityAuthority({
      reviewEvidence: review, currentDigest: reviewedDigest, currentDigestIsIndependent: true,
    });
    expect(asserted).not.toBeNull();
    expect(asserted!.kind).toBe('engineer-review');
  });

  // ── §7.7 — live-shaped and fixture-shaped inputs follow the SAME rule. ────
  it('§7.7 live-shaped (operator-complete) and fixture-shaped inputs both stay UNVERIFIED without authority', () => {
    // fixture-shaped: the real snapshot (framing defaulted)
    const fixtureSnap = realSnapshot();
    expect(fixtureSnap.structural.framingCapacityAuthority).toBeNull();
    expect(fixtureSnap.structural.engine.engineeringReviewRequired).toBe(true);
    // live-shaped: operator-complete framing fields, no document/review → SAME rule
    const liveSnap = realSnapshot(p => {
      p.project.framingType = 'truss'; p.project.rafterSize = '2x6'; p.project.rafterSpacing = 24;
      p.project.rafterSpecies = 'Douglas Fir-Larch'; p.project.rafterSpan = 12;
    });
    expect(liveSnap.structural.framingObservation?.geometryComplete).toBe(true); // observation complete
    expect(liveSnap.structural.framingCapacityAuthority).toBeNull();             // but NO capacity authority
    expect(liveSnap.structural.engine.engineeringReviewRequired).toBe(true);     // → still UNVERIFIED
    const codes = liveSnap.permitReadiness.blockers.map(b => b.code);
    expect(codes).toContain('FRAMING-AUTHORITY-UNVERIFIED');
    const framing = liveSnap.structural.checks.find(c => c.limitState === 'framing-capacity');
    expect(framing?.passes).toBeNull();
  });
});

describe('W3 — digest invalidation on equipment change', () => {
  it('contentRevision is deterministic and change-sensitive', () => {
    const a = { catalogId: 'x', w: 41.7, h: 70.9 };
    expect(contentRevision(a)).toBe(contentRevision({ ...a }));
    expect(contentRevision(a)).not.toBe(contentRevision({ ...a, w: 40.9 }));
  });

  it('changing the mounting system changes the snapshot digest (approval invalidation)', () => {
    const d1 = realSnapshot().meta.digest;
    const d2 = realSnapshot(p => { p.project.mountingSystemId = 'rooftech-mini'; }).meta.digest;
    expect(d1).toBeTruthy();
    expect(d2).not.toBe(d1);
  });

  it('changing the module IDENTITY changes module footprints and the digest', () => {
    const s1 = realSnapshot();
    // CMEI — the module is changed by changing its IDENTITY (the stable
    // catalogue id), not by rewriting the model text. `panelId` is authoritative
    // and manufacturer/model/watts are projections of it, so editing the text
    // alone must NOT move the design — asserted below.
    const s2 = realSnapshot(p => {
      for (const inv of p.system.inverters) for (const s of inv.strings) {
        (s as { panelId?: string }).panelId = 'qcells-peak-duo-400';
        s.panelModel = 'Q.PEAK DUO BLK ML-G10+ 400W';
      }
    });
    expect(s2.meta.digest).not.toBe(s1.meta.digest);
    // equipment revision on the instances tracks the record change
    if (s1.geometry.moduleInstances.length && s2.geometry.moduleInstances.length) {
      expect(s2.geometry.moduleInstances[0].equipmentRevision)
        .not.toBe(s1.geometry.moduleInstances[0].equipmentRevision);
    }
  });

  it('CMEI — rewriting the model TEXT while the panelId stands changes nothing', () => {
    // The converse of the test above, and the reason it had to change: a stable
    // id outranks conflicting model text, so a stale or re-typed model string
    // can no longer silently re-identify the module or move the digest.
    const pinned = (m: string) => realSnapshot(p => {
      for (const inv of p.system.inverters) for (const s of inv.strings) {
        (s as { panelId?: string }).panelId = 'qcells-peak-duo-400';
        s.panelModel = m;
      }
    });
    const a = pinned('Q.PEAK DUO BLK ML-G10+ 400W');
    const b = pinned('SOME STALE MODEL TEXT 999W');
    // The IDENTITY and everything projected from it are unchanged: same
    // catalogue row, same model, same wattage, same spec.
    expect(b.equipment.modules[0].catalogId).toBe(a.equipment.modules[0].catalogId);
    expect(b.equipment.modules[0].model).toBe(a.equipment.modules[0].model);
    expect(b.equipment.modules[0].spec.wattsStc).toBe(a.equipment.modules[0].spec.wattsStc);
    expect(b.equipment.modules[0].catalogId).toBe('qcells-peak-duo-400');
    // NOTE (honest residue): the PURE build does not run
    // `materialiseModuleIdentity` — that happens at the resolver boundary — so
    // the stale TEXT still reaches labels and therefore the digest. Identity is
    // authoritative; the posted text is not yet normalised on this path. See
    // docs/CANONICAL-MODULE-EQUIPMENT-IDENTITY.md §8.
    expect(b.meta.digest).not.toBe(a.meta.digest);
  });
});
