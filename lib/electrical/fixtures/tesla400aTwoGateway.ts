// ═══════════════════════════════════════════════════════════════════════════
// RAY'S ACTUAL UPCOMING JOB, AS A FIXTURE.
//
//   120/240 V split phase · 400 A aggregate service · two 200 A MSPs
//   two Tesla Backup Gateway 3 · FOUR Powerwall 3 · ZERO Expansions
//   two Powerwalls per 200 A system, each pair in its own generation / combiner panel
//   PV DC coupled to the Powerwalls' own inputs — no PV inverter on the job
//   NO meter-collar / Backup Switch interconnection permitted
//   Chicago / ComEd
//
// 🚨 THE HARDWARE CHANGED ON 2026-10-01 AND THE DEFAULTS DID NOT. `buildTesla400ATwoGateway` is a
// parameterised builder — one Powerwall and one Expansion per system is still a real arrangement and
// is still what most of the model tests exercise. `buildRaysIntendedJob` at the bottom is THE JOB,
// and that is what moved to four full Powerwalls.
//
// This is not an illustration. It is the shape the product has to save, reload, engineer, draw,
// bill and permit without collapsing to one MSP or one gateway, and it is what
// `tests/serviceTopologyIsAGraph.test.ts` holds the model to.
//
// 🚨 WHAT IS DELIBERATELY LEFT UNKNOWN. The available fault current at the service and the gateway
// interrupting ratings are null, because nobody has established them for this address yet. That is
// the honest state of a job at this stage, and it is the state that must NOT produce a passing
// engineering report. Supply them and the same fixture goes green on those checks; that is the
// difference between "verified" and "nobody looked".
// ═══════════════════════════════════════════════════════════════════════════

import {
  buildTeslaDomain, teslaMultiGatewayDocState, type TeslaDomainIntent,
} from '@/lib/electrical/adapters/tesla';
import type {
  ServiceTopology, ProtectiveDevice, ServiceBranch, PanelBoard, BackupDomain, StorageUnit,
  DerArrangement, DerAggregationPanel, PointOfInterconnection,
  ExistingServiceEquipment, LoadModel, SolarCoupling,
} from '@/lib/electrical/serviceTopology';
import { applyPerSystemGenerationPanels } from '@/lib/electrical/topologyPresets';

export interface Tesla400AOptions {
  /** Established available fault current at the service. Null on a job nobody has measured. */
  availableFaultCurrentA?: number | null;
  /** Interrupting rating supported by the main breaker fitted in each gateway. */
  gatewaySccrA?: number | null;
  /** Aggregate calculated service demand, when the load calculation has been run. */
  calculatedServiceDemandA?: number | null;
  /** Per-branch calculated demand, in branch order. */
  branchDemandA?: [number | null, number | null];
  /** PV or other generation landing inside each domain, as continuous AC amps. */
  generationOutputA?: [number | null, number | null];
  /** Set true to reproduce the defect: everything collapsed onto ONE gateway and ONE panel. */
  collapseToSingleGateway?: boolean;
  /** Set true to select a meter-collar interconnection, which this project forbids. */
  selectMeterCollar?: boolean;
  /**
   * Where each Powerwall's breaker lands. Left 'unresolved' by default, which is the honest state:
   * Ray's own note is that this "must follow selected topology/manufacturer authority", and nobody
   * has selected it yet on this job.
   */
  storageConnection?: BackupDomain['storageConnection'];
  /**
   * 🚨 HOW THE DER ACTUALLY REACHES THE 400 A SERVICE — the thing Ray found missing after live
   * testing: "It does not yet adequately describe how the two DER systems aggregate and actually
   * interconnect with the 400 A service."
   *
   * `undefined` — nobody has chosen. The honest default for this job, and the engineering reports
   *     the decision as required rather than drawing one.
   * `'independent-branch'` — each domain interconnects through its own governed branch, with one
   *     point of interconnection each.
   * `'common-aggregation'` — the two Powerwalls' AC outputs leave their domains, aggregate in one
   *     DER generation panel, pass through one utility isolation device and interconnect at a
   *     single point on the service.
   *
   * Both are built from the SAME data model. That is the proof Ray asked for — not that either is
   * permitted on this job, which is Tesla's and ComEd's and the AHJ's answer, not SolarPro's.
   */
  derArrangement?: DerArrangement;
  /** Reproduce a real defect: aggregate only ONE domain, leaving the other's path uncut. */
  aggregateOnlyFirstDomain?: boolean;
  /** Reproduce the invalid topology: aggregate both domains' BACKED-UP buses, paralleling islands. */
  aggregateBackedUpBuses?: boolean;
  /** The output OCPD fitted in the aggregation panel; omitted ⇒ not recorded. */
  aggregationOutputOcpdA?: number | null;
  /** The aggregation panel's busbar; omitted ⇒ not recorded. */
  aggregationBusbarA?: number | null;
  /**
   * 🚨 HOW THE UTILITY'S ISOLATION IS ARRANGED — Ray's intended design is TWO switches, not one.
   *
   * 'common-service' — one 400 A device on the service conductors (the earlier default).
   * 'one-per-path'   — one lockable, visible-open switch IN LINE in each 200 A path, ahead of that
   *                    path's gateway. This is what Ray intends to install, and his own note is
   *                    that utility/AHJ acceptance of it "remains something to verify".
   */
  isolationArrangement?: 'common-service' | 'one-per-path';
  /**
   * The existing service assembly, when there is one.
   *
   * On the real job there is: an Eaton 400 A meter/service assembly already on the wall whose
   * internals nobody has read yet. Absent ⇒ nobody has said whether it is existing or new
   * (`serviceExistingOrNew` → 'unanswered'), never "new".
   */
  existingServiceEquipment?: Partial<ExistingServiceEquipment>;
  /** The optional dwelling load calculation. Absent on the real job, by product decision. */
  loads?: LoadModel | null;
  /**
   * Inverter-bearing Powerwall 3 units in each system. Two on the current job.
   *
   * 🚨 FOUR CABINETS IS FOUR INVERTERS HERE, AND THAT IS THE POINT. Ray: "customer specifically
   * wants the increased inverter/discharge capacity from four full PW3s... 4 inverter-bearing
   * Powerwalls." Which is the exact opposite of the Expansion case, where four cabinets are two
   * inverters — the same count field cannot express both, so there are two.
   */
  powerwallsPerSystem?: number;
  /** DC expansion units per system. ZERO on the current job. */
  expansionsPerSystem?: number;
  /**
   * The output configuration each Powerwall is commissioned at.
   *
   * Ray: "approximately 46 kW aggregate PW3 output at the 11.5 kW configuration" — 4 × 11.5 kW,
   * which is the top row of Tesla's table and therefore 48 A and a 60 A device each.
   */
  outputConfigKw?: number | null;
  /**
   * Build one generation / combiner panel per system, which is what the current job has: each
   * pair of Powerwalls lands in its own panel before feeding its own Gateway.
   */
  generationPanelPerSystem?: boolean;
  /** How the PV is coupled. Absent ⇒ nobody recorded it, which is its own unresolved item. */
  solarCoupling?: SolarCoupling | null;
}

function domainIntents(opts: {
  powerwalls: number; expansions: number; outputConfigKw: number | null;
}): TeslaDomainIntent[] {
  const mk = (id: string, label: string): TeslaDomainIntent => ({
    id, label,
    gatewayProductId: 'tesla-backup-gateway-3',
    storageProductIds: Array.from({ length: opts.powerwalls }, () => 'tesla-powerwall-3'),
    expansionProductIds: Array.from(
      { length: opts.expansions }, () => 'tesla-powerwall-3-expansion'),
    outputConfigKw: opts.outputConfigKw,
  });
  // Installer language, from the authoring default: "System 1", not "Domain A".
  return [mk('domain-a', 'System 1'), mk('domain-b', 'System 2')];
}

export interface Tesla400ABuild {
  topology: ServiceTopology;
  /** Everything the catalogue could not answer, from the adapter. */
  unresolved: string[];
}

export function buildTesla400ATwoGateway(opts: Tesla400AOptions = {}): Tesla400ABuild {
  const {
    availableFaultCurrentA = null,
    gatewaySccrA = null,
    calculatedServiceDemandA = null,
    branchDemandA = [null, null],
    generationOutputA = [0, 0],
    collapseToSingleGateway = false,
    selectMeterCollar = false,
    storageConnection = 'unresolved',
    derArrangement,
    aggregateOnlyFirstDomain = false,
    aggregateBackedUpBuses = false,
    aggregationOutputOcpdA = null,
    aggregationBusbarA = null,
    isolationArrangement = 'common-service',
    existingServiceEquipment,
    loads = null,
    powerwallsPerSystem = 1,
    expansionsPerSystem = 1,
    outputConfigKw = null,
    generationPanelPerSystem = false,
    solarCoupling = null,
  } = opts;

  const DOMAIN_INTENTS = domainIntents({
    powerwalls: powerwallsPerSystem, expansions: expansionsPerSystem, outputConfigKw,
  });
  const intents = collapseToSingleGateway ? [DOMAIN_INTENTS[0]] : DOMAIN_INTENTS;
  const builds = intents.map(i => buildTeslaDomain({ ...i, sccrA: gatewaySccrA }));
  const unresolved = builds.flatMap(b => b.unresolved);

  // ── SERVICE AND ISOLATION EQUIPMENT ───────────────────────────────────────
  //
  // One 400 A service disconnect ahead of both gateways, so the neutral-ground bond is made THERE
  // and every gateway and panel below it is a feeder enclosure. The utility's DER isolation device
  // is a SEPARATE role on a SEPARATE device: conflating them is what a single `disconnectAmps`
  // field encourages, and ComEd's requirement is about isolating DER, not about the service.
  const devices: ProtectiveDevice[] = [
    {
      id: 'svc-disco', label: '400 A service disconnect',
      roles: ['service-disconnect'],
      ratedAmps: 400, sccrA: null,
      lockableOpen: true, visibleOpen: null,
      locationNote: 'Ahead of the service distribution, upstream of both gateways.',
    },
  ];
  if (isolationArrangement === 'common-service') {
    devices.push({
      id: 'der-isolation', label: 'Utility DER isolation disconnect',
      roles: ['der-isolation-disconnect'],
      ratedAmps: 400, sccrA: null,
      lockableOpen: true, visibleOpen: true,
      locationNote: 'Adjacent to the revenue meter, accessible to the utility.',
    });
  }

  // ── BRANCHES ──────────────────────────────────────────────────────────────
  const branches: ServiceBranch[] = collapseToSingleGateway
    ? [{ id: 'branch-a', label: '400 A service path 1', ratedAmps: 400, ocpdAmps: 400, calculatedDemandA: branchDemandA[0] ?? null }]
    : [
        { id: 'branch-a', label: '200 A service path 1', ratedAmps: 200, ocpdAmps: 200, calculatedDemandA: branchDemandA[0] ?? null },
        { id: 'branch-b', label: '200 A service path 2', ratedAmps: 200, ocpdAmps: 200, calculatedDemandA: branchDemandA[1] ?? null },
      ];

  // ── PANELS ────────────────────────────────────────────────────────────────
  const panels: PanelBoard[] = collapseToSingleGateway
    ? [{ id: 'msp-1', label: 'MSP #1', busbarRatingA: 200, mainBreakerA: 200, sccrA: null, backedUp: true }]
    : [
        { id: 'msp-1', label: 'MSP #1', busbarRatingA: 200, mainBreakerA: 200, sccrA: null, backedUp: true },
        { id: 'msp-2', label: 'MSP #2', busbarRatingA: 200, mainBreakerA: 200, sccrA: null, backedUp: true },
      ];

  // ── DOMAINS ───────────────────────────────────────────────────────────────
  const domains: BackupDomain[] = builds.map((b, i) => ({
    id: intents[i].id,
    label: intents[i].label,
    branchId: branches[i]?.id ?? branches[0].id,
    gateway: b.gateway,
    backedUpPanelIds: [panels[i]?.id ?? panels[0].id],
    storageUnitIds: b.storage.map(u => u.id),
    generationOutputA: generationOutputA[i] ?? 0,
    backedUpDemandA: null,
    storageConnection,
  }));

  const storage: StorageUnit[] = builds.flatMap(b => b.storage);

  // ── ONE KNIFE SWITCH PER 200 A PATH ───────────────────────────────────────
  //
  // 🚨 IN LINE, AHEAD OF THAT PATH'S GATEWAY — which is the whole point. Modelled as a device merely
  // pointing at the branch it would be a stub beside an untouched conductor, and opening both
  // switches would leave both Powerwalls connected to the utility. `inlineOnNodeId` is what makes
  // the connection graph route the branch feeder THROUGH it.
  //
  // Ray's own note on this arrangement: "Utility/AHJ acceptance of the two-switch arrangement
  // remains something to verify." Nothing here asserts it is acceptable.
  if (isolationArrangement === 'one-per-path') {
    branches.forEach((b, i) => {
      const domain = domains.find(d => d.branchId === b.id);
      devices.push({
        id: `knife-${String.fromCharCode(97 + i)}`,
        // The path's name already carries its rating, so the switch does not repeat it.
        label: `Utility isolation switch — ${b.label}`,
        roles: ['der-isolation-disconnect'],
        ratedAmps: b.ratedAmps, sccrA: null,
        lockableOpen: true, visibleOpen: true,
        locationNote: `In line in ${b.label}, ahead of ${domain?.gateway.label ?? 'its panelboard'}.`,
        ...(domain ? { inlineOnNodeId: domain.gateway.id, feedsNodeId: b.id } : {}),
      });
    });
  }

  // ── HOW THE DER REACHES THE SERVICE ───────────────────────────────────────
  //
  // Two arrangements, one data model. Neither is asserted to be permitted on this job: Tesla's
  // multi-gateway guidance and ComEd's interconnection requirements decide that, and both are
  // already reported as unresolved authorities.
  const aggregationPanels: DerAggregationPanel[] = [];
  const pointsOfInterconnection: PointOfInterconnection[] = [];
  const inverterUnits = storage.filter(u => u.role === 'inverter-unit');
  let effectiveStorageConnection = storageConnection;

  if (derArrangement === 'common-aggregation') {
    const taken = aggregateOnlyFirstDomain ? inverterUnits.slice(0, 1) : inverterUnits;
    // 🚨 THE STORAGE CONNECTION HAS TO AGREE WITH WHAT THE PANEL ACTUALLY TAKES.
    //
    //  · backed-up-bus taps  — the units still land on their own panels' busbars; it is the ISLAND
    //        that is tied to the aggregation panel. Saying they left for it would make the graph
    //        name a landing nobody provides.
    //  · only the first domain — the second unit never left, so only a real landing is honest.
    //  · both units taken     — they left their domains, and the panels carry no storage.
    effectiveStorageConnection = aggregateBackedUpBuses
      ? (storageConnection === 'unresolved' ? 'backed-up-panel-busbar' : storageConnection)
      : aggregateOnlyFirstDomain
        ? storageConnection
        : 'der-aggregation-panel';

    aggregationPanels.push({
      id: 'der-agg-1',
      label: 'DER aggregation panel',
      // A DER-only generation panel: it serves no premises load.
      carriesPremisesLoad: false,
      busbarRatingA: aggregationBusbarA,
      mainBreakerA: null,
      mainLugOnly: true,
      sccrA: null,
      inputs: aggregateBackedUpBuses
        // 🚨 THE INVALID TOPOLOGY, ON PURPOSE: both islands' backed-up buses onto one panel.
        ? domains.map((d, i) => ({
            id: `agg-in-${i + 1}`, sourceId: d.id, tap: 'backed-up-busbar' as const, ocpdA: 60,
          }))
        : taken.map((u, i) => ({
            id: `agg-in-${i + 1}`, sourceId: u.id, tap: 'der-output' as const, ocpdA: u.ocpdA,
          })),
      outputOcpdA: aggregationOutputOcpdA,
      feedsNodeId: 'der-isolation',
      outputConductorGauge: null,
    });
    pointsOfInterconnection.push({
      id: 'poi-1',
      label: 'Point of interconnection',
      relationship: 'aggregation-to-supply-side',
      derNodeId: 'der-isolation',
      connectedToNodeId: 'svc-disco',
      ocpdA: aggregationOutputOcpdA,
    });
    // The utility isolation device now sits on the DER feeder, not on the service conductors.
    const iso = devices.find(d => d.id === 'der-isolation');
    if (iso) iso.feedsNodeId = 'poi-1';
  } else if (derArrangement === 'independent-branch') {
    for (const d of domains) {
      pointsOfInterconnection.push({
        id: `poi-${d.id}`,
        label: `${d.label} point of interconnection`,
        relationship: storageConnection === 'gateway-panelboard'
          ? 'manufacturer-integrated' : 'load-side-busbar',
        derNodeId: d.storageUnitIds[0] ?? null,
        connectedToNodeId: storageConnection === 'gateway-panelboard'
          ? d.gateway.id : (d.backedUpPanelIds[0] ?? null),
        ocpdA: null,
      });
    }
  }

  if (effectiveStorageConnection !== storageConnection) {
    for (const d of domains) d.storageConnection = effectiveStorageConnection;
  }

  const topology: ServiceTopology = {
    service: {
      ratedAmps: 400,
      voltage: 240,
      phase: 'split-240',
      availableFaultCurrentA,
      ...(existingServiceEquipment ? {
        existingOrNew: 'existing' as const,
        existingEquipment: {
          manufacturer: null, catalogNumber: null, mainArrangement: null,
          feederArrangement: null, sccrA: null, verified: false,
          ...existingServiceEquipment,
        },
      } : {}),
    },
    devices,
    branches,
    panels,
    domains,
    storage,
    generation: [],
    aggregationPanels,
    pointsOfInterconnection,
    calculatedServiceDemandA,
    loads,
    solarCoupling,
    interconnection: {
      utilityId: 'comed',
      // Undefined ⇒ nobody has chosen, which is the honest state of this job today.
      derArrangement: derArrangement ?? null,
      // Ray's project constraint, stated by him: no meter-collar / Backup Switch on this job.
      meterCollarPermitted: false,
      meterCollarSelected: selectMeterCollar,
      // ComEd requires an external isolation device for a DER-equipped service above the
      // applicable <=200 A exception. This service is 400 A, so it is in scope.
      externalDerIsolationRequired: true,
      externalDerIsolationBasis:
        'ComEd interconnection requirements — a DER-equipped service above the applicable 200 A '
        + 'exception requires an external, utility-accessible isolation device.',
      multiGatewayMeteringDoc: teslaMultiGatewayDocState(),
    },
  };

  // ── ONE GENERATION / COMBINER PANEL PER SYSTEM ────────────────────────────
  //
  // Applied through the same preset the wizard calls, so the fixture cannot build a panel the UI
  // cannot. It replaces the domains' storage connection with the panel it actually lands in.
  if (generationPanelPerSystem) {
    const built = applyPerSystemGenerationPanels(topology);
    return { topology: built.topology, unresolved };
  }

  return { topology, unresolved };
}

/**
 * 🚨 THE JOB AS RAY INTENDS TO BUILD IT. Not an illustration and not the maximal case — the
 * specific arrangement he described after live-testing the workflow:
 *
 *   existing Eaton 400 A meter/service assembly, internals NOT yet verified
 *   two 200 A systems, independent, nothing recombined downstream
 *   one knife switch IN LINE in each path, ahead of that path's Gateway
 *   Gateway 3 + TWO Powerwall 3 + one generation/combiner panel per system
 *   PV DC coupled to the Powerwalls — no microinverters, no PV inverter, no PV AC combiner
 *   no meter collar, no common 400 A combiner, no house-load inventory
 *
 * Ray: "Do not invent a common 400 A knife-blade switch or common DER combiner merely because the
 * service is 400 A." Nothing here does, and nothing here claims the two-switch arrangement is
 * accepted — `interconnection.externalDerIsolationRequired` is true because ComEd requires isolation
 * for this service class, and whether TWO devices satisfy it is a jurisdiction ruling the
 * engineering still lists as unresolved.
 *
 * The load calculation is deliberately absent. That is the product decision, and this fixture is
 * what proves a design completes without one.
 */
export function buildRaysIntendedJob(
  overrides: Tesla400AOptions = {},
): Tesla400ABuild {
  return buildTesla400ATwoGateway({
    // 🚨 THE HARDWARE CHANGED, SO THIS DID. Ray, 2026-10-01: "The hardware/design has changed...
    // 4 full Tesla Powerwall 3, 0 Powerwall Expansions, 2 full PW3 per Gateway... customer
    // specifically wants the increased inverter/discharge capacity from four full PW3s."
    //
    // Four inverter-bearing units: 4 × 13.5 kWh = 54.0 kWh and 4 × 48 A = 192 A of AC source,
    // against two Expansions' 27.0 kWh and 96 A on the previous arrangement. The energy figure
    // barely moves and the CURRENT doubles, which is exactly the distinction the Expansion work
    // existed to protect — and the reason this is a different number of options, not a bigger one.
    powerwallsPerSystem: 2,
    expansionsPerSystem: 0,
    outputConfigKw: 11.5,
    // Each pair lands in its own panel before its own Gateway. Two panels, never one.
    generationPanelPerSystem: true,
    // The strings terminate on the Powerwalls' own DC inputs; there is no PV inverter on this job.
    solarCoupling: 'dc-coupled-storage',
    derArrangement: 'independent-branch',
    // 🚨 THE POWERWALL LANDS IN ITS GATEWAY, which is what Ray's own diagram shows —
    //
    //     GW #1 → MSP #1        PW3 #1 → Expansion #1
    //
    // — and what a Gateway 3 actually is. It matters: land the same Powerwall on a 200 A busbar
    // with a 200 A main instead and NEC 705.12(B) allows 40 A of backfeed against a 50 A breaker,
    // which FAILS. `the Powerwall cannot land on a 200 A/200 A MSP busbar` in
    // tests/raysRealFourHundredAmpJob.test.ts is that arrangement, kept as a test rather than
    // buried in a fixture choice.
    storageConnection: 'gateway-panelboard',
    isolationArrangement: 'one-per-path',
    existingServiceEquipment: { manufacturer: 'Eaton' },
    loads: null,
    ...overrides,
  });
}
