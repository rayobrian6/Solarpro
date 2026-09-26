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
  planGatewayInstances,
  planGatewayTopology,
  planLandingDevice,
  resolveIntegratedEquipment,
  type HybridAcCollectionPlan,
  type IntegratedEquipmentPlan,
} from '@/lib/equipment/integratedBos';
import type { GatewayInstance } from '@/lib/equipment/enphaseGatewayMultiplicity';
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
  /**
   * 🚨 EVERY IQ COMBINER / ENVOY THE DESIGN NEEDS — present ONLY when that is
   * more than one (the plan's `gatewayMultiplicity`). Each with its branches,
   * its output breaker and its CTs; the drawing draws one box per entry, the
   * BOM buys one per entry. ABSENT on every other design (E-1 input keys are
   * pinned — tests/golden-path.test.ts).
   */
  gateways?: SldGatewayFields[];
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

/**
 * ONE gateway topology instance, as every drawing takes it — present only when
 * the design needs MORE THAN ONE IQ Combiner / Envoy (Ray, 2026-09-26:
 * "capacity determines multiplicity"). The renderer's
 * `SLDProfessionalInput.gateways` has this shape.
 */
export interface SldGatewayFields {
  /** 1-based, site-wide. */
  index: number;
  /** 'GATEWAY 1'. */
  label: string;
  /** The catalogue id of the topology (IQ Combiner, or the standalone system)
   *  — the drawing resolves its lane against exactly this, never a second pick. */
  topologyId: string;
  /** e.g. 'Enphase IQ Combiner 5C'. */
  deviceLabel: string;
  /** The arrays whose branches land here, and their branch numbers (1-based,
   *  within each array), in design order. */
  branches: Array<{ laneKey: string; branchNumber: number; deviceCount: number; continuousA: number; ocpdA: number }>;
  continuousCurrentA: number;
  outputOcpdA: number;
  /** This gateway's CTs: production on every one, the site's consumption on
   *  ONE (the first that reads it — one service, one set). Absent ⇔ none. */
  meteringDrawing?: SldMeteringDrawing;
  /** Present when the topology is the standalone IQ Gateway. */
  standaloneGateway?: StandaloneGatewayFields;
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
  // More than one instance: each gets its own entry, the first carrying the
  // site's consumption CTs (one service, one set) and every one its production.
  const gateways = isMicro ? sldGatewayFieldsOf(plan, met.drawing) : undefined;

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
    ...(gateways ? { gateways } : {}),
  };
}

/**
 * A plan's gateway instances as drawing fields — undefined unless the plan needs
 * MORE THAN ONE. The one mapping for every drawing: this adapter uses it, and a
 * route that resolves its own plan (the Diagram SLD route) calls it with the
 * drawing it composed for that plan. The first instance carries the site's
 * consumption CTs; every one its production channel.
 */
export function sldGatewayFieldsOf(
  plan: IntegratedEquipmentPlan,
  drawing: SldMeteringDrawing | null | undefined,
): SldGatewayFields[] | undefined {
  return plan.gatewayMultiplicity
    ? gatewayFieldsFor(plan, planGatewayInstances(plan), drawing ?? null, 0)
    : undefined;
}

/**
 * The drawing fields of a plan's gateway instances. `drawing` is the composer's
 * answer for this topology; instance number `primaryPosition` (0-based in the
 * list) carries it whole, every other one its production channel only — the
 * rule hybridLaneMetering applies to lanes, applied to instances.
 */
function gatewayFieldsFor(
  plan: IntegratedEquipmentPlan,
  instances: readonly GatewayInstance[],
  drawing: SldMeteringDrawing | null,
  primaryPosition: number,
): SldGatewayFields[] {
  const topo = planGatewayTopology(plan);
  const sg = standaloneGatewayFieldsFor(plan);
  return instances.map((inst, k) => {
    const md = drawing ? (k === primaryPosition ? drawing : productionOnlyDrawing(drawing)) : null;
    return {
      index: inst.index,
      label: inst.label,
      topologyId: topo?.id ?? inst.deviceId,
      deviceLabel: inst.deviceLabel,
      branches: inst.branches.map(b => ({
        laneKey: b.laneKey, branchNumber: b.branchNumber, deviceCount: b.deviceCount,
        continuousA: b.continuousA, ocpdA: b.ocpdA,
      })),
      continuousCurrentA: inst.continuousCurrentA,
      outputOcpdA: inst.outputOcpdA,
      ...(md ? { meteringDrawing: md } : {}),
      ...(sg ? { standaloneGateway: sg } : {}),
    };
  });
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
  /** Every metering lane (and every gateway that is not one whole lane), in
   *  lane order, with the drawing it was given. */
  metered: Array<{
    key: SLDSourceBranch['key'];
    isPrimary: boolean;
    /** The device whose CTs these are (the gateway — never the landing panel). */
    meteringDeviceLabel: string;
    drawing: SldMeteringDrawing;
    /** Present when these are a GATEWAY's CTs rather than one lane's: a gateway
     *  two lanes share, or one of an array's several (its site-wide index). */
    gatewayIndex?: number;
  }>;
  /**
   * The gateways that are NOT exactly one whole lane — a gateway two arrays
   * share, or each gateway of an array too big for one — with their CTs. The
   * drawing draws one box per entry here and no box on those lanes. EMPTY on
   * every hybrid in which each gateway is one whole lane (every hybrid before
   * 2026-09-26): their CTs ride on the lanes, exactly as they did.
   */
  gateways: SldGatewayFields[];
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

/** Compose every hybrid lane's metering — see the block comment above.
 *
 *  🚨 PER GATEWAY, NOT PER LANE (Ray, 2026-09-26). The metering belongs to the
 *  gateway instance, and gateways are counted over every lane that shares a
 *  topology (resolveHybridAcCollection): two small arrays may share ONE
 *  gateway, one big array may need TWO. A gateway that is exactly one whole
 *  lane — every hybrid gateway before that ruling — still hangs its CTs on its
 *  lane, so those sheets do not move; any other gateway is returned in
 *  `gateways`. One service, one set of consumption CTs: exactly one metering
 *  unit (lane or gateway) carries them. */
export function hybridLaneMetering(inputs: HybridLaneMeteringInputs): HybridLaneMeteringResult {
  const lanes = [...inputs.lanes];
  // The drawing's own lane → plan mapping, with the drawing's own arguments.
  // `perSource` is `lanes.map(...)`, so index i IS lane i.
  const collection = acCollectionFromLanes(
    lanes, inputs.selectedCombinerId ?? null, inputs.selectedCombinerIdByLane ?? null);

  const compose = (plan: IntegratedEquipmentPlan) => {
    const metering = resolveDesignMetering({
      plan: meteringSliceOf(plan),
      interconnectionRaw: inputs.interconnectionRaw,
      consumptionCtLocation: inputs.consumptionCtLocation ?? null,
      ...(inputs.systemVoltage != null ? { systemVoltage: inputs.systemVoltage } : {}),
      ...(inputs.ungroundedConductorCount !== undefined
        ? { ungroundedConductorCount: inputs.ungroundedConductorCount } : {}),
    });
    // A device that meters nothing draws nothing — the composer's null.
    return metering.drawing ? { plan, metering, drawing: metering.drawing } : null;
  };

  // The metering UNITS: each gateway instance, and each micro lane no gateway
  // counts (a non-Enphase micro lane — its plan says whether it meters).
  type Composed = NonNullable<ReturnType<typeof compose>>;
  interface Unit {
    /** Its first lane. */
    laneIdx: number;
    gw: HybridAcCollectionPlan['gateways'][number] | null;
    c: Composed | null;
  }
  const units: Unit[] = [];
  for (const gw of collection.gateways) {
    // A gateway two arrays share ranks — and is keyed — by its best-ranked
    // array, whatever order the caller's array is in.
    const laneIdx = lanes
      .map((l, i) => ({ i, k: l.key }))
      .filter(x => gw.laneKeys.includes(x.k))
      .sort((a, b) => (LANE_RANK[a.k] ?? 9) - (LANE_RANK[b.k] ?? 9) || a.i - b.i)[0]?.i ?? 0;
    units.push({ laneIdx, gw, c: compose(gw.plan) });
  }
  lanes.forEach((_lane, i) => {
    const src = collection.perSource[i];
    if (!src?.isMicro || src.gatewayIndexes?.length || !src.plan) return;
    units.push({ laneIdx: i, gw: null, c: compose(src.plan) });
  });

  // The primary metering unit: the first in roof > ground > fence order,
  // whatever order the caller's array is in — AMONG THE UNITS WHOSE DEVICE READS
  // CONSUMPTION, first. A unit whose device meters production only (its
  // capability provides no consumption channel, so the composer's `consumption`
  // is null) cannot carry the site's consumption CTs; picking it by rank alone
  // stripped consumption from a ground 5C that could read it, and the site drew,
  // stated and recorded no consumption CTs at all. Only when no unit reads
  // consumption does the rank alone pick (the primary then carries production).
  // A gateway ranks by its first lane; an array's own gateways by their number.
  const rankOf = (u: Unit) => (LANE_RANK[lanes[u.laneIdx]?.key] ?? 9) * 1000 + (u.gw?.index ?? 0);
  const firstByRank = (pred: (c: Composed) => boolean): Unit | null => {
    let best: Unit | null = null;
    for (const u of units) {
      if (!u.c || !pred(u.c)) continue;
      if (!best || rankOf(u) < rankOf(best)) best = u;
    }
    return best;
  };
  const primary = firstByRank(c => !!c.drawing.consumption) ?? firstByRank(() => true);
  const drawingOf = (u: Unit) => (u.c ? (u === primary ? u.c.drawing : productionOnlyDrawing(u.c.drawing)) : null);
  const deviceLabelOf = (plan: IntegratedEquipmentPlan) => {
    const brains = plan.brains ?? plan.devices[0];
    return brains ? `${brains.brand} ${brains.model}` : 'GATEWAY';
  };

  // Units in drawing order (lane order, an array's gateways by number).
  const ordered = [...units].sort((a, b) => a.laneIdx - b.laneIdx || (a.gw?.index ?? 0) - (b.gw?.index ?? 0));
  const metered: HybridLaneMeteringResult['metered'] = [];
  const gateways: SldGatewayFields[] = [];
  const laneAttach = new Map<number, { drawing: SldMeteringDrawing | null; standaloneGateway?: StandaloneGatewayFields }>();
  for (const u of ordered) {
    const drawing = drawingOf(u);
    const plan = u.c?.plan ?? u.gw?.plan;
    if (!plan) continue;
    // Every standalone gateway carries its gateway: its production CT's lead
    // (5 ft, never extended) has to land on THAT box.
    const standaloneGateway = standaloneGatewayFieldsFor(plan);
    const whole = !u.gw || u.gw.wholeLaneKey != null;
    if (drawing) {
      metered.push({
        key: lanes[u.laneIdx].key,
        isPrimary: u === primary,
        meteringDeviceLabel: deviceLabelOf(plan),
        drawing,
        ...(whole ? {} : { gatewayIndex: u.gw!.index }),
      });
    }
    if (whole) {
      laneAttach.set(u.laneIdx, { drawing, ...(standaloneGateway ? { standaloneGateway } : {}) });
    } else {
      const g = u.gw!;
      gateways.push({
        index: g.index,
        label: g.label,
        topologyId: planGatewayTopology(plan)?.id ?? g.deviceId,
        deviceLabel: g.deviceLabel,
        branches: g.branches.map(b => ({
          laneKey: b.laneKey, branchNumber: b.branchNumber, deviceCount: b.deviceCount,
          continuousA: b.continuousA, ocpdA: b.ocpdA,
        })),
        continuousCurrentA: g.continuousCurrentA,
        outputOcpdA: g.outputOcpdA,
        ...(drawing ? { meteringDrawing: drawing } : {}),
        ...(standaloneGateway ? { standaloneGateway } : {}),
      });
    }
  }

  const out = lanes.map((lane, i): MeteredSourceBranch => {
    const a = laneAttach.get(i);
    if (!a || (!a.drawing && !a.standaloneGateway)) return lane;
    return {
      ...lane,
      ...(a.drawing ? { meteringDrawing: a.drawing } : {}),
      ...(a.standaloneGateway ? { standaloneGateway: a.standaloneGateway } : {}),
    };
  });

  return {
    lanes: out,
    primary: primary?.c
      ? { key: lanes[primary.laneIdx].key, metering: primary.c.metering, fields: fieldsFromPlan(primary.c.plan, true, primary.c.metering) }
      : null,
    metered,
    gateways,
  };
}
