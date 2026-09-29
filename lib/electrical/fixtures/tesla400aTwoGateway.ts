// ═══════════════════════════════════════════════════════════════════════════
// RAY'S ACTUAL UPCOMING JOB, AS A FIXTURE.
//
//   120/240 V split phase · 400 A aggregate service · two 200 A MSPs
//   two Tesla Backup Gateway 3 · two Powerwall 3 · two Powerwall 3 Expansion
//   one Powerwall + one Expansion per 200 A backup domain
//   NO meter-collar / Backup Switch interconnection permitted
//   Chicago / ComEd
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
} from '@/lib/electrical/serviceTopology';

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
  storageConnection?: 'backed-up-panel-busbar' | 'gateway-panelboard' | 'unresolved';
}

const DOMAIN_INTENTS: TeslaDomainIntent[] = [
  {
    id: 'domain-a', label: 'Domain A',
    gatewayProductId: 'tesla-backup-gateway-3',
    storageProductIds: ['tesla-powerwall-3'],
    expansionProductIds: ['tesla-powerwall-3-expansion'],
  },
  {
    id: 'domain-b', label: 'Domain B',
    gatewayProductId: 'tesla-backup-gateway-3',
    storageProductIds: ['tesla-powerwall-3'],
    expansionProductIds: ['tesla-powerwall-3-expansion'],
  },
];

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
  } = opts;

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
    {
      id: 'der-isolation', label: 'Utility DER isolation disconnect',
      roles: ['der-isolation-disconnect'],
      ratedAmps: 400, sccrA: null,
      lockableOpen: true, visibleOpen: true,
      locationNote: 'Adjacent to the revenue meter, accessible to the utility.',
    },
  ];

  // ── BRANCHES ──────────────────────────────────────────────────────────────
  const branches: ServiceBranch[] = collapseToSingleGateway
    ? [{ id: 'branch-a', label: 'Branch A', ratedAmps: 400, ocpdAmps: 400, calculatedDemandA: branchDemandA[0] ?? null }]
    : [
        { id: 'branch-a', label: 'Branch A', ratedAmps: 200, ocpdAmps: 200, calculatedDemandA: branchDemandA[0] ?? null },
        { id: 'branch-b', label: 'Branch B', ratedAmps: 200, ocpdAmps: 200, calculatedDemandA: branchDemandA[1] ?? null },
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

  const topology: ServiceTopology = {
    service: {
      ratedAmps: 400,
      voltage: 240,
      phase: 'split-240',
      availableFaultCurrentA,
    },
    devices,
    branches,
    panels,
    domains,
    storage,
    calculatedServiceDemandA,
    interconnection: {
      utilityId: 'comed',
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

  return { topology, unresolved };
}
