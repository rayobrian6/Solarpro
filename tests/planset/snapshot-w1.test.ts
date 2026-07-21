import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import { computeSnapshotDigest, snapshotIdFromDigest, canonicalJson, deepFreeze } from '@/lib/permit/snapshot/digest';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// Minimal valid snapshot for validator unit tests.
function baseSnapshot(): PermitDesignSnapshot {
  const mods = Array.from({ length: 31 }, (_, i) => ({
    moduleId: `m${i}`, planeKey: i < 19 ? 'P1' : 'P2', moduleRecordId: 'mod-1',
    lat: null, lng: null, row: 0, col: i, orientation: null,
  }));
  const units = mods.map((m, i) => ({
    deviceId: `mi-${m.moduleId}`, moduleId: m.moduleId, inverterRecordId: 'inv-1',
    branchId: i < 11 ? 'br-1' : i < 21 ? 'br-2' : 'br-3',
  }));
  return {
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
          tempCoeffVocPctC: -0.27, lengthIn: 70.9, widthIn: 41.7, weightLbs: 48, ulListing: null },
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
      modules: mods, provenance: { source: 'test' }, gaps: [],
    },
    electrical: {
      topology: 'MICRO', engineOfRecord: 'runElectricalCalc',
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
      systemEgc: { conductorId: 'c-4', basisOcpdA: 60 },
      poi: { method: 'SUPPLY_SIDE_TAP', busbarA: 200, mainBreakerA: 200, backfeedA: 60, rulePasses: true },
      shadowParity: { shadowEngine: 'computeSystem', ran: true, divergences: [] },
      provenance: { source: 'test' }, gaps: [],
    },
    structural: {
      mountRecordId: null, attachmentCount: 64, attachmentSpacingIn: 24,
      railTotalFt: null, railCount: null, spliceCount: null,
      loads: { windSpeedMph: 115, exposure: 'C', snowPsf: 20, source: 'structural-engine-v4' },
      governing: { utilization: 0.4, safetyFactor: 2.1, passes: true },
      provenance: { source: 'test' }, gaps: [],
    },
    derived: { moduleCount: 31, dcWattsStc: 12400, acWattsContinuous: 10819,
               branchCount: 3, feederContinuousA: 56.3, provenance: { source: 'test' } },
    certification: { engineeringReviewApproved: false, engineer: null },
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
