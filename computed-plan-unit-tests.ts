// ============================================================
// ComputedPlan Unit Tests — 4 canonical audit cases
// Run: npx ts-node computed-plan-unit-tests.ts
// ============================================================
//
// Test 1: 34 micros on 200A panel (LOAD_SIDE) → 120% busbar violation
// Test 2: Supply-side tap → PASS (120% rule N/A)
// Test 3: Non-fused disconnect → BOM has NO fuse items
// Test 4: Fused disconnect → BOM has exactly 2 fuse items (L1/L2)
// ============================================================

import { runElectricalCalc, ElectricalCalcInput, InverterInput } from './lib/electrical-calc';
import { deriveBomItemsForTest, BomItem } from './lib/computed-plan';

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; error: string }> = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
    failures.push({ name, error: e.message });
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

// 34 × IQ8+ microinverters: each 0.295 kW AC output
// Total AC = 34 × 0.295 = 10.03 kW → 10030W / 240V = 41.8A → ×1.25 = 52.3A → OCPD = 60A
// 120% rule: max solar breaker = (200A × 1.2) - 200A = 40A → 60A > 40A → VIOLATION
function makeMicroInverterInput(panelCount: number, method: 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP'): ElectricalCalcInput {
  const microInverter: InverterInput = {
    type: 'micro',
    acOutputKw: 0.295,          // IQ8+ per-device AC output
    maxDcVoltage: 60,
    mpptVoltageMin: 16,
    mpptVoltageMax: 48,
    maxInputCurrentPerMppt: 14,
    acOutputCurrentMax: 1.21,
    strings: [],                // micro: no strings
    modulesPerDevice: 1,
    deviceCount: panelCount,
  };

  return {
    inverters: [microInverter],
    mainPanelAmps: 200,
    systemVoltage: 240,
    designTempMin: -10,
    designTempMax: 40,
    rooftopTempAdder: 35,
    wireGauge: '#10 AWG THWN-2',
    wireLength: 50,
    conduitType: 'EMT',
    rapidShutdown: true,
    acDisconnect: true,
    dcDisconnect: true,
    necVersion: '2023',
    interconnection: {
      method,
      busRating: 200,
      mainBreaker: 200,
    },
  };
}

// Small string inverter for BOM tests (5 kW AC)
function makeStringInverterInput(method: 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP'): ElectricalCalcInput {
  const stringInverter: InverterInput = {
    type: 'string',
    acOutputKw: 5.0,
    maxDcVoltage: 600,
    mpptVoltageMin: 200,
    mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 13,
    acOutputCurrentMax: 20.8,
    strings: [{
      panelCount: 10,
      panelVoc: 40.2,
      panelIsc: 10.1,
      panelImp: 9.5,
      panelVmp: 33.4,
      panelWatts: 400,
      tempCoeffVoc: -0.27,
      tempCoeffIsc: 0.05,
      maxSeriesFuseRating: 20,
      wireGauge: '#10 AWG',
      wireLength: 50,
      conduitType: 'EMT',
    }],
  };

  return {
    inverters: [stringInverter],
    mainPanelAmps: 200,
    systemVoltage: 240,
    designTempMin: -10,
    designTempMax: 40,
    rooftopTempAdder: 35,
    wireGauge: '#10 AWG THWN-2',
    wireLength: 50,
    conduitType: 'EMT',
    rapidShutdown: true,
    acDisconnect: true,
    dcDisconnect: true,
    necVersion: '2023',
    interconnection: {
      method,
      busRating: 200,
      mainBreaker: 200,
    },
  };
}

// ── Test 1: 34 micros on 200A panel (LOAD_SIDE) → 120% busbar violation ──────

console.log('\n── Test 1: 34 micros, LOAD_SIDE → 120% busbar violation ──');
test('34 micros on 200A panel (LOAD_SIDE) should produce a 120% busbar compliance error', () => {
  const input = makeMicroInverterInput(34, 'LOAD_SIDE');
  const result = runElectricalCalc(input);

  const acSizing = result.acSizing;
  assert(acSizing !== null && acSizing !== undefined, 'acSizing should exist');

  // 34 × 0.295 kW = 10.03 kW → 41.8A × 1.25 = 52.3A → OCPD = 60A
  assert(acSizing.ocpdAmps >= 55, `OCPD should be ≥55A for 34 micros, got ${acSizing.ocpdAmps}A`);

  // 120% rule: max = (200 × 1.2) - 200 = 40A → 60A > 40A → VIOLATION
  const maxAllowed = (200 * 1.2) - 200; // = 40A
  assert(acSizing.ocpdAmps > maxAllowed,
    `OCPD (${acSizing.ocpdAmps}A) should exceed 120% max (${maxAllowed}A) to trigger violation`);

  // Check interconnection result for failure
  const interconnection = result.interconnection;
  assert(interconnection !== null && interconnection !== undefined, 'interconnection result should exist');
  assert(!interconnection.passes,
    `LOAD_SIDE interconnection should FAIL for 34 micros on 200A panel. passes=${interconnection.passes}, maxAllowed=${interconnection.maxAllowedSolarBreaker}A`);

  console.log(`    OCPD=${acSizing.ocpdAmps}A, 120% max=${maxAllowed}A, passes=${interconnection.passes} → VIOLATION ✓`);
});

// ── Test 2: Supply-side tap → PASS (120% rule N/A) ───────────────────────────

console.log('\n── Test 2: Supply-side tap → PASS (120% rule N/A) ──');
test('34 micros on 200A panel (SUPPLY_SIDE_TAP) should PASS — 120% rule does not apply', () => {
  const input = makeMicroInverterInput(34, 'SUPPLY_SIDE_TAP');
  const result = runElectricalCalc(input);

  const acSizing = result.acSizing;
  assert(acSizing !== null && acSizing !== undefined, 'acSizing should exist');

  // Supply-side tap: 120% rule does NOT apply → interconnection should PASS
  const interconnection = result.interconnection;
  assert(interconnection !== null && interconnection !== undefined, 'interconnection result should exist');
  assert(interconnection.passes,
    `SUPPLY_SIDE_TAP should PASS regardless of system size. passes=${interconnection.passes}, method=${interconnection.method}`);

  console.log(`    SUPPLY_SIDE_TAP: passes=${interconnection.passes}, method=${interconnection.method} → PASS ✓`);
});

// ── Test 3: Non-fused disconnect → BOM has NO fuse items ─────────────────────

console.log('\n── Test 3: Non-fused disconnect → BOM has NO fuse items ──');
test('Non-fused disconnect should produce BOM with zero fuse items', () => {
  const input = makeStringInverterInput('LOAD_SIDE');
  const result = runElectricalCalc(input);
  const acSizing = result.acSizing;
  assert(acSizing !== null && acSizing !== undefined, 'acSizing should exist');

  // Override to non-fused for this test
  const sizing = {
    ...acSizing,
    disconnectType: 'non-fused' as const,
    fuseAmps: null as null,
    fuseCount: 0,
  };

  const bomItems = deriveBomItemsForTest(sizing);
  const fuseItems = bomItems.filter((item: BomItem) =>
    item.model?.toLowerCase().includes('fuse') ||
    item.necReference?.includes('690.9')
  );

  assertEqual(fuseItems.length, 0,
    `Non-fused disconnect should have 0 fuse BOM items, got ${fuseItems.length}: ${JSON.stringify(fuseItems.map(i => i.model))}`);

  console.log(`    disconnectType=non-fused → ${fuseItems.length} fuse items in BOM ✓`);
  console.log(`    BOM items: [${bomItems.map(i => i.model).join(' | ')}]`);
});

// ── Test 4: Fused disconnect → BOM has exactly 2 fuse items ──────────────────

console.log('\n── Test 4: Fused disconnect → BOM has exactly 2 fuse items ──');
test('Fused disconnect should produce BOM with exactly 2 fuse items (L1/L2)', () => {
  const input = makeStringInverterInput('LOAD_SIDE');
  const result = runElectricalCalc(input);
  const acSizing = result.acSizing;
  assert(acSizing !== null && acSizing !== undefined, 'acSizing should exist');

  // Override to fused for this test
  // Fuse size = 2/3 × disconnect rating (NEC 690.9), rounded to standard size
  const fuseAmps = Math.round((acSizing.disconnectAmps * 2 / 3) / 5) * 5 || 40;
  const sizing = {
    ...acSizing,
    disconnectType: 'fused' as const,
    fuseAmps,
    fuseCount: 2,  // L1 + L2
  };

  const bomItems = deriveBomItemsForTest(sizing);
  const fuseItems = bomItems.filter((item: BomItem) =>
    item.model?.toLowerCase().includes('fuse') ||
    item.necReference?.includes('690.9')
  );

  assert(fuseItems.length > 0,
    `Fused disconnect should have fuse BOM items, got 0. BOM: ${JSON.stringify(bomItems.map(i => i.model))}`);

  // The fuse item should have quantity=2 (L1/L2)
  const totalFuseQty = fuseItems.reduce((sum: number, item: BomItem) => sum + (item.quantity ?? 0), 0);
  assertEqual(totalFuseQty, 2,
    `Fused disconnect should have total fuse quantity=2 (L1/L2), got ${totalFuseQty}`);

  console.log(`    disconnectType=fused → ${fuseItems.length} fuse item(s), total qty=${totalFuseQty} ✓`);
  console.log(`    Fuse: ${fuseItems[0]?.model} × ${fuseItems[0]?.quantity}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log('✅ All 4 ComputedPlan unit tests passed!');
  process.exit(0);
}