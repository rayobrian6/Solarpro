/**
 * tests/golden-path.test.ts
 * Golden Path Regression Harness — verifies SolarPro's highest-value
 * pipelines produce identical outputs from identical inputs.
 *
 * Pipelines tested:
 *   1. Bill Upload → Parse (parseBill)
 *   2. Project → Canonical (buildCanonical × 3 system types)
 *   3. Project → CAD (generateCADLayout × 3 system types)
 *   4. Project → SLD Input (buildSLDInputFromPermit)
 *
 * Run: npm run verify:golden  (or npx vitest run tests/golden-path.test.ts)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

import { roofProject } from '../test-fixtures/roofProject';
import { groundProject } from '../test-fixtures/groundProject';
import { fenceProject } from '../test-fixtures/fenceProject';
import { billText } from '../test-fixtures/billText';

import { parseBill } from '@/lib/billParser';
import { buildCanonical } from '@/lib/permit/utils/canonical';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { buildSLDInputFromPermit } from '@/lib/permit/utils/sldAdapter';

// ─── Snapshot helpers (must match golden-generate.ts exactly) ─────────

function cadSnapshot(cad: any) {
  return {
    systemType: cad.systemType,
    totalPanels: cad.totalPanels,
    totalDcKw: cad.totalDcKw,
    warnings: cad.warnings,
    hasRoof: !!cad.roof,
    hasGround: !!cad.ground,
    hasFence: !!cad.fence,
    boundsMinX: cad.bounds?.minX,
    boundsMaxX: cad.bounds?.maxX,
    boundsMinY: cad.bounds?.minY,
    boundsMaxY: cad.bounds?.maxY,
    panelWidthM: cad.panelWidthM,
    panelHeightM: cad.panelHeightM,
    roofPlaneCount: cad.roof?.planes?.length ?? null,
    groundArrayCount: cad.ground?.arrays?.length ?? null,
    fenceSegmentCount: cad.fence?.segments?.length ?? null,
    fenceTotalLengthM: cad.fence?.totalLengthM ?? null,
    fencePostCount: cad.fence?.postCount ?? null,
    hasSystemDefinition: !!cad.systemDefinition,
    sdSystemType: cad.systemDefinition?.systemType ?? null,
    sdTopology: cad.systemDefinition?.topology ?? null,
  };
}

function canonicalSnapshot(c: any) {
  return {
    systemType: c.systemType,
    panelCount: c.panels?.length ?? 0,
    hasGeometry: !!c.geometry,
    moduleManufacturer: c.module?.manufacturer,
    moduleModel: c.module?.model,
    moduleWattage: c.module?.wattage,
    moduleVoc: c.module?.voc,
    moduleIsc: c.module?.isc,
    mountSystem: c.mountSystem,
    siteWindSpeed: c.site?.windSpeed,
    siteSnowLoad: c.site?.groundSnowLoad,
    siteExposure: c.site?.exposureCategory,
    siteState: c.site?.state,
    siteAhj: c.site?.ahj,
    structPostEmbed: c.structure?.postEmbedFt,
    structPostSpacing: c.structure?.postSpacingFt,
    structPileDepth: c.structure?.pileDepthFt,
    structTilt: c.structure?.tiltDeg,
    structRafterSize: c.structure?.rafterSize,
    elecTotalPanels: c.electrical?.totalPanels,
    elecTotalDcKw: c.electrical?.totalDcKw,
    elecStrings: c.electrical?.strings,
    elecInverterModel: c.electrical?.inverterModel,
  };
}

function billSnapshot(b: any) {
  return {
    utilityValue: b.utility?.value ?? null,
    utilitySourceType: b.utility?.source_type ?? null,
    monthlyArray: b.monthlyArray,
    monthlySource: b.monthlySource,
    monthsFound: b.monthsFound,
    annualValue: b.annual?.value ?? null,
    annualSourceType: b.annual?.source_type ?? null,
    rateValue: b.rate?.value ?? null,
    rateSourceType: b.rate?.source_type ?? null,
    currentMonthKwh: b.currentMonthKwh,
  };
}

function sldInputSnapshot(sld: any) {
  if (!sld) return null;
  return {
    topLevelKeys: Object.keys(sld).sort(),
    systemType: sld.systemType ?? null,
    panelModel: sld.panelModel ?? null,
    panelWatts: sld.panelWatts ?? null,
    panelCount: sld.panelCount ?? null,
    inverterModel: sld.inverterModel ?? null,
    inverterCount: sld.inverterCount ?? null,
    hasMainPanel: !!sld.mainPanelAmps,
    hasBattery: !!(sld.batteryModel || sld.batteryCount),
  };
}

// ─── Load golden reference ────────────────────────────────────────────

const GOLDEN_PATH = path.resolve(__dirname, '../test-fixtures/golden/golden.json');
let golden: Record<string, any>;

beforeAll(() => {
  if (!fs.existsSync(GOLDEN_PATH)) {
    throw new Error(
      `Golden reference not found at ${GOLDEN_PATH}.\n` +
      `Run: npx tsx tests/golden-generate.ts`
    );
  }
  golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8'));
});

// ─── 1. Bill Parse Regression ─────────────────────────────────────────

describe('Golden Path: Bill Parse', () => {
  it('parseBill(billText) matches golden reference', () => {
    const result = parseBill(billText);
    const snap = billSnapshot(result);
    expect(snap).toEqual(golden['bill-parse']);
  });

  it('monthly array has 12 elements', () => {
    const result = parseBill(billText);
    expect(result.monthlyArray).toHaveLength(12);
  });

  it('extracts correct rate', () => {
    const result = parseBill(billText);
    expect(result.rate?.value).toBe(0.1276);
  });

  it('finds all 12 months', () => {
    const result = parseBill(billText);
    expect(result.monthsFound).toBe(12);
  });
});

// ─── 2. Canonical Pipeline Regression ─────────────────────────────────

describe('Golden Path: Canonical Pipeline', () => {
  describe('Roof', () => {
    it('buildCanonical(roofProject) matches golden reference', () => {
      const canonical = buildCanonical(roofProject);
      const snap = canonicalSnapshot(canonical);
      expect(snap).toEqual(golden['canonical-roof']);
    });

    it('resolves systemType = roof', () => {
      const canonical = buildCanonical(roofProject);
      expect(canonical.systemType).toBe('roof');
    });

    it('resolves correct panel count', () => {
      const canonical = buildCanonical(roofProject);
      expect(canonical.panels.length).toBe(12);
    });
  });

  describe('Ground', () => {
    it('buildCanonical(groundProject) matches golden reference', () => {
      const canonical = buildCanonical(groundProject);
      const snap = canonicalSnapshot(canonical);
      expect(snap).toEqual(golden['canonical-ground']);
    });

    it('resolves systemType = ground_mount', () => {
      const canonical = buildCanonical(groundProject);
      expect(canonical.systemType).toBe('ground_mount');
    });

    it('resolves correct panel count', () => {
      const canonical = buildCanonical(groundProject);
      expect(canonical.panels.length).toBe(40);
    });
  });

  describe('Fence', () => {
    it('buildCanonical(fenceProject) matches golden reference', () => {
      const canonical = buildCanonical(fenceProject);
      const snap = canonicalSnapshot(canonical);
      expect(snap).toEqual(golden['canonical-fence']);
    });

    it('resolves systemType = solar_fence', () => {
      const canonical = buildCanonical(fenceProject);
      expect(canonical.systemType).toBe('solar_fence');
    });

    it('resolves correct panel count', () => {
      const canonical = buildCanonical(fenceProject);
      expect(canonical.panels.length).toBe(24);
    });
  });
});

// ─── 3. CAD Engine Regression ─────────────────────────────────────────

describe('Golden Path: CAD Engine', () => {
  describe('Roof', () => {
    it('generateCADLayout(roofProject) matches golden reference', () => {
      const cad = generateCADLayout(roofProject as any);
      const snap = cadSnapshot(cad);
      expect(snap).toEqual(golden['cad-roof']);
    });

    it('produces roof sub-model', () => {
      const cad = generateCADLayout(roofProject as any);
      expect(cad.roof).toBeTruthy();
      expect(cad.ground).toBeFalsy();
      expect(cad.fence).toBeFalsy();
    });
  });

  describe('Ground', () => {
    it('generateCADLayout(groundProject) matches golden reference', () => {
      const cad = generateCADLayout(groundProject as any);
      const snap = cadSnapshot(cad);
      expect(snap).toEqual(golden['cad-ground']);
    });

    it('produces ground sub-model', () => {
      const cad = generateCADLayout(groundProject as any);
      expect(cad.ground).toBeTruthy();
      expect(cad.roof).toBeFalsy();
      expect(cad.fence).toBeFalsy();
    });
  });

  describe('Fence', () => {
    it('generateCADLayout(fenceProject) matches golden reference', () => {
      const cad = generateCADLayout(fenceProject as any);
      const snap = cadSnapshot(cad);
      expect(snap).toEqual(golden['cad-fence']);
    });

    it('produces fence sub-model', () => {
      const cad = generateCADLayout(fenceProject as any);
      expect(cad.fence).toBeTruthy();
      expect(cad.roof).toBeFalsy();
      expect(cad.ground).toBeFalsy();
    });
  });
});

// ─── 4. SLD Pipeline Regression ───────────────────────────────────────

describe('Golden Path: SLD Pipeline', () => {
  it('buildSLDInputFromPermit(roofProject, roofCAD) matches golden reference', () => {
    const cad = generateCADLayout(roofProject as any);
    const sldInput = buildSLDInputFromPermit(roofProject, cad);
    const snap = sldInputSnapshot(sldInput);
    expect(snap).toEqual(golden['sld-input-roof']);
  });

  it('SLD input contains required fields', () => {
    const cad = generateCADLayout(roofProject as any);
    const sldInput = buildSLDInputFromPermit(roofProject, cad) as any;
    expect(sldInput.topologyType).toBeDefined();
    expect(sldInput.panelModel).toBeDefined();
    expect(sldInput.panelWatts).toBeGreaterThan(0);
    expect(sldInput.totalModules).toBeGreaterThan(0);
    expect(sldInput.mainPanelAmps).toBeGreaterThan(0);
    expect(sldInput.inverterModel).toBeDefined();
  });
});

// ─── 5. Cross-Contamination Guard ─────────────────────────────────────

describe('Golden Path: Cross-Contamination Guard', () => {
  it('roof CAD produces no ground/fence artifacts', () => {
    const cad = generateCADLayout(roofProject as any);
    expect(cad.systemType).toBe('roof');
    expect(cad.ground).toBeFalsy();
    expect(cad.fence).toBeFalsy();
  });

  it('ground CAD produces no roof/fence artifacts', () => {
    const cad = generateCADLayout(groundProject as any);
    expect(cad.systemType).toBe('ground_mount');
    expect(cad.roof).toBeFalsy();
    expect(cad.fence).toBeFalsy();
  });

  it('fence CAD produces no roof/ground artifacts', () => {
    const cad = generateCADLayout(fenceProject as any);
    expect(cad.systemType).toBe('solar_fence');
    expect(cad.roof).toBeFalsy();
    expect(cad.ground).toBeFalsy();
  });

  it('canonical roof mount system is locked', () => {
    const c = buildCanonical(roofProject);
    expect(c.mountSystem).toBe('IronRidge XR100');
  });

  it('canonical ground mount system is locked', () => {
    const c = buildCanonical(groundProject);
    expect(c.mountSystem).toBe('Ground Mount Racking System');
  });

  it('canonical fence mount system is locked', () => {
    const c = buildCanonical(fenceProject);
    expect(c.mountSystem).toBe('Solar Fence Rail System');
  });
});
