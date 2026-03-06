// @ts-nocheck
import { renderSLDProfessional } from '../lib/sld-professional-renderer';
import * as fs from 'fs';
import * as path from 'path';

const outDir = path.join(__dirname, '..', 'outputs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const baseInput = {
  projectName: 'Test Project',
  clientName: 'Test Client',
  address: '123 Main St, Anytown CA 90210',
  designer: 'J. Smith',
  drawingDate: '2025-01-01',
  drawingNumber: 'SLD-001',
  revision: 'A',
  topologyType: 'MICROINVERTER',
  totalModules: 34,
  totalStrings: 0,
  panelModel: 'REC400AA',
  panelWatts: 400,
  panelVoc: 49.6,
  panelIsc: 10.5,
  dcWireGauge: '#10 AWG',
  dcConduitType: 'EMT',
  dcOCPD: 20,
  inverterModel: 'IQ8A',
  inverterManufacturer: 'Enphase',
  acOutputKw: 11.56,
  acOutputAmps: 48.2,
  acWireGauge: '#6 AWG',
  acConduitType: 'EMT',
  acOCPD: 60,
  mainPanelAmps: 200,
  backfeedAmps: 60,
  utilityName: 'SCE',
  rapidShutdownIntegrated: true,
  hasProductionMeter: false,
  hasBattery: false,
  batteryModel: '',
  batteryKwh: 0,
  scale: 'NOT TO SCALE',
  acWireLength: 50,
  deviceCount: 34,
  branchWireGauge: '#10 AWG',
  branchConduitSize: '3/4"',
  branchOcpdAmps: 20,
};

// ── Test 1: Load-Side Tap ──────────────────────────────────────────────────
console.log('\n=== TEST 1: LOAD-SIDE TAP ===');
const svgLoad = renderSLDProfessional({ ...baseInput, interconnection: 'LOAD_SIDE' });
const loadChecks = [
  ['Has LOAD SIDE TAP', svgLoad.includes('LOAD SIDE TAP')],
  ['Has NEC 705.12(B)', svgLoad.includes('NEC 705.12(B)')],
  ['Has PV BREAKER', svgLoad.includes('PV BREAKER')],
  ['Has LOAD LUG', svgLoad.includes('LOAD LUG')],
  ['No BACKFED BREAKER', !svgLoad.includes('BACKFED BREAKER')],
  ['No SUPPLY SIDE TAP', !svgLoad.includes('SUPPLY SIDE TAP')],
  ['Has MAIN BUS', svgLoad.includes('MAIN BUS')],
  ['Has neutral bar N', svgLoad.includes('>N<')],
  ['Has ground bar G', svgLoad.includes('>G<')],
];
let p1 = 0, f1 = 0;
for (const [name, result] of loadChecks) {
  console.log(`  ${result ? '✓' : '✗'} ${name}`);
  if (result) p1++; else f1++;
}
console.log(`  ${p1}/${loadChecks.length} passed`);
fs.writeFileSync(path.join(outDir, 'sld-v13-load-side.svg'), svgLoad);

// ── Test 2: Supply-Side Tap ────────────────────────────────────────────────
console.log('\n=== TEST 2: SUPPLY-SIDE TAP ===');
const svgSupply = renderSLDProfessional({ ...baseInput, interconnection: 'SUPPLY_SIDE_TAP' });
const supplyChecks = [
  ['Has SUPPLY SIDE TAP', svgSupply.includes('SUPPLY SIDE TAP')],
  ['Has NEC 705.11', svgSupply.includes('NEC 705.11')],
  ['Has TAP CONNECTOR', svgSupply.includes('TAP')],
  ['No PV BREAKER', !svgSupply.includes('PV BREAKER')],
  ['No LOAD SIDE TAP', !svgSupply.includes('LOAD SIDE TAP')],
  ['Has MAIN BUS', svgSupply.includes('MAIN BUS')],
];
let p2 = 0, f2 = 0;
for (const [name, result] of supplyChecks) {
  console.log(`  ${result ? '✓' : '✗'} ${name}`);
  if (result) p2++; else f2++;
}
console.log(`  ${p2}/${supplyChecks.length} passed`);
fs.writeFileSync(path.join(outDir, 'sld-v13-supply-side.svg'), svgSupply);

// ── Test 3: Backfed Breaker ────────────────────────────────────────────────
console.log('\n=== TEST 3: BACKFED BREAKER ===');
const svgBackfed = renderSLDProfessional({ ...baseInput, interconnection: 'BACKFED_BREAKER' });
const backfedChecks = [
  ['Has BACKFED BREAKER', svgBackfed.includes('BACKFED BREAKER')],
  ['Has NEC 705.12(B)(2)', svgBackfed.includes('NEC 705.12(B)(2)')],
  ['No LOAD SIDE TAP', !svgBackfed.includes('LOAD SIDE TAP')],
  ['No SUPPLY SIDE TAP', !svgBackfed.includes('SUPPLY SIDE TAP')],
  ['Has MAIN BUS', svgBackfed.includes('MAIN BUS')],
  ['Has 120% Rule in calcs', svgBackfed.includes('120% Rule')],
];
let p3 = 0, f3 = 0;
for (const [name, result] of backfedChecks) {
  console.log(`  ${result ? '✓' : '✗'} ${name}`);
  if (result) p3++; else f3++;
}
console.log(`  ${p3}/${backfedChecks.length} passed`);
fs.writeFileSync(path.join(outDir, 'sld-v13-backfed.svg'), svgBackfed);

// ── Test 4: String Inverter ────────────────────────────────────────────────
console.log('\n=== TEST 4: STRING INVERTER ===');
const svgString = renderSLDProfessional({
  ...baseInput,
  topologyType: 'STRING_INVERTER',
  totalStrings: 2,
  panelsPerString: 17,
  interconnection: 'LOAD_SIDE',
  inverterModel: 'SolarEdge SE10000H',
  inverterManufacturer: 'SolarEdge',
});
const stringChecks = [
  ['Has STRING INVERTER', svgString.includes('STRING INVERTER')],
  ['Has DC DISCONNECT', svgString.includes('DC DISCONNECT')],
  ['Has AC DISCONNECT', svgString.includes('AC DISCONNECT')],
  ['Has MAIN SERVICE PANEL', svgString.includes('MAIN SERVICE PANEL')],
  ['Has LOAD SIDE TAP', svgString.includes('LOAD SIDE TAP')],
  ['Has PV ARRAY', svgString.includes('PV ARRAY')],
];
let p4 = 0, f4 = 0;
for (const [name, result] of stringChecks) {
  console.log(`  ${result ? '✓' : '✗'} ${name}`);
  if (result) p4++; else f4++;
}
console.log(`  ${p4}/${stringChecks.length} passed`);
fs.writeFileSync(path.join(outDir, 'sld-v13-string.svg'), svgString);

// ── Summary ────────────────────────────────────────────────────────────────
const totalPassed = p1 + p2 + p3 + p4;
const totalChecks = loadChecks.length + supplyChecks.length + backfedChecks.length + stringChecks.length;
console.log(`\n=== TOTAL: ${totalPassed}/${totalChecks} checks passed ===`);
console.log('\nOutput files:');
console.log('  outputs/sld-v13-load-side.svg');
console.log('  outputs/sld-v13-supply-side.svg');
console.log('  outputs/sld-v13-backfed.svg');
console.log('  outputs/sld-v13-string.svg');

if (totalPassed < totalChecks) process.exit(1);