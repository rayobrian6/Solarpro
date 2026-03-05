// ============================================================
// Engineering Core Regression Tests — V3.2 Patch
// 5 tests covering topology isolation, ecosystem bleed fix,
// Roof Tech structural math, and IronRidge regression.
// Run with: npx jest lib/engineering-core.test.ts
// ============================================================

import { calcMicroSystem, MicroSystemInput } from '../app/engineering/core/microSystem';
import { calcStringSystem, StringSystemInput } from '../app/engineering/core/stringSystem';
import {
  getSystemInstance,
  destroyCurrentInstance,
  FactoryManagedState,
  TopologyType,
} from '../app/engineering/core/systemFactory';
import { runStructuralCalc, StructuralInput } from './structural-calc';
import { getRegistryEntry } from './equipment-registry';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeMicroInput(panelCount: number): MicroSystemInput {
  return {
    inverterId: 'enphase-iq8plus',
    panelCount,
    systemVoltage: 240,
    wireLength: 50,
    conduitType: 'EMT',
    mainPanelAmps: 200,
    necVersion: '2023',
  };
}

function makeStringInput(): StringSystemInput {
  return {
    inverters: [
      {
        type: 'string',
        acOutputKw: 7.6,
        maxDcVoltage: 600,
        mpptVoltageMin: 200,
        mpptVoltageMax: 480,
        maxInputCurrentPerMppt: 15,
        acOutputCurrentMax: 32,
        strings: [
          {
            panelCount: 10,
            panelVoc: 49.5,
            panelIsc: 10.2,
            panelPmax: 400,
            panelTempCoeffVoc: -0.0027,
          },
          {
            panelCount: 10,
            panelVoc: 49.5,
            panelIsc: 10.2,
            panelPmax: 400,
            panelTempCoeffVoc: -0.0027,
          },
        ],
      },
    ],
    mainPanelAmps: 200,
    systemVoltage: 240,
    designTempMin: -10,
    designTempMax: 70,
    rooftopTempAdder: 30,
    wireLength: 50,
    conduitType: 'EMT',
    necVersion: '2023',
  };
}

function makeFactoryState(topology: TopologyType): FactoryManagedState {
  return {
    inverterArray: [],
    ecosystem: [],
    dcStrings: [],
    topologyType: topology,
  };
}

function makeStructuralInput(mountId: string): StructuralInput {
  const entry = getRegistryEntry(mountId);
  const specs = entry?.structuralSpecs;
  return {
    windSpeed: 110,
    windExposure: 'C',
    groundSnowLoad: 20,
    roofType: 'shingle',
    roofPitch: 20,
    rafterSpacing: 24,
    rafterSpan: 14,
    rafterSize: '2x6',
    rafterSpecies: 'Douglas Fir-Larch',
    panelLength: 78,
    panelWidth: 40,
    panelWeight: 45,
    panelCount: 20,
    rackingWeight: 5,
    attachmentSpacing: 48,
    railSpan: 48,
    rowSpacing: 12,
    arrayTilt: 20,
    systemType: 'roof',
    mountSpecs: specs ? {
      loadModel: specs.loadModel,
      fastenersPerAttachment: specs.fastenersPerAttachment,
      upliftCapacity: specs.upliftCapacity,
      tributaryArea: specs.tributaryArea,
      attachmentSpacingMax: specs.attachmentSpacingMax,
    } : undefined,
  };
}

// ── Test 1: Micro 10 panels → 10 devices, NO DC strings ──────────────────────

describe('Test 1: Micro topology — 10 panels → 10 devices, no DC strings', () => {
  test('produces exactly 10 microinverter devices for 10 panels (IQ8+, multiModule=false)', () => {
    const result = calcMicroSystem(makeMicroInput(10));

    // Must have exactly 10 devices (IQ8+ is 1:1 per module)
    const totalDevices = result.branches.reduce((sum, b) => sum + b.devices.length, 0);
    expect(totalDevices).toBe(10);
    expect(result.totalDevices).toBe(10);
  });

  test('has NO DC strings (hasDCStrings === false)', () => {
    const result = calcMicroSystem(makeMicroInput(10));
    expect(result.hasDCStrings).toBe(false);
    expect(result.dcStrings).toHaveLength(0);
  });

  test('has NO DC OCPD (dcStringOCPD === null)', () => {
    const result = calcMicroSystem(makeMicroInput(10));
    expect(result.dcStringOCPD).toBeNull();
  });

  test('has NO DC conductors (dcConductors === null)', () => {
    const result = calcMicroSystem(makeMicroInput(10));
    expect(result.dcConductors).toBeNull();
  });

  test('topology type is MICROINVERTER', () => {
    const result = calcMicroSystem(makeMicroInput(10));
    expect(result.topologyType).toBe('MICROINVERTER');
  });

  test('branchCurrent = sum of device output currents (NEC 690.8)', () => {
    const result = calcMicroSystem(makeMicroInput(10));
    for (const branch of result.branches) {
      const expectedBranchCurrent = branch.devices.reduce((sum, d) => sum + d.outputCurrent, 0);
      expect(branch.branchCurrent).toBeCloseTo(expectedBranchCurrent, 2);
    }
  });

  test('continuousLoad = branchCurrent × 1.25 (NEC 690.8(A)(1))', () => {
    const result = calcMicroSystem(makeMicroInput(10));
    for (const branch of result.branches) {
      expect(branch.continuousLoad).toBeCloseTo(branch.branchCurrent * 1.25, 2);
    }
  });
});

// ── Test 2: Switch to string → DC string array + Voc/Isc ─────────────────────

describe('Test 2: String topology — DC string array + Voc/Isc correction', () => {
  test('has DC strings (hasDCStrings === true)', () => {
    const result = calcStringSystem(makeStringInput());
    expect(result.hasDCStrings).toBe(true);
  });

  test('has populated strings array', () => {
    const result = calcStringSystem(makeStringInput());
    expect(result.strings.length).toBeGreaterThan(0);
  });

  test('each string has corrected Voc (NEC 690.7 temperature correction)', () => {
    const result = calcStringSystem(makeStringInput());
    for (const str of result.strings) {
      // Corrected Voc must be >= nominal Voc (cold temp correction increases Voc)
      expect(str.correctedVoc).toBeGreaterThan(0);
      expect(str.correctedVoc).toBeGreaterThanOrEqual(str.nominalVoc);
    }
  });

  test('each string has corrected Isc (NEC 690.8 temperature correction)', () => {
    const result = calcStringSystem(makeStringInput());
    for (const str of result.strings) {
      expect(str.correctedIsc).toBeGreaterThan(0);
    }
  });

  test('topology type is STRING_INVERTER', () => {
    const result = calcStringSystem(makeStringInput());
    expect(result.topologyType).toBe('STRING_INVERTER');
  });

  test('has AC wire gauge', () => {
    const result = calcStringSystem(makeStringInput());
    expect(result.acWireGauge).toBeTruthy();
    expect(result.acWireGauge.length).toBeGreaterThan(0);
  });
});

// ── Test 3: Switch back to micro → no leftover strings ───────────────────────

describe('Test 3: Topology switch micro→string→micro — no leftover strings', () => {
  beforeEach(() => {
    destroyCurrentInstance();
  });

  afterEach(() => {
    destroyCurrentInstance();
  });

  test('switching micro→string→micro clears dcStrings array', () => {
    const state = makeFactoryState('MICROINVERTER');

    // Step 1: Start as micro
    getSystemInstance('MICROINVERTER', state);
    expect(state.dcStrings).toHaveLength(0);
    expect(state.topologyType).toBe('MICROINVERTER');

    // Step 2: Simulate string topology — add fake DC string objects
    state.dcStrings.push({ id: 'str-1', panelCount: 10 });
    state.dcStrings.push({ id: 'str-2', panelCount: 10 });
    state.inverterArray.push({ id: 'inv-1', type: 'string' });
    state.ecosystem.push({ id: 'eco-1', category: 'optimizer' });
    expect(state.dcStrings).toHaveLength(2);

    // Step 3: Switch to string topology
    getSystemInstance('STRING_INVERTER', state);
    expect(state.topologyType).toBe('STRING_INVERTER');

    // Step 4: Switch back to micro — factory MUST clear all arrays
    getSystemInstance('MICROINVERTER', state);
    expect(state.dcStrings).toHaveLength(0);
    expect(state.inverterArray).toHaveLength(0);
    expect(state.ecosystem).toHaveLength(0);
    expect(state.topologyType).toBe('MICROINVERTER');
  });

  test('micro result after switch-back has no DC strings', () => {
    const state = makeFactoryState('MICROINVERTER');

    // Switch micro → string → micro
    getSystemInstance('MICROINVERTER', state);
    getSystemInstance('STRING_INVERTER', state);
    getSystemInstance('MICROINVERTER', state);

    // Run micro calc — must produce no DC strings
    const instance = getSystemInstance('MICROINVERTER', state);
    const result = instance.calculate(makeMicroInput(10));
    expect(result.hasDCStrings).toBe(false);
    expect(result.dcStrings).toHaveLength(0);
  });
});

// ── Test 4: Roof Tech Mini → discrete structural math ────────────────────────

describe('Test 4: Roof Tech Mini mount → discrete load model structural math', () => {
  test('rooftech-mini is in equipment registry', () => {
    const entry = getRegistryEntry('rooftech-mini');
    expect(entry).toBeDefined();
    expect(entry?.manufacturer).toBe('Roof Tech');
  });

  test('rooftech-mini has discrete loadModel', () => {
    const entry = getRegistryEntry('rooftech-mini');
    expect(entry?.structuralSpecs?.loadModel).toBe('discrete');
  });

  test('rooftech-mini has fastenersPerAttachment = 2', () => {
    const entry = getRegistryEntry('rooftech-mini');
    expect(entry?.structuralSpecs?.fastenersPerAttachment).toBe(2);
  });

  test('rooftech-mini structural calc uses effectiveCapacity = upliftCapacity × fastenersPerAttachment', () => {
    const input = makeStructuralInput('rooftech-mini');
    const result = runStructuralCalc(input);

    const entry = getRegistryEntry('rooftech-mini')!;
    const specs = entry.structuralSpecs!;
    const fastenersPerAttachment = specs.fastenersPerAttachment!;
    const upliftCapacity = specs.upliftCapacity!;
    const expectedEffectiveCapacity = upliftCapacity * fastenersPerAttachment;

    // lagBoltCapacity in result should equal effectiveCapacity
    expect(result.attachment.lagBoltCapacity).toBeCloseTo(expectedEffectiveCapacity, 1);
  });

  test('rooftech-mini safetyFactor = effectiveCapacity / upliftPerAttachment', () => {
    const input = makeStructuralInput('rooftech-mini');
    const result = runStructuralCalc(input);

    const expectedSF = result.attachment.lagBoltCapacity / result.attachment.totalUpliftPerAttachment;
    expect(result.attachment.safetyFactor).toBeCloseTo(expectedSF, 2);
  });

  test('rooftech-mini FAIL only if safetyFactor < 2.0', () => {
    const input = makeStructuralInput('rooftech-mini');
    const result = runStructuralCalc(input);

    if (result.attachment.safetyFactor >= 2.0) {
      // Should not have E-ATTACHMENT-SF error
      const sfError = result.errors.find(e => e.code === 'E-ATTACHMENT-SF');
      expect(sfError).toBeUndefined();
    } else {
      // Should have E-ATTACHMENT-SF error
      const sfError = result.errors.find(e => e.code === 'E-ATTACHMENT-SF');
      expect(sfError).toBeDefined();
    }
  });
});

// ── Test 5: IronRidge → previous (distributed) math unchanged ────────────────

describe('Test 5: IronRidge XR100 → distributed load model unchanged', () => {
  test('ironridge-xr100 is in equipment registry', () => {
    const entry = getRegistryEntry('ironridge-xr100');
    expect(entry).toBeDefined();
    expect(entry?.manufacturer).toBe('IronRidge');
  });

  test('ironridge-xr100 does NOT have discrete loadModel', () => {
    const entry = getRegistryEntry('ironridge-xr100');
    // loadModel should be undefined (defaults to 'distributed')
    expect(entry?.structuralSpecs?.loadModel).toBeUndefined();
  });

  test('IronRidge structural calc uses NDS lag bolt withdrawal formula', () => {
    const input = makeStructuralInput('ironridge-xr100');
    const result = runStructuralCalc(input);

    // NDS formula: 305 lbs/inch × 2.5" embedment × 1.6 CD = 1220 lbs
    const expectedLagBoltCapacity = 305 * 2.5 * 1.6;
    expect(result.attachment.lagBoltCapacity).toBeCloseTo(expectedLagBoltCapacity, 1);
  });

  test('IronRidge safetyFactor = lagBoltCapacity / upliftPerAttachment (distributed)', () => {
    const input = makeStructuralInput('ironridge-xr100');
    const result = runStructuralCalc(input);

    const expectedSF = result.attachment.lagBoltCapacity / result.attachment.totalUpliftPerAttachment;
    expect(result.attachment.safetyFactor).toBeCloseTo(expectedSF, 2);
  });

  test('IronRidge result is independent of Roof Tech Mini changes', () => {
    // Run both calcs and verify IronRidge result is unchanged
    const ironRidgeInput = makeStructuralInput('ironridge-xr100');
    const roofTechInput = makeStructuralInput('rooftech-mini');

    const ironRidgeResult = runStructuralCalc(ironRidgeInput);
    const roofTechResult = runStructuralCalc(roofTechInput);

    // IronRidge should use NDS formula (1220 lbs)
    expect(ironRidgeResult.attachment.lagBoltCapacity).toBeCloseTo(1220, 1);

    // Roof Tech should use ICC-ES formula (450 × 2 = 900 lbs)
    expect(roofTechResult.attachment.lagBoltCapacity).toBeCloseTo(900, 1);

    // They must be different
    expect(ironRidgeResult.attachment.lagBoltCapacity).not.toBeCloseTo(
      roofTechResult.attachment.lagBoltCapacity, 0
    );
  });

  test('IronRidge FAIL only if safetyFactor < 2.0 (same threshold as before)', () => {
    const input = makeStructuralInput('ironridge-xr100');
    const result = runStructuralCalc(input);

    if (result.attachment.safetyFactor >= 2.0) {
      const sfError = result.errors.find(e => e.code === 'E-ATTACHMENT-SF');
      expect(sfError).toBeUndefined();
    } else {
      const sfError = result.errors.find(e => e.code === 'E-ATTACHMENT-SF');
      expect(sfError).toBeDefined();
    }
  });
});