/**
 * designToEngineering.ts — Design Studio → Engineering electrical handoff (v1)
 *
 * Converts the DesignElectrical block (logged by Design Studio when a client
 * project is active) into the inverter/string inputs the Engineering page needs
 * to seed its SystemState — so string count, string sizes, topology, brand,
 * panel, racking and the per-panel string assignment carry over with no re-entry.
 *
 * Pure + dependency-light: only reads equipment-db default lists to pick a
 * sensible inverter id when the project hasn't pinned one.
 */

import type { DesignElectrical } from '@/types';
import type { StringConfig } from '@/lib/system-state';
import { STRING_INVERTERS, MICROINVERTERS } from '@/lib/equipment-db';

export interface DesignEngineeringHandoff {
  inverterType: 'string' | 'micro' | 'optimizer';
  inverterId: string;
  inverterBrand: string;
  mountingId?: string;
  /** SolarEdge optimizer model when topology === 'optimizer'. */
  optimizerPeripheralId?: string;
  strings: StringConfig[];
}

export interface DesignToEngineeringOpts {
  /** Project-selected inverter id (takes precedence over the topology default). */
  selectedInverterId?: string;
  tilt?: number;
  azimuth?: number;
  roofType?: string;
  wireGauge?: string;
  wireLength?: number;
}

function defaultInverterId(topology: DesignElectrical['topology']): string {
  if (topology === 'micro') return MICROINVERTERS[0]?.id ?? 'enphase-iq8plus';
  // optimizer + string both run on a string inverter (optimizer is a peripheral)
  return STRING_INVERTERS[0]?.id ?? 'se-7600h';
}

function inferBrand(de: DesignElectrical): string {
  if (de.inverterBrand) return de.inverterBrand;
  if (de.topology === 'micro') return 'Enphase';
  return 'SolarEdge';
}

/**
 * Build engineering inverter inputs from a design's electrical block.
 * One StringConfig per design string, with the exact per-string panel counts.
 */
export function designElectricalToEngineering(
  de: DesignElectrical,
  opts: DesignToEngineeringOpts = {},
): DesignEngineeringHandoff {
  const tilt      = opts.tilt ?? 20;
  const azimuth   = opts.azimuth ?? 180;
  const roofType  = opts.roofType ?? 'shingle';
  const wireGauge = opts.wireGauge ?? '#10 AWG THWN-2';
  const wireLength = opts.wireLength ?? 50;
  const mounting  = de.rackingId || 'ironridge-xr100';
  const panelId   = de.panelId || 'qcells-peak-duo-400';

  // Sort by stringIndex and emit a StringConfig per design string.
  const sorted = [...(de.strings ?? [])].sort((a, b) => a.stringIndex - b.stringIndex);
  const strings: StringConfig[] = sorted
    .filter(s => s.panelCount > 0)
    .map((s, i) => ({
      id: `str-design-${i}`,
      label: `String ${i + 1}`,
      panelCount: s.panelCount,
      panelId,
      tilt,
      azimuth,
      roofType,
      mountingSystem: mounting,
      wireGauge,
      wireLength,
    }));

  return {
    inverterType: de.topology,
    inverterId: opts.selectedInverterId || defaultInverterId(de.topology),
    inverterBrand: inferBrand(de),
    mountingId: de.rackingId,
    optimizerPeripheralId: de.topology === 'optimizer' ? de.optimizerModelId : undefined,
    strings,
  };
}
