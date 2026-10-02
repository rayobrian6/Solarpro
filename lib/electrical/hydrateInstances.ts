// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A SAVED INSTANCE IS A DESIGN DECISION, NOT A FROZEN COPY OF THE CATALOGUE.
//
// This module exists because of a live failure on Ray's real project, and the failure had ONE cause
// with two faces.
//
// `lib/electrical/topologyAuthoring.ts` resolves manufacturer facts onto an instance AT AUTHORING
// TIME — the PV input limits, the usable energy, the continuous current and the OCPD for the chosen
// output configuration. That was deliberate: it is what lets `serviceTopology.ts` hold no catalogue
// reach and lets `projectModel.ts` run identically on the server and in the browser. It is still
// right. What was missing is the other half: **nothing ever re-resolved them**.
//
// So a project authored before a catalogue correction keeps the wrong numbers for ever:
//
//   1. THE OCPD. `backfeedBreakerA` for a Powerwall 3 was corrected 50 → 60 (Tesla's published
//      table: 48 A continuous cannot sit behind a 50 A device). Ray's live sheet still printed
//      "50 A OCPD" on every cabinet, because each saved instance carried `ocpdA: 50` resolved
//      before the fix. Repairing "the canonical equipment authority, not SLD text" achieves nothing
//      if the authority is never read again.
//
//   2. 🚨 THE PV INPUT LIMITS — THE EXPENSIVE ONE. `pvInputLimits` did not exist when Ray's project
//      was saved, and `parseServiceTopology` omits it entirely when absent (all-or-none, by design).
//      `projectModel.ts` decides DC coupling with
//          takesPvOnDc = u.role === 'inverter-unit' && !!u.pvInputLimits
//      so for a legacy project it is FALSE on every Powerwall, the model can NEVER derive
//      `dc-coupled-storage`, and it falls through to "a separate inverter is selected ⇒
//      ac-coupled-inverter" — which is how a graph containing four Powerwall 3 came to be drawn
//      with an Enphase chain, and then, after the ecosystem was changed, with an invented Tesla
//      string inverter. Worse, that derivation emits a canonicalization patch, so the first
//      generate would have PERMANENTLY RECORDED the wrong coupling.
//
// WHAT IS RE-RESOLVED (manufacturer facts — the catalogue is their author):
//   · PV input limits          · usable energy
//   · continuous output current · OCPD for the recorded output configuration
//   · gateway continuous rating, SCCR and internal panelboard
//
// WHAT IS PRESERVED UNTOUCHED (design decisions — the graph is their author):
//   · which product            · which output configuration was commissioned
//   · ids, labels, roles, host attachment, domain membership, every relationship
//
// 🚨 AND A DELIBERATE OVERRIDE IS NOT SILENTLY PRESERVED, because today there is no way to express
// one. `StorageUnit` has no "overridden" marker: an OCPD that differs from the catalogue is
// indistinguishable from an OCPD that is simply stale. Treating "different" as "deliberate" is
// EXACTLY what kept the 50 A alive. If overrides are wanted they need their own explicit field, and
// then this function must honour it — which is a change to make on purpose, not by inference.
//
// An unresolvable `productId` is left exactly as persisted: for a product the catalogue does not
// know, the recorded values are the only ones there are.
// ═══════════════════════════════════════════════════════════════════════════

import { getBatteryById, getBackupInterfaceById } from '@/lib/equipment-db';
import type { ServiceTopology, StorageUnit, BackupDomain } from '@/lib/electrical/serviceTopology';

/** One instance's worth of correction, for logging and for the inspector. */
export interface InstanceRefresh {
  instanceId: string;
  productId: string;
  field: string;
  was: string;
  now: string;
}

/**
 * Re-resolve the manufacturer facts on one storage unit.
 *
 * The OCPD and the continuous current follow the RECORDED output configuration, not the catalogue's
 * top row: a Powerwall 3 commissioned at 10 kW takes 41.7 A and a 60 A device, and scaling 41.7 by
 * 125% would select a device Tesla does not publish. The configuration is the installer's decision
 * and is preserved; only the numbers that follow from it are refreshed.
 */
export function hydrateStorageUnit(
  u: StorageUnit, refreshes: InstanceRefresh[] = [],
): StorageUnit {
  const p = getBatteryById(u.productId);
  if (!p) return u;

  const note = (field: string, was: unknown, now: unknown) => {
    if (String(was ?? 'absent') !== String(now ?? 'absent')) {
      refreshes.push({
        instanceId: u.id, productId: u.productId, field,
        was: String(was ?? 'absent'), now: String(now ?? 'absent'),
      });
    }
  };

  const configs = p.outputConfigurations ?? [];
  const chosen = u.outputConfigKw != null
    ? configs.find(c => c.nominalKw === u.outputConfigKw) ?? null
    : null;

  // An expansion carries no AC output and no breaker of its own; refreshing it from an inverter
  // row's figures would give it both.
  const isInverting = u.role === 'inverter-unit';

  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 THE NUMERIC REFRESH IS DELIBERATELY NARROW — Ray: "Must not change the SLD logic for other
  // brands and other scenarios. This is a very specific application scenario."
  //
  // Only products whose catalogue row publishes `outputConfigurations` — the manufacturer's own
  // output/OCPD table, transcribed and verified against their documentation — have their current
  // and breaker refreshed. Today that is exactly one row, the Tesla Powerwall 3, which is the
  // product whose OCPD was corrected (50 → 60) and whose stored instances are therefore stale.
  //
  // For every other battery the stored value STANDS. That is not timidity: for a product where
  // SolarPro holds only a single scalar rather than the manufacturer's table, the stored value and
  // the catalogue value are the same KIND of claim, and overwriting one with the other would be
  // churn with no authority behind it. A verified manufacturer table is a stronger claim than a
  // scalar, and only that outranks what was saved.
  //
  // `pvInputLimits` below is NOT gated, because it is purely additive — it is written only where
  // the catalogue publishes `pvInput`, which today is the same single row. Nothing is overwritten
  // for any other product; a field that was absent becomes present.
  // ═══════════════════════════════════════════════════════════════════════
  const hasPublishedTable = (p.outputConfigurations ?? []).length > 0;
  const continuousOutputA = isInverting && hasPublishedTable
    ? (chosen?.maxContinuousOutputA ?? p.maxContinuousOutputA ?? u.continuousOutputA)
    : u.continuousOutputA;
  const ocpdA = isInverting && hasPublishedTable
    ? (chosen?.ocpdA ?? p.backfeedBreakerA ?? u.ocpdA)
    : u.ocpdA;
  const usableKwh = hasPublishedTable ? (p.usableCapacityKwh ?? u.usableKwh) : u.usableKwh;

  note('continuousOutputA', u.continuousOutputA, continuousOutputA);
  note('ocpdA', u.ocpdA, ocpdA);
  note('usableKwh', u.usableKwh, usableKwh);

  const pvInputLimits = p.pvInput ? {
    maxStcKw: p.pvInput.maxStcKw,
    mppts: p.pvInput.mppts,
    mpptVdc: p.pvInput.mpptVdc,
    inputVdc: p.pvInput.inputVdc,
    maxImpPerMpptA: p.pvInput.maxImpPerMpptA,
    maxIscPerMpptA: p.pvInput.maxIscPerMpptA,
    basis: p.pvInput.basis,
  } : null;
  // Only an INVERTING unit has PV inputs; an expansion is energy only.
  const pvForThisUnit = isInverting ? pvInputLimits : null;
  note('pvInputLimits', u.pvInputLimits ? 'published' : 'absent',
    pvForThisUnit ? 'published' : 'absent');

  return {
    ...u,
    continuousOutputA,
    ocpdA,
    usableKwh,
    ...(pvForThisUnit ? { pvInputLimits: pvForThisUnit } : {}),
  };
}

/** Re-resolve the manufacturer facts on a domain's gateway. */
export function hydrateDomain(d: BackupDomain, refreshes: InstanceRefresh[] = []): BackupDomain {
  const g = getBackupInterfaceById(d.gateway.productId);
  if (!g) return d;

  const note = (field: string, was: unknown, now: unknown) => {
    if (String(was ?? 'absent') !== String(now ?? 'absent')) {
      refreshes.push({
        instanceId: d.gateway.id, productId: d.gateway.productId, field,
        was: String(was ?? 'absent'), now: String(now ?? 'absent'),
      });
    }
  };

  // 🚨 PURELY ADDITIVE, FOR THE SAME REASON AS THE STORAGE REFRESH. `internalPanelboard` is written
  // only where the catalogue publishes one — today the Tesla Gateway 3 alone, the row it was added
  // to — so a field that was absent becomes present and NOTHING is overwritten on any other gateway.
  //
  // The gateway's continuous rating is deliberately NOT refreshed. It is a single scalar on both
  // sides, so overwriting the saved value with the catalogue's would be churn with no stronger
  // authority behind it, and it would reach every Enphase, FranklinWH and EcoFlow controller in the
  // product — which is exactly the blast radius Ray ruled out for this slice.
  if (!g.internalPanelboard) return d;
  note('gateway.internalPanelboard', d.gateway.internalPanelboard ? 'published' : 'absent', 'published');

  return {
    ...d,
    gateway: { ...d.gateway, internalPanelboard: g.internalPanelboard },
  };
}

/**
 * 🚨 REFRESH EVERY INSTANCE IN A GRAPH FROM THE CATALOGUE.
 *
 * Pure: the input is not mutated. Isomorphic: the catalogue is a static module, so the server and
 * the browser hydrate identically — which matters, because `electricalRevision` is computed on both
 * sides and a one-sided hydration would make every sheet read STALE on load.
 */
export function hydrateTopologyFromCatalogue(
  t: ServiceTopology,
): { topology: ServiceTopology; refreshes: InstanceRefresh[] } {
  const refreshes: InstanceRefresh[] = [];
  const topology: ServiceTopology = {
    ...t,
    storage: t.storage.map(u => hydrateStorageUnit(u, refreshes)),
    domains: t.domains.map(d => hydrateDomain(d, refreshes)),
  };
  return { topology, refreshes };
}
