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
} from '@/lib/electrical/serviceTopology';

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
    calculatedServiceDemandA: null,
    interconnection: {
      utilityId: opts.utilityId ?? null,
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
