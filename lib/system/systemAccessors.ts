// ═══════════════════════════════════════════════════════════════════
// System Accessors — Normalized Read Layer for Downstream Consumers
//
// NON-BREAKING MIGRATION:
//   - Prefers SystemDefinition when present on CADModel
//   - Falls back to existing helpers.ts resolvers when absent
//   - Old resolvers are NOT removed — they remain as fallback
//   - Debug logs track which path was used
//
// USAGE:
//   import { getSystemType, getInverterTopology, getEquipmentContext } from '@/lib/system';
//   const sysType = getSystemType(input, cad);
//   const topology = getInverterTopology(input, cad);
//   const equipment = getEquipmentContext(input, cad);
// ═══════════════════════════════════════════════════════════════════

import type { CADModel } from '@/lib/cad/types';
import type { PermitInput, ResolvedEquipment } from '@/lib/permit/types';
import type { SystemDefinition } from './systemDefinition';

// ── Vocabulary imports (canonical normalizers) ───────────────────
import {
  normalizeTopology,
  toVerboseSystemType,
  toCanonicalSystemType,
  type InverterTopology,
  type VerboseSystemType,
} from './systemVocabulary';

// ── Legacy resolver imports (fallback only) ──────────────────────
import {
  resolveSystemType as legacyResolveSystemType,
  resolveTopology as legacyResolveTopology,
  resolveEquipment as legacyResolveEquipment,
  resolveEquipmentBySubSystem,
  type SysType,
} from '@/lib/permit/utils/helpers';
import type { SubSystemKey } from './subSystemEquipment';

// ── Accessor: getSystemType ──────────────────────────────────────
/**
 * Get the system type in VERBOSE format for backward compatibility.
 * Priority:
 *   1. cad.systemDefinition.systemType (canonical) → mapped to verbose
 *   2. legacyResolveSystemType(input) (existing helpers.ts logic)
 *
 * Returns: 'roof' | 'ground_mount' | 'solar_fence' (verbose / legacy format)
 */
export function getSystemType(input: PermitInput, cad?: CADModel | null): SysType {
  // Path 1: SystemDefinition (preferred)
  const sd = cad?.systemDefinition;
  if (sd?.systemType) {
    const result = toVerboseSystemType(sd.systemType) as SysType;
    console.debug(`[SYSDEF READ] getSystemType source=SystemDefinition value="${result}"`);
    return result;
  }

  // Path 2: Legacy resolver (fallback)
  const result = legacyResolveSystemType(input);
  console.debug(`[SYSDEF FALLBACK] getSystemType source=legacy value="${result}"`);
  return result;
}

// ── Accessor: getInverterTopology ────────────────────────────────
/**
 * Get the normalized inverter topology.
 * Priority:
 *   1. cad.systemDefinition.electrical.inverterType (if present)
 *   2. legacyResolveTopology(input) → normalized
 *
 * ALWAYS returns canonical form: 'micro' | 'string' | 'optimizer'
 */
export function getInverterTopology(input: PermitInput, cad?: CADModel | null): InverterTopology {
  // Path 1: SystemDefinition (preferred)
  const sd = cad?.systemDefinition;
  if (sd?.electrical?.inverterType) {
    const result = normalizeTopology(sd.electrical.inverterType);
    console.debug(`[SYSDEF READ] getInverterTopology source=SystemDefinition value="${result}"`);
    return result;
  }

  // Path 2: Legacy resolver → normalize
  const legacyResult = legacyResolveTopology(input);
  const result = normalizeTopology(legacyResult);
  console.debug(`[SYSDEF FALLBACK] getInverterTopology source=legacy raw="${legacyResult}" normalized="${result}"`);
  return result;
}

/**
 * Convert canonical InverterTopology back to legacy uppercase format.
 * Used when downstream code still expects 'MICRO' | 'OPTIMIZER' | 'STRING'.
 * This is a bridge helper for incremental migration.
 */
export function topologyToLegacy(topo: InverterTopology): 'MICRO' | 'OPTIMIZER' | 'STRING' {
  if (topo === 'micro') return 'MICRO';
  if (topo === 'optimizer') return 'OPTIMIZER';
  return 'STRING';
}

// ── Accessor: getEquipmentContext ─────────────────────────────────
/**
 * Get resolved equipment specs.
 * Priority:
 *   1. cad.systemDefinition panel + electrical fields (if present and populated)
 *   2. legacyResolveEquipment(input) (existing 4-source priority logic)
 *
 * Returns the same ResolvedEquipment shape for backward compatibility.
 */
export function getEquipmentContext(input: PermitInput, cad?: CADModel | null): ResolvedEquipment {
  // Path 1: SystemDefinition (preferred — but only if it has real data)
  const sd = cad?.systemDefinition;
  if (sd?.panel?.manufacturer && sd.panel.manufacturer !== '—') {
    const result: ResolvedEquipment = {
      panelManufacturer:    sd.panel.manufacturer || '—',
      panelModel:           sd.panel.model || '—',
      panelWatts:           sd.panel.wattage || 0,
      panelVoc:             sd.panel.voc || 0,
      panelIsc:             sd.panel.isc || 0,
      inverterManufacturer: sd.electrical.inverterManufacturer || '—',
      inverterModel:        sd.electrical.inverterModel || '—',
      inverterType:         sd.electrical.inverterType || '—',
      inverterAcOutputKw:   sd.electrical.inverterAcOutputKw || 0,
    };
    console.debug(`[SYSDEF READ] getEquipmentContext source=SystemDefinition panel="${result.panelManufacturer} ${result.panelModel}"`);
    return result;
  }

  // Path 2: Legacy resolver (fallback)
  const result = legacyResolveEquipment(input);
  console.debug(`[SYSDEF FALLBACK] getEquipmentContext source=legacy panel="${result.panelManufacturer} ${result.panelModel}"`);
  return result;
}

// ── Accessor: getEquipmentContextBySubSystem (Wave 2d) ────────────
/**
 * Per-subsystem equipment view — the hybrid-safe variant of
 * getEquipmentContext. Resolves ONE sub-system's equipment from the permit
 * carriage (tagged inverters + cad.hybrid.sections[].equipment + canonical
 * partition); untagged/N=1 payloads fall through to the exact legacy
 * resolution, so single-system consumers see identical values.
 *
 * NOTE: deliberately does NOT prefer cad.systemDefinition here — the
 * SystemDefinition is a single-system snapshot and would re-introduce the
 * project-wide-winner contamination for hybrid sub-systems.
 */
export function getEquipmentContextBySubSystem(
  input: PermitInput,
  key: SubSystemKey,
  cad?: CADModel | null,
): ResolvedEquipment {
  return resolveEquipmentBySubSystem(input, key, cad);
}