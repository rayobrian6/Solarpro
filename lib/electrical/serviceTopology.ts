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
import {
  foldConclusions,
  type EngineeringConclusion, type EngineeringCheck,
} from '@/lib/engineering/engineeringStatus';

// ── The service ─────────────────────────────────────────────────────────────

export type ServicePhase = 'split-240' | 'wye-208' | 'wye-480';

export interface UtilityService {
  /** Aggregate service rating. 400 on this job. */
  ratedAmps: number;
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

export interface StorageUnit {
  id: string;
  productId: string;
  role: StorageRole;
  /** Continuous AC output. MUST be null or 0 for an 'energy-expansion'. */
  continuousOutputA: number | null;
  /** Its own AC OCPD. An expansion has none. */
  ocpdA: number | null;
  usableKwh: number | null;
  /** For an expansion: the inverter unit it is harnessed to. */
  attachedToUnitId?: string | null;
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
   * 'unresolved'             — nobody has said. The default, and it is NOT_EVALUATED.
   *
   * Getting this wrong in either direction is expensive. Assuming the busbar produces a FAIL on a
   * perfectly standard gateway installation; assuming the gateway silently skips the one check
   * that protects the panel.
   */
  storageConnection: 'backed-up-panel-busbar' | 'gateway-panelboard' | 'unresolved';
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

export interface ServiceTopology {
  service: UtilityService;
  /** Everything protective, by role. */
  devices: ProtectiveDevice[];
  branches: ServiceBranch[];
  panels: PanelBoard[];
  domains: BackupDomain[];
  storage: StorageUnit[];
  /** Site-wide calculated service demand. null ⇒ NOT_EVALUATED. */
  calculatedServiceDemandA: number | null;
  /** Jurisdictional facts that change what is legal, supplied by the AHJ/utility layer. */
  interconnection: InterconnectionContext;
}

export interface InterconnectionContext {
  utilityId: string | null;
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
 * Where the neutral-ground bond belongs, from where the service disconnect actually is.
 *
 * ONE service disconnect upstream of the gateways ⇒ the bond is there, and every gateway and panel
 * downstream is a feeder enclosure with neutral isolated. SEVERAL service disconnects (the grouped
 * arrangement, where each 200 A device is service equipment) ⇒ each is bonded and nothing below is.
 * No service disconnect identified ⇒ nothing is asserted, and the check reports NOT_EVALUATED.
 */
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

  // ── SERVICE ───────────────────────────────────────────────────────────────

  const branchSum = topology.branches.reduce((n, b) => n + b.ratedAmps, 0);
  checks.push(branchSum <= topology.service.ratedAmps
    ? pass('service.branch-sum', 'site', 'Service branches fit the service',
        `${topology.branches.length} branches totalling ${branchSum} A on a `
        + `${topology.service.ratedAmps} A service.`)
    : fail('service.branch-sum', 'site', 'Service branches fit the service',
        `${topology.branches.length} branches total ${branchSum} A, which exceeds the `
        + `${topology.service.ratedAmps} A service rating. A 400 A service does not make two 200 A `
        + 'panels automatically valid — the split has to be engineered, not assumed.'));

  checks.push(num(topology.calculatedServiceDemandA)
    ? (topology.calculatedServiceDemandA <= topology.service.ratedAmps
        ? pass('service.demand', 'site', 'Aggregate service demand',
            `${topology.calculatedServiceDemandA.toFixed(1)} A calculated demand against a `
            + `${topology.service.ratedAmps} A service.`, 'NEC 220')
        : fail('service.demand', 'site', 'Aggregate service demand',
            `${topology.calculatedServiceDemandA.toFixed(1)} A calculated demand exceeds the `
            + `${topology.service.ratedAmps} A service.`, 'NEC 220'))
    : unknown('service.demand', 'site', 'Aggregate service demand',
        'No aggregate service load calculation has been supplied, so the service rating has not '
        + 'been shown to be adequate.', ['calculatedServiceDemandA'], 'NEC 220'));

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

    checks.push(num(b.calculatedDemandA)
      ? (b.calculatedDemandA <= b.ratedAmps
          ? pass('branch.demand', scope, `${b.label} calculated demand`,
              `${b.calculatedDemandA.toFixed(1)} A on a ${b.ratedAmps} A branch.`, 'NEC 220')
          : fail('branch.demand', scope, `${b.label} calculated demand`,
              `${b.calculatedDemandA.toFixed(1)} A exceeds the ${b.ratedAmps} A branch.`, 'NEC 220'))
      : unknown('branch.demand', scope, `${b.label} calculated demand`,
          'This branch has no load calculation of its own. An aggregate service calculation does '
          + 'not establish that an individual branch panel is adequate.',
          ['calculatedDemandA'], 'NEC 220'));
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
      const domainStorage = storageSummary.byDomain[d.id];
      const backfeedA = num(domainStorage?.continuousOutputA) && num(d.generationOutputA)
        ? domainStorage.continuousOutputA + d.generationOutputA
        : null;

      // 🚨 THE BUSBAR RULE ONLY APPLIES IF THE BREAKER IS IN THE BUSBAR.
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

    checks.push(num(d.backedUpDemandA)
      ? pass('domain.backed-up-load', scope, `${d.label} backed-up load`,
          `${d.backedUpDemandA.toFixed(1)} A of backed-up load recorded.`)
      : unknown('domain.backed-up-load', scope, `${d.label} backed-up load`,
          'The backed-up load for this domain has not been calculated.', ['backedUpDemandA']));
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

  if (bonding.bondedAtNodeIds.length === 0) {
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
