/**
 * Interconnection Method Engine — Verification Test
 * Test case: 34 modules × 400W, IQ8+ microinverters
 * Solar breaker = 60A, Bus = 200A, Main = 200A
 *
 * Expected:
 *   LOAD_SIDE          → FAIL  (60A > 40A max on 200A bus)
 *   SUPPLY_SIDE_TAP    → PASS  (120% rule not applicable)
 *   MAIN_BREAKER_DERATE → PASS (175A main required)
 *   PANEL_UPGRADE(225A) → PASS (70A max allowed)
 */

import { runElectricalCalc } from './lib/electrical-calc.js';

const BASE_INPUT = {
  inverters: [{
    type: 'micro',
    modulesPerDevice: 1,
    deviceCount: 34,
    acOutputKw: 0.295,
    acOutputCurrentMax: 1.21,
    maxDcVoltage: 60,
    mpptVoltageMin: 16,
    mpptVoltageMax: 60,
    maxInputCurrentPerMppt: 14,
    strings: [{
      panelCount: 34,
      panelVoc: 41.6,
      panelIsc: 12.26,
      panelImp: 11.59,
      panelVmp: 34.5,
      panelWatts: 400,
      tempCoeffVoc: -0.26,
      tempCoeffIsc: 0.05,
      maxSeriesFuseRating: 20,
      wireGauge: '#10 AWG',
      wireLength: 50,
      conduitType: 'EMT',
    }],
  }],
  mainPanelAmps: 200,
  systemVoltage: 240,
  designTempMin: -10,
  designTempMax: 40,
  rooftopTempAdder: 30,
  wireGauge: '#10 AWG',
  wireLength: 50,
  conduitType: 'EMT',
  rapidShutdown: true,
  acDisconnect: true,
  dcDisconnect: true,
  necVersion: '2023',
};

let passed = 0;
let failed = 0;

function check(label, actual, expected, op = '==') {
  let ok = false;
  if (op === '==') ok = actual === expected;
  else if (op === '!=') ok = actual !== expected;
  else if (op === '>=') ok = actual >= expected;
  else if (op === '<=') ok = actual <= expected;
  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${status}  ${label}`);
  console.log(`         actual=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
  if (ok) passed++; else failed++;
}

console.log('\n=== Interconnection Method Engine — Verification Test ===\n');
console.log('System: 34 × 400W IQ8+, 60A solar breaker, 200A bus, 200A main\n');

// ── Test 1: LOAD_SIDE → FAIL ──────────────────────────────────────────────
console.log('--- Test 1: LOAD_SIDE (200A bus, 200A main) ---');
const r1 = runElectricalCalc({ ...BASE_INPUT, interconnection: { method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 } });
const ic1 = r1.interconnection;
console.log(`  Method: ${ic1.methodLabel}`);
console.log(`  Solar breaker: ${ic1.solarBreakerRequired}A, Max allowed: ${ic1.maxAllowedSolarBreaker}A`);
console.log(`  Message: ${ic1.message}`);
check('LOAD_SIDE passes=false (60A > 40A max)', ic1.passes, false);
check('LOAD_SIDE maxAllowedSolarBreaker=40A', ic1.maxAllowedSolarBreaker, 40);
check('LOAD_SIDE solarBreakerRequired=60A', ic1.solarBreakerRequired, 60);
check('LOAD_SIDE has alternatives', (ic1.alternatives?.length ?? 0) >= 2, true);
check('LOAD_SIDE alternative[0] = SUPPLY_SIDE_TAP', ic1.alternatives?.[0]?.method, 'SUPPLY_SIDE_TAP');
check('LOAD_SIDE alternative[1] = MAIN_BREAKER_DERATE', ic1.alternatives?.[1]?.method, 'MAIN_BREAKER_DERATE');
console.log('');

// ── Test 2: SUPPLY_SIDE_TAP → PASS ───────────────────────────────────────
console.log('--- Test 2: SUPPLY_SIDE_TAP ---');
const r2 = runElectricalCalc({ ...BASE_INPUT, interconnection: { method: 'SUPPLY_SIDE_TAP', busRating: 200, mainBreaker: 200 } });
const ic2 = r2.interconnection;
console.log(`  Method: ${ic2.methodLabel}`);
console.log(`  Message: ${ic2.message}`);
check('SUPPLY_SIDE_TAP passes=true', ic2.passes, true);
check('SUPPLY_SIDE_TAP necReference=NEC 705.11', ic2.necReference, 'NEC 705.11');
check('SUPPLY_SIDE_TAP status not FAIL', r2.status !== 'FAIL', true);
console.log('');

// ── Test 3: MAIN_BREAKER_DERATE → PASS (175A main required) ──────────────
console.log('--- Test 3: MAIN_BREAKER_DERATE (200A bus, 60A solar) ---');
const r3 = runElectricalCalc({ ...BASE_INPUT, interconnection: { method: 'MAIN_BREAKER_DERATE', busRating: 200, mainBreaker: 200 } });
const ic3 = r3.interconnection;
console.log(`  Method: ${ic3.methodLabel}`);
console.log(`  maxMainBreakerAllowed: ${ic3.maxMainBreakerAllowed}A`);
console.log(`  recommendedMainBreaker: ${ic3.recommendedMainBreaker}A`);
console.log(`  Message: ${ic3.message}`);
check('MAIN_BREAKER_DERATE passes=true (method is valid)', ic3.passes, true);
check('MAIN_BREAKER_DERATE maxMainBreakerAllowed=180A', ic3.maxMainBreakerAllowed, 180);
check('MAIN_BREAKER_DERATE recommendedMainBreaker=175A', ic3.recommendedMainBreaker, 175);
console.log('');

// ── Test 4: PANEL_UPGRADE (225A bus) → PASS ───────────────────────────────
console.log('--- Test 4: PANEL_UPGRADE (225A bus, 200A main) ---');
const r4 = runElectricalCalc({ ...BASE_INPUT, interconnection: { method: 'PANEL_UPGRADE', busRating: 225, mainBreaker: 200 } });
const ic4 = r4.interconnection;
console.log(`  Method: ${ic4.methodLabel}`);
console.log(`  maxAllowedSolarBreaker: ${ic4.maxAllowedSolarBreaker}A`);
console.log(`  Message: ${ic4.message}`);
check('PANEL_UPGRADE passes=true', ic4.passes, true);
check('PANEL_UPGRADE maxAllowedSolarBreaker=70A', ic4.maxAllowedSolarBreaker, 70);
check('PANEL_UPGRADE status not FAIL', r4.status !== 'FAIL', true);
console.log('');

// ── Test 5: DC/AC values unchanged across all methods ─────────────────────
console.log('--- Test 5: DC/AC values consistent across all methods ---');
check('All methods: DC=13.6kW', r1.summary.totalDcKw === 13.6 && r2.summary.totalDcKw === 13.6 && r3.summary.totalDcKw === 13.6 && r4.summary.totalDcKw === 13.6, true);
check('All methods: AC=10.03kW', r1.summary.totalAcKw === 10.03 && r2.summary.totalAcKw === 10.03, true);
check('All methods: DC/AC≈1.356', Math.abs(r1.summary.dcAcRatio - 1.356) < 0.001, true);
console.log('');

// ── Test 6: Existing structural tests regression ───────────────────────────
console.log('--- Test 6: Default (no interconnection) still works ---');
const r6 = runElectricalCalc({ ...BASE_INPUT, mainPanelAmps: 300 }); // 300A panel passes LOAD_SIDE
check('Default LOAD_SIDE with 300A panel passes', r6.interconnection.passes, true);
check('Default method = LOAD_SIDE', r6.interconnection.method, 'LOAD_SIDE');
console.log('');

console.log(`=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);