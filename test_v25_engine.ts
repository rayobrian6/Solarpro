import { runStructuralCalcV4, type StructuralInputV4 } from './lib/structural-engine-v4';

// ── TEST 1: Residential ──────────────────────────────────────────────────
const test1Input: StructuralInputV4 = {
  installationType: 'roof_residential',
  windSpeed: 115,
  windExposure: 'B',
  groundSnowLoad: 20,
  meanRoofHeight: 15,
  roofPitch: 20,
  framingType: 'unknown',
  rafterSize: '2x6',
  rafterSpacingIn: 24,
  rafterSpanFt: 16,
  woodSpecies: 'Douglas Fir-Larch',
  panelCount: 10,
  panelLengthIn: 65.0,
  panelWidthIn: 39.4,
  panelWeightLbs: 45,
  panelOrientation: 'portrait',
  rowCount: 2,
  colCount: 5,
  mountingSystemId: 'ironridge-xr100',
  rackingWeightPerPanelLbs: 4.0,
  roofDeadLoadPsf: 15,
};

// ── TEST 2: Commercial Ballasted ─────────────────────────────────────────
const test2Input: StructuralInputV4 = {
  installationType: 'commercial_ballasted',
  windSpeed: 110,
  windExposure: 'B',
  groundSnowLoad: 0,
  meanRoofHeight: 30,
  roofPitch: 0,
  framingType: 'unknown',
  rafterSize: '2x6',
  rafterSpacingIn: 24,
  rafterSpanFt: 20,
  panelCount: 200,
  panelLengthIn: 65.0,
  panelWidthIn: 39.4,
  panelWeightLbs: 45,
  panelOrientation: 'portrait',
  rowCount: 10,
  colCount: 20,
  mountingSystemId: 'esdec-flatfix',
  rackingWeightPerPanelLbs: 4.0,
  roofMembrane: 'tpo',
  roofDeadLoadPsf: 15,
};

// ── TEST 3: Ground Mount ─────────────────────────────────────────────────
const test3Input: StructuralInputV4 = {
  installationType: 'ground_mount',
  windSpeed: 120,
  windExposure: 'C',
  groundSnowLoad: 5,
  meanRoofHeight: 8,
  roofPitch: 25,
  framingType: 'unknown',
  rafterSize: '2x6',
  rafterSpacingIn: 24,
  rafterSpanFt: 16,
  panelCount: 50,
  panelLengthIn: 65.0,
  panelWidthIn: 39.4,
  panelWeightLbs: 45,
  panelOrientation: 'portrait',
  rowCount: 5,
  colCount: 10,
  mountingSystemId: 'ground-dual-post-driven',
  rackingWeightPerPanelLbs: 6.0,
  soilType: 'loam',
  frostDepthIn: 36,
};

function printResult(name: string, result: any): boolean {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: ' + name);
  console.log('='.repeat(60));
  console.log('Status:          ' + result.status);
  
  if (result.wind) {
    console.log('Wind Speed:      ' + result.wind.designWindSpeedMph + ' mph');
    console.log('Velocity Press:  ' + result.wind.velocityPressurePsf?.toFixed(2) + ' psf');
    console.log('Net Uplift:      ' + result.wind.netUpliftPressurePsf?.toFixed(2) + ' psf');
    console.log('GCp Uplift:      ' + result.wind.gcpUplift?.toFixed(2));
  }
  if (result.snow) {
    console.log('Ground Snow:     ' + result.snow.groundSnowLoadPsf + ' psf');
    console.log('Roof Snow:       ' + result.snow.roofSnowLoadPsf?.toFixed(1) + ' psf');
  }
  if (result.attachment) {
    console.log('Safety Factor:   ' + result.attachment.safetyFactor?.toFixed(2));
    console.log('Max Spacing:     ' + result.attachment.maxAllowedSpacing + '"');
    console.log('Uplift/Attach:   ' + result.attachment.upliftPerAttachment?.toFixed(1) + ' lbs');
  }
  if (result.rafterAnalysis) {
    console.log('Framing Type:    ' + result.rafterAnalysis.framingType);
    console.log('Utilization:     ' + (result.rafterAnalysis.overallUtilization * 100).toFixed(0) + '%');
  }
  if (result.mountLayout) {
    console.log('Mount Count:     ' + result.mountLayout.mountCount);
    console.log('Mount Spacing:   ' + result.mountLayout.mountSpacing + '"');
    console.log('Uplift/Mount:    ' + result.mountLayout.upliftPerMount?.toFixed(1) + ' lbs');
  }
  if (result.rackingBOM) {
    console.log('\nRACKING BOM:');
    if (result.rackingBOM.mounts) console.log('  Mounts:        ' + result.rackingBOM.mounts.qty);
    if (result.rackingBOM.rails) console.log('  Rails:         ' + result.rackingBOM.rails.qty + ' ' + result.rackingBOM.rails.unit);
    if (result.rackingBOM.lFeet) console.log('  L-Feet:        ' + result.rackingBOM.lFeet.qty);
    if (result.rackingBOM.midClamps) console.log('  Mid Clamps:    ' + result.rackingBOM.midClamps.qty);
    if (result.rackingBOM.endClamps) console.log('  End Clamps:    ' + result.rackingBOM.endClamps.qty);
    if (result.rackingBOM.ballastBlocks) console.log('  Ballast Blks:  ' + result.rackingBOM.ballastBlocks.qty + ' (' + result.rackingBOM.ballastBlocks.weightLbs?.toLocaleString() + ' lbs)');
    if (result.rackingBOM.piles) console.log('  Piles:         ' + result.rackingBOM.piles.qty);
  }
  if (result.ballastAnalysis) {
    const ba = result.ballastAnalysis;
    console.log('\nBALLAST ANALYSIS:');
    console.log('  Blocks/Module: ' + ba.blocksPerModule);
    console.log('  Total Blocks:  ' + ba.totalBallastBlocks);
    console.log('  Total Weight:  ' + ba.ballastWeightLbs?.toLocaleString() + ' lbs');
    console.log('  Roof Load:     ' + ba.roofLoadPsf?.toFixed(1) + ' psf');
    console.log('  Roof Capacity: ' + ba.roofCapacityPsf?.toFixed(1) + ' psf');
    console.log('  Passes:        ' + (ba.passes ? 'YES' : 'NO'));
    if (ba.notes?.length > 0) ba.notes.forEach((n: string) => console.log('  Note: ' + n));
  }
  if (result.groundMountAnalysis) {
    const gm = result.groundMountAnalysis;
    console.log('\nGROUND MOUNT ANALYSIS:');
    console.log('  Pile Count:    ' + gm.pileCount);
    console.log('  Pile Spacing:  ' + gm.pileSpacingFt + ' ft');
    console.log('  Embedment:     ' + gm.pileEmbedmentFt + ' ft');
    console.log('  Uplift/Pile:   ' + gm.upliftPerPileLbs?.toFixed(0) + ' lbs');
    console.log('  Downward/Pile: ' + gm.downwardPerPileLbs?.toFixed(0) + ' lbs');
    console.log('  SF Uplift:     ' + gm.safetyFactorUplift?.toFixed(2));
    console.log('  SF Downward:   ' + gm.safetyFactorDownward?.toFixed(2));
    console.log('  Passes:        ' + (gm.passes ? 'YES' : 'NO'));
    if (gm.notes?.length > 0) gm.notes.forEach((n: string) => console.log('  Note: ' + n));
  }
  if (result.errors?.length > 0) {
    console.log('\nERRORS:');
    result.errors.forEach((e: any) => console.log('  [' + e.severity + '] ' + e.code + ': ' + e.message));
  }
  if (result.warnings?.length > 0) {
    console.log('\nWARNINGS:');
    result.warnings.forEach((w: any) => console.log('  [' + w.severity + '] ' + w.code + ': ' + w.message));
  }
  
  const passed = result.status === 'PASS' || result.status === 'WARNING';
  console.log('\n' + (passed ? 'PASS' : 'FAIL') + ': ' + name);
  return passed;
}

console.log('V25.1 Structural Engine V4 Validation Tests');
console.log('='.repeat(60));

let allPassed = true;

try {
  const r1 = runStructuralCalcV4(test1Input);
  const p1 = printResult('Test 1: Residential (10 panels, 115mph, 20psf)', r1);
  allPassed = allPassed && p1;
} catch(e: any) {
  console.log('TEST 1 ERROR: ' + e.message);
  allPassed = false;
}

try {
  const r2 = runStructuralCalcV4(test2Input);
  const p2 = printResult('Test 2: Commercial Ballasted (200 panels)', r2);
  allPassed = allPassed && p2;
} catch(e: any) {
  console.log('TEST 2 ERROR: ' + e.message);
  allPassed = false;
}

try {
  const r3 = runStructuralCalcV4(test3Input);
  const p3 = printResult('Test 3: Ground Mount (50 panels)', r3);
  allPassed = allPassed && p3;
} catch(e: any) {
  console.log('TEST 3 ERROR: ' + e.message);
  allPassed = false;
}

console.log('\n' + '='.repeat(60));
console.log(allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');