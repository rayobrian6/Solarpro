// ═══════════════════════════════════════════════════════════════════════════
// 🚨 WHICH ELECTRICAL PROJECT DID THIS DRAWING COME FROM?
//
// Ray, after the authority audit: "Generated electrical artifacts must carry the project/electrical
// revision they were generated from. If the project changes after SLD generation, the UI must
// identify the drawing as stale rather than silently presenting it as current. An old generated SLD
// must never become input authority for a new calculation."
//
// Both halves of that need the same thing: a NAME for the electrical state. Without one, "is this
// sheet current?" is unanswerable, and the audit found the answer being guessed from a timestamp —
// which says when the file was written, not what it was written FROM.
//
// WHAT THIS IS NOT. It is not a new authority and not a new store. It is a pure function of the
// canonical model, so it cannot drift from the model the way a persisted `revision` column would:
// there is nothing to forget to bump.
//
// 🚨 IT COVERS THE ELECTRICAL FACTS AND DELIBERATELY NOTHING ELSE. A label, a note, a cosmetic
// relabelling of a branch must NOT mark every sheet in the project stale — if the fingerprint moves
// for reasons an engineer would not call a change, people learn to ignore the stale badge, and a
// badge nobody reads is worse than no badge. So the inputs are enumerated by hand below and each
// one is a fact that changes the drawing or the calculation.
//
// 🚨 WHY EVERY ENTRY IS `key=value`, WITHOUT EXCEPTION. `stableEngineeringStateHash` SORTS and
// DEDUPLICATES its inputs and drops empty ones — it was built for sets of ids. Feeding it bare
// values would let ['400','200'] and ['200','400'] hash alike, and would let a second device rated
// the same as the first vanish into the Set. Labelling every entry with what it IS makes both
// harmless, and `revisionInputs` is exported so a test can prove that rather than trusting this
// paragraph.
// ═══════════════════════════════════════════════════════════════════════════

import { stableEngineeringStateHash } from '@/lib/engineeringStateInvalidation/hash';
import type { ElectricalProjectModel } from '@/lib/electrical/projectModel';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

/** The prefix every electrical revision carries, so a stray hash is identifiable on sight. */
export const ELECTRICAL_REVISION_PREFIX = 'ELEC';

/**
 * EXACTLY WHAT THE REVISION IS TAKEN OVER, exported for the same reason `canonicalDigestBody` is in
 * `lib/permit/snapshot/digest.ts`: "the revision moved" is a fact, "WHICH fact moved" is the fact
 * that makes it investigable. A diagnostic that re-implemented this list could disagree with the
 * hash it was explaining.
 */
export function revisionInputs(m: ElectricalProjectModel): string[] {
  const out: string[] = [];
  const put = (k: string, v: unknown) =>
    out.push(k + '=' + (v === null || v === undefined ? 'null' : String(v)));

  // ── The project-level architecture ───────────────────────────────────────
  put('coupling', m.solarCoupling);
  put('externalInverter', m.hasExternalInverter);
  put('service.ratedAmps', m.serviceRatedAmps);
  // The PV side. A module count change moves the DC string sizing and the array table, so a sheet
  // drawn for 72 modules must not read CURRENT against a 36-module project.
  put('modules', m.moduleCount);

  // ── Physical multiplicity. These are what the BOM counts and the sheet draws. ──
  put('storage.invertingUnits', m.storage.invertingUnitCount);
  put('storage.expansionUnits', m.storage.expansionUnitCount);
  put('storage.gateways', m.storage.gatewayCount);
  put('storage.generationPanels', m.storage.perSystemGenerationPanelCount);
  put('storage.usableKwh', m.storage.usableKwh);
  put('storage.continuousOutputA', m.storage.continuousOutputA);
  m.storage.models.slice().sort().forEach((model, i) => put('storage.model[' + i + ']', model));

  // 🚨 A CONFLICT IS PART OF THE STATE. Resolving one changes the engineering, so a sheet generated
  // while the project contradicted itself must not read as current once that is settled.
  put('conflicts.count', m.conflicts.length);
  m.conflicts.map(c => c.fact).sort().forEach((f, i) => put('conflict[' + i + ']', f));

  const t: ServiceTopology | null = m.topology;
  if (!t) {
    put('topology', 'absent');
    return out;
  }

  // ── The service itself ───────────────────────────────────────────────────
  put('topology', 'present');
  put('svc.voltage', t.service.voltage);
  put('svc.phase', t.service.phase);
  put('svc.availableFaultCurrentA', t.service.availableFaultCurrentA);
  put('svc.demandA', t.calculatedServiceDemandA);
  put('loads.provided', !!t.loads);

  // ── Every protective device, with the node it interrupts ─────────────────
  // 🚨 `inlineOnNodeId` IS IN THE FINGERPRINT. A switch beside a conductor interrupts nothing; the
  // same switch re-routed inline interrupts the path. That is the whole difference between a legal
  // isolation arrangement and a decorative one, and it must mark a sheet stale.
  for (const d of [...t.devices].sort((a, b) => a.id.localeCompare(b.id))) {
    put('dev[' + d.id + '].roles', [...d.roles].sort().join('+'));
    put('dev[' + d.id + '].ratedAmps', d.ratedAmps);
    put('dev[' + d.id + '].sccrA', d.sccrA);
    put('dev[' + d.id + '].productId', d.productId ?? null);
    put('dev[' + d.id + '].inlineOn', d.inlineOnNodeId ?? null);
    put('dev[' + d.id + '].feeds', d.feedsNodeId ?? null);
  }
  for (const b of [...t.branches].sort((x, y) => x.id.localeCompare(y.id))) {
    put('br[' + b.id + '].ratedAmps', b.ratedAmps);
    put('br[' + b.id + '].ocpdAmps', b.ocpdAmps);
    put('br[' + b.id + '].demandA', b.calculatedDemandA);
    put('br[' + b.id + '].panels', [...(b.panelIds ?? [])].sort().join(','));
  }
  for (const p of [...t.panels].sort((x, y) => x.id.localeCompare(y.id))) {
    put('pnl[' + p.id + '].busbarA', p.busbarRatingA);
    put('pnl[' + p.id + '].mainA', p.mainBreakerA);
    put('pnl[' + p.id + '].sccrA', p.sccrA);
    put('pnl[' + p.id + '].backedUp', p.backedUp);
  }
  for (const s of [...t.storage].sort((x, y) => x.id.localeCompare(y.id))) {
    put('sto[' + s.id + '].productId', s.productId);
    // 🚨 `role` SEPARATES AN INVERTING UNIT FROM AN EXPANSION, and `attachedToUnitId` says which
    // cabinet an expansion hangs off. Expansion is energy, not power — a change here moves the kWh
    // on the sheet without moving the amps, and both must mark a drawing stale.
    put('sto[' + s.id + '].role', s.role);
    put('sto[' + s.id + '].attachedTo', s.attachedToUnitId ?? null);
    put('sto[' + s.id + '].outputConfigKw', s.outputConfigKw ?? null);
    put('sto[' + s.id + '].continuousOutputA', s.continuousOutputA);
    put('sto[' + s.id + '].ocpdA', s.ocpdA);
    put('sto[' + s.id + '].usableKwh', s.usableKwh);
    put('sto[' + s.id + '].pvDcStcKw', s.pvDcStcKw ?? null);
    put('sto[' + s.id + '].pvInputs', s.pvInputLimits ? 'published' : 'none');
  }
  for (const g of [...t.generation].sort((x, y) => x.id.localeCompare(y.id))) {
    put('gen[' + g.id + '].productId', g.productId ?? null);
    put('gen[' + g.id + '].kind', g.kind);
    put('gen[' + g.id + '].continuousOutputA', g.continuousOutputA);
    put('gen[' + g.id + '].ocpdA', g.ocpdA);
    put('gen[' + g.id + '].domain', g.domainId ?? null);
  }
  for (const a of [...t.aggregationPanels].sort((x, y) => x.id.localeCompare(y.id))) {
    put('agg[' + a.id + '].busbarA', a.busbarRatingA);
    put('agg[' + a.id + '].mainA', a.mainBreakerA);
    put('agg[' + a.id + '].mainLugOnly', a.mainLugOnly);
    put('agg[' + a.id + '].sccrA', a.sccrA);
    put('agg[' + a.id + '].productId', a.productId ?? null);
    put('agg[' + a.id + '].domain', a.domainId ?? null);
    put('agg[' + a.id + '].carriesPremisesLoad', a.carriesPremisesLoad);
    put('agg[' + a.id + '].outputOcpdA', a.outputOcpdA);
    put('agg[' + a.id + '].feeds', a.feedsNodeId);
    put('agg[' + a.id + '].inputs', a.inputs.length);
    for (const inp of [...a.inputs].sort((x, y) => String(x.sourceId).localeCompare(String(y.sourceId)))) {
      put('agg[' + a.id + '].in[' + inp.sourceId + ']', inp.ocpdA);
    }
  }
  // 🚨 THE DOMAIN IS WHERE THE GATEWAY AND ITS GENERATION PANEL ACTUALLY LIVE. `branchId` is which
  // service branch it hangs off, `storageUnitIds` is which cabinets it owns, and
  // `storageConnection` is whether those cabinets land on a backed-up busbar, the gateway's own
  // panelboard, or a generation/combiner panel — the exact fact the real job turns on.
  for (const d of [...t.domains].sort((x, y) => x.id.localeCompare(y.id))) {
    put('dom[' + d.id + '].branch', d.branchId);
    put('dom[' + d.id + '].gateway.productId', d.gateway.productId);
    put('dom[' + d.id + '].gateway.id', d.gateway.id);
    put('dom[' + d.id + '].gateway.continuousA', d.gateway.continuousRatingA);
    put('dom[' + d.id + '].gateway.mainA', d.gateway.mainBreakerA);
    put('dom[' + d.id + '].gateway.serviceEntranceRated', d.gateway.serviceEntranceRated);
    put('dom[' + d.id + '].gateway.sccrA', d.gateway.sccrA);
    put('dom[' + d.id + '].storageConnection', d.storageConnection);
    put('dom[' + d.id + '].storageUnits', [...d.storageUnitIds].sort().join(','));
    put('dom[' + d.id + '].backedUpPanels', [...d.backedUpPanelIds].sort().join(','));
    put('dom[' + d.id + '].generationOutputA', d.generationOutputA);
    put('dom[' + d.id + '].backedUpDemandA', d.backedUpDemandA);
  }
  for (const poi of [...t.pointsOfInterconnection].sort((x, y) => x.id.localeCompare(y.id))) {
    put('poi[' + poi.id + '].relationship', poi.relationship);
    put('poi[' + poi.id + '].ocpdA', poi.ocpdA);
    put('poi[' + poi.id + '].der', poi.derNodeId ?? null);
    put('poi[' + poi.id + '].connectedTo', poi.connectedToNodeId ?? null);
  }

  // ── The interconnection decision ─────────────────────────────────────────
  put('ic.derArrangement', t.interconnection.derArrangement);
  put('ic.meterCollarSelected', t.interconnection.meterCollarSelected);
  put('ic.meterCollarPermitted', t.interconnection.meterCollarPermitted);
  put('ic.externalIsolationRequired', t.interconnection.externalDerIsolationRequired);

  return out;
}

/**
 * THE NAME OF THIS ELECTRICAL STATE. Deterministic, isomorphic (no `crypto`, no catalogue), and
 * stable across a save/reload — the server and the browser must produce the same string or the
 * stale badge would fire on every page load.
 */
export function electricalRevision(m: ElectricalProjectModel): string {
  return stableEngineeringStateHash(ELECTRICAL_REVISION_PREFIX, revisionInputs(m));
}

/**
 * The stamp a generated artifact carries. Deliberately tiny: a revision and what produced it.
 *
 * `generatedAt` is recorded for a human reading the sheet and is NOT part of the revision — two
 * renders of the same electrical project are the same electrical state regardless of when they ran.
 */
export interface ElectricalRevisionStamp {
  electricalRevision: string;
  /** Which surface generated it — 'sld' | 'permit' | 'bom' | … Free text; it is a label, not a key. */
  generatedBy: string;
  generatedAt?: string | null;
}

export type ElectricalArtifactFreshness = 'CURRENT' | 'STALE' | 'UNSTAMPED';

/**
 * 🚨 IS THIS ARTIFACT STILL THE PROJECT'S?
 *
 * `UNSTAMPED` is its own answer and not a pass. Every sheet generated before this stamp existed is
 * unstamped, and reporting those as CURRENT would be the same silent pretence the audit found — so
 * the UI says "generated before revision tracking" and offers regeneration, which is honest.
 */
export function electricalArtifactFreshness(
  stampedRevision: string | null | undefined,
  currentRevision: string,
): ElectricalArtifactFreshness {
  if (!stampedRevision) return 'UNSTAMPED';
  return stampedRevision === currentRevision ? 'CURRENT' : 'STALE';
}

/** The sentence a surface prints. One place, so the SLD tab and the permit tab cannot word it differently. */
export function freshnessLabel(f: ElectricalArtifactFreshness): string {
  switch (f) {
    case 'CURRENT': return 'Current';
    case 'STALE': return 'OUT OF DATE — REGENERATE';
    case 'UNSTAMPED': return 'GENERATED BEFORE REVISION TRACKING — REGENERATE TO VERIFY';
  }
}
