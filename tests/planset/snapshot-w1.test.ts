import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import { computeSnapshotDigest, snapshotIdFromDigest, canonicalJson, deepFreeze } from '@/lib/permit/snapshot/digest';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// Minimal valid snapshot for validator unit tests.
export function baseSnapshot(): PermitDesignSnapshot {
  const mods = Array.from({ length: 31 }, (_, i) => ({
    moduleId: `m${i}`, planeKey: i < 19 ? 'P1' : 'P2', moduleRecordId: 'mod-1',
    lat: null, lng: null, row: 0, col: i, orientation: null,
  }));
  const units = mods.map((m, i) => ({
    deviceId: `mi-${m.moduleId}`, moduleId: m.moduleId, inverterRecordId: 'inv-1',
    branchId: i < 11 ? 'br-1' : i < 21 ? 'br-2' : 'br-3',
  }));
  const _codeEd = (kind: 'nec'|'ibc'|'irc'|'ifc'|'asce', edition: string) =>
    ({ kind, edition, standard: kind.toUpperCase(), source: 'ahj-record' as const,
       provenance: { source: 'test' } });
  return {
    // W4 §1 — a VERIFIED code-authority record (test-only) so V11 passes with no
    // CODE-AUTHORITY-INCOMPLETE blocker required.
    codeAuthority: {
      schemaVersion: '1.0.0', ahjName: 'Test AHJ', jurisdictionType: 'county',
      stateCode: 'IL', stateName: 'Illinois', county: 'Test', city: 'Test',
      ahjRecordId: 'il-test', utility: { name: null, id: null },
      editions: {
        nec: _codeEd('nec', '2023'), ibc: _codeEd('ibc', '2021'), irc: _codeEd('irc', '2021'),
        ifc: _codeEd('ifc', '2024'), asce: _codeEd('asce', '7-22'),
      },
      localAmendments: [], effectiveDate: null, expirationDate: null,
      sourceDocument: 'Test adoption ordinance', officialSource: null, sourceRevision: null,
      sourceDate: null, sourceHash: 'sha256:test', verificationStatus: 'verified',
      verifiedBy: 'test-operator', verifiedAtIso: '2026-07-20', recordProvenance: 'curated',
      applicabilityNotes: [], incompleteEditions: [], capturedAtIso: '2026-07-20',
      provenance: { source: 'test' },
    },
    // W4 §3/§12 — minimal canonical project/cover authority (test fixture).
    projectAuthority: {
      schemaVersion: '1.0.0',
      projectName: 'Test PV System', customer: 'Test Client',
      installationAddress: '123 Test St', city: 'Test', stateCode: 'IL', zip: '60000',
      parcelApn: 'APN-TEST', ahjName: 'Test AHJ', utilityName: 'Test Utility',
      systemType: 'ROOF MOUNT',
      capacities: { dcKw: 12.4, acKw: 10.82, moduleCount: 31 },
      equipmentSummary: {
        moduleManufacturer: 'Q CELLS', moduleModel: 'Q.PEAK DUO BLK ML-G10+ 400W', moduleWatts: 400,
        inverterManufacturer: 'Enphase', inverterModel: 'IQ8A', inverterType: 'MICROINVERTER',
        mountManufacturer: null, mountModel: null,
        batteryBrand: null, batteryModel: null, batteryCount: null, combinerLabel: null,
      },
      designer: 'Test Designer', contractor: null, issueDate: '2026-07-20',
      // Clean fixture: fully-verified legal authority ⇒ no PROJECT-AUTHORITY-
      // UNVERIFIED blocker required (keeps this snapshot at zero violations).
      authorityVerification: {
        address: 'verified', apn: 'verified', municipalBoundary: 'verified',
        ahjName: 'verified', fireAuthority: 'verified',
      },
      authorityAnyUnverified: false,
      engineerReviewStatus: 'PENDING — no approved engineering-review record',
      issueState: 'PENDING ELECTRICAL REVIEW',
      issueStateBasis: {
        authorityGapDomains: ['electrical'], reviewCoversCurrentDigest: false, reviewStale: false,
        reviewedDigest: null, reason: 'only electrical authority gaps remain',
      },
      issuedForPermitGate: { pass: false, preconditions: [] },
      revisionHistory: [{ rev: 'A', description: 'PENDING ELECTRICAL REVIEW', date: '2026-07-20', by: 'Test Designer' }],
      sheetIndex: [{ id: 'PV-0', title: 'COVER SHEET' }, { id: 'PV-1', title: 'SITE & ROOF PLAN' }],
      governingCodesRef: { source: 'snapshot.codeAuthority', schemaVersion: '1.0.0', verificationStatus: 'verified', ahjName: 'Test AHJ' },
      generalNotes: [], fieldProvenance: {}, capturedAtIso: '2026-07-20',
      provenance: { source: 'test' },
    },
    meta: { snapshotId: '', digest: '', schemaVersion: '1.0.0', engineVersion: 'test',
            generatedAtIso: '2026-07-20', projectId: null, designVersionId: null },
    sourceInputs: { clientElectrical: null, clientBackfeedBreakerA: null, clientWireGauge: null,
                    clientTotals: { totalPanels: null, totalDcKw: null, totalAcKw: null } },
    project: {
      clientName: null, address: null, parcelApn: null, lat: null, lng: null,
      utility: { name: null, id: null },
      ahj: { name: null, adoptedCodes: { nec: '2023', ibc: '2021', irc: '2021', ifc: '2024', asce: '7-22' },
             codesSource: 'ahj-record', localAmendments: [], recordCapturedAtIso: '' },
      interconnection: { method: 'LOAD_SIDE', rule: '705.12(B)' },
      thermal: { designTempMinC: -23, designTempHighC: 33, rooftopAdderC: 33,
                 source: 'ashrae-envelope', provenance: { source: 'designTemps.ts' } },
      provenance: { source: 'test' },
    },
    equipment: {
      modules: [{ recordId: 'mod-1', catalogId: 'qcells-peak-duo-400', manufacturer: 'Q CELLS',
        model: 'Q.PEAK DUO BLK ML-G10+ 400W', sku: null,
        datasheet: { revision: null, sourceUrl: null, capturedAtIso: null, assetId: null },
        verified: true, spec: { wattsStc: 400, voc: 41.6, isc: 12.26, vmp: null, imp: null,
          tempCoeffVocPctC: -0.27, lengthIn: 70.9, widthIn: 41.7, thicknessIn: 1.57, weightLbs: 48, ulListing: null },
        provenance: { source: 'equipment-db' } }],
      microInverters: [{ recordId: 'inv-1', catalogId: 'enphase-iq8a', manufacturer: 'Enphase',
        model: 'IQ8A', sku: null,
        datasheet: { revision: null, sourceUrl: null, capturedAtIso: null, assetId: null },
        verified: true, spec: { continuousOutputA: 1.454, continuousVa: 349,
          maxUnitsPerBranch: 11, maxBranchOcpdA: 20, nominalV: 240, ulListing: null },
        provenance: { source: 'equipment-db' } }],
      stringInverters: [], mount: null, rail: null, combinerLabel: null,
    },
    geometry: {
      roofPlanes: [{ planeId: 'P1', pitchDeg: 17, azimuthDeg: 180, moduleCount: 19 },
                   { planeId: 'P2', pitchDeg: 17, azimuthDeg: 90, moduleCount: 12 }],
      modules: mods, moduleInstances: [], roofPlaneObjects: [],
      coordinateSystem: { id: 'CS-SITE-PLAN-FT', units: 'ft', description: 'test' },
      drawingTransforms: [],
      provenance: { source: 'test' }, gaps: [],
    },
    electrical: {
      topology: 'MICRO', engineOfRecord: 'computeSystem',
      microInverterUnits: units,
      branches: [
        { branchId: 'br-1', label: 'B1', deviceIds: units.slice(0, 11).map(u => u.deviceId),
          moduleCount: 11, currentA: 16.0, continuousA: 20.0, ocpdA: 20, conductorId: 'c-1', egcConductorId: null },
        { branchId: 'br-2', label: 'B2', deviceIds: units.slice(11, 21).map(u => u.deviceId),
          moduleCount: 10, currentA: 14.5, continuousA: 18.2, ocpdA: 20, conductorId: 'c-2', egcConductorId: null },
        { branchId: 'br-3', label: 'B3', deviceIds: units.slice(21).map(u => u.deviceId),
          moduleCount: 10, currentA: 14.5, continuousA: 18.2, ocpdA: 20, conductorId: 'c-3', egcConductorId: null },
      ],
      conductors: [
        { conductorId: 'c-1', gauge: '#12 AWG', material: 'Cu', insulation: 'THWN-2', count: null, ampacityA: null, provenance: { source: 'test' } },
        { conductorId: 'c-2', gauge: '#12 AWG', material: 'Cu', insulation: 'THWN-2', count: null, ampacityA: null, provenance: { source: 'test' } },
        { conductorId: 'c-3', gauge: '#12 AWG', material: 'Cu', insulation: 'THWN-2', count: null, ampacityA: null, provenance: { source: 'test' } },
        { conductorId: 'c-4', gauge: '#6 AWG', material: 'Cu', insulation: 'THWN-2', count: null, ampacityA: 65, provenance: { source: 'test' } },
      ],
      feeder: { conductorId: 'c-4', ocpdA: 60, continuousA: 56.3, currentA: 45.1, voltageDropPct: 1.1,
                conduit: { raceway: 'EMT', tradeSizeIn: '1-1/4"', fillPct: 29 } },
      groundingObjects: [
        { groundingId: 'gnd-feeder', segmentId: 'COMBINER_TO_DISCO_RUN', purpose: 'feeder-egc',
          required: true, method: 'conductor', conductorMaterial: 'Cu', conductorSize: '#10 AWG',
          sizingBasis: 'NEC 250.122 @ 60A feeder OCPD', associatedOcpdA: 60,
          associatedEquipment: 'AC feeder', manufacturerListingBasis: null,
          codeBasis: 'NEC 250.122', provenance: { source: 'test' } },
        { groundingId: 'gnd-gec', segmentId: 'SERVICE', purpose: 'gec', required: false,
          method: 'none-required', conductorMaterial: null, conductorSize: null, sizingBasis: null,
          associatedOcpdA: null, associatedEquipment: 'Existing GES', manufacturerListingBasis: null,
          codeBasis: 'NEC 250.64', provenance: { source: 'test' } },
      ],
      routeSegments: [
        { segmentId: 'COMBINER_TO_DISCO_RUN', from: 'combiner', to: 'disconnect', oneWayFt: 14,
          lengthSource: 'cad-derived-estimate', raceway: 'EMT', tradeSizeIn: '1-1/4"', fillPct: 29,
          conductorGauge: '#6 AWG', conductorCallout: '#6 AWG THWN-2', egcGauge: '#10 AWG',
          voltageDropPct: 0.4, ocpdA: 60, tempDeratingFactor: 0.91, provenance: { source: 'test' } },
      ],
      serviceTopology: [
        { objectId: 'svc-tap-point', type: 'tap-point', label: 'Supply-side tap point', description: 'Line side',
          conductorSpec: null, ocpdRatingA: null, lengthFt: null, lengthSource: 'not-applicable',
          constraints: [], provenance: { source: 'test' } },
        { objectId: 'svc-tap-conductors', type: 'tap-conductors', label: 'Tap conductors', description: 'tap → fused disco',
          conductorSpec: '#6 AWG THWN-2', ocpdRatingA: null, lengthFt: null, lengthSource: 'unknown',
          constraints: [{ code: 'NEC-705.11(C)-TAP-10FT', description: '≤10 ft', limitFt: 10, state: 'pending' }],
          provenance: { source: 'test' } },
        { objectId: 'svc-fused-ocpd', type: 'fused-ocpd', label: 'Fused AC disconnect', description: null,
          conductorSpec: null, ocpdRatingA: 60, lengthFt: null, lengthSource: 'not-applicable',
          constraints: [], provenance: { source: 'test' } },
        { objectId: 'svc-utility-disconnect', type: 'utility-disconnect', label: 'Utility disconnect', description: null,
          conductorSpec: null, ocpdRatingA: 60, lengthFt: null, lengthSource: 'not-applicable',
          constraints: [], provenance: { source: 'test' } },
        { objectId: 'svc-meter', type: 'meter', label: 'Utility meter', description: null,
          conductorSpec: null, ocpdRatingA: null, lengthFt: null, lengthSource: 'not-applicable',
          constraints: [], provenance: { source: 'test' } },
        { objectId: 'svc-service-disconnect', type: 'service-disconnect', label: 'Main service disconnect', description: null,
          conductorSpec: null, ocpdRatingA: 200, lengthFt: null, lengthSource: 'not-applicable',
          constraints: [], provenance: { source: 'test' } },
      ],
      poi: { method: 'SUPPLY_SIDE_TAP', busbarA: 200, mainBreakerA: 200, backfeedA: 60, rulePasses: true },
      parity: { legacyEngine: 'runElectricalCalc', legacyRan: true, checks: [], unresolved: [] },
      provenance: { source: 'test' }, gaps: [],
    },
    structural: {
      mountRecordId: null, attachmentCount: 64, attachmentSpacingIn: 24,
      railTotalFt: null, railCount: null, spliceCount: null,
      loads: { windSpeedMph: 115, exposure: 'C', snowPsf: 20, source: 'structural-engine-v4' },
      governing: { utilization: 0.4, safetyFactor: 2.1, passes: true },
      rackingAssembly: null, rails: [], attachments: [], checks: [],
      env: { ultimateWindSpeedMph: 115, windSpeedSource: 'test', exposureCategory: 'C', riskCategory: 'II',
             groundSnowPsf: 20, roofSnowPsf: 14, buildingHeightFt: 15, componentCladdingZones: [],
             upliftPressurePsf: null, downforcePressurePsf: null,
             codeAuthority: { asceEdition: 'ASCE 7-22', source: 'pending-w4-ahj-authority' },
             provenance: { source: 'test' } },
      engine: { moduleDeadLoadLbs: null, rackingDeadLoadLbs: null, addedDeadLoadPsf: null,
                distributedRoofLoadPsf: null, totalRailLoadLbsPerFt: null, governingUtilization: 0.4,
                governingLimitState: 'attachment-uplift', passes: true, engineeringReviewRequired: false,
                reviewReasons: [], provenance: { source: 'test' } },
      framingObservation: null, framingCapacityAuthority: null,
      bom: [], bomReconciliation: { ok: true, basis: 'no-structural-objects', checks: [] },
      reactionReconciliation: { ok: true, present: false, attachmentCount: 0, reactionModelCount: null,
        arrayAreaFt2: null, tributarySumFt2: null, appliedUpliftPsfAsd: null, appliedSnowPsf: null,
        appliedDeadPsf: null, upliftReactionSumLbs: null, snowReactionSumLbs: null, deadReactionSumLbs: null,
        tolerance: { lower: 0.98, upper: 1.5 }, checks: [], note: 'test' },
      provenance: { source: 'test' }, gaps: [],
    },
    derived: { moduleCount: 31, dcWattsStc: 12400, acWattsContinuous: 10819,
               branchCount: 3, feederContinuousA: 56.3, provenance: { source: 'test' } },
    certification: { engineeringReviewApproved: false, engineer: null },
    permitReadiness: { ready: false, blockers: [
      { code: 'ROUTE-LENGTH-ESTIMATE', message: 'cad-derived estimates' },
      { code: 'ENGINEERING-REVIEW-PENDING', message: 'no review record' },
    ], registry: [] },
  };
}

describe('PermitDesignSnapshot W1 — validator', () => {
  it('a legal 11/10/10 IQ8A snapshot has zero blocking violations', () => {
    expect(blockingViolations(validatePermitDesignSnapshot(baseSnapshot()))).toEqual([]);
  });

  it('V5a: 12 IQ8A on a branch fails closed with full violation context', () => {
    const s = clone(baseSnapshot());
    s.electrical.branches[0].moduleCount = 12;
    s.electrical.branches[1].moduleCount = 9;
    const b = blockingViolations(validatePermitDesignSnapshot(s));
    const v = b.find(x => x.invariant === 'V5a');
    expect(v).toBeTruthy();
    expect(v!.authorityPath).toContain('branches[B1].moduleCount');
    expect(v!.offendingValue).toBe(12);
    expect(v!.sourceRecord).toContain('IQ8A');
    expect(v!.affectedProjections).toContain('E-1');
  });

  it('V5a: 30A branch OCPD on IQ8A fails closed', () => {
    const s = clone(baseSnapshot());
    s.electrical.branches[0].ocpdA = 30;
    const b = blockingViolations(validatePermitDesignSnapshot(s));
    expect(b.some(x => x.invariant === 'V5a' && x.offendingValue === 30)).toBe(true);
  });

  it('V1/V3/V4: plane sums, branch sums, device partition', () => {
    const s1 = clone(baseSnapshot());
    s1.geometry.roofPlanes[0].moduleCount = 18;
    expect(blockingViolations(validatePermitDesignSnapshot(s1)).some(x => x.invariant === 'V1')).toBe(true);

    const s2 = clone(baseSnapshot());
    s2.electrical.branches[2].moduleCount = 9;
    expect(blockingViolations(validatePermitDesignSnapshot(s2)).some(x => x.invariant === 'V3')).toBe(true);

    const s3 = clone(baseSnapshot());
    s3.electrical.microInverterUnits[0].branchId = 'br-404';
    expect(blockingViolations(validatePermitDesignSnapshot(s3)).some(x => x.invariant === 'V4')).toBe(true);
  });

  it('V6: derived DC watts must equal Σ module STC watts', () => {
    const s = clone(baseSnapshot());
    s.derived.dcWattsStc = 12555;
    expect(blockingViolations(validatePermitDesignSnapshot(s)).some(x => x.invariant === 'V6')).toBe(true);
  });
});

describe('PermitDesignSnapshot W1 — digest + immutability', () => {
  it('digest is deterministic and key-order independent', () => {
    const s = baseSnapshot() as unknown as Record<string, unknown>;
    const d1 = computeSnapshotDigest(s);
    const reordered = JSON.parse(canonicalJson(s));
    expect(computeSnapshotDigest(reordered)).toBe(d1);
    expect(snapshotIdFromDigest(d1)).toMatch(/^PDS-[0-9A-F]{12}$/);
  });

  it('digest changes when the design changes (approval invalidation basis)', () => {
    const s = baseSnapshot() as unknown as Record<string, unknown>;
    const d1 = computeSnapshotDigest(s);
    const s2 = clone(baseSnapshot());
    s2.electrical.branches[0].ocpdA = 15;
    expect(computeSnapshotDigest(s2 as unknown as Record<string, unknown>)).not.toBe(d1);
  });

  it('deepFreeze makes the snapshot immutable', () => {
    const s = deepFreeze(baseSnapshot());
    expect(() => { (s.electrical.branches[0] as { ocpdA: number }).ocpdA = 30; }).toThrow();
    expect(s.electrical.branches[0].ocpdA).toBe(20);
  });
});

describe('PermitDesignSnapshot W1 — end-to-end render', () => {
  const html = generatePermitHTML(JSON.parse(JSON.stringify(roofProject)));
  const pages = html.split(/<div class="page"[ >]/).slice(1);

  it('every rendered sheet carries the same snapshot id (V12)', () => {
    const m = html.match(/PDS-[0-9A-F]{12}/);
    expect(m).toBeTruthy();
    const sid = m![0];
    for (const p of pages) expect(p).toContain(sid);
  });

  it('CERT and PE sheets carry the D-6 pending-review gate (V13)', () => {
    const certPages = pages.filter(p => /tb-sheet-id">\s*(CERT|PE-1)\s*</.test(p));
    expect(certPages.length).toBeGreaterThanOrEqual(2);
    for (const p of certPages) {
      expect(p).toContain('PENDING ENGINEERING REVIEW');
      expect(p).toContain('NOT FOR PERMIT SUBMISSION');
      expect(p).toContain('UNSIGNED / UNSEALED');
    }
  });
});
