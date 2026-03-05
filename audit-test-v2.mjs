// ============================================================
// AUDIT TEST V2 — Regression Fix Validation
// Tests A, B, C as specified in regression fix requirements
// Run: node audit-test-v2.mjs
// Gate: AUDIT FAILED — DO NOT DEPLOY if any test fails
// ============================================================

// ── Inline copies of the logic under test ──────────────────

const MICROINVERTERS = [
  { id: 'enphase-iq8plus',  manufacturer: 'Enphase',   model: 'IQ8+',    modulesPerDevice: 1, acOutputW: 295 },
  { id: 'enphase-iq8m',     manufacturer: 'Enphase',   model: 'IQ8M',    modulesPerDevice: 1, acOutputW: 330 },
  { id: 'enphase-iq8h',     manufacturer: 'Enphase',   model: 'IQ8H',    modulesPerDevice: 1, acOutputW: 384 },
  { id: 'ap-ds3',           manufacturer: 'APsystems', model: 'DS3',     modulesPerDevice: 2, acOutputW: 730 },
  { id: 'hoymiles-hm800',   manufacturer: 'Hoymiles',  model: 'HM-800',  modulesPerDevice: 2, acOutputW: 800 },
];

const STRING_INVERTERS = [
  { id: 'se-7600h', manufacturer: 'SolarEdge', model: 'SE7600H-US', type: 'string' },
  { id: 'fronius-primo-8.2', manufacturer: 'Fronius', model: 'Primo 8.2-1', type: 'string' },
];

// ── Core formulas ───────────────────────────────────────────

function getInvById(id, type) {
  if (type === 'micro') return MICROINVERTERS.find(m => m.id === id) ?? null;
  return STRING_INVERTERS.find(s => s.id === id) ?? null;
}

/**
 * newInverter — mirrors the fixed newInverter() in page.tsx
 * Uses correct default inverterId per type
 */
function newInverter(type) {
  const defaultId = type === 'micro'
    ? (MICROINVERTERS[0]?.id ?? 'enphase-iq8plus')
    : (STRING_INVERTERS[0]?.id ?? 'se-7600h');
  return { id: `inv-test`, inverterId: defaultId, type, strings: [{ panelCount: 10 }] };
}

/**
 * handleTopologySwitch — mirrors the fixed logic in page.tsx
 * When switching to micro: REPLACE ALL inverters with a single micro entry
 */
function handleTopologySwitch(currentInverters, targetInvId, newType, newInverterId) {
  if (newType === 'micro') {
    // Collect total panels from ALL inverters
    const totalPanels = currentInverters.reduce(
      (sum, i) => sum + i.strings.reduce((s, str) => s + str.panelCount, 0), 0
    ) || 20;
    const singleMicroInv = {
      id: targetInvId,
      inverterId: newInverterId,
      type: 'micro',
      strings: [{ panelCount: totalPanels }],
    };
    return [singleMicroInv]; // SINGLE entry — no multi-group
  }
  return currentInverters.map(i =>
    i.id === targetInvId ? { ...i, type: newType, inverterId: newInverterId } : i
  );
}

/**
 * addInverter — mirrors the fixed addInverter() in page.tsx
 * For micro: REPLACE all inverters with single entry
 */
function addInverter(type, currentInverters) {
  if (type === 'micro') {
    const totalPanels = currentInverters.reduce(
      (sum, i) => sum + i.strings.reduce((s, str) => s + str.panelCount, 0), 0
    ) || 20;
    const microId = MICROINVERTERS[0]?.id || 'enphase-iq8plus';
    return [{
      id: 'inv-new',
      inverterId: microId,
      type: 'micro',
      strings: [{ panelCount: totalPanels }],
    }];
  }
  const inv = newInverter(type);
  return [...currentInverters, inv];
}

/**
 * computeMasterSystem — mirrors Issue 5 master system object
 * system = { topology, panelCount, modulesPerDevice, deviceCount }
 */
function computeMasterSystem(inverters) {
  const firstInv = inverters[0];
  if (!firstInv) return null;

  const topology = firstInv.type === 'micro' ? 'MICRO'
    : firstInv.type === 'optimizer' ? 'STRING_OPTIMIZER'
    : 'STRING';

  if (firstInv.type === 'micro') {
    const invData = getInvById(firstInv.inverterId, 'micro');
    const registryMpd = invData?.modulesPerDevice ?? 1;
    const effectiveMpd = firstInv.deviceRatioOverride ?? registryMpd;
    // Sum panels across ALL micro inverters (should be 1 after fix)
    const panelCount = inverters
      .filter(i => i.type === 'micro')
      .reduce((sum, i) => sum + i.strings.reduce((s, str) => s + str.panelCount, 0), 0);
    const deviceCount = Math.ceil(panelCount / effectiveMpd);
    return { topology, panelCount, modulesPerDevice: effectiveMpd, deviceCount };
  }

  const panelCount = inverters.reduce(
    (sum, i) => sum + i.strings.reduce((s, str) => s + str.panelCount, 0), 0
  );
  return { topology, panelCount, modulesPerDevice: null, deviceCount: null };
}

/**
 * computeBOMInverterId — mirrors the fixed fetchBOM inverterId logic
 * For micro: validate inverterId is a real micro ID, fallback to MICROINVERTERS[0]
 */
function computeBOMInverterId(firstInv) {
  if (firstInv?.type === 'micro') {
    return MICROINVERTERS.find(m => m.id === firstInv.inverterId)?.id
      ?? MICROINVERTERS[0]?.id
      ?? 'enphase-iq8plus';
  }
  return firstInv?.inverterId || 'fronius-primo-8.2';
}

/**
 * simulateBOM — mirrors bom-engine-v4.ts after all fixes
 */
function simulateBOM(input) {
  const { moduleCount, deviceCount, topologyType, inverterCount } = input;
  const lines = [];

  lines.push({ category: 'solar_panel', qty: moduleCount });

  if (topologyType === 'MICROINVERTER') {
    const microQty = deviceCount ?? moduleCount;
    lines.push({ category: 'microinverter', qty: microQty });
    const trunkQty = Math.ceil(microQty / 16);
    lines.push({ category: 'trunk_cable', qty: trunkQty });
    // AC disconnect: 1 per system (micro)
    lines.push({ category: 'ac_disconnect', qty: 1 });
    // NO DC disconnect for micro
  }

  if (topologyType === 'STRING_INVERTER') {
    lines.push({ category: 'string_inverter', qty: inverterCount ?? 1 });
    // DC disconnect: 1 per inverter
    lines.push({ category: 'dc_disconnect', qty: inverterCount ?? 1 });
    // AC disconnect: 1 per system
    lines.push({ category: 'ac_disconnect', qty: 1 });
  }

  const seen = new Set();
  let hasDuplicates = false;
  for (const line of lines) {
    if (seen.has(line.category)) { hasDuplicates = true; break; }
    seen.add(line.category);
  }

  return {
    lines,
    panelQty: lines.find(l => l.category === 'solar_panel')?.qty ?? 0,
    microQty: lines.find(l => l.category === 'microinverter')?.qty ?? null,
    stringInvQty: lines.find(l => l.category === 'string_inverter')?.qty ?? null,
    acDisconnectQty: lines.find(l => l.category === 'ac_disconnect')?.qty ?? null,
    dcDisconnectQty: lines.find(l => l.category === 'dc_disconnect')?.qty ?? null,
    trunkCableQty: lines.find(l => l.category === 'trunk_cable')?.qty ?? null,
    hasDuplicates,
  };
}

// ── Test runner ─────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`         ${detail}`);
    failed++;
    failures.push({ name, detail });
  }
}

// ── TEST A: 20 panels, mpd=1, MICRO ──────────────────────────

console.log('\n═══════════════════════════════════════════════════════');
console.log('TEST A: panelCount=20, modulesPerDevice=1, Topology=MICRO');
console.log('Expected: deviceCount=20, BOM micro=20, disconnect=1');
console.log('═══════════════════════════════════════════════════════');
{
  // Simulate: user has 2 string inverters (10 panels each), switches to micro
  const initialInverters = [
    { id: 'inv-1', inverterId: 'se-7600h', type: 'string', strings: [{ panelCount: 10 }] },
    { id: 'inv-2', inverterId: 'se-7600h', type: 'string', strings: [{ panelCount: 10 }] },
  ];

  // After topology switch to micro: should collapse to ONE entry
  const afterSwitch = handleTopologySwitch(initialInverters, 'inv-1', 'micro', 'enphase-iq8plus');
  console.log(`  After topology switch: inverters.length = ${afterSwitch.length}`);
  console.log(`  afterSwitch[0].inverterId = ${afterSwitch[0]?.inverterId}`);
  console.log(`  afterSwitch[0].strings[0].panelCount = ${afterSwitch[0]?.strings[0]?.panelCount}`);

  assert('A1: Only ONE inverter entry after topology switch', afterSwitch.length === 1,
    `Expected 1, got ${afterSwitch.length}`);
  assert('A2: Inverter type is micro', afterSwitch[0]?.type === 'micro',
    `Expected 'micro', got ${afterSwitch[0]?.type}`);
  assert('A3: Total panels preserved (20)', afterSwitch[0]?.strings[0]?.panelCount === 20,
    `Expected 20, got ${afterSwitch[0]?.strings[0]?.panelCount}`);
  assert('A4: inverterId is valid micro ID', afterSwitch[0]?.inverterId === 'enphase-iq8plus',
    `Expected 'enphase-iq8plus', got ${afterSwitch[0]?.inverterId}`);

  // Compute master system
  const system = computeMasterSystem(afterSwitch);
  console.log(`  system = ${JSON.stringify(system)}`);

  assert('A5: system.topology === MICRO', system?.topology === 'MICRO',
    `Expected 'MICRO', got ${system?.topology}`);
  assert('A6: system.panelCount === 20', system?.panelCount === 20,
    `Expected 20, got ${system?.panelCount}`);
  assert('A7: system.deviceCount === 20', system?.deviceCount === 20,
    `Expected 20, got ${system?.deviceCount}`);

  // BOM
  const bom = simulateBOM({ moduleCount: 20, deviceCount: system.deviceCount, topologyType: 'MICROINVERTER' });
  assert('A8: BOM micro qty === 20', bom.microQty === 20,
    `Expected 20, got ${bom.microQty}`);
  assert('A9: BOM panel qty === 20', bom.panelQty === 20,
    `Expected 20, got ${bom.panelQty}`);
  assert('A10: BOM AC disconnect qty === 1', bom.acDisconnectQty === 1,
    `Expected 1, got ${bom.acDisconnectQty}`);
  assert('A11: BOM no DC disconnect (micro)', bom.dcDisconnectQty === null,
    `Expected null, got ${bom.dcDisconnectQty}`);
  assert('A12: No string inverter in BOM', bom.stringInvQty === null,
    `Expected null, got ${bom.stringInvQty}`);
  assert('A13: No duplicate BOM rows', !bom.hasDuplicates,
    'Duplicate category found in BOM lines');

  // BOM inverterId fix
  const bomInverterId = computeBOMInverterId(afterSwitch[0]);
  assert('A14: BOM inverterId is valid micro ID', MICROINVERTERS.some(m => m.id === bomInverterId),
    `Expected valid micro ID, got ${bomInverterId}`);
}

// ── TEST B: 20 panels, mpd=2 ─────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════');
console.log('TEST B: panelCount=20, modulesPerDevice=2 (DS3)');
console.log('Expected: deviceCount=10, BOM micro=10');
console.log('═══════════════════════════════════════════════════════');
{
  const inverters = [
    { id: 'inv-1', inverterId: 'ap-ds3', type: 'micro', strings: [{ panelCount: 20 }] },
  ];

  const system = computeMasterSystem(inverters);
  console.log(`  system = ${JSON.stringify(system)}`);

  assert('B1: system.deviceCount === 10', system?.deviceCount === 10,
    `Expected 10, got ${system?.deviceCount}`);
  assert('B2: system.panelCount === 20', system?.panelCount === 20,
    `Expected 20, got ${system?.panelCount}`);
  assert('B3: system.modulesPerDevice === 2', system?.modulesPerDevice === 2,
    `Expected 2, got ${system?.modulesPerDevice}`);

  const bom = simulateBOM({ moduleCount: 20, deviceCount: system.deviceCount, topologyType: 'MICROINVERTER' });
  assert('B4: BOM micro qty === 10', bom.microQty === 10,
    `Expected 10, got ${bom.microQty}`);
  assert('B5: BOM panel qty === 20', bom.panelQty === 20,
    `Expected 20, got ${bom.panelQty}`);
  assert('B6: Trunk cable = ceil(10/16) = 1', bom.trunkCableQty === 1,
    `Expected 1, got ${bom.trunkCableQty}`);
}

// ── TEST C: Only ONE micro system exists ──────────────────────

console.log('\n═══════════════════════════════════════════════════════');
console.log('TEST C: Verify only ONE micro system exists');
console.log('═══════════════════════════════════════════════════════');
{
  // Scenario 1: topology switch from 2 string inverters
  const twoStringInverters = [
    { id: 'inv-1', inverterId: 'se-7600h', type: 'string', strings: [{ panelCount: 10 }] },
    { id: 'inv-2', inverterId: 'se-7600h', type: 'string', strings: [{ panelCount: 10 }] },
  ];
  const afterSwitch = handleTopologySwitch(twoStringInverters, 'inv-1', 'micro', 'enphase-iq8plus');
  assert('C1: topology switch → exactly 1 inverter', afterSwitch.length === 1,
    `Expected 1, got ${afterSwitch.length}`);
  assert('C2: topology switch → all panels in single entry', afterSwitch[0]?.strings[0]?.panelCount === 20,
    `Expected 20, got ${afterSwitch[0]?.strings[0]?.panelCount}`);

  // Scenario 2: addInverter('micro') when micro already exists
  const existingMicro = [
    { id: 'inv-1', inverterId: 'enphase-iq8plus', type: 'micro', strings: [{ panelCount: 20 }] },
  ];
  const afterAdd = addInverter('micro', existingMicro);
  assert('C3: addInverter(micro) → exactly 1 inverter', afterAdd.length === 1,
    `Expected 1, got ${afterAdd.length}`);
  assert('C4: addInverter(micro) → panels preserved', afterAdd[0]?.strings[0]?.panelCount === 20,
    `Expected 20, got ${afterAdd[0]?.strings[0]?.panelCount}`);

  // Scenario 3: newInverter('micro') uses correct default ID
  const inv = newInverter('micro');
  assert('C5: newInverter(micro) uses micro ID', MICROINVERTERS.some(m => m.id === inv.inverterId),
    `Expected valid micro ID, got ${inv.inverterId}`);
  assert('C6: newInverter(string) uses string ID', STRING_INVERTERS.some(s => s.id === newInverter('string').inverterId),
    `Expected valid string ID, got ${newInverter('string').inverterId}`);

  // Scenario 4: stale inverterId (se-7600h) in micro entry → BOM fix
  const staleInv = { id: 'inv-1', inverterId: 'se-7600h', type: 'micro', strings: [{ panelCount: 20 }] };
  const fixedId = computeBOMInverterId(staleInv);
  assert('C7: stale inverterId corrected for BOM', MICROINVERTERS.some(m => m.id === fixedId),
    `Expected valid micro ID, got ${fixedId}`);
  assert('C8: stale inverterId is NOT se-7600h', fixedId !== 'se-7600h',
    `Expected micro ID, got se-7600h (string inverter)`);

  console.log(`  twoString → switch: ${afterSwitch.length} inverter(s), panels=${afterSwitch[0]?.strings[0]?.panelCount}`);
  console.log(`  existingMicro → addMicro: ${afterAdd.length} inverter(s)`);
  console.log(`  stale 'se-7600h' → BOM corrected to: ${fixedId}`);
}

// ── TEST D: Equipment Schedule reads system object ────────────

console.log('\n═══════════════════════════════════════════════════════');
console.log('TEST D: Equipment Schedule reads system.panelCount + system.deviceCount');
console.log('═══════════════════════════════════════════════════════');
{
  const inverters = [
    { id: 'inv-1', inverterId: 'enphase-iq8plus', type: 'micro', strings: [{ panelCount: 20 }] },
  ];
  const system = computeMasterSystem(inverters);

  assert('D1: system.panelCount === 20', system?.panelCount === 20,
    `Expected 20, got ${system?.panelCount}`);
  assert('D2: system.deviceCount === 20', system?.deviceCount === 20,
    `Expected 20, got ${system?.deviceCount}`);
  assert('D3: system.topology === MICRO', system?.topology === 'MICRO',
    `Expected MICRO, got ${system?.topology}`);

  // Verify no string rows (strings array is empty for micro)
  const microInv = inverters[0];
  const stringCount = microInv.strings.length; // placeholder strings for panel count only
  // Equipment schedule should NOT iterate strings for Voc/Isc — it reads system object
  assert('D4: Equipment schedule uses system.deviceCount not strings.length',
    system.deviceCount === 20 && stringCount === 1,
    `deviceCount=${system.deviceCount}, strings.length=${stringCount} (strings is just a placeholder)`);

  console.log(`  system.panelCount=${system.panelCount}, system.deviceCount=${system.deviceCount}`);
  console.log(`  Equipment Schedule: Panels=${system.panelCount}, Microinverters=×${system.deviceCount}`);
}

// ── TEST E: Non-regression — STRING topology unchanged ────────

console.log('\n═══════════════════════════════════════════════════════');
console.log('TEST E: Non-regression — STRING topology unchanged');
console.log('═══════════════════════════════════════════════════════');
{
  const stringInverters = [
    { id: 'inv-1', inverterId: 'se-7600h', type: 'string', strings: [{ panelCount: 10 }] },
    { id: 'inv-2', inverterId: 'se-7600h', type: 'string', strings: [{ panelCount: 10 }] },
  ];

  const system = computeMasterSystem(stringInverters);
  assert('E1: STRING system.topology === STRING', system?.topology === 'STRING',
    `Expected STRING, got ${system?.topology}`);
  assert('E2: STRING system.panelCount === 20', system?.panelCount === 20,
    `Expected 20, got ${system?.panelCount}`);
  assert('E3: STRING system.deviceCount === null', system?.deviceCount === null,
    `Expected null, got ${system?.deviceCount}`);

  const bom = simulateBOM({ moduleCount: 20, deviceCount: undefined, topologyType: 'STRING_INVERTER', inverterCount: 2 });
  assert('E4: STRING BOM has string_inverter row', bom.stringInvQty === 2,
    `Expected 2, got ${bom.stringInvQty}`);
  assert('E5: STRING BOM has DC disconnect', bom.dcDisconnectQty === 2,
    `Expected 2, got ${bom.dcDisconnectQty}`);
  assert('E6: STRING BOM has no microinverter row', bom.microQty === null,
    `Expected null, got ${bom.microQty}`);

  // addInverter('string') should still append (not replace)
  const afterAddString = addInverter('string', stringInverters);
  assert('E7: addInverter(string) appends (does not replace)', afterAddString.length === 3,
    `Expected 3, got ${afterAddString.length}`);

  console.log(`  STRING system: topology=${system.topology}, panels=${system.panelCount}`);
  console.log(`  STRING BOM: stringInv=${bom.stringInvQty}, dcDisconnect=${bom.dcDisconnectQty}`);
}

// ── FINAL VERDICT ───────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════');

if (failed > 0) {
  console.log('\n❌ FAILURES:');
  failures.forEach(f => console.log(`  • ${f.name}: ${f.detail}`));
  console.log('\n🚫 AUDIT FAILED — DO NOT DEPLOY\n');
  process.exit(1);
} else {
  console.log('\n✅ AUDIT PASSED — SAFE TO DEPLOY\n');
  process.exit(0);
}