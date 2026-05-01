// ============================================================
// ECOFLOW + SOLFENCE Golden Tests — v47.358
// lib/ecoflow.test.ts
//
// Run: npx tsx lib/ecoflow.test.ts
// ============================================================

import {
  ECOFLOW_INVERTERS,
  ECOFLOW_BATTERY_MODULE,
  sizeEcoFlowInverter,
  sizeEcoFlowBattery,
  distributeEcoFlowStrings,
  isEcoFlowInverter,
  solFenceEcoFlowDefaults,
} from './ecoflow-system';
import { deriveEcoFlowBOM, MICRO_ONLY_CATEGORIES, filterOutMicroItems } from './ecoflow-bom';
import { validateBOMInputs } from './bom-validation';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const results: Array<{ name: string; pass: boolean; detail?: string }> = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err: any) {
    results.push({ name, pass: false, detail: err?.message ?? String(err) });
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ── TEST 1: Inverter auto-sizing rules ──
test('EcoFlow inverter sizing: ≤6kW → 5kW', () => {
  const inv = sizeEcoFlowInverter(5.5);
  assert(inv.id === 'ecoflow-power-ocean-5kw', `expected 5kW for 5.5kW, got ${inv.id}`);
});

test('EcoFlow inverter sizing: 6-12kW → 10kW', () => {
  const inv1 = sizeEcoFlowInverter(8);
  const inv2 = sizeEcoFlowInverter(12);
  assert(inv1.id === 'ecoflow-power-ocean-10kw', `expected 10kW for 8kW, got ${inv1.id}`);
  assert(inv2.id === 'ecoflow-power-ocean-10kw', `expected 10kW for 12kW, got ${inv2.id}`);
});

test('EcoFlow inverter sizing: >12kW → 20kW', () => {
  const inv = sizeEcoFlowInverter(30);
  assert(inv.id === 'ecoflow-power-ocean-20kw', `expected 20kW for 30kW, got ${inv.id}`);
});

// ── TEST 2: Battery sizing ──
test('EcoFlow battery default target is 10 kWh', () => {
  const b = sizeEcoFlowBattery();
  assert(b.moduleCount === 2, `expected 2 modules (10 kWh default), got ${b.moduleCount}`);
  assert(b.totalKwh === 10, `expected 10 kWh, got ${b.totalKwh}`);
  assert(b.stackType === 'standard', `expected standard stack, got ${b.stackType}`);
});

test('EcoFlow battery sizing: 25 kWh target → 5 modules', () => {
  const b = sizeEcoFlowBattery(25);
  assert(b.moduleCount === 5, `expected 5 modules, got ${b.moduleCount}`);
  assert(b.totalKwh === 25, `expected 25 kWh total, got ${b.totalKwh}`);
});

test('EcoFlow battery sizing: standard stack caps at 45 kWh', () => {
  const b = sizeEcoFlowBattery(100);  // request 100 kWh
  assert(b.totalKwh === 45, `standard stack must cap at 45 kWh, got ${b.totalKwh}`);
  assert(b.moduleCount === 9, `expected 9 modules for std cap, got ${b.moduleCount}`);
});

test('EcoFlow battery sizing: pro stack caps at 80 kWh', () => {
  const b = sizeEcoFlowBattery(100, true);
  assert(b.totalKwh === 80, `pro stack must cap at 80 kWh, got ${b.totalKwh}`);
  assert(b.moduleCount === 16, `expected 16 modules for pro cap, got ${b.moduleCount}`);
});

// ── TEST 3: String distribution ──
test('EcoFlow string distribution: 20 panels across 3 MPPT', () => {
  const s = distributeEcoFlowStrings(20, 3);
  assert(s.strings === 3, `expected 3 strings, got ${s.strings}`);
  assert(s.panelsPerMppt === 7, `expected 7 panels/mppt, got ${s.panelsPerMppt}`);
});

// ── TEST 4: isEcoFlowInverter helper ──
test('isEcoFlowInverter identifies EcoFlow IDs', () => {
  assert(isEcoFlowInverter('ecoflow-power-ocean-5kw') === true, 'should detect 5kW');
  assert(isEcoFlowInverter('ecoflow-power-ocean-20kw') === true, 'should detect 20kW');
  assert(isEcoFlowInverter('enphase-iq8plus') === false, 'should reject Enphase');
  assert(isEcoFlowInverter('fronius-primo-8.2') === false, 'should reject Fronius');
});

// ── TEST 5: SolFence + EcoFlow combined defaults ──
test('SolFence 10 kW DC defaults to EcoFlow 10kW hybrid + 10 kWh battery + 3 MPPTs', () => {
  const d = solFenceEcoFlowDefaults({ totalDcKw: 10, moduleCount: 25 });
  assert(d.inverter.id === 'ecoflow-power-ocean-10kw', `expected 10kW, got ${d.inverter.id}`);
  assert(d.battery.totalKwh === 10, `expected 10 kWh, got ${d.battery.totalKwh}`);
  assert(d.strings.strings === 3, `expected 3 strings, got ${d.strings.strings}`);
});

// ── TEST 6: deriveEcoFlowBOM — accessory injection ──
test('deriveEcoFlowBOM with battery enabled emits base + combiner + meter + gateway', () => {
  const result = deriveEcoFlowBOM({
    inverterId: 'ecoflow-power-ocean-10kw',
    batteryEnabled: true,
    targetBatteryKwh: 15,
    moduleCount: 25,
  });

  const categories = result.items.map(i => i.category).sort();
  assert(categories.includes('battery_base'), 'missing battery_base');
  assert(categories.includes('battery_combiner'), 'missing battery_combiner');
  assert(categories.includes('smart_meter'), 'missing smart_meter');
  assert(categories.includes('monitoring_gateway'), 'missing monitoring_gateway');
  assert(result.batteryConfig !== null, 'batteryConfig should not be null');
  assert(result.batteryConfig!.moduleCount === 3, `expected 3 battery modules for 15 kWh, got ${result.batteryConfig!.moduleCount}`);

  // All items must have valid manufacturer
  for (const item of result.items) {
    assert(item.manufacturer === 'EcoFlow', `item ${item.model} manufacturer should be EcoFlow, got ${item.manufacturer}`);
  }
});

test('deriveEcoFlowBOM without battery emits only meter + gateway (no battery items)', () => {
  const result = deriveEcoFlowBOM({
    inverterId: 'ecoflow-power-ocean-5kw',
    batteryEnabled: false,
    moduleCount: 10,
  });
  const categories = result.items.map(i => i.category);
  assert(!categories.includes('battery_base'), 'should NOT include battery_base');
  assert(!categories.includes('battery_combiner'), 'should NOT include battery_combiner');
  assert(categories.includes('smart_meter'), 'should still include smart_meter');
  assert(categories.includes('monitoring_gateway'), 'should still include monitoring_gateway');
  assert(result.batteryConfig === null, 'batteryConfig should be null when disabled');
});

test('deriveEcoFlowBOM returns empty for non-EcoFlow inverter', () => {
  const result = deriveEcoFlowBOM({
    inverterId: 'fronius-primo-8.2',
    batteryEnabled: true,
    targetBatteryKwh: 10,
    moduleCount: 20,
  });
  assert(result.items.length === 0, `expected 0 items for non-EcoFlow inverter, got ${result.items.length}`);
});

// ── TEST 7: Micro-only items filter (Phase 8) ──
test('filterOutMicroItems removes microinverter, trunk_cable, terminator', () => {
  const items = [
    { category: 'microinverter', description: 'IQ8' },
    { category: 'trunk_cable', description: 'Q Cable' },
    { category: 'terminator', description: 'Q Terminator' },
    { category: 'string_inverter', description: 'EcoFlow 10kW' },
    { category: 'wire', description: '#10 THWN' },
    { category: 'solar_panel', description: 'PS Nexus 440W' },
  ];
  const { kept, removed } = filterOutMicroItems(items);
  assert(kept.length === 3, `expected 3 kept items, got ${kept.length}`);
  assert(removed.length === 3, `expected 3 removed items, got ${removed.length}`);
  assert(removed.every(i => MICRO_ONLY_CATEGORIES.has(i.category)), 'all removed should be micro-only');
});

// ── TEST 8: Validation layer — EcoFlow inverter sizing check ──
test('Validation flags EcoFlow inverter too small for DC array', () => {
  const v = validateBOMInputs({
    systemType: 'fence',
    inverterId: 'ecoflow-power-ocean-5kw',  // 5kW
    moduleCount: 40,
    systemKw: 17.6,                          // 17.6 kW DC (should be 20kW tier)
    panelId: 'panel-fence-ps1',
  });
  const sizing = v.checks.find(c => c.id === 'ecoflow-sizing');
  assert(sizing !== undefined, 'ecoflow-sizing check must exist');
  assert(sizing!.pass === false, 'should flag under-sizing');
  assert(v.warnings.some(w => w.includes('over/under-sized')), 'should emit sizing warning');
});

test('Validation passes when EcoFlow inverter matches DC array tier', () => {
  const v = validateBOMInputs({
    systemType: 'fence',
    inverterId: 'ecoflow-power-ocean-10kw',  // 10kW
    moduleCount: 20,
    systemKw: 8.8,                            // 6-12 kW range → 10kW inverter correct
    panelId: 'panel-fence-ps1',
  });
  const sizing = v.checks.find(c => c.id === 'ecoflow-sizing');
  assert(sizing !== undefined && sizing.pass === true, 'should pass ecoflow-sizing');
});

// ── TEST 9: EcoFlow catalog integrity ──
test('EcoFlow catalog has 3 inverter tiers', () => {
  assert(ECOFLOW_INVERTERS.length === 3, `expected 3 inverters, got ${ECOFLOW_INVERTERS.length}`);
});

test('EcoFlow battery module is 5 kWh LFP', () => {
  assert(ECOFLOW_BATTERY_MODULE.capacityKwh === 5, 'battery module must be 5 kWh');
  assert(ECOFLOW_BATTERY_MODULE.chemistry.includes('LFP'), 'battery chemistry must be LFP');
});

// ── Print results ──
console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  ECOFLOW + SOLFENCE — Golden Test Results');
console.log('═══════════════════════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;
for (const r of results) {
  if (r.pass) {
    console.log(`${GREEN}✓${RESET} ${r.name}`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} ${r.name}`);
    console.log(`    ${RED}${r.detail}${RESET}`);
    failed++;
  }
}

console.log('\n───────────────────────────────────────────────────────────────────');
console.log(`  Total: ${results.length} tests — ${passed} passed, ${failed} failed`);
console.log('───────────────────────────────────────────────────────────────────\n');

if (failed === 0) {
  console.log(`${GREEN}  ALL TESTS PASSED${RESET}\n`);
} else {
  console.log(`${RED}  ${failed} TEST(S) FAILED${RESET}\n`);
  process.exit(1);
}