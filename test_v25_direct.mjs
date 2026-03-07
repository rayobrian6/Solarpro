/**
 * V25.1 Direct Structural Engine Validation Tests
 * Tests the V4 engine directly without HTTP auth
 */

// We need to compile TypeScript first or use ts-node
// Let's use the compiled .next output or test via ts-node

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

// Create a TypeScript test file
const tsTest = `
import { runStructuralCalcV4, type StructuralInputV4 } from './lib/structural-engine-v4';

// ── TEST 1: Residential ──────────────────────────────────────────────────
const test1Input: StructuralInputV4 = {
  panelCount: 10,
  roofType: 'shingle',
  rafterSize: '2x6',
  rafterSpacing: 24,
  rafterSpan: 16,
  attachmentSpacing: 48,
  rackingId: 'ironridge-xr100',
  windSpeed: 115,
  groundSnowLoad: 20,
  exposureCategory: 'B',
  framingType: 'unknown',
  installationType: 'roof_residential',
  tiltAngle: 20,
  panelWidthFt: 3.28,
  panelHeightFt: 5.41,
  arrayRows: 2,
  arrayCols: 5,
};

// ── TEST 2: Commercial Ballasted ─────────────────────────────────────────
const test2Input: StructuralInputV4 = {
  panelCount: 200,
  roofType: 'flat_tpo',
  attachmentSpacing: 72,
  rackingId: 'esdec-flatfix',
  windSpeed: 110,
  groundSnowLoad: 0,
  exposureCategory: 'B',
  framingType: 'unknown',
  installationType: 'commercial_ballasted',
  tiltAngle: 10,
  panelWidthFt: 3.28,
  panelHeightFt: 5.41,
  arrayRows: 10,
  arrayCols: 20,
};

// ── TEST 3: Ground Mount ─────────────────────────────────────────────────
const test3Input: StructuralInputV4 = {
  panelCount: 50,
  roofType: 'flat_gravel',
  attachmentSpacing: 96,
  rackingId: 'ground-dual-post-driven',
  windSpeed: 120,
  groundSnowLoad: 5,
  exposureCategory: 'C',
  framingType: 'unknown',
  installationType: 'ground_mount',
  tiltAngle: 25,
  panelWidthFt: 3.28,
  panelHeightFt: 5.41,
  arrayRows: 5,
  arrayCols: 10,
};

function printResult(name: string, result: any) {
  console.log('\\n' + '='.repeat(60));
  console.log('TEST: ' + name);
  console.log('='.repeat(60));
  console.log('Status:          ' + result.status);
  
  if (result.wind) {
    console.log('Wind Speed:      ' + result.wind.designWindSpeed + ' mph');
    console.log('Exposure:        ' + result.wind.exposureCategory);
    console.log('Velocity Press:  ' + result.wind.velocityPressure?.toFixed(2) + ' psf');
    console.log('Net Uplift:      ' + result.wind.netUpliftPressure?.toFixed(2) + ' psf');
    console.log('Uplift/Attach:   ' + result.wind.upliftPerAttachment?.toFixed(1) + ' lbs');
  }
  if (result.snow) {
    console.log('Ground Snow:     ' + result.snow.groundSnowLoad + ' psf');
    console.log('Roof Snow:       ' + result.snow.roofSnowLoad?.toFixed(1) + ' psf');
  }
  if (result.attachment) {
    console.log('Safety Factor:   ' + result.attachment.safetyFactor?.toFixed(2));
    console.log('Max Spacing:     ' + result.attachment.maxAllowedSpacing + '"');
  }
  if (result.rafterAnalysis) {
    console.log('Framing Type:    ' + result.rafterAnalysis.framingType);
    console.log('Utilization:     ' + (result.rafterAnalysis.overallUtilization * 100).toFixed(0) + '%');
  }
  if (result.mountLayout) {
    console.log('Mount Count:     ' + result.mountLayout.mountCount);
    console.log('Mount Spacing:   ' + result.mountLayout.mountSpacing + '"');
  }
  if (result.rackingBOM) {
    console.log('\\nRACKING BOM:');
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
    console.log('\\nBALLAST ANALYSIS:');
    console.log('  Blocks/Module: ' + ba.blocksPerModule);
    console.log('  Total Blocks:  ' + ba.totalBallastBlocks);
    console.log('  Total Weight:  ' + ba.ballastWeightLbs?.toLocaleString() + ' lbs');
    console.log('  Roof Load:     ' + ba.roofLoadPsf?.toFixed(1) + ' psf');
    console.log('  Passes:        ' + (ba.passes ? 'YES' : 'NO'));
  }
  if (result.groundMountAnalysis) {
    const gm = result.groundMountAnalysis;
    console.log('\\nGROUND MOUNT ANALYSIS:');
    console.log('  Pile Count:    ' + gm.pileCount);
    console.log('  Pile Spacing:  ' + gm.pileSpacingFt + ' ft');
    console.log('  Embedment:     ' + gm.pileEmbedmentFt + ' ft');
    console.log('  Uplift/Pile:   ' + gm.upliftPerPileLbs?.toFixed(0) + ' lbs');
    console.log('  Downward/Pile: ' + gm.downwardPerPileLbs?.toFixed(0) + ' lbs');
    console.log('  SF Uplift:     ' + gm.safetyFactorUplift?.toFixed(2));
    console.log('  SF Downward:   ' + gm.safetyFactorDownward?.toFixed(2));
    console.log('  Passes:        ' + (gm.passes ? 'YES' : 'NO'));
  }
  if (result.errors?.length > 0) {
    console.log('\\nERRORS:');
    result.errors.forEach((e: any) => console.log('  [' + e.severity + '] ' + e.code + ': ' + e.message));
  }
  if (result.warnings?.length > 0) {
    console.log('\\nWARNINGS:');
    result.warnings.forEach((w: any) => console.log('  [' + w.severity + '] ' + w.code + ': ' + w.message));
  }
  
  const passed = result.status === 'PASS' || result.status === 'WARNING';
  console.log('\\n' + (passed ? 'PASS' : 'FAIL') + ': ' + name);
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

console.log('\\n' + '='.repeat(60));
console.log(allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
`;

writeFileSync('/workspace/test_v25_engine.ts', tsTest);
console.log('Test file written. Running with ts-node...');

try {
  const output = execSync('cd /workspace && npx ts-node --project tsconfig.json test_v25_engine.ts 2>&1', {
    timeout: 60000,
    encoding: 'utf8'
  });
  console.log(output);
} catch (err) {
  console.log('ts-node failed, trying tsx...');
  try {
    const output2 = execSync('cd /workspace && npx tsx test_v25_engine.ts 2>&1', {
      timeout: 60000,
      encoding: 'utf8'
    });
    console.log(output2);
  } catch (err2) {
    console.log('tsx also failed:', err2.message);
    console.log(err2.stdout?.toString() || '');
  }
}