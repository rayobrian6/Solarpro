/**
 * Electrical Compliance Audit — Verification Test
 * Test case: 34 modules × 400W, IQ8+ microinverters (1 module/device)
 * Expected: DC=13.6kW, AC≈9.86-10.03kW, DC/AC≈1.35
 */

import { runElectricalCalc } from './lib/electrical-calc.js';

// IQ8+ specs: 295W AC output per unit, 1.21A AC output current
const IQ8_PLUS_AC_OUTPUT_W = 295;
const IQ8_PLUS_AC_OUTPUT_KW = IQ8_PLUS_AC_OUTPUT_W / 1000; // 0.295 kW
const IQ8_PLUS_AC_CURRENT = 1.21; // A

const MODULE_COUNT = 34;
const MODULE_WATTS = 400;
const MODULES_PER_DEVICE = 1;
const DEVICE_COUNT = Math.ceil(MODULE_COUNT / MODULES_PER_DEVICE); // 34

// Use 300A main panel — required for 34× IQ8+ (41.8A × 1.25 = 52.3A → 60A breaker)
// NEC 705.12: 300A × 20% = 60A max backfeed → 60A breaker passes on 300A panel
const input = {
  inverters: [{
    type: 'micro',
    modulesPerDevice: MODULES_PER_DEVICE,
    deviceCount: DEVICE_COUNT,
    acOutputKw: IQ8_PLUS_AC_OUTPUT_KW,   // per-device kW
    acOutputCurrentMax: IQ8_PLUS_AC_CURRENT,
    maxDcVoltage: 60,
    mpptVoltageMin: 16,
    mpptVoltageMax: 60,
    maxInputCurrentPerMppt: 14,
    strings: [{
      panelCount: MODULE_COUNT,
      panelVoc: 41.6,
      panelIsc: 12.26,
      panelImp: 11.59,
      panelVmp: 34.5,
      panelWatts: MODULE_WATTS,
      tempCoeffVoc: -0.26,
      tempCoeffIsc: 0.05,
      maxSeriesFuseRating: 20,
      wireGauge: '#10 AWG',
      wireLength: 50,
      conduitType: 'EMT',
    }],
  }],
  mainPanelAmps: 300,   // 300A panel required for 34× IQ8+ (NEC 705.12: 60A ≤ 300A×20%=60A)
  systemVoltage: 240,
  designTempMin: -10,
  designTempMax: 40,
  rooftopTempAdder: 30,
  wireGauge: '#10 AWG',
  wireLength: 50,
  conduitType: 'EMT',
  rapidShutdown: true,
  acDisconnect: true,
  dcDisconnect: true,   // Microinverters have integrated DC disconnect per NEC 690.15
  necVersion: '2023',
};

let passed = 0;
let failed = 0;

function check(label, actual, expected, op = '==', tolerance = 0.01) {
  let ok = false;
  if (op === '==') ok = Math.abs(actual - expected) <= tolerance;
  else if (op === '>=') ok = actual >= expected;
  else if (op === '<=') ok = actual <= expected;
  else if (op === 'range') ok = actual >= expected[0] && actual <= expected[1];

  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${status}  ${label}`);
  console.log(`         actual=${actual?.toFixed ? actual.toFixed(4) : actual}  expected=${JSON.stringify(expected)}`);
  if (ok) passed++; else failed++;
}

console.log('\n=== Electrical Compliance Audit — Microinverter Test ===\n');
console.log(`Input: ${MODULE_COUNT} modules × ${MODULE_WATTS}W = ${MODULE_COUNT * MODULE_WATTS / 1000} kW DC`);
console.log(`       ${DEVICE_COUNT} × IQ8+ @ ${IQ8_PLUS_AC_OUTPUT_W}W = ${(DEVICE_COUNT * IQ8_PLUS_AC_OUTPUT_W / 1000).toFixed(3)} kW AC`);
console.log(`       Expected DC/AC = ${(MODULE_COUNT * MODULE_WATTS / (DEVICE_COUNT * IQ8_PLUS_AC_OUTPUT_W)).toFixed(3)}\n`);

const result = runElectricalCalc(input);

console.log('--- Summary ---');
const s = result.summary;
console.log(`  totalDcKw  = ${s.totalDcKw}`);
console.log(`  totalAcKw  = ${s.totalAcKw}`);
console.log(`  dcAcRatio  = ${s.dcAcRatio}`);
console.log(`  totalPanels = ${s.totalPanels}`);
console.log('');

console.log('--- Checks ---');
check('DC System Size = 13.6 kW (34 × 400W)', s.totalDcKw, 13.6, '==', 0.001);
check('AC Capacity in range [9.86, 10.03] kW (34 × 295W)', s.totalAcKw, [9.86, 10.03], 'range');
check('DC/AC Ratio in range [1.33, 1.37]', s.dcAcRatio, [1.33, 1.37], 'range');
check('Total panels = 34', s.totalPanels, 34, '==', 0);
check('Status is not FAIL', result.status !== 'FAIL', true);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);