// ============================================================
// ECOFLOW BOM DERIVATION — v47.358
// lib/ecoflow-bom.ts
//
// Derives EcoFlow-specific BOM items (battery modules, base/stack,
// combiner, smart meter, monitoring) for systems using the 'ecoflow'
// topology. Returns items in the same shape as bom-system-profiles
// (StructuralBOMItem-style) so they can be merged into V4 via
// injectStructuralIntoV4() in app/api/engineering/bom/route.ts.
//
// MASTER TASK RULES:
//   - This module derives items from systemDefinition inputs only.
//   - No hardcoded counts — all quantities come from sizing helpers.
//   - V4 still owns inverter line item. This adds batteries + accessories.
// ============================================================

import type { BOMStageId } from './bom-engine-v4';
import type { StructuralBOMItem } from './bom-system-profiles';
import {
  ECOFLOW_BATTERY_MODULE,
  ECOFLOW_ACCESSORIES,
  sizeEcoFlowBattery,
  isEcoFlowInverter,
  getEcoFlowInverterById,
} from './ecoflow-system';

export interface EcoFlowBOMInput {
  inverterId: string;                   // e.g. 'ecoflow-power-ocean-10kw'
  batteryEnabled: boolean;              // user toggle
  targetBatteryKwh?: number;            // user-specified target; default 10
  usePro?: boolean;                     // Pro stack (80 kWh) vs standard (45 kWh)
  moduleCount: number;                  // # of PV panels (for context/logging)
}

export interface EcoFlowBOMResult {
  items: StructuralBOMItem[];
  derivationLog: string[];
  batteryConfig: {
    moduleCount: number;
    totalKwh: number;
    stackType: 'standard' | 'pro';
  } | null;
}

/**
 * Derive EcoFlow accessory + battery BOM items.
 * Caller should also ensure the V4 engine receives the EcoFlow inverterId
 * and (if battery enabled) batteryId='ecoflow-battery-5kwh' with batteryCount.
 */
export function deriveEcoFlowBOM(input: EcoFlowBOMInput): EcoFlowBOMResult {
  const log: string[] = [];
  const items: StructuralBOMItem[] = [];

  if (!isEcoFlowInverter(input.inverterId)) {
    log.push(`Not an EcoFlow inverter (${input.inverterId}) — skipping EcoFlow BOM derivation`);
    return { items, derivationLog: log, batteryConfig: null };
  }

  const inverterSpec = getEcoFlowInverterById(input.inverterId);
  if (!inverterSpec) {
    log.push(`EcoFlow inverter not found in catalog: ${input.inverterId}`);
    return { items, derivationLog: log, batteryConfig: null };
  }

  log.push(`EcoFlow system: inverter=${inverterSpec.model} (${inverterSpec.acKw}kW, ${inverterSpec.mpptCount} MPPT)`);

  // ─── Battery modules ────────────────────────────────────────
  let batteryConfig = null;
  if (input.batteryEnabled) {
    const battery = sizeEcoFlowBattery(input.targetBatteryKwh, input.usePro);
    batteryConfig = battery;
    log.push(`Battery sizing: ${battery.moduleCount} modules = ${battery.totalKwh} kWh (${battery.stackType} stack)`);

    // Note: V4 engine can handle the battery line item via batteryId + batteryCount.
    // Here we emit accessory items (base, combiner) that V4 doesn't know about.

    const stage: BOMStageId = 'inverter';  // batteries/accessories live in the inverter stage

    // Battery base / stack frame (1 per system)
    const baseSpec = ECOFLOW_ACCESSORIES.find(a => a.category === 'battery_base');
    if (baseSpec) {
      items.push({
        stageId: stage,
        category: 'battery_base',
        manufacturer: baseSpec.manufacturer,
        model: baseSpec.model,
        partNumber: baseSpec.partNumber,
        description: baseSpec.description,
        quantity: 1,
        unit: 'ea',
        derivedFrom: 'EcoFlow battery stack — 1 base per installation',
        required: baseSpec.required,
      });
    }

    // Battery combiner box (1 per system)
    const combinerSpec = ECOFLOW_ACCESSORIES.find(a => a.category === 'battery_combiner');
    if (combinerSpec) {
      items.push({
        stageId: stage,
        category: 'battery_combiner',
        manufacturer: combinerSpec.manufacturer,
        model: combinerSpec.model,
        partNumber: combinerSpec.partNumber,
        description: combinerSpec.description,
        quantity: 1,
        unit: 'ea',
        derivedFrom: 'EcoFlow battery stack — 1 combiner per installation',
        required: combinerSpec.required,
      });
    }
  } else {
    log.push('Battery disabled — no battery BOM items emitted');
  }

  // ─── Smart meter (always required for grid-tie with export monitoring) ─
  const smartMeterSpec = ECOFLOW_ACCESSORIES.find(a => a.category === 'smart_meter');
  if (smartMeterSpec) {
    items.push({
      stageId: 'monitoring' as BOMStageId,
      category: 'smart_meter',
      manufacturer: smartMeterSpec.manufacturer,
      model: smartMeterSpec.model,
      partNumber: smartMeterSpec.partNumber,
      description: smartMeterSpec.description,
      quantity: 1,
      unit: 'ea',
      derivedFrom: 'EcoFlow hybrid system — 1 CT meter per installation (NEC 705.12)',
      required: smartMeterSpec.required,
    });
  }

  // ─── Monitoring gateway ────────────────────────────────────
  const gatewaySpec = ECOFLOW_ACCESSORIES.find(a => a.category === 'monitoring');
  if (gatewaySpec) {
    items.push({
      stageId: 'monitoring' as BOMStageId,
      category: 'monitoring_gateway',
      manufacturer: gatewaySpec.manufacturer,
      model: gatewaySpec.model,
      partNumber: gatewaySpec.partNumber,
      description: gatewaySpec.description,
      quantity: 1,
      unit: 'ea',
      derivedFrom: 'EcoFlow hybrid system — 1 gateway per installation',
      required: gatewaySpec.required,
    });
  }

  log.push(`EcoFlow BOM emitted ${items.length} items`);
  return { items, derivationLog: log, batteryConfig };
}

/**
 * Filter function: drops microinverter-specific items from a BOM.
 * Used when topology is 'ecoflow' to enforce the hard rule "no micro mixing".
 */
export const MICRO_ONLY_CATEGORIES = new Set([
  'microinverter',
  'trunk_cable',
  'terminator',
]);

export function filterOutMicroItems<T extends { category: string; description?: string }>(
  items: T[],
): { kept: T[]; removed: T[] } {
  const kept: T[] = [];
  const removed: T[] = [];
  for (const item of items) {
    if (MICRO_ONLY_CATEGORIES.has(item.category)) {
      removed.push(item);
      continue;
    }
    kept.push(item);
  }
  return { kept, removed };
}