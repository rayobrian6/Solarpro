// ============================================================
// electricalNormalize — Electrical String Validity Enforcer
// ============================================================
//
// PURPOSE:
//   Detect and repair a 1×N electrical violation:
//     A single string carrying more panels than the inverter's
//     maxPanelsPerString allows for non-micro topology.
//
// This is a SEPARATE concern from buildInverterConfig's metadata
// invariants (stringsPerInverter === strings.length). That check
// catches structural inconsistency. This check catches electrical
// invalidity — a structurally consistent but electrically wrong
// config like strings:[{panelCount:44}] for a Solis inverter
// whose maxPanelsPerString is 13.
//
// DETECTION RULE:
//   For non-micro topology:
//     if (strings.length === 1 && strings[0].panelCount > maxPanelsPerString)
//     → 1×N violation — must rebuild
//
// REPAIR STRATEGY:
//   1. Look up maxPanelsPerString from brand profile
//   2. Call sizeSystemFromBrand() to get the correct multi-string layout
//   3. Rebuild config.inverters using the result
//
// IDEMPOTENT: safe to call on already-normalized configs.
// ============================================================

import { getBrandProfileByInverterId } from './brandProfiles';
import { sizeSystemFromBrand, type SizingInput } from './sizingEngine';
import {
  buildStringConfig,
  buildInverterConfig,
  type InverterConfig,
  type StringConfig,
} from './buildInverterConfig';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Conservative ceiling used when no brand profile is found.
 * Any string with more than this many panels is almost certainly
 * a 1×N bug regardless of the inverter model.
 */
export const CONSERVATIVE_MAX_PANELS_PER_STRING = 20;

/**
 * Micro topologies legitimately store all panels in a single
 * logical "string" — never treat that as a 1×N violation.
 */
const MICRO_TYPES = new Set<string>(['micro']);

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns the maximum panels per string for the given inverterId.
 * Looks up the brand profile and finds the matching inverter model.
 * Falls back to CONSERVATIVE_MAX_PANELS_PER_STRING if not found.
 */
export function getMaxPanelsPerString(inverterId: string): number {
  const profile = getBrandProfileByInverterId(inverterId);
  if (!profile) return CONSERVATIVE_MAX_PANELS_PER_STRING;
  const model = profile.supportedInverterModels.find(m => m.equipmentDbId === inverterId);
  return model?.maxPanelsPerString ?? CONSERVATIVE_MAX_PANELS_PER_STRING;
}

/**
 * Returns true if this inverter config is in an electrically invalid
 * 1×N state: a single string carrying more panels than the inverter's
 * maxPanelsPerString allows (non-micro topology only).
 */
export function isElectricallyInvalid(inv: InverterConfig): boolean {
  if (MICRO_TYPES.has(inv.type)) return false; // micro: single string is always valid
  if (inv.strings.length !== 1) return false;  // only 1×N is the known violation pattern
  const totalPanels = inv.strings[0].panelCount;
  if (totalPanels <= 1) return false;           // trivial / empty — not this bug
  const max = getMaxPanelsPerString(inv.inverterId);
  return totalPanels > max;
}

// ── Repair ───────────────────────────────────────────────────────────────────

/**
 * Repair a single 1×N inverter by calling the sizing engine.
 *
 * @param inv     - the invalid InverterConfig (must pass isElectricallyInvalid)
 * @param options - optional panel specs for the sizing engine
 * @returns a new InverterConfig with the correct multi-string layout,
 *          or the original if repair fails (fail-safe: better to show
 *          the violation than to crash)
 */
export function repairElectricallyInvalidInverter(
  inv: InverterConfig,
  options: {
    panelWattage?: number;
    panelVoc?: number;
    panelTempCoeffVoc?: number;
    systemType?: string;
  } = {},
): InverterConfig {
  const totalPanels = inv.strings.reduce((s, str) => s + str.panelCount, 0);
  const baseStr = inv.strings[0];

  const sizingInput: SizingInput = {
    systemType:         (options.systemType ?? 'roof') as SizingInput['systemType'],
    panelCount:         totalPanels,
    panelWattage:       options.panelWattage ?? 400,
    panelVoc:           options.panelVoc ?? 49.6,
    panelTempCoeffVoc:  options.panelTempCoeffVoc ?? -0.27,
    designTempMin:      -10,
    selectedInverterId: inv.inverterId,
  };

  try {
    const result = sizeSystemFromBrand(sizingInput);

    if (result.strings.length === 0) {
      // Engine returned empty strings — fallback: even split at maxPanelsPerString
      return repairByEvenSplit(inv, totalPanels);
    }

    // Group strings by inverterIndex (the result may span multiple inverters,
    // but we're only repairing one inverter here)
    const stringsForThisInv = result.strings.filter(s => (s.inverterIndex ?? 0) === 0);
    const strings: StringConfig[] = (stringsForThisInv.length > 0 ? stringsForThisInv : result.strings)
      .map((s, i) =>
        buildStringConfig({
          index:          i,
          existingId:     i === 0 ? baseStr?.id : undefined,
          panelCount:     s.panelCount,
          panelId:        baseStr?.panelId,
          wireGauge:      baseStr?.wireGauge,
          wireLength:     baseStr?.wireLength,
          tilt:           baseStr?.tilt,
          azimuth:        baseStr?.azimuth,
          roofType:       baseStr?.roofType as string,
          mountingSystem: baseStr?.mountingSystem,
        })
      );

    return buildInverterConfig({
      existingId:            inv.id,
      inverterId:            inv.inverterId,
      type:                  inv.type,
      strings,
      optimizerPeripheralId: inv.optimizerPeripheralId,
      deviceRatioOverride:   inv.deviceRatioOverride,
      // Wave 3 (I-2 corollary): an electrical repair must never strip the
      // subsystem tag — a healed fence fleet stays a fence fleet.
      subSystemKey:          (inv as { subSystemKey?: 'roof' | 'ground' | 'fence' }).subSystemKey,
    });

  } catch (err) {
    // Sizing engine threw — use even-split fallback
    console.warn('[electricalNormalize] sizeSystemFromBrand failed, using even split:', err);
    return repairByEvenSplit(inv, totalPanels);
  }
}

/**
 * Fallback repair: even split at maxPanelsPerString ceiling.
 */
function repairByEvenSplit(inv: InverterConfig, totalPanels: number): InverterConfig {
  const max = Math.min(getMaxPanelsPerString(inv.inverterId), CONSERVATIVE_MAX_PANELS_PER_STRING);
  const stringCount = Math.ceil(totalPanels / max);
  const baseStr = inv.strings[0];

  const strings: StringConfig[] = Array.from({ length: stringCount }, (_, i) => {
    const remaining = totalPanels - max * i;
    return buildStringConfig({
      index:          i,
      existingId:     i === 0 ? baseStr?.id : undefined,
      panelCount:     Math.min(max, remaining),
      panelId:        baseStr?.panelId,
      wireGauge:      baseStr?.wireGauge,
      wireLength:     baseStr?.wireLength,
      tilt:           baseStr?.tilt,
      azimuth:        baseStr?.azimuth,
      roofType:       baseStr?.roofType as string,
      mountingSystem: baseStr?.mountingSystem,
    });
  });

  return buildInverterConfig({
    existingId:            inv.id,
    inverterId:            inv.inverterId,
    type:                  inv.type,
    strings,
    optimizerPeripheralId: inv.optimizerPeripheralId,
    deviceRatioOverride:   inv.deviceRatioOverride,
    // Wave 3 (I-2 corollary): repair never strips the subsystem tag.
    subSystemKey:          (inv as { subSystemKey?: 'roof' | 'ground' | 'fence' }).subSystemKey,
  });
}

// ── Config-level normalizer ───────────────────────────────────────────────────

export interface ElectricalNormalizeOptions {
  panelWattage?: number;
  panelVoc?: number;
  panelTempCoeffVoc?: number;
  systemType?: string;
}

export interface ElectricalNormalizeResult<T> {
  config: T;
  /** How many inverters were rebuilt due to 1×N violation */
  rebuiltCount: number;
  /** Debug: which inverters were invalid and why */
  log: ElectricalNormalizeLogEntry[];
}

export interface ElectricalNormalizeLogEntry {
  inverterId: string;
  topology: string;
  source: string;
  panelCount: number;
  maxPanelsPerString: number;
  incomingStringLayout: number[];
  outgoingStringLayout: number[];
  reason: 'preserved' | 'rebuilt_invalid_1xN';
}

/**
 * Inspect every inverter in config.inverters and repair any 1×N
 * electrically-invalid strings using sizeSystemFromBrand.
 *
 * Idempotent — no-op if all inverters are already valid.
 * Never modifies a micro inverter.
 *
 * @param config  - any object with an inverters?: InverterConfig[] field
 * @param options - optional panel specs passed to the sizing engine
 */
export function electricallyNormalizeInverterConfig<T extends { inverters?: unknown }>(
  config: T,
  options: ElectricalNormalizeOptions = {},
): ElectricalNormalizeResult<T> {
  const log: ElectricalNormalizeLogEntry[] = [];
  let rebuiltCount = 0;

  if (!Array.isArray(config.inverters) || config.inverters.length === 0) {
    return { config, rebuiltCount: 0, log };
  }

  const inverters = config.inverters as InverterConfig[];
  let anyChanged = false;

  const newInverters = inverters.map(inv => {
    const incoming = inv.strings.map(s => s.panelCount);
    const maxPPS = getMaxPanelsPerString(inv.inverterId);
    const invalid = isElectricallyInvalid(inv);

    const entry: ElectricalNormalizeLogEntry = {
      inverterId:           inv.inverterId,
      topology:             inv.type,
      source:               '[electricalNormalize]',
      panelCount:           inv.strings.reduce((s, str) => s + str.panelCount, 0),
      maxPanelsPerString:   maxPPS,
      incomingStringLayout: incoming,
      outgoingStringLayout: incoming, // will be updated if repaired
      reason:               'preserved',
    };

    if (!invalid) {
      log.push(entry);
      return inv;
    }

    console.warn(
      `[STRING NORMALIZE INPUT] inverterId=${inv.inverterId} topology=${inv.type}` +
      ` panelCount=${entry.panelCount} incomingLayout=[${incoming.join(',')}]` +
      ` maxPanelsPerString=${maxPPS} → REBUILDING`
    );

    const repaired = repairElectricallyInvalidInverter(inv, options);
    const outgoing = repaired.strings.map(s => s.panelCount);

    entry.outgoingStringLayout = outgoing;
    entry.reason = 'rebuilt_invalid_1xN';
    log.push(entry);

    console.log(
      `[STRING NORMALIZE OUTPUT] inverterId=${repaired.inverterId}` +
      ` outgoingLayout=[${outgoing.join(',')}]` +
      ` stringsPerInverter=${repaired.stringsPerInverter}` +
      ` modulesPerString=${repaired.modulesPerString}` +
      ` reason=rebuilt_invalid_1xN`
    );

    anyChanged = true;
    rebuiltCount++;
    return repaired;
  });

  if (!anyChanged) {
    return { config, rebuiltCount: 0, log };
  }

  return {
    config: { ...config, inverters: newInverters } as T,
    rebuiltCount,
    log,
  };
}