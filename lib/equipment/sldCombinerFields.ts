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

import {
  planLandingDevice,
  resolveIntegratedEquipment,
  type IntegratedEquipmentPlan,
} from '@/lib/equipment/integratedBos';
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
import { combinerBasisIsDecided } from '@/lib/combinerSelection/service';
import { type MeteringResolution } from '@/lib/equipment/currentTransformers';
import { resolveDesignMetering, type SldMeteringDrawing } from '@/lib/equipment/designMetering';

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
  /** The design's recorded interconnection, in whatever spelling it uses. Absent
   *  ⇒ the consumption metering MODE is INDETERMINATE and the schedule says so
   *  rather than picking one. */
  interconnectionRaw?: string | null;
  /** Ungrounded conductors at the consumption measurement point. Absent ⇒ the CT
   *  quantity is UNRESOLVED (it is not assumed to be a split-phase pair). */
  ungroundedConductorCount?: number | null;
  /** The designer's recorded consumption-CT location ('' ⇒ interconnection default). */
  consumptionCtLocation?: string | null;
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
  /**
   * 🚨 WHAT THIS DESIGN ACTUALLY MEASURES — the CT authority's answer, resolved
   * once here so the diagram, the export and the schedule cannot disagree about
   * it the way they disagreed about the combiner. undefined ⇒ no metering device
   * is modelled and NOTHING is asserted.
   */
  combinerMeteringSummary: string | undefined;
  /** The full metering resolution, for callers that need the BOM lines or the
   *  blocking requirement. null ⇒ nothing is modelled. */
  metering: MeteringResolution | null;
  /** What the SLD draws for metering (CTs, lead, schedule row). */
  meteringDrawing: SldMeteringDrawing | null;
  /** The full plan, for callers that need slots, warnings or the device list. */
  plan: IntegratedEquipmentPlan;
  /**
   * The standalone IQ Gateway, drawn as its OWN enclosure beside the landing
   * panel (`combinerLabel`) and fed from its own 2-pole breaker in it.
   *
   * 🚨 ABSENT on every other design — not undefined-valued. A caller that
   * spreads these fields into renderer input must not gain a key on an existing
   * design — the E-1 input's keys are pinned (tests/golden-path.test.ts) so
   * that an existing project's permit output cannot drift under it.
   */
  standaloneGateway?: StandaloneGatewayFields;
}

/** Everything a drawing needs to show a standalone gateway. The renderer's
 *  `SLDProfessionalInput.standaloneGateway` has this same shape. */
export interface StandaloneGatewayFields {
  /** e.g. "Enphase IQ Gateway". */
  label: string;
  /** e.g. "ENV2-IQ-AM1-240". Absent when the catalogue records none. */
  partNumber?: string;
  /** The gateway's 2-pole supply breaker in the landing panel (A). */
  supplyBreakerA: number;
  /** The supply conductors — L1, L2 AND N (+ EGC). */
  supplyConductor: string;
  /** The panel it is fed from and whose L1 its production CT clamps — the same
   *  string as `combinerLabel`. */
  landingLabel: string;
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

  // 🚨 TWO DIFFERENT QUESTIONS, TWO DIFFERENT DEVICES — on one plan only.
  // The name printed as the combiner is the box the branches LAND in; the
  // metering belongs to the brains. On every plan but a standalone gateway they
  // are the same device and both expressions return what this used before. On a
  // standalone gateway the brains is the Envoy (no busbar) and the landing box is
  // the PV AC combiner panel — naming the Envoy here is what drew the branch
  // breakers inside it.
  const brains = plan.brains ?? plan.devices[0];
  const landing = planLandingDevice(plan);
  const label = landing ? `${landing.brand} ${landing.model}` : undefined;

  // 🚨 THE CLAIM AND THE PURCHASE ARE THE SAME DECISION.
  // A package asserts "the integrated gateway provides production/consumption
  // metering" exactly when the resolved device integrates the gateway — so that
  // is exactly when the consumption CTs are required. Tying the two to one
  // predicate is what stops a sheet claiming a measurement the job never bought.
  // The one composer (lib/equipment/designMetering.ts) — the same answer the
  // Diagram tab, the permit E-1, PV-4A and the BOM get. Micro only — no other
  // topology draws the device the CTs land in.
  const _met = resolveDesignMetering({
    plan: inputs.isMicro
      ? {
          brains: brains ?? null,
          hasIntegratedGateway: plan.hasIntegratedGateway,
          ...(plan.gatewayPlacement ? { gatewayPlacement: plan.gatewayPlacement } : {}),
        }
      : null,
    interconnectionRaw: inputs.interconnectionRaw,
    consumptionCtLocation: inputs.consumptionCtLocation ?? null,
    ungroundedConductorCount: inputs.ungroundedConductorCount ?? null,
  });
  const metering = _met.resolution;

  // Only a micro job draws the device its branches land in (see the metering
  // note above), so only a micro job draws a standalone gateway beside it.
  const gw = plan.gatewayPlacement === 'standalone' ? plan.gateway : undefined;
  const standaloneGateway: StandaloneGatewayFields | undefined =
    inputs.isMicro && gw && plan.gatewaySupply && label
      ? {
          label: `${gw.brand} ${gw.model}`,
          ...(gw.partNumber ? { partNumber: gw.partNumber } : {}),
          supplyBreakerA: plan.gatewaySupply.breakerA,
          supplyConductor: plan.gatewaySupply.conductor,
          landingLabel: label,
        }
      : undefined;

  return {
    // The micro fallback string is kept because the renderer needs SOMETHING in
    // the schedule cell; what changed is that `combinerSelectionIsDecided` now
    // tells the sheet whether that string is a decision or a placeholder.
    combinerLabel: inputs.isMicro ? (label ?? 'IQ Combiner') : label,
    combinerModel: label,
    combinerHasIntegratedGateway: plan.hasIntegratedGateway,
    combinerProvidesAcDisconnect: plan.providesAcDisconnect,
    combinerSelectionIsDecided: combinerBasisIsDecided(plan.combinerBasis ?? 'unresolved-default'),
    combinerMeteringSummary: _met.scheduleValue,
    metering,
    meteringDrawing: _met.drawing,
    plan,
    ...(standaloneGateway ? { standaloneGateway } : {}),
  };
}
