/**
 * EQUIPMENT LIBRARY — Unified Equipment Resolver
 *
 * Bridges two equipment data sources:
 *   1. equipment-db.ts  — Engineering-grade specs (Voc, Isc, tempCoeff, etc.)
 *   2. db.ts            — User Equipment Library (pricePerWatt, dimensions, user edits)
 *
 * Priority: equipment-db.ts for electrical specs, db.ts for pricing/dimensions
 *
 * Usage:
 *   import { getUnifiedPanel, getUnifiedInverter, mergeEquipmentLibraries } from '@/lib/equipment-library';
 */

import {
  SOLAR_PANELS as ENG_PANELS,
  STRING_INVERTERS as ENG_STRING_INVERTERS,
  MICROINVERTERS as ENG_MICROINVERTERS,
  OPTIMIZERS as ENG_OPTIMIZERS,
  BATTERIES as ENG_BATTERIES,
  type SolarPanel as EngPanel,
  type StringInverter as EngInverter,
  type Microinverter as EngMicro,
} from './equipment-db';

import type { SolarPanel as LibPanel, Inverter as LibInverter, Battery as LibBattery } from '@/types';

// ─── Unified Panel Type ────────────────────────────────────────────────────────
// Merges engineering specs + library pricing/dimensions
export interface UnifiedPanel {
  // Identity
  id: string;
  manufacturer: string;
  model: string;

  // Layout / visual (from lib panel or derived from eng panel)
  wattage: number;          // Wp
  width: number;            // meters
  height: number;           // meters
  efficiency: number;       // %
  bifacial: boolean;
  bifacialFactor: number;
  temperatureCoeff: number; // %/°C

  // Pricing (from lib panel)
  pricePerWatt: number;

  // Engineering specs (from eng panel — may be undefined for custom panels)
  voc?: number;
  vmp?: number;
  isc?: number;
  imp?: number;
  tempCoeffVoc?: number;
  tempCoeffIsc?: number;
  tempCoeffPmax?: number;
  maxSystemVoltage?: number;
  maxSeriesFuseRating?: number;
  nominalOperatingTemp?: number;
  parallelStringLimit?: number;

  // Metadata
  warranty?: number;
  cellType?: string;
  datasheetUrl?: string;
  isActive?: boolean;
  isCustom?: boolean;
  source: 'engineering' | 'library' | 'merged';
}

// ─── Unified Inverter Type ─────────────────────────────────────────────────────
export interface UnifiedInverter {
  id: string;
  manufacturer: string;
  model: string;
  type: 'string' | 'micro' | 'optimizer' | 'hybrid';
  capacity: number;         // kW
  efficiency: number;       // %
  pricePerUnit: number;
  warranty?: number;
  mpptChannels?: number;
  batteryCompatible?: boolean;
  datasheetUrl?: string;
  isActive?: boolean;
  isCustom?: boolean;
  source: 'engineering' | 'library' | 'merged';
}

// ─── Convert engineering panel → unified panel ─────────────────────────────────
function engPanelToUnified(p: EngPanel, libPanel?: LibPanel): UnifiedPanel {
  // Convert inches → meters for dimensions
  const widthM  = libPanel?.width  ?? (p.width  / 39.3701);
  const heightM = libPanel?.height ?? (p.length / 39.3701);

  return {
    id:               p.id,
    manufacturer:     p.manufacturer,
    model:            p.model,
    wattage:          p.watts,
    width:            widthM,
    height:           heightM,
    efficiency:       p.efficiency,
    bifacial:         p.bifacial,
    bifacialFactor:   libPanel?.bifacialFactor ?? 1.0,
    temperatureCoeff: p.tempCoeffPmax,
    pricePerWatt:     libPanel?.pricePerWatt ?? 0.35,
    // Engineering specs
    voc:                   p.voc,
    vmp:                   p.vmp,
    isc:                   p.isc,
    imp:                   p.imp,
    tempCoeffVoc:          p.tempCoeffVoc,
    tempCoeffIsc:          p.tempCoeffIsc,
    tempCoeffPmax:         p.tempCoeffPmax,
    maxSystemVoltage:      p.maxSystemVoltage,
    maxSeriesFuseRating:   p.maxSeriesFuseRating,
    nominalOperatingTemp:  p.nominalOperatingTemp,
    parallelStringLimit:   p.parallelStringLimit,
    // Metadata
    warranty:     libPanel?.warranty ?? (parseInt(p.warranty) || 25),
    cellType:     libPanel?.cellType ?? p.cellType,
    datasheetUrl: libPanel?.datasheetUrl ?? p.datasheetUrl,
    isActive:     libPanel?.isActive ?? true,
    isCustom:     false,
    source:       libPanel ? 'merged' : 'engineering',
  };
}

// ─── Convert library panel → unified panel ─────────────────────────────────────
function libPanelToUnified(p: LibPanel): UnifiedPanel {
  return {
    id:               p.id,
    manufacturer:     p.manufacturer,
    model:            p.model,
    wattage:          p.wattage,
    width:            p.width,
    height:           p.height,
    efficiency:       p.efficiency,
    bifacial:         p.bifacial,
    bifacialFactor:   p.bifacialFactor,
    temperatureCoeff: p.temperatureCoeff,
    pricePerWatt:     p.pricePerWatt,
    warranty:         p.warranty,
    cellType:         p.cellType,
    datasheetUrl:     p.datasheetUrl,
    isActive:         p.isActive ?? true,
    isCustom:         p.isCustom ?? true,
    source:           'library',
  };
}

// ─── Convert engineering inverter → unified inverter ──────────────────────────
function engInverterToUnified(inv: EngInverter, libInv?: LibInverter): UnifiedInverter {
  return {
    id:               inv.id,
    manufacturer:     inv.manufacturer,
    model:            inv.model,
    type:             'string',
    capacity:         inv.acOutputKw,
    efficiency:       inv.cec_efficiency ?? inv.efficiency ?? 97,
    pricePerUnit:     libInv?.pricePerUnit ?? 0,
    warranty:         libInv?.warranty ?? (parseInt(inv.warranty) || 10),
    mpptChannels:     inv.mpptChannels,
    batteryCompatible: false,
    datasheetUrl:     libInv?.datasheetUrl ?? inv.datasheetUrl,
    isActive:         libInv?.isActive ?? true,
    isCustom:         false,
    source:           libInv ? 'merged' : 'engineering',
  };
}

function engMicroToUnified(inv: EngMicro, libInv?: LibInverter): UnifiedInverter {
  return {
    id:               inv.id,
    manufacturer:     inv.manufacturer,
    model:            inv.model,
    type:             'micro',
    capacity:         inv.acOutputW / 1000,
    efficiency:       inv.cec_efficiency ?? inv.efficiency ?? 96,
    pricePerUnit:     libInv?.pricePerUnit ?? 0,
    warranty:         libInv?.warranty ?? (parseInt(inv.warranty) || 25),
    mpptChannels:     1,
    batteryCompatible: false,
    datasheetUrl:     libInv?.datasheetUrl ?? inv.datasheetUrl,
    isActive:         libInv?.isActive ?? true,
    isCustom:         false,
    source:           libInv ? 'merged' : 'engineering',
  };
}

// ─── Main API ──────────────────────────────────────────────────────────────────

/**
 * Get all panels merged from engineering DB + user library
 * Engineering DB panels get pricing/dimensions from library if available
 */
export function getAllUnifiedPanels(libPanels: LibPanel[] = []): UnifiedPanel[] {
  const libMap = new Map(libPanels.map(p => [p.id, p]));
  const result: UnifiedPanel[] = [];
  const seenIds = new Set<string>();

  // First: engineering panels (with library overlay if available)
  for (const ep of ENG_PANELS) {
    const libPanel = libMap.get(ep.id);
    result.push(engPanelToUnified(ep, libPanel));
    seenIds.add(ep.id);
  }

  // Second: library-only panels (custom user panels not in engineering DB)
  for (const lp of libPanels) {
    if (!seenIds.has(lp.id)) {
      result.push(libPanelToUnified(lp));
    }
  }

  return result.filter(p => p.isActive !== false);
}

/**
 * Get all inverters merged from engineering DB + user library
 */
export function getAllUnifiedInverters(libInverters: LibInverter[] = []): UnifiedInverter[] {
  const libMap = new Map(libInverters.map(i => [i.id, i]));
  const result: UnifiedInverter[] = [];
  const seenIds = new Set<string>();

  // String inverters
  for (const inv of ENG_STRING_INVERTERS) {
    const libInv = libMap.get(inv.id);
    result.push(engInverterToUnified(inv, libInv));
    seenIds.add(inv.id);
  }

  // Microinverters
  for (const inv of ENG_MICROINVERTERS) {
    const libInv = libMap.get(inv.id);
    result.push(engMicroToUnified(inv, libInv));
    seenIds.add(inv.id);
  }

  // Library-only inverters (custom)
  for (const li of libInverters) {
    if (!seenIds.has(li.id)) {
      result.push({
        id:               li.id,
        manufacturer:     li.manufacturer,
        model:            li.model,
        type:             li.type as any,
        capacity:         li.capacity,
        efficiency:       li.efficiency,
        pricePerUnit:     li.pricePerUnit,
        warranty:         li.warranty,
        mpptChannels:     li.mpptChannels,
        batteryCompatible: li.batteryCompatible,
        datasheetUrl:     li.datasheetUrl,
        isActive:         li.isActive ?? true,
        isCustom:         li.isCustom ?? true,
        source:           'library',
      });
    }
  }

  return result.filter(i => i.isActive !== false);
}

/**
 * Get a single unified panel by ID
 * Checks engineering DB first, then library
 */
export function getUnifiedPanelById(id: string, libPanels: LibPanel[] = []): UnifiedPanel | undefined {
  const engPanel = ENG_PANELS.find(p => p.id === id);
  const libPanel = libPanels.find(p => p.id === id);

  if (engPanel) return engPanelToUnified(engPanel, libPanel);
  if (libPanel) return libPanelToUnified(libPanel);
  return undefined;
}

/**
 * Get a single unified inverter by ID
 */
export function getUnifiedInverterById(id: string, libInverters: LibInverter[] = []): UnifiedInverter | undefined {
  const engInv = ENG_STRING_INVERTERS.find(i => i.id === id);
  const engMicro = ENG_MICROINVERTERS.find(i => i.id === id);
  const libInv = libInverters.find(i => i.id === id);

  if (engInv) return engInverterToUnified(engInv, libInv);
  if (engMicro) return engMicroToUnified(engMicro, libInv);
  if (libInv) return {
    id: libInv.id,
    manufacturer: libInv.manufacturer,
    model: libInv.model,
    type: libInv.type as any,
    capacity: libInv.capacity,
    efficiency: libInv.efficiency,
    pricePerUnit: libInv.pricePerUnit,
    warranty: libInv.warranty,
    mpptChannels: libInv.mpptChannels,
    batteryCompatible: libInv.batteryCompatible,
    datasheetUrl: libInv.datasheetUrl,
    isActive: libInv.isActive ?? true,
    isCustom: libInv.isCustom ?? true,
    source: 'library',
  };
  return undefined;
}

/**
 * Calculate material cost for a panel based on its price
 * Used by the pricing engine for cost-plus calculations
 */
export function calcPanelMaterialCost(panelId: string, panelCount: number, libPanels: LibPanel[] = []): number {
  const panel = getUnifiedPanelById(panelId, libPanels);
  if (!panel) return 0;
  return panel.pricePerWatt * panel.wattage * panelCount;
}

/**
 * Get panel display name
 */
export function getPanelDisplayName(panel: UnifiedPanel): string {
  return `${panel.manufacturer} ${panel.model} (${panel.wattage}W)`;
}

/**
 * Get inverter display name
 */
export function getInverterDisplayName(inv: UnifiedInverter): string {
  return `${inv.manufacturer} ${inv.model} (${inv.capacity}kW)`;
}