/**
 * Direct test for Sol-Ark 8K-2P + 36 Q.PEAK panels fix.
 * v60.2: The ratio-regression guard should keep 12K-2P×1 (ratio=1.20)
 * and NOT substitute 2×8K-2P (ratio=0.90).
 */

import { sizeSystemFromBrand } from './lib/system/sizingEngine';

// 36 × Q.PEAK 400W = 14.4 kW DC
// Panel: voc=49.6, isc=10.18, tempCoeffVoc=-0.27
// Sol-Ark maxDcVoltage=500V → at -10°C, max 9 panels/string
const result = sizeSystemFromBrand({
  systemType: 'roof',
  panelCount: 36,
  panelWattage: 400,
  panelVoc: 49.6,
  panelVmp: 41.8,
  panelIsc: 10.18,
  panelTempCoeffVoc: -0.27,
  designTempMin: -10,
  panelId: 'qcells-q-peak-duo-400',
  selectedInverterId: 'solark-8k-2p',   // User selected 8K-2P
  selectedBrand: 'sol-ark',
});

console.log('\n=== SIZING RESULT ===');
console.log('inverterModels:', JSON.stringify(result.inverterModels, null, 2));
console.log('\nWarnings:', JSON.stringify(result.warnings, null, 2));

const inverters = result.inverterModels ?? [];
if (!inverters || inverters.length === 0) {
  console.error('\n❌ FAIL: No inverters returned');
  process.exit(1);
}

const inv = inverters[0];
const qty = inv?.qty ?? 1;
const totalAc = (inv?.acKw ?? 0) * qty;
const totalDc = 36 * 400 / 1000; // 14.4 kW
const ratio = totalDc / totalAc;

console.log('\n=== ANALYSIS ===');
console.log(`Inverter: ${inv?.equipmentDbId} × ${qty}`);
console.log(`Total AC: ${totalAc} kW`);
console.log(`Total DC: ${totalDc} kW`);
console.log(`DC/AC Ratio: ${ratio.toFixed(3)}`);

const warnings = result.warnings ?? [];
const hasRatioError = warnings.some((w: any) => w.code === 'DC_AC_RATIO_AC_EXCEEDS_DC');
const hasFeasibilityBlockingWarning = warnings.some(
  (w: any) => w.code === 'FEASIBILITY_CHOSEN_INFEASIBLE' && w.severity === 'warning'
);
const hasFeasibilityInfoOnly = warnings.some(
  (w: any) => w.code === 'FEASIBILITY_CHOSEN_INFEASIBLE' && w.severity === 'info'
);

console.log('\n=== PASS/FAIL ===');
let pass = true;

// CRITICAL CHECK 1: Must NOT be 2×8K-2P (the broken result before fix)
if (inv?.equipmentDbId === 'solark-8k-2p' && qty === 2) {
  console.error('❌ FAIL: Still getting 2×8K-2P (ratio=0.90) — ratio-regression guard NOT working');
  pass = false;
} else {
  console.log(`✅ PASS: Not 2×8K-2P — got ${inv?.equipmentDbId}×${qty}`);
}

// CHECK 2: Ideal result is 12K-2P×1 (ratio=1.20)
if (inv?.equipmentDbId === 'solark-12k-2p' && qty === 1) {
  console.log('✅ PASS: Got 12K-2P×1 (ratio=1.20) — ideal result');
} else {
  console.log(`ℹ️  INFO: Got ${inv?.equipmentDbId}×${qty} instead of 12K-2P×1`);
}

// CRITICAL CHECK 3: No DC/AC ratio error
if (hasRatioError) {
  console.error('❌ FAIL: DC_AC_RATIO_AC_EXCEEDS_DC error present');
  pass = false;
} else {
  console.log('✅ PASS: No DC_AC_RATIO_AC_EXCEEDS_DC error');
}

// CRITICAL CHECK 4: Ratio ≥ 1.0
if (ratio >= 1.0) {
  console.log(`✅ PASS: DC/AC ratio ${ratio.toFixed(3)} ≥ 1.0 (MIN_DC_AC_RATIO)`);
} else {
  console.error(`❌ FAIL: DC/AC ratio ${ratio.toFixed(3)} < 1.0 (below MIN_DC_AC_RATIO)`);
  pass = false;
}

// CHECK 5: Feasibility warning should be info-only (not blocking) if present
if (hasFeasibilityBlockingWarning) {
  console.error('❌ FAIL: FEASIBILITY_CHOSEN_INFEASIBLE is severity=warning (blocking)');
  pass = false;
} else if (hasFeasibilityInfoOnly) {
  console.log('✅ PASS: FEASIBILITY_CHOSEN_INFEASIBLE is severity=info (non-blocking advisory)');
} else {
  console.log('✅ PASS: No FEASIBILITY_CHOSEN_INFEASIBLE warning');
}

console.log('\n=== FINAL RESULT ===');
if (pass) {
  console.log('✅ ALL CHECKS PASSED — Sol-Ark DC ratio fix is working correctly in v60.2');
  process.exit(0);
} else {
  console.error('❌ SOME CHECKS FAILED — Fix still needed');
  process.exit(1);
}