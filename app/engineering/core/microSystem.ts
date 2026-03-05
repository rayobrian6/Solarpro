// ============================================================
// MicroSystem — Microinverter Topology Engine
// AC-only model. NO DC strings. NO DC OCPD. NO Voc/Isc.
// branchCurrent = sum(inverter.outputCurrent per branch)
// continuousLoad = branchCurrent × 1.25
// conductorAmpacity ≥ continuousLoad
// breakerSize from manufacturer maxBranchRating
// ============================================================

import { getRegistryEntry } from '@/lib/equipment-registry';

// ── Types ─────────────────────────────────────────────────────────────────

export interface MicroInverterDevice {
  id: string;
  moduleIndex: number;       // 0-based module position
  inverterId: string;        // equipment-registry ID
  outputCurrent: number;     // A (from registry electricalSpecs)
  outputVoltage: number;     // V (typically 240)
  outputPowerW: number;      // W
  multiModule: boolean;      // true if one device serves >1 module
  modulesPerDevice: number;  // 1 for IQ8+, 2 for HM-600, 4 for QS1
}

export interface MicroBranch {
  id: string;
  branchIndex: number;
  devices: MicroInverterDevice[];
  branchCurrent: number;     // A = sum(device.outputCurrent)
  continuousLoad: number;    // A = branchCurrent × 1.25
  conductorAmpacity: number; // A ≥ continuousLoad
  breakerAmps: number;       // from manufacturer maxBranchRating
  conductorGauge: string;    // e.g. "#10 AWG"
  passes: boolean;
}

export interface MicroElectricalResult {
  topologyType: 'MICROINVERTER';
  // DC side — always empty for microinverter
  dcStrings: never[];
  hasDCStrings: false;
  dcStringOCPD: null;
  dcConductors: null;
  // AC side
  branches: MicroBranch[];
  totalDevices: number;
  totalBranchCurrent: number;   // sum across all branches
  totalACOutputCurrent: number; // A (for busbar calc)
  totalACOutputKw: number;      // kW
  // Conductor sizing
  acConductorGauge: string;
  acConductorCallout: string;
  acContinuousLoad: number;
  // Compliance
  passes: boolean;
  issues: MicroIssue[];
}

export interface MicroIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  necReference?: string;
}

// ── Registry Lookup Helpers ───────────────────────────────────────────────

interface MicroRegistrySpecs {
  outputCurrentA: number;
  outputVoltageV: number;
  outputPowerW: number;
  maxBranchRatingA: number;
  modulesPerDevice: number;
  multiModule: boolean;
}

function getMicroSpecs(inverterId: string): MicroRegistrySpecs {
  const entry = getRegistryEntry(inverterId);

  // Defaults (Enphase IQ8+ baseline)
  const defaults: MicroRegistrySpecs = {
    outputCurrentA: 1.21,
    outputVoltageV: 240,
    outputPowerW: 290,
    maxBranchRatingA: 20,
    modulesPerDevice: 1,
    multiModule: false,
  };

  if (!entry) return defaults;

  const specs = entry.electricalSpecs as any;

  return {
    outputCurrentA: specs?.acOutputCurrentA ?? specs?.outputCurrentA ?? defaults.outputCurrentA,
    outputVoltageV: specs?.acOutputVoltageV ?? specs?.outputVoltageV ?? defaults.outputVoltageV,
    outputPowerW: specs?.acOutputW ?? specs?.outputPowerW ?? defaults.outputPowerW,
    maxBranchRatingA: specs?.maxBranchRatingA ?? specs?.maxBranchOCPD ?? defaults.maxBranchRatingA,
    modulesPerDevice: specs?.modulesPerDevice ?? (entry as any).modulesPerDevice ?? 1,
    multiModule: specs?.multiModule ?? (entry as any).multiModule ?? false,
  };
}

// ── Conductor sizing table (NEC 310.15, 75°C THWN-2 copper) ──────────────

const CONDUCTOR_TABLE: Array<{ gauge: string; ampacity: number }> = [
  { gauge: '#14 AWG', ampacity: 15 },
  { gauge: '#12 AWG', ampacity: 20 },
  { gauge: '#10 AWG', ampacity: 30 },
  { gauge: '#8 AWG',  ampacity: 50 },
  { gauge: '#6 AWG',  ampacity: 65 },
  { gauge: '#4 AWG',  ampacity: 85 },
  { gauge: '#3 AWG',  ampacity: 100 },
  { gauge: '#2 AWG',  ampacity: 115 },
  { gauge: '#1 AWG',  ampacity: 130 },
  { gauge: '#1/0 AWG', ampacity: 150 },
  { gauge: '#2/0 AWG', ampacity: 175 },
  { gauge: '#3/0 AWG', ampacity: 200 },
  { gauge: '#4/0 AWG', ampacity: 230 },
];

function selectConductor(requiredAmpacity: number): { gauge: string; ampacity: number } {
  for (const row of CONDUCTOR_TABLE) {
    if (row.ampacity >= requiredAmpacity) return row;
  }
  return CONDUCTOR_TABLE[CONDUCTOR_TABLE.length - 1];
}

// ── Main MicroSystem Calculation ──────────────────────────────────────────

export interface MicroSystemInput {
  inverterId: string;
  moduleCount: number;
  systemVoltage?: number;    // V (default 240)
  acRunLength?: number;      // ft (for voltage drop, future use)
  conduitType?: string;
}

export function calcMicroSystem(input: MicroSystemInput): MicroElectricalResult {
  const { inverterId, moduleCount } = input;
  const issues: MicroIssue[] = [];

  // 1. Get specs from registry — NO brand conditionals
  const specs = getMicroSpecs(inverterId);
  const { outputCurrentA, outputVoltageV, outputPowerW, maxBranchRatingA, modulesPerDevice } = specs;

  // 2. Create one device per module (or per modulesPerDevice if multiModule)
  const devices: MicroInverterDevice[] = [];
  const deviceCount = Math.ceil(moduleCount / modulesPerDevice);

  for (let i = 0; i < deviceCount; i++) {
    devices.push({
      id: `micro-dev-${i}`,
      moduleIndex: i * modulesPerDevice,
      inverterId,
      outputCurrent: outputCurrentA,
      outputVoltage: outputVoltageV,
      outputPowerW: outputPowerW * modulesPerDevice,
      multiModule: specs.multiModule,
      modulesPerDevice,
    });
  }

  // 3. Group devices into branches
  // Max devices per branch = floor(maxBranchRatingA / (outputCurrentA × 1.25))
  const maxDevicesPerBranch = Math.floor(maxBranchRatingA / (outputCurrentA * 1.25));
  const safeMaxPerBranch = Math.max(1, maxDevicesPerBranch);

  const branches: MicroBranch[] = [];
  let deviceIdx = 0;
  let branchIdx = 0;

  while (deviceIdx < devices.length) {
    const branchDevices = devices.slice(deviceIdx, deviceIdx + safeMaxPerBranch);
    deviceIdx += safeMaxPerBranch;

    // branchCurrent = sum(device.outputCurrent) — NEC 690.8
    const branchCurrent = branchDevices.reduce((sum, d) => sum + d.outputCurrent, 0);

    // continuousLoad = branchCurrent × 1.25 — NEC 690.8(A)(1)
    const continuousLoad = branchCurrent * 1.25;

    // Conductor must be ≥ continuousLoad
    const conductor = selectConductor(continuousLoad);

    // Breaker from manufacturer maxBranchRating (NEC 690.9)
    const breakerAmps = maxBranchRatingA;

    const branchPasses = conductor.ampacity >= continuousLoad && breakerAmps >= continuousLoad;

    if (!branchPasses) {
      issues.push({
        code: 'MICRO_BRANCH_OVERLOAD',
        severity: 'error',
        message: `Branch ${branchIdx + 1}: conductor ampacity (${conductor.ampacity}A) < continuous load (${continuousLoad.toFixed(1)}A)`,
        necReference: 'NEC 690.8(A)(1)',
      });
    }

    branches.push({
      id: `branch-${branchIdx}`,
      branchIndex: branchIdx,
      devices: branchDevices,
      branchCurrent,
      continuousLoad,
      conductorAmpacity: conductor.ampacity,
      breakerAmps,
      conductorGauge: conductor.gauge,
      passes: branchPasses,
    });

    branchIdx++;
  }

  // 4. AC feeder sizing (from combiner to panel)
  const totalBranchCurrent = branches.reduce((sum, b) => sum + b.branchCurrent, 0);
  const acContinuousLoad = totalBranchCurrent * 1.25;
  const acConductor = selectConductor(acContinuousLoad);
  const totalACOutputKw = (deviceCount * outputPowerW) / 1000;

  // 5. Compliance check
  const allBranchesPassed = branches.every(b => b.passes);
  if (!allBranchesPassed) {
    issues.push({
      code: 'MICRO_BRANCH_FAIL',
      severity: 'error',
      message: 'One or more AC branches failed conductor sizing',
      necReference: 'NEC 690.8',
    });
  }

  return {
    topologyType: 'MICROINVERTER',
    // DC side — explicitly empty, never populated
    dcStrings: [],
    hasDCStrings: false,
    dcStringOCPD: null,
    dcConductors: null,
    // AC side
    branches,
    totalDevices: deviceCount,
    totalBranchCurrent,
    totalACOutputCurrent: totalBranchCurrent,
    totalACOutputKw,
    // Conductor
    acConductorGauge: acConductor.gauge,
    acConductorCallout: `2${acConductor.gauge} THWN-2 + 1#10 AWG GND in ${input.conduitType ?? 'EMT'}`,
    acContinuousLoad,
    // Compliance
    passes: allBranchesPassed,
    issues,
  };
}