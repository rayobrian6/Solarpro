// ═══════════════════════════════════════════════════════════════════════════
// TESLA — THE FIRST REAL PROVING CASE FOR THE SERVICE GRAPH.
//
// Ray: "Tesla is the first real proving case. The underlying architecture must support 400 A /
// 600 A / larger multi-panel services where legitimate, multiple MSPs, multiple backup systems,
// multiple inverters, multiple gateways/controllers, partial backup domains, mixed backed-up and
// non-backed-up loads. **Manufacturer adapters supply the actual device rules. The service graph
// itself is generic.**"
//
// So this file knows about Tesla and `lib/electrical/serviceTopology.ts` does not. It turns a
// designer's intent — "two Gateway 3, two Powerwall 3, one Expansion each, split across two 200 A
// panels" — into the generic graph, taking every electrical number from the equipment catalogue.
//
// 🚨 RATINGS COME FROM THE CATALOGUE, NOT FROM A PROMPT AND NOT FROM THIS FILE. There is no `200`
// written here. `tesla-backup-gateway-3` states its own continuous rating, and if that row is
// missing or silent this adapter leaves the field null so the topology reports NOT_EVALUATED.
// A number typed into an adapter is a second equipment authority.
//
// 🚨 AND WHAT TESLA HAS NOT TOLD US IS SAID OUT LOUD. Multi-gateway METERING, CT assignment,
// gateway coordination and commissioning are governed by Tesla's "Multiple Backup Gateways on a
// Single Site" application note, which lives behind the Partner Portal and is NOT in this
// repository. It is registered in `lib/manufacturer-assets-db.ts` with `verified: false`, and this
// adapter surfaces that state rather than inventing "Gateway #1 is master" or "add both Meter Z
// values".
// ═══════════════════════════════════════════════════════════════════════════

import {
  getBatteryById, getBackupInterfaceById,
  type BatterySystem, type BackupInterface,
} from '@/lib/equipment-db';
import { MANUFACTURER_ASSETS } from '@/lib/manufacturer-assets-db';
import type {
  GatewayInstance, StorageUnit, ManufacturerDocumentState, StorageRole,
} from '@/lib/electrical/serviceTopology';

/** The catalogue id of the application note that governs multi-gateway sites. */
export const TESLA_MULTI_GATEWAY_DOC_ID = 'application_note:tesla-multiple-backup-gateways';

/**
 * What a designer says they want, per backup domain. Nothing electrical — that is looked up.
 */
export interface TeslaDomainIntent {
  /** Stable id for the domain, e.g. 'domain-a'. */
  id: string;
  label: string;
  /** Catalogue id of the gateway product, e.g. 'tesla-backup-gateway-3'. */
  gatewayProductId: string;
  /**
   * The main breaker actually fitted in this gateway.
   *
   * 🚨 AN INSTANCE PROPERTY, NOT A PRODUCT ONE. The gateway accepts a range of service-rated mains,
   * and the supported interrupting rating follows the breaker that is fitted — which is why the
   * catalogue row states no SCCR and `sccrA` below is a per-instance number.
   */
  mainBreakerA?: number | null;
  /** Interrupting rating supported with that breaker, where it has been established. */
  sccrA?: number | null;
  /** Catalogue ids of the inverter-class storage units in this domain, e.g. Powerwall 3. */
  storageProductIds: string[];
  /** Catalogue ids of the energy expansions, each harnessed to one of the units above. */
  expansionProductIds?: string[];
}

export interface TeslaDomainBuild {
  gateway: GatewayInstance;
  storage: StorageUnit[];
  /** Anything the catalogue could not answer, named rather than defaulted. */
  unresolved: string[];
}

const roleOf = (b: BatterySystem): StorageRole =>
  b.storageRole === 'energy-expansion' ? 'energy-expansion' : 'inverter-unit';

/**
 * Build one backup domain's gateway and storage from catalogue ids.
 *
 * Every number is looked up. Anything the catalogue does not state comes back null AND is named in
 * `unresolved`, so the caller can show the operator what to supply instead of discovering later
 * that a check silently passed.
 */
export function buildTeslaDomain(intent: TeslaDomainIntent): TeslaDomainBuild {
  const unresolved: string[] = [];

  const gwProduct: BackupInterface | undefined = getBackupInterfaceById(intent.gatewayProductId);
  if (!gwProduct) {
    unresolved.push(
      `No catalogue row for gateway '${intent.gatewayProductId}'. Its continuous rating, service-`
      + 'entrance rating and main breaker are UNRESOLVED. Add the product from its manufacturer '
      + 'documentation rather than assuming a typical value.');
  }

  const gateway: GatewayInstance = {
    id: `${intent.id}-gateway`,
    productId: intent.gatewayProductId,
    label: gwProduct ? `${gwProduct.manufacturer} ${gwProduct.model}` : intent.gatewayProductId,
    continuousRatingA: gwProduct?.maxContinuousOutputA ?? null,
    serviceEntranceRated: gwProduct?.serviceEntranceRated ?? null,
    // The breaker the designer fitted, falling back to the product's stated maximum.
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

  // ── EXPANSIONS ────────────────────────────────────────────────────────────
  //
  // 🚨 EACH ONE IS HARNESSED TO A HOST, AND CARRIES NO AC AT ALL. Ray's arrangement is one
  // Expansion per Powerwall, so they pair by index; a design with a different pairing states it by
  // giving the host explicitly. A stray expansion with no host is left unattached ON PURPOSE —
  // `storage.expansion-has-a-host` then FAILS, which is more useful than quietly attaching it to
  // whatever happened to be first.
  const hosts = storage.filter(u => u.role === 'inverter-unit');
  for (const [i, productId] of (intent.expansionProductIds ?? []).entries()) {
    const p = getBatteryById(productId);
    if (!p) {
      unresolved.push(`No catalogue row for expansion product '${productId}'.`);
    }
    const host = hosts[i];
    if (!host) {
      unresolved.push(
        `Expansion ${i + 1} in ${intent.label} has no host inverter unit to attach to. Tesla's `
        + 'Expansion Harness connects an Expansion to a Powerwall; it cannot stand alone.');
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

/**
 * The manufacturer-document state for a multi-gateway Tesla site.
 *
 * Read out of the asset registry, so flipping `verified` there is what changes the answer —
 * there is no second place that decides whether SolarPro "has" the document.
 */
export function teslaMultiGatewayDocState(): ManufacturerDocumentState {
  const asset = MANUFACTURER_ASSETS.find(a => a.id === TESLA_MULTI_GATEWAY_DOC_ID);
  return {
    title: asset?.docTitle ?? 'Multiple Backup Gateways on a Single Site — Application Note',
    source: asset?.sourceUrl ?? 'Tesla Partner Portal',
    // An archived copy is what makes it producible for a reviewer; a URL is where it WAS.
    present: Boolean(asset?.verified && asset?.archivedPath),
    governs: [
      'site metering across gateways',
      'CT assignment',
      'gateway coordination',
      'commissioning',
      'multi-gateway behaviour during an island',
    ],
  };
}
