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
import type { PvArrayDesign } from '@/lib/electrical/pvArrayDesign';

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

/**
 * 🚨 A DRAWING NEEDS AN ARRAY, AND NEITHER ROUTE MAY INVENT ONE.
 *
 * Both SLD routes read `Number(body.totalModules) || 20` and `Number(body.panelWatts) || 400` (plus
 * a 49.6 V / 10.18 A module nobody selected). That is how a 37 × 440 W design was printed as
 * 20 × 400 W the moment its inverter fleet was retired: the route did not know the array, so it drew
 * a different one. Same class as the Fronius Primo this module already removed — an output naming a
 * physical fact from absence.
 *
 * After `projectPvArray` has had its say, a request that still carries no module count, or a count
 * with no module electricals, is answered with what is missing, why it matters, who owns it and what
 * it blocks. Storage-only is the one design with legitimately no array.
 *
 * Returned as the 422 body; null ⇒ the array is complete enough to draw.
 */
export function pvArrayInputRequired(input: Record<string, any>): Record<string, unknown> | null {
  if (String(input.topologyType ?? '') === 'STORAGE_ONLY') return null;
  const modules = Number(input.totalModules) || 0;
  const missing: Array<{ fact: string; why: string; owner: string; blocks: string[] }> = [];
  if (!(modules > 0)) {
    missing.push({
      fact: 'PV module count',
      why: 'The strings, the DC size and the array on the single-line diagram follow from how many '
        + 'modules are installed. No Design layout was found for this project and none was supplied.',
      owner: 'Design — place the modules',
      blocks: ['SLD', 'string design', 'BOM', 'permit'],
    });
  } else {
    // Wattage, Voc and Isc are what the drawn array, its DC size and the NEC 690.7 / 690.8 checks
    // cannot exist without. (Vmp / Imp still fall back to the string engine's module defaults when a
    // legacy request names a module without them — every project with a recorded module gets the
    // real values from `projectPvArray`, and the page sends them on every request.)
    const absent = (['panelWatts', 'panelVoc', 'panelIsc'] as const)
      .filter(k => !(Number(input[k]) > 0));
    if (absent.length > 0) {
      missing.push({
        fact: 'PV module model',
        why: 'Module wattage, Voc and Isc size every string and every DC conductor; without the module '
          + `they are unknown (${absent.join(', ')} not established).`,
        owner: 'Design / equipment selection — choose the module',
        blocks: ['SLD', 'NEC 690.7 voltage check', 'BOM', 'permit'],
      });
    }
  }
  if (missing.length === 0) return null;
  return {
    success: false,
    error: 'INPUT_REQUIRED',
    code: 'PV_ARRAY_INPUT_REQUIRED',
    message: `The single-line diagram cannot be drawn without: ${missing.map(m => m.fact).join(', ')}.`,
    missing,
  };
}

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
  /**
   * The physical array Design placed, as read from the store on this request. Null only when the
   * project could not be read at all. Projected onto the input by `projectPvArray`.
   */
  pvArray: PvArrayDesign | null;
  /**
   * One battery's AC circuit as the graph records it — at the output setting it is commissioned at
   * (`batteryCircuitOf`). Null without a graph or an inverting unit. The route sizes the conductor
   * schedule's battery circuit from it instead of the catalogue maximum. Returned, never written onto
   * the request body, so a caller cannot post one.
   */
  batteryCircuit: { continuousOutputA: number; ocpdA: number } | null;
  /**
   * The storage's published PV input window when the PV lands on it (DC coupled), else null — the
   * receiving endpoint the routes hand the one string engine (lib/electrical/canonicalStrings.ts).
   */
  dcLimits?: import('@/lib/electrical/dcStringLimits').DcStringLimits | null;
  /** The project's stored string assignment (endpoint entries only) — see LoadedElectricalProject.fleet. */
  fleet?: import('@/lib/electrical/canonicalStrings').StoredFleetEntry[];
}

const NOTHING: CanonicalSldProjection = {
  refusal: null, applied: false, coupling: null, revision: null, pvArray: null, batteryCircuit: null, dcLimits: null,
};

/**
 * 🚨 THE ARRAY ON THE SHEET IS THE ARRAY DESIGN PLACED.
 *
 * Ray's live sheet, after the architecture was finally right (PV INVERTER = NONE, PV DC COUPLED TO
 * POWERWALL 3), printed `20 × 400 W · 8.00 kW DC · 2 × 10 strings` for a `37 × 440 W · 16.28 kW`
 * design. The page described the array only as a property of its inverter fleet; the DC-coupled
 * resolution emptied the fleet; the page posted no module count and no module; and both routes
 * filled the silence with literals (`|| 20`, `|| 400`).
 *
 * Same rule as the architecture fields below: the request may NAME the project, it may not describe
 * its physical array. Module count and module identity are projected from the stores Design writes,
 * read on the server, and a disagreement with what the caller posted is logged rather than drawn.
 *
 * Where the store has no answer (no layout, no recorded module), the caller's value is left exactly
 * as posted — this never invents. The routes refuse to fabricate what is still missing.
 *
 * `microModulesPerDevice` is the catalogue ratio of the project's RECORDED microinverter (never the
 * request's), or null when the recorded inverter is not a catalogue micro.
 */
export function projectPvArray(
  input: Record<string, any>,
  pv: PvArrayDesign | null | undefined,
  tag: string,
  microModulesPerDevice: number | null = null,
): void {
  if (!pv) return;
  if (pv.moduleCount !== null) {
    const posted = Number(input.totalModules) || 0;
    if (posted !== pv.moduleCount) {
      console.warn(`[${tag}] PV module count corrected from Design:`
        + ` posted=${posted || 'none'} design=${pv.moduleCount} (${pv.moduleCountSource})`);
      // ════════════════════════════════════════════════════════════════════
      // 🚨 AND THE MICROINVERTER COUNT THE CALLER DERIVED FROM ITS OWN WRONG COUNT GOES WITH IT.
      //
      // Found by the brand-family fixtures: a stale body posting 21 modules for a 24-module Enphase
      // design came back from the PDF route as `24 × 405 W` beside `21 × IQ8+` — a sheet that
      // contradicts itself, which the old stale body (21 and 21) did not. Correcting the module
      // count alone made the posted `deviceCount` / `microBranches` describe a different array.
      // Re-derived from the recorded micro's catalogue ratio; with no recorded micro the caller's
      // values are left as posted (logged), because a 1:1 guess is wrong for a dual-module micro.
      // ════════════════════════════════════════════════════════════════════
      if (input.deviceCount != null && pv.moduleCount > 0) {
        if (microModulesPerDevice && microModulesPerDevice > 0) {
          const devices = Math.ceil(pv.moduleCount / microModulesPerDevice);
          if (Number(input.deviceCount) !== devices) {
            console.warn(`[${tag}] microinverter count re-derived from Design: posted=${input.deviceCount}`
              + ` design=${devices} (${pv.moduleCount} modules / ${microModulesPerDevice} per device)`);
          }
          input.deviceCount = devices;
          const branches = Array.isArray(input.microBranches) ? input.microBranches : null;
          if (branches
              && branches.reduce((n: number, b: any) => n + (Number(b?.deviceCount) || 0), 0) !== devices) {
            delete input.microBranches;
          }
        } else {
          console.warn(`[${tag}] posted deviceCount=${input.deviceCount} was derived from a module count`
            + ' Design does not hold, and the project records no catalogue microinverter to re-derive it from.');
        }
      }
    }
    input.totalModules = pv.moduleCount;
  }
  const m = pv.module;
  if (m) {
    const postedWatts = Number(input.panelWatts) || 0;
    const postedId = input.panelId != null ? String(input.panelId) : '';
    if ((postedId && postedId !== m.panelId) || (postedWatts && postedWatts !== m.watts)) {
      console.warn(`[${tag}] PV module corrected from the project's selection:`
        + ` posted=${postedId || '(no id)'} ${postedWatts || '?'} W`
        + ` project=${m.panelId} ${m.watts} W (${pv.moduleSource})`);
    }
    input.panelId = m.panelId;
    input.panelModel = `${m.manufacturer} ${m.model}`;
    input.panelManufacturer = m.manufacturer;
    input.panelWatts = m.watts;
    input.panelVoc = m.voc;
    input.panelVmp = m.vmp;
    input.panelIsc = m.isc;
    input.panelImp = m.imp;
    input.tempCoeffVoc = m.tempCoeffVoc;
    input.panelTempCoeffVoc = m.tempCoeffVoc;
    input.panelTempCoeffIsc = m.tempCoeffIsc;
    input.maxSeriesFuse = m.maxSeriesFuseRating;
    input.panelMaxSeriesFuse = m.maxSeriesFuseRating;
    // A Vmp coefficient posted alongside a different module describes that module, not this one.
    delete input.tempCoeffVmp;
  }
  if (pv.missing.length > 0) {
    console.warn(`[${tag}] PV array incomplete: `
      + pv.missing.map(f => `${f.fact} (owner: ${f.owner})`).join('; '));
  }
}

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

  // The physical array is a Design fact, not a service-graph fact: a plain 200 A house with no graph
  // has an array too, so this runs before the topology gate below.
  const pvArray = loaded?.pvArray ?? null;
  const { getInverterById, getMicroinverterById } = await import('@/lib/equipment-db');
  const recordedMicro = model?.externalInverterId ? getMicroinverterById(model.externalInverterId) : undefined;
  projectPvArray(input, pvArray, tag, recordedMicro?.modulesPerDevice ?? null);

  if (!model?.topology) return { ...NOTHING, pvArray, fleet: loaded?.fleet ?? [] };

  // ── 🚨 THE CANONICAL ELECTRICAL MODEL DECIDES THE ARCHITECTURE ────────
  // Not the renderer, and not whatever the equipment picker was last left on. A conflict is
  // never canonicalised away: where the project holds BOTH an explicit inverter and a
  // DC-coupled graph the resolver returns no patch and the sheet keeps what was recorded, with
  // the conflict reported — because picking a side silently is how one drawing came to contain
  // two architectures.
  //
  // 🚨 WHAT THE SHEET DRAWS AND WHAT MAY BE WRITTEN BACK ARE TWO DIFFERENT QUESTIONS.
  //
  // This line used to answer only the second one. `canonicalizationPatch` is the model's opinion
  // about what is safe to PERSIST — it is withheld whenever a conflict exists, and withheld again
  // where writing it would move `meta.digest` and retire a live PE approval as a side effect of a
  // read. `model.solarCoupling` is the model's CONCLUSION, and the conclusion is what a drawing is
  // entitled to. Handing the renderer `model.topology` instead handed it the raw stored scalar.
  //
  // That is how a sheet kept saying STRING INVERTER on a project whose model had already resolved
  // to `dc-coupled-storage`: `sld-professional-renderer.ts:4155` reads
  // `input.serviceTopology?.solarCoupling` for `_couplingIsDc` (and again at `:5717`), so the
  // renderer believed the store while every other surface believed the model. The comment directly
  // above has said "Not the renderer" since this module was written; the code did not do it.
  //
  // Unchanged for every project whose recorded coupling is not contradicted: there
  // `model.solarCoupling === recorded`, so this writes the identical value. And when the model
  // reaches NO conclusion the raw graph is left exactly as it is, because an override is only
  // warranted by an answer.
  input.serviceTopology = {
    ...model.topology,
    ...(model.canonicalizationPatch ?? {}),
    ...(model.solarCoupling ? { solarCoupling: model.solarCoupling } : {}),
  };
  if (model.topology.solarCoupling && model.solarCoupling
      && model.topology.solarCoupling !== model.solarCoupling) {
    console.warn(`[${tag}] the stored coupling disagrees with the canonical model:`
      + ` stored=${model.topology.solarCoupling} canonical=${model.solarCoupling}`
      + ` (${model.solarCouplingProvenance.source}) — the sheet follows the model.`);
  }

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
  // 🚨 AND THE BRAND HINTS ARE ARCHITECTURE TOO. The SVG route sizes from `selectedBrand` /
  // `selectedInverterId`, and its brand engine then OVERRIDES `topologyType` — so on a job with no PV
  // inverter, a posted `selectedBrand: 'enphase'` (a migration default the project never chose,
  // captured from the production page on Ray's job) turned DC_COUPLED_STORAGE back into
  // MICROINVERTER: "1 STRING — 1 MODULES", "Voc=0.0V" and micro conduit runs under a title block
  // that said NONE — DC COUPLED. With no PV inverter there is no brand to size the strings from.
  const dropBrandHints = () => {
    const posted = [input.selectedBrand, input.selectedInverterId].filter(v => v != null && String(v).trim());
    if (posted.length > 0) {
      console.warn(`[${tag}] brand hints ${JSON.stringify(posted)} dropped — this design has no PV inverter.`);
    }
    delete input.selectedBrand;
    delete input.selectedInverterId;
  };
  if (model.solarCoupling === 'dc-coupled-storage') {
    const postedTopo = String(input.topologyType ?? '');
    const postedInv = String(input.inverterModel ?? '');
    // There is no separate PV inverter on this design. Not an unknown one — none.
    input.topologyType = 'DC_COUPLED_STORAGE';
    delete input.inverterModel;
    delete input.inverterManufacturer;
    delete input.inverterId;
    dropBrandHints();
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
      // The recorded inverter is also the SIZING hint. The brand engine lets a concrete inverter id
      // beat a contradicting brand label (BRAND_INVERTER_MISMATCH), so a stale `selectedBrand` — a
      // migration default like 'enphase' on an SMA job — can no longer turn the sheet into a
      // microinverter path, as it did on Ray's DC-coupled job.
      const postedHint = input.selectedInverterId != null ? String(input.selectedInverterId) : '';
      if (postedHint && postedHint !== model.externalInverterId) {
        console.warn(`[${tag}] selectedInverterId '${postedHint}' replaced by the recorded inverter`
          + ` '${model.externalInverterId}'.`);
      }
      input.selectedInverterId = model.externalInverterId;
      // Clearing the posted pair stops a stale React-state name outliving the id it was supposed to
      // describe.
      delete input.inverterModel;
      delete input.inverterManufacturer;
      // ════════════════════════════════════════════════════════════════════
      // 🚨 AND THE NAME IS RESOLVED HERE, BECAUSE NO ROUTE EVER DID.
      //
      // This said "the route resolves the display name from the id against the catalogue". The SVG
      // route reads only `body.inverterModel`, so every legitimately AC-coupled job — a Sunny Boy
      // beside a Powerwall 2, an SE7600H beside a Powerwall 3, IQ8M micros beside an IQ Battery,
      // each one SELECTED by the installer — was drawn on the Diagram tab as ⚠ INVERTER NOT SELECTED,
      // while the PDF of the same project named the inverter from the page's `inverterSpecs`. Found
      // by tests/brandFamiliesSurviveTheArrayProjection.postgres.test.ts. A dangling id names
      // nothing, so the sheet keeps saying NOT SELECTED for it.
      // ════════════════════════════════════════════════════════════════════
      const product = getInverterById(model.externalInverterId)
        ?? getMicroinverterById(model.externalInverterId);
      if (product) {
        input.inverterManufacturer = product.manufacturer;
        input.inverterModel = product.model;
      }
      if (postedInv) {
        console.warn(`[${tag}] the caller posted inverterModel='${postedInv}' — cleared; the name `
          + `follows the project's recorded id '${model.externalInverterId}'`
          + (product ? ` (${product.manufacturer} ${product.model}).` : ', which the catalogue does not hold.'));
      }
    } else {
      // 🚨 AC-COUPLED WITH NO INVERTER ON THE RECORD. `resolveElectricalProject` now raises
      // SOLAR_COUPLING_UNRESOLVED for this, so the gate above should already have refused — this
      // is the belt to that brace. Nothing from the request may describe an inverter the project
      // does not have.
      delete input.inverterModel;
      delete input.inverterManufacturer;
      delete input.inverterId;
      dropBrandHints();
      console.warn(`[${tag}] the project records an AC-coupled architecture but holds NO inverter; `
        + `the caller's '${postedInv || 'equipment'}' is not drawn.`);
    }
  } else if (model.solarCoupling === 'storage-only') {
    input.topologyType = 'STORAGE_ONLY';
    delete input.inverterModel;
    delete input.inverterManufacturer;
    delete input.inverterId;
    dropBrandHints();
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

  const { batteryCircuitOf } = await import('@/lib/electrical/systemConfigSystemEquipment');
  return {
    refusal: null,
    applied: true,
    coupling: model.solarCoupling,
    revision: loaded!.revision,
    pvArray,
    batteryCircuit: batteryCircuitOf(model.topology),
    dcLimits: dcLim,
    fleet: loaded!.fleet ?? [],
  };
}
