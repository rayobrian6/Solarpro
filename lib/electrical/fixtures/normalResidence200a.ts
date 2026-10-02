// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE NORMAL JOB. 200 A, ONE MAIN SERVICE PANEL, ONE GATEWAY.
//
// Ray, 2026-10-02: "Add a genuine production fixture: 200 A service, 1 MSP, 1 Gateway, 1–2 storage
// units. Make this the normal-path UX baseline."
//
// 🚨 WHY THIS FILE HAD TO EXIST, which is a finding and not a chore.
//
// Before it, `lib/electrical/fixtures/` held exactly one file — the 400 A / two-gateway job — and
// the only one-domain shape in the repository was its `collapseToSingleGateway` option, documented
// at its own declaration as "Set true to reproduce the defect". **SolarPro had no fixture for the
// ordinary house.** Every electrical guard was written against the hardest site in the product, so
// the simple path could regress without a single test noticing.
//
// And the simple path is where the chain's worst break HIDES. `project.mainPanelAmps ?? 200` is
// read as the NEC 705.12(B) busbar base by ten production surfaces, and on a 200 A one-MSP house
// **200 is the correct answer** — so the fabrication is invisible here and only shows up on the
// 400 A job, where the 400 A SERVICE rating gets projected into a 200 A panel's BUSBAR field and
// doubles the permitted backfeed. A fixture that is right for the wrong reason proves nothing, so
// this one records its service rating, its busbar and its main breaker as three separate facts
// even though all three happen to be 200.
//
// 🚨 SAME ENGINE, NOT A SIMPLE ONE. Ray: "Use the same topology engine. Do not create a separate
// simple topology system." This builds a real `ServiceTopology` from the same adapter
// (`buildTeslaDomain`) and the same preset the wizard calls, so anything the wizard cannot author,
// this cannot either.
// ═══════════════════════════════════════════════════════════════════════════

import {
  buildTeslaDomain, type TeslaDomainIntent,
} from '@/lib/electrical/adapters/tesla';
import type {
  ServiceTopology, ProtectiveDevice, ServiceBranch, PanelBoard, BackupDomain, StorageUnit,
  PointOfInterconnection, LoadModel, SolarCoupling,
} from '@/lib/electrical/serviceTopology';

export interface NormalResidenceOptions {
  /** Inverter-bearing Powerwall 3 units. One or two on an ordinary house. */
  powerwalls?: number;
  /** The commissioned output configuration per unit; null ⇒ not recorded. */
  outputConfigKw?: number | null;
  /** How the PV is coupled. Defaults to DC-coupled, which is what a PW3 PV install is. */
  solarCoupling?: SolarCoupling | null;
  /** Established available fault current. Null on a house nobody has measured — the common case. */
  availableFaultCurrentA?: number | null;
  /** The dwelling load calculation, when it has been run. Absent by default. */
  loads?: LoadModel | null;
  /**
   * Where the storage breaker lands. Defaults to the gateway's own panelboard, which is what a
   * Gateway 3 install is — NOT the MSP busbar.
   *
   * 🚨 THIS DEFAULT IS LOAD-BEARING. Land a PW3 on a 200 A busbar behind a 200 A main instead and
   * NEC 705.12(B) allows (200 × 1.2) − 200 = 40 A against a 60 A backfeed device, which FAILS. The
   * ordinary house is not exempt from that arithmetic; it just happens to be wired so the rule does
   * not apply, and the fixture has to say which.
   */
  storageConnection?: BackupDomain['storageConnection'];
  /** Record the point of interconnection. Omitted ⇒ `'unresolved'`, the honest state of a new job. */
  interconnectionRelationship?: PointOfInterconnection['relationship'];
}

export interface NormalResidenceBuild {
  topology: ServiceTopology;
  /** Everything the catalogue could not answer, from the adapter. */
  unresolved: string[];
}

/**
 * One 200 A service, one MSP, one Gateway 3, one or two Powerwall 3.
 *
 * Nothing here is multi-system: there is ONE branch, ONE panelboard and ONE domain, so every
 * question that only makes sense for several systems — the DER arrangement, a common aggregation
 * panel, a per-path isolation switch — is absent rather than answered with a default. A simple
 * electrical system should produce a simple model.
 */
export function buildNormalResidence200A(
  opts: NormalResidenceOptions = {},
): NormalResidenceBuild {
  const {
    powerwalls = 1,
    outputConfigKw = 11.5,
    solarCoupling = 'dc-coupled-storage',
    availableFaultCurrentA = null,
    loads = null,
    storageConnection = 'gateway-panelboard',
    interconnectionRelationship,
  } = opts;

  const intent: TeslaDomainIntent = {
    id: 'domain-a',
    // Installer language. One system does not get called "System 1 of 1".
    label: 'Home',
    gatewayProductId: 'tesla-backup-gateway-3',
    storageProductIds: Array.from({ length: powerwalls }, () => 'tesla-powerwall-3'),
    expansionProductIds: [],
    outputConfigKw,
  };
  const build = buildTeslaDomain(intent);

  // ── SERVICE EQUIPMENT ─────────────────────────────────────────────────────
  //
  // 🚨 ONE DEVICE, AND NO UTILITY DER ISOLATION SWITCH.
  //
  // ComEd's external-isolation requirement applies ABOVE the 200 A exception. This service IS
  // 200 A, so it is within the exception and no utility-accessible isolation device is required —
  // which is exactly the difference between this fixture and the 400 A one, and the reason
  // `externalDerIsolationRequired` is false here rather than merely unset. A fixture that left it
  // unset would let a consumer that reads it as a boolean draw the wrong conclusion for the right
  // reason.
  const devices: ProtectiveDevice[] = [
    {
      id: 'svc-main', label: '200 A service main',
      roles: ['service-disconnect'],
      ratedAmps: 200, sccrA: null,
      lockableOpen: true, visibleOpen: null,
      locationNote: 'The main breaker in the service panel.',
    },
  ];

  const branches: ServiceBranch[] = [{
    id: 'branch-a', label: '200 A service', ratedAmps: 200, ocpdAmps: 200,
    calculatedDemandA: null,
  }];

  // 🚨 THREE SEPARATE FACTS THAT HAPPEN TO SHARE A NUMBER: the service is 200 A, the busbar is
  // 200 A, the main is 200 A. `mainPanelAmps` cannot express that distinction and that is the
  // whole reason the 400 A job broke — see the header.
  const panels: PanelBoard[] = [{
    id: 'msp-1', label: 'Main service panel', busbarRatingA: 200, mainBreakerA: 200,
    sccrA: null, backedUp: true,
  }];

  const domains: BackupDomain[] = [{
    id: intent.id,
    label: intent.label,
    branchId: 'branch-a',
    gateway: build.gateway,
    backedUpPanelIds: ['msp-1'],
    storageUnitIds: build.storage.map(u => u.id),
    generationOutputA: 0,
    backedUpDemandA: null,
    storageConnection,
  }];

  const storage: StorageUnit[] = build.storage;

  // ── THE POINT OF INTERCONNECTION ──────────────────────────────────────────
  //
  // 🚨 'unresolved' UNLESS THE CALLER SAYS. Absence is not a load-side breaker. A new job has not
  // established how it connects, and the engineering is required to report that rather than
  // assume NEC 705.12(B) — which is the defect this whole repair pass is about.
  //
  // 🚨 AND NOTE WHAT THE MODEL ALREADY GETS RIGHT: `governingArticleFor` in
  // `lib/electrical/serviceTopology.ts` returns `null` for 'unresolved', 'manufacturer-integrated'
  // and 'meter-collar' — "a stored article can disagree with the relationship beside it; a
  // function cannot". The authority has been correct the whole time. What was broken is every
  // consumer that reached for `?? 'LOAD_SIDE'` instead of asking it.
  const pointsOfInterconnection: PointOfInterconnection[] = [{
    id: 'poi-a',
    label: 'Point of interconnection',
    relationship: interconnectionRelationship ?? 'unresolved',
    derNodeId: domains[0].gateway.id,
    connectedToNodeId: 'msp-1',
    ocpdA: null,
  }];

  const topology: ServiceTopology = {
    service: {
      ratedAmps: 200,
      voltage: 240,
      phase: 'split-240',
      availableFaultCurrentA,
    },
    devices,
    branches,
    panels,
    domains,
    storage,
    generation: [],
    aggregationPanels: [],
    pointsOfInterconnection,
    calculatedServiceDemandA: null,
    loads,
    solarCoupling,
    interconnection: {
      utilityId: 'comed',
      // One system: there is no arrangement to choose between. Not "unanswered" — inapplicable.
      derArrangement: null,
      meterCollarPermitted: false,
      meterCollarSelected: false,
      // Within the 200 A exception — see the devices note above.
      externalDerIsolationRequired: false,
      externalDerIsolationBasis:
        'ComEd interconnection requirements — this 200 A service is within the applicable '
        + 'exception, so no external utility-accessible DER isolation device is required.',
      multiGatewayMeteringDoc: null,
    },
  };

  return { topology, unresolved: build.unresolved };
}
