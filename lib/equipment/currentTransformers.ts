// ═══════════════════════════════════════════════════════════════════════════
// CURRENT TRANSFORMER / METERING AUTHORITY
//
// ─── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
// An IQ Combiner 6C job printed, on permit sheet PV-4A, "the integrated gateway
// provides production/consumption metering and monitoring per NEC 690.4" — and
// the 6C ships NO consumption CTs. No code path emitted a CT line item, so the
// crew arrived with a combiner that cannot measure consumption and nothing to
// make it work. That is the Tigo TS4-A-F failure mode repeating: a device whose
// stated function depends on companion hardware nobody bought.
//
// The reason the sheet could say it is that the whole question was ONE BOOLEAN.
// `IntegratedFunctions.metering?: boolean` cannot distinguish production from
// consumption metering — the exact axis Enphase's own documentation is built
// around — so three materially different devices all read `metering: true`:
//
//   IQ Combiner 6C  production metering INTEGRATED (factory, pre-wired);
//                   consumption CTs are a SEPARATE PURCHASE — none in the box
//   IQ Combiner 5C  production metering INTEGRATED; TWO consumption clamp CTs
//                   ship IN THE BOX
//   IQ Gateway      production CT ships in the box and is FIELD-INSTALLED;
//                   consumption CTs are a separate purchase
//
// ─── WHAT THIS MODULE OWNS ─────────────────────────────────────────────────
// Which conductors each measurement device encircles, and which DER sources sit
// on each side. Everything else — the metering mode, whether a sheet may assert
// consumption metering, what the BOM must buy — is derived from that and from
// nothing else.
//
// ─── IT REFUSES ─────────────────────────────────────────────────────────────
// The consumption metering MODE is arithmetic, not preference:
//
//   LOAD WITH SOLAR ("Net")  CTs between the utility meter and the main load
//                            centre, UPSTREAM of where PV lands. They carry net
//                            service current (I_load − I_PV), signed.
//   LOAD ONLY ("Total")      CTs DOWNSTREAM of where PV lands. They carry total
//                            load current, always positive.
//
// There is no third mode. When load is fed ahead of the consumption CTs, or PV
// lands behind them, NEITHER mode is correct and the correct product behaviour
// is to refuse. `INDETERMINATE` is a first-class answer here; it is never
// silently resolved to whichever mode is more common.
//
// The same rule governs the placement itself: a design that has not recorded
// where its consumption CTs clamp is UNRESOLVED, not "probably at the service
// entrance". The QUANTITY survives that refusal — one CT per ungrounded
// conductor is true wherever they clamp — so the BOM can still buy the hardware
// while the drawings decline to state a mode.
//
// ─── PART NUMBERS ───────────────────────────────────────────────────────────
// ⚠ NOTHING HERE IS INVENTED, AND NOT EVERYTHING HERE IS PRIMARY-SOURCED.
// The Enphase CT part numbers below are recorded in this repo's manufacturer
// research file (`lib/data/equipment/bos-devices-research.json`), inside the
// metering notes of the IQ Gateway / IQ Combiner records whose primary sources
// are the Enphase IQ Gateway data sheet DSH-00111-6.0 and the IQ Combiner data
// sheets. They are NOT transcribed from a CT data sheet held in this repo, and
// no CT data sheet is held in this repo. They are therefore marked
// `repo-research-secondary`, which is NOT orderable: a line carrying one is
// emitted visibly, excluded from the authoritative procurement total, and
// carries a blocking requirement that clears when somebody confirms the SKU
// against Enphase's current ordering documentation. A candidate part number the
// crew can check beats both a silent omission and a confident guess.
//
// See docs/ENPHASE-CT-SLD-CONSOLIDATED.md and docs/ENPHASE-CT-TOPOLOGY-REPORT.md
// for the full manufacturer research this module encodes.
// ═══════════════════════════════════════════════════════════════════════════

import type { ProcurementAuthorityState, BomQuantitySource } from '@/lib/bom-types-v4';

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** WHAT a measurement channel measures. Not a device, not a mode. */
export type MeteringChannel = 'production' | 'consumption' | 'storage';

/** Physical CT construction. A solid-core CT cannot be fitted over an existing
 *  conductor without disconnecting it; a split-core / clamp CT can. */
export type CtCoreType = 'solid-core' | 'split-core' | 'clamp';

/**
 * WHERE the measurement is taken, relative to the main breaker and the PV
 * interconnection. This is the whole authority — the mode, the NEC statement and
 * the drawing all derive from it.
 */
export type MeasurementBoundary =
  /** the PV output circuit only (production). */
  | 'pv-output-circuit'
  /** between the utility meter and the main load centre, UPSTREAM of where PV
   *  lands. Carries net service current. */
  | 'service-entrance-upstream-of-pv'
  /** DOWNSTREAM of where PV lands. Carries load current only. */
  | 'load-side-downstream-of-pv'
  /** the storage circuit (battery). */
  | 'storage-circuit'
  /** the design has not established it. NEVER a default for a real boundary. */
  | 'unresolved';

/** HOW the channel is realised — the axis a boolean destroyed. */
export type MeteringRealisation =
  /** built into the device at the factory, pre-wired, no field CT work. */
  | 'factory-integrated'
  /** the CTs are in the box but the installer clamps them in the field. */
  | 'ships-with-device'
  /** a CT must be PURCHASED SEPARATELY and field-installed. */
  | 'separate-purchase-field-installed'
  /** the device does not provide this channel at all. */
  | 'not-provided'
  /** not established for this device. */
  | 'unresolved';

/** The consumption metering mode. DERIVED, never selected. */
export type ConsumptionMeteringMode = 'LOAD_WITH_SOLAR' | 'LOAD_ONLY' | 'INDETERMINATE';

/** How far a part number's identity is established IN THIS REPO. */
export type SkuProvenance =
  /** transcribed from a manufacturer data sheet recorded in this repo. */
  | 'manufacturer-datasheet'
  /** recorded in lib/data/equipment/bos-devices-research.json, but inside
   *  another device's notes rather than from a data sheet for this part. */
  | 'repo-research-secondary'
  /** not established. Such a part number is never emitted. */
  | 'unverified';

/** The ONLY provenance a row may present as a selected, orderable product. */
export const ORDERABLE_SKU_PROVENANCE: readonly SkuProvenance[] = ['manufacturer-datasheet'];

export function skuIsOrderable(p: SkuProvenance): boolean {
  return ORDERABLE_SKU_PROVENANCE.includes(p);
}

// ── The CT itself ───────────────────────────────────────────────────────────

export interface CurrentTransformerSpec {
  id: string;
  brand: string;
  model: string;
  /** null ⇒ UNRESOLVED. A CT with no established part number is still a real
   *  requirement; it is emitted as an unresolved line, never as a guess. */
  sku: string | null;
  skuProvenance: SkuProvenance;
  /** exactly where the part number came from, so a reviewer can re-check it. */
  skuCitation: string;
  channel: MeteringChannel;
  coreType: CtCoreType;
  /** rated primary current, amps. null ⇒ UNRESOLVED. */
  ratedPrimaryA: number | null;
  /**
   * Primary:secondary ratio.
   *
   * 🚨 null ON EVERY ENPHASE ROW, DELIBERATELY. These are millivolt-output CTs
   * whose secondary output is not recorded in any document held in this repo. A
   * ratio is a number an engineer can act on, so an unverified one is worse than
   * none. It stays null until a data sheet is in the repo.
   */
  ratio: string | null;
  ratioProvenance: SkuProvenance;
  /** metering accuracy as the manufacturer states it. null ⇒ UNRESOLVED. */
  accuracyClass: string | null;
  /** true ⇒ one CT per ungrounded conductor measured (the split-phase pair). */
  perUngroundedConductor: boolean;
  notes: string;
}

const RESEARCH_FILE = 'lib/data/equipment/bos-devices-research.json';

/**
 * The CT catalogue.
 *
 * Every row's `skuProvenance` is `repo-research-secondary` — see the file header.
 * That is not a formality: it is what stops these part numbers reaching a
 * purchase order as though they were verified.
 */
export const CURRENT_TRANSFORMERS: CurrentTransformerSpec[] = [
  {
    id: 'enphase-ct-200-split',
    brand: 'Enphase',
    model: 'Consumption CT, 200 A split-core',
    sku: 'CT-200-SPLIT',
    skuProvenance: 'repo-research-secondary',
    skuCitation:
      `${RESEARCH_FILE} → enphase-iq-combiner-4c.integratedMeteringCTNote `
      + '("consumption via CT-200-SPLIT pair") and enphase-iq-gateway'
      + '.integratedMeteringCTNote; primary source cited there is the Enphase IQ '
      + 'Gateway data sheet DSH-00111-6.0. No CT data sheet is held in this repo.',
    channel: 'consumption',
    coreType: 'split-core',
    ratedPrimaryA: 200,
    ratio: null,
    ratioProvenance: 'unverified',
    accuracyClass: '±2.5% (consumption)',
    perUngroundedConductor: true,
    notes:
      'Split-core: fits over an existing service conductor without disconnecting it. '
      + 'Enphase gates the physical placement — each conductor needs ≥2.0 in of accessible '
      + 'length with ≥0.75 in clearance, and must be smaller than 350 MCM THWN / 350 MCM '
      + 'XHHW / 4/0 RHW. In a combined meter-main the line side is frequently utility-sealed '
      + 'and the load-with-solar boundary is physically unreachable without a utility visit.',
  },
  {
    id: 'enphase-ct-200-clamp',
    brand: 'Enphase',
    model: 'Consumption CT, 200 A clamp',
    sku: 'CT-200-CLAMP',
    skuProvenance: 'repo-research-secondary',
    skuCitation:
      `${RESEARCH_FILE} → enphase-iq-gateway.integratedMeteringCTNote `
      + '("Consumption (+/-2.5%) and IQ Battery 5P metering (+/-2.5%) optional via '
      + 'CT-200-SPLIT / CT-200-CLAMP (order separately)").',
    channel: 'consumption',
    coreType: 'clamp',
    ratedPrimaryA: 200,
    ratio: null,
    ratioProvenance: 'unverified',
    accuracyClass: '±2.5% (consumption)',
    perUngroundedConductor: true,
    notes: 'The clamp CT shipped in the IQ Combiner 5/5C box. Same channel as CT-200-SPLIT.',
  },
  {
    id: 'enphase-ct-200-solid',
    brand: 'Enphase',
    model: 'Production CT, 200 A solid-core',
    sku: 'CT-200-SOLID',
    skuProvenance: 'repo-research-secondary',
    skuCitation:
      `${RESEARCH_FILE} → enphase-iq-gateway.integratedMeteringCTNote `
      + '("ships with one CT-200-SOLID production CT"); primary source cited there is '
      + 'the Enphase IQ Gateway data sheet DSH-00111-6.0.',
    channel: 'production',
    coreType: 'solid-core',
    ratedPrimaryA: 200,
    ratio: null,
    ratioProvenance: 'unverified',
    accuracyClass: 'ANSI C12.20 class 0.5 (±0.5%)',
    perUngroundedConductor: false,
    notes:
      'Solid-core: the PV output conductor must be disconnected to pass it through. '
      + 'Ships in the box with a standalone IQ Gateway; integral and pre-wired in every '
      + 'IQ Combiner, where it is not a separate purchase.',
  },
];

export function getCurrentTransformer(id: string | null | undefined): CurrentTransformerSpec | undefined {
  if (!id) return undefined;
  return CURRENT_TRANSFORMERS.find(c => c.id === id);
}

// ── What a DEVICE measures ──────────────────────────────────────────────────

/** One measurement channel of one device. This is what replaces the boolean. */
export interface MeteringChannelCapability {
  channel: MeteringChannel;
  realisation: MeteringRealisation;
  /** where this channel's measurement is taken, when the DEVICE fixes it.
   *  A channel whose boundary depends on where the installer clamps a field CT
   *  is 'unresolved' here and must be resolved from the design. */
  boundary: MeasurementBoundary;
  /** how many CTs for this channel are IN THE BOX. 0 is a real answer and the
   *  whole point of this module; null ⇒ UNRESOLVED. */
  ctsIncluded: number | null;
  /** the CT that must be bought when the box does not contain them. */
  requiredCtId: string | null;
  accuracyClass: string | null;
  note: string;
}

/** Everything a device measures. Replaces `IntegratedFunctions.metering`. */
export interface DeviceMeteringCapability {
  production: MeteringChannelCapability;
  consumption: MeteringChannelCapability;
  storage?: MeteringChannelCapability;
  /** where these facts came from. */
  citation: string;
}

/** TRUE ⇔ the device measures anything at all — the legacy boolean, DERIVED.
 *  Consumers that have not been converted read this; it is generated from the
 *  capability above so the two can never disagree. */
export function deviceMetersAnything(m: DeviceMeteringCapability | undefined): boolean {
  if (!m) return false;
  const live = (c: MeteringChannelCapability | undefined) =>
    !!c && c.realisation !== 'not-provided' && c.realisation !== 'unresolved';
  return live(m.production) || live(m.consumption) || live(m.storage);
}

/** TRUE ⇔ this device, as shipped, can measure consumption with nothing added. */
export function consumptionMeteringIsSelfSufficient(m: DeviceMeteringCapability | undefined): boolean {
  if (!m) return false;
  const c = m.consumption;
  return c.realisation === 'factory-integrated'
    || (c.realisation === 'ships-with-device' && (c.ctsIncluded ?? 0) > 0);
}

// ── Interconnection, without a substring matcher ─────────────────────────────

/** Which side of the service disconnect the PV lands on, for metering purposes. */
export type PvConnectionSide = 'load-side' | 'supply-side' | 'unresolved';

/**
 * Normalise the design's recorded interconnection to a side.
 *
 * 🚨 EXACT TOKEN MATCH, NEVER A SUBSTRING. This repo already carries six
 * interconnection enums and five substring matchers, and a substring matcher is
 * how `sub_panel` became 'supply-side'. A token this table does not know is
 * UNRESOLVED — which makes the metering mode INDETERMINATE, which refuses. That
 * is the correct failure: an unknown interconnection cannot imply a CT boundary.
 */
export function pvConnectionSide(raw: string | null | undefined): PvConnectionSide {
  if (raw == null) return 'unresolved';
  const t = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!t) return 'unresolved';
  // PV lands DOWNSTREAM of the service disconnect (a busbar, a feeder, a tap
  // inside the premises wiring). NEC 705.12.
  const LOAD_SIDE = new Set([
    'LOAD_SIDE', 'LOAD_SIDE_TAP', 'LOAD_SIDE_BREAKER', 'LOADSIDE',
    'BACKFED_BREAKER', 'BACKFEED_BREAKER', 'BREAKER', 'BUSBAR',
    'MAIN_BREAKER_DERATE', 'DERATE', 'PANEL_UPGRADE', 'SUB_PANEL', 'SUBPANEL',
  ]);
  // PV lands UPSTREAM of the service disconnect. NEC 705.11.
  const SUPPLY_SIDE = new Set([
    'SUPPLY_SIDE', 'SUPPLY_SIDE_TAP', 'SUPPLYSIDE',
    'LINE_SIDE', 'LINE_SIDE_TAP', 'LINESIDE',
  ]);
  if (LOAD_SIDE.has(t)) return 'load-side';
  if (SUPPLY_SIDE.has(t)) return 'supply-side';
  return 'unresolved';
}

/**
 * The metering mode, DERIVED from where the CTs clamp and where PV lands.
 *
 * | consumption CT boundary            | PV side     | mode            |
 * |------------------------------------|-------------|-----------------|
 * | service entrance, upstream of PV   | load-side   | LOAD_WITH_SOLAR |
 * | service entrance, upstream of PV   | supply-side | INDETERMINATE * |
 * | downstream of PV                   | resolved    | LOAD_ONLY       |
 * | anything                           | unresolved  | INDETERMINATE   |
 * | unresolved                         | anything    | INDETERMINATE   |
 *
 * * A supply-side tap lands on the very span the "upstream of PV" CTs occupy, so
 *   whether PV current passes through them is not implied by the labels — it
 *   depends on which side of the tap node the CTs sit. Neither mode can be
 *   asserted. This is the mixed supply-side + backfed-breaker failure, and the
 *   correct behaviour is to refuse rather than pick one.
 */
export function deriveConsumptionMeteringMode(
  boundary: MeasurementBoundary,
  side: PvConnectionSide,
): ConsumptionMeteringMode {
  if (side === 'unresolved') return 'INDETERMINATE';
  if (boundary === 'load-side-downstream-of-pv') return 'LOAD_ONLY';
  if (boundary === 'service-entrance-upstream-of-pv') {
    return side === 'load-side' ? 'LOAD_WITH_SOLAR' : 'INDETERMINATE';
  }
  return 'INDETERMINATE';
}

/**
 * Ungrounded (hot) conductors at the point of consumption measurement — the CT
 * count for the pair. Explicit cases only; anything else is UNRESOLVED, because
 * a wrong count here is a wrong purchase order.
 */
export function ungroundedConductorsForService(
  systemVoltage: number | null | undefined,
  phases: 1 | 3 | null | undefined,
): number | null {
  if (systemVoltage == null) return null;
  const v = Math.round(Number(systemVoltage));
  if ((phases ?? 1) === 1 && (v === 240 || v === 208 || v === 120)) return 2;  // split-phase 3-wire
  if (phases === 3 && (v === 208 || v === 480)) return 3;
  return null;
}

// ── Where the consumption CTs physically clamp ───────────────────────────────
//
// Ray, 2026-09-25: "there is no ct logic whatsoever." The authority above could
// always derive a mode — nothing ever told it WHERE the CTs clamp, so every
// Enphase job printed "CONS (MODE TBD)" forever. A location is now recorded (or
// defaulted from the interconnection the designer already chose, and labelled
// as a default), and turned into a boundary HERE — the one table.
//
// 🚨 A PHYSICAL LOCATION, NOT "UPSTREAM/DOWNSTREAM OF PV". A recorded location
// must not silently change meaning when the interconnection changes: the same
// clamp position is re-derived against the new side, and a combination that has
// no valid mode (a "between the tap and the main" record on a job that has no
// tap) resolves to 'unresolved' and refuses, exactly as before.

/** Where the consumption CTs clamp, physically. */
export type ConsumptionCtLocation =
  /** service-entrance conductors, line side of the main breaker (meter → main). */
  | 'sec-line-side-of-main'
  /** supply-side tap jobs: on L1/L2 between the NEC 705.11 tap and the main. */
  | 'between-tap-and-main'
  /** on the main breaker's LOAD side (main → bus). */
  | 'main-breaker-load-side';

export const CONSUMPTION_CT_LOCATIONS: readonly ConsumptionCtLocation[] =
  ['sec-line-side-of-main', 'between-tap-and-main', 'main-breaker-load-side'];

/** Exact token match, never a substring. Unknown ⇒ null (not recorded). */
export function parseConsumptionCtLocation(raw: unknown): ConsumptionCtLocation | null {
  const t = typeof raw === 'string' ? raw.trim() : '';
  return (CONSUMPTION_CT_LOCATIONS as readonly string[]).includes(t) ? (t as ConsumptionCtLocation) : null;
}

/**
 * The documented Enphase placement for the interconnection already chosen
 * (docs/ENPHASE-CT-TOPOLOGY-REPORT.md §1.3-1.4):
 *   load-side (backfed breaker / derate / panel upgrade) → service-entrance
 *     conductors ahead of the main — the gateway meter type is Net ("Load with
 *     Solar");
 *   supply-side (705.11 tap) → L1/L2 between the tap and the main — a
 *     line-side-connected array is metered Total ("Load only").
 * Every sheet that prints a defaulted location says it is a default.
 */
export function defaultConsumptionCtLocation(side: PvConnectionSide): ConsumptionCtLocation | null {
  if (side === 'load-side') return 'sec-line-side-of-main';
  if (side === 'supply-side') return 'between-tap-and-main';
  return null;
}

/** The measurement boundary a physical location has, for this PV side. */
export function consumptionCtBoundaryFor(
  loc: ConsumptionCtLocation | null | undefined,
  side: PvConnectionSide,
): MeasurementBoundary {
  if (!loc || side === 'unresolved') return 'unresolved';
  switch (loc) {
    case 'sec-line-side-of-main':
      // Load-side PV lands on the bus, downstream: the CTs see net current.
      // Supply-side PV lands on this same span — the table above refuses it.
      return 'service-entrance-upstream-of-pv';
    case 'between-tap-and-main':
      // Only a supply-side tap has a "between the tap and the main". A record
      // of it on a load-side job is stale, and refuses.
      return side === 'supply-side' ? 'load-side-downstream-of-pv' : 'unresolved';
    case 'main-breaker-load-side':
      return side === 'load-side' ? 'service-entrance-upstream-of-pv' : 'load-side-downstream-of-pv';
  }
  return 'unresolved';
}

// ── The resolution ───────────────────────────────────────────────────────────

export type MeteringBlockerCode =
  /** the design has not established where the consumption CTs clamp, or on
   *  which side PV lands, so no mode can be stated. */
  | 'CT-TOPOLOGY-UNRESOLVED'
  /** the selected device cannot measure consumption as shipped and the CTs are
   *  a separate purchase — the 6C case. */
  | 'CT-CONSUMPTION-NOT-PROVIDED'
  /** the CT part number is not established against manufacturer documentation. */
  | 'CT-SKU-UNVERIFIED';

/** A BOM line the CT authority requires. Same shape as the Tigo companion line,
 *  so both reach `addItem` through identical plumbing. */
export interface MeteringCtLine {
  manufacturer: string;
  model: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: string;
  necReference: string;
  derivedFrom: string;
  formula: string;
  authorityStateHint: ProcurementAuthorityState;
  authorityStateHintReason: string;
  quantitySource: BomQuantitySource;
}

export interface MeteringResolutionInput {
  /** the resolved device's capability. null ⇒ no integrated device (or a device
   *  whose metering is not modelled) ⇒ nothing is asserted about metering. */
  capability: DeviceMeteringCapability | null;
  /** for the message, e.g. 'IQ Combiner 6C'. */
  deviceLabel: string | null;
  /** the design's recorded interconnection, in whatever spelling it uses. */
  interconnectionRaw: string | null | undefined;
  /**
   * WHERE the consumption CTs clamp, when the design has recorded it.
   *
   * Nothing in this repo records it yet, so it is normally undefined — and that
   * is exactly the refusal this module exists for. It is an input, not a guess.
   */
  consumptionCtBoundary?: MeasurementBoundary;
  /** ungrounded conductors measured. null ⇒ the CT quantity is UNRESOLVED. */
  ungroundedConductorCount: number | null;
  /** does this design require consumption metering at all? (utility export
   *  limiting, a monitoring commitment, a storage system that needs it). */
  consumptionMeteringRequired: boolean;
}

export interface MeteringResolution {
  /** RESOLVED ⇔ every question this module was asked has a real answer. */
  status: 'RESOLVED' | 'UNRESOLVED';
  consumptionMode: ConsumptionMeteringMode;
  consumptionBoundary: MeasurementBoundary;
  productionRealisation: MeteringRealisation;
  /**
   * 🚨 THE ONE FACT PV-4A MAY NOT GET WRONG. TRUE ⇔ this design actually has
   * consumption measurement — integrated, in the box, or bought. False means no
   * sheet may say the system meters consumption.
   */
  consumptionMeteringProvided: boolean;
  /** hardware the design must buy for its metering to work. */
  lines: MeteringCtLine[];
  blockerCode: MeteringBlockerCode | null;
  blockerMessage: string | null;
  /** auditable derivation. */
  basis: string;
  /** one line a drawing or schedule can print verbatim. */
  disclosure: string;
}

const NO_METERING_RESOLUTION: MeteringResolution = {
  status: 'RESOLVED',
  consumptionMode: 'INDETERMINATE',
  consumptionBoundary: 'unresolved',
  productionRealisation: 'not-provided',
  consumptionMeteringProvided: false,
  lines: [],
  blockerCode: null,
  blockerMessage: null,
  basis: 'no metering device is modelled for this design — nothing is asserted about metering',
  disclosure: 'METERING NOT MODELLED',
};

/**
 * Resolve the metering requirement for one design.
 *
 * ─── WHY THE QUANTITY SURVIVES THE REFUSAL ──────────────────────────────────
 * One consumption CT per ungrounded conductor is true wherever they clamp, so an
 * unresolved boundary does not stop the BOM buying the hardware — it stops the
 * DRAWINGS stating a mode. Those are different questions and were previously the
 * same boolean. The crew gets the parts; the sheet stops asserting.
 */
export function resolveMeteringRequirement(input: MeteringResolutionInput): MeteringResolution {
  const cap = input.capability;
  if (!cap) return NO_METERING_RESOLUTION;

  const side = pvConnectionSide(input.interconnectionRaw);
  const boundary = input.consumptionCtBoundary ?? cap.consumption.boundary ?? 'unresolved';
  const mode = deriveConsumptionMeteringMode(boundary, side);

  const selfSufficient = consumptionMeteringIsSelfSufficient(cap);
  const needsPurchase =
    cap.consumption.realisation === 'separate-purchase-field-installed'
    && !!cap.consumption.requiredCtId;

  const lines: MeteringCtLine[] = [];
  const reasons: string[] = [];
  let blockerCode: MeteringBlockerCode | null = null;
  let blockerMessage: string | null = null;

  // ── The purchase ──────────────────────────────────────────────────────────
  if (input.consumptionMeteringRequired && needsPurchase) {
    const ct = getCurrentTransformer(cap.consumption.requiredCtId);
    if (ct) {
      const qty = ct.perUngroundedConductor ? input.ungroundedConductorCount : 1;
      const quantityKnown = qty != null && qty > 0;
      const orderable = ct.sku != null && skuIsOrderable(ct.skuProvenance);

      // Two independent reasons a row is not orderable, reported honestly and
      // never merged: the SELECTION may be unverified, the QUANTITY may be
      // unknown, and a row can suffer both.
      const state: ProcurementAuthorityState =
        !quantityKnown ? 'QUANTITY_PENDING'
        : !orderable ? 'CANDIDATE_NON_ORDERABLE'
        : 'VERIFIED_ORDERABLE';

      const stateReason =
        !quantityKnown
          ? 'QUANTITY UNRESOLVED — the number of ungrounded conductors at the measurement '
            + 'point is not established, and one CT is required per ungrounded conductor. '
            + 'Excluded from the authoritative procurement total.'
          : !orderable
            ? `CANDIDATE PART NUMBER — ${ct.sku} is recorded in this repo only at: ${ct.skuCitation} `
              + 'It has not been transcribed from a CT data sheet, so it is not presented as a '
              + 'verified selection. Confirm against Enphase ordering documentation before '
              + 'purchase. Excluded from the authoritative procurement total.'
            : '';

      lines.push({
        manufacturer: ct.brand,
        model: ct.model,
        partNumber: ct.sku ?? 'UNRESOLVED',
        description:
          `Consumption current transformer — ${ct.coreType}, ${ct.ratedPrimaryA ?? 'UNRESOLVED'} A, `
          + `${ct.accuracyClass ?? 'accuracy UNRESOLVED'}. `
          + `REQUIRED BY THE SELECTED DEVICE: ${input.deviceLabel ?? 'the metering device'} `
          + 'integrates production metering but ships NO consumption CTs — they are a separate '
          + 'purchase. Without them the system cannot measure consumption at all. '
          + `Ratio: ${ct.ratio ?? 'UNRESOLVED — not recorded in any document held in this repo'}.`,
        quantity: quantityKnown ? qty! : 0,
        unit: 'ea',
        necReference: 'NEC 690.4',
        derivedFrom: 'CT authority — device metering capability × ungrounded conductors measured',
        formula: quantityKnown
          ? `1 CT per ungrounded conductor × ${qty} ungrounded conductor(s) = ${qty}`
          : '1 CT per ungrounded conductor × UNRESOLVED',
        authorityStateHint: state,
        authorityStateHintReason: stateReason,
        quantitySource: 'topology-derived',
      });

      if (!quantityKnown) {
        blockerCode = 'CT-TOPOLOGY-UNRESOLVED';
        reasons.push('the CT quantity depends on an unresolved ungrounded-conductor count');
      } else if (!orderable) {
        blockerCode = 'CT-SKU-UNVERIFIED';
        reasons.push(`the consumption CT part number ${ct.sku} is not verified against manufacturer documentation`);
      }
      blockerMessage =
        `${input.deviceLabel ?? 'The selected metering device'} integrates production metering and ships `
        + 'NO consumption CTs. Consumption metering is required by this design, so '
        + `${quantityKnown ? qty : 'an unresolved number of'} consumption CT(s) must be purchased `
        + 'separately or the installed system cannot measure consumption. '
        + (blockerCode === 'CT-SKU-UNVERIFIED'
          ? `Confirm the part number (${ct.sku}) against Enphase ordering documentation before purchase.`
          : 'Establish the ungrounded-conductor count at the measurement point before ordering.');
    } else {
      // The capability names a CT the catalogue does not hold. Refuse loudly —
      // this is never allowed to silently mean "no CT needed".
      blockerCode = 'CT-CONSUMPTION-NOT-PROVIDED';
      blockerMessage =
        `${input.deviceLabel ?? 'The selected metering device'} requires a consumption CT that the CT `
        + `catalogue does not hold (id '${cap.consumption.requiredCtId}'). The requirement is real and `
        + 'the part is UNRESOLVED — do not release this package until it is identified.';
      reasons.push('the required consumption CT is not in the catalogue');
    }
  }

  // ── The assertion ─────────────────────────────────────────────────────────
  // Consumption metering EXISTS when the device provides it as shipped, or when
  // this resolution has put the CTs in the BOM.
  const consumptionMeteringProvided =
    input.consumptionMeteringRequired
      ? (selfSufficient || lines.length > 0)
      : selfSufficient;

  if (input.consumptionMeteringRequired && !consumptionMeteringProvided && !blockerCode) {
    blockerCode = 'CT-CONSUMPTION-NOT-PROVIDED';
    blockerMessage =
      `${input.deviceLabel ?? 'The selected metering device'} does not provide consumption metering and no `
      + 'consumption CT is specified. No sheet in this package may assert consumption metering.';
    reasons.push('consumption metering is required and nothing provides it');
  }

  if (mode === 'INDETERMINATE' && consumptionMeteringProvided) {
    reasons.push(
      side === 'unresolved'
        ? 'the interconnection side is not established, so no metering mode follows from it'
        : boundary === 'unresolved'
          ? 'the design has not recorded where the consumption CTs clamp'
          : 'a supply-side connection lands on the same span as the service-entrance CTs, so '
            + 'neither Load-With-Solar nor Load-Only can be asserted',
    );
    if (!blockerCode) {
      blockerCode = 'CT-TOPOLOGY-UNRESOLVED';
      blockerMessage =
        'The consumption metering MODE is INDETERMINATE: '
        + reasons[reasons.length - 1] + '. '
        + 'Load-With-Solar and Load-Only are arithmetic opposites and there is no third mode — '
        + 'record where the consumption CTs clamp relative to the PV interconnection before release.';
    }
  }

  const status: 'RESOLVED' | 'UNRESOLVED' = blockerCode ? 'UNRESOLVED' : 'RESOLVED';

  const basis =
    `device=${input.deviceLabel ?? 'none'}; production=${cap.production.realisation}; `
    + `consumption=${cap.consumption.realisation} (in box: ${cap.consumption.ctsIncluded ?? 'UNRESOLVED'}); `
    + `pv side=${side}; consumption CT boundary=${boundary}; mode=${mode}`
    + (reasons.length ? `; unresolved because ${reasons.join('; ')}` : '');

  return {
    status,
    consumptionMode: mode,
    consumptionBoundary: boundary,
    productionRealisation: cap.production.realisation,
    consumptionMeteringProvided,
    lines,
    blockerCode,
    blockerMessage,
    basis,
    disclosure: meteringDisclosure(cap, mode, consumptionMeteringProvided, input.deviceLabel),
  };
}

/** The one sentence a drawing or a schedule prints. No consumer writes its own. */
export function meteringDisclosure(
  cap: DeviceMeteringCapability,
  mode: ConsumptionMeteringMode,
  consumptionProvided: boolean,
  deviceLabel: string | null,
): string {
  const who = deviceLabel ?? 'the metering device';
  const prod =
    cap.production.realisation === 'factory-integrated'
      ? `production metering is integral to ${who}${cap.production.accuracyClass ? ` (${cap.production.accuracyClass})` : ''}`
      : cap.production.realisation === 'ships-with-device'
        ? `a production CT ships with ${who} and is field-installed on the PV output circuit`
        : cap.production.realisation === 'separate-purchase-field-installed'
          ? 'a production CT is a separate purchase'
          : 'production metering is NOT PROVIDED';
  const cons = !consumptionProvided
    ? 'consumption metering is NOT PROVIDED'
    : mode === 'INDETERMINATE'
      ? 'consumption CTs are specified; their metering mode is UNRESOLVED pending the recorded CT placement'
      : `consumption CTs are specified, ${mode === 'LOAD_WITH_SOLAR' ? 'Load With Solar' : 'Load Only'}`;
  return `${prod}; ${cons}.`;
}

/**
 * The metering cell for an equipment schedule — a drawing cell, so it is SHORT.
 * Same authority as the prose disclosure, so a schedule and a note cannot
 * disagree about whether consumption is measured.
 */
export function meteringScheduleValue(r: MeteringResolution): string {
  const prod =
    r.productionRealisation === 'factory-integrated' ? 'PROD (INT.)'
    : r.productionRealisation === 'ships-with-device' ? 'PROD (CT)'
    : r.productionRealisation === 'separate-purchase-field-installed' ? 'PROD (ORDER CT)'
    : 'NO PROD';
  if (!r.consumptionMeteringProvided) return `${prod} · NO CONS`;
  const mode =
    r.consumptionMode === 'LOAD_WITH_SOLAR' ? 'NET'
    : r.consumptionMode === 'LOAD_ONLY' ? 'TOTAL'   // Enphase's own term (meter type 'Total')
    : 'MODE TBD';
  return `${prod} · CONS (${mode})`;
}

// ── The one key name for the production-meter control ───────────────────────

/**
 * 🚨 THE UI CONTROL REACHED NOTHING — THREE UNCONNECTED KEY NAMES.
 *
 * The engineering page posts `productionMeter`. The SLD route read
 * `body.hasProductionMeter`, which was never sent, so `!== false` was true on
 * every request. The BOM route read `body.requiresProductionMeter`, which was
 * never sent either, so `?? false` was false on every request. The toggle was
 * inert in BOTH directions and each route had a different hard-wired answer.
 *
 * `productionMeter` is THE key name — it is what the UI has always sent and what
 * `PermitInput.project` already carries. The legacy names are read only as
 * fallbacks, for callers that have not been converted, and are listed here
 * rather than re-derived at each site so a seventh spelling cannot appear.
 */
export const PRODUCTION_METER_KEY = 'productionMeter' as const;

export function readProductionMeterFlag(
  body: Record<string, unknown> | null | undefined,
  /** what an ABSENT answer means for this consumer. The SLD has always drawn a
   *  meter unless told otherwise; the BOM has always required the utility datum
   *  to say so. Those defaults are preserved deliberately — connecting the
   *  control must not silently change what an unconverted caller gets. */
  whenAbsent: boolean,
): boolean {
  if (!body) return whenAbsent;
  for (const key of [PRODUCTION_METER_KEY, 'hasProductionMeter', 'requiresProductionMeter']) {
    const v = (body as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true') return true;
      if (s === 'false') return false;
    }
  }
  return whenAbsent;
}
