// ═══════════════════════════════════════════════════════════════
// Wave 5B — per-subsystem SHEET helpers (scoped views + scoped inputs).
//
// One place implements the "roof-scoped VIEW pattern" pageArrayPrimary
// pioneered (arrayPages.ts) so every hybrid detail sheet — fence elevation,
// ground array plan, per-sub circuit layout, per-sub structural detail and
// per-sub PE letter — scopes the SAME way:
//
//   view  = { ...cad, systemType: <sub's CAD type>, origin/totals from the
//             sub's OWN hybrid section }
//   input = { ...input, panelPositions filtered by classifyPanel, system
//             totals from the section, _projectTotal* stashed for the title
//             block, inverters filtered to the sub's tagged fleet }
//
// PURE — no I/O, no engine runs. Single-system inputs never call these
// (generatePermit's manifest gates on cad.hybrid), so legacy plansets are
// byte-identical.
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel, CADSystemType } from '@/lib/cad/types';
import { classifyPanel, isSubSystemKey, type SubSystemKey } from '../utils/subSystems';
import { getInverterById, getMicroinverterById, getPanelById } from '@/lib/equipment-db';

/** Sub key → canonical CAD system type (drives sheet composition/validation). */
export const SUB_KEY_TO_CAD_TYPE: Record<SubSystemKey, CADSystemType> = {
  roof: 'roof',
  ground: 'ground_mount',
  fence: 'solar_fence',
};

/** Sub key → sheet-label word (title suffixes, section headers). */
export const SUB_LABEL: Record<SubSystemKey, string> = {
  roof: 'ROOF',
  ground: 'GROUND',
  fence: 'FENCE',
};

/** Sheet-id suffix scheme (documented): the PRIMARY sub keeps the legacy
 *  unsuffixed ids (PV-1 / PV-1B / PV-3 / PE-1); additional subs get a single
 *  trailing letter — G for ground, F for fence, R for roof (roof is only
 *  suffixed when it is NOT the primary, which cannot happen under the fixed
 *  roof > ground > fence primary rule, but the map stays total). */
export const SUB_SHEET_SUFFIX: Record<SubSystemKey, string> = {
  roof: 'R',
  ground: 'G',
  fence: 'F',
};

export interface HybridSectionRef {
  key: SubSystemKey;
  originLat: number;
  originLng: number;
  totalPanels: number;
  dcKw: number;
  equipment?: {
    panelModel?: string;
    panelWatts?: number;
    voc?: number;
    isc?: number;
    inverterMfr?: string;
    inverterModel?: string;
    topology?: 'string' | 'micro' | 'optimizer';
    acKwPerDevice?: number;
  };
}

/** The hybrid sections in fixed roof > ground > fence order (present only).
 *  Returns [] for single-system models — callers gate hybrid rendering on
 *  `hybridSheetSections(cad).length > 1`. */
export function hybridSheetSections(cad: CADModel | null | undefined): HybridSectionRef[] {
  const sections = cad?.hybrid?.sections ?? [];
  const ordered: HybridSectionRef[] = [];
  for (const key of ['roof', 'ground', 'fence'] as const) {
    const sec = sections.find(s => s.key === key);
    if (!sec) continue;
    const ref = sec as HybridSectionRef;
    // SYSTEMIC ROOT #2: the CAD section's dcKw is PRORATED at source (cadEngine
    // scopeInputToSubSystem spreads projectDcKw by panel fraction), so the cover
    // + TOC (which read sec.dcKw straight from here) showed roof 20.23 vs SCHED's
    // true 48×430 = 20.64. When the section carries its OWN nameplate watts
    // (enriched from the sub's SubSystemEquipment entry — present on real designs
    // that thread project.subSystems), recompute the honest per-sub kW = modules
    // × nameplate so every consumer of this list agrees with SCHED. Absent
    // watts (a fixture with no project.subSystems), the prorated value stands.
    const npW = Number(ref.equipment?.panelWatts);
    ordered.push(npW > 0 && ref.totalPanels > 0
      ? { ...ref, dcKw: Math.round(ref.totalPanels * npW) / 1000 }
      : ref);
  }
  return ordered;
}

/** True when the model carries >1 sub-system section (the Wave-5B gate). */
export function isHybridPlanset(cad: CADModel | null | undefined): boolean {
  return hybridSheetSections(cad).length > 1;
}

/** Primary sub = first present key in fixed roof > ground > fence order
 *  (contract §1.4 — deterministic, never a panel-count vote). */
export function primarySubKey(cad: CADModel | null | undefined): SubSystemKey {
  return hybridSheetSections(cad)[0]?.key ?? 'roof';
}

/**
 * Sub-typed CAD VIEW: same composed model, but typed/origined/totalled as ONE
 * sub-system so composition, validation and the drawing agree (the
 * pageArrayPrimary pattern). The sub-model geometry (cad.roof / cad.ground /
 * cad.fence) is local XY relative to the SECTION's own origin — the view
 * swaps the base origin for the section's.
 */
export function subScopedView(cad: CADModel, key: SubSystemKey): CADModel {
  const sec = hybridSheetSections(cad).find(s => s.key === key);
  if (!sec) return cad;
  return {
    ...cad,
    systemType: SUB_KEY_TO_CAD_TYPE[key],
    originLat: sec.originLat,
    originLng: sec.originLng,
    totalPanels: sec.totalPanels,
    totalDcKw: sec.dcKw,
    // Wave 6.2 (punch 1c): mark the view as explicitly sub-scoped so the
    // drafting composer renders THIS sub's own plan (fence line / ground
    // rows) instead of re-taking its hybrid branch and embedding the whole
    // roof site plan again (the PV-1F "SEGMENT PLAN" inset was a shrunken
    // duplicate of PV-1). Underscore-prefixed passenger field — CADModel
    // serialization is unaffected and single-system paths never see it.
    _subScoped: key,
  } as CADModel;
}

/** Inverter → owning sub key. Tagged inverters belong to their tag; untagged
 *  inverters inherit the PRIMARY sub (same rule as conductorAuthority). */
export function inverterSubKey(
  inv: { subSystemKey?: string } | null | undefined,
  primary: SubSystemKey,
): SubSystemKey {
  const k = inv?.subSystemKey;
  return isSubSystemKey(k) ? k : primary;
}

/**
 * Sub-scoped PermitInput: panelPositions filtered by placement stamps
 * (membership authority — contract §1.1), system totals from the section,
 * inverter fleet filtered to the sub, and `_projectTotal*` stashed so the
 * title block keeps printing PROJECT totals (same stash pageArrayPrimary
 * uses; titleBlock.ts reads it).
 */
export function subScopedInput(input: PermitInput, cad: CADModel, key: SubSystemKey): PermitInput {
  const sec = hybridSheetSections(cad).find(s => s.key === key);
  const primary = primarySubKey(cad);
  type PanelPos = NonNullable<PermitInput['project']['panelPositions']>[number];
  const allPositions = (input.project?.panelPositions ?? []) as PanelPos[];
  const subPositions = allPositions.filter(p => classifyPanel(p as Parameters<typeof classifyPanel>[0]) === key);
  const totalPanels = subPositions.length || sec?.totalPanels || 0;

  const allInverters = input.system?.inverters ?? [];
  // UNTAGGED-FLEET LEAK (Ray 2026-07-17: roof PV-1B printed a STRING LEGEND
  // with all 5 subs' strings — 9/9 fence + phantom "String 1 × 54" roof micro
  // + 8/8 ground — and DC kW 23.76 priced the roof at the FENCE's 440W): when
  // a payload's inverters lost their subSystemKey tags, inverterSubKey sends
  // EVERY inverter to the primary sub, so the primary's sheet enumerates the
  // whole hybrid fleet (non-primary subs stay correct via synthesis below).
  // The §1.1 equipment-authority map (project.subSystems[key].inverterId) still
  // knows each inverter's owner — resolve untagged inverters through it by
  // inverterId (same rule as the permit route's hybrid self-heal) before
  // falling back to the primary-inherit rule.
  const _subsMap = (input.project as {
    subSystems?: Record<string, { inverterId?: string }> })?.subSystems ?? {};
  const _invIdToKey = new Map<string, SubSystemKey>();
  for (const [k, v] of Object.entries(_subsMap)) {
    if (isSubSystemKey(k) && v?.inverterId) _invIdToKey.set(String(v.inverterId), k);
  }
  const subInverters = allInverters.filter(inv => {
    const rec = inv as { subSystemKey?: string; inverterId?: string };
    if (isSubSystemKey(rec.subSystemKey)) return rec.subSystemKey === key;
    const mapped = rec.inverterId ? _invIdToKey.get(String(rec.inverterId)) : undefined;
    return (mapped ?? primary) === key;
  });

  // ── SYSTEMIC ROOT #2 FIX — per-sub DC kW = the sub's OWN modules × nameplate
  //    watts (Σ per sub), NEVER projectDcKw × panelFraction. Both the CAD
  //    section dcKw (cadEngine scopeInputToSubSystem prorates fullKw/fullPanels)
  //    and the old fallback here spread the PROJECT total by panel count, so the
  //    roof read 20.23 kW on the cover/PV-1/PV-1B/PV-4A/PE-1 while SCHED showed
  //    the true 48×430 = 20.64. Resolve the nameplate from the sub's tagged
  //    inverter-fleet string, then the section-equipment carriage, then a placed
  //    module's own wattage — and prefer summing each placed module's wattage so
  //    a mixed-wattage sub still totals exactly. `sec.dcKw`/proration survive
  //    only as a last resort when no nameplate is resolvable at all.
  const subString0 = (subInverters[0] as
    { strings?: Array<{ panelWatts?: number }> } | undefined)?.strings?.[0];
  const nameplateW =
    Number(subString0?.panelWatts)
    || Number(sec?.equipment?.panelWatts)
    || Number((subPositions.find(p => Number((p as { wattage?: number }).wattage) > 0) as
        { wattage?: number } | undefined)?.wattage)
    || 0;
  let sumWatts = 0;
  for (const p of subPositions) {
    const w = Number((p as { wattage?: number }).wattage);
    // §1.1: within a sub the equipment-authority nameplate GOVERNS — a sub is
    // by-contract panel-homogeneous, and per-panel wattage stamps go stale
    // when the panel is swapped after placement. Ray's live PV-1BG (2026-07-16):
    // 16 ground modules stamped 405W (pre-swap) while the map + STRING LEGEND
    // said 580W → "DC kW 6.48" printed beside "9.28 kWdc" on the same sheet.
    // Stamps remain the fallback when no map/string nameplate resolves.
    sumWatts += nameplateW > 0 ? nameplateW : ((isFinite(w) && w > 0) ? w : 0);
  }
  const computedDcKw = subPositions.length
    ? Math.round(sumWatts) / 1000
    : Math.round(totalPanels * nameplateW) / 1000;
  const totalDcKw = computedDcKw > 0
    ? computedDcKw
    : (sec?.dcKw
      ?? (input.system?.totalDcKw && input.system?.totalPanels
        ? (input.system.totalDcKw * totalPanels) / input.system.totalPanels
        : 0));

  // LEAK FIX (Ray — fence STRING LEGEND showed roof+ground+fence strings): when
  // the sub has NO tagged inverter, DO NOT fall back to the whole fleet (that
  // enumerates every sub's strings on this sub's sheet). Synthesize the sub's
  // OWN inverter from the §1.1 equipment-authority map (project.subSystems[key])
  // — the SAME source the permit E-1 resolves through — scoped to THIS sub only.
  const _mapEntry = (input.project as {
    subSystems?: Record<string, { inverterId?: string; topology?: string; panelId?: string }> }
  )?.subSystems?.[key];
  let scopedInverters = subInverters;
  if (subInverters.length === 0 && _mapEntry?.inverterId && totalPanels > 0) {
    const _micro = getMicroinverterById(_mapEntry.inverterId) as { manufacturer?: string; model?: string; acOutputW?: number } | undefined;
    const _str = _micro ? undefined : getInverterById(_mapEntry.inverterId) as { manufacturer?: string; model?: string; acOutputKw?: number } | undefined;
    const _dev = _micro ?? _str;
    if (_dev) {
      const _panel = (_mapEntry.panelId ? getPanelById(_mapEntry.panelId) : undefined) as
        { manufacturer?: string; model?: string; watts?: number; voc?: number; isc?: number } | undefined;
      scopedInverters = [{
        subSystemKey: key,
        manufacturer: _dev.manufacturer ?? '', model: _dev.model ?? '',
        type: _micro ? 'micro' : (_mapEntry.topology === 'optimizer' ? 'optimizer' : 'string'),
        acOutputKw: _micro ? ((_micro.acOutputW ?? 0) / 1000) : (_str?.acOutputKw ?? 0),
        strings: [{
          subSystemKey: key, panelCount: totalPanels,
          panelManufacturer: _panel?.manufacturer,
          panelModel: _panel?.model ?? sec?.equipment?.panelModel,
          panelWatts: nameplateW || _panel?.watts,
          panelVoc: _panel?.voc, panelIsc: _panel?.isc,
        }],
      }] as unknown as typeof subInverters;
    }
  }

  // Scoped AC kW: micro fleets carry PER-UNIT acOutputKw (× the sub's own
  // modules); string/optimizer fleets carry per-inverter output.
  let totalAcKw = 0;
  for (const inv of scopedInverters) {
    const rec = inv as { acOutputKw?: number; type?: string };
    const per = Number(rec.acOutputKw) || 0;
    totalAcKw += rec.type === 'micro' ? per * totalPanels : per;
  }

  return {
    ...input,
    project: {
      ...(input.project ?? {}),
      panelPositions: subPositions,
    },
    system: {
      ...(input.system ?? {}),
      totalPanels,
      totalDcKw,
      ...(totalAcKw > 0 ? { totalAcKw } : {}),
      // Scoped to THIS sub (tagged fleet, else synthesized from the map) — never
      // the whole fleet, so the sheet's strings/legend can't leak other subs.
      inverters: scopedInverters,
      // Project totals for project-wide chrome (title block) — subset totals
      // above are for the sheet body only.
      _projectTotalDcKw: input.system?.totalDcKw,
      _projectTotalPanels: input.system?.totalPanels,
    },
  } as PermitInput;
}

// ═══════════════════════════════════════════════════════════════
// Per-sub structural mapping — raw V4 result (compliance.structural.
// subSystems[key], stored by generatePermit) → the legacy
// compliance.structural shape every structural/PE sheet reads.
// Same field mapping generatePermit applies for the roof run.
// ═══════════════════════════════════════════════════════════════

interface V4ResultLike {
  wind?: { designWindSpeedMph?: number; velocityPressurePsf?: number; netUpliftPressurePsf?: number };
  snow?: { groundSnowLoadPsf?: number; roofSnowLoadPsf?: number };
  mountLayout?: { upliftPerMountLbs?: number; safetyFactor?: number; mountSpacingIn?: number };
  rafterAnalysis?: {
    size?: string; spacingIn?: number; spanFt?: number; framingType?: string;
    bendingMomentDemandFtLbs?: number; bendingMomentCapacityFtLbs?: number;
    overallUtilization?: number; deflectionIn?: number; allowableDeflectionIn?: number;
    fbRefPsi?: number; fbPrimePsi?: number; totalLoadPsf?: number;
    pvDeadLoadPsf?: number; roofDeadLoadPsf?: number;
  };
}

type ComplianceStructural = NonNullable<PermitInput['compliance']>['structural'];

/**
 * Map ONE sub-system's raw V4 structural result onto the legacy
 * compliance.structural shape (wind / snow / attachment / rafter), keeping
 * site-wide fields (seismic, exposure) from the project-level analysis.
 * Roof-only rafter fields are included only when the run produced them.
 */
export function mapSubStructural(
  sub: V4ResultLike | undefined,
  fallback: ComplianceStructural | undefined,
  key: SubSystemKey,
): ComplianceStructural {
  const fb = (fallback ?? {}) as Record<string, any>;
  if (!sub) return fallback as ComplianceStructural;
  const wa = sub.wind ?? {};
  const sa = sub.snow ?? {};
  const ml = sub.mountLayout ?? {};
  const ra = sub.rafterAnalysis;
  const out: Record<string, any> = {
    ...fb,
    wind: {
      ...(fb.wind ?? {}),
      windSpeed: wa.designWindSpeedMph ?? fb.wind?.windSpeed,
      velocityPressure: wa.velocityPressurePsf ?? fb.wind?.velocityPressure,
      netUpliftPressure: wa.netUpliftPressurePsf ?? fb.wind?.netUpliftPressure,
      upliftPerAttachment: ml.upliftPerMountLbs ?? fb.wind?.upliftPerAttachment,
    },
    snow: {
      ...(fb.snow ?? {}),
      groundSnowLoad: sa.groundSnowLoadPsf ?? fb.snow?.groundSnowLoad,
      roofSnowLoad: sa.roofSnowLoadPsf ?? fb.snow?.roofSnowLoad,
    },
    attachment: {
      ...(fb.attachment ?? {}),
      safetyFactor: ml.safetyFactor ?? fb.attachment?.safetyFactor,
      maxAllowedSpacing: ml.mountSpacingIn ?? fb.attachment?.maxAllowedSpacing,
      totalUpliftPerAttachment: ml.upliftPerMountLbs ?? fb.attachment?.totalUpliftPerAttachment,
      ...(ml.upliftPerMountLbs && ml.safetyFactor
        ? { lagBoltCapacity: ml.upliftPerMountLbs * ml.safetyFactor }
        : {}),
    },
  };
  if (key === 'roof' && ra) {
    out.rafter = {
      rafterSize: ra.size,
      rafterSpacing: ra.spacingIn,
      rafterSpan: ra.spanFt,
      framingType: ra.framingType,
      bendingMoment: ra.bendingMomentDemandFtLbs,
      allowableBendingMoment: ra.bendingMomentCapacityFtLbs,
      utilizationRatio: ra.overallUtilization,
      deflection: ra.deflectionIn,
      allowableDeflection: ra.allowableDeflectionIn,
      Fb_prime: ra.fbPrimePsi,
      totalLoadPsf: ra.totalLoadPsf,
    };
  } else if (key !== 'roof') {
    // Ground/fence letters must not inherit the ROOF rafter block — its
    // utilization/DO-NOT-ISSUE state belongs to the building, not the yard.
    delete out.rafter;
  }
  return out as ComplianceStructural;
}

/** The sub's raw V4 structural result stored by generatePermit (hybrid only). */
export function subStructuralResult(input: PermitInput, key: SubSystemKey): V4ResultLike | undefined {
  const subs = (input.compliance?.structural as { subSystems?: Record<string, V4ResultLike> } | undefined)?.subSystems;
  return subs?.[key];
}
