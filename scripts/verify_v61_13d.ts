/**
 * v61.13d Verification Script
 *
 * Confirms the hybrid DC/AC floor fix works correctly for EcoFlow OCEAN Pro.
 * Run: npx ts-node --project tsconfig.json scripts/verify_v61_13d.ts
 */

import { sizeSystemFromBrand, MIN_DC_AC_RATIO, HYBRID_MIN_DC_AC_RATIO } from '../lib/system/sizingEngine';

function ratio(dcKw: number, acKw: number, qty: number): number {
  return dcKw / (acKw * qty);
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(' v61.13d Verification — EcoFlow Hybrid DC/AC Floor Fix');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Constants:');
console.log(`  MIN_DC_AC_RATIO (string/optimizer floor) : ${MIN_DC_AC_RATIO}`);
console.log(`  HYBRID_MIN_DC_AC_RATIO (hybrid ESS floor): ${HYBRID_MIN_DC_AC_RATIO}`);
console.log('');

// Manual candidate analysis
const DC = 17.6; // 44 x 400W
console.log(`Candidate analysis for ${DC} kW DC array (44 x 400W, Granite City IL):`);
const candidates = [
  { label: '1x 11kW (old pick)',     acKw: 11.5, qty: 1 },
  { label: '2x 11kW (new candidate)',acKw: 11.5, qty: 2 },
  { label: '1x 24kW',               acKw: 24.0, qty: 1 },
];
for (const c of candidates) {
  const r = ratio(DC, c.acKw, c.qty);
  const aboveStr = r >= MIN_DC_AC_RATIO          ? 'PASS' : 'FAIL';
  const aboveHyb = r >= HYBRID_MIN_DC_AC_RATIO   ? 'PASS' : 'FAIL';
  const inWin    = r >= 1.20 && r <= 1.40        ? 'YES'  : 'NO';
  const dist     = Math.abs(r - 1.25);
  console.log(`  ${c.label.padEnd(30)} ratio=${r.toFixed(3)}  str-floor=${aboveStr}  hyb-floor=${aboveHyb}  in-window=${inWin}  dist=${dist.toFixed(3)}`);
}

console.log('');
console.log('Expected: 1x 11kW wins (dist 0.280 beats 2x 11kW dist 0.485)');
console.log('With fix: 2x 11kW is now a VALID candidate (hyb-floor PASS)');
console.log('          but 1x 11kW still wins on proximity to 1.25 target');
console.log('');

// Engine tests
console.log('═══════════════════════════════════════════════════════════════');
console.log(' Engine results via sizeSystemFromBrand()');
console.log('═══════════════════════════════════════════════════════════════\n');

function printResult(label: string, dcKw: number, result: ReturnType<typeof sizeSystemFromBrand>): void {
  console.log(label);
  if (result.inverterModels.length > 0) {
    const inv = result.inverterModels[0];
    const r = dcKw / (inv.acKw * inv.qty);
    console.log(`  -> ${inv.qty}x ${inv.equipmentDbId} (${inv.acKw} kW AC each)`);
    console.log(`  -> DC/AC ratio: ${r.toFixed(3)} | inverterCount: ${result.inverterCount}`);
    const warningCodes = result.warnings.map((w: { code: string }) => w.code).join(', ') || 'none';
    console.log(`  -> Warnings: ${warningCodes}`);
  } else {
    console.log('  -> ERROR: No inverters returned');
  }
  console.log('');
}

// Test 1: 44 panels / 17.6 kW — user's original scenario
printResult(
  'Test 1: 44p x 400W (17.6 kW DC) — Granite City IL. Expect 1x 11kW ratio~1.53',
  17.6,
  sizeSystemFromBrand({
    panelCount: 44, panelWattage: 400,
    panelVoc: 75.6, panelTempCoeffVoc: -0.0027, designTempMin: -16,
    selectedBrand: 'ecoflow', systemType: 'roof',
  }),
);

// Test 2: 50 panels / 20 kW — 1x 11kW=1.739 (above brand max 1.70), 2x 11kW=0.870 (closer to 1.25)
printResult(
  'Test 2: 50p x 400W (20.0 kW DC). Expect 2x 11kW ratio~0.870 (closer to 1.25 than 1.739)',
  20.0,
  sizeSystemFromBrand({
    panelCount: 50, panelWattage: 400,
    panelVoc: 75.6, panelTempCoeffVoc: -0.0027, designTempMin: -16,
    selectedBrand: 'ecoflow', systemType: 'roof',
  }),
);

// Test 3: 60 panels / 24 kW — exactly at 1x 24kW threshold (ratio=1.000)
printResult(
  'Test 3: 60p x 400W (24.0 kW DC). Expect 1x 24kW ratio=1.000',
  24.0,
  sizeSystemFromBrand({
    panelCount: 60, panelWattage: 400,
    panelVoc: 75.6, panelTempCoeffVoc: -0.0027, designTempMin: -16,
    selectedBrand: 'ecoflow', systemType: 'roof',
  }),
);

// Test 4: 36 panels / 14.4 kW — sweet spot (1x 11kW ratio=1.252)
printResult(
  'Test 4: 36p x 400W (14.4 kW DC). Expect 1x 11kW ratio~1.252 (preferred window)',
  14.4,
  sizeSystemFromBrand({
    panelCount: 36, panelWattage: 400,
    selectedBrand: 'ecoflow', systemType: 'roof',
  }),
);

// Test 5: 20 panels / 8 kW — small array, should not trigger undersized warning
printResult(
  'Test 5: 20p x 400W (8.0 kW DC). Expect 1x 11kW (above hybrid floor 0.75)',
  8.0,
  sizeSystemFromBrand({
    panelCount: 20, panelWattage: 400,
    selectedBrand: 'ecoflow', systemType: 'roof',
  }),
);

console.log('═══════════════════════════════════════════════════════════════');
console.log(' All tests complete');
console.log('═══════════════════════════════════════════════════════════════\n');