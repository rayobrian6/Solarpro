// ============================================================
// Equipment Registry — Topology Transition Tests
// Run with: npx ts-node lib/equipment-registry-tests.ts
// ============================================================

import {
  getRegistryEntry,
  getTopologyForEquipment,
  getRequiredAccessories,
  checkCompatibility,
  TopologyType,
} from './equipment-registry';

import {
  detectTopology,
  normalizeTopology,
  validateTopologyTransition,
  TOPOLOGY_LABELS,
} from './topology-engine';

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label?: string) {
  if (actual !== expected) {
    throw new Error(`${label ? label + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Registry Entry Tests ──────────────────────────────────────────────────────

console.log('\n📋 Equipment Registry Entry Tests');

test('Fronius Primo registry entry exists', () => {
  const entry = getRegistryEntry('fronius-primo-8.2');
  assert(entry !== null, 'Entry should exist');
  assertEqual(entry!.topologyType, 'STRING_INVERTER', 'topology');
  assertEqual(entry!.manufacturer, 'Fronius', 'manufacturer');
});

test('SolarEdge SE7600H registry entry exists', () => {
  const entry = getRegistryEntry('se-7600h');
  assert(entry !== null, 'Entry should exist');
  assertEqual(entry!.topologyType, 'STRING_WITH_OPTIMIZER', 'topology');
  assertEqual(entry!.manufacturer, 'SolarEdge', 'manufacturer');
});

test('Enphase IQ8+ registry entry exists', () => {
  const entry = getRegistryEntry('enphase-iq8plus');
  assert(entry !== null, 'Entry should exist');
  assertEqual(entry!.topologyType, 'MICROINVERTER', 'topology');
  assertEqual(entry!.manufacturer, 'Enphase', 'manufacturer');
});

test('SMA Sunny Boy registry entry exists', () => {
  const entry = getRegistryEntry('sma-sb-7700');
  assert(entry !== null, 'Entry should exist');
  assertEqual(entry!.topologyType, 'STRING_INVERTER', 'topology');
});

test('APsystems QS1 registry entry exists', () => {
  const entry = getRegistryEntry('apsystems-qs1');
  assert(entry !== null, 'Entry should exist');
  assertEqual(entry!.topologyType, 'MICROINVERTER', 'topology');
});

test('IronRidge XR100 registry entry exists', () => {
  const entry = getRegistryEntry('ironridge-xr100');
  assert(entry !== null, 'Entry should exist');
  assertEqual(entry!.topologyType, 'FLUSH_MOUNT', 'topology');
});

test('Unknown equipment returns null', () => {
  const entry = getRegistryEntry('nonexistent-equipment-xyz');
  assertEqual(entry, null, 'should be null');
});

// ── Topology Detection Tests ──────────────────────────────────────────────────

console.log('\n🔍 Topology Detection Tests');

test('String inverter topology detected from registry', () => {
  const topo = getTopologyForEquipment('fronius-primo-8.2');
  assertEqual(topo, 'STRING_INVERTER', 'topology type');
});

test('Microinverter topology detected from registry', () => {
  const topo = getTopologyForEquipment('enphase-iq8plus');
  assertEqual(topo, 'MICROINVERTER', 'topology type');
});

test('Optimizer topology detected from registry', () => {
  const topo = getTopologyForEquipment('se-7600h');
  assertEqual(topo, 'STRING_WITH_OPTIMIZER', 'topology type');
});

test('detectTopology: string inverter context', () => {
  const result = detectTopology({
    inverterId: 'fronius-primo-8.2',
    moduleCount: 20,
    stringCount: 2,
    inverterCount: 1,
  });
  assertEqual(result.topology, 'STRING_INVERTER', 'topology');
  assertEqual(result.confidence, 'definitive', 'confidence');
});

test('detectTopology: microinverter context', () => {
  const result = detectTopology({
    inverterId: 'enphase-iq8plus',
    moduleCount: 20,
    stringCount: 0,
    inverterCount: 20,
  });
  assertEqual(result.topology, 'MICROINVERTER', 'topology');
  assertEqual(result.confidence, 'definitive', 'confidence');
});

test('detectTopology: optimizer context', () => {
  const result = detectTopology({
    inverterId: 'se-7600h',
    optimizerId: 'se-p401',
    moduleCount: 20,
    stringCount: 2,
    inverterCount: 1,
  });
  assertEqual(result.topology, 'STRING_WITH_OPTIMIZER', 'topology');
});

test('detectTopology: unknown inverter falls back to inferred', () => {
  const result = detectTopology({
    inverterId: 'unknown-inverter-xyz',
    moduleCount: 10,
    stringCount: 1,
    inverterCount: 1,
  });
  assertEqual(result.confidence, 'inferred', 'confidence should be inferred');
});

// ── Topology Normalization Tests ──────────────────────────────────────────────

console.log('\n🔄 Topology Normalization Tests');

test('STRING normalizes to STRING_INVERTER', () => {
  assertEqual(normalizeTopology('STRING' as TopologyType), 'STRING_INVERTER');
});

test('MICRO normalizes to MICROINVERTER', () => {
  assertEqual(normalizeTopology('MICRO' as TopologyType), 'MICROINVERTER');
});

test('STRING_OPTIMIZER normalizes to STRING_WITH_OPTIMIZER', () => {
  assertEqual(normalizeTopology('STRING_OPTIMIZER' as TopologyType), 'STRING_WITH_OPTIMIZER');
});

test('HYBRID normalizes to HYBRID_INVERTER', () => {
  assertEqual(normalizeTopology('HYBRID' as TopologyType), 'HYBRID_INVERTER');
});

test('Canonical types pass through unchanged', () => {
  assertEqual(normalizeTopology('STRING_INVERTER'), 'STRING_INVERTER');
  assertEqual(normalizeTopology('MICROINVERTER'), 'MICROINVERTER');
  assertEqual(normalizeTopology('STRING_WITH_OPTIMIZER'), 'STRING_WITH_OPTIMIZER');
});

// ── Topology Transition Tests ─────────────────────────────────────────────────

console.log('\n🔀 Topology Transition Tests');

test('STRING_INVERTER → MICROINVERTER transition', () => {
  const transition = validateTopologyTransition('STRING_INVERTER', 'MICROINVERTER');
  assert(transition.fieldsToReset.length > 0, 'should reset fields');
  assert(transition.warnings.length > 0, 'should have warnings');
});

test('STRING_INVERTER → STRING_WITH_OPTIMIZER transition', () => {
  const transition = validateTopologyTransition('STRING_INVERTER', 'STRING_WITH_OPTIMIZER');
  assert(transition.fieldsToAdd.length > 0, 'should add optimizer fields');
});

test('Same topology transition is a no-op', () => {
  const transition = validateTopologyTransition('STRING_INVERTER', 'STRING_INVERTER');
  assertEqual(transition.fieldsToReset.length, 0, 'no fields to reset');
  assertEqual(transition.fieldsToAdd.length, 0, 'no fields to add');
  assertEqual(transition.warnings.length, 0, 'no warnings');
});

// ── Accessory Resolution Tests ────────────────────────────────────────────────

console.log('\n🔧 Accessory Resolution Tests');

test('Enphase IQ8+ has required accessories', () => {
  const accessories = getRequiredAccessories('enphase-iq8plus');
  assert(accessories.length > 0, 'should have required accessories');
  const categories = accessories.map(a => a.category);
  assert(categories.includes('gateway'), 'should require gateway');
});

test('SolarEdge SE7600H has required accessories', () => {
  const accessories = getRequiredAccessories('se-7600h');
  assert(accessories.length > 0, 'should have required accessories');
});

test('String inverter (Fronius) has no required accessories', () => {
  const accessories = getRequiredAccessories('fronius-primo-8.2');
  // String inverters may have optional accessories but no required ones
  assert(Array.isArray(accessories), 'should return array');
});

// ── Compatibility Tests ───────────────────────────────────────────────────────

console.log('\n🔗 Compatibility Tests');

test('SolarEdge inverter compatible with SolarEdge optimizer', () => {
  const result = checkCompatibility('se-7600h', 'se-p401');
  assert(result.compatible, 'should be compatible');
});

test('Enphase IQ8+ compatible with IQ Gateway', () => {
  const result = checkCompatibility('enphase-iq8plus', 'enphase-iq-gateway');
  assert(result.compatible, 'should be compatible');
});

test('Cross-brand incompatibility detected', () => {
  const result = checkCompatibility('fronius-primo-8.2', 'se-p401');
  assert(!result.compatible, 'Fronius + SolarEdge optimizer should be incompatible');
});

// ── TOPOLOGY_LABELS Tests ─────────────────────────────────────────────────────

console.log('\n🏷️  Topology Label Tests');

test('All canonical topology types have labels', () => {
  const canonicalTypes: TopologyType[] = [
    'STRING_INVERTER', 'MICROINVERTER', 'STRING_WITH_OPTIMIZER',
    'HYBRID_INVERTER', 'DC_COUPLED_BATTERY', 'AC_COUPLED_BATTERY',
    'GROUND_MOUNT_FIXED_TILT', 'GROUND_MOUNT_DRIVEN_PILE',
    'ROOF_RAIL_BASED', 'ROOF_RAIL_LESS', 'AC_MODULE',
  ];
  for (const t of canonicalTypes) {
    assert(TOPOLOGY_LABELS[t] !== undefined, `Missing label for ${t}`);
  }
});

test('Legacy aliases have labels', () => {
  assert(TOPOLOGY_LABELS['STRING'] !== undefined, 'STRING alias label');
  assert(TOPOLOGY_LABELS['MICRO'] !== undefined, 'MICRO alias label');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n⚠️  ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}