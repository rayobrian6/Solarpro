// ============================================================
// MULTI-ARRAY ENGINE  —  v47.182
// ============================================================
// Converts any Layout (single or hybrid) into a typed array
// collection and computes per-array production.
//
// DESIGN RULES:
//   roof   — standard tilt, roof-plane azimuth, monofacial default
//   ground — optimal tilt (≈ latitude), south azimuth, potentially best efficiency
//   fence  — tilt=90°, E/W or user azimuth, bifacial gain 10–25%
//   carport— like ground but shaded from below; slight de-rate
//
// FENCE PRODUCTION MODEL:
//   base_factor = 0.72–0.85 of equivalent optimal-tilt system
//   bifacial_gain = +10% to +25% (environment-dependent)
//   net = base_kwh × fence_efficiency × (1 + bifacial_gain)
// ============================================================

import type { Layout, PlacedPanel, SolarArray, SystemConfig, ArrayMountType } from '@/types';
import { calculateProductionLocal } from './pvwatts';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Fence efficiency factor vs optimal-tilt roof (vertical 90° tilt penalty) */
const FENCE_EFFICIENCY_FACTOR = 0.78; // midpoint of 0.72–0.85

/** Default bifacial gain for fence arrays (10–25%; use 15% conservative) */
const FENCE_BIFACIAL_GAIN_DEFAULT = 0.15;

/** Ground mount efficiency bonus over roof (better tilt, no obstructions) */
const GROUND_EFFICIENCY_BONUS = 1.05;

/** Carport slight de-rate (partial underside shading, structural losses) */
const CARPORT_EFFICIENCY_FACTOR = 0.95;

/** Default panel wattage when not specified */
const DEFAULT_PANEL_WATTAGE = 440;

// ─── Per-array production parameters ─────────────────────────────────────────

export interface ArrayProductionParams {
  type: ArrayMountType;
  panelCount: number;
  panelWattage: number;
  tilt: number;
  azimuth: number;
  lat: number;
  lng: number;
  bifacialFactor?: number; // override e.g. from bifacialOptimized flag
}

/**
 * Compute annual kWh for a single array using local fallback model.
 * Applies type-specific efficiency overrides (fence bifacial, ground bonus, etc.)
 */
export function calcArrayAnnualKwh(params: ArrayProductionParams): number {
  const { type, panelCount, panelWattage, tilt, azimuth, lat, lng } = params;
  const arraySizeKw = (panelCount * panelWattage) / 1000;
  if (arraySizeKw <= 0) return 0;

  // For fence: override tilt to 90°, pick azimuth
  const effectiveTilt = type === 'fence' ? 90 : tilt;
  const effectiveAzimuth = azimuth;

  // Bifacial factor: fence uses 1.10–1.25 range
  let bifacialFactor = 1.0;
  if (type === 'fence') {
    // E/W facing fence gets full bifacial gain; S-facing gets partial
    const isEastWest =
      (effectiveAzimuth >= 60 && effectiveAzimuth <= 120) ||
      (effectiveAzimuth >= 240 && effectiveAzimuth <= 300);
    const gainPct = params.bifacialFactor
      ? params.bifacialFactor - 1.0
      : FENCE_BIFACIAL_GAIN_DEFAULT;
    bifacialFactor = isEastWest ? 1.0 + gainPct : 1.0 + gainPct * 0.6;
  }

  // Base production from local model (handles climate zone, tilt, azimuth)
  const pvResult = calculateProductionLocal({
    lat,
    lng,
    systemSizeKw: arraySizeKw,
    tilt: effectiveTilt,
    azimuth: effectiveAzimuth,
    losses: 14,
    bifacialFactor,
  });

  let annualKwh = pvResult.ac_annual;

  // Apply type-specific corrections
  switch (type) {
    case 'fence':
      // Fence efficiency penalty × bifacial gain already applied in local model via bifacialFactor
      // Apply additional base penalty for vertical tilt vs optimal
      annualKwh = annualKwh * FENCE_EFFICIENCY_FACTOR;
      // Re-apply bifacial gain separately (the local model already did azimuth factor,
      // so we just need the bifacial-specific upside on top)
      annualKwh = annualKwh * (1 + (bifacialFactor - 1.0) * 0.5);
      break;
    case 'ground':
      annualKwh = annualKwh * GROUND_EFFICIENCY_BONUS;
      break;
    case 'carport':
      annualKwh = annualKwh * CARPORT_EFFICIENCY_FACTOR;
      break;
    case 'roof':
    default:
      // No additional correction — local model handles tilt/azimuth
      break;
  }

  return Math.round(annualKwh);
}

/**
 * Compute productionFactor for an array relative to an optimal roof mount baseline.
 * Used for display ("this fence array produces X% of equivalent roof panels").
 */
export function getArrayProductionFactor(type: ArrayMountType, tilt: number, azimuth: number): number {
  switch (type) {
    case 'fence': {
      const isEastWest =
        (azimuth >= 60 && azimuth <= 120) || (azimuth >= 240 && azimuth <= 300);
      const base = FENCE_EFFICIENCY_FACTOR;
      const bifGain = isEastWest
        ? FENCE_BIFACIAL_GAIN_DEFAULT
        : FENCE_BIFACIAL_GAIN_DEFAULT * 0.6;
      return parseFloat((base * (1 + bifGain)).toFixed(3));
    }
    case 'ground':
      return GROUND_EFFICIENCY_BONUS;
    case 'carport':
      return CARPORT_EFFICIENCY_FACTOR;
    case 'roof':
    default:
      return 1.0;
  }
}

// ─── Group panels by mount type ───────────────────────────────────────────────

interface PanelGroup {
  type: ArrayMountType;
  panels: PlacedPanel[];
}

function groupPanelsByType(panels: PlacedPanel[], defaultType: ArrayMountType): PanelGroup[] {
  const groups = new Map<ArrayMountType, PlacedPanel[]>();

  for (const p of panels) {
    const rawType = (p.systemType ?? p.placementType?.toLowerCase() ?? defaultType) as string;
    const t = normalizeToArrayMountType(rawType, defaultType);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(p);
  }

  // If no per-panel typing, everything falls to defaultType
  if (groups.size === 0 && panels.length > 0) {
    groups.set(defaultType, [...panels]);
  }

  return Array.from(groups.entries()).map(([type, panels]) => ({ type, panels }));
}

function normalizeToArrayMountType(raw: string, fallback: ArrayMountType): ArrayMountType {
  const map: Record<string, ArrayMountType> = {
    roof: 'roof', ROOF: 'roof', ROOF_MOUNT: 'roof',
    ground: 'ground', GROUND: 'ground', GROUND_MOUNT: 'ground',
    fence: 'fence', FENCE: 'fence', SOL_FENCE: 'fence',
    carport: 'carport', CARPORT: 'carport',
  };
  return map[raw] ?? fallback;
}

// ─── Build SolarArray[] from Layout ──────────────────────────────────────────

const TYPE_LABELS: Record<ArrayMountType, string> = {
  roof: 'Roof Array',
  ground: 'Ground Mount Array',
  fence: 'SOL Fence Array',
  carport: 'Carport Array',
};

/**
 * Derive a structured SolarArray[] from an existing Layout.
 * Groups placed panels by systemType, computes per-group production.
 * Falls back gracefully when panels have no per-panel typing.
 */
export function buildArraysFromLayout(
  layout: Layout,
  lat: number,
  lng: number
): SolarArray[] {
  // If layout already has arrays computed, return them
  if (layout.arrays && layout.arrays.length > 0) return layout.arrays;

  const panels = layout.panels ?? [];
  const defaultType = normalizeToArrayMountType(
    (layout.systemType as string) ?? 'roof',
    'roof'
  );

  // For single-type layouts with no per-panel typing, return single array
  const hasPerPanelTypes = panels.some(p => p.systemType || p.placementType);

  if (!hasPerPanelTypes) {
    // Single array from whole layout
    const panelCount = panels.length || layout.totalPanels || 0;
    const panelWattage = (panels[0]?.wattage) || DEFAULT_PANEL_WATTAGE;
    const arraySizeKw = layout.systemSizeKw || (panelCount * panelWattage) / 1000;

    // Determine tilt/azimuth
    let tilt = 20, azimuth = 180;
    if (defaultType === 'fence') {
      tilt = 90;
      azimuth = layout.fenceAzimuth ?? 180;
    } else if (defaultType === 'ground') {
      tilt = layout.groundTilt ?? Math.abs(lat); // optimal tilt ≈ latitude
      azimuth = layout.groundAzimuth ?? 180;
    } else {
      // roof — use average of placed panels, or roof plane
      if (panels.length > 0) {
        const tilts = panels.map(p => p.tilt ?? 20).filter(t => t > 0);
        const azimuths = panels.map(p => p.azimuth ?? 180).filter(a => a > 0);
        tilt = tilts.length > 0 ? tilts.reduce((a, b) => a + b, 0) / tilts.length : 20;
        azimuth = azimuths.length > 0 ? azimuths.reduce((a, b) => a + b, 0) / azimuths.length : 180;
      } else if (layout.roofPlanes && layout.roofPlanes.length > 0) {
        tilt = layout.roofPlanes[0].pitch ?? 20;
        azimuth = layout.roofPlanes[0].azimuth ?? 180;
      }
    }

    const bifacialGain = defaultType === 'fence'
      ? 1.0 + FENCE_BIFACIAL_GAIN_DEFAULT
      : 1.0;

    const annualKwh = calcArrayAnnualKwh({
      type: defaultType,
      panelCount: panelCount || Math.ceil(arraySizeKw / (panelWattage / 1000)),
      panelWattage,
      tilt,
      azimuth,
      lat,
      lng,
      bifacialFactor: bifacialGain,
    });

    return [{
      id: `arr-${defaultType}-0`,
      type: defaultType,
      label: TYPE_LABELS[defaultType],
      panelCount: panelCount || Math.ceil(arraySizeKw / (panelWattage / 1000)),
      panelWattage,
      tilt,
      azimuth,
      productionFactor: getArrayProductionFactor(defaultType, tilt, azimuth),
      bifacialGain,
      annualKwh,
      arraySizeKw: parseFloat(arraySizeKw.toFixed(3)),
    }];
  }

  // Multi-type: group panels by their per-panel systemType
  const groups = groupPanelsByType(panels, defaultType);

  return groups.map((group, idx) => {
    const { type, panels: gPanels } = group;
    const panelWattage = gPanels[0]?.wattage || DEFAULT_PANEL_WATTAGE;
    const panelCount = gPanels.length;
    const arraySizeKw = (panelCount * panelWattage) / 1000;

    // Average tilt/azimuth for this group
    let tilt = 20, azimuth = 180;
    if (type === 'fence') {
      tilt = 90;
      azimuth = gPanels[0]?.azimuth ?? layout.fenceAzimuth ?? 180;
    } else if (type === 'ground') {
      tilt = layout.groundTilt ?? Math.abs(lat);
      azimuth = layout.groundAzimuth ?? 180;
    } else {
      const tilts = gPanels.map(p => p.tilt ?? 20).filter(t => t > 0);
      const azimuths = gPanels.map(p => p.azimuth ?? 180).filter(a => a > 0);
      tilt = tilts.length > 0 ? tilts.reduce((a, b) => a + b, 0) / tilts.length : 20;
      azimuth = azimuths.length > 0 ? azimuths.reduce((a, b) => a + b, 0) / azimuths.length : 180;
    }

    const bifacialGain = type === 'fence'
      ? 1.0 + FENCE_BIFACIAL_GAIN_DEFAULT
      : gPanels.some(p => p.bifacialGain > 1.0)
        ? gPanels.reduce((s, p) => s + (p.bifacialGain ?? 1.0), 0) / gPanels.length
        : 1.0;

    const annualKwh = calcArrayAnnualKwh({
      type, panelCount, panelWattage, tilt, azimuth, lat, lng,
      bifacialFactor: bifacialGain,
    });

    return {
      id: `arr-${type}-${idx}`,
      type,
      label: TYPE_LABELS[type],
      panelCount,
      panelWattage,
      tilt,
      azimuth,
      productionFactor: getArrayProductionFactor(type, tilt, azimuth),
      bifacialGain,
      annualKwh,
      arraySizeKw: parseFloat(arraySizeKw.toFixed(3)),
    } satisfies SolarArray;
  });
}

// ─── Build SystemConfig aggregate ────────────────────────────────────────────

/**
 * Build full SystemConfig from an array list.
 */
export function buildSystemConfig(arrays: SolarArray[]): SystemConfig {
  const totalPanels = arrays.reduce((s, a) => s + a.panelCount, 0);
  const totalKw = parseFloat(arrays.reduce((s, a) => s + a.arraySizeKw, 0).toFixed(3));
  const totalAnnualKwh = arrays.reduce((s, a) => s + a.annualKwh, 0);
  const arrayTypes = [...new Set(arrays.map(a => a.type))] as ArrayMountType[];
  const isHybrid = arrayTypes.length > 1;

  return { arrays, totalPanels, totalKw, totalAnnualKwh, isHybrid, arrayTypes };
}

// ─── Dynamic proposal language ────────────────────────────────────────────────

/**
 * Generate a context-aware description paragraph for the proposal.
 * Returns undefined when no special language is needed (pure roof).
 */
export function getArrayProposalText(config: SystemConfig): string | undefined {
  const { isHybrid, arrayTypes } = config;
  const hasFence = arrayTypes.includes('fence');
  const hasGround = arrayTypes.includes('ground');
  const hasRoof = arrayTypes.includes('roof');

  if (isHybrid) {
    const parts: string[] = [];
    if (hasRoof)   parts.push('roof');
    if (hasGround) parts.push('ground');
    if (hasFence)  parts.push('fence');

    let desc = `Your system is strategically designed using a combination of ${parts.join(', ')}-mounted solar to maximize energy production and site efficiency.`;

    if (hasFence) {
      desc += ' The vertical bifacial SOL Fence panels generate power along your property line while maintaining privacy and maximizing unused space.';
    }
    if (hasGround) {
      desc += ' The ground mount array is optimally tilted for your latitude, delivering maximum annual yield.';
    }
    return desc;
  }

  if (hasFence) {
    return 'This system includes vertical bifacial SOL Fence panels, allowing you to generate power along your property line while maintaining privacy and maximizing unused space.';
  }

  if (hasGround) {
    return 'This ground-mounted system is optimally tilted for your latitude, delivering maximum annual solar energy yield.';
  }

  // Pure roof — no special language needed
  return undefined;
}

// ─── Array breakdown for pricing ─────────────────────────────────────────────

/**
 * Build the arrayBreakdown payload for CostEstimate from a SystemConfig.
 */
export function buildArrayBreakdown(config: SystemConfig) {
  return config.arrays.map(a => ({
    id: a.id,
    type: a.type,
    label: a.label ?? TYPE_LABELS[a.type],
    panelCount: a.panelCount,
    arraySizeKw: a.arraySizeKw,
    annualKwh: a.annualKwh,
    bifacialGain: a.bifacialGain,
  }));
}

// ─── Utility: derive systemType label from config ─────────────────────────────

export function getSystemConfigLabel(config: SystemConfig): string {
  if (!config.isHybrid) {
    const labels: Record<ArrayMountType, string> = {
      roof: 'Roof Mount', ground: 'Ground Mount', fence: 'SOL Fence', carport: 'Carport',
    };
    return labels[config.arrayTypes[0]] ?? 'Roof Mount';
  }
  return 'Hybrid System';
}