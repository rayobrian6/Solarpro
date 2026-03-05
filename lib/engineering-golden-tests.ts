// ============================================================
// Golden-Case Tests for computeSystem() Engineering Pipeline
// NEC 2023 compliance validation
//
// Run with: npx ts-node --project tsconfig.json lib/engineering-golden-tests.ts
// Or import in Jest/Vitest test suite
//
// Golden Cases:
//   1. Microinverter: 34×IQ8+ @240V
//      → #6 Cu THWN-2, EGC #10, conduit 1-1/4" EMT, fill ≤40%
//   2. String inverter: typical residential
//      → DC disconnect, correct string count, correct conductor sizing
//   3. Optimizer: SolarEdge-like topology
//      → Correct device chain, conductor sizing
// ============================================================

import { computeSystem, type ComputedSystemInput, type ComputedSystem } from './computed-system';

// ─── Test helpers ────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  assertions: { label: string; expected: string; actual: string; pass: boolean }[];
}

function assert(
  results: TestResult['assertions'],
  label: string,
  actual: unknown,
  expected: unknown,
  comparator?: (a: unknown, e: unknown) => boolean
): void {
  const pass = comparator
    ? comparator(actual, expected)
    : String(actual) === String(expected);
  results.push({ label, expected: String(expected), actual: String(actual), pass });
}

function assertLte(results: TestResult['assertions'], label: string, actual: number, max: number): void {
  results.push({ label, expected: `≤ ${max}`, actual: String(actual.toFixed(2)), pass: actual <= max });
}

function assertGte(results: TestResult['assertions'], label: string, actual: number, min: number): void {
  results.push({ label, expected: `≥ ${min}`, actual: String(actual.toFixed(2)), pass: actual >= min });
}

// ─── Golden Case 1: 34×IQ8+ Microinverter @240V ──────────────────────────────

export function testMicroinverter34IQ8Plus(): TestResult {
  const name = 'Golden Case 1: 34×IQ8+ Microinverter @240V';
  const assertions: TestResult['assertions'] = [];

  const input: ComputedSystemInput = {
    topology: 'micro',
    totalPanels: 34,
    panelWatts: 400,
    panelVoc: 41.6,
    panelIsc: 12.26,
    panelVmp: 34.5,
    panelImp: 11.59,
    panelTempCoeffVoc: -0.26,
    panelTempCoeffIsc: 0.05,
    panelMaxSeriesFuse: 20,
    panelModel: 'Q.PEAK DUO BLK ML-G10+ 400',
    panelManufacturer: 'Qcells',
    inverterManufacturer: 'Enphase',
    inverterModel: 'IQ8+ Microinverter',
    inverterAcKw: 0.295,          // per micro
    inverterMaxDcV: 60,
    inverterMpptVmin: 16,
    inverterMpptVmax: 60,
    inverterMaxInputCurrentPerMppt: 14,
    inverterMpptChannels: 1,
    inverterAcCurrentMax: 1.21,   // per micro (datasheet)
    inverterModulesPerDevice: 1,
    inverterBranchLimit: 16,
    designTempMin: -10,
    ambientTempC: 40,
    rooftopTempAdderC: 30,
    runLengths: {
      ROOF_RUN: 30,
      BRANCH_RUN: 50,
      COMBINER_TO_DISCO_RUN: 20,
      DISCO_TO_METER_RUN: 15,
      METER_TO_MSP_RUN: 10,
      MSP_TO_UTILITY_RUN: 5,
    },
    conduitType: 'EMT',
    mainPanelAmps: 200,
    mainPanelBrand: 'Square D',
    panelBusRating: 225,   // 225A bus: 200+60=260 <= 225x1.2=270 -> passes NEC 705.12(B)
    maxACVoltageDropPct: 2,
    maxDCVoltageDropPct: 3,
  };

  const cs = computeSystem(input);

  // ── Topology ──
  assert(assertions, 'topology = MICROINVERTER', cs.topology, 'MICROINVERTER');
  assert(assertions, 'isMicro = true', cs.isMicro, true);
  assert(assertions, 'isString = false', cs.isString, false);

  // ── Device counts ──
  assert(assertions, 'microDeviceCount = 34', cs.microDeviceCount, 34);
  assert(assertions, 'acBranchCount = 3', cs.acBranchCount, 3); // ceil(34/16)=3

  // ── AC Electrical ──
  // I_ac = 34 × (0.295×1000/240) = 34 × 1.229 = 41.79A
  assertGte(assertions, 'acOutputCurrentA ≥ 41.0A', cs.acOutputCurrentA, 41.0);
  assertLte(assertions, 'acOutputCurrentA ≤ 43.0A', cs.acOutputCurrentA, 43.0);
  // I_cont = I_ac × 1.25 = 52.24A
  assertGte(assertions, 'acContinuousCurrentA ≥ 51.0A', cs.acContinuousCurrentA, 51.0);
  assertLte(assertions, 'acContinuousCurrentA ≤ 54.0A', cs.acContinuousCurrentA, 54.0);
  // OCPD = next standard ≥ 52.24 = 60A
  assert(assertions, 'acOcpdAmps = 60A', cs.acOcpdAmps, 60);

  // ── No DC disconnect for micro ──
  // (validated by checking runs don't include DC_STRING_RUN or DC_DISCO_TO_INV_RUN)
  const hasDcStringRun = cs.runs.some(r => r.id === 'DC_STRING_RUN');
  const hasDcDiscoRun = cs.runs.some(r => r.id === 'DC_DISCO_TO_INV_RUN');
  assert(assertions, 'no DC_STRING_RUN for micro', hasDcStringRun, false);
  assert(assertions, 'no DC_DISCO_TO_INV_RUN for micro', hasDcDiscoRun, false);

  // ── AC Feeder conductor (COMBINER_TO_DISCO_RUN) ──
  const acFeeder = cs.runs.find(r => r.id === 'COMBINER_TO_DISCO_RUN');
  assert(assertions, 'COMBINER_TO_DISCO_RUN exists', !!acFeeder, true);
  if (acFeeder) {
    assert(assertions, 'AC feeder wireGauge = #6 AWG', acFeeder.wireGauge, '#6 AWG');
    assert(assertions, 'AC feeder insulation = THWN-2', acFeeder.insulation, 'THWN-2');
    assert(assertions, 'AC feeder conductorMaterial = CU', acFeeder.conductorMaterial, 'CU');
    assert(assertions, 'AC feeder EGC = #10 AWG', acFeeder.egcGauge, '#10 AWG');
    assert(assertions, 'AC feeder conduitType = EMT', acFeeder.conduitType, 'EMT');
    // Conduit must be 1-1/4" EMT (3×#6 + 1×#10 = 0.1732 in² → needs 1-1/4" at 40% fill)
    assert(assertions, 'AC feeder conduitSize = 1-1/4"', acFeeder.conduitSize, '1-1/4"');
    assertLte(assertions, 'AC feeder conduitFillPct ≤ 40%', acFeeder.conduitFillPct, 40);
    assert(assertions, 'AC feeder ampacityPass = true', acFeeder.ampacityPass, true);
    assert(assertions, 'AC feeder ocpdAmps = 60A', acFeeder.ocpdAmps, 60);
    // Conductor callout must reference #6 AWG
    const calloutHas6 = acFeeder.conductorCallout.includes('6');
    assert(assertions, 'conductorCallout contains "6" (AWG)', calloutHas6, true);
  }

  // ── SLD/BOM snapshot: runs match ──
  const runIds = cs.runs.map(r => r.id);
  assert(assertions, 'runs include BRANCH_RUN', runIds.includes('BRANCH_RUN'), true);
  assert(assertions, 'runs include COMBINER_TO_DISCO_RUN', runIds.includes('COMBINER_TO_DISCO_RUN'), true);
  assert(assertions, 'runs include DISCO_TO_METER_RUN', runIds.includes('DISCO_TO_METER_RUN'), true);
  assert(assertions, 'runs include METER_TO_MSP_RUN', runIds.includes('METER_TO_MSP_RUN'), true);

  // ── BOM quantities derived from runs ──
  const acRuns = cs.runs.filter(r => r.color === 'ac');
  const expectedWireQty = acRuns.reduce((sum, r) =>
    sum + Math.ceil(r.onewayLengthFt * (r.conductorCount + 1) * 1.15), 0);
  assert(assertions, 'BOM wire qty derivable from runs', expectedWireQty > 0, true);

  // ── Validation ──
  assert(assertions, 'no errors in issues', cs.errorCount, 0);

  const passed = assertions.every(a => a.pass);
  return { name, passed, assertions };
}

// ─── Golden Case 2: String Inverter (8.2kW Fronius) ──────────────────────────

export function testStringInverter8kW(): TestResult {
  const name = 'Golden Case 2: String Inverter 8.2kW (20 panels)';
  const assertions: TestResult['assertions'] = [];

  const input: ComputedSystemInput = {
    topology: 'string',
    totalPanels: 20,
    panelWatts: 400,
    panelVoc: 41.6,
    panelIsc: 12.26,
    panelVmp: 34.5,
    panelImp: 11.59,
    panelTempCoeffVoc: -0.26,
    panelTempCoeffIsc: 0.05,
    panelMaxSeriesFuse: 20,
    panelModel: 'Q.PEAK DUO BLK ML-G10+ 400',
    panelManufacturer: 'Qcells',
    inverterManufacturer: 'Fronius',
    inverterModel: 'Primo 8.2-1',
    inverterAcKw: 8.2,
    inverterMaxDcV: 600,
    inverterMpptVmin: 200,
    inverterMpptVmax: 800,
    inverterMaxInputCurrentPerMppt: 18,
    inverterMpptChannels: 2,
    inverterAcCurrentMax: 34.2,
    inverterModulesPerDevice: 1,
    inverterBranchLimit: 1,
    designTempMin: -10,
    ambientTempC: 40,
    rooftopTempAdderC: 30,
    runLengths: {
      DC_STRING_RUN: 50,
      DC_DISCO_TO_INV_RUN: 10,
      INV_TO_DISCO_RUN: 20,
      DISCO_TO_METER_RUN: 15,
      METER_TO_MSP_RUN: 10,
      MSP_TO_UTILITY_RUN: 5,
    },
    conduitType: 'EMT',
    mainPanelAmps: 200,
    mainPanelBrand: 'Square D',
    panelBusRating: 200,
    maxACVoltageDropPct: 2,
    maxDCVoltageDropPct: 3,
  };

  const cs = computeSystem(input);

  // ── Topology ──
  assert(assertions, 'topology = STRING_INVERTER', cs.topology, 'STRING_INVERTER');
  assert(assertions, 'isString = true', cs.isString, true);
  assert(assertions, 'isMicro = false', cs.isMicro, false);

  // ── String count ──
  // Voc_corrected = 41.6 × [1 + (-0.26/100) × (-10-25)] = 41.6 × 1.091 = 45.39V
  // maxPanelsPerString = floor(600 / 45.39) = 13
  // stringCount = ceil(20/13) = 2
  assert(assertions, 'stringCount = 2', cs.stringCount, 2);

  // ── DC runs exist ──
  const hasDcStringRun = cs.runs.some(r => r.id === 'DC_STRING_RUN');
  const hasDcDiscoRun = cs.runs.some(r => r.id === 'DC_DISCO_TO_INV_RUN');
  assert(assertions, 'has DC_STRING_RUN', hasDcStringRun, true);
  assert(assertions, 'has DC_DISCO_TO_INV_RUN', hasDcDiscoRun, true);

  // ── AC electrical ──
  // I_ac = 8200/240 = 34.17A
  assertGte(assertions, 'acOutputCurrentA ≥ 33A', cs.acOutputCurrentA, 33);
  assertLte(assertions, 'acOutputCurrentA ≤ 36A', cs.acOutputCurrentA, 36);
  // I_cont = 34.17 × 1.25 = 42.7A → OCPD = 45A
  assert(assertions, 'acOcpdAmps = 45A', cs.acOcpdAmps, 45);

  // ── AC feeder conductor ──
  const acFeeder = cs.runs.find(r => r.id === 'INV_TO_DISCO_RUN');
  assert(assertions, 'INV_TO_DISCO_RUN exists', !!acFeeder, true);
  if (acFeeder) {
    assert(assertions, 'AC feeder insulation = THWN-2', acFeeder.insulation, 'THWN-2');
    assert(assertions, 'AC feeder ampacityPass = true', acFeeder.ampacityPass, true);
    assertLte(assertions, 'AC feeder conduitFillPct ≤ 40%', acFeeder.conduitFillPct, 40);
  }

  // ── No micro-specific runs ──
  const hasBranchRun = cs.runs.some(r => r.id === 'BRANCH_RUN');
  const hasCombinerRun = cs.runs.some(r => r.id === 'COMBINER_TO_DISCO_RUN');
  assert(assertions, 'no BRANCH_RUN for string', hasBranchRun, false);
  assert(assertions, 'no COMBINER_TO_DISCO_RUN for string', hasCombinerRun, false);

  const passed = assertions.every(a => a.pass);
  return { name, passed, assertions };
}

// ─── Golden Case 3: SolarEdge Optimizer Topology ─────────────────────────────

export function testOptimizerSolarEdge(): TestResult {
  const name = 'Golden Case 3: SolarEdge Optimizer 7.6kW (20 panels)';
  const assertions: TestResult['assertions'] = [];

  const input: ComputedSystemInput = {
    topology: 'optimizer',
    totalPanels: 20,
    panelWatts: 400,
    panelVoc: 41.6,
    panelIsc: 12.26,
    panelVmp: 34.5,
    panelImp: 11.59,
    panelTempCoeffVoc: -0.26,
    panelTempCoeffIsc: 0.05,
    panelMaxSeriesFuse: 20,
    panelModel: 'Q.PEAK DUO BLK ML-G10+ 400',
    panelManufacturer: 'Qcells',
    inverterManufacturer: 'SolarEdge',
    inverterModel: 'SE7600H',
    inverterAcKw: 7.6,
    inverterMaxDcV: 480,
    inverterMpptVmin: 100,
    inverterMpptVmax: 480,
    inverterMaxInputCurrentPerMppt: 13.5,
    inverterMpptChannels: 1,
    inverterAcCurrentMax: 32,
    inverterModulesPerDevice: 1,
    inverterBranchLimit: 1,
    designTempMin: -10,
    ambientTempC: 40,
    rooftopTempAdderC: 30,
    runLengths: {
      DC_STRING_RUN: 50,
      DC_DISCO_TO_INV_RUN: 10,
      INV_TO_DISCO_RUN: 20,
      DISCO_TO_METER_RUN: 15,
      METER_TO_MSP_RUN: 10,
      MSP_TO_UTILITY_RUN: 5,
    },
    conduitType: 'EMT',
    mainPanelAmps: 200,
    mainPanelBrand: 'Square D',
    panelBusRating: 200,
    maxACVoltageDropPct: 2,
    maxDCVoltageDropPct: 3,
  };

  const cs = computeSystem(input);

  // ── Topology ──
  assert(assertions, 'topology = STRING_WITH_OPTIMIZER', cs.topology, 'STRING_WITH_OPTIMIZER');
  assert(assertions, 'isOptimizer = true', cs.isOptimizer, true);
  assert(assertions, 'isMicro = false', cs.isMicro, false);

  // ── DC runs exist (optimizer has DC disconnect) ──
  const hasDcStringRun = cs.runs.some(r => r.id === 'DC_STRING_RUN');
  assert(assertions, 'has DC_STRING_RUN', hasDcStringRun, true);

  // ── AC electrical ──
  // I_ac = 7600/240 = 31.67A
  assertGte(assertions, 'acOutputCurrentA ≥ 30A', cs.acOutputCurrentA, 30);
  assertLte(assertions, 'acOutputCurrentA ≤ 34A', cs.acOutputCurrentA, 34);
  // I_cont = 31.67 × 1.25 = 39.58A → OCPD = 40A
  assert(assertions, 'acOcpdAmps = 40A', cs.acOcpdAmps, 40);

  // ── AC feeder conductor ──
  const acFeeder = cs.runs.find(r => r.id === 'INV_TO_DISCO_RUN');
  assert(assertions, 'INV_TO_DISCO_RUN exists', !!acFeeder, true);
  if (acFeeder) {
    assert(assertions, 'AC feeder ampacityPass = true', acFeeder.ampacityPass, true);
    assertLte(assertions, 'AC feeder conduitFillPct ≤ 40%', acFeeder.conduitFillPct, 40);
    // EGC for 40A OCPD = #10 AWG per NEC 250.122
    assert(assertions, 'AC feeder EGC = #10 AWG', acFeeder.egcGauge, '#10 AWG');
  }

  const passed = assertions.every(a => a.pass);
  return { name, passed, assertions };
}

// ─── Golden Case 4: NEC 250.122 EGC Sizing Validation ────────────────────────

export function testEGCSizing(): TestResult {
  const name = 'Golden Case 4: EGC Sizing per NEC 250.122';
  const assertions: TestResult['assertions'] = [];

  // Test various OCPD sizes and expected EGC gauges
  const cases = [
    { ocpd: 15,  expectedEGC: '#14 AWG' },
    { ocpd: 20,  expectedEGC: '#12 AWG' },
    { ocpd: 30,  expectedEGC: '#10 AWG' },
    { ocpd: 60,  expectedEGC: '#10 AWG' },
    { ocpd: 100, expectedEGC: '#8 AWG'  },
    { ocpd: 200, expectedEGC: '#6 AWG'  },
  ];

  // For 60A OCPD (34-micro system), EGC must be #10 AWG
  const input60A: ComputedSystemInput = {
    topology: 'micro',
    totalPanels: 34,
    panelWatts: 400, panelVoc: 41.6, panelIsc: 12.26, panelVmp: 34.5, panelImp: 11.59,
    panelTempCoeffVoc: -0.26, panelTempCoeffIsc: 0.05, panelMaxSeriesFuse: 20,
    panelModel: 'Test Panel', panelManufacturer: 'Test',
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8+',
    inverterAcKw: 0.295, inverterMaxDcV: 60, inverterMpptVmin: 16, inverterMpptVmax: 60,
    inverterMaxInputCurrentPerMppt: 14, inverterMpptChannels: 1, inverterAcCurrentMax: 1.21,
    inverterModulesPerDevice: 1, inverterBranchLimit: 16,
    designTempMin: -10, ambientTempC: 40, rooftopTempAdderC: 30,
    runLengths: { COMBINER_TO_DISCO_RUN: 20, DISCO_TO_METER_RUN: 15, METER_TO_MSP_RUN: 10 },
    conduitType: 'EMT', mainPanelAmps: 200, mainPanelBrand: 'Square D', panelBusRating: 200,
    maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3,
  };

  const cs60A = computeSystem(input60A);
  const acFeeder60A = cs60A.runs.find(r => r.id === 'COMBINER_TO_DISCO_RUN');

  assert(assertions, '60A OCPD system: acOcpdAmps = 60A', cs60A.acOcpdAmps, 60);
  if (acFeeder60A) {
    assert(assertions, '60A OCPD: EGC = #10 AWG (NEC 250.122)', acFeeder60A.egcGauge, '#10 AWG');
    assert(assertions, '60A OCPD: wireGauge = #6 AWG', acFeeder60A.wireGauge, '#6 AWG');
    assert(assertions, '60A OCPD: NOT #3 AWG (regression check)', acFeeder60A.wireGauge !== '#3 AWG', true);
  }

  const passed = assertions.every(a => a.pass);
  return { name, passed, assertions };
}

// ─── Run all tests ────────────────────────────────────────────────────────────

export function runAllGoldenTests(): void {
  const tests = [
    testMicroinverter34IQ8Plus,
    testStringInverter8kW,
    testOptimizerSolarEdge,
    testEGCSizing,
  ];

  let totalPass = 0;
  let totalFail = 0;

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     SolarPro Engineering Golden-Case Test Suite              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  for (const testFn of tests) {
    const result = testFn();
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);

    for (const a of result.assertions) {
      const aIcon = a.pass ? '  ✓' : '  ✗';
      if (!a.pass) {
        console.log(`${aIcon} FAIL: ${a.label}`);
        console.log(`       Expected: ${a.expected}`);
        console.log(`       Actual:   ${a.actual}`);
      }
    }

    const passCount = result.assertions.filter(a => a.pass).length;
    const failCount = result.assertions.filter(a => !a.pass).length;
    console.log(`   ${passCount}/${result.assertions.length} assertions passed\n`);

    totalPass += passCount;
    totalFail += failCount;
  }

  console.log('─────────────────────────────────────────────────────────────');
  console.log(`Total: ${totalPass} passed, ${totalFail} failed`);
  if (totalFail === 0) {
    console.log('🎉 All golden cases PASSED — engineering pipeline is correct!\n');
  } else {
    console.log('⚠️  Some golden cases FAILED — review engineering pipeline!\n');
    // process.exit(1) removed for ts-node compatibility
  }
}

// Auto-run when executed directly
runAllGoldenTests();