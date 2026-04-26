// ============================================================
// ECOFLOW SYSTEM PROFILE — v47.358
// lib/ecoflow-system.ts
//
// EcoFlow is a FULL ELECTRICAL + STORAGE system, not just a battery:
//   - Hybrid inverter (5kW / 10kW / 20kW variants)
//   - Stackable 5kWh battery modules (max 45kWh std, 80kWh pro)
//   - Base/stack hardware
//   - Smart meter / monitoring
//   - Auto-sizing driven by systemDefinition.totalDcKw
//
// Default baseline for SolFence projects (can be overridden by user).
//
// MASTER TASK RULES:
//   - BOM must NEVER select equipment — this file provides the *profile*,
//     the caller (BOM engine / engineering page) decides to use it.
//   - User selections always win. This is a DEFAULT only.
//   - EcoFlow is incompatible with microinverters (enforced in validation).
// ============================================================

// ─── Inverter catalog ──────────────────────────────────────────
export interface EcoFlowInverterSpec {
  id: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  acKw: number;            // AC output kW
  dcKwMax: number;         // DC input max kW
  mpptCount: number;       // # of MPPT channels
  mpptVoltageMin: number;
  mpptVoltageMax: number;
  acOutputVoltage: number;
  efficiency: number;      // decimal (0.975 = 97.5%)
  batteryCompatible: boolean;
  topologyType: 'HYBRID_INVERTER';
  datasheetUrl?: string;
}

export const ECOFLOW_INVERTERS: EcoFlowInverterSpec[] = [
  {
    id: 'ecoflow-power-ocean-5kw',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean 5kW Hybrid',
    partNumber: 'EF-PO-5K-HV',
    acKw: 5.0,
    dcKwMax: 7.5,
    mpptCount: 2,
    mpptVoltageMin: 80,
    mpptVoltageMax: 550,
    acOutputVoltage: 240,
    efficiency: 0.975,
    batteryCompatible: true,
    topologyType: 'HYBRID_INVERTER',
    datasheetUrl: 'https://us.ecoflow.com/products/powerocean',
  },
  {
    id: 'ecoflow-power-ocean-10kw',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean 10kW Hybrid',
    partNumber: 'EF-PO-10K-HV',
    acKw: 10.0,
    dcKwMax: 15.0,
    mpptCount: 3,
    mpptVoltageMin: 120,
    mpptVoltageMax: 600,
    acOutputVoltage: 240,
    efficiency: 0.978,
    batteryCompatible: true,
    topologyType: 'HYBRID_INVERTER',
    datasheetUrl: 'https://us.ecoflow.com/products/powerocean',
  },
  {
    id: 'ecoflow-power-ocean-20kw',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean Pro 20kW Hybrid',
    partNumber: 'EF-PO-20K-HV-PRO',
    acKw: 20.0,
    dcKwMax: 30.0,
    mpptCount: 4,
    mpptVoltageMin: 120,
    mpptVoltageMax: 1000,
    acOutputVoltage: 240,
    efficiency: 0.980,
    batteryCompatible: true,
    topologyType: 'HYBRID_INVERTER',
    datasheetUrl: 'https://us.ecoflow.com/products/powerocean-pro',
  },
];

// ─── Battery module ────────────────────────────────────────────
export interface EcoFlowBatteryModuleSpec {
  id: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  capacityKwh: number;
  chemistry: string;
  nominalVoltage: number;
  warrantyYears: number;
  datasheetUrl?: string;
}

export const ECOFLOW_BATTERY_MODULE: EcoFlowBatteryModuleSpec = {
  id: 'ecoflow-battery-5kwh',
  manufacturer: 'EcoFlow',
  model: 'PowerOcean LFP Battery Module (5kWh)',
  partNumber: 'EF-BATT-5K-LFP',
  capacityKwh: 5,
  chemistry: 'LFP (LiFePO4)',
  nominalVoltage: 51.2,
  warrantyYears: 15,
  datasheetUrl: 'https://us.ecoflow.com/products/powerocean',
};

// ─── Accessories ───────────────────────────────────────────────
export interface EcoFlowAccessorySpec {
  id: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  category: string;     // 'battery_base' | 'battery_combiner' | 'smart_meter' | 'monitoring'
  description: string;
  required: boolean;
  qtyRule: 'perSystem' | 'perInverter' | 'perBatteryStack';
}

export const ECOFLOW_ACCESSORIES: EcoFlowAccessorySpec[] = [
  {
    id: 'ecoflow-battery-base',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean Battery Base / Stack Frame',
    partNumber: 'EF-BATT-BASE',
    category: 'battery_base',
    description: 'Stackable battery module mounting base with wheels',
    required: true,
    qtyRule: 'perBatteryStack',
  },
  {
    id: 'ecoflow-battery-combiner',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean Battery Combiner Box',
    partNumber: 'EF-BATT-COMB',
    category: 'battery_combiner',
    description: 'DC combiner / disconnect for battery stack',
    required: true,
    qtyRule: 'perBatteryStack',
  },
  {
    id: 'ecoflow-smart-meter',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean Smart Meter (CT-based)',
    partNumber: 'EF-SMART-METER',
    category: 'smart_meter',
    description: 'Bidirectional CT meter for grid import/export monitoring',
    required: true,
    qtyRule: 'perSystem',
  },
  {
    id: 'ecoflow-monitoring-gateway',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean Monitoring Gateway',
    partNumber: 'EF-MON-GW',
    category: 'monitoring',
    description: 'Wi-Fi/LTE gateway for EcoFlow app monitoring',
    required: true,
    qtyRule: 'perSystem',
  },
];

// ─── System-level spec (used by systemEquipmentResolver) ───────
export interface EcoFlowSystemSpec {
  inverterOptions: EcoFlowInverterSpec[];
  batteryModule: EcoFlowBatteryModuleSpec;
  accessories: EcoFlowAccessorySpec[];
  maxBatteryStackKwh: {
    standard: number;
    pro: number;
  };
  defaultTargetBatteryKwh: number;
}

export const ECOFLOW_SYSTEM: EcoFlowSystemSpec = {
  inverterOptions: ECOFLOW_INVERTERS,
  batteryModule: ECOFLOW_BATTERY_MODULE,
  accessories: ECOFLOW_ACCESSORIES,
  maxBatteryStackKwh: {
    standard: 45,
    pro: 80,
  },
  defaultTargetBatteryKwh: 10,
};

// ─── Auto-sizing helpers ───────────────────────────────────────

/**
 * Select an EcoFlow inverter model based on total DC kW from systemDefinition.
 * Rules per MASTER TASK:
 *   ≤ 6kW       → 5kW
 *   6–12kW      → 10kW
 *   > 12kW      → 20kW
 */
export function sizeEcoFlowInverter(totalDcKw: number): EcoFlowInverterSpec {
  if (totalDcKw <= 6) return ECOFLOW_INVERTERS[0]; // 5kW
  if (totalDcKw <= 12) return ECOFLOW_INVERTERS[1]; // 10kW
  return ECOFLOW_INVERTERS[2]; // 20kW
}

/**
 * Size the battery stack.
 * Default: target = 10kWh, floor = 2 modules (10kWh), cap at 45kWh standard.
 * Returns module count (each = 5kWh).
 */
export function sizeEcoFlowBattery(targetKwh?: number, usePro = false): {
  moduleCount: number;
  totalKwh: number;
  stackType: 'standard' | 'pro';
} {
  const target = Math.max(ECOFLOW_SYSTEM.defaultTargetBatteryKwh, targetKwh ?? 0);
  const stackType: 'standard' | 'pro' = usePro ? 'pro' : 'standard';
  const maxKwh = ECOFLOW_SYSTEM.maxBatteryStackKwh[stackType];
  const clampedKwh = Math.min(target, maxKwh);
  const moduleCount = Math.ceil(clampedKwh / ECOFLOW_BATTERY_MODULE.capacityKwh);
  return {
    moduleCount,
    totalKwh: moduleCount * ECOFLOW_BATTERY_MODULE.capacityKwh,
    stackType,
  };
}

/**
 * Distribute panels across MPPT inputs.
 * EcoFlow is a string-based system — each MPPT gets one string.
 */
export function distributeEcoFlowStrings(moduleCount: number, mpptCount: number): {
  strings: number;
  panelsPerMppt: number;
  remainderPanels: number;
} {
  if (moduleCount <= 0 || mpptCount <= 0) {
    return { strings: 0, panelsPerMppt: 0, remainderPanels: 0 };
  }
  const panelsPerMppt = Math.ceil(moduleCount / mpptCount);
  const remainderPanels = moduleCount - (panelsPerMppt * (mpptCount - 1));
  return {
    strings: mpptCount,
    panelsPerMppt,
    remainderPanels: Math.max(0, remainderPanels),
  };
}

// ─── Helpers for consumers ─────────────────────────────────────

export function isEcoFlowInverter(inverterId?: string): boolean {
  if (!inverterId) return false;
  return inverterId.startsWith('ecoflow-');
}

export function getEcoFlowInverterById(id: string): EcoFlowInverterSpec | undefined {
  return ECOFLOW_INVERTERS.find(i => i.id === id);
}

/**
 * Full default configuration for a SolFence + EcoFlow baseline system.
 * Given panel count + kW, returns inverter + battery recommendation.
 */
export function solFenceEcoFlowDefaults(params: {
  totalDcKw: number;
  moduleCount: number;
  targetBatteryKwh?: number;
  usePro?: boolean;
}) {
  const inverter = sizeEcoFlowInverter(params.totalDcKw);
  const battery = sizeEcoFlowBattery(params.targetBatteryKwh, params.usePro);
  const strings = distributeEcoFlowStrings(params.moduleCount, inverter.mpptCount);
  return {
    inverter,
    battery,
    strings,
    batteryModule: ECOFLOW_BATTERY_MODULE,
    accessories: ECOFLOW_ACCESSORIES,
  };
}