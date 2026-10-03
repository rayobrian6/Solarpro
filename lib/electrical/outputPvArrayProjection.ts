// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE PARTS LIST ORDERS THE ARRAY DESIGN PLACED — NOT THE ONE THE BROWSER REMEMBERED.
//
// Ray, gauntlet step 11: "SLD, BOM, permit, planset and pricing are consumers… The BOM orders that
// same result. The permit describes that same result. Pricing prices that same result."
//
// The SLD routes were repaired first (`projectPvArray` in `canonicalSldProjection.ts`). The BOM route
// was left reading the array from its POST body, and that body is built from the inverter fleet the
// DC-coupled resolution retires:
//
//   page.tsx   panelId  = firstStr?.panelId || defaultPanelForSystemType(systemType)
//                         → no string ⇒ 'qcells-peak-duo-400' on a roof job, a module nobody chose
//   bom route  panelId  = body.panelId                                   → Q.PEAK DUO 400 W ordered
//              systemKw = Number(body.systemKw) || 8.0                   → 8.0 kW sized the AC side
//
// Measured on Ray's resolved row before this module existed: the route corrected the count to 37
// (the canonical model already owned it) and then ordered 37 × Q CELLS Q.PEAK DUO BLK ML-G10+ 400W
// for a 37 × Philadelphia Solar 440 W design — the right count of the wrong module, priced.
//
// This is the BOM-shaped twin of `projectPvArray`: same resolver output (`resolvePvArrayDesign`, read
// on the server by `loadElectricalProject`), same rule. The request may NAME the project; it may not
// describe its physical array. Where the store answers, the store wins and the disagreement is logged
// and reported. Where the store does not answer, the posted value is left exactly as posted and the
// gap is REPORTED — this never invents a count, a module or a DC size. The one exception is narrower
// than it looks: when Design placed the modules and no store names the module, a posted module id can
// only be the browser's fallback, so it is withdrawn (the engine lists the line as TBD) rather than
// ordered.
//
// Pure: no database, no catalogue reads beyond what the resolver already did. It mutates `body` in
// place for the same reason the SLD projection does — the route reads these fields in dozens of
// places, and a returned copy is how a partial projection happens.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  PvArrayDesign, PvArrayMissingFact, PvDcSizeSource, PvModuleCountSource, PvModuleIdentitySource,
} from '@/lib/electrical/pvArrayDesign';

/** What the caller posted, captured BEFORE any server-side projection touched the body. */
export interface PostedBomArray {
  moduleCount: number;
  panelId: string;
  panelWatts: number;
  systemKw: number;
  deviceCount: number | null;
}

/** Read the posted array off a BOM request body. Call it before anything mutates the body. */
export function postedBomArray(body: Record<string, unknown>): PostedBomArray {
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  return {
    moduleCount: n(body.moduleCount) || n(body.totalPanels),
    panelId: typeof body.panelId === 'string' ? body.panelId.trim() : '',
    panelWatts: n(body.panelWatts),
    systemKw: n(body.systemKw),
    deviceCount: body.deviceCount == null ? null : n(body.deviceCount),
  };
}

/** The array a BOM was built from, and how it differs from what was posted. Travels in the response. */
export interface BomPvArrayReport {
  moduleCount: number | null;
  moduleCountSource: PvModuleCountSource;
  panelId: string | null;
  moduleManufacturer: string | null;
  moduleModel: string | null;
  moduleWatts: number | null;
  moduleSource: PvModuleIdentitySource;
  /** DC nameplate at STC from Design. Null ⇒ not established, and the posted value stood. */
  dcStcKw: number | null;
  dcSizeSource: PvDcSizeSource;
  /** One line per fact the design overrode. Empty when the request already agreed with the design. */
  corrected: string[];
  /**
   * Facts the design does not establish. Nothing was invented for any of them: the posted value
   * stood, except a posted module on a Design-placed array, which was withdrawn (see `corrected`).
   */
  missing: PvArrayMissingFact[];
}

/**
 * 🚨 PROJECT THE DESIGN'S ARRAY ONTO A BOM REQUEST BODY.
 *
 * Sets `moduleCount` / `totalPanels` (count), `panelId` / `panelWatts` (identity) and `systemKw`
 * (DC size) from `pv` wherever `pv` establishes them. A micro device count derived from a stale module
 * count is re-derived from the RECORDED micro's catalogue ratio (never the request's), and a posted
 * AC-branch count derived from the stale array is withdrawn so the engine derives its own — the same
 * two corrections `projectPvArray` makes for the SLD, for the same reason: correcting the module
 * count alone leaves 24 modules beside 21 micros.
 */
export function projectPvArrayOntoBom(
  body: Record<string, any>,
  pv: PvArrayDesign,
  tag: string,
  opts: { posted?: PostedBomArray; microModulesPerDevice?: number | null } = {},
): BomPvArrayReport {
  const posted = opts.posted ?? postedBomArray(body);
  const corrected: string[] = [];

  // ── HOW MANY ────────────────────────────────────────────────────────────
  if (pv.moduleCount !== null) {
    if (posted.moduleCount !== pv.moduleCount) {
      corrected.push(`module count: posted ${posted.moduleCount || 'none'} → design ${pv.moduleCount}`
        + ` (${pv.moduleCountSource})`);
      if (posted.deviceCount !== null && pv.moduleCount > 0) {
        const per = opts.microModulesPerDevice;
        if (per && per > 0) {
          const devices = Math.ceil(pv.moduleCount / per);
          if (posted.deviceCount !== devices) {
            corrected.push(`microinverter count: posted ${posted.deviceCount} → ${devices}`
              + ` (${pv.moduleCount} modules / ${per} per device)`);
          }
          body.deviceCount = devices;
        } else {
          console.warn(`[${tag}] posted deviceCount=${posted.deviceCount} was derived from a module count`
            + ' Design does not hold, and the project records no catalogue microinverter to re-derive it from.');
        }
      }
      if (body.branchCount != null) {
        corrected.push(`AC branch count: posted ${body.branchCount} withdrawn — it described the posted array`);
        delete body.branchCount;
      }
    }
    body.moduleCount = pv.moduleCount;
    body.totalPanels = pv.moduleCount;
  }

  // ── WHICH MODULE ────────────────────────────────────────────────────────
  const m = pv.module;
  if (m) {
    if ((posted.panelId && posted.panelId !== m.panelId) || (posted.panelWatts && posted.panelWatts !== m.watts)) {
      corrected.push(`module: posted ${posted.panelId || '(no id)'} ${posted.panelWatts || '?'} W`
        + ` → project ${m.panelId} ${m.watts} W (${pv.moduleSource})`);
    }
    body.panelId = m.panelId;
    body.panelWatts = m.watts;
  } else if ((pv.moduleCount ?? 0) > 0
      && pv.moduleCountSource !== 'engineering-entry' && pv.moduleCountSource !== 'not-established') {
    // 🚨 DESIGN PLACED THE MODULES AND NO STORE NAMES WHICH ONE. Every real module selection lands
    // in a store the resolver reads (`selected_equipment.panelId`, Design Studio's recorded module, or
    // the saved string assignment), so a posted id here came from none of them — on a DC-coupled job
    // it is the page's `defaultPanelForSystemType()` filling an empty fleet. Ordering it would buy a
    // module nobody chose; the engine lists the line as TBD instead and the gap is reported. (A
    // project with no Design layout keeps its posted module: there the request IS the manual entry.)
    if (posted.panelId || posted.panelWatts) {
      corrected.push(`module: posted ${posted.panelId || '(no id)'} ${posted.panelWatts || '?'} W withdrawn —`
        + ` no project store names the module (${pv.moduleBasis}); the BOM lists it as TBD`);
    }
    delete body.panelId;
    delete body.panelWatts;
  }

  // ── HOW BIG ─────────────────────────────────────────────────────────────
  if (pv.dcStcKw !== null) {
    if (Math.abs(posted.systemKw - pv.dcStcKw) > 0.0005) {
      corrected.push(`DC size: posted ${posted.systemKw || 'none'} kW → design ${pv.dcStcKw} kW`
        + ` (${pv.dcSizeSource})`);
    }
    body.systemKw = pv.dcStcKw;
  }

  for (const c of corrected) console.warn(`[${tag}] PV array corrected from Design — ${c}`);
  if (pv.missing.length > 0) {
    console.warn(`[${tag}] PV array incomplete — the posted value stands for: `
      + pv.missing.map(f => `${f.fact} (owner: ${f.owner})`).join('; '));
  }

  return {
    moduleCount: pv.moduleCount,
    moduleCountSource: pv.moduleCountSource,
    panelId: m?.panelId ?? null,
    moduleManufacturer: m?.manufacturer ?? null,
    moduleModel: m?.model ?? null,
    moduleWatts: m?.watts ?? null,
    moduleSource: pv.moduleSource,
    dcStcKw: pv.dcStcKw,
    dcSizeSource: pv.dcSizeSource,
    corrected,
    missing: pv.missing,
  };
}

/** The array-describing slice of a permit request body (`PermitInput`), read and never written. */
export interface PermitArrayView {
  system?: {
    totalPanels?: number | null;
    totalDcKw?: number | null;
    inverters?: ReadonlyArray<{ strings?: ReadonlyArray<{ panelId?: string; panelModel?: string; panelWatts?: number }> }>;
    modules?: ReadonlyArray<{ model?: string; panelModel?: string; watts?: number; panelWatts?: number }>;
  } | null;
  project?: { panelModel?: string; moduleModel?: string; panelWatts?: number } | null;
}

/**
 * 🚨 WHERE THE PERMIT'S ARRAY DIFFERS FROM THE ARRAY DESIGN PLACED — REPORTED, NEVER APPLIED.
 *
 * The permit is the one consumer this module may NOT correct. `POST /api/engineering/permit` hands its
 * body to `generatePermitHTML`, which builds the sealed `PermitDesignSnapshot` from it in the same
 * pass, and three of the facts below are inside that snapshot's digest:
 *
 *   system.totalPanels / totalDcKw   → `sourceInputs.clientTotals` (captured raw, before any server
 *                                      mutation) and `electrical.{moduleCount, dcKw}`
 *   the strings' / project's module  → `equipment.modules`
 *
 * `canonicalDigestBody` hashes all of it, and `findActiveApproval` matches an EXACT digest — so
 * projecting the design's array onto a body that disagrees with it rotates `meta.digest` for an
 * unchanged design and retires its live PE approval (docs/ENGINEERING-CHAIN-TRACE.md Part III §2).
 * Ray's own DC-coupled job is such a body today: the page posts `totalDcKw` = 37 × 0.4 = 14.80 (its
 * 400 W fallback for an empty fleet) and names no module at all.
 *
 * So this only DESCRIBES the disagreement, for the server log. Applying it is a deliberate one-time
 * digest rotation with an approval-ledger plan, and that is the operator's decision, not a side
 * effect of a read. Returns one line per disagreeing fact; empty ⇔ the permit body agrees with
 * Design on every fact Design establishes.
 */
export function comparePermitArrayWithDesign(input: PermitArrayView, pv: PvArrayDesign): string[] {
  const out: string[] = [];
  const sys = input.system ?? {};
  const postedCount = Number(sys.totalPanels) || 0;
  if (pv.moduleCount !== null && postedCount !== pv.moduleCount) {
    out.push(`module count: permit ${postedCount || 'none'} — design ${pv.moduleCount} (${pv.moduleCountSource})`);
  }
  const m = pv.module;
  if (m) {
    const str = (sys.inverters ?? []).flatMap(i => i?.strings ?? []).find(s => s?.panelId || s?.panelModel);
    const mod0 = sys.modules?.[0];
    const postedId = str?.panelId ?? null;
    const postedModel = str?.panelModel || mod0?.model || mod0?.panelModel
      || input.project?.panelModel || input.project?.moduleModel || null;
    const postedWatts = Number(str?.panelWatts ?? mod0?.watts ?? mod0?.panelWatts ?? input.project?.panelWatts) || 0;
    if (!postedId && !postedModel) {
      out.push(`module: the permit names none (its sheets resolve '—') — design ${m.panelId}`
        + ` ${m.manufacturer} ${m.model} ${m.watts} W (${pv.moduleSource})`);
    } else if ((postedId && postedId !== m.panelId)
        || (!postedId && postedModel && !`${m.manufacturer} ${m.model}`.includes(postedModel))
        || (postedWatts && postedWatts !== m.watts)) {
      out.push(`module: permit ${postedId ?? postedModel} ${postedWatts || '?'} W — design ${m.panelId}`
        + ` ${m.watts} W (${pv.moduleSource})`);
    }
  }
  const postedKw = Number(sys.totalDcKw) || 0;
  if (pv.dcStcKw !== null && Math.abs(postedKw - pv.dcStcKw) > 0.005) {
    out.push(`DC size: permit ${postedKw || 'none'} kW — design ${pv.dcStcKw} kW (${pv.dcSizeSource})`);
  }
  return out;
}
