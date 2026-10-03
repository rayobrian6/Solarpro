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
  ExistingServiceEquipment, LoadModel, LoadCalculationMethod, SolarCoupling,
} from '@/lib/electrical/serviceTopology';
import { sizeAggregationPanel, servicePhaseInfo } from '@/lib/electrical/serviceTopology';
import { nextStandardOcpd } from '@/lib/electrical/stdSizes';

/** A new, empty service. Branches, panels and domains are added onto it. */
export function createServiceTopology(opts: {
  ratedAmps: number;
  voltage?: number;
  phase?: ServicePhase;
  utilityId?: string | null;
}): ServiceTopology {
  const phase = opts.phase ?? 'split-240';
  return {
    service: {
      ratedAmps: opts.ratedAmps,
      // 🚨 THE VOLTAGE FOLLOWS THE PHASE. `?? 240` alone built an 800 A 480Y/277 V service at 240 V
      // whenever the caller named the phase and not the voltage. The last 240 is reachable only for
      // 'custom' with no voltage given, the same documented fallback the stored-graph reader uses.
      voltage: opts.voltage ?? servicePhaseInfo(phase).lineToLineV ?? 240,
      phase,
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
    // 🚨 WHAT AN ELECTRICIAN CALLS IT, BECAUSE THE LABEL IS WHAT EVERY SURFACE PRINTS. Ray, after
    // building the thing himself: "Installer-facing UI currently contains things such as: Branch A,
    // Branch B, BACKUP DOMAIN, Domain A... I built the system and even I have to stop and think
    // about what the screen wants from me." There is no translation layer for this — a second name
    // beside the first is how a sheet and a screen start disagreeing. The name IS the fix.
    label: opts.label
      ?? `${opts.ratedAmps} A service path ${t.branches.length + 1}`,
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
    /** Put it in line ahead of this node, so opening it interrupts that node's supply. */
    inlineOnNodeId?: string | null;
    /** The node toward the utility, when it is not the default service chain. */
    feedsNodeId?: string | null;
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
    ...(opts.inlineOnNodeId ? { inlineOnNodeId: opts.inlineOnNodeId } : {}),
    ...(opts.feedsNodeId ? { feedsNodeId: opts.feedsNodeId } : {}),
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
  /**
   * The output configuration the storage units are commissioned at, for a configurable product.
   *
   * Absent ⇒ the catalogue's top row. Named ⇒ that published row is used for BOTH the continuous
   * current and the OCPD, and a setting the product does not publish is reported rather than
   * rounded to the nearest one.
   */
  outputConfigKw?: number | null;
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
    // Resolved onto the instance from the catalogue, like the continuous rating beside it.
    ...(gwProduct?.internalPanelboard
      ? { internalPanelboard: { ...gwProduct.internalPanelboard } } : {}),
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
    // 🚨 THE CONFIGURED OUTPUT, WHERE THE PRODUCT HAS CONFIGURATIONS.
    //
    // A Powerwall 3 is commissioned at 5.8 / 7.6 / 10 / 11.5 kW and BOTH its continuous current and
    // its required OCPD move with that setting. Reading the row the manufacturer published is the
    // only way to get 10 kW → 60 A right: scaling 41.7 A by 125% gives 52 A and would select a
    // device Tesla does not specify.
    const wantKw = intent.outputConfigKw ?? null;
    const configs = p.outputConfigurations ?? [];
    const chosen = wantKw === null ? null
      : configs.find(c => c.nominalKw === wantKw) ?? null;
    if (wantKw !== null && configs.length > 0 && !chosen) {
      unresolved.push(
        `${p.manufacturer} ${p.model} has no ${wantKw} kW output configuration. The published `
        + `settings are ${configs.map(c => `${c.nominalKw} kW`).join(', ')}.`);
    }
    storage.push({
      id: `${intent.id}-ess-${i + 1}`,
      productId,
      label: `${p.manufacturer} ${p.model}`,
      role,
      continuousOutputA: chosen?.maxContinuousOutputA ?? p.maxContinuousOutputA ?? null,
      ocpdA: chosen?.ocpdA ?? p.backfeedBreakerA ?? null,
      usableKwh: p.usableCapacityKwh ?? null,
      ...(chosen ? { outputConfigKw: chosen.nominalKw } : {}),
      // Resolved onto the instance so the DC-coupling check has the manufacturer's limits without
      // this file's catalogue reach leaking into `serviceTopology.ts`.
      ...(p.pvInput ? {
        pvInputLimits: {
          maxStcKw: p.pvInput.maxStcKw,
          mppts: p.pvInput.mppts,
          mpptVdc: p.pvInput.mpptVdc,
          inputVdc: p.pvInput.inputVdc,
          maxImpPerMpptA: p.pvInput.maxImpPerMpptA,
          maxIscPerMpptA: p.pvInput.maxIscPerMpptA,
          basis: p.pvInput.basis,
        },
      } : {}),
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
    /** The output setting the storage units are commissioned at, for a configurable product. */
    outputConfigKw?: number | null;
  },
): { topology: ServiceTopology; domain: BackupDomain; unresolved: string[] } {
  const id = nextId(t.domains, 'domain');
  // "System 1", not "Domain A". A backup domain IS one of the installer's systems — a gateway, its
  // batteries and the panel behind it — and "domain" is the word the graph uses for it, not the
  // word on the job. Same reasoning as the branch label above.
  const label = opts.label ?? `System ${t.domains.length + 1}`;
  const build = buildDomainFromCatalogue({
    id, label,
    gatewayProductId: opts.gatewayProductId,
    storageProductIds: opts.storageProductIds,
    expansionProductIds: opts.expansionProductIds,
    outputConfigKw: opts.outputConfigKw ?? null,
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
  opts: {
    gatewayProductId?: string; storageProductIds: string[]; expansionProductIds?: string[];
    /** The output setting the units are commissioned at. Omitted ⇒ the catalogue's top row. */
    outputConfigKw?: number | null;
  },
): { topology: ServiceTopology; unresolved: string[] } {
  const domain = t.domains.find(d => d.id === domainId);
  if (!domain) return { topology: t, unresolved: [`No domain '${domainId}' to re-equip.`] };

  // 🚨 A DIFFERENT CONTROLLER IS A DIFFERENT INSTANCE. The main breaker fitted and the interrupting
  // rating it gives were established on the product that was there; carried onto another product
  // they are stale facts that read as established. Same product ⇒ kept; new product ⇒ its own
  // catalogue main breaker and an interrupting rating that is not established until somebody says.
  const gatewayProductId = opts.gatewayProductId ?? domain.gateway.productId;
  const sameGateway = gatewayProductId === domain.gateway.productId;
  const build = buildDomainFromCatalogue({
    id: domain.id,
    label: domain.label,
    gatewayProductId,
    mainBreakerA: sameGateway ? domain.gateway.mainBreakerA : null,
    sccrA: sameGateway ? domain.gateway.sccrA : null,
    storageProductIds: opts.storageProductIds,
    expansionProductIds: opts.expansionProductIds,
    outputConfigKw: opts.outputConfigKw ?? null,
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
    /** The system this panel belongs to. Omitted ⇒ a site-wide panel owned by no one domain. */
    domainId?: string | null;
    /** The catalogue panelboard selected for it, when one has been. */
    productId?: string | null;
  } = {},
): { topology: ServiceTopology; panel: DerAggregationPanel } {
  const existing = t.aggregationPanels ?? [];
  const id = nextId(existing, 'agg');
  const panel: DerAggregationPanel = {
    id,
    label: opts.label ?? `DER aggregation panel ${existing.length + 1}`,
    ...(opts.domainId ? { domainId: opts.domainId } : {}),
    ...(opts.productId ? { productId: opts.productId } : {}),
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

/**
 * Record how the PV is coupled — the project-level answer every other surface defers to.
 *
 * 🚨 ONE WRITER, ONE FIELD. The whole point of `SolarCoupling` is that the drawing and the sidebar
 * stop inferring it; a second place to store it would restore the contradiction with extra steps.
 */
export function setSolarCoupling(
  t: ServiceTopology, coupling: SolarCoupling | null,
): ServiceTopology {
  return { ...t, solarCoupling: coupling };
}

/** Name the catalogue panelboard selected for a generation / aggregation panel. */
export function selectAggregationProduct(
  t: ServiceTopology, panelId: string, productId: string | null,
): ServiceTopology {
  return {
    ...t,
    aggregationPanels: (t.aggregationPanels ?? []).map(
      p => p.id === panelId ? { ...p, productId } : p),
  };
}

/**
 * Assign PV STC capacity to one storage unit's own DC inputs.
 *
 * 🚨 THE DESIGN SAYS THIS, NOT A DIVISION. There is deliberately no "spread the array over the
 * units" helper: Ray's instruction is "Do not arbitrarily do equal string counts simply because
 * there are four batteries", and a convenience function that did it would be the fastest route
 * back to a symmetrical drawing of a system nobody is installing.
 */
export function setStoragePvInput(
  t: ServiceTopology, unitId: string, stcKw: number | null,
): ServiceTopology {
  return {
    ...t,
    storage: t.storage.map(u => u.id === unitId ? { ...u, pvDcStcKw: stcKw } : u),
  };
}

/** Place a protective device on a specific path rather than the default service chain. */
export function placeDevice(
  t: ServiceTopology, deviceId: string, feedsNodeId: string | null,
): ServiceTopology {
  return { ...t, devices: t.devices.map(d => d.id === deviceId ? { ...d, feedsNodeId } : d) };
}

/**
 * Put a device IN LINE ahead of a node, so opening it actually interrupts that node's supply.
 *
 * 🚨 THE DIFFERENCE BETWEEN A SWITCH IN THE PATH AND A SWITCH BESIDE IT. `placeDevice` names what a
 * device feeds; this names what it interrupts, and the connection graph re-routes the existing
 * conductor through it. Ray's two knife switches, one per 200 A path, are exactly this and cannot
 * be expressed by the other one.
 */
export function placeDeviceInline(
  t: ServiceTopology, deviceId: string, inlineOnNodeId: string | null,
): ServiceTopology {
  return {
    ...t,
    devices: t.devices.map(d => (d.id === deviceId ? { ...d, inlineOnNodeId } : d)),
  };
}

/**
 * Record the catalogue part selected to meet a device's engineered requirement.
 *
 * 🚨 A NEW PART BRINGS ITS OWN NUMBERS. The device's `ratedAmps` / `sccrA` before a part is chosen are
 * a seed (the service or path rating an arrangement copied in) or the previous part's nameplate; kept
 * across a part change, the engine's in-line rating check PASSed the new part against a copy of the
 * requirement itself, and every screen printed the seed as the part's rating. So when the part
 * changes, both are cleared unless this same write states them — read off the part. Every editor of
 * the graph (System Config, the Service Topology inspector) goes through here.
 */
export function selectDeviceProduct(
  t: ServiceTopology, deviceId: string, productId: string | null,
  partRatings: { ratedAmps?: number | null; sccrA?: number | null } = {},
): ServiceTopology {
  return {
    ...t,
    devices: t.devices.map(d => {
      if (d.id !== deviceId) return d;
      const changed = (productId ?? null) !== (d.productId ?? null);
      return {
        ...d,
        productId,
        ratedAmps: partRatings.ratedAmps !== undefined ? partRatings.ratedAmps : changed ? null : d.ratedAmps,
        sccrA: partRatings.sccrA !== undefined ? partRatings.sccrA : changed ? null : d.sccrA,
      };
    }),
  };
}

/**
 * Declare the service equipment as EXISTING, and patch what has been read off it.
 *
 * Passing `null` says the service equipment is new, which is what removes the field-verification
 * item — not filling the fields in with guesses.
 */
export function setExistingServiceEquipment(
  t: ServiceTopology,
  patch: Partial<ExistingServiceEquipment> | null,
): ServiceTopology {
  if (patch === null) {
    return { ...t, service: { ...t.service, existingEquipment: null } };
  }
  const current: ExistingServiceEquipment = t.service.existingEquipment ?? {
    manufacturer: null, catalogNumber: null, mainArrangement: null,
    feederArrangement: null, sccrA: null, verified: false,
  };
  return { ...t, service: { ...t.service, existingEquipment: { ...current, ...patch } } };
}

/**
 * Attach (or clear) the optional dwelling load calculation.
 *
 * 🚨 CLEARING IT IS A LEGITIMATE STATE, NOT A REGRESSION. Ray's product decision: a design is
 * completable without a load inventory, so removing the model must leave a topology that still
 * draws, bills and permits — with the load checks reporting NOT_EVALUATED once.
 */
export function setLoadModel(t: ServiceTopology, loads: LoadModel | null): ServiceTopology {
  return { ...t, loads };
}

/** Record calculated demand for one panelboard inside the load model, creating it if needed. */
export function setPanelLoad(
  t: ServiceTopology, panelId: string, calculatedDemandA: number | null,
  opts: { method?: LoadCalculationMethod; basis?: string } = {},
): ServiceTopology {
  const current = t.loads ?? {
    method: opts.method ?? 'optional-220-82',
    basis: opts.basis ?? '',
    byPanel: [],
    otherDemandA: null,
  };
  const byPanel = calculatedDemandA === null
    ? current.byPanel.filter(l => l.panelId !== panelId)
    : current.byPanel.some(l => l.panelId === panelId)
      ? current.byPanel.map(l => (l.panelId === panelId ? { ...l, calculatedDemandA } : l))
      : [...current.byPanel, { panelId, calculatedDemandA }];
  return {
    ...t,
    loads: {
      ...current,
      ...(opts.method ? { method: opts.method } : {}),
      ...(opts.basis !== undefined ? { basis: opts.basis } : {}),
      byPanel,
    },
  };
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
