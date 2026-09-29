// ═══════════════════════════════════════════════════════════════════════════
// BUILDING A SERVICE TOPOLOGY FROM NOTHING — the operations the UI performs.
//
// Ray: "Prove the topology can be created from the actual UI. **Do not only deserialize a
// hand-built test fixture.**"
//
// So the authoring steps are here, pure and testable, and the engineering page calls them. A screen
// that constructs graph objects inline is a second model of the graph.
//
// 🚨 GENERIC. Every device rating is looked up from the equipment catalogue by product id; there is
// no manufacturer name and no ampere rating written in this file. `lib/electrical/adapters/tesla.ts`
// is now a thin wrapper over `buildDomainFromCatalogue` below — which is what "manufacturer
// adapters supply the device rules, the service graph is generic" should actually look like in the
// code, rather than two copies of the same catalogue reads.
// ═══════════════════════════════════════════════════════════════════════════

import {
  getBatteryById, getBackupInterfaceById, type BatterySystem,
} from '@/lib/equipment-db';
import type {
  ServiceTopology, ServiceBranch, PanelBoard, BackupDomain, StorageUnit,
  GatewayInstance, ProtectiveDevice, DeviceRole, ServicePhase,
  GenerationUnit, DerAggregationPanel, DerTapPoint, PointOfInterconnection, PoiRelationship,
} from '@/lib/electrical/serviceTopology';
import { sizeAggregationPanel } from '@/lib/electrical/serviceTopology';
import { nextStandardOcpd } from '@/lib/electrical/stdSizes';

/** A new, empty service. Branches, panels and domains are added onto it. */
export function createServiceTopology(opts: {
  ratedAmps: number;
  voltage?: number;
  phase?: ServicePhase;
  utilityId?: string | null;
}): ServiceTopology {
  return {
    service: {
      ratedAmps: opts.ratedAmps,
      voltage: opts.voltage ?? 240,
      phase: opts.phase ?? 'split-240',
      // 🚨 NOT ZERO. Nobody has measured it yet, and the SCCR chain must say so.
      availableFaultCurrentA: null,
    },
    devices: [],
    branches: [],
    panels: [],
    domains: [],
    storage: [],
    generation: [],
    aggregationPanels: [],
    pointsOfInterconnection: [],
    calculatedServiceDemandA: null,
    interconnection: {
      utilityId: opts.utilityId ?? null,
      // 🚨 NOT DEFAULTED TO A SHAPE. How the DER reaches the service is a design decision, and a
      // new service has not made it.
      derArrangement: null,
      meterCollarPermitted: null,
      meterCollarSelected: false,
      externalDerIsolationRequired: null,
      multiGatewayMeteringDoc: null,
    },
  };
}

const nextId = (existing: readonly { id: string }[], prefix: string) => {
  let n = existing.length + 1;
  const taken = new Set(existing.map(x => x.id));
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};

export function addServiceBranch(
  t: ServiceTopology, opts: { ratedAmps: number; ocpdAmps?: number | null; label?: string },
): { topology: ServiceTopology; branch: ServiceBranch } {
  const id = nextId(t.branches, 'branch');
  const branch: ServiceBranch = {
    id,
    label: opts.label ?? `Branch ${String.fromCharCode(65 + t.branches.length)}`,
    ratedAmps: opts.ratedAmps,
    ocpdAmps: opts.ocpdAmps ?? opts.ratedAmps,
    calculatedDemandA: null,
  };
  return { topology: { ...t, branches: [...t.branches, branch] }, branch };
}

export function addPanel(
  t: ServiceTopology,
  opts: { busbarRatingA: number | null; mainBreakerA: number | null; label?: string; backedUp?: boolean },
): { topology: ServiceTopology; panel: PanelBoard } {
  const id = nextId(t.panels, 'msp');
  const panel: PanelBoard = {
    id,
    label: opts.label ?? `MSP #${t.panels.length + 1}`,
    busbarRatingA: opts.busbarRatingA,
    mainBreakerA: opts.mainBreakerA,
    sccrA: null,
    backedUp: opts.backedUp ?? true,
  };
  return { topology: { ...t, panels: [...t.panels, panel] }, panel };
}

export function addProtectiveDevice(
  t: ServiceTopology,
  opts: {
    label: string; roles: DeviceRole[]; ratedAmps?: number | null;
    lockableOpen?: boolean | null; visibleOpen?: boolean | null; locationNote?: string | null;
  },
): { topology: ServiceTopology; device: ProtectiveDevice } {
  const id = nextId(t.devices, 'device');
  const device: ProtectiveDevice = {
    id, label: opts.label, roles: opts.roles,
    ratedAmps: opts.ratedAmps ?? null,
    sccrA: null,
    lockableOpen: opts.lockableOpen ?? null,
    visibleOpen: opts.visibleOpen ?? null,
    locationNote: opts.locationNote ?? null,
  };
  return { topology: { ...t, devices: [...t.devices, device] }, device };
}

export interface DomainIntent {
  id: string;
  label: string;
  /** Catalogue id of the gateway / backup controller. */
  gatewayProductId: string;
  /** The main breaker fitted in it, when chosen. */
  mainBreakerA?: number | null;
  /** Interrupting rating with that breaker, when established. */
  sccrA?: number | null;
  /** Catalogue ids of the inverter-class storage units. */
  storageProductIds: string[];
  /** Catalogue ids of the DC expansions, paired to the units above by index. */
  expansionProductIds?: string[];
}

export interface DomainBuild {
  gateway: GatewayInstance;
  storage: StorageUnit[];
  /** Everything the catalogue could not answer, named rather than defaulted. */
  unresolved: string[];
}

const roleOf = (b: BatterySystem): StorageUnit['role'] =>
  b.storageRole === 'energy-expansion' ? 'energy-expansion' : 'inverter-unit';

/**
 * Resolve a domain's gateway and storage from catalogue ids.
 *
 * 🚨 EVERY NUMBER IS LOOKED UP. Anything the catalogue does not state comes back null AND is named
 * in `unresolved`, so the operator sees what to supply rather than discovering later that a check
 * quietly passed on a default.
 */
export function buildDomainFromCatalogue(intent: DomainIntent): DomainBuild {
  const unresolved: string[] = [];

  const gwProduct = getBackupInterfaceById(intent.gatewayProductId);
  if (!gwProduct) {
    unresolved.push(
      `No catalogue row for gateway '${intent.gatewayProductId}'. Its continuous rating, `
      + 'service-entrance rating and main breaker are UNRESOLVED. Add the product from its '
      + 'manufacturer documentation rather than assuming a typical value.');
  }

  const gateway: GatewayInstance = {
    id: `${intent.id}-gateway`,
    productId: intent.gatewayProductId,
    label: gwProduct ? `${gwProduct.manufacturer} ${gwProduct.model}` : intent.gatewayProductId,
    continuousRatingA: gwProduct?.maxContinuousOutputA ?? null,
    serviceEntranceRated: gwProduct?.serviceEntranceRated ?? null,
    mainBreakerA: intent.mainBreakerA ?? gwProduct?.mainBreakerA ?? null,
    sccrA: intent.sccrA ?? null,
  };
  if (gateway.sccrA === null) {
    unresolved.push(
      `${gateway.label} in ${intent.label}: no interrupting rating established. It depends on the `
      + 'main breaker fitted, so it cannot be read off the product row — supply it from the '
      + 'manufacturer documentation for the breaker actually selected.');
  }

  const storage: StorageUnit[] = [];
  for (const [i, productId] of (intent.storageProductIds ?? []).entries()) {
    const p = getBatteryById(productId);
    if (!p) {
      unresolved.push(`No catalogue row for storage product '${productId}'.`);
      storage.push({
        id: `${intent.id}-ess-${i + 1}`, productId, role: 'inverter-unit',
        continuousOutputA: null, ocpdA: null, usableKwh: null,
      });
      continue;
    }
    const role = roleOf(p);
    if (role !== 'inverter-unit') {
      unresolved.push(
        `'${productId}' is an energy expansion and was listed as an inverter unit. An expansion is `
        + 'a DC extension of a host unit; it has no AC output and no breaker of its own.');
    }
    storage.push({
      id: `${intent.id}-ess-${i + 1}`,
      productId,
      label: `${p.manufacturer} ${p.model}`,
      role,
      continuousOutputA: p.maxContinuousOutputA ?? null,
      ocpdA: p.backfeedBreakerA ?? null,
      usableKwh: p.usableCapacityKwh ?? null,
    });
  }

  // 🚨 EACH EXPANSION IS HARNESSED TO A HOST AND CARRIES NO AC AT ALL. One per unit, paired by
  // index. A stray expansion with no host is left UNATTACHED on purpose — the engineering then
  // FAILS it, which is more useful than quietly attaching it to whatever happened to be first.
  const hosts = storage.filter(u => u.role === 'inverter-unit');
  for (const [i, productId] of (intent.expansionProductIds ?? []).entries()) {
    const p = getBatteryById(productId);
    if (!p) unresolved.push(`No catalogue row for expansion product '${productId}'.`);
    const host = hosts[i];
    if (!host) {
      unresolved.push(
        `Expansion ${i + 1} in ${intent.label} has no host inverter unit to attach to. An expansion `
        + 'connects to a host through the manufacturer\'s expansion harness; it cannot stand alone.');
    }
    storage.push({
      id: `${intent.id}-exp-${i + 1}`,
      productId,
      ...(p ? { label: `${p.manufacturer} ${p.model}` } : {}),
      role: 'energy-expansion',
      // Zero, not null: an expansion's AC contribution is KNOWN, and it is none.
      continuousOutputA: 0,
      ocpdA: null,
      usableKwh: p?.usableCapacityKwh ?? null,
      attachedToUnitId: host?.id ?? null,
    });
    if (p && roleOf(p) !== 'energy-expansion') {
      unresolved.push(
        `'${productId}' was listed as an expansion but the catalogue does not mark it as one. `
        + 'Treating an inverter-class unit as an expansion would drop its AC contribution from the '
        + 'busbar calculation.');
    }
  }

  return { gateway, storage, unresolved };
}

/** Add a backup domain: a gateway on a branch, backing up panels, with its storage. */
export function addBackupDomain(
  t: ServiceTopology,
  opts: {
    branchId: string;
    panelIds: string[];
    gatewayProductId: string;
    storageProductIds: string[];
    expansionProductIds?: string[];
    label?: string;
    storageConnection?: BackupDomain['storageConnection'];
  },
): { topology: ServiceTopology; domain: BackupDomain; unresolved: string[] } {
  const id = nextId(t.domains, 'domain');
  const label = opts.label ?? `Domain ${String.fromCharCode(65 + t.domains.length)}`;
  const build = buildDomainFromCatalogue({
    id, label,
    gatewayProductId: opts.gatewayProductId,
    storageProductIds: opts.storageProductIds,
    expansionProductIds: opts.expansionProductIds,
  });
  const domain: BackupDomain = {
    id, label,
    branchId: opts.branchId,
    gateway: build.gateway,
    backedUpPanelIds: opts.panelIds,
    storageUnitIds: build.storage.map(u => u.id),
    generationOutputA: 0,
    backedUpDemandA: null,
    storageConnection: opts.storageConnection ?? 'unresolved',
  };
  return {
    topology: {
      ...t,
      domains: [...t.domains, domain],
      storage: [...t.storage, ...build.storage],
    },
    domain,
    unresolved: build.unresolved,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EDITING WHAT IS ALREADY THERE.
//
// Ray: "Click MSP #1 and edit: bus rating, main breaker. Click Backup Domain 1 and edit: Gateway,
// Powerwall, Expansion, point of connection." So the visual builder needs to CHANGE nodes, not only
// append them — and every change is a pure function here for the same reason every addition is.
//
// 🚨 RE-EQUIPPING A DOMAIN GOES BACK THROUGH `buildDomainFromCatalogue`. Editing must not be a
// second way to resolve a device: a domain re-equipped from a dropdown and a domain created by the
// wizard have to be the same object, or the two paths begin to differ in exactly the numbers
// nobody re-checks.
// ═══════════════════════════════════════════════════════════════════════════

/** Patch the service itself. Fields left out are untouched. */
export function updateService(
  t: ServiceTopology,
  patch: Partial<ServiceTopology['service']> & { calculatedServiceDemandA?: number | null },
): ServiceTopology {
  const { calculatedServiceDemandA, ...service } = patch;
  return {
    ...t,
    service: { ...t.service, ...service },
    calculatedServiceDemandA: calculatedServiceDemandA === undefined
      ? t.calculatedServiceDemandA : calculatedServiceDemandA,
  };
}

export function updateBranch(
  t: ServiceTopology, branchId: string, patch: Partial<Omit<ServiceBranch, 'id'>>,
): ServiceTopology {
  return { ...t, branches: t.branches.map(b => (b.id === branchId ? { ...b, ...patch } : b)) };
}

export function updatePanel(
  t: ServiceTopology, panelId: string, patch: Partial<Omit<PanelBoard, 'id'>>,
): ServiceTopology {
  return { ...t, panels: t.panels.map(p => (p.id === panelId ? { ...p, ...patch } : p)) };
}

export function updateDomain(
  t: ServiceTopology,
  domainId: string,
  patch: Partial<Pick<BackupDomain, 'label' | 'branchId' | 'backedUpPanelIds' | 'storageConnection'
    | 'generationOutputA' | 'backedUpDemandA'>>,
): ServiceTopology {
  return { ...t, domains: t.domains.map(d => (d.id === domainId ? { ...d, ...patch } : d)) };
}

/**
 * Replace a domain's equipment.
 *
 * The domain's OLD storage units are dropped from `topology.storage` and the rebuilt ones take
 * their place — an edit that left the old units behind would leave the BOM counting batteries that
 * are no longer in any domain.
 */
export function setDomainEquipment(
  t: ServiceTopology,
  domainId: string,
  opts: { gatewayProductId?: string; storageProductIds: string[]; expansionProductIds?: string[] },
): { topology: ServiceTopology; unresolved: string[] } {
  const domain = t.domains.find(d => d.id === domainId);
  if (!domain) return { topology: t, unresolved: [`No domain '${domainId}' to re-equip.`] };

  const build = buildDomainFromCatalogue({
    id: domain.id,
    label: domain.label,
    gatewayProductId: opts.gatewayProductId ?? domain.gateway.productId,
    mainBreakerA: domain.gateway.mainBreakerA,
    sccrA: domain.gateway.sccrA,
    storageProductIds: opts.storageProductIds,
    expansionProductIds: opts.expansionProductIds,
  });
  const dropped = new Set(domain.storageUnitIds);
  return {
    topology: {
      ...t,
      storage: [...t.storage.filter(u => !dropped.has(u.id)), ...build.storage],
      domains: t.domains.map(d => (d.id === domainId
        ? { ...d, gateway: build.gateway, storageUnitIds: build.storage.map(u => u.id) }
        : d)),
    },
    unresolved: build.unresolved,
  };
}

/** Remove a domain and the storage that belonged to it. Its branch and panels stay. */
export function removeBackupDomain(t: ServiceTopology, domainId: string): ServiceTopology {
  const domain = t.domains.find(d => d.id === domainId);
  if (!domain) return t;
  const dropped = new Set(domain.storageUnitIds);
  return {
    ...t,
    domains: t.domains.filter(d => d.id !== domainId),
    storage: t.storage.filter(u => !dropped.has(u.id)),
  };
}

export function updateProtectiveDevice(
  t: ServiceTopology, deviceId: string, patch: Partial<Omit<ProtectiveDevice, 'id'>>,
): ServiceTopology {
  return { ...t, devices: t.devices.map(d => (d.id === deviceId ? { ...d, ...patch } : d)) };
}

export function removeProtectiveDevice(t: ServiceTopology, deviceId: string): ServiceTopology {
  return { ...t, devices: t.devices.filter(d => d.id !== deviceId) };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE DER SIDE: GENERATION, AGGREGATION, AND THE POINT OF INTERCONNECTION.
//
// Ray: "give SolarPro enough electrical vocabulary to represent and engineer it correctly." These
// are the operations that build that vocabulary into a real graph. Same rule as everything above:
// pure, no catalogue guesswork, no rating invented — a number this file does not know comes back
// null and the engineering names it.
// ═══════════════════════════════════════════════════════════════════════════

/** Add a PV inverter, a generator or any other non-storage DER source. */
export function addGenerationUnit(
  t: ServiceTopology,
  opts: {
    kind: GenerationUnit['kind'];
    label?: string;
    productId?: string | null;
    continuousOutputA?: number | null;
    ocpdA?: number | null;
    domainId?: string | null;
  },
): { topology: ServiceTopology; unit: GenerationUnit } {
  const id = nextId(t.generation ?? [], 'gen');
  const unit: GenerationUnit = {
    id,
    label: opts.label ?? `${opts.kind === 'pv-inverter' ? 'PV inverter' : opts.kind === 'generator' ? 'Generator' : 'DER source'} ${(t.generation ?? []).length + 1}`,
    productId: opts.productId ?? null,
    kind: opts.kind,
    // 🚨 NOT ZERO. A source whose output nobody stated has not been shown to contribute nothing.
    continuousOutputA: opts.continuousOutputA ?? null,
    ocpdA: opts.ocpdA ?? null,
    domainId: opts.domainId ?? null,
  };
  return { topology: { ...t, generation: [...(t.generation ?? []), unit] }, unit };
}

/**
 * Add a DER aggregation panel.
 *
 * 🚨 IT TAKES NO SERVICE RATING AND INFERS NONE. Every rating is passed in or left null; the panel
 * is sized from the sources that feed it by `sizeAggregationPanel`, and an operator who wants that
 * answer asks for it through `recommendAggregationRatings` rather than receiving it silently.
 */
export function addAggregationPanel(
  t: ServiceTopology,
  opts: {
    label?: string;
    carriesPremisesLoad?: boolean | null;
    busbarRatingA?: number | null;
    mainBreakerA?: number | null;
    mainLugOnly?: boolean;
    sccrA?: number | null;
    inputs?: Array<{ sourceId: string; tap?: DerTapPoint; ocpdA?: number | null }>;
    outputOcpdA?: number | null;
    outputConductorGauge?: string | null;
    feedsNodeId?: string | null;
  } = {},
): { topology: ServiceTopology; panel: DerAggregationPanel } {
  const existing = t.aggregationPanels ?? [];
  const id = nextId(existing, 'agg');
  const panel: DerAggregationPanel = {
    id,
    label: opts.label ?? `DER aggregation panel ${existing.length + 1}`,
    carriesPremisesLoad: opts.carriesPremisesLoad ?? null,
    busbarRatingA: opts.busbarRatingA ?? null,
    mainBreakerA: opts.mainBreakerA ?? null,
    mainLugOnly: opts.mainLugOnly ?? false,
    sccrA: opts.sccrA ?? null,
    inputs: (opts.inputs ?? []).map((input, i) => ({
      id: `${id}-in-${i + 1}`,
      sourceId: input.sourceId,
      // The default is the source's own output. The two tap points that change which rules apply
      // have to be said out loud.
      tap: input.tap ?? 'der-output',
      ocpdA: input.ocpdA ?? null,
    })),
    outputOcpdA: opts.outputOcpdA ?? null,
    outputConductorGauge: opts.outputConductorGauge ?? null,
    feedsNodeId: opts.feedsNodeId ?? null,
  };
  return { topology: { ...t, aggregationPanels: [...existing, panel] }, panel };
}

export function addAggregationInput(
  t: ServiceTopology, panelId: string,
  opts: { sourceId: string; tap?: DerTapPoint; ocpdA?: number | null },
): ServiceTopology {
  return {
    ...t,
    aggregationPanels: (t.aggregationPanels ?? []).map(p => p.id === panelId ? {
      ...p,
      inputs: [...p.inputs, {
        id: `${p.id}-in-${p.inputs.length + 1}`,
        sourceId: opts.sourceId,
        tap: opts.tap ?? 'der-output',
        ocpdA: opts.ocpdA ?? null,
      }],
    } : p),
  };
}

export function updateAggregationPanel(
  t: ServiceTopology, panelId: string, patch: Partial<Omit<DerAggregationPanel, 'id' | 'inputs'>>,
): ServiceTopology {
  return {
    ...t,
    aggregationPanels: (t.aggregationPanels ?? []).map(p => p.id === panelId ? { ...p, ...patch } : p),
  };
}

export function removeAggregationPanel(t: ServiceTopology, panelId: string): ServiceTopology {
  return {
    ...t,
    aggregationPanels: (t.aggregationPanels ?? []).filter(p => p.id !== panelId),
    // A point of interconnection that fed off it, and a device that fed it, stop pointing at
    // something that is gone. Leaving the reference would leave the graph naming a missing node.
    pointsOfInterconnection: (t.pointsOfInterconnection ?? []).map(poi =>
      poi.derNodeId === panelId ? { ...poi, derNodeId: null } : poi),
    devices: t.devices.map(d => d.feedsNodeId === panelId ? { ...d, feedsNodeId: null } : d),
  };
}

export function addPointOfInterconnection(
  t: ServiceTopology,
  opts: {
    relationship: PoiRelationship;
    label?: string;
    derNodeId?: string | null;
    connectedToNodeId?: string | null;
    ocpdA?: number | null;
  },
): { topology: ServiceTopology; poi: PointOfInterconnection } {
  const existing = t.pointsOfInterconnection ?? [];
  const id = nextId(existing, 'poi');
  const poi: PointOfInterconnection = {
    id,
    label: opts.label ?? `Point of interconnection ${existing.length + 1}`,
    relationship: opts.relationship,
    derNodeId: opts.derNodeId ?? null,
    connectedToNodeId: opts.connectedToNodeId ?? null,
    ocpdA: opts.ocpdA ?? null,
  };
  return { topology: { ...t, pointsOfInterconnection: [...existing, poi] }, poi };
}

export function updatePointOfInterconnection(
  t: ServiceTopology, poiId: string, patch: Partial<Omit<PointOfInterconnection, 'id'>>,
): ServiceTopology {
  return {
    ...t,
    pointsOfInterconnection: (t.pointsOfInterconnection ?? [])
      .map(p => p.id === poiId ? { ...p, ...patch } : p),
  };
}

export function removePointOfInterconnection(t: ServiceTopology, poiId: string): ServiceTopology {
  return {
    ...t,
    pointsOfInterconnection: (t.pointsOfInterconnection ?? []).filter(p => p.id !== poiId),
    devices: t.devices.map(d => d.feedsNodeId === poiId ? { ...d, feedsNodeId: null } : d),
  };
}

/** Record the DESIGN DECISION. It is never inferred from what equipment happens to be present. */
export function setDerArrangement(
  t: ServiceTopology, arrangement: ServiceTopology['interconnection']['derArrangement'],
): ServiceTopology {
  return { ...t, interconnection: { ...t.interconnection, derArrangement: arrangement } };
}

/** Place a protective device on a specific path rather than the default service chain. */
export function placeDevice(
  t: ServiceTopology, deviceId: string, feedsNodeId: string | null,
): ServiceTopology {
  return { ...t, devices: t.devices.map(d => d.id === deviceId ? { ...d, feedsNodeId } : d) };
}

export interface AggregationRecommendation {
  /** Σ of the sources feeding the panel. */
  aggregateContinuousA: number | null;
  /** The next standard OCPD at or above 125% of it. */
  outputOcpdA: number | null;
  /** The feeder for that OCPD, from the canonical conductor authority. */
  outputConductorGauge: string | null;
  /** A DER-only busbar has to carry the output; this is the smallest standard one that does. */
  busbarRatingA: number | null;
  /** Everything the recommendation could not be computed from, named. */
  requires: string[];
}

/**
 * What SolarPro CAN calculate about an aggregation panel.
 *
 * Ray's own split: the aggregation current, the panel's minimum electrical requirements, the
 * conductor and the OCPD are things SolarPro computes; the available fault current is the
 * utility's and the arrangement is the designer's. This is the first list, and nothing here is
 * applied to the graph until somebody asks for it — an authoring step that quietly sizes its own
 * equipment is a check that verifies its own arithmetic.
 */
export function recommendAggregationRatings(
  t: ServiceTopology, panelId: string,
): AggregationRecommendation {
  const panel = (t.aggregationPanels ?? []).find(p => p.id === panelId);
  if (!panel) {
    return {
      aggregateContinuousA: null, outputOcpdA: null, outputConductorGauge: null,
      busbarRatingA: null, requires: ['aggregation.panel'],
    };
  }
  const sizing = sizeAggregationPanel(t, panel);
  return {
    aggregateContinuousA: sizing.aggregateContinuousA,
    outputOcpdA: sizing.standardOcpdA,
    outputConductorGauge: sizing.outputConductorGauge,
    busbarRatingA: sizing.standardOcpdA === null ? null : nextStandardOcpd(sizing.standardOcpdA),
    requires: sizing.requires,
  };
}

/** Record the interconnection facts the jurisdiction and the project constrain. */
export function setInterconnection(
  t: ServiceTopology, patch: Partial<ServiceTopology['interconnection']>,
): ServiceTopology {
  return { ...t, interconnection: { ...t.interconnection, ...patch } };
}

/**
 * 🚨 THE DERIVED COMPATIBILITY PROJECTION, IN ONE PLACE.
 *
 * Legacy surfaces still read `mainPanelAmps` / `mainPanelBusAmps` / `mainBreakerAmps`. Where a
 * topology exists those numbers must be DERIVED from it, never entered beside it — a projection
 * that can disagree is not a projection. `docs/SERVICE-TOPOLOGY-SCALAR-AUDIT.md` classifies every
 * remaining consumer.
 *
 * It reports the primary (first) panel, and says how many it did NOT report, so a caller printing
 * one number knows it is printing one of several.
 */
export function legacyServiceScalars(t: ServiceTopology | null | undefined): {
  mainPanelAmps: number | null;
  mainPanelBusAmps: number | null;
  mainBreakerAmps: number | null;
  /** How many panels this projection does not describe. > 0 ⇒ the scalar is incomplete. */
  panelsNotRepresented: number;
} {
  const p = t?.panels?.[0] ?? null;
  return {
    mainPanelAmps: p?.busbarRatingA ?? null,
    mainPanelBusAmps: p?.busbarRatingA ?? null,
    mainBreakerAmps: p?.mainBreakerA ?? null,
    panelsNotRepresented: Math.max(0, (t?.panels?.length ?? 0) - 1),
  };
}
