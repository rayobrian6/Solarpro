/**
 * V25.1 Validation Test Cases
 * Tests the structural engine V4 with 3 scenarios:
 * 1. Residential: 10 panels, asphalt shingles, 2x6 @ 24" OC, 115mph, 20psf → PASS
 * 2. Commercial: 200 panels, ballasted flat roof, Exposure B → ballast weight + layout
 * 3. Ground Mount: 50 panels, dual-post ground mount → pile spacing + foundation loads
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// We'll test by calling the API endpoint directly
// First start the dev server, then test

const BASE_URL = 'http://localhost:3008';

async function runTest(name, payload) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(60));
  
  try {
    const res = await fetch(`${BASE_URL}/api/engineering/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!res.ok) {
      console.log(`❌ HTTP ${res.status}: ${res.statusText}`);
      const text = await res.text();
      console.log(text.slice(0, 500));
      return null;
    }
    
    const data = await res.json();
    return data;
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
    return null;
  }
}

function printResult(data, testName) {
  if (!data) return;
  
  const overall = data.compliance?.overallStatus ?? data.overallStatus ?? '?';
  const electrical = data.compliance?.electrical?.status ?? '?';
  const structural = data.compliance?.structural?.status ?? '?';
  
  console.log(`\n📊 RESULTS:`);
  console.log(`  Overall Status:    ${overall}`);
  console.log(`  Electrical Status: ${electrical}`);
  console.log(`  Structural Status: ${structural}`);
  
  const s = data.compliance?.structural;
  if (s) {
    console.log(`\n🏗️  STRUCTURAL DETAILS:`);
    if (s.wind) {
      console.log(`  Wind Speed:        ${s.wind.designWindSpeed} mph`);
      console.log(`  Exposure Cat:      ${s.wind.exposureCategory}`);
      console.log(`  Velocity Pressure: ${s.wind.velocityPressure?.toFixed(2)} psf`);
      console.log(`  Net Uplift Press:  ${s.wind.netUpliftPressure?.toFixed(2)} psf`);
      console.log(`  Uplift/Attach:     ${s.wind.upliftPerAttachment?.toFixed(1)} lbs`);
    }
    if (s.snow) {
      console.log(`  Ground Snow:       ${s.snow.groundSnowLoad} psf`);
      console.log(`  Roof Snow:         ${s.snow.roofSnowLoad?.toFixed(1)} psf`);
    }
    if (s.attachment) {
      console.log(`  Safety Factor:     ${s.attachment.safetyFactor?.toFixed(2)}`);
      console.log(`  Max Spacing:       ${s.attachment.maxAllowedSpacing}"`);
    }
    if (s.rafterAnalysis) {
      console.log(`  Framing Type:      ${s.rafterAnalysis.framingType}`);
      console.log(`  Utilization:       ${(s.rafterAnalysis.overallUtilization * 100).toFixed(0)}%`);
    }
    if (s.mountLayout) {
      console.log(`  Mount Count:       ${s.mountLayout.mountCount}`);
      console.log(`  Mount Spacing:     ${s.mountLayout.mountSpacing}"`);
    }
    if (s.rackingBOM) {
      console.log(`\n📦 RACKING BOM:`);
      if (s.rackingBOM.mounts) console.log(`  Mounts:            ${s.rackingBOM.mounts.qty}`);
      if (s.rackingBOM.rails) console.log(`  Rails:             ${s.rackingBOM.rails.qty} ${s.rackingBOM.rails.unit}`);
      if (s.rackingBOM.lFeet) console.log(`  L-Feet:            ${s.rackingBOM.lFeet.qty}`);
      if (s.rackingBOM.midClamps) console.log(`  Mid Clamps:        ${s.rackingBOM.midClamps.qty}`);
      if (s.rackingBOM.endClamps) console.log(`  End Clamps:        ${s.rackingBOM.endClamps.qty}`);
      if (s.rackingBOM.ballastBlocks) console.log(`  Ballast Blocks:    ${s.rackingBOM.ballastBlocks.qty} (${s.rackingBOM.ballastBlocks.weightLbs?.toLocaleString()} lbs)`);
      if (s.rackingBOM.piles) console.log(`  Piles:             ${s.rackingBOM.piles.qty}`);
    }
    // V4 specific
    if ((s).ballastAnalysis) {
      const ba = (s).ballastAnalysis;
      console.log(`\n🏢 BALLAST ANALYSIS:`);
      console.log(`  Blocks/Module:     ${ba.blocksPerModule}`);
      console.log(`  Total Blocks:      ${ba.totalBallastBlocks}`);
      console.log(`  Total Weight:      ${ba.ballastWeightLbs?.toLocaleString()} lbs`);
      console.log(`  Roof Load:         ${ba.roofLoadPsf?.toFixed(1)} psf`);
      console.log(`  Passes:            ${ba.passes ? '✅' : '❌'}`);
    }
    if ((s).groundMountAnalysis) {
      const gm = (s).groundMountAnalysis;
      console.log(`\n🌿 GROUND MOUNT ANALYSIS:`);
      console.log(`  Pile Count:        ${gm.pileCount}`);
      console.log(`  Pile Spacing:      ${gm.pileSpacingFt} ft`);
      console.log(`  Embedment:         ${gm.pileEmbedmentFt} ft`);
      console.log(`  Uplift/Pile:       ${gm.upliftPerPileLbs?.toFixed(0)} lbs`);
      console.log(`  Downward/Pile:     ${gm.downwardPerPileLbs?.toFixed(0)} lbs`);
      console.log(`  SF Uplift:         ${gm.safetyFactorUplift?.toFixed(2)}`);
      console.log(`  SF Downward:       ${gm.safetyFactorDownward?.toFixed(2)}`);
      console.log(`  Passes:            ${gm.passes ? '✅' : '❌'}`);
    }
    if (s.errors?.length > 0) {
      console.log(`\n⚠️  ERRORS:`);
      s.errors.forEach(e => console.log(`  [${e.severity}] ${e.code}: ${e.message}`));
    }
    if (s.warnings?.length > 0) {
      console.log(`\n⚠️  WARNINGS:`);
      s.warnings.forEach(w => console.log(`  [${w.severity}] ${w.code}: ${w.message}`));
    }
  }
  
  // Check overall pass/fail
  const passed = overall === 'PASS' || overall === 'WARNING';
  console.log(`\n${passed ? '✅' : '❌'} TEST ${testName}: ${overall}`);
}

async function main() {
  console.log('🧪 V25.1 Structural Engine Validation Tests');
  console.log('Testing against: ' + BASE_URL);
  
  // ── TEST 1: Residential ──────────────────────────────────────────────────
  const test1 = await runTest(
    'Test 1: Residential — 10 panels, asphalt shingles, 2×6 @ 24" OC, 115mph, 20psf',
    {
      state: 'CO',
      structural: {
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
      }
    }
  );
  printResult(test1, 'RESIDENTIAL');
  
  // ── TEST 2: Commercial Ballasted ─────────────────────────────────────────
  const test2 = await runTest(
    'Test 2: Commercial — 200 panels, ballasted flat roof, Exposure B',
    {
      state: 'CA',
      structural: {
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
      }
    }
  );
  printResult(test2, 'COMMERCIAL BALLASTED');
  
  // ── TEST 3: Ground Mount ─────────────────────────────────────────────────
  const test3 = await runTest(
    'Test 3: Ground Mount — 50 panels, dual-post driven pile',
    {
      state: 'TX',
      structural: {
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
      }
    }
  );
  printResult(test3, 'GROUND MOUNT');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ All validation tests complete');
}

main().catch(console.error);