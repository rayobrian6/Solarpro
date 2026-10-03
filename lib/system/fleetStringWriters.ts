// ═══════════════════════════════════════════════════════════════════════════
// 🚨 WHAT A FLEET WRITER MAY PUT IN `config.inverters[*].strings` — AND WHEN IT MAY PUT NOTHING.
//
// Closure brief §2: "physical modules known ≠ string architecture known". Every page writer that
// (re)builds a fleet's strings for a module count goes through one of these two functions, so the rule
// is testable without mounting the page:
//
//   · `entryStringsFor` — the strings for a fleet entry being CREATED for an inverter (project load,
//     a restored run, an ecosystem pick, "+ String Inv."): a chosen PV inverter is strung by the one
//     string engine (`canonicalStringPartition`); a micro carries its modules on ONE entry (devices
//     and AC branches, never DC strings); and with nothing for the strings to land on the answer is
//     null — the caller writes NO entry.
//   · `resizeFleetStrings` — the strings for an EXISTING fleet whose Design count changed (the
//     sync-pipeline PANEL COUNT FIX, the per-sub rebuild): the sizing engine for the fleet's own
//     chosen inverter, or null. It used to size an inverter-less fleet from `selectedBrand` ("FIX 2")
//     and fall back to an even split capped at 14 — the default sizing path that wrote partitions for
//     equipment nobody chose. Neither exists any more.
//
// Pure: catalogue lookups and engines only.
// ═══════════════════════════════════════════════════════════════════════════

import { sizeSystemFromBrand, type SizingInput } from './sizingEngine';
import {
  canonicalStringPartition, resolveStringEndpoint, type StringModuleFacts,
} from '@/lib/electrical/canonicalStrings';

export interface WriterPanel {
  voc?: number; vmp?: number; isc?: number; imp?: number; watts?: number;
  tempCoeffVoc?: number; tempCoeffVmp?: number; maxSeriesFuseRating?: number;
}

const moduleFacts = (p: WriterPanel | null | undefined): StringModuleFacts | null =>
  p && p.voc && p.vmp && p.isc && p.watts && typeof p.tempCoeffVoc === 'number'
    ? { voc: p.voc, vmp: p.vmp, isc: p.isc, imp: p.imp ?? p.isc, watts: p.watts, tempCoeffVoc: p.tempCoeffVoc,
        tempCoeffVmp: p.tempCoeffVmp, maxSeriesFuseRating: p.maxSeriesFuseRating }
    : null;

/**
 * The string panel-counts for a fleet entry being created for `inverterId` over `moduleCount`
 * modules — or null when the inverter gives the strings nothing to land on (the caller writes no
 * entry). Where the engine finds no valid layout for a CHOSEN inverter the modules stay on one
 * unstrung entry, shown as a violation and re-strung by the engine — never an invented even split.
 */
export function entryStringsFor(args: {
  inverterId: string | null | undefined;
  inverterType: string | null | undefined;
  moduleCount: number;
  panel: WriterPanel | null | undefined;
  designTempMin: number;
}): number[] | null {
  if (!(args.moduleCount > 0)) return null;
  const endpoint = resolveStringEndpoint({ inverterId: args.inverterId, inverterType: args.inverterType });
  if (endpoint.kind === 'none') return null;
  if (endpoint.kind === 'microinverter') return [args.moduleCount];
  const r = canonicalStringPartition({
    moduleCount: args.moduleCount, module: moduleFacts(args.panel), endpoint, designTempMin: args.designTempMin,
  });
  return r.status === 'ENGINEERED' ? r.strings : [args.moduleCount];
}

/**
 * Re-sized strings (with the physical inverter each belongs to) for an existing non-micro fleet whose
 * Design count changed — from the fleet's OWN chosen inverter, or null (keep the fleet as it is).
 *
 * `selectedBrand` is accepted only so callers' signatures stay unchanged: a brand is not equipment,
 * and it never sizes an inverter-less fleet.
 */
export function resizeFleetStrings(args: {
  inverter: { inverterId?: string | null; type?: string | null } | null | undefined;
  moduleCount: number;
  systemType: string;
  panel: WriterPanel | null | undefined;
  designTempMin: number;
  selectedBrand?: string;
}): Array<{ panelCount: number; inverterIndex: number }> | null {
  const inv = args.inverter;
  if (!inv || !(args.moduleCount > 0)) return null;
  const endpoint = resolveStringEndpoint({ inverterId: inv.inverterId, inverterType: inv.type });
  if (endpoint.kind !== 'pv-inverter') return null;
  try {
    const input: SizingInput = {
      systemType: args.systemType as SizingInput['systemType'],
      panelCount: args.moduleCount,
      panelWattage: args.panel?.watts ?? 400,
      panelVoc: args.panel?.voc ?? 49.6,
      panelTempCoeffVoc: args.panel?.tempCoeffVoc ?? -0.27,
      designTempMin: args.designTempMin,
      optimizerMaxOutputCurrent: 15.0,
      selectedInverterId: endpoint.inverterId,
    };
    const result = sizeSystemFromBrand(input);
    if (result.strings.length === 0 || result.topology === 'micro') return null;
    return result.strings.map(s => ({ panelCount: s.panelCount, inverterIndex: s.inverterIndex ?? 0 }));
  } catch {
    return null;
  }
}
