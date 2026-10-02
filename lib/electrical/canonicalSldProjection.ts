// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE CANONICAL PROJECTION FOR BOTH RENDERINGS OF ONE ENGINEERED PROJECT.
//
// Ray, 2026-10-02, after the chain trace found the PDF route still fabricating a Fronius
// Primo 8.2-1 that the SVG route had already stopped fabricating:
//
//   "Bring the PDF route onto the same canonical project/engineering path used by the repaired
//    SVG route. SVG and PDF are two renderings of the same engineered project. They must not
//    independently determine: architecture, inverter, battery count, OCPD, service data,
//    interconnection."
//
// 🚨 THE DEFECT THIS MODULE EXISTS TO MAKE IMPOSSIBLE. The projection lived inline in
// `app/api/engineering/sld/route.ts` and was COPIED, partially, into
// `app/api/engineering/sld/pdf/route.ts`. The copy had the refusal gate, the service rating and
// the interconnection — and was missing the Rule Eleven architecture override, the DC string
// limits, the graph's battery count and the revision stamp. So the on-screen diagram drew a
// DC-coupled Powerwall design and the EXPORTED PDF of the same project, in the same session,
// drew a string inverter. The printable one was the wrong one.
//
// Two copies of a projection do not stay equal. There is now one, and both routes call it.
//
// 🚨 IT MUTATES ITS INPUT IN PLACE, deliberately: both routes build a large `body`/`buildInput`
// record and then read fields off it in dozens of places. Returning a new object would mean
// every one of those reads had to be found and repointed, which is how a partial copy happens
// in the first place.
// ═══════════════════════════════════════════════════════════════════════════

import type { ComputedSolarCoupling } from '@/lib/computed-system';

/**
 * 🚨 THE TOPOLOGY TOKEN FOR "NOBODY HAS SAID", used by BOTH renderings.
 *
 * Both SLD routes defaulted `topologyType` to `'STRING_INVERTER'` for a request that stated no
 * architecture — and in the PDF route that guess then selected a product
 * (`=== 'MICROINVERTER' ? 'Enphase' : 'Fronius'`). Two guesses stacked, ending in a specific
 * catalogue inverter nobody had chosen, in the nameplate position, on a sheet an AHJ reads.
 *
 * The renderer uses `topologyType` for display (`.replace(/_/g,' ')`) plus two equality checks
 * for micro/optimizer, so an explicit token renders as "ARCHITECTURE REQUIRES RESOLUTION" and
 * matches neither branch — which is the correct behaviour for an unstated architecture, and the
 * same string `ARCHITECTURE_UNRESOLVED_LABEL` already uses elsewhere.
 *
 * 🚨 IT MUST BE THE SAME TOKEN ON BOTH ROUTES. A different unresolved spelling per surface is
 * the very divergence this module exists to end.
 */
export const TOPOLOGY_UNRESOLVED_TOKEN = 'ARCHITECTURE_REQUIRES_RESOLUTION';

export interface CanonicalSldProjection {
  /**
   * The 409 payload when the architecture must be resolved by a human before anything is drawn.
   * A permit-grade sheet that exists can be printed, attached and submitted, so the only safe
   * artefact for an unresolved conflict is no artefact plus the question.
   */
  refusal: Record<string, unknown> | null;
  /** True when a service graph was present and the architecture fields were projected from it. */
  applied: boolean;
  /**
   * The canonical coupling, for `computeSystem`. Null when the project has no graph or the
   * architecture is unresolved — never a guess.
   */
  coupling: ComputedSolarCoupling | null;
  /** The electrical revision this artefact is drawn from, for the staleness stamp. */
  revision: string | null;
}

const NOTHING: CanonicalSldProjection = {
  refusal: null, applied: false, coupling: null, revision: null,
};

/**
 * Project the canonical electrical model onto an SLD input record.
 *
 * `tag` only labels the log lines (`sld/POST`, `sld/pdf/POST`) so a disagreement can be traced
 * to the surface that posted it.
 *
 * Non-fatal by contract: a project with no readable graph returns `applied: false` and the
 * caller draws the legacy single-service tail, exactly as before. A half-read graph is worse
 * than no graph, so nothing is partially applied.
 */
export async function projectCanonicalArchitecture(
  input: Record<string, any>,
  projectId: string,
  userId: string,
  tag: string,
): Promise<CanonicalSldProjection> {
  const { loadElectricalProject, persistElectricalCanonicalization, interconnectionMethodScalar } =
    await import('@/lib/electrical/loadElectricalProject');

  const loaded = await loadElectricalProject(projectId, userId);
  const model = loaded?.model;

  // ══════════════════════════════════════════════════════════════════
  // 🚨 AN UNRESOLVED ARCHITECTURE DOES NOT GET DRAWN — ON EITHER SURFACE.
  //
  // Gating the SVG route and not the PDF would leave the exact artefact that gets attached to a
  // submission reachable, which is why this runs before the `model.topology` check: a project
  // whose architecture is in conflict is refused whether or not the graph parsed.
  // ══════════════════════════════════════════════════════════════════
  const { architectureRefusal } = await import('@/lib/electrical/architectureGate');
  const refusal = architectureRefusal(model, loaded?.revision ?? null);
  if (refusal) {
    console.warn(`[${tag}] REFUSED: electrical architecture requires resolution`
      + ` (project ${projectId})`);
    return { ...NOTHING, refusal: refusal as unknown as Record<string, unknown> };
  }

  if (!model?.topology) return NOTHING;

  // ── 🚨 THE CANONICAL ELECTRICAL MODEL DECIDES THE ARCHITECTURE ────────
  // Not the renderer, and not whatever the equipment picker was last left on. A conflict is
  // never canonicalised away: where the project holds BOTH an explicit inverter and a
  // DC-coupled graph the resolver returns no patch and the sheet keeps what was recorded, with
  // the conflict reported — because picking a side silently is how one drawing came to contain
  // two architectures.
  input.serviceTopology = model.canonicalizationPatch
    ? { ...model.topology, ...model.canonicalizationPatch }
    : model.topology;

  // 🚨 THE SERVICE RATING IS PROJECTED FROM THE MODEL, NOT FABRICATED AS 200.
  // A graph with NO recorded rating projects nothing: `serviceRatingLabel` prints
  // "SERVICE RATING REQUIRED" on the sheet, which is the honest outcome.
  if (model.serviceRatedAmps !== null) {
    const posted = Number(input.mainPanelAmps) || 0;
    if (posted !== model.serviceRatedAmps) {
      console.warn(`[${tag}] service rating corrected from the canonical model:`
        + ` posted=${posted || 'none'} canonical=${model.serviceRatedAmps} A`
        + ` (${model.serviceProvenance.source})`);
    }
    input.mainPanelAmps = model.serviceRatedAmps;
  }

  // 🚨 AND THE INTERCONNECTION METHOD. The graph's POI relationship is the authority, and an
  // unresolved POI projects NOTHING rather than being assigned NEC 705.12(B) by a `??`.
  const ic = interconnectionMethodScalar(model.topology);
  if (ic) {
    const postedIc = String(input.interconnection ?? input.interconnectionType
      ?? input.interconnectionMethod ?? '');
    if (postedIc && postedIc.toUpperCase() !== ic.value) {
      console.warn(`[${tag}] interconnection method corrected from the service graph:`
        + ` posted=${postedIc} canonical=${ic.value} (${ic.basis})`);
    }
    input.interconnection = ic.value;
    input.interconnectionMethod = ic.value;
    input.interconnectionType = ic.value;
  }

  // 🚨 THE STORAGE FACTS COME FROM THE GRAPH. `batteryCount` was a posted scalar — a catalogue
  // pick cannot say how many cabinets are installed.
  input.batteryCount = model.storage.invertingUnitCount;

  // ══════════════════════════════════════════════════════════════
  // 🚨 RULE ELEVEN — THE DRAWING TAKES NO ARCHITECTURE FROM THE UI.
  //
  // Everything above projects ONE field at a time, which is how the live sheet kept finding a
  // new way to be wrong: `topologyType` and `inverterModel` rode in from the page's React state
  // and were used verbatim, because nothing had claimed those two. So the architecture fields
  // are OVERWRITTEN as a set, and what the caller sent is logged rather than silently
  // discarded — a disagreement here means a surface is still deriving architecture.
  // ══════════════════════════════════════════════════════════════
  if (model.solarCoupling === 'dc-coupled-storage') {
    const postedTopo = String(input.topologyType ?? '');
    const postedInv = String(input.inverterModel ?? '');
    // There is no separate PV inverter on this design. Not an unknown one — none.
    input.topologyType = 'DC_COUPLED_STORAGE';
    delete input.inverterModel;
    delete input.inverterManufacturer;
    delete input.inverterId;
    if (postedTopo && postedTopo !== 'DC_COUPLED_STORAGE') {
      console.warn(`[${tag}] the caller posted an architecture the project does not have:`
        + ` topologyType=${postedTopo}`
        + (postedInv ? ` inverterModel=${postedInv}` : '')
        + ' — overridden from the canonical model (dc-coupled-storage).');
    }
  } else if (model.solarCoupling === 'ac-coupled-inverter') {
    // ══════════════════════════════════════════════════════════════════
    // 🚨 THIS ARM USED TO BE THE HOLE IN RULE ELEVEN.
    //
    // It set `inverterId` and nothing else — so `topologyType`, `inverterModel` and
    // `inverterManufacturer` survived from the request. On Ray's project, where the model holds
    // NO inverter at all, the whole arm was a no-op and the page's React state was drawn as fact:
    // a STRING INVERTER title block and a Tesla Solar Inverter 5.7kW that is not on the project.
    //
    // Ray: "The Generate SLD request may identify projectId and artifact options. It may not be
    // allowed to override topologyType, inverterId, batteryCount, serviceAmps, solarCoupling,
    // interconnectionMethod."
    //
    // So the identity is asserted as a SET, exactly like the DC-coupled arm — and the NAME travels
    // with the id, because a sheet that prints a model string the project does not hold is naming
    // equipment from the browser whatever the id says.
    // ══════════════════════════════════════════════════════════════════
    const postedInv = String(input.inverterModel ?? '');
    if (model.externalInverterId) {
      input.inverterId = model.externalInverterId;
      // The route resolves the display name from the id against the catalogue; clearing the posted
      // pair stops a stale React-state name outliving the id it was supposed to describe.
      delete input.inverterModel;
      delete input.inverterManufacturer;
      if (postedInv) {
        console.warn(`[${tag}] the caller posted inverterModel='${postedInv}' — cleared; the name `
          + `follows the project's recorded id '${model.externalInverterId}'.`);
      }
    } else {
      // 🚨 AC-COUPLED WITH NO INVERTER ON THE RECORD. `resolveElectricalProject` now raises
      // SOLAR_COUPLING_UNRESOLVED for this, so the gate above should already have refused — this
      // is the belt to that brace. Nothing from the request may describe an inverter the project
      // does not have.
      delete input.inverterModel;
      delete input.inverterManufacturer;
      delete input.inverterId;
      console.warn(`[${tag}] the project records an AC-coupled architecture but holds NO inverter; `
        + `the caller's '${postedInv || 'equipment'}' is not drawn.`);
    }
  } else if (model.solarCoupling === 'storage-only') {
    input.topologyType = 'STORAGE_ONLY';
    delete input.inverterModel;
    delete input.inverterManufacturer;
    delete input.inverterId;
  }

  // 🚨 ON A DC-COUPLED JOB THE STRINGS ARE SIZED AGAINST THE CABINETS, NOT A PHANTOM
  //    INVERTER'S DEFAULTS. On this project the defaults printed a string of 19 modules at
  //    1345.8 V against a Powerwall 3 whose published PV input is 60–550 V DC.
  const { dcStringLimits, dcStringLimitsNote } =
    await import('@/lib/electrical/dcStringLimits');
  const dcLim = dcStringLimits(model.topology, model.solarCoupling);
  if (dcLim) {
    input.inverterMaxDcV = dcLim.maxDcVoltage;
    input.maxDcVoltage = dcLim.maxDcVoltage;
    input.mpptVoltageMin = dcLim.mpptVoltageMin;
    input.mpptVoltageMax = dcLim.mpptVoltageMax;
    input.maxInputCurrentPerMppt = dcLim.maxInputCurrentPerMppt;
    input.mpptChannels = dcLim.mpptChannels;
    console.log(`[${tag}] DC string limits taken from the storage, not an inverter: `
      + dcStringLimitsNote(dcLim));
  }

  // 🚨 `batteryBackfeedA` IS AN ARCHITECTURE QUESTION, NOT A SUM. NEC 705.12(B) adds the
  // backfeed breakers ON A GIVEN BUSBAR. Where each system's cabinets land in their own
  // generation panel and that panel feeds the gateway, NOTHING of the storage lands on the
  // MSP's busbar. Feeding the sum anyway would size the MSP against 240 A that is not there.
  const doms = model.topology.domains;
  if (doms.length > 0 && doms.every(d => d.storageConnection === 'der-aggregation-panel')) {
    input.batteryBackfeedA = 0;
    console.log(`[${tag}] storage backfeed on the service panel busbar = 0 —`
      + ' every system lands in its own generation panel, which feeds its gateway.');
  } else if (doms.length > 0 && doms.every(d => d.storageConnection !== 'unresolved')) {
    const units = model.topology.storage.filter(u => u.role === 'inverter-unit');
    if (!units.some(u => u.ocpdA == null)) {
      input.batteryBackfeedA = units.reduce((n, u) => n + (u.ocpdA as number), 0);
    }
  }

  // 🚨 THE SHEET CARRIES THE REVISION IT WAS DRAWN FROM, so the Diagram tab can compare what it
  // is showing against what the project now is.
  input.electricalRevision = loaded!.revision;

  console.log(`[${tag}] electrical model:`
    + ` revision=${loaded!.revision}`
    + ` coupling=${model.solarCoupling ?? 'UNRESOLVED'}`
    + ` (${model.solarCouplingProvenance.source})`
    + ` service=${model.serviceRatedAmps ?? 'NOT ESTABLISHED'}`
    + ` storage=${model.storage.invertingUnitCount}`
    + ` gateways=${model.storage.gatewayCount}`
    + ` genPanels=${model.storage.perSystemGenerationPanelCount}`
    + ` conflicts=${model.conflicts.length}`);
  for (const c of model.conflicts) {
    console.warn(`[${tag}] ELECTRICAL CONFLICT — ${c.fact}: `
      + c.claims.map(x => `${x.source} says ${x.says}`).join(' | '));
  }

  // ── The one-time canonicalization, persisted ──────────────────────
  // A migration, not a mirror: once `solarCoupling` is recorded the model stops emitting a
  // patch, so this runs once per project and then never again.
  void persistElectricalCanonicalization(loaded!, userId);

  return {
    refusal: null,
    applied: true,
    coupling: model.solarCoupling,
    revision: loaded!.revision,
  };
}
