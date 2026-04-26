/**
 * tests/golden-generate.ts
 * Generates golden reference outputs from deterministic pipeline functions.
 * Run with: npx tsx tests/golden-generate.ts
 */

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

const GOLDEN_DIR = path.resolve(__dirname, '../test-fixtures/golden');

function safeStringify(obj: any): string {
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'function') return '[Function]';
    if (value === undefined) return null;
    return value;
  }, 2);
}

/** Extract stable keys from CADModel — exclude timing fields */
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

/** Extract canonical snapshot — key structural fields */
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

/** Extract bill parse snapshot */
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

/** Extract SLD input shape keys */
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

async function main() {
  console.log('=== Golden Output Generator ===');
  console.log(`Output directory: ${GOLDEN_DIR}`);
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  const golden: Record<string, any> = {};

  // 1. Bill Parse
  console.log('\n[1/8] Parsing bill text...');
  const billResult = parseBill(billText);
  golden['bill-parse'] = billSnapshot(billResult);
  console.log('  OK Bill parsed:', golden['bill-parse'].monthsFound, 'months found');

  // 2-4. buildCanonical for each system type
  const fixtures = [
    { name: 'roof', input: roofProject },
    { name: 'ground', input: groundProject },
    { name: 'fence', input: fenceProject },
  ] as const;

  for (let i = 0; i < fixtures.length; i++) {
    const { name, input } = fixtures[i];
    console.log(`\n[${i + 2}/8] Building canonical for ${name}...`);
    const canonical = buildCanonical(input);
    golden[`canonical-${name}`] = canonicalSnapshot(canonical);
    console.log(`  OK canonical ${name}:`, golden[`canonical-${name}`].systemType, golden[`canonical-${name}`].panelCount, 'panels');
  }

  // 5-7. generateCADLayout for each system type
  for (let i = 0; i < fixtures.length; i++) {
    const { name, input } = fixtures[i];
    console.log(`\n[${i + 5}/8] Generating CAD for ${name}...`);
    const cad = generateCADLayout(input as any);
    golden[`cad-${name}`] = cadSnapshot(cad);
    console.log(`  OK CAD ${name}:`, golden[`cad-${name}`].systemType, golden[`cad-${name}`].totalPanels, 'panels');

    // 8. SLD input (roof only)
    if (name === 'roof') {
      console.log(`\n[8/8] Building SLD input for roof...`);
      const sldInput = buildSLDInputFromPermit(input, cad);
      golden['sld-input-roof'] = sldInputSnapshot(sldInput);
      console.log('  OK SLD input keys:', golden['sld-input-roof']?.topLevelKeys?.length ?? 0);
    }
  }

  // Write golden file
  const outPath = path.join(GOLDEN_DIR, 'golden.json');
  fs.writeFileSync(outPath, safeStringify(golden));
  console.log(`\n=== Golden outputs written to ${outPath} ===`);
  console.log(`  Keys: ${Object.keys(golden).join(', ')}`);
}

main().catch(err => {
  console.error('Golden generation failed:', err);
  process.exit(1);
});
