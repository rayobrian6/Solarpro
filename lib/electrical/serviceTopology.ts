// ═══════════════════════════════════════════════════════════════════════════
// THE SERVICE IS A GRAPH, NOT A SCALAR.
//
// 🚨 THE REAL JOB THIS EXISTS FOR. Ray has an upcoming Tesla installation SolarPro cannot
// engineer today: 120/240 V split phase, **400 A aggregate service, two 200 A MSPs, two Gateway 3,
// two Powerwall 3, two Powerwall 3 Expansion**, no meter-collar interconnection permitted,
// Chicago / ComEd.
//
// "A Gateway 3 is a 200 A continuous device. A 400 A service cannot be represented as
//  `400 A service → one Gateway → everything`."
//
// ═══ WHAT THE MODEL ASSUMED, MEASURED BEFORE WRITING A LINE ═══
//
// The product had ONE of everything, in four separate places:
//
//   · `lib/engineering/types.ts` — `mainPanelAmps`, `mainPanelBusAmps`, `mainBreakerAmps`. Three
//     scalars. There is no service object at all: the service IS the main panel.
//   · `lib/sld-types.ts` — `SLDNodeType` has MAIN_SERVICE_PANEL and UTILITY_METER and **no**
//     SERVICE_DISCONNECT, no BACKUP_GATEWAY, no DER isolation device, no subpanel, no backup-domain
//     boundary. `MSPNode` carries one `ampRating` and one `backfeedBreakerAmps`.
//   · `lib/equipment-db.ts` — `resolveBatteryBranch` states the assumption out loud:
//     `busbarBasis: 'catalogue-scalar-shared-gateway'` — "One gateway, one point of connection —
//     the contribution does NOT scale with the unit count." Correct for one gateway. For two
//     domains, each gateway is its OWN point of connection on its OWN panel.
//   · `lib/equipment/equipmentMultiplicity.ts` + `enphaseGatewayMultiplicity.ts` — gateway COUNT
//     already exists, but it is derived from PV EXPORT CAPACITY (Ray, 09-26: "Capacity determines
//     multiplicity. Topology determines assignment."). On this job the driver is the SERVICE SPLIT,
//     which is the "topology determines assignment" half — and it had no model.
//
// And two authorities were absent entirely: `grep -rl 'SCCR|availableFaultCurrent|aicRating'` over
// `lib/` returned NOTHING, and neutral-ground bonding existed only as a `bondingJumperGauge` string
// on a catalogue row — never as a LOCATION derived from where the service disconnect is.
//
// ═══ WHAT THIS FILE IS, AND IS NOT ═══
//
// It is the generic service graph and its checks. It is NOT a Tesla engine: Tesla is the first real
// proving case, and the device rules come from a manufacturer adapter
// (`lib/electrical/adapters/tesla.ts`) built out of the existing equipment catalogue. The same graph
// takes 400 A / 600 A services, several MSPs, several backup systems, several inverters, several
// controllers, partial backup domains and mixed backed-up/non-backed-up loads.
//
// It computes nothing that another authority already owns. The 120% busbar limit comes from
// `lib/nec/rule705_12.ts`. Load calculations are INPUTS here: an absent one is reported
// `NOT_EVALUATED`, never assumed.
//
// 🚨 UNKNOWN MAY NOT BECOME PASS. Ray's words. Every check returns PASS, FAIL or NOT_EVALUATED, and
// the third one names the input it is missing. `lib/rules-engine.ts` has only
// 'error' | 'warning' | 'info' | 'pass' and therefore cannot express it — which is exactly how a
// missing available-fault-current turns into a green report.
// ═══════════════════════════════════════════════════════════════════════════

import { maxLoadSideBackfeedA } from '@/lib/nec/rule705_12';
import { nextStandardOcpd } from '@/lib/electrical/stdSizes';
import { wireGaugeForOcpd } from '@/lib/permit/utils/conductorAuthority';
import { derSources, sourcesForAggregationInput } from '@/lib/electrical/derSources';
import { buildConnectionGraph, derIsolationCoverage } from '@/lib/electrical/connectionGraph';
import {
  foldConclusions,
  type EngineeringConclusion, type EngineeringCheck,
} from '@/lib/engineering/engineeringStatus';

// The source list and the traversal live in their own modules so this file can run the
// DER-isolation-coverage check without the two importing each other at run time. Re-exported here
// because a caller reaching for "the topology's DER sources" looks in the topology module first.
export { derSources, sourcesForAggregationInput };
export {
  buildConnectionGraph, derIsolationCoverage, UTILITY_NODE_ID,
  type ConnectionGraph, type ConnNode, type ConnEdge, type DerIsolationCoverage,
} from '@/lib/electrical/connectionGraph';

/**
 * The continuous-duty factor an inverter output circuit is sized at.
 *
 * NEC 690.8(A)/705.60 — the same 1.25 `lib/electrical/acDisconnect.ts` documents on its own input.
 * Named once here so a reader can see which factor this is rather than meeting a bare literal.
 */
const CONTINUOUS_DUTY_FACTOR = 1.25;

// ── The service ─────────────────────────────────────────────────────────────

/**
 * The electrical system the utility delivers.
 *
 * 🚨 A NON-RESIDENTIAL SERVICE MUST BE REPRESENTABLE BEFORE IT CAN BE CALCULATED. With only three
 * members, a 240 V delta or a 120/240 V high-leg delta had no honest value, and the reader turned
 * every phase it did not recognise into `'split-240'`, so a commercial service was stored, reloaded
 * and checked as a house. Representing a system is not the same as calculating it:
 * `evaluateServiceTopology` reports CALCULATION METHOD NOT YET SUPPORTED for every phase-dependent
 * check on a system whose method SolarPro has not implemented.
 *
 * `'custom'` is a system SolarPro has no model for yet (347/600 V, corner-grounded delta, …). It is
 * also what a stored phase this build does not recognise reads back as, so it never becomes split
 * phase.
 */
export type ServicePhase =
  | 'split-240'
  | 'wye-208'
  | 'wye-480'
  | 'delta-240'
  | 'high-leg-delta-240'
  | 'custom';

/** Every member, in the order a picker offers them. */
export const SERVICE_PHASES: readonly ServicePhase[] = [
  'split-240', 'wye-208', 'wye-480', 'delta-240', 'high-leg-delta-240', 'custom',
];

export interface ServicePhaseInfo {
  /** What an installer calls it. */
  label: string;
  /** 1 or 3; null when SolarPro does not know (custom). */
  phaseCount: 1 | 3 | null;
  lineToLineV: number | null;
  /** null when there is no neutral, or when it is not known (custom). */
  lineToNeutralV: number | null;
  wires: string | null;
  /** true / false when the system definition says; null when nobody has said (custom). */
  hasNeutral: boolean | null;
  /** The one system SolarPro's service engineering is built for. */
  residentialSplitPhase: boolean;
}

const SERVICE_PHASE_INFO: Record<ServicePhase, ServicePhaseInfo> = {
  'split-240': {
    label: '120/240 V split phase', phaseCount: 1, lineToLineV: 240, lineToNeutralV: 120,
    wires: '3-wire (L1, L2, N)', hasNeutral: true, residentialSplitPhase: true,
  },
  'wye-208': {
    label: '120/208 V 3φ wye', phaseCount: 3, lineToLineV: 208, lineToNeutralV: 120,
    wires: '4-wire (A, B, C, N)', hasNeutral: true, residentialSplitPhase: false,
  },
  'wye-480': {
    label: '277/480 V 3φ wye', phaseCount: 3, lineToLineV: 480, lineToNeutralV: 277,
    wires: '4-wire (A, B, C, N)', hasNeutral: true, residentialSplitPhase: false,
  },
  'delta-240': {
    label: '240 V 3φ delta', phaseCount: 3, lineToLineV: 240, lineToNeutralV: null,
    wires: '3-wire (A, B, C)', hasNeutral: false, residentialSplitPhase: false,
  },
  // The neutral is the centre tap of one winding: A–N and C–N are 120 V, the high leg B–N is ~208 V.
  'high-leg-delta-240': {
    label: '120/240 V high-leg delta', phaseCount: 3, lineToLineV: 240, lineToNeutralV: 120,
    wires: '4-wire (A, B high leg, C, N)', hasNeutral: true, residentialSplitPhase: false,
  },
  'custom': {
    label: 'Other / custom', phaseCount: null, lineToLineV: null, lineToNeutralV: null,
    wires: null, hasNeutral: null, residentialSplitPhase: false,
  },
};

export function isServicePhase(v: unknown): v is ServicePhase {
  return typeof v === 'string' && (SERVICE_PHASES as readonly string[]).includes(v);
}

/**
 * The facts a service phase implies. Isomorphic: no catalogue, no database.
 *
 * A value outside the union (an unparsed graph, a stale client) is described as `'custom'` — the
 * system SolarPro has no model for — never as split phase.
 */
export function servicePhaseInfo(phase: ServicePhase): ServicePhaseInfo {
  return SERVICE_PHASE_INFO[phase] ?? SERVICE_PHASE_INFO.custom;
}

/**
 * 🚨 THE SERVICE EQUIPMENT IS ALREADY ON THE WALL, AND NOBODY HAS READ IT YET.
 *
 * Ray, on the real job: "existing Eaton meter/service equipment visible on site — exact internal
 * breaker/distribution configuration still needs field/model verification... SolarPro must
 * represent it as EXISTING 400 A SERVICE EQUIPMENT — CONFIGURATION TO VERIFY until exact equipment
 * data is supplied. Do not automatically add replacement 400 A service distribution equipment."
 *
 * So this is the difference between a service SolarPro is DESIGNING and one it is CONNECTING TO.
 * Its presence means: do not price it, do not schedule it as new, and do not assume its internals.
 * Every field is separately null because they arrive separately — a catalog number off the door
 * label, the internal arrangement off the deadfront, the AIC off the nameplate.
 */
export interface ExistingServiceEquipment {
  manufacturer: string | null;
  catalogNumber: string | null;
  /** The internal main / disconnect arrangement, in the words of whoever read it. */
  mainArrangement: string | null;
  /** How the outgoing feeders leave the assembly. */
  feederArrangement: string | null;
  /** AIC / SCCR of the existing assembly, from its own label — never inferred from the rating. */
  sccrA: number | null;
  /**
   * Somebody has been to site (or has the submittal) and the fields above are read, not assumed.
   *
   * 🚨 IT IS NOT DERIVED FROM THE FIELDS BEING FULL. A design can be complete on paper and still
   * never have been verified, and a verified assembly can legitimately have an unknown AIC.
   */
  verified: boolean;
}

export interface UtilityService {
  /**
   * Aggregate service rating. 400 on this job.
   *
   * 🚨 NULLABLE, AND THAT IS THE WHOLE POINT. It used to be `number`, and `parseServiceTopology`
   * enforced it by returning **null for the entire stored graph** when the rating was absent — so
   * one missing fact silently deleted every branch, panel, gateway, battery and switch the
   * operator had built, and the project dropped back to the legacy scalars with no signal that
   * anything had been dropped. Ray: "Missing one fact should produce SERVICE RATING REQUIRED —
   * TOPOLOGY PARTIALLY EVALUATED. It should never mean 'pretend the graph doesn't exist.'"
   *
   * So an absent rating is now an ordinary unresolved input: `service.rating` reports
   * NOT_EVALUATED, everything that depends on the rating reports NOT_EVALUATED naming it, and
   * everything that does not — the connection graph, DER isolation coverage, the busbar checks,
   * the equipment inventory — still evaluates.
   */
  ratedAmps: number | null;
  /**
   * Line-to-line voltage. Printed by the drawing and the schedule; no check in this file reads it.
   * Phase-dependent conclusions come from `phase`, so a wrong number here cannot turn into a PASS.
   */
  voltage: number;
  phase: ServicePhase;
  /**
   * Available fault current at the service point.
   *
   * 🚨 NULL IS NOT ZERO AND NOT "FINE". Every SCCR check downstream reports NOT_EVALUATED while
   * this is null, because a device whose interrupting rating has not been compared to anything has
   * not been shown to be adequate.
   */
  availableFaultCurrentA: number | null;
  /**
   * The service equipment that is already installed, when it is.
   *
   * Absent ⇒ new service equipment, which SolarPro engineers and prices. Present ⇒ existing
   * equipment, whose configuration is a field-verification item and which is never replaced by
   * SolarPro's own initiative.
   */
  existingEquipment?: ExistingServiceEquipment | null;
}

// ── Devices, and the roles they play ────────────────────────────────────────

/**
 * 🚨 FOUR SEMANTIC ROLES, NOT ONE `disconnectAmps` FIELD.
 *
 * Ray: "Model separate semantic roles: Service Disconnect / Utility DER Isolation Disconnect /
 * Gateway isolation device / ESS disconnect-OCPD. A piece of hardware may perform more than one
 * role only when the applicable authority explicitly permits it."
 *
 * So roles are a SET on a device, and a device holding more than one must name the authority that
 * permits the combination. An unexplained double role is a FAIL, not a convenience.
 */
export type DeviceRole =
  | 'service-disconnect'
  | 'der-isolation-disconnect'
  | 'gateway-isolation'
  | 'ess-disconnect';

export interface ProtectiveDevice {
  id: string;
  label: string;
  roles: DeviceRole[];
  ratedAmps: number | null;
  /** Interrupting rating. null ⇒ the SCCR chain is NOT_EVALUATED, never assumed adequate. */
  sccrA: number | null;
  lockableOpen: boolean | null;
  /** Visible-open / manual load-break operation, which a utility isolation device usually needs. */
  visibleOpen: boolean | null;
  /** Named authority permitting this device to hold more than one role. */
  roleCombinationAuthority?: string | null;
  /** Where it sits relative to the revenue meter, when a utility rule cares. */
  locationNote?: string | null;
  /**
   * The next node TOWARD THE UTILITY from this device, when the arrangement places it somewhere
   * other than the default service chain (distribution → service disconnect → isolation → meter).
   *
   * 🚨 IT IS WHAT MAKES ISOLATION COVERAGE ANSWERABLE. A disconnect that sits on the DER feeder out
   * of an aggregation panel interrupts a completely different set of paths from one on the service
   * conductors, and "does opening it disconnect every DER source" cannot be answered without
   * knowing which. Absent ⇒ the default chain, which is what every graph written before this field
   * existed means.
   */
  feedsNodeId?: string | null;
  /**
   * The node on this device's LOAD side — the node whose supply toward the utility it interrupts.
   *
   * 🚨 A STUB IS NOT AN IN-LINE DEVICE, AND THE FIRST VERSION COULD ONLY DRAW A STUB. `feedsNodeId`
   * alone says what is upstream, which is enough to hang a device off the graph and NOT enough to
   * put it IN a conductor that already exists. Ray's real job is exactly that shape:
   *
   *     200 A path A → knife switch A → Gateway #1 → MSP #1
   *
   * With only `feedsNodeId` the switch is a second branch off the distribution while the original
   * gateway-to-branch conductor is still there, so opening the switch disconnects nothing and DER
   * ISOLATION COVERAGE correctly reports a bypass the installer never built. Naming the load side
   * makes the connection graph RE-ROUTE the existing edge through the device, which is what a
   * disconnect physically does.
   *
   * Absent ⇒ the device is not in line on any particular node's supply, which is what every graph
   * written before this field existed means.
   */
  inlineOnNodeId?: string | null;
  /**
   * The catalogue part actually selected, once one has been.
   *
   * 🚨 A CALCULATION IS NOT A PURCHASE ORDER. Ray: "Calculations determine minimum required rating.
   * They do not automatically invent a purchasable device." So the engineering establishes
   * `ratedAmps` as the REQUIREMENT, this names the part chosen to meet it, and
   * `device.selection` reports the gap between them rather than filling it.
   */
  productId?: string | null;
}

// ── The graph ───────────────────────────────────────────────────────────────

export interface ServiceBranch {
  id: string;
  label: string;
  /** What this branch is rated for. 200 on each of Ray's two. */
  ratedAmps: number;
  /** The OCPD protecting it, where one is distinct from the rating. */
  ocpdAmps: number | null;
  /** Calculated demand ON THIS BRANCH. null ⇒ the branch load check is NOT_EVALUATED. */
  calculatedDemandA: number | null;
  /**
   * The panelboards this branch physically feeds.
   *
   * 🚨 THIS IS THE FEED, NOT THE BACKUP. `BackupDomain.backedUpPanelIds` says which panels sit
   * BEHIND a gateway; this says which panels the branch conductors land in at all. They are the
   * same list on a fully backed-up branch and they differ on a partially backed-up one.
   *
   * Optional, and absent on graphs written before it existed: a consumer that needs the link falls
   * back to the domain's panels, which is what it did when this field did not exist. It was added
   * because the SLD had to GUESS the panel for a branch with no backup domain, and a drawing that
   * guesses which panel a 200 A feeder lands in is a drawing an inspector cannot trust.
   */
  panelIds?: string[];
}

export interface GatewayInstance {
  id: string;
  /** Catalogue id, so the rating is never retyped into a design. */
  productId: string;
  label: string;
  /** Continuous pass-through rating, from the product's own catalogue row. */
  continuousRatingA: number | null;
  serviceEntranceRated: boolean | null;
  /** The main breaker actually selected in it — this is what sets the supported SCCR. */
  mainBreakerA: number | null;
  sccrA: number | null;
  /**
   * The controller's OWN internal panelboard, resolved from its catalogue row.
   *
   * 🚨 A THIRD BUS, AND IT IS NOT THE MSP'S AND NOT THE SERVICE'S. Load and generation breakers
   * land in it, so "will this generation feeder fit" is a question about THIS busbar and THIS
   * maximum branch device. Absent ⇒ the product has no internal panelboard, or the catalogue has
   * not been given one — and the landing check says so rather than borrowing another panel's bus.
   */
  internalPanelboard?: {
    busbarRatingA: number;
    spaces: number;
    maxBranchBreakerA: number;
    basis: string;
  } | null;
}

export interface PanelBoard {
  id: string;
  label: string;
  /** Busbar rating. Drives NEC 705.12(B). null ⇒ the busbar check is NOT_EVALUATED. */
  busbarRatingA: number | null;
  mainBreakerA: number | null;
  sccrA: number | null;
  /** Is this panel inside the backed-up island, or ahead of it? */
  backedUp: boolean;
  /**
   * Who made the panelboard, as read off its label ("Eaton"). Optional and absent on graphs written
   * before System Config asked for it; nothing engineers from it — it identifies the enclosure on
   * the sheet and in the field.
   */
  manufacturer?: string | null;
}

/**
 * 🚨 AN EXPANSION IS ENERGY, NOT POWER.
 *
 * Ray: "Expansion units are DC battery extensions connected to the Powerwall 3 through Tesla's
 * Expansion Harness. They are not independent AC sources and do not receive their own Gateway
 * breaker... Never calculate service/busbar contribution from Expansion-unit energy capacity."
 *
 * So a storage unit declares which of the two things it is, and the aggregation reads the role —
 * it does not multiply a unit count by a per-unit current. That is the arithmetic that would put
 * four Powerwalls' worth of backfeed on a job that has two.
 */
export type StorageRole = 'inverter-unit' | 'energy-expansion';

/**
 * What a unit's integrated solar inverter will accept on its DC inputs.
 *
 * 🚨 RESOLVED ONTO THE INSTANCE FROM THE CATALOGUE, like `GatewayInstance.continuousRatingA` and
 * for the same reason: this file holds no catalogue lookup, and a check that needs a manufacturer
 * limit reads it off the unit that was built from the manufacturer's row. `basis` travels with the
 * numbers so a plan reviewer sees which document they came from.
 */
export interface PvInputLimits {
  maxStcKw: number;
  mppts: number;
  mpptVdc: readonly [number, number];
  inputVdc: readonly [number, number];
  maxImpPerMpptA: number;
  maxIscPerMpptA: number;
  basis: string;
}

export interface StorageUnit {
  id: string;
  productId: string;
  /**
   * The catalogue's own name for it, resolved when the unit was built.
   *
   * 🚨 A PRODUCT ID IS NOT A MODEL NAME. A drawing that prints `tesla-powerwall-3` in an equipment
   * box is printing an internal key at an inspector. Optional because graphs written before it
   * existed do not carry it; consumers fall back to the id, which is what they printed then.
   */
  label?: string;
  role: StorageRole;
  /** Continuous AC output. MUST be null or 0 for an 'energy-expansion'. */
  continuousOutputA: number | null;
  /** Its own AC OCPD. An expansion has none. */
  ocpdA: number | null;
  usableKwh: number | null;
  /** For an expansion: the inverter unit it is harnessed to. */
  attachedToUnitId?: string | null;
  /**
   * 🚨 WHICH OUTPUT SETTING THIS UNIT IS COMMISSIONED AT.
   *
   * A Powerwall 3 is configurable — 5.8 / 7.6 / 10 / 11.5 kW — and its continuous current AND its
   * required OCPD both move with the setting. Ray's job wants "the increased inverter/discharge
   * capacity", i.e. the 11.5 kW configuration, and that is a recorded decision about this unit, not
   * a property of the product.
   *
   * Absent ⇒ the catalogue's top row, which is what the unit ships able to do and what the scalars
   * on the product row state. `continuousOutputA` / `ocpdA` beside it are the RESOLVED numbers for
   * whichever row applies — read those, never this.
   */
  outputConfigKw?: number | null;
  /**
   * PV STC capacity landed on THIS unit's own DC inputs, for a DC-coupled design.
   *
   * 🚨 IT COMES FROM THE DESIGN, NOT FROM A DIVISION. Ray: "Actual string counts must continue to
   * come from the design. Do not invent final string distribution simply to make the diagram
   * symmetrical." So null is the honest state until the string engine has assigned strings to
   * inputs, and the check names that rather than splitting the array four ways.
   */
  pvDcStcKw?: number | null;
  /** What this unit's integrated inverter accepts on DC, from its catalogue row. */
  pvInputLimits?: PvInputLimits | null;
}

/**
 * One backed-up island: a gateway, the branch feeding it, the panels behind it, and its storage.
 *
 * Ray: "Domain A = Gateway #1 + MSP #1 + PW3 #1 + Expansion #1. Domain B = Gateway #2 + MSP #2 +
 * PW3 #2 + Expansion #2."
 */
export interface BackupDomain {
  id: string;
  label: string;
  branchId: string;
  gateway: GatewayInstance;
  /** Panels behind the gateway. Several, because partial backup is a real arrangement. */
  backedUpPanelIds: string[];
  storageUnitIds: string[];
  /** PV / other generation landing INSIDE this domain, as continuous AC amps. */
  generationOutputA: number | null;
  /** Backed-up load, where it has been calculated. null ⇒ NOT_EVALUATED. */
  backedUpDemandA: number | null;
  /**
   * 🚨 WHERE THE STORAGE ACTUALLY LANDS, WHICH DECIDES WHETHER 705.12(B) APPLIES AT ALL.
   *
   * Ray: "The exact location of PW3 breakers — Gateway internal panelboard versus approved
   * downstream load center — must follow selected topology/manufacturer authority."
   *
   * 'backed-up-panel-busbar' — the battery breaker is in the panel, so its output counts against
   *     that panel's busbar and the 120% rule is the governing check.
   * 'gateway-panelboard'     — the breaker is inside service-entrance-rated gateway equipment
   *     ahead of the panel. That is a different connection with the MANUFACTURER's limits, not the
   *     panel's busbar rule, and SolarPro does not have those limits: the check reports
   *     NOT_EVALUATED naming the document rather than passing or failing on the wrong rule.
   * 'der-aggregation-panel'  — the storage does not land on this domain's panel or in its
   *     controller at all: its output goes to a DER aggregation panel that interconnects
   *     elsewhere. This panel's busbar then carries no storage, and the governing check moves to
   *     the aggregation panel's own.
   * 'unresolved'             — nobody has said. The default, and it is NOT_EVALUATED.
   *
   * Getting this wrong in either direction is expensive. Assuming the busbar produces a FAIL on a
   * perfectly standard gateway installation; assuming the gateway silently skips the one check
   * that protects the panel.
   */
  storageConnection:
    'backed-up-panel-busbar' | 'gateway-panelboard' | 'der-aggregation-panel' | 'unresolved';
}

// ═══════════════════════════════════════════════════════════════════════════
// DER SOURCES, AGGREGATION, AND THE POINT OF INTERCONNECTION.
//
// Ray, after live-testing the 400 A workflow: "It does not yet adequately describe how the two DER
// systems aggregate and actually interconnect with the 400 A service... Do not assume that exact
// hardware arrangement is correct merely because Ray suggested it. Instead, give SolarPro enough
// electrical vocabulary to represent and engineer it correctly."
//
// 🚨 TWO THINGS THAT ARE NOT THE SAME PANEL, AND MUST NEVER SHARE A FIELD.
//
//   SERVICE DISTRIBUTION — equipment that splits the utility service into its branches. Its rating
//     follows the SERVICE. That is `UtilityService` + `ServiceBranch[]` and it already exists.
//   DER AGGREGATION      — a panel whose purpose is to gather several DER AC circuits before a
//     common point of interconnection. Its rating follows the DER CURRENT THAT ACTUALLY FLOWS IN
//     IT, and it is not 400 A because the service is 400 A.
//
// Ray: "Do not create a generic `combinerPanelAmps`." So there is no such field anywhere below:
// the aggregation panel is its own node with its own inputs, its own busbar and its own OCPD, and
// the check that sizes it reads the sources, never the service.
// ═══════════════════════════════════════════════════════════════════════════

/** Anything on the premises that can push current toward the utility. */
export type DerSourceKind = 'ess-inverter' | 'pv-inverter' | 'generator' | 'other';

/**
 * Generation that is not storage: a PV inverter, a generator, anything else with an AC output.
 *
 * Storage inverter units are DER sources too and are NOT duplicated here — they are
 * `StorageUnit`s with role `'inverter-unit'`, and `derSources()` returns both kinds as one list.
 * One authority per unit; two would be how a BOM starts counting an inverter twice.
 */
export interface GenerationUnit {
  id: string;
  label: string;
  productId?: string | null;
  kind: Exclude<DerSourceKind, 'ess-inverter'>;
  /** Manufacturer-governed continuous AC output. null ⇒ NOT_EVALUATED, never zero. */
  continuousOutputA: number | null;
  ocpdA: number | null;
  /** The backup domain it lands inside, when it does. null ⇒ outside every domain. */
  domainId?: string | null;
}

/** A DER source, whatever kind of equipment it is, as the traversal and the sizing see it. */
export interface DerSource {
  id: string;
  label: string;
  kind: DerSourceKind;
  continuousOutputA: number | null;
  ocpdA: number | null;
  domainId: string | null;
}

/**
 * WHERE on a source or a controller a circuit is taken from.
 *
 * 🚨 THIS IS THE FIELD THAT PREVENTS AN INVALID TOPOLOGY. Ray: "The two Gateways remain separate
 * islanding/backup domains. Do not create a common bus that electrically defeats Gateway
 * isolation, independent domain control... A common aggregation/interconnection point is not
 * permission to parallel arbitrary backed-up Gateway outputs."
 *
 * Tying two controllers' BACKED-UP buses together parallels two islands. Tying their GRID SIDES
 * together is an ordinary utility-side arrangement. Without this field the graph cannot tell those
 * two apart, and therefore cannot refuse the first one.
 */
export type DerTapPoint =
  /** The source's own AC output conductors. */
  | 'der-output'
  /** The line/grid side of a backup controller — outside the island. */
  | 'gateway-grid-side'
  /** The backed-up bus behind a backup controller — inside the island. */
  | 'backed-up-busbar';

export interface DerAggregationInput {
  id: string;
  /** A storage unit id, a generation unit id, or a backup domain id. */
  sourceId: string;
  tap: DerTapPoint;
  /** The OCPD in THIS panel protecting that circuit. null ⇒ NOT_EVALUATED. */
  ocpdA: number | null;
  conductorGauge?: string | null;
}

/**
 * A panel that aggregates DER AC circuits before a common point of interconnection.
 *
 * Generic on purpose: its inputs name source ids, not products, so several batteries, several PV
 * inverters, a generator or a mix of brands aggregate through the same node.
 */
export interface DerAggregationPanel {
  id: string;
  label: string;
  /**
   * 🚨 WHICH SYSTEM THIS PANEL BELONGS TO.
   *
   * Ray, on the real job: "These are two separate combiner/generation panels. Do not create one
   * common generation panel shared by both Gateways." Each Tesla system has its own, each takes
   * only its own two Powerwalls, and each feeds only its own Gateway — so the panel has to KNOW
   * which system it is in. Without it the BOM shows two identical rows with nothing to tell them
   * apart, the equipment schedule cannot keep Domain A and Domain B identifiable, and the drawing
   * has no basis for putting one on the left and one on the right.
   *
   * `null` ⇒ a site-wide panel that belongs to no single system, which is what the common
   * aggregation arrangement builds. Absent on graphs written before this field existed.
   */
  domainId?: string | null;
  /**
   * The catalogue part actually selected for it.
   *
   * 🚨 A CALCULATED MINIMUM IS NOT A PURCHASABLE DEVICE. The sizing says "at least 125 A"; this
   * says which panelboard was bought. Absent ⇒ `aggregation.selection` reports NOT EVALUATED —
   * EQUIPMENT SELECTION REQUIRED, and the BOM has nothing to order.
   */
  productId?: string | null;
  /**
   * 🚨 DOES THIS PANEL ALSO CARRY PREMISES LOAD?
   *
   * Ray: "If the panel also carries service/load current rather than DER-only current, its
   * governing calculation changes accordingly. SolarPro must know which kind of panel it is."
   *
   * `true`  ⇒ it is a load centre with DER backfed into it: the 120% busbar allowance governs.
   * `false` ⇒ it is a DER-only generation panel: its busbar carries only the aggregated output.
   * `null`  ⇒ nobody has said, and the sizing check reports NOT_EVALUATED naming this field.
   */
  carriesPremisesLoad: boolean | null;
  busbarRatingA: number | null;
  /** The main OCPD, where it has one. */
  mainBreakerA: number | null;
  /** Main-lug-only: no main OCPD by design, which is a different thing from "not established". */
  mainLugOnly: boolean;
  sccrA: number | null;
  inputs: DerAggregationInput[];
  /** The OCPD protecting the feeder LEAVING this panel. */
  outputOcpdA: number | null;
  outputConductorGauge?: string | null;
  /**
   * The node this panel's output lands on — a point of interconnection, a protective device or a
   * panel. null ⇒ the arrangement is unresolved, and nothing downstream may assume one.
   */
  feedsNodeId: string | null;
}

/**
 * The governed relationships a point of interconnection may have with the premises wiring.
 *
 * Ray: "The POI must identify exactly where the DER meets the premises/service electrical system."
 * Meter collar stays a separate topology and remains unavailable when prohibited.
 */
export type PoiRelationship =
  | 'load-side-busbar'
  | 'load-side-feeder-tap'
  | 'supply-side'
  | 'aggregation-to-supply-side'
  | 'manufacturer-integrated'
  | 'meter-collar'
  /**
   * 🚨 A REAL MEMBER, NOT A MISSING ONE. A point of interconnection can exist on a drawing before
   * anybody has decided which governed relationship it is — that is the state the sheet prints
   * INTERCONNECTION ARRANGEMENT REQUIRED for. Without it, creating a POI would force a guess, and
   * the guess would silently inherit that relationship's code article.
   */
  | 'unresolved';

export interface PointOfInterconnection {
  id: string;
  label: string;
  relationship: PoiRelationship;
  /** The DER-side node whose output arrives here. */
  derNodeId: string | null;
  /** The premises / service-side node it lands on. */
  connectedToNodeId: string | null;
  ocpdA: number | null;
}

/**
 * The NEC article that governs a relationship.
 *
 * 🚨 DERIVED, NOT STORED. A stored article can disagree with the relationship beside it; a
 * function cannot.
 */
export function governingArticleFor(r: PoiRelationship): string | null {
  switch (r) {
    case 'load-side-busbar': return 'NEC 705.12(B)';
    case 'load-side-feeder-tap': return 'NEC 705.12(A) / 240.21';
    case 'supply-side':
    case 'aggregation-to-supply-side': return 'NEC 705.11';
    // A manufacturer-integrated connection is governed by the manufacturer's listing, and naming
    // an NEC article for it would be the guess this model exists to refuse.
    case 'manufacturer-integrated': return null;
    case 'meter-collar': return null;
    case 'unresolved': return null;
  }
}

/**
 * How the site's DER reaches the service — the DESIGN DECISION, recorded rather than inferred.
 *
 * `null` means nobody has chosen, and the engineering says so instead of picking one.
 */
export type DerArrangement =
  /** Each backup domain interconnects through its own governed service branch arrangement. */
  | 'independent-branch'
  /** The DER branches aggregate in an AC generation panel before a common service POI. */
  | 'common-aggregation'
  /** Advanced: the operator has built something the two presets do not describe. */
  | 'custom';

/**
 * 🚨 HOW THE PV IS COUPLED — ONE PROJECT-LEVEL ANSWER, AND IT OUTRANKS EVERY INFERENCE.
 *
 * Ray, from the live browser: "Service Topology says Tesla. Main electrical system still says
 * MICROINVERTER. SLD still draws Enphase equipment. That is unacceptable. SolarPro needs one
 * explicit project-level solar coupling architecture."
 *
 * The contradiction was not a rendering bug. Nothing in the product RECORDED how the PV is
 * coupled, so two consumers each inferred it: the service topology inferred Tesla from the
 * equipment in its domains, and the drawing inferred microinverters from the equipment picker's
 * default. Both inferences were locally reasonable. The project had no answer for them to agree
 * with, so this type is that answer.
 *
 *   'dc-coupled-storage'   — the strings terminate on the storage units' own DC inputs. There is no
 *       separate PV inverter at all: no microinverters, no micro branch circuits, no PV combiner,
 *       no standalone solar inverter, and no PV AC disconnect from the AC-coupled path, because
 *       none of that equipment exists on the job.
 *   'ac-coupled-inverter'  — the PV has its own inverter(s) and lands on AC. Legitimate alongside
 *       storage and NOT to be ruled out just because a battery is present: Ray's own instruction is
 *       "Do not assume Tesla storage always eliminates Enphase."
 *   'storage-only'         — there is no PV in this project.
 *
 * `null`/absent ⇒ nobody has recorded it, which is a DESIGN DECISION the engineering reports as
 * unresolved. It is NOT a licence for a consumer to go back to guessing.
 */
export type SolarCoupling =
  | 'dc-coupled-storage'
  | 'ac-coupled-inverter'
  | 'storage-only';

/**
 * What a coupling architecture is called in front of an installer.
 *
 * 🚨 THE PRODUCT NAME IS COMPOSED, NOT BAKED IN. Ray writes the architecture as
 * `DC_COUPLED_POWERWALL_3`, and on his job that is exactly what it is — but the member is
 * `dc-coupled-storage` because this file is the GENERIC graph and may name no manufacturer. The
 * topology already knows which units are installed, so passing it produces "PV DC coupled to Tesla
 * Powerwall 3" from the instances; without one it reads "PV DC coupled to the batteries", which is
 * the same architecture stated without a product nobody has chosen yet.
 */
export function solarCouplingLabel(
  c: SolarCoupling | null | undefined, t?: ServiceTopology,
): string {
  switch (c) {
    case 'dc-coupled-storage': {
      const models = [...new Set((t?.storage ?? [])
        .filter(u => u.role === 'inverter-unit')
        .map(u => u.label ?? u.productId))];
      return `PV DC coupled to ${models.length === 1 ? models[0] : 'the batteries'}`;
    }
    case 'ac-coupled-inverter': return 'PV on its own AC inverter';
    case 'storage-only': return 'No PV — storage only';
    default: return 'Not selected';
  }
}

/**
 * The equipment classes that may NOT exist on a design with this coupling.
 *
 * 🚨 ONE LIST, READ BY THE DRAWING, THE SIDEBAR AND THE CHECK. Written separately they diverge,
 * and the sheet starts dropping a device the engineering still counts.
 */
export function prohibitedPvEquipmentFor(c: SolarCoupling | null | undefined): string[] {
  if (c !== 'dc-coupled-storage') return [];
  return [
    'microinverters',
    'microinverter branch circuits',
    'PV AC combiner panel',
    'standalone PV / solar inverter',
    'PV AC disconnect from the AC-coupled interconnection path',
  ];
}

/**
 * Where the neutral-to-ground bond is, and therefore what everything downstream must be.
 *
 * 🚨 DERIVED, NEVER DECLARED. Ray: "Determine where the actual service disconnect is. If a 400 A
 * service disconnect is upstream of both Gateway 3s: downstream equipment must be modeled according
 * to feeder/bonding rules rather than blindly treating each Gateway as service equipment."
 *
 * The bond follows the service disconnect. Two service disconnects means two service-entrance
 * enclosures and the bond is in each; one upstream disconnect means one bond there and every
 * gateway and panel below it is a FEEDER enclosure with its bonding screw REMOVED and neutral
 * isolated.
 */
export interface BondingModel {
  /** Ids of the enclosures that are service equipment and therefore carry the bond. */
  bondedAtNodeIds: string[];
  /** Ids of enclosures that must have neutral isolated from ground. */
  neutralIsolatedNodeIds: string[];
  /** One sentence naming why, so a plan reviewer sees the reasoning, not a checkbox. */
  basis: string;
}

// ── The load calculation, which is OPTIONAL and asked for ONCE ──────────────

/**
 * How the dwelling load was calculated. The method is recorded because the same house gives
 * different answers under 220 Part III and 220.82, and a reviewer has to know which one this is.
 */
export type LoadCalculationMethod =
  | 'standard-220-part-iii'
  | 'optional-220-82'
  | 'existing-dwelling-220-87'
  | 'engineer-supplied';

/** Calculated demand in one panelboard. Loads live in panels, so this is where the number lives. */
export interface PanelLoad {
  panelId: string;
  calculatedDemandA: number;
}

/**
 * 🚨 ONE LOAD MODEL, FOUR ANSWERS — AND IT IS OPTIONAL.
 *
 * Ray, firm product decision: "Ray is not going to verify every load in every house just to create
 * a valid design. Full load calculations remain available for users/projects that want or require
 * them. But they are optional... Standard design must allow completion of topology, equipment,
 * disconnects, conductor engineering where possible, SLD, BOM, schedule, permit drawing without a
 * complete appliance/load inventory."
 *
 * And: "DO NOT ASK FOR THE SAME LOAD MULTIPLE TIMES. If a user chooses Full Load Analysis, one load
 * model should derive: aggregate service demand, Branch A demand, Branch B demand, backed-up load
 * per domain. Do not independently ask for four amperage values."
 *
 * So the model holds demand PER PANELBOARD and `resolveDemands` sums it up the graph: a branch's
 * demand is the sum of the panels it feeds, a domain's backed-up demand is the sum of the panels it
 * backs up, and the service demand is the sum of the lot. Those are derivations, not four inputs —
 * and they are derivations the topology already has the structure to make.
 */
export interface LoadModel {
  method: LoadCalculationMethod;
  /** Why this method applies, in the words of whoever ran it. Never generated here. */
  basis: string;
  /** Calculated demand per panelboard. Branch and service totals are SUMS of these. */
  byPanel: PanelLoad[];
  /**
   * Service load that is not inside any modelled panelboard — a direct-feed appliance, a detached
   * structure feeder. Null is "none recorded", which is not the same as zero being asserted.
   */
  otherDemandA?: number | null;
}

export interface ServiceTopology {
  service: UtilityService;
  /** Everything protective, by role. */
  devices: ProtectiveDevice[];
  branches: ServiceBranch[];
  panels: PanelBoard[];
  domains: BackupDomain[];
  storage: StorageUnit[];
  /** PV inverters, generators — DER that is not storage. Empty on a storage-only site. */
  generation: GenerationUnit[];
  /**
   * DER aggregation panels. Empty in the independent-branch arrangement, which is a complete,
   * valid topology — an empty list is not a missing one.
   */
  aggregationPanels: DerAggregationPanel[];
  /**
   * Every point at which DER meets the premises wiring. One per domain in the independent
   * arrangement; one shared in the common-aggregation arrangement.
   */
  pointsOfInterconnection: PointOfInterconnection[];
  /**
   * Site-wide calculated service demand, recorded directly.
   *
   * 🚨 SUPERSEDED BY `loads` WHEN ONE EXISTS, and kept because graphs saved before `loads` existed
   * carry their demand here. `resolveDemands` is the one reader: the load model wins, this is the
   * fallback, and neither being present is an OPTIONAL calculation that was not provided — not a
   * broken design.
   */
  calculatedServiceDemandA: number | null;
  /**
   * The optional dwelling load calculation. Absent on most designs, by product decision.
   *
   * `null`/absent ⇒ `load.calculation` reports NOT_EVALUATED — LOAD CALCULATION NOT PROVIDED, once,
   * and every load-dependent check names THIS as the one thing it needs rather than asking for its
   * own amperage.
   */
  loads?: LoadModel | null;
  /**
   * 🚨 HOW THE PV IS COUPLED — the one project-level answer, and the authority every other surface
   * defers to. Absent ⇒ nobody recorded it; see `SolarCoupling`.
   */
  solarCoupling?: SolarCoupling | null;
  /** Jurisdictional facts that change what is legal, supplied by the AHJ/utility layer. */
  interconnection: InterconnectionContext;
}

export interface InterconnectionContext {
  utilityId: string | null;
  /**
   * 🚨 THE DESIGN DECISION, RECORDED — how the site's DER reaches the service.
   *
   * null ⇒ nobody has chosen. That is its own kind of missing input: not a number the utility owes
   * us and not a document a manufacturer owes us, but a decision the designer owes the drawing.
   * The engineering reports it as such and the sheet refuses to draw a connection nobody chose.
   */
  derArrangement: DerArrangement | null;
  /** Ray's constraint on this job: meter-collar interconnection is NOT permitted. */
  meterCollarPermitted: boolean | null;
  /** Meter-collar actually selected in the design. */
  meterCollarSelected: boolean;
  /**
   * Does this utility require an external DER isolation device for this service?
   *
   * null ⇒ the requirement has not been resolved for this jurisdiction, and the check says so
   * rather than passing.
   */
  externalDerIsolationRequired: boolean | null;
  /** Why — the utility rule, quoted by the caller. Never invented here. */
  externalDerIsolationBasis?: string | null;
  /**
   * 🚨 HAS THE UTILITY / AHJ ACCEPTED THE ARRANGEMENT ACTUALLY MODELLED?
   *
   * A different question from "is an isolation device required", and the one Ray named on his real
   * job: "current intended external isolation is two independent knife-blade switches, one per
   * 200 A path... Utility/AHJ acceptance of the two-switch arrangement remains something to verify"
   * and "Do not claim approval that SolarPro does not have."
   *
   * Without this field the engineering could not express the gap: a required device, two devices
   * present, every path proven cut — and a PASS that silently implied ComEd had signed off on an
   * arrangement nobody had submitted. Isolation COVERAGE is a fact about the graph; this is a
   * ruling, and only the jurisdiction makes it.
   *
   * null ⇒ nobody has asked. false ⇒ it was put to them and refused.
   */
  isolationArrangementAccepted?: boolean | null;
  /** Who accepted it and under what — quoted by the caller, never composed here. */
  isolationArrangementBasis?: string | null;
  /**
   * 🚨 MANUFACTURER DOCUMENT REQUIRED.
   *
   * Ray: "Tesla's current design guidance states that multiple gateways may be used on sites with
   * >200 A service equipment and refers installers to the Multiple Backup Gateways on a Single Site
   * Application Note in Tesla Partner Portal... Do not independently invent 'Gateway #1 is master'
   * or 'just add both Meter Z values' without manufacturer authority. If that Partner Portal
   * document is not present in the repo, create a clearly surfaced MANUFACTURER DOCUMENT REQUIRED
   * state rather than guessing."
   *
   * This is that state. It is set by the adapter, not by this file.
   */
  multiGatewayMeteringDoc: ManufacturerDocumentState | null;
}

export interface ManufacturerDocumentState {
  /** What is needed, in the manufacturer's own title. */
  title: string;
  source: string;
  present: boolean;
  /** What cannot be decided without it. */
  governs: string[];
}

// ── Verdicts ────────────────────────────────────────────────────────────────

/**
 * 🚨 ONE ASSESSMENT VOCABULARY FOR THE WHOLE PRODUCT, NOT ONE PER MODULE.
 *
 * These were declared here first. They now live in `lib/engineering/engineeringStatus.ts` — the
 * file that already held the "PASS must not mean nothing objected" rule at engine level — and this
 * module re-exports them under its own names so the SLD, the permit, the BOM and the engineering
 * UI all read the same three words. A second enum spelled the same way is a second authority.
 */
export type Verdict = EngineeringConclusion;
export type TopologyCheck = EngineeringCheck;

export interface TopologyEvaluation {
  checks: TopologyCheck[];
  bonding: BondingModel;
  /** Aggregate storage, split the way Ray asked: power and energy are different things. */
  storageSummary: StorageSummary;
  /** FAIL if anything failed; NOT_EVALUATED if anything is unevaluated and nothing failed. */
  overall: Verdict;
}

export interface StorageSummary {
  /** Units that actually invert. Expansions are NOT here. */
  inverterUnitCount: number;
  expansionUnitCount: number;
  /** Σ continuous AC output of the inverter units only. null when any is unknown. */
  totalContinuousOutputA: number | null;
  /** Σ usable energy of EVERY unit, inverter and expansion alike. */
  totalUsableKwh: number | null;
  /** Per domain, because each domain's busbar sees only its own. */
  byDomain: Record<string, { continuousOutputA: number | null; usableKwh: number | null }>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const pass = (id: string, scope: string, title: string, detail: string, citation?: string): TopologyCheck =>
  ({ id, scope, title, conclusion: 'PASS', detail, citation });
const fail = (id: string, scope: string, title: string, detail: string, citation?: string): TopologyCheck =>
  ({ id, scope, title, conclusion: 'FAIL', detail, citation });
const unknown = (
  id: string, scope: string, title: string, detail: string, requires: string[], citation?: string,
): TopologyCheck => ({ id, scope, title, conclusion: 'NOT_EVALUATED', detail, requires, citation });

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 🚨 THE TOKENS NOBODY IS OBLIGED TO SUPPLY — ONE LIST, READ BY EVERY SURFACE.
 *
 * Ray's product decision made "unresolved" two different things: a fact the design genuinely waits
 * on, and a calculation the design completes without. A check whose every requirement is in here is
 * OPTIONAL: its conclusion is still NOT_EVALUATED (missing information never becomes PASS) and it
 * must not be counted, phrased or gated as something holding the job up.
 *
 * Declared here, in the module that owns the vocabulary, so the needs-input screen and the permit
 * readiness cannot disagree about which items those are.
 */
export const OPTIONAL_REQUIREMENT_TOKENS: ReadonlySet<string> = new Set(['loads.model']);

/** Is this check one the design completes without? True only when EVERY token it needs is optional. */
export function isOptionalCheck(c: TopologyCheck): boolean {
  const req = c.requires ?? [];
  return req.length > 0 && req.every(r => OPTIONAL_REQUIREMENT_TOKENS.has(r));
}

/** The method, named the way a plan reviewer names it. */
const METHOD_LABEL: Record<LoadCalculationMethod, string> = {
  'standard-220-part-iii': 'Standard calculation, NEC 220 Part III',
  'optional-220-82': 'Optional dwelling calculation, NEC 220.82',
  'existing-dwelling-220-87': 'Existing dwelling, NEC 220.87 (12-month demand data)',
  'engineer-supplied': 'Engineer-supplied load calculation',
};

/**
 * Aggregate storage, with power and energy kept apart.
 *
 * 🚨 THE EXPANSION RULE IS ENFORCED HERE AND IN THE CHECK BELOW, BOTH. This function simply never
 * adds an expansion's current — even if a caller put a number on one — and
 * `storage.expansion-contributes-no-ac` FAILS so the bad data is visible rather than silently
 * discarded. Dropping it quietly would make a wrong catalogue row invisible.
 */
export function summariseStorage(topology: ServiceTopology): StorageSummary {
  const byId = new Map(topology.storage.map(u => [u.id, u]));
  const inverters = topology.storage.filter(u => u.role === 'inverter-unit');
  const expansions = topology.storage.filter(u => u.role === 'energy-expansion');

  const sumCurrent = (units: StorageUnit[]): number | null => {
    const acs = units.filter(u => u.role === 'inverter-unit');
    if (acs.length === 0) return 0;
    if (acs.some(u => !num(u.continuousOutputA))) return null;
    return acs.reduce((n, u) => n + (u.continuousOutputA as number), 0);
  };
  const sumEnergy = (units: StorageUnit[]): number | null => {
    if (units.length === 0) return 0;
    if (units.some(u => !num(u.usableKwh))) return null;
    return units.reduce((n, u) => n + (u.usableKwh as number), 0);
  };

  const byDomain: StorageSummary['byDomain'] = {};
  for (const d of topology.domains) {
    const units = d.storageUnitIds.map(id => byId.get(id)).filter(Boolean) as StorageUnit[];
    byDomain[d.id] = { continuousOutputA: sumCurrent(units), usableKwh: sumEnergy(units) };
  }

  return {
    inverterUnitCount: inverters.length,
    expansionUnitCount: expansions.length,
    totalContinuousOutputA: sumCurrent(topology.storage),
    totalUsableKwh: sumEnergy(topology.storage),
    byDomain,
  };
}

/**
 * The generation landing inside one backup domain, as continuous AC amps.
 *
 * 🚨 ONE READER FOR TWO STORES, AND THE UNITS WIN. `BackupDomain.generationOutputA` is the scalar
 * that existed before generation could be recorded as units; where units exist it is their sum, and
 * the scalar is the derived compatibility projection. Reading both and adding them would double
 * count; reading only the scalar would hide a recorded inverter from the busbar it backfeeds.
 *
 * Returns null when a unit in the domain states no output — unknown, never zero.
 */
export function domainGeneration(
  topology: ServiceTopology, domain: BackupDomain,
): number | null {
  const units = (topology.generation ?? []).filter(g => g.domainId === domain.id);
  if (units.length === 0) return domain.generationOutputA;
  if (units.some(u => !num(u.continuousOutputA))) return null;
  return units.reduce((n, u) => n + (u.continuousOutputA as number), 0);
}

/** Which panelboards a branch feeds, as the graph knows it. */
function panelsOfBranch(topology: ServiceTopology, branch: ServiceBranch): string[] {
  if (branch.panelIds && branch.panelIds.length > 0) return branch.panelIds;
  // A branch that never recorded its panels is still linked to them through its backup domain,
  // which is what the SLD and the busbar checks already read.
  const domain = topology.domains.find(d => d.branchId === branch.id);
  return domain ? [...domain.backedUpPanelIds] : [];
}

export interface ResolvedDemands {
  /**
   * Where these numbers came from. 'load-model' — derived from `topology.loads`. 'recorded' — the
   * demand scalars somebody typed. 'none' — the optional calculation was not provided.
   */
  source: 'load-model' | 'recorded' | 'none';
  /** Aggregate service demand, or null. */
  serviceA: number | null;
  /** Per branch id. A branch whose panels are not modelled is null, not zero. */
  branchA: Record<string, number | null>;
  /** Per domain id: the demand of the panels that domain backs up. */
  domainBackedUpA: Record<string, number | null>;
  /** Panelboards the load model does not cover, when it covers some of them. */
  unmodelledPanelIds: string[];
}

/**
 * 🚨 THE ONE READER OF LOAD. Four numbers, one model, and a single missing-input token behind all
 * of them.
 *
 * Before this existed the engineering asked for `calculatedServiceDemandA`, then each branch's
 * `calculatedDemandA`, then each domain's `backedUpDemandA` — on Ray's two-domain job that is FIVE
 * separate amperage requests for one house, each rendered as its own line on the needs-input
 * screen. He read that as "Engineering: 8 inputs required" and reasonably concluded the product was
 * asking him to survey every circuit twice.
 *
 * With a load model the sums are derivations. Without one, every load-dependent check still reports
 * NOT_EVALUATED — the conclusion is untouched — but they all name `loads.model`, so the screen shows
 * ONE optional calculation that was not provided.
 */
export function resolveDemands(topology: ServiceTopology): ResolvedDemands {
  const branchA: Record<string, number | null> = {};
  const domainBackedUpA: Record<string, number | null> = {};
  const loads = topology.loads ?? null;

  if (loads && loads.byPanel.length > 0) {
    const byPanel = new Map(loads.byPanel.map(l => [l.panelId, l.calculatedDemandA]));
    const sumOf = (ids: readonly string[]): number | null => {
      if (ids.length === 0) return null;
      let total = 0;
      for (const id of ids) {
        const v = byPanel.get(id);
        // 🚨 A PANEL THE MODEL DOES NOT COVER MAKES THE SUM UNKNOWN, NOT SMALLER. Treating a
        // missing entry as zero is how a half-entered load calculation reports a branch as
        // comfortably inside its rating.
        if (!num(v)) return null;
        total += v;
      }
      return total;
    };

    for (const b of topology.branches) branchA[b.id] = sumOf(panelsOfBranch(topology, b));
    for (const d of topology.domains) domainBackedUpA[d.id] = sumOf(d.backedUpPanelIds);

    const other = num(loads.otherDemandA) ? loads.otherDemandA : 0;
    const allPanels = sumOf(topology.panels.map(p => p.id));
    return {
      source: 'load-model',
      serviceA: allPanels === null ? null : allPanels + other,
      branchA,
      domainBackedUpA,
      unmodelledPanelIds: topology.panels.filter(p => !byPanel.has(p.id)).map(p => p.id),
    };
  }

  for (const b of topology.branches) branchA[b.id] = num(b.calculatedDemandA) ? b.calculatedDemandA : null;
  for (const d of topology.domains) {
    domainBackedUpA[d.id] = num(d.backedUpDemandA) ? d.backedUpDemandA : null;
  }
  const serviceA = num(topology.calculatedServiceDemandA) ? topology.calculatedServiceDemandA : null;
  const anyRecorded = serviceA !== null
    || Object.values(branchA).some(v => v !== null)
    || Object.values(domainBackedUpA).some(v => v !== null);
  return {
    source: anyRecorded ? 'recorded' : 'none',
    serviceA,
    branchA,
    domainBackedUpA,
    unmodelledPanelIds: [],
  };
}

export interface AggregationSizing {
  /** Σ continuous AC output of everything feeding this panel. null when any source is unknown. */
  aggregateContinuousA: number | null;
  /** 125% of the above, per the continuous-duty factor the conductor authority already applies. */
  requiredOcpdA: number | null;
  /** The next standard NEC 240.6(A) rating at or above that. */
  standardOcpdA: number | null;
  /** Suggested feeder conductor for that OCPD, from the canonical conductor authority. */
  outputConductorGauge: string | null;
  /** Everything the panel could not be sized against, named. */
  requires: string[];
}

/**
 * Size a DER aggregation panel FROM THE CURRENT THAT FLOWS IN IT.
 *
 * Ray: "Do not infer its rating from `serviceAmps = 400`. Calculate from the actual topology... the
 * two inverter-bearing Powerwall units contribute the manufacturer-governed AC current. Expansion
 * units contribute no independent AC current."
 *
 * 🚨 THE SERVICE RATING IS NOT READ HERE, AT ALL. This function takes the panel and the sources
 * that feed it and nothing else; a 400 A service with 96 A of DER produces a 125 A answer, which is
 * the whole point.
 */
export function sizeAggregationPanel(
  topology: ServiceTopology, panel: DerAggregationPanel,
): AggregationSizing {
  const requires: string[] = [];
  let total: number | null = 0;
  if (panel.inputs.length === 0) {
    requires.push('aggregation.inputs');
    total = null;
  }
  for (const input of panel.inputs) {
    const sources = sourcesForAggregationInput(topology, input);
    if (sources.length === 0) {
      requires.push(`aggregation.input-source:${input.sourceId}`);
      total = null;
      continue;
    }
    for (const s of sources) {
      if (!num(s.continuousOutputA)) { requires.push('der.continuousOutputA'); total = null; continue; }
      if (total !== null) total += s.continuousOutputA as number;
    }
  }

  const required = total === null ? null : total * CONTINUOUS_DUTY_FACTOR;
  const standard = required === null ? null : nextStandardOcpd(required);
  return {
    aggregateContinuousA: total,
    requiredOcpdA: required,
    standardOcpdA: standard,
    outputConductorGauge: standard === null ? null : wireGaugeForOcpd(standard),
    requires: [...new Set(requires)],
  };
}

/**
 * Where the neutral-ground bond belongs, from where the service disconnect actually is.
 *
 * ONE service disconnect upstream of the gateways ⇒ the bond is there, and every gateway and panel
 * downstream is a feeder enclosure with neutral isolated. SEVERAL service disconnects (the grouped
 * arrangement, where each 200 A device is service equipment) ⇒ each is bonded and nothing below is.
 * No service disconnect identified ⇒ nothing is asserted, and the check reports NOT_EVALUATED.
 */
/**
 * The name written on the enclosure, for any node id in the graph.
 *
 * 🚨 NO SURFACE PRINTS AN INTERNAL KEY. "on the path to device-1" on an equipment schedule is a
 * database id handed to an inspector — the same defect as `TO DEVICE-1` on a sheet or "backs msp-1"
 * on a screen, one layer along. Exported so the schedule, the sheet and the screen resolve ids the
 * same way instead of each growing its own lookup.
 */
/**
 * What to call ONE storage unit when there are four of them that say the same thing.
 *
 * 🚨 "TESLA POWERWALL 3" FOUR TIMES IS NOT FOUR NAMES. Four full Powerwalls produce four PV-input
 * checks, four schedule rows and four boxes on a drawing, and every one of them printed the model
 * name alone. Ray's own sketch of the job numbers them — PW3 #1 … #4 — so the position is part of
 * the name.
 *
 * DERIVED FROM ORDER, not stored: numbering by position in `storage` costs no field, survives the
 * round trip because the order does, and cannot drift from the order the BOM and the drawing walk.
 */
/**
 * The service rating as a surface prints it.
 *
 * 🚨 ONE PLACE TO SAY "NOT ESTABLISHED", because the rating became nullable and this repository
 * compiles with `strict: false` — so TypeScript flags NONE of the 38 places that interpolate it.
 * Every one of them would have printed `null A` on a sheet, a schedule or a screen, and the
 * compiler would have said nothing. The fix is a function, not vigilance.
 */
export function serviceRatingLabel(
  t: ServiceTopology, absent = 'NOT ESTABLISHED',
): string {
  return num(t.service.ratedAmps) ? `${t.service.ratedAmps} A` : absent;
}

export function storageUnitLabel(t: ServiceTopology, u: StorageUnit): string {
  const base = u.label ?? u.productId;
  const same = t.storage.filter(x => x.productId === u.productId && x.role === u.role);
  if (same.length <= 1) return base;
  return `${base} #${same.findIndex(x => x.id === u.id) + 1}`;
}

export function topologyNodeLabel(t: ServiceTopology, nodeId: string): string {
  const unit = t.storage.find(u => u.id === nodeId);
  if (unit) return storageUnitLabel(t, unit);
  return t.devices.find(d => d.id === nodeId)?.label
    ?? t.panels.find(p => p.id === nodeId)?.label
    ?? t.branches.find(b => b.id === nodeId)?.label
    ?? t.domains.find(d => d.gateway.id === nodeId)?.gateway.label
    ?? t.domains.find(d => d.id === nodeId)?.label
    ?? (t.generation ?? []).find(g => g.id === nodeId)?.label
    ?? (t.aggregationPanels ?? []).find(a => a.id === nodeId)?.label
    ?? (t.pointsOfInterconnection ?? []).find(x => x.id === nodeId)?.label
    ?? (nodeId === 'service-distribution'
      ? `the ${serviceRatingLabel(t, 'service')} service distribution`
      : nodeId);
}

const nodeName = topologyNodeLabel;

/**
 * What a device placed in line ahead of `nodeId` has to carry.
 *
 * 🚨 IT COMES FROM THE PATH, NOT FROM THE SERVICE. A switch ahead of a 200 A gateway is a 200 A
 * question even on a 400 A service — the same rule that keeps a DER aggregation panel off the
 * service rating, applied to a disconnect.
 *
 * Exported so System Config states THIS number as a disconnect's requirement — never the service
 * rating a newly added device happens to be seeded with.
 */
export function inlineRequirementA(t: ServiceTopology, nodeId: string): number | null {
  const branch = t.branches.find(b => b.id === nodeId);
  if (branch) return branch.ratedAmps;
  const domain = t.domains.find(d => d.gateway.id === nodeId);
  if (domain) {
    if (num(domain.gateway.continuousRatingA)) return domain.gateway.continuousRatingA;
    const fed = t.branches.find(b => b.id === domain.branchId);
    return fed ? fed.ratedAmps : null;
  }
  const panel = t.panels.find(p => p.id === nodeId);
  if (panel) return num(panel.mainBreakerA) ? panel.mainBreakerA
    : num(panel.busbarRatingA) ? panel.busbarRatingA : null;
  const agg = (t.aggregationPanels ?? []).find(a => a.id === nodeId);
  if (agg) return sizeAggregationPanel(t, agg).standardOcpdA;
  if (nodeId === 'service-distribution') return t.service.ratedAmps;
  return null;
}

export function deriveBonding(topology: ServiceTopology): BondingModel {
  const serviceDisconnects = topology.devices.filter(d => d.roles.includes('service-disconnect'));
  const downstream = [
    ...topology.domains.map(d => d.gateway.id),
    ...topology.panels.map(p => p.id),
  ];

  if (serviceDisconnects.length === 0) {
    return {
      bondedAtNodeIds: [],
      neutralIsolatedNodeIds: [],
      basis: 'No device carries the service-disconnect role, so the service point — and therefore '
        + 'the neutral-ground bond location — is undetermined. Nothing downstream can be called a '
        + 'feeder enclosure until it is.',
    };
  }

  if (serviceDisconnects.length === 1) {
    return {
      bondedAtNodeIds: [serviceDisconnects[0].id],
      neutralIsolatedNodeIds: downstream,
      basis: `${serviceDisconnects[0].label} is the single service disconnect, so the neutral-ground `
        + 'bond is made there. Every gateway and panel downstream of it is fed by a FEEDER: bonding '
        + 'screw removed, neutral carried isolated from the equipment grounding conductor.',
    };
  }

  const bonded = serviceDisconnects.map(d => d.id);
  return {
    bondedAtNodeIds: bonded,
    neutralIsolatedNodeIds: downstream.filter(id => !bonded.includes(id)),
    basis: `${serviceDisconnects.length} devices are service disconnects (a grouped service `
      + 'arrangement), so each is service equipment and carries its own bond. Everything downstream '
      + 'of them is a feeder enclosure with neutral isolated.',
  };
}

// ── The checks ──────────────────────────────────────────────────────────────

/**
 * Evaluate a service topology. Pure: no catalogue, no database, no network.
 *
 * Every check answers PASS, FAIL or NOT_EVALUATED, and never the first because an input was absent.
 */
export function evaluateServiceTopology(topology: ServiceTopology): TopologyEvaluation {
  const checks: TopologyCheck[] = [];
  const storageSummary = summariseStorage(topology);
  const bonding = deriveBonding(topology);
  const panelById = new Map(topology.panels.map(p => [p.id, p]));
  const branchById = new Map(topology.branches.map(b => [b.id, b]));
  const storageById = new Map(topology.storage.map(u => [u.id, u]));
  const demands = resolveDemands(topology);

  // ── THE ELECTRICAL SYSTEM ─────────────────────────────────────────────────
  //
  // 🚨 REPRESENTED IS NOT CALCULATED. Nothing in this function reads `service.voltage` or derives a
  // current from a power: every comparison below is between ratings that arrive in amperes, which is
  // the same arithmetic on any system. That includes the NEC 705.12(B) busbar checks — and summing
  // source currents is an upper bound on any one line's current on a three-phase bus, so they stay
  // conservative. What IS residential is narrower, and each piece is reported instead of run:
  //   · `service.calculation-method` — per-phase current from power, balancing single-phase
  //     equipment across three phases and equipment voltage compatibility exist for no other system;
  //   · `load.calculation` and the demands summed from it, when the model is NEC 220.82, which NEC
  //     scopes to 120/240 V or 208Y/120 V THREE-WIRE dwellings (so not a 3φ four-wire 'wye-208');
  //   · `bonding.location`, where the system has no neutral or nobody has said whether it has one.
  // Split phase gets none of these, so a residential evaluation is unchanged.
  const system = servicePhaseInfo(topology.service.phase);
  const notSupported = (
    id: string, scope: string, title: string, why: string, citation?: string,
  ): TopologyCheck => unknown(id, scope, title,
    `CALCULATION METHOD NOT YET SUPPORTED — ${system.label}. ${why}`,
    [`calculation-method:${topology.service.phase}`], citation);
  if (!system.residentialSplitPhase) {
    checks.push(notSupported('service.calculation-method', 'site', 'Service calculation method',
      `${topology.service.phase === 'custom' ? 'This is an electrical system SolarPro has no model '
        + 'for. ' : ''}SolarPro represents this service, and its service engineering is built for `
      + '120/240 V split phase. For this system it does not convert power to per-phase current, '
      + 'does not balance single-phase equipment across the phases, and does not check that the '
      + 'equipment is rated for this voltage and phase, so none of that is claimed. The comparisons '
      + 'below are between ratings stated in amperes and still evaluate; per-unit currents read from '
      + 'the catalogue are the products\' published ratings, not confirmed at this voltage.'));
  }
  const loadMethodOutOfScope = demands.source === 'load-model'
    && topology.loads?.method === 'optional-220-82' && !system.residentialSplitPhase;
  /** A demand comparison whose figure came from a method that does not apply here is not run. */
  const viaLoadMethod = (c: TopologyCheck): TopologyCheck =>
    loadMethodOutOfScope && c.conclusion !== 'NOT_EVALUATED'
      ? notSupported(c.id, c.scope, c.title, 'This figure is summed from an NEC 220.82 optional '
          + 'dwelling calculation, which does not apply to this system.', c.citation)
      : c;

  // ── SERVICE ───────────────────────────────────────────────────────────────

  // 🚨 THE RATING IS AN ORDINARY UNRESOLVED INPUT, NOT A CONDITION OF EXISTING.
  //
  // Ray: "Missing one fact should produce SERVICE RATING REQUIRED — TOPOLOGY PARTIALLY EVALUATED.
  // It should never mean 'pretend the graph doesn't exist.'" Everything below that does not depend
  // on the rating still evaluates — the connection graph, DER isolation coverage, the panel busbar
  // checks, the equipment inventory — and everything that does names this one token.
  const serviceRated = num(topology.service.ratedAmps);
  const branchSum = topology.branches.reduce((n, b) => n + b.ratedAmps, 0);
  if (!serviceRated) {
    const fitNote = topology.branches.length > 0
      ? ` — including whether the ${topology.branches.length} branch(es) totalling `
        + `${branchSum} A fit it`
      : '';
    checks.push(unknown('service.rating', 'site', 'Service rating',
      'The aggregate service rating has not been established, so nothing that depends on it can '
      + `be evaluated${fitNote}. Everything that does not depend on it is evaluated below.`,
      ['service.ratedAmps']));
  } else {
    checks.push(branchSum <= (topology.service.ratedAmps as number)
      ? pass('service.branch-sum', 'site', 'Service branches fit the service',
          `${topology.branches.length} branches totalling ${branchSum} A on a `
          + `${topology.service.ratedAmps} A service.`)
      : fail('service.branch-sum', 'site', 'Service branches fit the service',
          `${topology.branches.length} branches total ${branchSum} A, which exceeds the `
          + `${topology.service.ratedAmps} A service rating. A 400 A service does not make two 200 A `
          + 'panels automatically valid — the split has to be engineered, not assumed.'));
  }

  // ── THE EXISTING SERVICE EQUIPMENT ────────────────────────────────────────
  //
  // 🚨 EXISTING EQUIPMENT IS A THING TO GO AND READ, NOT A THING TO DESIGN. It is reported only
  // when the topology says the assembly is already there — a new service has nothing to verify.
  const existing = topology.service.existingEquipment ?? null;
  if (existing) {
    const missing: string[] = [];
    if (!existing.catalogNumber) missing.push('service.existingEquipment.catalogNumber');
    if (!existing.mainArrangement) missing.push('service.existingEquipment.mainArrangement');
    if (!existing.feederArrangement) missing.push('service.existingEquipment.feederArrangement');
    if (!num(existing.sccrA)) missing.push('service.existingEquipment.sccrA');
    if (!existing.verified) missing.push('service.existingEquipment.verified');
    const name = [existing.manufacturer, existing.catalogNumber].filter(Boolean).join(' ');
    checks.push(missing.length === 0
      ? pass('service.existing-equipment', 'site', 'Existing service equipment',
          `${name || 'The existing service assembly'} is field verified: `
          + `${existing.mainArrangement}; ${existing.feederArrangement}; ${existing.sccrA} A AIC.`)
      : unknown('service.existing-equipment', 'site', 'Existing service equipment',
          `EXISTING ${serviceRatingLabel(topology)} SERVICE EQUIPMENT — CONFIGURATION TO VERIFY. `
          + `${name || 'The assembly'} is already installed, so its internal arrangement and `
          + 'interrupting rating are facts to be read off it rather than chosen. SolarPro does not '
          + 'replace it and does not assume its internals.',
          missing));
  }

  // 🚨 THE DEMAND CHECK NEEDS BOTH NUMBERS. A calculated demand with no service rating to compare
  // it against is not a pass and not a failure — it names the rating, and the load model it already
  // has stops being the thing it is waiting on.
  const svcDemand = demands.serviceA;
  checks.push(viaLoadMethod(!num(svcDemand)
    ? unknown('service.demand', 'site', 'Aggregate service demand',
        'No load calculation has been provided, so the service rating has not been shown to be '
        + 'adequate for the dwelling load. Nothing else in this design depends on it.',
        ['loads.model'], 'NEC 220')
    : !serviceRated
      ? unknown('service.demand', 'site', 'Aggregate service demand',
          `${svcDemand.toFixed(1)} A of calculated demand, and no service rating to compare it `
          + 'against.', ['service.ratedAmps'], 'NEC 220')
      : svcDemand <= (topology.service.ratedAmps as number)
        ? pass('service.demand', 'site', 'Aggregate service demand',
            `${svcDemand.toFixed(1)} A calculated demand against a `
            + `${topology.service.ratedAmps} A service.`, 'NEC 220')
        : fail('service.demand', 'site', 'Aggregate service demand',
            `${svcDemand.toFixed(1)} A calculated demand exceeds the `
            + `${topology.service.ratedAmps} A service.`, 'NEC 220')));

  // ── THE LOAD CALCULATION — OPTIONAL, AND ASKED FOR ONCE ───────────────────
  //
  // 🚨 OPTIONAL DOES NOT MEAN PASS. Ray: "Preserve NOT_EVALUATED as real engineering truth. Do not
  // weaken it... Missing information can never become PASS." What changes is only that this is ONE
  // item, owned by the operator's own choice of whether to run the calculation at all — not five
  // amperage boxes on a needs-input screen, and not a reason to call the design broken.
  if (loadMethodOutOfScope) {
    checks.push(notSupported('load.calculation', 'site', 'Dwelling load calculation',
      'The load model is the NEC 220.82 optional dwelling calculation, which NEC 220.82(A) scopes '
      + 'to a dwelling served by a 120/240 V or 208Y/120 V three-wire set of conductors. SolarPro '
      + 'does not apply it, or pass figures summed from it, on this system.', 'NEC 220.82(A)'));
  } else if (demands.source === 'none') {
    checks.push(unknown('load.calculation', 'site', 'Dwelling load calculation',
      'LOAD CALCULATION NOT PROVIDED. Optional: the topology, the equipment, the disconnects, the '
      + 'single-line diagram, the schedule and the permit drawing are all engineered without it. '
      + 'Supply one and the service, branch and backed-up load checks all resolve from it.',
      ['loads.model'], 'NEC 220'));
  } else if (demands.source === 'recorded') {
    checks.push(pass('load.calculation', 'site', 'Dwelling load calculation',
      'Calculated demand was recorded directly on the service and its branches rather than built '
      + 'from a load model. The numbers are used as supplied.', 'NEC 220'));
  } else if (demands.unmodelledPanelIds.length > 0) {
    const names = demands.unmodelledPanelIds
      .map(id => panelById.get(id)?.label ?? id).join(', ');
    checks.push(unknown('load.calculation', 'site', 'Dwelling load calculation',
      `The load calculation covers some panelboards and not others: ${names} `
      + `${demands.unmodelledPanelIds.length === 1 ? 'has' : 'have'} no calculated demand, so the `
      + 'sums up the service cannot be completed. A partial load model is not a smaller load.',
      ['loads.model'], 'NEC 220'));
  } else {
    const t = topology.loads as LoadModel;
    checks.push(pass('load.calculation', 'site', 'Dwelling load calculation',
      `${METHOD_LABEL[t.method]} — ${t.byPanel.length} panelboard`
      + `${t.byPanel.length === 1 ? '' : 's'}, ${demands.serviceA?.toFixed(1)} A aggregate. `
      + 'The branch and backed-up load figures are sums of this one model, not separate entries.',
      'NEC 220'));
  }

  // ── BRANCHES ──────────────────────────────────────────────────────────────

  for (const b of topology.branches) {
    const scope = `branch:${b.id}`;
    if (num(b.ocpdAmps)) {
      checks.push(b.ocpdAmps <= b.ratedAmps
        ? pass('branch.ocpd', scope, `${b.label} OCPD vs rating`,
            `${b.ocpdAmps} A OCPD on a ${b.ratedAmps} A branch.`)
        : fail('branch.ocpd', scope, `${b.label} OCPD vs rating`,
            `${b.ocpdAmps} A OCPD protects a branch rated ${b.ratedAmps} A.`));
    } else {
      checks.push(unknown('branch.ocpd', scope, `${b.label} OCPD vs rating`,
        'No OCPD rating on this branch.', ['ocpdAmps']));
    }

    // 🚨 SUMMED FROM THE ONE LOAD MODEL, NOT ASKED FOR AGAIN. A branch's demand is the demand of
    // the panels it feeds; the operator is never asked for it as a separate number.
    const bDemand = demands.branchA[b.id] ?? null;
    checks.push(viaLoadMethod(num(bDemand)
      ? (bDemand <= b.ratedAmps
          ? pass('branch.demand', scope, `${b.label} calculated demand`,
              `${bDemand.toFixed(1)} A on a ${b.ratedAmps} A branch`
              + `${demands.source === 'load-model' ? ', summed from the load model' : ''}.`,
              'NEC 220')
          : fail('branch.demand', scope, `${b.label} calculated demand`,
              `${bDemand.toFixed(1)} A exceeds the ${b.ratedAmps} A branch.`, 'NEC 220'))
      : unknown('branch.demand', scope, `${b.label} calculated demand`,
          'No load calculation covers the panelboards on this branch, so its feeder has not been '
          + 'shown to be adequate for the load. An aggregate service figure does not establish an '
          + 'individual branch.',
          ['loads.model'], 'NEC 220')));
  }

  // ── DOMAINS ───────────────────────────────────────────────────────────────

  for (const d of topology.domains) {
    const scope = `domain:${d.id}`;
    const branch = branchById.get(d.branchId);

    // Gateway pass-through: the branch cannot ask more of the gateway than it is rated for.
    if (!branch) {
      checks.push(fail('domain.branch-link', scope, `${d.label} is fed by a branch`,
        `This domain names branch '${d.branchId}', which is not in the topology.`));
    } else if (num(d.gateway.continuousRatingA)) {
      checks.push(branch.ratedAmps <= d.gateway.continuousRatingA
        ? pass('domain.gateway-passthrough', scope, `${d.label} gateway pass-through`,
            `${branch.label} is ${branch.ratedAmps} A and ${d.gateway.label} is rated `
            + `${d.gateway.continuousRatingA} A continuous.`)
        : fail('domain.gateway-passthrough', scope, `${d.label} gateway pass-through`,
            `${branch.label} is ${branch.ratedAmps} A but ${d.gateway.label} is rated only `
            + `${d.gateway.continuousRatingA} A continuous. This is the defect a 400 A service `
            + 'collapsed onto one gateway produces.'));
    } else {
      checks.push(unknown('domain.gateway-passthrough', scope, `${d.label} gateway pass-through`,
        `${d.gateway.label} has no continuous rating resolved from the catalogue.`,
        ['gateway.continuousRatingA']));
    }

    // Panel rating vs the branch feeding it.
    for (const pid of d.backedUpPanelIds) {
      const p = panelById.get(pid);
      if (!p) {
        checks.push(fail('domain.panel-link', scope, `${d.label} panels exist`,
          `This domain names panel '${pid}', which is not in the topology.`));
        continue;
      }
      if (branch && num(p.busbarRatingA)) {
        checks.push(branch.ratedAmps <= p.busbarRatingA
          ? pass('domain.panel-rating', scope, `${p.label} rating vs its feeder`,
              `${p.label} busbar is ${p.busbarRatingA} A, fed by ${branch.ratedAmps} A.`)
          : fail('domain.panel-rating', scope, `${p.label} rating vs its feeder`,
              `${p.label} busbar is ${p.busbarRatingA} A but is fed by ${branch.ratedAmps} A.`));
      } else if (!num(p.busbarRatingA)) {
        checks.push(unknown('domain.panel-rating', scope, `${p.label} rating vs its feeder`,
          `${p.label} has no busbar rating.`, ['panel.busbarRatingA']));
      }

      // 705.12(B) per domain — each gateway is its own point of connection.
      //
      // Ampere arithmetic on the busbar and the sources, so it is evaluated on every electrical
      // system; see THE ELECTRICAL SYSTEM at the top of this function for why that stays honest.
      //
      // 🚨 THE GENERATION IN THIS DOMAIN IS READ FROM THE UNITS WHERE THERE ARE UNITS, AND FROM THE
      // SCALAR ONLY WHERE THERE ARE NOT. `generationOutputA` predates `topology.generation`; left as
      // the sole reader it would be a lid on a real array — a PV inverter recorded as a unit would
      // be invisible to the busbar it backfeeds while being visible to the aggregation sizing and
      // the isolation traversal, and an operator who filled in both would be counted twice.
      const domainStorage = storageSummary.byDomain[d.id];
      const domainGenerationA = domainGeneration(topology, d);
      const backfeedA = num(domainStorage?.continuousOutputA) && num(domainGenerationA)
        ? domainStorage.continuousOutputA + domainGenerationA
        : null;

      // 🚨 THE BUSBAR RULE ONLY APPLIES IF THE BREAKER IS IN THE BUSBAR.
      //
      // Storage that leaves the domain for a DER aggregation panel is not on THIS busbar at all.
      // That is a real PASS for this panel — nothing is connected to it to limit — and the
      // governing calculation moves to the aggregation panel's own check. Any OTHER generation
      // inside the domain is still on the busbar and is still checked.
      if (d.storageConnection === 'der-aggregation-panel') {
        // ═══════════════════════════════════════════════════════════════════
        // 🚨 AN ARRANGEMENT THAT NAMES A PANEL MUST HAVE THAT PANEL.
        //
        // This branch exists because the storage left the domain for a DER aggregation panel, and it
        // reports a PASS on the busbar for exactly that reason — nothing is connected to it. If no
        // such panel is recorded, that PASS is being granted for a device that does not exist, and
        // the storage lands NOWHERE: the busbar check waves it through, the aggregation check has no
        // panel to examine, and the drawing has nothing to draw.
        //
        // Reachable in production: the wizard's arrangement question creates the panels with the
        // answer, but `ServiceNodeInspector` and `ServiceTopologyPanel` both let an operator change
        // `storageConnection` on its own. Choosing this arrangement there left the graph claiming a
        // landing it does not have, silently.
        // ═══════════════════════════════════════════════════════════════════
        const panelsForThisDomain = (topology.aggregationPanels ?? [])
          .filter(a => a.domainId === d.id || a.domainId == null);
        if (panelsForThisDomain.length === 0) {
          checks.push(fail('aggregation.landing', scope, `${d.label} storage landing`,
            `${d.label} is recorded as landing its storage in a DER aggregation panel, and no such `
            + 'panel exists on this design. The storage has nowhere to land: the busbar allowance is '
            + 'being waived for a panel that is not there.',
            'NEC 705.12 — the governing busbar is the one the breaker is actually in'));
        }

        const otherGenerationA = num(d.generationOutputA) ? d.generationOutputA : null;
        if (otherGenerationA === 0) {
          checks.push(pass('domain.busbar-705-12', scope, `${p.label} 120% busbar allowance`,
            `No source is connected to ${p.label}'s busbar: the storage in ${d.label} lands in a `
            + 'DER aggregation panel and interconnects there.', 'NEC 705.12(B)'));
        } else if (otherGenerationA !== null && num(p.busbarRatingA) && num(p.mainBreakerA)) {
          const allowed = maxLoadSideBackfeedA(p.busbarRatingA, p.mainBreakerA);
          checks.push(otherGenerationA <= allowed
            ? pass('domain.busbar-705-12', scope, `${p.label} 120% busbar allowance`,
                `${otherGenerationA.toFixed(1)} A of generation against ${allowed.toFixed(1)} A `
                + 'allowed; the storage is aggregated elsewhere.', 'NEC 705.12(B)')
            : fail('domain.busbar-705-12', scope, `${p.label} 120% busbar allowance`,
                `${otherGenerationA.toFixed(1)} A of generation exceeds the ${allowed.toFixed(1)} A `
                + 'allowed on this busbar.', 'NEC 705.12(B)'));
        } else {
          const missing: string[] = [];
          if (!num(p.busbarRatingA)) missing.push('panel.busbarRatingA');
          if (!num(p.mainBreakerA)) missing.push('panel.mainBreakerA');
          if (otherGenerationA === null) missing.push('domain.generationOutputA');
          checks.push(unknown('domain.busbar-705-12', scope, `${p.label} 120% busbar allowance`,
            'The storage in this domain is aggregated elsewhere, but the generation that remains '
            + 'on this busbar has not been established.', missing, 'NEC 705.12(B)'));
        }
        continue;
      }
      if (d.storageConnection === 'gateway-panelboard') {
        checks.push(unknown('domain.busbar-705-12', scope, `${p.label} 120% busbar allowance`,
          `The storage in ${d.label} lands in ${d.gateway.label}'s own panelboard, not on `
          + `${p.label}'s busbar, so NEC 705.12(B) is not the governing limit. The governing limit `
          + 'is the gateway manufacturer\'s, and SolarPro does not hold it — it will not substitute '
          + 'the panel rule for a rule it has not read.',
          [`manufacturer-limit:${d.gateway.productId}`], 'NEC 705.12(B)'));
        continue;
      }
      if (d.storageConnection !== 'backed-up-panel-busbar') {
        checks.push(unknown('domain.busbar-705-12', scope, `${p.label} 120% busbar allowance`,
          `Where the storage in ${d.label} connects has not been established — the gateway's own `
          + "panelboard and the panel's busbar are governed by different rules.",
          ['domain.storageConnection'], 'NEC 705.12(B)'));
        continue;
      }

      if (num(p.busbarRatingA) && num(p.mainBreakerA) && num(backfeedA)) {
        const allowed = maxLoadSideBackfeedA(p.busbarRatingA, p.mainBreakerA);
        checks.push(backfeedA <= allowed
          ? pass('domain.busbar-705-12', scope, `${p.label} 120% busbar allowance`,
              `${backfeedA.toFixed(1)} A of backfeed against ${allowed.toFixed(1)} A allowed `
              + `(${p.busbarRatingA} A bus, ${p.mainBreakerA} A main).`, 'NEC 705.12(B)')
          : fail('domain.busbar-705-12', scope, `${p.label} 120% busbar allowance`,
              `${backfeedA.toFixed(1)} A of backfeed exceeds the ${allowed.toFixed(1)} A allowed on `
              + `a ${p.busbarRatingA} A bus with a ${p.mainBreakerA} A main.`, 'NEC 705.12(B)'));
      } else {
        const missing: string[] = [];
        if (!num(p.busbarRatingA)) missing.push('panel.busbarRatingA');
        if (!num(p.mainBreakerA)) missing.push('panel.mainBreakerA');
        if (!num(backfeedA)) missing.push('domain.generationOutputA', 'storage.continuousOutputA');
        checks.push(unknown('domain.busbar-705-12', scope, `${p.label} 120% busbar allowance`,
          'The busbar allowance cannot be computed for this domain.', missing, 'NEC 705.12(B)'));
      }
    }

    const dDemand = demands.domainBackedUpA[d.id] ?? null;
    checks.push(viaLoadMethod(num(dDemand)
      ? pass('domain.backed-up-load', scope, `${d.label} backed-up load`,
          `${dDemand.toFixed(1)} A of backed-up load`
          + `${demands.source === 'load-model'
              ? `, summed from the load model over ${d.backedUpPanelIds.length} panelboard`
                + `${d.backedUpPanelIds.length === 1 ? '' : 's'}` : ' recorded'}.`)
      : unknown('domain.backed-up-load', scope, `${d.label} backed-up load`,
          'No load calculation covers the panelboards this domain backs up, so the load the island '
          + 'must carry is not established.', ['loads.model'])));
  }

  // ── STORAGE ───────────────────────────────────────────────────────────────

  const badExpansions = topology.storage.filter(
    u => u.role === 'energy-expansion' && (num(u.continuousOutputA) && u.continuousOutputA > 0 || num(u.ocpdA)));
  checks.push(badExpansions.length === 0
    ? pass('storage.expansion-contributes-no-ac', 'site', 'Expansion units add energy, not power',
        `${storageSummary.expansionUnitCount} expansion unit(s) carry no AC output and no OCPD of `
        + 'their own; they are DC extensions of their host inverter unit.')
    : fail('storage.expansion-contributes-no-ac', 'site', 'Expansion units add energy, not power',
        `${badExpansions.map(u => u.id).join(', ')} is declared an energy expansion but carries an `
        + 'AC output current or its own OCPD. An expansion is a DC battery extension on the '
        + 'manufacturer\'s harness — it is not an independent AC source and does not receive its '
        + 'own gateway breaker.'));

  const orphanExpansions = topology.storage.filter(
    u => u.role === 'energy-expansion'
      && (!u.attachedToUnitId || storageById.get(u.attachedToUnitId)?.role !== 'inverter-unit'));
  if (orphanExpansions.length > 0) {
    checks.push(fail('storage.expansion-has-a-host', 'site', 'Every expansion extends an inverter unit',
      `${orphanExpansions.map(u => u.id).join(', ')} is not attached to an inverter unit. An `
      + 'expansion connects to its host through the manufacturer\'s expansion harness; it cannot '
      + 'stand alone.'));
  }

  checks.push(num(storageSummary.totalUsableKwh)
    ? pass('storage.aggregate-energy', 'site', 'Aggregate site storage energy',
        `${storageSummary.totalUsableKwh.toFixed(1)} kWh across `
        + `${storageSummary.inverterUnitCount} inverter unit(s) and `
        + `${storageSummary.expansionUnitCount} expansion(s).`)
    : unknown('storage.aggregate-energy', 'site', 'Aggregate site storage energy',
        'At least one storage unit has no usable energy figure.', ['storage.usableKwh']));

  // ── FAULT CURRENT / SCCR ──────────────────────────────────────────────────

  const afc = topology.service.availableFaultCurrentA;
  const rated: Array<{ id: string; label: string; sccrA: number | null }> = [
    ...topology.devices.map(d => ({ id: d.id, label: d.label, sccrA: d.sccrA })),
    ...topology.domains.map(d => ({ id: d.gateway.id, label: d.gateway.label, sccrA: d.gateway.sccrA })),
    ...topology.panels.map(p => ({ id: p.id, label: p.label, sccrA: p.sccrA })),
  ];
  if (!num(afc)) {
    checks.push(unknown('sccr.chain', 'site', 'Fault-current compatibility',
      'The available fault current at the service is not established, so no interrupting rating in '
      + 'the chain has been shown to be adequate.',
      ['service.availableFaultCurrentA'], 'NEC 110.9 / 110.24'));
  } else {
    const missing = rated.filter(r => !num(r.sccrA));
    const under = rated.filter(r => num(r.sccrA) && (r.sccrA as number) < afc);
    if (under.length > 0) {
      checks.push(fail('sccr.chain', 'site', 'Fault-current compatibility',
        `${under.map(r => `${r.label} (${r.sccrA} A)`).join(', ')} below the ${afc} A available at `
        + 'the service.', 'NEC 110.9 / 110.24'));
    } else if (missing.length > 0) {
      checks.push(unknown('sccr.chain', 'site', 'Fault-current compatibility',
        `${missing.map(r => r.label).join(', ')} state no interrupting rating, so the chain is `
        + 'incomplete. Note that a gateway\'s supported rating depends on the main breaker selected '
        + 'in it — a breaker amperage alone does not establish it.',
        missing.map(r => `sccr:${r.id}`), 'NEC 110.9 / 110.24'));
    } else {
      checks.push(pass('sccr.chain', 'site', 'Fault-current compatibility',
        `Every device in the chain is rated at or above the ${afc} A available at the service.`,
        'NEC 110.9 / 110.24'));
    }
  }

  // ── BONDING ───────────────────────────────────────────────────────────────

  // 🚨 THE BONDING MODEL ASSUMES A NEUTRAL. It bonds neutral to ground at the service disconnect
  // and isolates the neutral downstream; a 3-wire delta has no neutral, so applying it there would
  // pass a bond on a conductor that does not exist.
  if (system.hasNeutral !== true) {
    checks.push(notSupported('bonding.location', 'site', 'Neutral-ground bond location',
      `${system.hasNeutral === false
        ? 'This system has no neutral conductor.'
        : 'Whether this system has a neutral conductor is not recorded.'} SolarPro's bonding model `
      + 'places a neutral-to-ground bond at the service disconnect and carries an isolated neutral '
      + 'downstream, so where this system\'s grounded conductor, if any, is bonded is not '
      + 'established here.', 'NEC 250.24 / 250.142'));
  } else if (bonding.bondedAtNodeIds.length === 0) {
    checks.push(unknown('bonding.location', 'site', 'Neutral-ground bond location',
      bonding.basis, ['device.role:service-disconnect'], 'NEC 250.24 / 250.142'));
  } else {
    const overlap = bonding.bondedAtNodeIds.filter(id => bonding.neutralIsolatedNodeIds.includes(id));
    checks.push(overlap.length === 0
      ? pass('bonding.location', 'site', 'Neutral-ground bond location', bonding.basis,
          'NEC 250.24 / 250.142')
      : fail('bonding.location', 'site', 'Neutral-ground bond location',
          `${overlap.join(', ')} is both bonded and required to be neutral-isolated — a duplicated `
          + 'neutral-ground bond.', 'NEC 250.24 / 250.142'));
  }

  // ── ROLE SEPARATION ───────────────────────────────────────────────────────

  for (const dev of topology.devices) {
    if (dev.roles.length > 1 && !dev.roleCombinationAuthority) {
      checks.push(fail('device.role-combination', 'site', `${dev.label} role combination`,
        `${dev.label} is declared as ${dev.roles.join(' + ')} with no authority naming why one `
        + 'piece of hardware may perform both.'));
    }

    // ── IN-LINE PLACEMENT: IS IT BIG ENOUGH FOR WHAT IT IS IN LINE WITH? ────
    //
    // A disconnect in a 200 A path has to carry the path. The requirement comes from the node the
    // device is in line on — which is precisely the thing `inlineOnNodeId` records.
    if (dev.inlineOnNodeId) {
      const required = inlineRequirementA(topology, dev.inlineOnNodeId);
      const where = nodeName(topology, dev.inlineOnNodeId);
      if (required === null) {
        checks.push(unknown('device.inline-rating', 'site', `${dev.label} rating vs its path`,
          `${dev.label} is in line ahead of ${where}, whose continuous rating is not established, `
          + 'so the device has not been shown to carry the path it interrupts.',
          ['device.inlineOnNodeId']));
      } else if (!num(dev.ratedAmps)) {
        checks.push(unknown('device.inline-rating', 'site', `${dev.label} rating vs its path`,
          `${dev.label} is in line ahead of ${where}, which needs at least ${required} A, and the `
          + 'device has no rating.', ['device.ratedAmps']));
      } else {
        checks.push(dev.ratedAmps >= required
          ? pass('device.inline-rating', 'site', `${dev.label} rating vs its path`,
              `${dev.ratedAmps} A device in line ahead of ${where}, which carries ${required} A.`)
          : fail('device.inline-rating', 'site', `${dev.label} rating vs its path`,
              `${dev.ratedAmps} A device in line ahead of ${where}, which carries ${required} A.`));
      }
    }

    // ── THE ENGINEERED REQUIREMENT IS NOT A PURCHASABLE PART ────────────────
    //
    // Ray: "engineering requirement → actual catalog equipment selection → verify selected
    // equipment satisfies requirement → BOM. Unknown catalog/equipment detail remains unresolved."
    // So an un-selected device is reported as the SELECTION being open, with the requirement stated
    // — never as a part SolarPro chose on the operator's behalf.
    if (!dev.productId) {
      checks.push(unknown('device.selection', 'site', `${dev.label} equipment selection`,
        `The requirement is established (${num(dev.ratedAmps) ? `${dev.ratedAmps} A` : 'rating not '
        + 'yet established'}${num(dev.sccrA) ? `, ${dev.sccrA} A interrupting` : ''}) and no `
        + 'catalogue part has been selected to meet it. A calculated minimum rating is not a '
        + 'purchase: nothing is ordered and nothing is drawn as a specific device until one is '
        + 'chosen.', ['device.productId']));
    }
  }

  // ── INTERCONNECTION ───────────────────────────────────────────────────────

  const ic = topology.interconnection;
  if (ic.meterCollarSelected) {
    checks.push(ic.meterCollarPermitted === true
      ? pass('interconnection.meter-collar', 'site', 'Meter-collar interconnection permitted',
          'A meter-collar interconnection is selected and permitted for this project.')
      : ic.meterCollarPermitted === false
        ? fail('interconnection.meter-collar', 'site', 'Meter-collar interconnection permitted',
            'A meter-collar / Backup Switch interconnection is selected, and it is not permitted '
            + 'for this project. A Gateway-based, non-meter-collar topology is required.')
        : unknown('interconnection.meter-collar', 'site', 'Meter-collar interconnection permitted',
            'A meter-collar interconnection is selected but whether the utility permits it here has '
            + 'not been resolved.', ['interconnection.meterCollarPermitted']));
  }

  if (ic.externalDerIsolationRequired === null || ic.externalDerIsolationRequired === undefined) {
    checks.push(unknown('interconnection.der-isolation', 'site', 'Utility DER isolation device',
      'Whether this utility requires an external DER isolation device for this service has not been '
      + 'resolved for this jurisdiction.', ['interconnection.externalDerIsolationRequired']));
  } else if (ic.externalDerIsolationRequired) {
    const isolators = topology.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
    if (isolators.length === 0) {
      checks.push(fail('interconnection.der-isolation', 'site', 'Utility DER isolation device',
        `${ic.externalDerIsolationBasis ?? 'This utility'} requires an external DER isolation `
        + 'device, and no device in this topology carries that role.'));
    } else {
      const defects: string[] = [];
      for (const d of isolators) {
        if (d.lockableOpen !== true) defects.push(`${d.label} is not stated lockable open`);
        if (d.visibleOpen !== true) defects.push(`${d.label} is not stated visible-open / manual load-break`);
        if (num(afc) && num(d.sccrA) && (d.sccrA as number) < afc) {
          defects.push(`${d.label} SCCR ${d.sccrA} A is below the ${afc} A available`);
        }
      }
      const unresolved = isolators.some(d => d.lockableOpen === null || d.visibleOpen === null);
      checks.push(defects.length > 0
        ? fail('interconnection.der-isolation', 'site', 'Utility DER isolation device',
            defects.join('; ') + '.')
        : unresolved
          ? unknown('interconnection.der-isolation', 'site', 'Utility DER isolation device',
              'The isolation device is present but its operating characteristics are not stated.',
              ['device.lockableOpen', 'device.visibleOpen'])
          : pass('interconnection.der-isolation', 'site', 'Utility DER isolation device',
              `${isolators.map(d => d.label).join(', ')} isolates all on-site DER from the utility, `
              + 'lockable open with a visible open.'));
    }
  }

  // ── HOW THE DER ACTUALLY REACHES THE SERVICE ──────────────────────────────
  //
  // 🚨 A DESIGN DECISION IS ITS OWN KIND OF MISSING INPUT. It is not a number the utility owes us
  // and not a document a manufacturer owes us — it is a choice the designer has not made, and the
  // drawing must not pick one to look finished.
  const sources = derSources(topology);
  if (sources.length > 0) {
    checks.push(ic.derArrangement
      ? pass('interconnection.arrangement', 'site', 'DER interconnection arrangement',
          ic.derArrangement === 'common-aggregation'
            ? 'The DER branches aggregate in an AC generation panel before a common point of '
              + 'interconnection.'
            : ic.derArrangement === 'independent-branch'
              ? 'Each backup domain interconnects through its own governed service branch '
                + 'arrangement.'
              : 'A custom engineered interconnection arrangement has been recorded.')
      : unknown('interconnection.arrangement', 'site', 'DER interconnection arrangement',
          `This site has ${sources.length} DER source(s) and no interconnection arrangement has `
          + 'been selected, so how they reach the service is not established.',
          ['interconnection.derArrangement']));
  }

  // ── DER ISOLATION COVERAGE ────────────────────────────────────────────────
  //
  // Ray: "the SLD must make it obvious whether opening the modeled DER isolation device actually
  // disconnects every DER source from the utility."
  //
  // Only asked where the utility requires an external isolation device, or where nobody has
  // resolved whether it does. A utility that explicitly does not require one is answered by the
  // existing `interconnection.der-isolation` check; asking coverage of a device that is not
  // required would invent a requirement.
  if (sources.length > 0 && ic.externalDerIsolationRequired !== false) {
    const graph = buildConnectionGraph(topology);
    const coverage = derIsolationCoverage(topology, graph);
    checks.push(coverage.conclusion === 'PASS'
      ? pass('interconnection.der-isolation-coverage', 'site', 'DER isolation coverage',
          coverage.detail, 'NEC 705.20 / utility interconnection agreement')
      : coverage.conclusion === 'FAIL'
        ? fail('interconnection.der-isolation-coverage', 'site', 'DER isolation coverage',
            coverage.detail, 'NEC 705.20 / utility interconnection agreement')
        : unknown('interconnection.der-isolation-coverage', 'site', 'DER isolation coverage',
            coverage.detail, coverage.requires,
            'NEC 705.20 / utility interconnection agreement'));

    // 🚨 COVERAGE IS A FACT ABOUT THE GRAPH. ACCEPTANCE IS A RULING, AND IT IS SEPARATE.
    //
    // Two switches that provably cut every path is a complete engineering answer and is NOT the
    // utility agreeing to two switches. Ray: "Utility/AHJ acceptance of the two-switch arrangement
    // remains something to verify... Do not claim approval that SolarPro does not have." Reported
    // wherever an isolation device is required, whatever coverage concluded, so a green traversal
    // can never be read as a green submission.
    const isolators = topology.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
    if (isolators.length > 0) {
      const how = isolators.length === 1
        ? `a single ${isolators[0].ratedAmps ?? '—'} A device`
        : `${isolators.length} separate devices `
          + `(${isolators.map(d => `${d.ratedAmps ?? '—'} A`).join(', ')})`;
      checks.push(ic.isolationArrangementAccepted === true
        ? pass('interconnection.isolation-accepted', 'site', 'Utility acceptance of the isolation arrangement',
            `The utility has accepted ${how}. ${ic.isolationArrangementBasis ?? ''}`.trim())
        : ic.isolationArrangementAccepted === false
          ? fail('interconnection.isolation-accepted', 'site', 'Utility acceptance of the isolation arrangement',
              `The utility has NOT accepted ${how}. `
              + `${ic.isolationArrangementBasis ?? 'The arrangement must be changed or re-submitted.'}`)
          : unknown('interconnection.isolation-accepted', 'site',
              'Utility acceptance of the isolation arrangement',
              `This design isolates its DER with ${how}. Whether the utility and the AHJ accept `
              + 'that arrangement is a ruling neither the topology nor the code text establishes, '
              + 'and SolarPro does not claim an approval it does not hold.',
              ['interconnection.isolationArrangementAccepted']));
    }
  }

  // ── POINTS OF INTERCONNECTION ─────────────────────────────────────────────
  for (const poi of topology.pointsOfInterconnection ?? []) {
    const scope = `poi:${poi.id}`;
    const article = governingArticleFor(poi.relationship);
    if (poi.relationship === 'meter-collar' && ic.meterCollarPermitted === false) {
      checks.push(fail('poi.relationship', scope, `${poi.label} arrangement`,
        'A meter-collar point of interconnection is recorded on a project where a meter-collar '
        + 'interconnection is not permitted.'));
    } else if (poi.relationship === 'unresolved') {
      checks.push(unknown('poi.relationship', scope, `${poi.label} arrangement`,
        'INTERCONNECTION ARRANGEMENT REQUIRED — which governed relationship this point of '
        + 'interconnection has (load-side busbar, feeder tap, supply-side, manufacturer-integrated) '
        + 'has not been decided, and it is what selects the code section that governs it.',
        ['poi.relationship']));
    } else if (!poi.connectedToNodeId) {
      checks.push(unknown('poi.relationship', scope, `${poi.label} arrangement`,
        'INTERCONNECTION ARRANGEMENT REQUIRED — the point of interconnection does not state where '
        + 'on the premises wiring it lands, so nothing downstream may assume one.',
        ['poi.connectedToNodeId'], article ?? undefined));
    } else {
      checks.push(pass('poi.relationship', scope, `${poi.label} arrangement`,
        `${poi.label} connects the DER to ${poi.connectedToNodeId} as a `
        + `${poi.relationship.replace(/-/g, ' ')} arrangement.`, article ?? undefined));
    }

    // A supply-side arrangement is a different scope of work, and SolarPro does not yet evaluate
    // the tap conductors and the OCPD that go with it. It says so rather than passing quietly.
    if (poi.relationship === 'supply-side' || poi.relationship === 'aggregation-to-supply-side') {
      checks.push(unknown('poi.supply-side-conductors', scope,
        `${poi.label} supply-side tap conductors`,
        'A supply-side connection is governed by the tap conductor, OCPD and disconnect '
        + 'requirements of NEC 705.11, which this topology does not yet size.',
        ['poi.supplySideTapConductors'], 'NEC 705.11'));
    }
  }

  // ── DER AGGREGATION PANELS ────────────────────────────────────────────────
  //
  // 🚨 SIZED FROM THE CURRENT THAT FLOWS IN IT, NEVER FROM THE SERVICE RATING. Ray: "It is not
  // automatically 400 A because the utility service is 400 A."
  for (const panel of topology.aggregationPanels ?? []) {
    const scope = `aggregation:${panel.id}`;
    const sizing = sizeAggregationPanel(topology, panel);

    if (sizing.standardOcpdA === null) {
      checks.push(unknown('aggregation.output-ocpd', scope, `${panel.label} output OCPD`,
        'The aggregated DER current is not established, so the panel\'s output OCPD and feeder '
        + 'cannot be sized.', sizing.requires.length ? sizing.requires : ['der.continuousOutputA'],
        'NEC 705.60 / 690.8(A)'));
    } else if (!num(panel.outputOcpdA)) {
      checks.push(unknown('aggregation.output-ocpd', scope, `${panel.label} output OCPD`,
        `${sizing.aggregateContinuousA} A of aggregated DER at 125% needs at least `
        + `${sizing.standardOcpdA} A; no output OCPD is recorded on this panel.`,
        ['aggregation.outputOcpdA'], 'NEC 705.60 / 690.8(A)'));
    } else {
      checks.push(panel.outputOcpdA >= (sizing.standardOcpdA as number)
        ? pass('aggregation.output-ocpd', scope, `${panel.label} output OCPD`,
            `${panel.outputOcpdA} A protects ${sizing.aggregateContinuousA} A of aggregated DER `
            + `(125% = ${(sizing.requiredOcpdA as number).toFixed(1)} A).`,
            'NEC 705.60 / 690.8(A)')
        : fail('aggregation.output-ocpd', scope, `${panel.label} output OCPD`,
            `${panel.outputOcpdA} A is below the ${sizing.standardOcpdA} A required for `
            + `${sizing.aggregateContinuousA} A of aggregated DER at 125%.`,
            'NEC 705.60 / 690.8(A)'));
    }

    // WHICH KIND OF PANEL IS IT? The governing busbar calculation is different, so an unstated
    // answer is unevaluated rather than assumed to be the easier one.
    if (panel.carriesPremisesLoad === null || panel.carriesPremisesLoad === undefined) {
      checks.push(unknown('aggregation.busbar', scope, `${panel.label} busbar`,
        'Whether this panel also carries premises load has not been stated. A DER-only generation '
        + 'panel and a load centre with DER backfed into it are governed by different '
        + 'calculations.', ['aggregation.carriesPremisesLoad'], 'NEC 705.12(B)'));
    } else if (panel.carriesPremisesLoad) {
      if (num(panel.busbarRatingA) && num(panel.mainBreakerA) && num(sizing.aggregateContinuousA)) {
        const allowed = maxLoadSideBackfeedA(panel.busbarRatingA, panel.mainBreakerA);
        checks.push(sizing.aggregateContinuousA <= allowed
          ? pass('aggregation.busbar', scope, `${panel.label} 120% busbar allowance`,
              `${sizing.aggregateContinuousA} A of DER against ${allowed.toFixed(1)} A allowed `
              + `(${panel.busbarRatingA} A bus, ${panel.mainBreakerA} A main).`, 'NEC 705.12(B)')
          : fail('aggregation.busbar', scope, `${panel.label} 120% busbar allowance`,
              `${sizing.aggregateContinuousA} A of DER exceeds the ${allowed.toFixed(1)} A allowed `
              + `on a ${panel.busbarRatingA} A bus with a ${panel.mainBreakerA} A main.`,
              'NEC 705.12(B)'));
      } else {
        const missing: string[] = [];
        if (!num(panel.busbarRatingA)) missing.push('aggregation.busbarRatingA');
        if (!num(panel.mainBreakerA)) missing.push('aggregation.mainBreakerA');
        if (!num(sizing.aggregateContinuousA)) missing.push('der.continuousOutputA');
        checks.push(unknown('aggregation.busbar', scope, `${panel.label} 120% busbar allowance`,
          'This panel carries premises load, so the 120% busbar allowance governs and it cannot '
          + 'be computed yet.', missing, 'NEC 705.12(B)'));
      }
    } else if (num(panel.busbarRatingA) && sizing.standardOcpdA !== null) {
      checks.push(panel.busbarRatingA >= sizing.standardOcpdA
        ? pass('aggregation.busbar', scope, `${panel.label} busbar`,
            `${panel.busbarRatingA} A busbar carries the ${sizing.standardOcpdA} A of aggregated `
            + 'DER output this panel is built for; it serves no premises load.')
        : fail('aggregation.busbar', scope, `${panel.label} busbar`,
            `${panel.busbarRatingA} A busbar is below the ${sizing.standardOcpdA} A the aggregated `
            + 'DER output requires.'));
    } else {
      checks.push(unknown('aggregation.busbar', scope, `${panel.label} busbar`,
        'The busbar rating of this DER generation panel is not established.',
        num(panel.busbarRatingA) ? ['der.continuousOutputA'] : ['aggregation.busbarRatingA']));
    }

    // 🚨 A COMMON AGGREGATION POINT IS NOT PERMISSION TO PARALLEL TWO ISLANDS.
    const islandTaps = panel.inputs.filter(i => i.tap === 'backed-up-busbar');
    const islandDomains = new Set(islandTaps.map(i => {
      const direct = sources.find(s => s.id === i.sourceId);
      return direct?.domainId ?? i.sourceId;
    }).filter(Boolean) as string[]);
    if (islandDomains.size > 1) {
      checks.push(fail('aggregation.island-integrity', scope, `${panel.label} island integrity`,
        `${panel.label} takes circuits from the backed-up bus of ${islandDomains.size} separate `
        + 'backup domains. That parallels two islands through one bus and defeats the independent '
        + 'islanding each controller provides. Aggregate the grid-side circuits, not the '
        + 'backed-up ones.'));
    } else {
      checks.push(pass('aggregation.island-integrity', scope, `${panel.label} island integrity`,
        islandTaps.length === 0
          ? `${panel.label} takes no circuit from a backed-up bus, so no backup domain's island is `
            + 'paralleled with another.'
          : `${panel.label} takes backed-up circuits from one domain only.`));
    }

    // SCCR, on the same terms as every other device in the chain.
    if (num(afc) && num(panel.sccrA) && (panel.sccrA as number) < afc) {
      checks.push(fail('aggregation.sccr', scope, `${panel.label} interrupting rating`,
        `${panel.sccrA} A SCCR is below the ${afc} A available at the service.`,
        'NEC 110.9 / 110.24'));
    } else if (!num(panel.sccrA)) {
      checks.push(unknown('aggregation.sccr', scope, `${panel.label} interrupting rating`,
        `${panel.label} states no interrupting rating.`, [`sccr:${panel.id}`],
        'NEC 110.9 / 110.24'));
    }

    // WHAT IT LANDS IN. A generation panel whose output goes into a manufacturer's listed
    // controller is governed by that listing, not by an NEC busbar rule SolarPro could apply —
    // the same reason a Powerwall landing in its Gateway is NOT_EVALUATED rather than passed.
    const landsInGateway = topology.domains.find(d => d.gateway.id === panel.feedsNodeId);
    if (landsInGateway) {
      const ip = landsInGateway.gateway.internalPanelboard ?? null;
      const feeder = num(panel.outputOcpdA) ? (panel.outputOcpdA as number) : null;
      // 🚨 WHAT THE MANUFACTURER PUBLISHES IS CHECKED. WHAT IT DOES NOT PUBLISH IS NOT GUESSED.
      //
      // A gateway's internal panelboard has a stated busbar and a stated largest branch device, and
      // a generation breaker bigger than that maximum is a FAIL anybody can see. How much
      // generation that bus may carry in total is a different question, and the manufacturer's own
      // installation documentation answers it with "comply with the NEC" — which, for a listed
      // power-control assembly, depends on a configured limit SolarPro does not hold. So one half
      // is decided here and the other half is named, rather than both being waved through.
      if (!ip) {
        checks.push(unknown('aggregation.landing', scope, `${panel.label} landing`,
          `${panel.label} lands in ${landsInGateway.gateway.label} and no internal panelboard is `
          + 'recorded for that controller, so there is nothing to size the landing against.',
          [`manufacturer-document:internal-panelboard:${landsInGateway.gateway.productId}`],
          'Manufacturer listing / NEC 110.3(B)'));
      } else if (feeder !== null && feeder > ip.maxBranchBreakerA) {
        checks.push(fail('aggregation.landing', scope, `${panel.label} landing`,
          `${panel.label} needs a ${feeder} A breaker in ${landsInGateway.gateway.label}, whose `
          + `internal panelboard accepts branch devices up to ${ip.maxBranchBreakerA} A on a `
          + `${ip.busbarRatingA} A bus.`, ip.basis));
      } else {
        checks.push(unknown('aggregation.landing', scope, `${panel.label} landing`,
          `${panel.label}'s ${feeder === null ? 'output' : `${feeder} A`} feeder lands in `
          + `${landsInGateway.gateway.label}, whose internal panelboard is ${ip.busbarRatingA} A `
          + `with ${ip.spaces} spaces and branch devices to ${ip.maxBranchBreakerA} A — so the `
          + 'device itself is within what the manufacturer permits. How much generation that bus '
          + 'may carry in total is set by the assembly\'s listing and its configured limit, which '
          + 'is not published here and is not something SolarPro will assume.',
          ['manufacturer-document:gateway-generation-input'],
          `${ip.basis} / NEC 110.3(B)`));
      }
    }

    // 🚨 THE REQUIREMENT IS NOT THE PART. Same law as `device.selection`, one node along.
    if (!panel.productId) {
      checks.push(unknown('aggregation.selection', scope, `${panel.label} equipment selection`,
        `The requirement is established (${num(sizing.standardOcpdA)
          ? `${sizing.standardOcpdA} A output OCPD` : 'output OCPD not yet established'}`
        + `${num(panel.busbarRatingA) ? `, ${panel.busbarRatingA} A busbar` : ''}`
        + `, ${panel.inputs.length} branch position(s)) and no catalogue panelboard has been `
        + 'selected to meet it. Nothing is ordered and nothing is drawn as a specific enclosure '
        + 'until one is chosen.', ['aggregation.productId']));
    }
  }

  // ── HOW THE PV IS COUPLED, AND WHETHER THE DESIGN AGREES WITH ITSELF ──────
  //
  // 🚨 THE CONTRADICTION RAY FOUND IN THE BROWSER, MADE INTO A CHECK. Service topology said Tesla
  // while the main electrical system said MICROINVERTER and the SLD drew Enphase. Nothing was
  // wrong with either consumer in isolation — the project had no recorded answer, so each inferred
  // one. This check is what makes the absence visible instead of letting it be filled twice.
  {
    const coupling = topology.solarCoupling ?? null;
    const inverterUnitsAll = topology.storage.filter(u => u.role === 'inverter-unit');
    if (!coupling) {
      checks.push(unknown('pv.coupling', 'site', 'Solar coupling architecture',
        'How the PV is coupled has not been recorded for this project. Until it is, every surface '
        + 'that needs to know — the drawing, the equipment list, the engineering sidebar — has to '
        + 'infer it, and they do not all infer the same thing.',
        ['interconnection.solarCoupling']));
    } else {
      checks.push(pass('pv.coupling', 'site', 'Solar coupling architecture',
        coupling === 'dc-coupled-storage'
          ? `The PV strings terminate on the ${solarCouplingLabel(coupling, topology)
              .replace('PV DC coupled to ', '')} units' own DC inputs. There is no separate PV `
            + 'inverter, no microinverter branch circuit, no PV combiner and no PV AC disconnect '
            + 'on this design, because none of that equipment is installed.'
          : coupling === 'ac-coupled-inverter'
            ? 'The PV has its own inverter(s) and interconnects on the AC side.'
            : 'There is no PV on this project; the design is storage only.'));
    }

    // Each unit's own DC input, against the limit the manufacturer publishes for it.
    if (coupling === 'dc-coupled-storage') {
      for (const u of inverterUnitsAll) {
        const limits = u.pvInputLimits ?? null;
        const label = storageUnitLabel(topology, u);
        if (!limits) {
          checks.push(unknown('pv.dc-input', `storage:${u.id}`, `${label} PV input`,
            `This design is DC coupled, and no PV input limits are recorded for ${label}. A unit `
            + 'with no published PV input cannot be shown accepting strings.',
            [`manufacturer-document:pv-input:${u.productId}`]));
          continue;
        }
        if (!num(u.pvDcStcKw)) {
          checks.push(unknown('pv.dc-input', `storage:${u.id}`, `${label} PV input`,
            `${label} accepts up to ${limits.maxStcKw} kW STC across ${limits.mppts} MPPTs `
            + `(${limits.mpptVdc[0]}–${limits.mpptVdc[1]} V DC, ${limits.maxImpPerMpptA} A Imp / `
            + `${limits.maxIscPerMpptA} A Isc per MPPT). No PV has been assigned to it yet. The `
            + 'string layout decides that, and splitting the array evenly across the units to fill '
            + 'this in would be an invented distribution.', ['pv.stringAssignment']));
        } else {
          checks.push((u.pvDcStcKw as number) <= limits.maxStcKw
            ? pass('pv.dc-input', `storage:${u.id}`, `${label} PV input`,
                `${u.pvDcStcKw} kW STC assigned against the ${limits.maxStcKw} kW this unit `
                + 'accepts.', limits.basis)
            : fail('pv.dc-input', `storage:${u.id}`, `${label} PV input`,
                `${u.pvDcStcKw} kW STC is assigned to a unit that accepts `
                + `${limits.maxStcKw} kW.`, limits.basis));
        }
      }
    }
  }

  // ── MULTI-GATEWAY METERING — MANUFACTURER AUTHORITY ───────────────────────

  if (topology.domains.length > 1) {
    const doc = ic.multiGatewayMeteringDoc;
    if (!doc || !doc.present) {
      checks.push(unknown('metering.multi-gateway', 'site',
        'MANUFACTURER DOCUMENT REQUIRED — multiple gateways on one site',
        doc
          ? `${doc.title} (${doc.source}) is not present in this repository. It governs `
            + `${doc.governs.join(', ')}. Until it is supplied, SolarPro will not decide these — `
            + 'inventing a master/slave relationship or summing meter values would be a guess.'
          : `This site has ${topology.domains.length} gateways and no manufacturer document has been `
            + 'registered for multi-gateway site behaviour.',
        [doc ? `manufacturer-document:${doc.title}` : 'manufacturer-document:multi-gateway-metering']));
    } else {
      checks.push(pass('metering.multi-gateway', 'site', 'Multi-gateway site metering',
        `${doc.title} (${doc.source}) governs ${doc.governs.join(', ')} for this site.`));
    }
  }

  // Folded by the shared authority, which applies the same "a known failure outranks an unknown"
  // precedence the engine-level aggregator uses.
  const overall: Verdict = foldConclusions(checks);

  return { checks, bonding, storageSummary, overall };
}
