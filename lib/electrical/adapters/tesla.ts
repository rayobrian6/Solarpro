// ═══════════════════════════════════════════════════════════════════════════
// TESLA — THE FIRST REAL PROVING CASE FOR THE SERVICE GRAPH.
//
// Ray: "Tesla is the first real proving case. The underlying architecture must support 400 A /
// 600 A / larger multi-panel services where legitimate, multiple MSPs, multiple backup systems,
// multiple inverters, multiple gateways/controllers, partial backup domains, mixed backed-up and
// non-backed-up loads. **Manufacturer adapters supply the actual device rules. The service graph
// itself is generic.**"
//
// 🚨 SO THIS FILE IS SMALL, AND IT GOT SMALLER ON PURPOSE.
//
// The catalogue lookups and the expansion-pairing rule are GENERIC — an operator building a domain
// by hand in the engineering UI needs exactly the same behaviour — so they live in
// `lib/electrical/topologyAuthoring.ts` and `buildTeslaDomain` delegates to them. This adapter had
// its own copy first, and two copies of the same lookups is how a UI-built domain and a
// fixture-built one begin to differ.
//
// What is actually Tesla-specific is what remains: the application note that governs multi-gateway
// sites, and the fact that SolarPro does not hold it.
//
// 🚨 RATINGS COME FROM THE CATALOGUE, NOT FROM A PROMPT AND NOT FROM THIS FILE. There is no `200`
// written here. `tesla-backup-gateway-3` states its own continuous rating, and if that row is
// missing or silent the builder leaves the field null so the topology reports NOT_EVALUATED.
// ═══════════════════════════════════════════════════════════════════════════

import { MANUFACTURER_ASSETS } from '@/lib/manufacturer-assets-db';
import type { ManufacturerDocumentState } from '@/lib/electrical/serviceTopology';
import {
  buildDomainFromCatalogue, type DomainIntent, type DomainBuild,
} from '@/lib/electrical/topologyAuthoring';

/** The catalogue id of the application note that governs multi-gateway sites. */
export const TESLA_MULTI_GATEWAY_DOC_ID = 'application_note:tesla-multiple-backup-gateways';

/**
 * What a designer says they want, per backup domain. Nothing electrical — that is looked up.
 *
 * A Tesla domain is: a Backup Gateway product id, one or more Powerwall product ids, and an
 * Expansion product id per Powerwall that has one. `mainBreakerA` and `sccrA` are INSTANCE
 * properties — the gateway accepts a range of service-rated mains and its supported interrupting
 * rating follows the breaker actually fitted, which is why the catalogue row states no SCCR.
 */
export type TeslaDomainIntent = DomainIntent;
export type TeslaDomainBuild = DomainBuild;

/** Resolve a Tesla backup domain from catalogue ids. Generic machinery, named for its use. */
export function buildTeslaDomain(intent: TeslaDomainIntent): TeslaDomainBuild {
  return buildDomainFromCatalogue(intent);
}

/**
 * The manufacturer-document state for a multi-gateway Tesla site.
 *
 * 🚨 READ OUT OF THE ASSET REGISTRY, so archiving the document and flipping `verified` there is
 * what changes the answer — there is no second place that decides whether SolarPro "has" it.
 *
 * Tesla's design guidance says multiple Gateways may be used where service equipment exceeds 200 A
 * and refers installers to this note for the rules. It is behind the Partner Portal, so it is not
 * in this repository, and SolarPro will not invent "Gateway #1 is master" or sum meter values
 * across gateways in its absence.
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
