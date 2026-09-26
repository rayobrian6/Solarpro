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
import {
  resolveDesignMetering,
  type DesignMetering,
  type MeteringPlanLike,
  type SldMeteringDrawing,
} from '@/lib/equipment/designMetering';
// The renderer only TYPE-imports this module, so this runtime import forms no
// cycle. It is here for `acCollectionFromLanes` — the ONE lanes → lane-plan
// mapping the multi-lane drawing itself uses (see hybridLaneMetering).
import { acCollectionFromLanes, type SLDSourceBranch } from '@/lib/sld-professional-renderer';

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

  // 🚨 THE CLAIM AND THE PURCHASE ARE THE SAME DECISION.
  // A package asserts "the integrated gateway provides production/consumption
  // metering" exactly when the resolved device integrates the gateway — so that
  // is exactly when the consumption CTs are required. Tying the two to one
  // predicate is what stops a sheet claiming a measurement the job never bought.
  // The one composer (lib/equipment/designMetering.ts) — the same answer the
  // Diagram tab, the permit E-1, PV-4A and the BOM get. Micro only — no other
  // topology draws the device the CTs land in.
  const _met = resolveDesignMetering({
    plan: inputs.isMicro ? meteringSliceOf(plan) : null,
    interconnectionRaw: inputs.interconnectionRaw,
    consumptionCtLocation: inputs.consumptionCtLocation ?? null,
    ungroundedConductorCount: inputs.ungroundedConductorCount ?? null,
  });

  return fieldsFromPlan(plan, inputs.isMicro, _met);
}

/**
 * The slice of a plan the metering composer reads — the ONE way every caller in
 * this module hands a plan to it.
 *
 * The metering belongs to the brains (the gateway), not to the box the branches
 * land in; on a standalone gateway those differ. `gatewayPlacement` rides along
 * ONLY when the plan has it: a standalone gateway is not an integrated one, and
 * without it the composer drops the consumption CTs the gateway reads — while
 * every other plan hands the composer the identical slice it always did.
 */
function meteringSliceOf(plan: IntegratedEquipmentPlan): MeteringPlanLike {
  return {
    brains: plan.brains ?? plan.devices[0] ?? null,
    hasIntegratedGateway: plan.hasIntegratedGateway,
    ...(plan.gatewayPlacement ? { gatewayPlacement: plan.gatewayPlacement } : {}),
  };
}

/**
 * The standalone IQ Gateway a plan puts on the wall, in the shape every drawing
 * takes (`SLDProfessionalInput.standaloneGateway`, and a hybrid lane's own
 * field). Undefined on every other plan.
 *
 * ONE builder. The Diagram route used to carry its own copy of this mapping
 * (pinned to this one by tests/sldStandaloneGatewayAndCtLeads.test.ts) and a
 * hybrid lane would have needed a third; a copy is a second answer waiting to
 * drift. The CALLER gates on topology: only a micro job draws the device its
 * branches land in, so only a micro job draws a gateway beside it.
 */
export function standaloneGatewayFieldsFor(plan: IntegratedEquipmentPlan): StandaloneGatewayFields | undefined {
  const gw = plan.gatewayPlacement === 'standalone' ? plan.gateway : undefined;
  const landing = planLandingDevice(plan);
  const label = landing ? `${landing.brand} ${landing.model}` : undefined;
  if (!gw || !plan.gatewaySupply || !label) return undefined;
  return {
    label: `${gw.brand} ${gw.model}`,
    ...(gw.partNumber ? { partNumber: gw.partNumber } : {}),
    supplyBreakerA: plan.gatewaySupply.breakerA,
    supplyConductor: plan.gatewaySupply.conductor,
    landingLabel: label,
  };
}

/** A resolved plan + its composed metering, mapped the one way every drawing reads them. */
function fieldsFromPlan(plan: IntegratedEquipmentPlan, isMicro: boolean, met: DesignMetering): SldCombinerFields {
  // 🚨 TWO DIFFERENT QUESTIONS, TWO DIFFERENT DEVICES — on one plan only.
  // The name printed as the combiner is the box the branches LAND in; the
  // metering belongs to the brains. On every plan but a standalone gateway they
  // are the same device and both expressions return what this used before. On a
  // standalone gateway the brains is the Envoy (no busbar) and the landing box is
  // the PV AC combiner panel — naming the Envoy here is what drew the branch
  // breakers inside it.
  const landing = planLandingDevice(plan);
  const label = landing ? `${landing.brand} ${landing.model}` : undefined;

  // Only a micro job draws the device its branches land in (see the metering
  // note in sldCombinerFields), so only a micro job draws a standalone gateway
  // beside it.
  const standaloneGateway = isMicro ? standaloneGatewayFieldsFor(plan) : undefined;

  return {
    // The micro fallback string is kept because the renderer needs SOMETHING in
    // the schedule cell; what changed is that `combinerSelectionIsDecided` now
    // tells the sheet whether that string is a decision or a placeholder.
    combinerLabel: isMicro ? (label ?? 'IQ Combiner') : label,
    combinerModel: label,
    combinerHasIntegratedGateway: plan.hasIntegratedGateway,
    combinerProvidesAcDisconnect: plan.providesAcDisconnect,
    combinerSelectionIsDecided: combinerBasisIsDecided(plan.combinerBasis ?? 'unresolved-default'),
    combinerMeteringSummary: met.scheduleValue,
    metering: met.resolution,
    meteringDrawing: met.drawing,
    plan,
    ...(standaloneGateway ? { standaloneGateway } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HYBRID METERING — "add CTs to the hybrid SLDs too" (Ray, 2026-09-26).
//
// A hybrid (roof Enphase micro + ground string, say) drew NO CTs anywhere: the
// Diagram route's multi-lane branch returned before its metering was composed,
// the permit's multi-lane E-1 builder never composed any, PV-4A's hybrid path
// printed the circuit tables and nothing else, and the page hid the CT control
// on every hybrid. So a site whose roof lane lands in an IQ Combiner 5C — two
// consumption CTs in the box — was drawn and permitted as though no CT existed.
//
// Every one of those consumers now asks THIS, with the inputs it already hands
// the multi-lane renderer, and gets each lane's CTs from the ONE composer
// (resolveDesignMetering) run on THAT lane's own resolved plan:
//
//   · the lane plan is the one the drawing itself resolves — `acCollectionFromLanes`
//     with the same selection arguments — so the gateway whose CTs a lane carries
//     is the gateway that lane's box names, never a second resolve;
//   · only a lane whose resolved device METERS (a micro lane whose plan's brains
//     carries a metering capability — an IQ Combiner, or a standalone IQ Gateway)
//     gets anything; a string lane is returned untouched, by reference;
//   · 🚨 A SITE HAS ONE SERVICE, SO IT HAS ONE SET OF CONSUMPTION CTs. Exactly one
//     lane — the PRIMARY metering lane, the first lane whose device READS
//     consumption in the fixed roof > ground > fence order every hybrid artefact
//     already uses (the first metering lane of any kind only when none does) —
//     carries the consumption channel and its lead. Any other metering lane (a second Enphase
//     array with its own combiner) keeps its production channel only. Two
//     consumption sets on one service would each read the whole house, and the
//     monitoring would count every load twice.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A hybrid lane with its CTs.
 *
 * `SLDSourceBranch` (lib/sld-professional-renderer.ts) is the renderer's type
 * and now declares both fields itself, OPTIONAL, with exactly these shapes; this
 * intersection restates them so the composer's output type names what it
 * attaches, and a `MeteredSourceBranch[]` assigns to `SLDSourceBranch[]` as is.
 *
 * Both are ABSENT — never undefined-valued — on a lane that meters nothing, so
 * such a lane is the very object the caller passed in.
 */
export type MeteredSourceBranch = SLDSourceBranch & {
  /** This lane's CTs, lead(s) and "Consumption CTs" row, from the one composer.
   *  On a non-primary lane: production only (consumption, lead and the
   *  schedule row null; `leads` production-only or absent). */
  meteringDrawing?: SldMeteringDrawing;
  /** The lane's standalone IQ Gateway — the box its CT leads land on — when the
   *  lane's plan is that topology. Same shape as the single-lane field. */
  standaloneGateway?: StandaloneGatewayFields;
};

export interface HybridLaneMeteringInputs {
  /** The lanes exactly as the multi-lane renderer will receive them. */
  lanes: readonly SLDSourceBranch[];
  /** The SAME project-level selection the renderer is handed
   *  (`SLDProfessionalInput.selectedCombinerId`). */
  selectedCombinerId?: string | null;
  /** The SAME per-lane selections the renderer is handed
   *  (`SLDProfessionalInput.selectedCombinerIdByLane`). */
  selectedCombinerIdByLane?: Record<string, string | null | undefined> | null;
  /** The project interconnection, in the spelling the caller's single-lane
   *  path already hands the composer (permit: permitInterconnectionToken). */
  interconnectionRaw: string | null | undefined;
  /** The designer's recorded consumption-CT location ('' / absent ⇒ default). */
  consumptionCtLocation?: string | null;
  /** Service voltage at the measurement point (240 ⇒ 2 CTs). */
  systemVoltage?: number | null;
  /** Wins over the voltage table when the caller knows it (or knows it is
   *  UNRESOLVED — null). Passed through only when given. */
  ungroundedConductorCount?: number | null;
}

export interface HybridLaneMeteringResult {
  /** The lanes, in the order given, with their CTs attached where they meter. */
  lanes: MeteredSourceBranch[];
  /** The one lane that carries the site's consumption CTs — null ⇔ no lane meters. */
  primary: {
    key: SLDSourceBranch['key'];
    /** The composer's full answer for that lane (PV-4A prose, the snapshot record). */
    metering: DesignMetering;
    /** The lane mapped exactly as a single-lane design maps its plan — what the
     *  engineering page's CT control and CT-1 row read. */
    fields: SldCombinerFields;
  } | null;
  /** Every metering lane, in lane order, with the drawing it was given. */
  metered: Array<{
    key: SLDSourceBranch['key'];
    isPrimary: boolean;
    /** The device whose CTs these are (the gateway — never the landing panel). */
    meteringDeviceLabel: string;
    drawing: SldMeteringDrawing;
  }>;
}

const LANE_RANK: Record<string, number> = { roof: 0, ground: 1, fence: 2 };

/**
 * A non-primary lane's drawing: the composer's own output with the consumption
 * channel removed and nothing else touched. Every string it keeps is the
 * composer's; it composes nothing. The consumption fields go because another
 * lane's gateway reads the site's consumption — the schedule row and the
 * legacy `lead` both describe the CONSUMPTION CTs, so they go with them.
 * null ⇔ nothing is left to draw.
 */
function productionOnlyDrawing(d: SldMeteringDrawing): SldMeteringDrawing | null {
  if (!d.production) return null;
  const leads = (d.leads ?? []).filter(l => l.channel === 'production');
  return {
    production: d.production,
    consumption: null,
    lead: null,
    // ABSENT when empty, exactly as the composer states it.
    ...(leads.length ? { leads } : {}),
    scheduleRow: null,
  };
}

/** Compose every hybrid lane's metering — see the block comment above. */
export function hybridLaneMetering(inputs: HybridLaneMeteringInputs): HybridLaneMeteringResult {
  const lanes = [...inputs.lanes];
  // The drawing's own lane → plan mapping, with the drawing's own arguments.
  // `perSource` is `lanes.map(...)`, so index i IS lane i.
  const collection = acCollectionFromLanes(
    lanes, inputs.selectedCombinerId ?? null, inputs.selectedCombinerIdByLane ?? null);

  const composed = lanes.map((_lane, i) => {
    const src = collection.perSource[i];
    const plan = src?.isMicro ? src.plan : undefined;
    if (!plan) return null;
    const metering = resolveDesignMetering({
      plan: meteringSliceOf(plan),
      interconnectionRaw: inputs.interconnectionRaw,
      consumptionCtLocation: inputs.consumptionCtLocation ?? null,
      ...(inputs.systemVoltage != null ? { systemVoltage: inputs.systemVoltage } : {}),
      ...(inputs.ungroundedConductorCount !== undefined
        ? { ungroundedConductorCount: inputs.ungroundedConductorCount } : {}),
    });
    // A lane whose device meters nothing draws nothing — the composer's null.
    return metering.drawing ? { plan, metering, drawing: metering.drawing } : null;
  });

  // The primary metering lane: the first one in roof > ground > fence order,
  // whatever order the caller's array is in — AMONG THE LANES WHOSE DEVICE READS
  // CONSUMPTION, first. A lane whose device meters production only (its
  // capability provides no consumption channel, so the composer's `consumption`
  // is null) cannot carry the site's consumption CTs; picking it by rank alone
  // stripped consumption from a ground 5C that could read it, and the site drew,
  // stated and recorded no consumption CTs at all. Only when no lane reads
  // consumption does the rank alone pick (the primary then carries production).
  const rankOf = (i: number) => LANE_RANK[lanes[i].key] ?? 9;
  const firstByRank = (pred: (c: NonNullable<(typeof composed)[number]>) => boolean): number => {
    let best = -1;
    composed.forEach((c, i) => {
      if (!c || !pred(c)) return;
      if (best < 0 || rankOf(i) < rankOf(best)) best = i;
    });
    return best;
  };
  const withConsumption = firstByRank(c => !!c.drawing.consumption);
  const primaryIdx = withConsumption >= 0 ? withConsumption : firstByRank(() => true);

  const metered: HybridLaneMeteringResult['metered'] = [];
  const out = lanes.map((lane, i): MeteredSourceBranch => {
    const c = composed[i];
    if (!c) return lane;
    const isPrimary = i === primaryIdx;
    const drawing = isPrimary ? c.drawing : productionOnlyDrawing(c.drawing);
    // Every metering lane that is a standalone gateway carries its gateway: its
    // production CT's lead (5 ft, never extended) has to land on THAT box.
    const standaloneGateway = standaloneGatewayFieldsFor(c.plan);
    if (drawing) {
      const brains = c.plan.brains ?? c.plan.devices[0];
      metered.push({
        key: lane.key,
        isPrimary,
        meteringDeviceLabel: brains ? `${brains.brand} ${brains.model}` : 'GATEWAY',
        drawing,
      });
    }
    if (!drawing && !standaloneGateway) return lane;
    return {
      ...lane,
      ...(drawing ? { meteringDrawing: drawing } : {}),
      ...(standaloneGateway ? { standaloneGateway } : {}),
    };
  });

  const p = primaryIdx >= 0 ? composed[primaryIdx] : null;
  return {
    lanes: out,
    primary: p
      ? { key: lanes[primaryIdx].key, metering: p.metering, fields: fieldsFromPlan(p.plan, true, p.metering) }
      : null,
    metered,
  };
}
