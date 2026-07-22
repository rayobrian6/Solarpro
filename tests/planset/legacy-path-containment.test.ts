import { describe, it, expect } from 'vitest';
import {
  resolveLegacyPathStatus,
  isSnapshotPermitValid,
  isLegacyStructuralStatus,
  LEGACY_PATH_BANNER,
  LEGACY_STRUCTURAL_STATUS,
} from '@/lib/plan-set/legacy-path-guard';
import { buildStructuralSheet, type StructuralSheetInput } from '@/lib/plan-set/structural-sheet';
import { buildComplianceSheet, type ComplianceSheetInput } from '@/lib/plan-set/compliance-sheet';
import type { TitleBlockData } from '@/lib/plan-set/title-block';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

// ── fixtures ─────────────────────────────────────────────────────────────────
const tb: TitleBlockData = {
  companyName: 'SolarPro', companyAddress: 'City, ST', companyPhone: '', companyEmail: '',
  companyLicense: '', projectName: 'Test', clientName: 'Client', siteAddress: '1 Main',
  city: 'City', state: 'ST', zip: '00000', ahj: 'City Building Dept', utilityName: 'Utility',
  systemKw: 12.4, panelCount: 31, panelModel: 'Q.PEAK', inverterModel: 'IQ8A',
  mountType: 'Roof Mount', sheetTitle: 'S', sheetNumber: 'S-1', totalSheets: 7,
  revision: '0', preparedBy: 'SolarPro', preparedDate: '2026-07-21', necVersion: 'NEC 2020',
  ibcVersion: 'IBC 2021', asceVersion: 'ASCE 7-22',
};

function structInput(status: string): StructuralSheetInput {
  return {
    tb: { ...tb, sheetTitle: 'Structural', sheetNumber: 'S-1' },
    stateCode: 'ST', city: 'City', county: 'County', address: '1 Main',
    roofType: 'shingle', roofPitchDeg: 20, roofPitchRatio: '4:12', rafterSize: '2×6',
    rafterSpacingIn: 24, rafterSpanFt: 16, rafterSpecies: 'DF-L #2', sheathingType: '7/16" OSB',
    stories: 1, windSpeedMph: 115, windExposureCategory: 'C', groundSnowPsf: 0, flatRoofSnowPsf: 0,
    seismicCategory: 'C', importance: 'II', panelWeightLbs: 45, panelCount: 31, panelLengthIn: 74,
    panelWidthIn: 41, panelThicknessIn: 1.5, mountingSystem: 'RT-MINI', railWeightLbsPerFt: 0.5,
    attachmentType: 'Lag Bolt to Rafter', lagBoltSize: '5/16" × 3"', lagBoltSpacingFt: 4,
    flashingType: 'Self-flashing', panelDeadLoadPsf: 2.5, mountingDeadLoadPsf: 1.5,
    totalDeadLoadPsf: 14, existingDeadLoadPsf: 10, liveLoadPsf: 20, snowLoadPsf: 0,
    windUpliftPsf: 25, windDownPsf: 15, governingLoadPsf: 40, rafterCapacityPsf: 52,
    structuralStatus: status, ridgeSetbackIn: 18, eaveSetbackIn: 18, valleySetbackIn: 18,
    pathwayWidthIn: 36, pathwayRequired: true, setbackCodeRef: 'IRC R324.4',
  };
}

function compInput(status: string): ComplianceSheetInput {
  return {
    tb: { ...tb, sheetTitle: 'Compliance', sheetNumber: 'C-1' },
    systemKw: 12.4, panelCount: 31, inverterType: 'micro', inverterModel: 'IQ8A',
    necVersion: 'NEC 2020', stateCode: 'ST', city: 'City', stringVoc: 400, stringIsc: 10,
    dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG', acBreakerAmps: 40, backfeedBreakerAmps: 40,
    mainPanelBusAmps: 200, mainPanelBreakerAmps: 200, interconnectionType: 'load-side',
    rapidShutdownRequired: true, rapidShutdownDevice: 'IQ8A integrated', groundWireGauge: '#8 AWG',
    structuralStatus: status, rafterCapacityPsf: 52, governingLoadPsf: 40,
    ridgeSetbackIn: 18, eaveSetbackIn: 18, pathwayWidthIn: 36, pathwayRequired: true,
  };
}

const validSnapshot = {
  meta: { snapshotId: 'PDS-0123456789abcdef', digest: '0'.repeat(64) },
  permitReadiness: { ready: true, blockers: [] },
} as unknown as PermitDesignSnapshot;

describe('W3.1 §3 — parallel plan-set path is contained (fail closed)', () => {
  it('no snapshot ⇒ LEGACY, never PASS or permit-ready', () => {
    const r = resolveLegacyPathStatus(null);
    expect(r.isLegacy).toBe(true);
    expect(r.structuralStatus).toBe(LEGACY_STRUCTURAL_STATUS);
    expect(r.structuralStatus).not.toBe('STRUCTURAL_PASS');
    expect(r.permitReady).toBe(false);
    expect(r.approved).toBe(false);
    expect(r.compliant).toBe(false);
    expect(r.overallCompliance).toBe(LEGACY_PATH_BANNER);
    expect(r.overallCompliance).not.toBe('PASS');
    expect(r.banner).toBe(LEGACY_PATH_BANNER);
  });

  it('every INVALID snapshot shape fails closed to LEGACY (never PASS)', () => {
    const invalids: unknown[] = [
      undefined,
      {},
      { meta: {} },
      { meta: { snapshotId: 'PDS-x', digest: 'short' }, permitReadiness: { ready: true, blockers: [] } },
      { meta: { snapshotId: 'not-pds', digest: '0'.repeat(64) }, permitReadiness: { ready: true, blockers: [] } },
      { meta: { snapshotId: 'PDS-x', digest: '0'.repeat(64) }, permitReadiness: { ready: false, blockers: [] } },
      { meta: { snapshotId: 'PDS-x', digest: '0'.repeat(64) }, permitReadiness: { ready: true, blockers: [{ code: 'X', message: 'y' }] } },
      { meta: { snapshotId: 'PDS-x', digest: '0'.repeat(64) } }, // no permitReadiness
    ];
    for (const s of invalids) {
      expect(isSnapshotPermitValid(s as PermitDesignSnapshot)).toBe(false);
      const r = resolveLegacyPathStatus(s as PermitDesignSnapshot);
      expect(r.isLegacy, `input ${JSON.stringify(s)} must be legacy`).toBe(true);
      expect(r.structuralStatus).toBe(LEGACY_STRUCTURAL_STATUS);
      expect(r.permitReady).toBe(false);
      expect(r.overallCompliance).not.toBe('PASS');
    }
  });

  it('a VALID canonical snapshot is the ONLY way to reach PASS (gate is real, not always-legacy)', () => {
    expect(isSnapshotPermitValid(validSnapshot)).toBe(true);
    const r = resolveLegacyPathStatus(validSnapshot);
    expect(r.isLegacy).toBe(false);
    expect(r.structuralStatus).toBe('STRUCTURAL_PASS');
    expect(r.permitReady).toBe(true);
    expect(r.compliant).toBe(true);
    expect(r.overallCompliance).toBe('PASS');
    expect(r.banner).toBeNull();
  });
});

describe('W3.1 §3 — S-1 structural sheet reflects containment', () => {
  it('legacy status ⇒ banner shown, no "STRUCTURAL PASS" declared', () => {
    const html = buildStructuralSheet(structInput(LEGACY_STRUCTURAL_STATUS));
    expect(html).toContain(LEGACY_PATH_BANNER);
    expect(html).toContain('LEGACY PATH — NOT FOR PERMIT');
    expect(html).not.toContain('STRUCTURAL PASS');
  });

  it('canonical PASS status ⇒ PASS box, no legacy banner (proves the sheet is not hardwired)', () => {
    const html = buildStructuralSheet(structInput('STRUCTURAL_PASS'));
    expect(html).toContain('STRUCTURAL PASS');
    expect(html).not.toContain(LEGACY_PATH_BANNER);
  });
});

describe('W3.1 §3 — C-1 compliance sheet reflects containment', () => {
  it('legacy status ⇒ NOT-FOR-PERMIT banner + no compliance certification', () => {
    const html = buildComplianceSheet(compInput(LEGACY_STRUCTURAL_STATUS));
    expect(html).toContain(LEGACY_PATH_BANNER);
    expect(html).toContain('This checklist was generated by the legacy plan-set path');
    expect(html).not.toContain('I hereby certify that this photovoltaic system design complies');
  });

  it('non-legacy status still certifies (control)', () => {
    const html = buildComplianceSheet(compInput('PASS'));
    expect(html).not.toContain(LEGACY_PATH_BANNER);
    expect(html).toContain('I hereby certify that this photovoltaic system design complies');
  });
});

describe('W3.1 §3 — isLegacyStructuralStatus helper', () => {
  it('only the legacy enum is legacy', () => {
    expect(isLegacyStructuralStatus(LEGACY_STRUCTURAL_STATUS)).toBe(true);
    expect(isLegacyStructuralStatus('STRUCTURAL_PASS')).toBe(false);
    expect(isLegacyStructuralStatus('PASS')).toBe(false);
    expect(isLegacyStructuralStatus(null)).toBe(false);
  });
});
