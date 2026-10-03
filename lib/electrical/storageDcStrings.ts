// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE PARTITION FOR STRINGS THAT LAND ON A BATTERY'S OWN PV INPUTS.
//
// Found in the production build on Ray's job: once the page stopped adopting a stale fleet layout,
// it derived the strings itself — `computeSystem`'s equal-ish split, 7 / 7 / 7 / 7 / 9 — while the
// sheet it requested drew `generateStringConfig`'s length-first 9 / 9 / 9 / 8 / 2. Both covered 37
// modules inside the Powerwall 3 window; they were two partitioners, which is the defect.
//
// Ray: "Wire that handoff. Do not invent another partitioner."
//
// This is the SLD route's own derivation (`generateStringConfig` over `moduleSpecsFromRegistry` and
// `inverterSpecsFromRegistry`, fed the storage's published window exactly as canonicalSldProjection
// feeds it to the route), callable from the page so the Engineering Summary, the System Config landing
// question and the drawing state the same strings.
// ═══════════════════════════════════════════════════════════════════════════

import type { DcStringLimits } from '@/lib/electrical/dcStringLimits';
import { canonicalStringPartition, resolveStringEndpoint } from '@/lib/electrical/canonicalStrings';

export interface StorageDcStringModule {
  voc: number; vmp: number; isc: number; imp: number; watts: number;
  tempCoeffVoc: number; maxSeriesFuseRating?: number;
}

/**
 * Panel counts per string, in the route's order, or null when nothing can be derived (no modules, or
 * no layout fits the storage's published inputs). Never pads, never equal-divides.
 *
 * 🚨 A VIEW OF THE ONE STRING ENGINE (`canonicalStringPartition`, lib/electrical/canonicalStrings.ts):
 * the same `generateStringConfig` run against the storage's window, now also checked string by string
 * against it — a layout holding a string the inputs cannot take is never returned.
 */
export function deriveStorageDcStrings(args: {
  moduleCount: number;
  module: StorageDcStringModule;
  limits: DcStringLimits;
  designTempMin: number;
}): number[] | null {
  const { moduleCount, module: m, limits, designTempMin } = args;
  if (!(moduleCount > 0)) return null;
  const r = canonicalStringPartition({
    moduleCount,
    module: m,
    endpoint: resolveStringEndpoint({ coupling: 'dc-coupled-storage', storageLimits: limits }),
    designTempMin,
  });
  return r.status === 'ENGINEERED' ? r.strings : null;
}
