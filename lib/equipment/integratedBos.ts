// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATED BALANCE-OF-SYSTEM (BOS) DEVICES — "the brains"
//
// Modern solar systems are increasingly built around a single brand-specific
// integrated device that combines several roles the plans used to draw as
// separate boxes: AC branch aggregation (combiner), the PV-system disconnecting
// means, the monitoring/metering gateway, and the rapid-shutdown initiator.
// The Enphase IQ Combiner 6C is the canonical example — one wall box that IS
// the combiner + IQ Gateway + load-break disconnect. Tesla's Backup Switch /
// meter-socket integration is the same idea in a different brand.
//
// Before this module the pipeline had NO first-class concept of these devices:
// they existed only as throwaway BOM strings and anonymous wiring runs, so
// every planset sheet was blind to them. This is the single source of truth for
// the device CLASS. The resolver auto-configures the best / easiest-install
// option (fewest boxes on the wall) and supports an explicit user override.
//
// ⚠ Part numbers / electrical specs below are best-known values — FIELD-VERIFY
// against the manufacturer datasheet before relying on them for procurement.
// ═══════════════════════════════════════════════════════════════════════════

import { nextStandardOcpd } from '@/lib/electrical/stdSizes';
import {
  deviceMetersAnything,
  type DeviceMeteringCapability,
} from '@/lib/equipment/currentTransformers';
// Static declared table, zero imports of its own — this module's "no equipment-db"
// rule is about the CATALOGUE, and reconciling the two catalogues' spellings for
// one product is exactly the thing that may not be re-implemented per caller.
import { canonicalCombinerId } from '@/lib/equipment/combinerIdentity';

export type BosKind =
  | 'integrated_combiner'   // combiner + gateway (+/- disconnect) in one enclosure
  | 'gateway'               // standalone monitoring/metering gateway (Envoy)
  /** A SELECTABLE TOPOLOGY, not a box: a standalone gateway plus the panel the
   *  branches land in. It never appears in a plan's `devices` itself — the
   *  resolver expands it into the two physical devices (see `standalone`). */
  | 'gateway_system'
  | 'ac_combiner'           // discrete AC combiner (no gateway)
  | 'meter_socket'          // integrated meter-socket device (Tesla) — future
  | 'backup_switch';        // integrated backup/microgrid interconnect — future

/**
 * How a `gateway_system` row is built on the wall. Every number here is the
 * manufacturer's installation rule, not a sizing preference — see the row.
 */
export interface StandaloneGatewaySystem {
  /** The catalogue id of the gateway itself (the metering brains). */
  gatewayDeviceId: string;
  /** Each AC branch circuit lands on a 2-pole breaker of this rating. */
  branchBreakerA: number;
  /** The gateway's own 2-pole supply breaker in the landing panel. */
  gatewaySupplyBreakerA: number;
  /** The gateway supply conductors — it needs L1, L2 AND N. */
  gatewaySupplyConductor: string;
}

/** The roles a single device performs — what lets us collapse boxes on the wall. */
export interface IntegratedFunctions {
  aggregation?: boolean;     // combines the AC branch circuits (busbar + breakers)
  disconnect?: boolean;      // serves as the PV-system AC disconnecting means (load-break)
  monitoring?: boolean;      // production/consumption monitoring + comms (the gateway)
  /**
   * 🚨 DERIVED — DO NOT DECLARE THIS ON A ROW THAT CARRIES `metering`.
   *
   * "Does this device meter anything at all", generated from
   * `BosDevice.metering` (the structured DeviceMeteringCapability) so the two
   * can never disagree. It was previously DECLARED, and as a lone boolean it
   * could not distinguish production from consumption metering — the exact axis
   * Enphase's documentation is built around. The 6C, the 5C and a bare IQ
   * Gateway all read `metering: true` here and differ materially: the 6C ships
   * NO consumption CTs, the 5C ships two, the Gateway ships a production CT that
   * is field-installed. An IQ Combiner 6C permit therefore asserted consumption
   * metering the design had never bought.
   *
   * Rows with no structured capability yet (IQ Meter Collar, Tesla Backup
   * Switch, the generic AC combiner panels) keep their declared value — see
   * `withDerivedMeteringFlag`.
   *
   * Consumers that need to know WHAT is measured must read `BosDevice.metering`
   * and `lib/equipment/currentTransformers`, never this flag.
   */
  metering?: boolean;
  rapidShutdown?: boolean;   // hosts/initiates the PV rapid-shutdown function
  backup?: boolean;          // microgrid interconnect / backup control
}

export interface BosDevice {
  id: string;
  brand: string;             // 'Enphase' | 'Tesla' | 'SolarEdge' | ...
  model: string;
  partNumber?: string;       // real ordering SKU (sourced)
  kind: BosKind;
  generation?: 'gen1' | 'gen2' | 'gen3' | 'gen4';  // Enphase ecosystem generation (6C=gen4, 5C=gen3, 4C=gen2, 3C=gen1)
  /** The roles this one device performs. */
  integrated: IntegratedFunctions;
  /**
   * 🚨 WHAT THIS DEVICE ACTUALLY MEASURES, per channel — the authority that
   * replaces `integrated.metering`. Production and consumption are separate
   * channels with separate realisations, and "integrates production metering"
   * does not imply "can measure consumption": the IQ Combiner 6C integrates the
   * first and ships nothing for the second.
   *
   * Absent ⇒ this device's metering has not been modelled yet and
   * `integrated.metering` keeps its declared value. Absent is NOT "no metering".
   */
  metering?: DeviceMeteringCapability;
  /** True when this device is the system controller / "brains". */
  isBrains?: boolean;
  /** AC branch (2-pole PV) breaker positions. IQ Combiner 3C/4C/5C/6C all take 4 (6C: 5 with a quadplex). */
  branchSlots?: number;
  maxContinuousA?: number;   // total PV continuous output current
  mainBreakerA?: number;     // aggregate/main breaker (only the 6C has one — it IS the PV disconnect)
  maxDevices?: number;       // microinverters supported
  mounting?: 'wall' | 'indoor' | 'outdoor' | 'meter_socket';
  outputWireGaugeMin?: string;
  necRefs?: string[];
  /** Which inverter ecosystem this belongs to, e.g. 'enphase-iq'. */
  ecosystem?: string;
  /** Lower = easier install / fewer separate boxes on the wall (used to pick the default). */
  installComplexity?: number;
  /** Devices REPLACED by this one when integrated (for topology flags on the SLD). */
  replacesSeparate?: Array<'gateway' | 'ac_disconnect'>;
  /** Present ONLY on a `gateway_system` row: how the standalone topology is built. */
  standalone?: StandaloneGatewaySystem;
  active?: boolean;
}

// ── Catalog (specs SOURCED — lib/data/equipment/bos-devices-research.json) ───
// Correction of earlier assumptions: "6C" is a GENERATION name, not a 6-branch
// cap — every IQ Combiner (3C/4C/5C/6C) takes 4 two-pole PV branches (6C: 5 with
// a quadplex). And ONLY the 6C's aggregate PV breaker (UL 489) legally serves as
// the PV AC disconnecting means (outdoors) — the 4C/5C are main-lug only and need
// a separate external AC disconnect. The 6C is the current, easiest-install pick
// (one box = combiner + IQ Gateway + integral disconnect + RSD initiator).
const BOS_DEVICES_RAW: BosDevice[] = [
  {
    id: 'enphase-iq-combiner-6c',
    brand: 'Enphase',
    model: 'IQ Combiner 6C',
    partNumber: 'X-IQ-AM1-240-6C',
    kind: 'integrated_combiner',
    generation: 'gen4',
    integrated: { aggregation: true, disconnect: true, monitoring: true, rapidShutdown: true },
    // 🚨 THE ROW THIS WHOLE MODULE WAS WRONG ABOUT. The 6C's production metering
    // is factory-integrated and pre-wired ("does not require field wiring"), and
    // it ships NO consumption CTs at all — they are a separate purchase. As a
    // lone `metering: true` that read identically to the 5C, which ships two.
    metering: {
      production: {
        channel: 'production', realisation: 'factory-integrated', boundary: 'pv-output-circuit',
        ctsIncluded: null, requiredCtId: null, accuracyClass: 'ANSI C12.20 class 0.5 (±0.5%)',
        note: 'Factory-installed, pre-wired solid-core production CT. No field CT wiring for PV.',
      },
      consumption: {
        channel: 'consumption', realisation: 'separate-purchase-field-installed', boundary: 'unresolved',
        ctsIncluded: 0, requiredCtId: 'enphase-ct-200-split', accuracyClass: '±2.5% (consumption)',
        note: 'NO consumption CTs ship with the 6C. Where they clamp is a DESIGN fact — the '
            + 'device does not fix it — so the boundary is unresolved until the design records it.',
      },
      storage: {
        channel: 'storage', realisation: 'factory-integrated', boundary: 'storage-circuit',
        ctsIncluded: 2, requiredCtId: null, accuracyClass: '±0.5%',
        note: '2 factory battery CTs (±0.5%), plus 2 backfeed CTs (±2.5%) and 2 load-controller CTs (±0.5%).',
      },
      citation: 'lib/data/equipment/bos-devices-research.json → enphase-iq-combiner-6c'
        + '.integratedMeteringCTNote; primary source Enphase IQ Combiner 6C data sheet DSH-00585-3.0.',
    },
    isBrains: true,
    branchSlots: 4,          // 4 two-pole 20A PV branches (5 with a quadplex breaker); + 200A DER busbar
    maxContinuousA: 80,      // total PV continuous
    mainBreakerA: 100,       // aggregate PV breaker (ships 60A, up to 100A) — the PV disconnect
    mounting: 'outdoor',     // NEMA 3R
    outputWireGaugeMin: '#4 AWG',
    necRefs: ['NEC 690.4', 'NEC 705.10', 'NEC 690.13', 'NEC 690.12'],
    ecosystem: 'enphase-iq',
    installComplexity: 1,    // one box replaces gateway + AC disconnect
    replacesSeparate: ['gateway', 'ac_disconnect'],
    active: true,
  },
  {
    id: 'enphase-iq-combiner-5c',
    brand: 'Enphase',
    model: 'IQ Combiner 5C',
    partNumber: 'X-IQ-AM1-240-5C',
    kind: 'integrated_combiner',
    generation: 'gen3',
    integrated: { aggregation: true, monitoring: true },  // main-lug only → NO integral PV disconnect
    // The 5C ships TWO consumption clamp CTs in the box. That is the material
    // difference from the 6C, and the boolean could not express it.
    metering: {
      production: {
        channel: 'production', realisation: 'factory-integrated', boundary: 'pv-output-circuit',
        ctsIncluded: null, requiredCtId: null, accuracyClass: 'ANSI C12.20 class 0.5 (±0.5%)',
        note: 'Pre-wired solid-core production CT on the combiner output.',
      },
      consumption: {
        channel: 'consumption', realisation: 'ships-with-device', boundary: 'unresolved',
        ctsIncluded: 2, requiredCtId: 'enphase-ct-200-clamp', accuracyClass: '±2.5% (consumption)',
        note: 'Two consumption clamp CTs ship in the box. The installer decides where they '
            + 'clamp, so the boundary — and therefore the mode — is a design fact, not a device fact.',
      },
      storage: {
        channel: 'storage', realisation: 'ships-with-device', boundary: 'storage-circuit',
        ctsIncluded: 1, requiredCtId: null, accuracyClass: '±2.5%',
        note: 'One IQ Battery clamp CT ships in the box.',
      },
      citation: 'lib/data/equipment/bos-devices-research.json → enphase-iq-combiner-5c'
        + '.integratedMeteringCTNote; primary source Enphase IQ Combiner 5/5C data sheet '
        + 'IQC-5-5C-DSH-00007-1.0.',
    },
    isBrains: true,
    branchSlots: 4,
    maxContinuousA: 64,      // 80A PV total on a 125A busbar
    mounting: 'outdoor',
    necRefs: ['NEC 690.4', 'NEC 705.10'],
    ecosystem: 'enphase-iq',
    installComplexity: 2,    // integrates the gateway but still needs an external AC disconnect
    replacesSeparate: ['gateway'],
    active: true,
  },
  {
    id: 'enphase-iq-combiner-4c',
    brand: 'Enphase',
    model: 'IQ Combiner 4C',
    partNumber: 'X-IQ-AM1-240-4C',  // registry's ENV-IQ-C4C-240 was fabricated
    kind: 'integrated_combiner',
    generation: 'gen2',
    integrated: { aggregation: true, monitoring: true },
    metering: {
      production: {
        channel: 'production', realisation: 'factory-integrated', boundary: 'pv-output-circuit',
        ctsIncluded: null, requiredCtId: null, accuracyClass: 'ANSI C12.20 class 0.5 (±0.5%)',
        note: 'Pre-wired 200 A solid-core production CT.',
      },
      // 🚨 THIS ROW SAID "SEPARATE PURCHASE", AND ENPHASE SAYS THE OPPOSITE. The
      // 4/4C data sheet's "What's in the box" lists "Two consumption metering
      // split core or clamp-type CTs, shipped with the box", and the 4/4C quick
      // install guide agrees ("A pair of split-type or clamp-type CTs is
      // provided"). Modelled as a purchase, every 4C job bought a second pair of
      // CTs the crew already had in the box.
      consumption: {
        channel: 'consumption', realisation: 'ships-with-device', boundary: 'unresolved',
        ctsIncluded: 2, requiredCtId: 'enphase-ct-200-split', accuracyClass: '±2.5% (consumption)',
        note: 'Two consumption CTs (split-core or clamp-type) ship in the 4/4C box. The installer '
            + 'decides where they clamp, so the boundary — and therefore the mode — is a design fact.',
      },
      citation: 'lib/data/equipment/bos-devices-research.json → enphase-iq-combiner-4c'
        + '.integratedMeteringCTNote; primary source Enphase IQ Combiner 4/4C data sheet '
        + 'IQC-4-4C-DSH-00217-5.0 ("What\'s in the box") and quick install guide 140-00233-08.',
    },
    isBrains: true,
    branchSlots: 4,
    maxContinuousA: 64,
    mounting: 'outdoor',
    necRefs: ['NEC 690.4', 'NEC 705.10'],
    ecosystem: 'enphase-iq',
    installComplexity: 2,
    replacesSeparate: ['gateway'],
    active: true,
  },
  {
    id: 'enphase-iq-gateway',
    brand: 'Enphase',
    model: 'IQ Gateway',
    // ENV2- is the IEEE 1547:2018 revision; the quick install guide (140-00210-03)
    // says it "is mandatorily required" wherever 1547:2018 is adopted. ENV- is the
    // earlier revision and is not what a new permit should name. Formerly IQ
    // Envoy / Envoy-S Metered.
    partNumber: 'ENV2-IQ-AM1-240',
    kind: 'gateway',
    generation: undefined,
    integrated: { monitoring: true, rapidShutdown: true },
    // A bare IQ Gateway ships ONE production CT that the installer field-installs
    // on the PV output circuit — it is not factory-integrated, and consumption is
    // a separate purchase. Third distinct shape under the same old boolean.
    //
    // A note here used to say distributor "metered" variants bundle the
    // consumption CTs. No Enphase document supports it — the data sheet, the
    // quick install guide and TEB-00021 Table 2 all say the consumption CTs are
    // purchased separately — so it is gone rather than left as a hint that the
    // BOM might not need to buy them.
    metering: {
      production: {
        channel: 'production', realisation: 'ships-with-device', boundary: 'pv-output-circuit',
        ctsIncluded: 1, requiredCtId: 'enphase-ct-200-solid', accuracyClass: 'ANSI C12.20 class 0.5 (±0.5%)',
        note: 'One CT-200-SOLID production CT ships with the gateway and is field-installed. '
            + 'Solid-core: the PV output conductor must be disconnected to pass it through.',
      },
      consumption: {
        channel: 'consumption', realisation: 'separate-purchase-field-installed', boundary: 'unresolved',
        ctsIncluded: 0, requiredCtId: 'enphase-ct-200-split', accuracyClass: '±2.5% (consumption)',
        note: 'Up to two consumption CTs, ordered separately. The gateway metering ports are '
            + 'the hard limit: two consumption CTs, one production CT, one battery CT.',
      },
      citation: 'lib/data/equipment/bos-devices-research.json → enphase-iq-gateway'
        + '.integratedMeteringCTNote; primary source Enphase IQ Gateway data sheet DSH-00111-6.0.',
    },
    isBrains: true,
    mounting: 'indoor',      // DIN-rail, IP30
    necRefs: ['NEC 690.4'],
    ecosystem: 'enphase-iq',
    // Standalone gateway needs a SEPARATE combiner + AC disconnect — most boxes.
    installComplexity: 3,
    active: true,
  },
  // ── "Whatever Envoy I want" — the STANDALONE gateway, as a selectable topology ──
  //
  // Recording the bare gateway above as the project's combiner drew the Envoy AS
  // the combiner with the branch breakers inside it, while the BOM bought a box
  // the drawing did not show. The gateway has no busbar: the branches must land
  // somewhere else, and that somewhere is part of the choice. This row IS that
  // choice — "IQ Gateway on its own, branches in a PV AC combiner panel" — and the
  // resolver expands it into the two real devices. It is never itself in a plan.
  //
  // Every number is Enphase's installation rule, not a preference:
  //   · the branches land on 2-pole 20 A breakers in "the subpanel used for landing
  //     the PV branches onto the PV breakers" (TEB-00021-2.0 p.4) — the IQ Cable
  //     "is usually protected by a 20 A circuit breaker" (EN-IQ8-1PHN note 5);
  //   · the gateway gets ITS OWN breaker: "a two-pole circuit breaker of up to
  //     20 A (maximum)", "12-14 AWG copper rated at 75°C", terminals L1, L2 and N
  //     (IQ Gateway QIG 140-00210-03 step 2A; data sheet DSH-00111-6.0). Enphase
  //     never draws it on a PV branch breaker, and its own boxes use 10 or 15 A
  //     (IQ Combiner 4/4C and 5/5C data sheets) — 15 A here, #14 Cu, with N;
  //   · the production CT that ships with the gateway goes on L1 in that same
  //     panel (TEB-00021-2.0 p.4), on a 5 ft lead that may not be extended.
  // The landing panel is the generic PV AC combiner row sized for the breakers
  // it carries (resolveAcCombinerPanel), and it feeds the AC disconnect exactly
  // as an IQ Combiner does — the electrical engine does not change.
  // Recorded at lib/data/equipment/bos-devices-research.json → enphase-iq-gateway
  // .standaloneTopology / .supplyBreaker / .productionCtPlacement / .ctLeads.
  {
    id: 'enphase-iq-gateway-standalone',
    brand: 'Enphase',
    model: 'IQ Gateway (standalone) + PV AC combiner panel',
    kind: 'gateway_system',
    integrated: { monitoring: true },
    standalone: {
      gatewayDeviceId: 'enphase-iq-gateway',
      branchBreakerA: 20,
      gatewaySupplyBreakerA: 15,
      gatewaySupplyConductor: '#14 AWG CU THWN-2 (L1, L2, N) + #14 EGC',
    },
    ecosystem: 'enphase-iq',
    installComplexity: 3,
    active: true,
  },
  {
    id: 'enphase-iq-meter-collar',
    brand: 'Enphase',
    model: 'IQ Meter Collar',
    partNumber: 'MC-200-011-V01',
    kind: 'meter_socket',
    generation: 'gen4',
    integrated: { metering: true, disconnect: true },  // meter-socket adapter with integrated MID (grid isolation)
    branchSlots: 0,
    maxContinuousA: 200,
    mounting: 'meter_socket',
    necRefs: ['NEC 705.20'],
    ecosystem: 'enphase-iq',
    installComplexity: 1,
    active: true,
  },
  {
    id: 'tesla-backup-switch',
    brand: 'Tesla',
    model: 'Backup Switch',
    partNumber: '1624171',
    kind: 'meter_socket',
    integrated: { metering: true, disconnect: true, backup: true },  // ANSI Type 2S meter socket + grid-isolation contactor + ±0.5% metering
    branchSlots: 0,
    maxContinuousA: 200,
    mounting: 'meter_socket',
    necRefs: ['NEC 705.20', 'NEC 710'],
    ecosystem: 'tesla',
    installComplexity: 1,
    active: true,
  },
  // ── Shared AC COMBINER PANELS (PV subpanels) ───────────────────────────────
  // Where multiple inverter / brand-combiner AC outputs land on a common busbar,
  // each on its own backfed OCPD, feeding ONE system AC disconnect (a multi-brand
  // hybrid collects here instead of running a separate disconnect per source).
  // Sized to the aggregate PV backfeed per NEC 705.12(B) / 408. ⚠ FIELD-VERIFY SKU.
  {
    id: 'pv-ac-combiner-125', brand: 'Generic', model: '125A PV AC Combiner Panel',
    kind: 'ac_combiner', integrated: { aggregation: true },
    branchSlots: 6, maxContinuousA: 125, mainBreakerA: 125,
    mounting: 'outdoor', outputWireGaugeMin: '#2 AWG',
    necRefs: ['NEC 705.12(B)', 'NEC 408.36', 'NEC 690.4'],
    installComplexity: 2, active: true,
  },
  {
    id: 'pv-ac-combiner-200', brand: 'Generic', model: '200A PV AC Combiner Panel',
    kind: 'ac_combiner', integrated: { aggregation: true },
    branchSlots: 8, maxContinuousA: 200, mainBreakerA: 200,
    mounting: 'outdoor', outputWireGaugeMin: '#2/0 AWG',
    necRefs: ['NEC 705.12(B)', 'NEC 408.36', 'NEC 690.4'],
    installComplexity: 2, active: true,
  },
  {
    id: 'pv-ac-combiner-225', brand: 'Generic', model: '225A PV AC Combiner Panel',
    kind: 'ac_combiner', integrated: { aggregation: true },
    branchSlots: 12, maxContinuousA: 225, mainBreakerA: 225,
    mounting: 'outdoor', outputWireGaugeMin: '#4/0 AWG',
    necRefs: ['NEC 705.12(B)', 'NEC 408.36', 'NEC 690.4'],
    installComplexity: 2, active: true,
  },
];

/**
 * 🚨 ONE AUTHORITY FOR "DOES IT METER", NOT TWO.
 *
 * A row that declares a structured `metering` capability does NOT also declare
 * `integrated.metering` — the boolean is generated from the capability here, so
 * a future edit to one cannot leave the other stale. Rows that have not been
 * converted (IQ Meter Collar, Tesla Backup Switch, the generic AC combiner
 * panels) keep whatever they declared: their metering is real but is not yet
 * modelled per channel, and silently flipping them to false would strip
 * "Metering" from their role summaries on live sheets.
 */
function withDerivedMeteringFlag(d: BosDevice): BosDevice {
  if (!d.metering) return d;
  return { ...d, integrated: { ...d.integrated, metering: deviceMetersAnything(d.metering) } };
}

export const BOS_DEVICES: BosDevice[] = BOS_DEVICES_RAW.map(withDerivedMeteringFlag);

export function getBosDevice(id: string | undefined): BosDevice | undefined {
  if (!id) return undefined;
  return BOS_DEVICES.find(d => d.id === id && d.active !== false);
}

/** Every selectable integrated combiner, optionally narrowed to one brand.
 *  Backs the UI picker so the operator can override the auto-resolved device —
 *  the drawing must be able to say what is ACTUALLY going on the wall, not only
 *  what the compatibility table infers.
 *
 *  🚨 A BARE IQ GATEWAY (ENVOY) IS DELIBERATELY NOT HERE, though `getBosDevice`
 *  knows it. Traced 2026-09-25: recorded as the project's combiner it resolves
 *  to a plan with no combiner in it, and every consumer treats the brains AS the
 *  combiner — the SLD route and `sldCombinerFields` hand "Enphase IQ Gateway" to
 *  the renderer, which draws it as the AC COMBINER with the branch breakers
 *  landing inside it, while the BOM buys the gateway AND falls back to the
 *  inverter's legacy combiner accessory (an IQ Combiner 4C under a fabricated SKU
 *  on the IQ8+/IQ8M rows, nothing at all on IQ8H/IQ8A). A drawing of a box the
 *  BOM did not buy. Each IQ Combiner has the IQ Gateway built in, so "whatever
 *  Envoy I want" (Ray, 2026-09-25) is a choice among THESE.
 *
 *  …and, since 2026-09-26, the STANDALONE gateway as a whole topology
 *  (`kind: 'gateway_system'`, 'enphase-iq-gateway-standalone'): the gateway PLUS
 *  the panel the branches land in, which the resolver expands into both devices
 *  so the drawing, the BOM and the metering all name the same two boxes. What
 *  stays out is still the bare gateway on its own — a pick with nowhere for the
 *  branches to land. */
export function listCombiners(brand?: string): BosDevice[] {
  const want = brand?.trim().toLowerCase();
  return BOS_DEVICES.filter(d =>
    d.active !== false
    && (d.kind === 'integrated_combiner' || d.kind === 'gateway_system')
    && (!want || d.brand.toLowerCase() === want));
}

/** Can this id be recorded as the project's combiner? — exactly the set
 *  `listCombiners()` offers, so the picker, the combiner-selection route and the
 *  ecosystem picker's Envoy row cannot disagree about what is storable. A device
 *  the catalogue knows but that is not one of these (a bare IQ Gateway, a meter
 *  collar, a generic PV AC combiner panel) answers false; the standalone
 *  gateway TOPOLOGY answers true. */
export function isSelectableCombiner(id: string | null | undefined): boolean {
  const want = id?.trim();
  return !!want && listCombiners().some(d => d.id === want);
}

/** Resolve an equipment-db combiner id against THIS catalogue.
 *
 *  The two catalogues drifted apart: equipment-db calls the device
 *  `enphase-iq-combiner-5`, this module calls it `enphase-iq-combiner-5c`. That
 *  one-character difference meant a compatibility list from equipment-db could
 *  never resolve here, so the auto-config silently fell through to a hardcoded
 *  device and the SLD contradicted the equipment picker on every Enphase job.
 *
 *  🚨 THE BRIDGE USED TO BE STRING SURGERY, AND IT IS NOW A DECLARED TABLE.
 *  This tried the id, then `${id}c`, then the id with a trailing 'c' stripped —
 *  which answers "probably the same product" by looking at characters. That is
 *  the substring/suffix equipment matching this codebase has repeatedly been
 *  bitten by, and it is only half a bridge: `judgeCombinerCompatibility` had no
 *  equivalent, compared the raw strings, and refused every combiner selection on
 *  every Enphase project. One reconciliation now serves both
 *  (lib/equipment/combinerIdentity.ts), each spelling written out against the
 *  catalogue it comes from, and an id the table does not know resolves to
 *  NOTHING — the caller's `combinerBasis: 'unresolved-default'` then says so on
 *  the sheet, instead of a character rule inventing a match. */
export function resolveCompatibleCombiner(ids: string[] | undefined): BosDevice | undefined {
  for (const raw of ids ?? []) {
    const canonical = canonicalCombinerId(raw);
    if (!canonical) continue;   // not a combiner, or a spelling nobody declared
    const hit = getBosDevice(canonical);
    if (hit && hit.kind === 'integrated_combiner') return hit;
  }
  return undefined;
}

// ── Resolver ────────────────────────────────────────────────────────────────

export interface SystemBosContext {
  inverterManufacturer: string;
  inverterModel: string;
  isMicro: boolean;
  /** Microinverter count (device count). */
  totalDevices: number;
  /** Planned AC branch circuits. */
  branchCount: number;
  hasBattery: boolean;
  /** Explicit user selection (overrides auto-config) — future design-studio hook. */
  overrideDeviceIds?: string[];
  /** The combiner ids the SELECTED INVERTER declares in equipment-db
   *  (`compatibleWith`). This module deliberately does not import equipment-db —
   *  the caller, which already has it, passes the list in, so the BOS catalogue
   *  stays dependency-free and cycle-free.
   *
   *  These are equipment-db ids and may not match this module's ids verbatim
   *  (e.g. `enphase-iq-combiner-5` there vs `enphase-iq-combiner-5c` here);
   *  see resolveCompatibleCombiner for the bridge.
   *
   *  🚨 THIS IS A RECOMMENDATION, NOT A DECISION. It answers "what CAN be used",
   *  and the catalogue's pairings are known to be incomplete — Enphase documents
   *  identical IQ6/IQ7/IQ8 support on both the 5/5C and the 6C. It must never
   *  outrank `selectedCombinerId`. */
  compatibleCombinerIds?: string[];
  /**
   * 🚨 WHAT THE INSTALLER IS ACTUALLY INSTALLING — the project's recorded
   * selection (`projects.selected_equipment.combinerSelection`), and the highest
   * authority this function knows.
   *
   * "The SLD is currently showing an IQ Combiner 6C. I am still installing IQ
   * Combiner 5C." Nobody had chosen the 6C; a lookup missed and a last-resort
   * literal named a product. Once this is set, nothing below may substitute
   * anything else: compatibility validates a selection, it does not make one.
   */
  selectedCombinerId?: string | null;
}

export interface ResolvedBosDevice extends BosDevice {
  /** Human role summary for the directory / schedule, e.g. "Combiner · Gateway · Disconnect". */
  roleSummary: string;
  quantity: number;
}

export interface IntegratedEquipmentPlan {
  brand: string | null;
  /** All BOS devices this system uses, in reading order. */
  devices: ResolvedBosDevice[];
  /** The primary integrated device / brains, if any. On a standalone-gateway plan
   *  this is the GATEWAY (it carries the metering), which is NOT the box the
   *  branches land in — ask `planLandingDevice` for that. */
  brains?: ResolvedBosDevice;
  /** True when a single device provides the monitoring gateway (no separate Envoy
   *  on the wall). FALSE on a standalone-gateway plan — the Envoy is a separate
   *  box there, and `gatewayPlacement: 'standalone'` says so. */
  hasIntegratedGateway: boolean;
  // ── Present ONLY on a standalone-gateway plan ('gateway_system' selection) ──
  // Every one of these is ABSENT (not undefined-valued) on every other plan: the
  // permit snapshot hashes what the plan feeds it, and a key that appears on an
  // existing design — even as null — moves its digest and retires a live PE
  // approval.
  /** The gateway is its own enclosure, beside the panel the branches land in. */
  gatewayPlacement?: 'standalone';
  /** The box the AC branch circuits land in (the PV AC combiner panel). */
  aggregation?: ResolvedBosDevice;
  /** The standalone gateway itself (same object as `brains`). */
  gateway?: ResolvedBosDevice;
  /** The gateway's own 2-pole supply breaker in the landing panel, and its conductors. */
  gatewaySupply?: { breakerA: number; conductor: string };
  /** The 2-pole breaker each AC branch lands on in the landing panel. */
  branchBreakerA?: number;
  /** True when the combiner IS the PV-system AC disconnecting means (no separate AC disconnect). */
  providesAcDisconnect: boolean;
  branchSlots?: number;
  /** Set when the branch count exceeds the device's slot capacity. */
  branchSlotWarning?: string;
  source: 'override' | 'auto' | 'none';
  /**
   * 🚨 HOW THIS COMBINER CAME TO BE NAMED — and the reason this field exists at
   * all is `unresolved-default`.
   *
   * `source` above says which BRANCH of this function answered; it cannot say
   * whether a human decided. A plan built from a last-resort literal and a plan
   * built from the installer's recorded selection both used to read `'auto'`,
   * so every downstream artefact asserted a product with equal confidence in
   * both cases — which is how a 6C reached a drawing for a 5C job.
   *
   * Consumers that PRINT the device must check
   * `combinerBasisIsDecided(combinerBasis)` and qualify the output when it is
   * false. Unknown stays unknown: it does not become the newest product, and it
   * does not become the 5C either.
   */
  combinerBasis?: import('@/lib/combinerSelection/types').CombinerBasis;
}

const GEN4_MICRO = /iq8/i;
const GEN3_MICRO = /iq[67]/i;

/** Detect the Enphase generation from the microinverter model string. */
export function enphaseGeneration(model: string): 'gen3' | 'gen4' | null {
  if (GEN4_MICRO.test(model)) return 'gen4';
  if (GEN3_MICRO.test(model)) return 'gen3';
  return null;
}

function roleSummary(d: BosDevice): string {
  const parts: string[] = [];
  if (d.integrated.aggregation) parts.push('Combiner');
  if (d.integrated.monitoring) parts.push('Gateway');
  if (d.integrated.metering) parts.push('Metering');
  if (d.integrated.disconnect) parts.push('Disconnect');
  if (d.integrated.rapidShutdown) parts.push('Rapid Shutdown');
  if (d.integrated.backup) parts.push('Backup');
  return parts.join(' · ') || d.kind;
}

const resolved = (d: BosDevice, quantity = 1): ResolvedBosDevice => ({ ...d, roleSummary: roleSummary(d), quantity });

const emptyPlan = (brand: string | null): IntegratedEquipmentPlan => ({
  brand, devices: [], hasIntegratedGateway: false, providesAcDisconnect: false, source: 'none',
});

/**
 * 🚨 THE ONE RULE FOR "THE BOX THE BRANCHES LAND IN" — the device a drawing
 * prints as the combiner.
 *
 * Every consumer used to write `plan.brains ?? plan.devices[0]`, which was the
 * same thing only while the brains WAS the combiner. On a standalone-gateway
 * plan the brains is the IQ Gateway — a DIN-rail box with no busbar — and that
 * expression drew the branch breakers inside the Envoy. `aggregation` names the
 * landing panel there, and is absent on every other plan, so for every plan that
 * existed before it this returns exactly what those consumers used before.
 *
 * Metering still reads `plan.brains`: the CTs belong to the gateway, not to the
 * panel they clamp in.
 */
export function planLandingDevice(
  plan: Pick<IntegratedEquipmentPlan, 'aggregation' | 'brains' | 'devices'> | null | undefined,
): ResolvedBosDevice | undefined {
  if (!plan) return undefined;
  return plan.aggregation ?? plan.brains ?? plan.devices[0];
}

/**
 * Expand a `gateway_system` selection into the two boxes that go on the wall.
 *
 * The landing panel is sized for what its busbar actually carries — one
 * `branchBreakerA` breaker per branch plus the gateway's own supply breaker — and
 * for enough positions to hold them all (NEC 705.12(B), the same rule the hybrid
 * shared panel uses). One of its positions feeds the gateway, so the branch
 * capacity is one less than the panel's positions.
 */
function resolveStandaloneGatewayPlan(system: BosDevice, ctx: SystemBosContext): IntegratedEquipmentPlan {
  const spec = system.standalone;
  const gwRow = spec ? getBosDevice(spec.gatewayDeviceId) : undefined;
  const branches = Math.max(0, Math.floor(ctx.branchCount || 0));
  const aggregateA = spec ? spec.branchBreakerA * branches + spec.gatewaySupplyBreakerA : 0;
  const panel = spec ? resolveAcCombinerPanel(aggregateA, branches + 1) : null;
  const panelRow = panel ? getBosDevice(panel.id) : undefined;
  if (!spec || !gwRow || !panel || !panelRow) {
    // A catalogue that cannot build the topology it offers asserts nothing —
    // no devices, no brains, no disconnect claim. The selection's basis is
    // stamped by the caller, so the sheet can still say a choice was made.
    return { ...emptyPlan(system.brand), source: 'override', combinerBasis: 'session-override' };
  }
  // The panel as a plain device, not the AcCombinerPanelPlan: that plan's
  // `mainOcpdA` is sized from the breaker SUM, which is not this panel's output
  // current, and no sheet may print a feeder OCPD the electrical engine did not
  // size.
  const landing = resolved(panelRow);
  const positions = panel.positions;
  const gateway = resolved(gwRow);
  const branchSlots = Math.max(0, positions - 1);
  const busbarA = landing.maxContinuousA ?? 0;
  const problems: string[] = [];
  if (branches > branchSlots) {
    problems.push(`${branches} AC branches exceed the ${landing.model}'s ${branchSlots} branch positions `
      + `(${positions} positions, one feeds the ${gateway.model})`);
  }
  if (busbarA > 0 && aggregateA > busbarA) {
    problems.push(`${branches} × ${spec.branchBreakerA} A branch breakers plus the ${spec.gatewaySupplyBreakerA} A `
      + `${gateway.model} breaker (${aggregateA} A) exceed its ${busbarA} A busbar`);
  }
  return {
    brand: system.brand,
    devices: [landing, gateway],
    brains: gateway,
    hasIntegratedGateway: false,
    providesAcDisconnect: false,
    branchSlots,
    branchSlotWarning: problems.length
      ? `${problems.join('; ')} — a larger PV panel or a second landing panel is required.`
      : undefined,
    source: 'override',
    // The override path's basis; a recorded selection overwrites it with
    // 'project-selected' exactly as it does for any other device.
    combinerBasis: 'session-override',
    gatewayPlacement: 'standalone',
    aggregation: landing,
    gateway,
    gatewaySupply: { breakerA: spec.gatewaySupplyBreakerA, conductor: spec.gatewaySupplyConductor },
    branchBreakerA: spec.branchBreakerA,
  };
}

/**
 * Auto-configure (or honor an override for) the integrated BOS devices for a
 * system. Default policy: pick the best/easiest-install option — the integrated
 * Gen-4 combiner that collapses gateway + AC disconnect into one wall box —
 * sized to the branch count. Currently models the Enphase ecosystem; other
 * brands fall through to an empty plan until their devices are added.
 */
export function resolveIntegratedEquipment(ctx: SystemBosContext): IntegratedEquipmentPlan {
  // 🚨 THE PROJECT'S RECORDED SELECTION OUTRANKS EVERYTHING BELOW.
  //
  // This is what the installer told us they are installing. It is not a hint, a
  // preference or a default — it is the answer, and every branch below this one
  // exists only for a project that has not answered yet. Routed through the same
  // override machinery so the resolved device carries the same role summary,
  // gateway and disconnect facts as any other; only the BASIS differs, and the
  // basis is what lets a drawing say "selected" rather than merely name a box.
  const selectedId = ctx.selectedCombinerId?.trim();
  if (selectedId) {
    // 🚨 RESOLVE THE DEVICE BEFORE DELEGATING, NOT AFTER.
    //
    // A first version recursed with `overrideDeviceIds: [selectedId]` and then
    // checked whether the result had devices. For an id the catalogue does not
    // know, the override branch's `.filter(Boolean)` emptied the list, the
    // recursion fell THROUGH to the auto path, and a recommendation came back —
    // which the outer call then stamped `project-selected`. That is worse than
    // the bug this whole module replaces: it would assert a product nobody chose
    // AND claim the installer chose it.
    const device = getBosDevice(selectedId);
    if (!device) {
      // A selection we cannot honour stays visible as one. No devices, no
      // brains, no disconnect claim — and the basis still says a human decided,
      // so a consumer can report "selected device unavailable" rather than
      // quietly printing something else.
      return { ...emptyPlan(/enphase/i.test(ctx.inverterManufacturer) ? 'Enphase' : null), combinerBasis: 'project-selected' };
    }
    const plan = resolveIntegratedEquipment({
      ...ctx,
      selectedCombinerId: null,
      overrideDeviceIds: [selectedId],
    });
    return { ...plan, combinerBasis: 'project-selected' };
  }

  // Explicit user override wins.
  if (ctx.overrideDeviceIds?.length) {
    const devices = ctx.overrideDeviceIds.map(getBosDevice).filter(Boolean) as BosDevice[];
    // A standalone-gateway TOPOLOGY is not a box: it expands into the landing
    // panel + the gateway. Only as the single choice — a recorded selection
    // arrives here as exactly one id, and a hand-built multi-device list keeps
    // meaning exactly what it listed.
    if (devices.length === 1 && devices[0].kind === 'gateway_system') {
      return resolveStandaloneGatewayPlan(devices[0], ctx);
    }
    if (devices.length) {
      const combiner = devices.find(d => d.kind === 'integrated_combiner' || d.kind === 'ac_combiner');
      const gw = devices.find(d => d.integrated.monitoring);
      const brainsDev = devices.find(d => d.isBrains);
      return {
        brand: devices[0].brand,
        devices: devices.map(d => resolved(d)),
        brains: brainsDev ? resolved(brainsDev) : undefined,
        hasIntegratedGateway: !!(combiner?.integrated.monitoring) || !!gw,
        providesAcDisconnect: !!combiner?.integrated.disconnect,
        branchSlots: combiner?.branchSlots,
        branchSlotWarning: combiner?.branchSlots && ctx.branchCount > combiner.branchSlots
          ? `${ctx.branchCount} AC branches exceed the ${combiner.model} ${combiner.branchSlots}-position limit — a second combiner or subpanel is required.`
          : undefined,
        source: 'override',
        combinerBasis: 'session-override',
      };
    }
  }

  const isEnphase = /enphase/i.test(ctx.inverterManufacturer);
  if (!isEnphase || !ctx.isMicro) return emptyPlan(isEnphase ? 'Enphase' : null);

  // Auto-config. THE EQUIPMENT DATABASE DECIDES, not a literal.
  //
  // This used to be `getBosDevice('enphase-iq-combiner-6c')!` unconditionally, so
  // every Enphase micro job drew a 6C no matter what the design said. equipment-db
  // declares the pairing on the microinverter itself — `enphase-iq8plus` lists
  // `compatibleWith: ['enphase-iq-combiner-5', ...]` and the combiner lists the
  // IQ8 micros back — and the picker honoured it while the SLD did not. That is
  // one fact with two contradicting answers on the same project.
  //
  // This is NOT cosmetic: the 5C is main-lug only with NO integral PV disconnect,
  // while the 6C has one. Drawing the wrong device changes whether the sheet
  // claims an integral AC disconnecting means, which is a code-compliance
  // statement, not a label.
  //
  // Order: the inverter's declared compatibility, then the current-gen 6C as the
  // last resort for an inverter that declares nothing.
  //
  // 🚨 AND THE LAST RESORT MUST SAY THAT IT IS ONE. `resolveCompatibleCombiner`
  // returning undefined means the inverter declared nothing this catalogue
  // recognises — nobody has chosen. The device below keeps the plan buildable,
  // but `combinerBasis: 'unresolved-default'` is what stops a drawing asserting
  // it as though someone had. That is the whole difference between "the 6C" and
  // "a 6C, because nothing said otherwise".
  const declared = resolveCompatibleCombiner(ctx.compatibleCombinerIds);
  const combiner = declared ?? getBosDevice('enphase-iq-combiner-6c')!;
  // Branch capacity comes from the RESOLVED device, not from the 6C. The 6C PV
  // busbar takes 4 two-pole branches (5 with a quadplex); the 5C/4C take 4 with
  // no quadplex position. Leaving this pinned at 5 would under-report an overflow
  // on a 4-slot device.
  const pvBranchMax = combiner.id === 'enphase-iq-combiner-6c'
    ? 5
    : (combiner.branchSlots ?? 4);
  return {
    brand: 'Enphase',
    devices: [resolved(combiner)],
    brains: resolved(combiner),
    // Both derived from the RESOLVED device. `hasIntegratedGateway: true` was
    // hardcoded and happened to be right only because the device was.
    hasIntegratedGateway: !!combiner.integrated.monitoring,
    providesAcDisconnect: !!combiner.integrated.disconnect,
    branchSlots: combiner.branchSlots,
    branchSlotWarning: ctx.branchCount > pvBranchMax
      ? `${ctx.branchCount} AC branches exceed the ${combiner.model} PV busbar (${combiner.branchSlots ?? 4} breakers${pvBranchMax > (combiner.branchSlots ?? 4) ? ', 5 with a quadplex' : ''}) — route the balance onto the DER busbar or a subpanel.`
      : undefined,
    source: 'auto',
    combinerBasis: declared ? 'declared-compatibility' : 'unresolved-default',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HYBRID AC COLLECTION — multi-brand / multi-source combining architecture.
// Each source combines with its BRAND-APPROPRIATE device (Enphase micros → an
// IQ Combiner; string/hybrid inverters → a backfed OCPD), then ALL sources land
// on a shared AC combiner panel (busbar), which feeds ONE system AC disconnect
// → point of interconnection. Replaces "one AC disconnect per lane".
// ═══════════════════════════════════════════════════════════════════════════

// Standard OCPD / busbar ratings (A), NEC 240.6(A) — single-sourced from
// lib/electrical/stdSizes.ts (P0-5c; the old local table stopped at 400 with a
// non-standard next-50A fallback above it).
// Exported: conductorAuthority's POI block sizes the supply-side tap OCPD with
// THIS function so E-1's system disconnect and the authority can never diverge.
export const nextStdRating = (a: number): number => nextStandardOcpd(a);

export interface AcCombinerPanelPlan extends ResolvedBosDevice {
  /** Busbar continuous rating (A). */
  busbarA: number;
  /** Main / feeder OCPD ahead of the shared disconnect (A). */
  mainOcpdA: number;
  /** Backfed-breaker positions the sources land on. */
  positions: number;
}

/** Pick the smallest AC combiner panel whose busbar covers the aggregate PV
 *  backfeed (NEC 705.12(B) — a dedicated PV panel's busbar ≥ Σ source OCPD). */
export function resolveAcCombinerPanel(aggregateBackfeedA: number, sourceCount = 0): AcCombinerPanelPlan | null {
  if (aggregateBackfeedA <= 0) return null;
  const panels = BOS_DEVICES
    .filter(d => d.id.startsWith('pv-ac-combiner-') && d.active !== false)
    .sort((a, b) => (a.maxContinuousA ?? 0) - (b.maxContinuousA ?? 0));
  const pick = panels.find(p => (p.maxContinuousA ?? 0) >= aggregateBackfeedA
    && (p.branchSlots ?? 0) >= sourceCount) ?? panels[panels.length - 1];
  if (!pick) return null;
  return {
    ...resolved(pick),
    busbarA: pick.maxContinuousA ?? aggregateBackfeedA,
    mainOcpdA: nextStdRating(aggregateBackfeedA),
    positions: pick.branchSlots ?? sourceCount,
  };
}

export interface HybridSourceInput {
  key: string;                      // 'roof' | 'ground' | 'fence'
  inverterManufacturer: string;
  inverterModel: string;
  isMicro: boolean;
  branchCount: number;              // AC branches (micro) or string count
  deviceCount: number;              // micro device count
  backfeedA: number;                // this source's OCPD / backfeed amps
  /** The combiner ids this source's inverter declares in equipment-db. The
   *  CALLER supplies it, because this module deliberately does not import
   *  equipment-db (see SystemBosContext.compatibleCombinerIds). Omitting it
   *  silently selected the current-generation default instead of the paired
   *  device, so a hybrid lane could name a different combiner from the sheets. */
  compatibleCombinerIds?: string[];
  /**
   * 🚨 THE PROJECT'S RECORDED SELECTION, FOR THIS LANE. Same authority and same
   * ordering as `SystemBosContext.selectedCombinerId`, which is what this ends
   * up being — it outranks `compatibleCombinerIds` above.
   *
   * Without it a hybrid job had a hole exactly where the single-system path had
   * been repaired: E-1's multi-lane drawing and the permit BOM's shared-panel
   * block both read this resolver, and it had no way of being told what the
   * installer selected, so every micro lane named a RECOMMENDATION however
   * explicit the project's answer was.
   */
  selectedCombinerId?: string | null;
}
export interface HybridSourceCombining {
  key: string;
  isMicro: boolean;
  /** Micro subs: the brand combiner (IQ Combiner). String/hybrid: null → the
   *  source's OCPD is a backfed breaker in the shared panel. */
  combiner: ResolvedBosDevice | null;
  /** True when the combiner already IS a disconnecting means (6C) for that lane. */
  combinerHasDisconnect: boolean;
  ocpdA: number;
  branchSlotWarning?: string;
  /**
   * 🚨 HOW THIS LANE'S COMBINER CAME TO BE NAMED — per lane, because on a hybrid
   * the answer differs BETWEEN lanes and the single project-level basis cannot
   * express that. A roof lane may carry the installer's recorded Enphase
   * selection while a fence lane on another brand has no answer at all, and the
   * sheet has to be able to say which is which: `combinerBasisIsDecided(basis)`
   * false ⇒ the drawing must qualify the device it prints for THAT lane.
   *
   * Undefined on a string/hybrid lane, which takes no combiner.
   */
  combinerBasis?: import('@/lib/combinerSelection/types').CombinerBasis;
}
export interface HybridAcCollectionPlan {
  perSource: HybridSourceCombining[];
  /** Shared AC combiner panel every source lands on (null when only one source). */
  sharedPanel: AcCombinerPanelPlan | null;
  /** The single system AC disconnect after the shared panel (A). */
  disconnectA: number;
  /** Σ of all source backfeeds (A). */
  aggregateBackfeedA: number;
}

/** Resolve the full multi-source AC collection: per-source brand combiner/OCPD →
 *  shared AC combiner panel → one disconnect. */
export function resolveHybridAcCollection(sources: HybridSourceInput[]): HybridAcCollectionPlan {
  const perSource: HybridSourceCombining[] = sources.map(s => {
    if (s.isMicro) {
      const plan = resolveIntegratedEquipment({
        inverterManufacturer: s.inverterManufacturer, inverterModel: s.inverterModel,
        isMicro: true, totalDevices: s.deviceCount, branchCount: s.branchCount, hasBattery: false,
        compatibleCombinerIds: s.compatibleCombinerIds,
        // The selection outranks the pairing — the ordering is resolved inside
        // resolveIntegratedEquipment, so a hybrid lane and a single-system job
        // answer "which combiner" through the same rule rather than two.
        selectedCombinerId: s.selectedCombinerId ?? null,
      });
      // The lane's combiner is the box its branches land in — the landing panel
      // on a standalone-gateway lane, the brains on every other.
      const combiner = planLandingDevice(plan) ?? null;
      return {
        key: s.key, isMicro: true, combiner,
        combinerHasDisconnect: !!combiner?.integrated.disconnect,
        ocpdA: s.backfeedA, branchSlotWarning: plan.branchSlotWarning,
        // Carried out per lane so a hybrid sheet can qualify the lane it could
        // not answer for. It was computed here and thrown away, and the drawing
        // then printed a derived device with the same confidence as a chosen one.
        combinerBasis: plan.combinerBasis ?? 'unresolved-default',
      };
    }
    // String / hybrid inverter: no dedicated combiner — its OCPD is a backfed
    // breaker landing directly on the shared AC combiner panel.
    return { key: s.key, isMicro: false, combiner: null, combinerHasDisconnect: false, ocpdA: s.backfeedA };
  });
  const aggregateBackfeedA = sources.reduce((a, s) => a + (s.backfeedA || 0), 0);
  const sharedPanel = sources.length > 1
    ? resolveAcCombinerPanel(aggregateBackfeedA, sources.length)
    : null;
  const disconnectA = nextStdRating(aggregateBackfeedA);
  return { perSource, sharedPanel, disconnectA, aggregateBackfeedA };
}
