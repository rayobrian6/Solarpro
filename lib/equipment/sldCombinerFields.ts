// ═══════════════════════════════════════════════════════════════════════════
// ONE ANSWER FOR "WHICH COMBINER DOES THIS DRAWING NAME".
//
// The SVG route resolved the BOS plan and mapped four fields onto the renderer
// input. The PDF route — the artefact that actually reaches the permit package —
// resolved nothing and mapped none of them, so the renderer fell back to the
// literal 'IQ Combiner' for the schedule row and, worse, received
// `combinerProvidesAcDisconnect: undefined`.
//
// 🚨 THAT LAST ONE IS NOT COSMETIC. `providesAcDisconnect` drives the NEC
// integral-AC-disconnecting-means statement on the electrical and compliance
// pages. Undefined is falsy, so the EXPORTED sheet silently WITHHELD a code
// statement the on-screen diagram asserted for the same design. Two renderers,
// two answers, one project.
//
// Both routes now call this. A shared adapter is the only version of this fix
// that stays fixed: the previous one was "make the second route do what the
// first does", which is a rule that lives in two places and therefore in none.
// ═══════════════════════════════════════════════════════════════════════════

import { resolveIntegratedEquipment, type IntegratedEquipmentPlan } from '@/lib/equipment/integratedBos';
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
import { combinerBasisIsDecided } from '@/lib/combinerSelection/service';

export interface SldCombinerInputs {
  inverterManufacturer: string;
  inverterModel: string;
  /** The canonical inverter id, when the caller has one. Preferred over the
   *  manufacturer/model pair, whose exact-match lookup misses on a concatenated
   *  display string — the original cause of a 6C appearing on a 5C job. */
  inverterId?: string | null;
  isMicro: boolean;
  totalDevices: number;
  branchCount: number;
  hasBattery: boolean;
  /** Per-artefact operator override (legacy `combinerId` / `bosDeviceIds`). */
  overrideDeviceIds?: string[];
  /** The project's RECORDED selection. Outranks everything above. */
  selectedCombinerId?: string | null;
}

export interface SldCombinerFields {
  combinerLabel: string | undefined;
  combinerModel: string | undefined;
  combinerHasIntegratedGateway: boolean;
  combinerProvidesAcDisconnect: boolean;
  /**
   * 🚨 TRUE ⇔ A HUMAN DECIDED. False means the device was derived — from a
   * compatibility declaration, or from nothing at all. A sheet that prints the
   * model must be able to qualify it, because "the combiner is a 6C" and "a 6C,
   * because nothing said otherwise" are different claims and only one of them
   * belongs on a permit unqualified.
   */
  combinerSelectionIsDecided: boolean;
  /** The full plan, for callers that need slots, warnings or the device list. */
  plan: IntegratedEquipmentPlan;
}

/** Resolve the combiner once, and map it the same way for every drawing. */
export function sldCombinerFields(inputs: SldCombinerInputs): SldCombinerFields {
  const plan = resolveIntegratedEquipment({
    inverterManufacturer: inputs.inverterManufacturer,
    inverterModel: inputs.inverterModel,
    isMicro: inputs.isMicro,
    totalDevices: inputs.totalDevices,
    branchCount: inputs.branchCount,
    hasBattery: inputs.hasBattery,
    overrideDeviceIds: inputs.overrideDeviceIds,
    compatibleCombinerIds: combinerCompatibilityFor(
      inputs.inverterManufacturer,
      inputs.inverterModel,
      inputs.inverterId ?? undefined,
    ),
    selectedCombinerId: inputs.selectedCombinerId ?? null,
  });

  const brains = plan.brains ?? plan.devices[0];
  const label = brains ? `${brains.brand} ${brains.model}` : undefined;

  return {
    // The micro fallback string is kept because the renderer needs SOMETHING in
    // the schedule cell; what changed is that `combinerSelectionIsDecided` now
    // tells the sheet whether that string is a decision or a placeholder.
    combinerLabel: inputs.isMicro ? (label ?? 'IQ Combiner') : label,
    combinerModel: label,
    combinerHasIntegratedGateway: plan.hasIntegratedGateway,
    combinerProvidesAcDisconnect: plan.providesAcDisconnect,
    combinerSelectionIsDecided: combinerBasisIsDecided(plan.combinerBasis ?? 'unresolved-default'),
    plan,
  };
}
