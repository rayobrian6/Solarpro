// ============================================================
// Utility / AHJ Interconnection Rules Engine — Verification Test
// SolarPro v3.1
// ============================================================

import { getRecommendedInterconnection, getUtilityRules, getUtilitiesByState, getAllUtilityNames } from './lib/utility-rules.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ PASS  ${label}`);
    console.log(`         actual=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL  ${label}`);
    console.log(`         actual=${JSON.stringify(actual)}`);
    console.log(`         expected=${JSON.stringify(expected)}`);
    failed++;
  }
}

console.log('\n=== Utility / AHJ Interconnection Rules Engine — Verification Test ===\n');

// ── Test Case 1: Ameren, 200A bus, 200A main, 60A solar ──────
console.log('--- Test 1: Ameren | 200A bus | 200A main | 60A solar ---');
console.log('  Expected: 120% rule FAIL, Recommendation: Supply-Side Tap\n');

const rec1 = getRecommendedInterconnection(
  { state: 'IL', utilityName: 'Ameren', ahjName: 'City of Springfield', necVersion: '2020' },
  { busRating: 200, mainBreaker: 200, solarBreakerRequired: 60, systemDcKw: 13.6, systemAcKw: 10.03 }
);

console.log(`  Utility: ${rec1.utilityName}`);
console.log(`  Recommended: ${rec1.recommendedMethodLabel}`);
console.log(`  Load-side passes: ${rec1.loadSidePasses}`);
console.log(`  Reason: ${rec1.reason}\n`);

check('Test 1: Ameren utility loaded correctly', rec1.utilityName, 'Ameren');
check('Test 1: 120% rule fails (60A > 40A Ameren max)', rec1.loadSidePasses, false);
check('Test 1: Recommended method = SUPPLY_SIDE_TAP', rec1.recommendedMethod, 'SUPPLY_SIDE_TAP');
check('Test 1: Recommended label correct', rec1.recommendedMethodLabel, 'Supply-Side Tap (Line-Side)');
check('Test 1: Line-side tap allowed by Ameren', rec1.utilityAllowsLineSideTap, true);
check('Test 1: Visible disconnect required', rec1.requiresVisibleDisconnect, true);
check('Test 1: Net metering available', rec1.netMeteringAvailable, true);
check('Test 1: Net metering program = Net Metering 2.0', rec1.netMeteringProgram, 'Net Metering 2.0');

// ── Test Case 2: ComEd, 200A bus, 200A main, 40A solar ──────
console.log('\n--- Test 2: ComEd | 200A bus | 200A main | 40A solar ---');
console.log('  Expected: 120% rule PASS, Recommendation: Load-Side Breaker\n');

const rec2 = getRecommendedInterconnection(
  { state: 'IL', utilityName: 'ComEd', ahjName: 'City of Chicago', necVersion: '2020' },
  { busRating: 200, mainBreaker: 200, solarBreakerRequired: 40, systemDcKw: 9.0, systemAcKw: 6.6 }
);

console.log(`  Utility: ${rec2.utilityName}`);
console.log(`  Recommended: ${rec2.recommendedMethodLabel}`);
console.log(`  Load-side passes: ${rec2.loadSidePasses}`);
console.log(`  Reason: ${rec2.reason}\n`);

check('Test 2: ComEd utility loaded correctly', rec2.utilityName, 'ComEd');
check('Test 2: 120% rule passes (40A ≤ 40A NEC max, ≤ 60A ComEd max)', rec2.loadSidePasses, true);
check('Test 2: Recommended method = LOAD_SIDE', rec2.recommendedMethod, 'LOAD_SIDE');
check('Test 2: Recommended label correct', rec2.recommendedMethodLabel, 'Load-Side Breaker (120% Rule)');
check('Test 2: Net metering available', rec2.netMeteringAvailable, true);

// ── Test Case 3: ComEd, 200A bus, 200A main, 60A solar ──────
console.log('\n--- Test 3: ComEd | 200A bus | 200A main | 60A solar ---');
console.log('  Expected: 120% rule FAIL (60A > 40A NEC max), Recommendation: Supply-Side Tap\n');

const rec3 = getRecommendedInterconnection(
  { state: 'IL', utilityName: 'ComEd', ahjName: 'City of Chicago', necVersion: '2020' },
  { busRating: 200, mainBreaker: 200, solarBreakerRequired: 60, systemDcKw: 13.6, systemAcKw: 10.03 }
);

check('Test 3: ComEd 60A solar — 120% rule fails', rec3.loadSidePasses, false);
check('Test 3: ComEd allows line-side tap', rec3.utilityAllowsLineSideTap, true);
check('Test 3: Recommended = SUPPLY_SIDE_TAP', rec3.recommendedMethod, 'SUPPLY_SIDE_TAP');

// ── Test Case 4: PG&E, smart inverter requirement ──────
console.log('\n--- Test 4: PG&E | 200A bus | 200A main | 40A solar ---');

const rec4 = getRecommendedInterconnection(
  { state: 'CA', utilityName: 'PG&E', ahjName: 'City of San Francisco', necVersion: '2020' },
  { busRating: 200, mainBreaker: 200, solarBreakerRequired: 40, systemDcKw: 9.0, systemAcKw: 6.6 }
);

check('Test 4: PG&E utility loaded', rec4.utilityName, 'PG&E');
check('Test 4: Smart inverter required for PG&E', rec4.requiresSmartInverter, true);
check('Test 4: NEM-3 program', rec4.netMeteringProgram, 'NEM-3 (Net Billing Tariff)');
check('Test 4: Load-side passes (40A ≤ 40A NEC max)', rec4.loadSidePasses, true);

// ── Test Case 5: Utility lookup by name variations ──────
console.log('\n--- Test 5: Utility name lookup variations ---');

const u1 = getUtilityRules('ameren');
const u2 = getUtilityRules('Ameren');
const u3 = getUtilityRules('AMEREN');
const u4 = getUtilityRules('comed');
const u5 = getUtilityRules('ComEd');
const u6 = getUtilityRules('unknown-utility-xyz');

check('Test 5: ameren (lowercase) resolves', u1.name, 'Ameren');
check('Test 5: Ameren (title case) resolves', u2.name, 'Ameren');
check('Test 5: AMEREN (uppercase) resolves', u3.name, 'Ameren');
check('Test 5: comed resolves', u4.name, 'ComEd');
check('Test 5: ComEd resolves', u5.name, 'ComEd');
check('Test 5: Unknown utility falls back to Generic', u6.name, 'Generic Utility');

// ── Test Case 6: getUtilitiesByState ──────
console.log('\n--- Test 6: getUtilitiesByState ---');

const ilUtils = getUtilitiesByState('IL');
const caUtils = getUtilitiesByState('CA');

check('Test 6: IL has 2 utilities (Ameren + ComEd)', ilUtils.length, 2);
check('Test 6: CA has 2 utilities (PG&E + SCE)', caUtils.length, 2);

// ── Summary ──────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);