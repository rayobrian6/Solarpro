// ═══════════════════════════════════════════════════════════════
// Array Pages — Roof Plan, Ground Plan, Fence Plan, Geometry, Primary
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import type { RenderContext } from '@/lib/drafting/renderContext';
import {
  getSheetComposition, validateSheetComposition, validateSheet,
} from '@/lib/drafting/sheetComposition';
import { titleBlock } from '../utils/titleBlock';
import { sysTypeLabel, pv2Title, compassDir } from '../utils/helpers';
import { resolvePanelSpecs } from '../utils/panelSpecs';
import { resolveModuleIdentity } from '@/lib/equipment/moduleIdentity';
import { projectStructuralFromInput } from '../snapshot/structuralProjection';
import { projectCodeAuthorityFromInput } from '../snapshot/codeAuthorityProjection';
import { structuralBannerHtml } from '../utils/structuralBanner';
import { resolveFireSetbackIn, arrayCoverageFrac, resolveFireSetbackBasis } from '../utils/fireSetback';
import { composeDrawPage, getPrimaryView, getSecondaryView, drawDimension, escapeH } from '../utils/drawing';
import * as drawingEngine from '@/lib/drafting/composers';
import { isFence, isGround, isRoof, displaySystemType } from '@/lib/system';
import { classifyPanel } from '../utils/subSystems';
import { isHybridPlanset, primarySubKey, subScopedView, subScopedInput } from './subSystemSheets';
import { microBranchCount, balancedBranchSizes, planMicroBranches } from '../utils/branching';
// §5 (BAR closeout 2026-07-25) — PV-1B is the AC BRANCH CIRCUIT LAYOUT, so the
// open-air branch grounding method + its quantity must read the SAME canonical
// authority E-1 / PV-4B project (gate 7: separate-EGC language on any sheet
// requires the matching route + BOM quantity). Read-only projection.
import { peekSnapshot } from '../snapshot/read';
import { projectOpenAirBranchGrounding } from '../snapshot/electricalProjection';
import { GROUNDING_PENDING_LABEL, GROUNDING_AUTHORITY_BLOCKER_CODE } from '../snapshot/groundingAuthority';
import { formatPitchDeg, formatPitchRangeDeg } from '@/lib/structural/roofPitch';

export function pageRoofPlan(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null): string {
  // ── CAD validation ────────────────────────────────────────────────────────
  const vr = validateSheetComposition('roof', cad);
  if (!vr.valid) console.warn('[pageRoofPlan] CAD warnings:', vr.errors);

  // ── Composition — drives layout, data, validation (Step 3 hard bind) ──────
  const inputRec = input as unknown as Record<string, unknown>;
  const comp = getSheetComposition('roof', 'plan', cad, inputRec);

  // ── Hard-throw composition/system validation (Step 8) ─────────────────────
  validateSheet('roof', comp);

  // ── Primary view via explicit dispatcher (Step 4) ─────────────────────────
  let drawingSvg = getPrimaryView(comp.primaryView, cad, input, ctx);
  if (!drawingSvg || drawingSvg.length < 500) {
    throw new Error(`[pageRoofPlan] getPrimaryView(${comp.primaryView}) returned empty SVG`);
  }

  // ── This IS the site plan now (PV-1). The standalone site sheet was folded
  // in 2026-07-08: the roof drawing carries the integrated site context —
  // property line, street, driveway (aerial), and service equipment — drawn
  // by drawRoofPlan via drawSiteContextEls, matching the professional reference.

  // ── Secondary view (Step 6) ───────────────────────────────────────────────
  // Roof plan: no secondary strip (setbacks/obstructions integrated into primary)
  const secondarySvg: string | null = null;

  return `
  <div class="page">
    ${titleBlock(input, 'PV-1', 'SITE & ROOF PLAN — MODULE LAYOUT & FIRE SETBACKS', pageNum, totalPages)}
    ${structuralBannerHtml(projectStructuralFromInput(input).banner, { compact: true, input, sheetId: 'PV-1' })}
    ${composeDrawPage(comp, drawingSvg, secondarySvg)}
  </div>`;
}



export function pageGroundArrayPlan(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null, opts?: { sheetId?: string; title?: string }): string {
  const vr = validateSheetComposition('ground_mount', cad);
  if (!vr.valid) console.warn('[pageGroundArrayPlan] CAD warnings:', vr.errors);

  const inputRec = input as unknown as Record<string, unknown>;
  const comp = getSheetComposition('ground_mount', 'plan', cad, inputRec);
  validateSheet('ground_mount', comp);

  const drawingSvg = getPrimaryView(comp.primaryView, cad, input, ctx);
  if (!drawingSvg || drawingSvg.length < 500) {
    throw new Error(`[pageGroundArrayPlan] getPrimaryView(${comp.primaryView}) returned empty SVG`);
  }

  // Secondary: row layout strip
  let secondarySvg: string | null = null;
  for (const sv of comp.secondaryViews) {
    const s = getSecondaryView(sv, cad, input, ctx);
    if (s) { secondarySvg = s; break; }
  }

  return `
  <div class="page">
    ${titleBlock(input, opts?.sheetId ?? 'PV-1', opts?.title ?? 'SITE & GROUND ARRAY PLAN', pageNum, totalPages)}
    ${structuralBannerHtml(projectStructuralFromInput(input).banner, { compact: true, input, sheetId: opts?.sheetId ?? 'PV-1' })}
    ${composeDrawPage(comp, drawingSvg, secondarySvg)}
  </div>`;
}



export function pageFencePlan(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null, opts?: { sheetId?: string; title?: string }): string {
  console.log('[PLANSET ENGINE] pageFencePlan — PV-1 fence elevation is PRIMARY view');
  const vr = validateSheetComposition('solar_fence', cad);
  if (!vr.valid) console.warn('[pageFencePlan] CAD warnings:', vr.errors);

  // ── Composition: fence PV-2 = elevation_dominant, primaryView=fence_elevation
  const inputRec = input as unknown as Record<string, unknown>;
  const comp = getSheetComposition('solar_fence', 'plan', cad, inputRec);

  // ── Hard-throw: fence MUST render elevation (Step 8)
  validateSheet('solar_fence', comp);

  // ── Primary view: fence_elevation → getStructuralFromCAD (Step 4)
  const primarySvg = getPrimaryView(comp.primaryView, cad, input, ctx);
  if (!primarySvg || primarySvg.length < 500) {
    throw new Error(`[pageFencePlan] getPrimaryView(${comp.primaryView}) returned empty SVG — fence elevation required`);
  }

  // ── Secondary view: segment_plan (Step 6)
  let secondarySvg: string | null = null;
  for (const sv of comp.secondaryViews) {
    const s = getSecondaryView(sv, cad, input, ctx);
    if (s) { secondarySvg = s; break; }
  }

  return `
  <div class="page">
    ${titleBlock(input, opts?.sheetId ?? 'PV-1', opts?.title ?? 'SOLAR FENCE ELEVATION & PLAN', pageNum, totalPages)}
    ${structuralBannerHtml(projectStructuralFromInput(input).banner, { compact: true, input, sheetId: opts?.sheetId ?? 'PV-1' })}
    ${composeDrawPage(comp, primarySvg, secondarySvg)}
  </div>`;
}



// ─── PV-1B: Array Geometry & String Layout ────────────────────────────────
// Detailed schematic showing array groupings, string assignments, row/col grid


// PV-1B must show the STRING LAYOUT (a string-colored grouping schematic) -- a
// DIFFERENT drawing from PV-1's to-scale site & roof plan. A prior "professional CAD"
// override here called drawingEngine.getArrayPlanFromCAD, the very renderer PV-1
// uses via getPrimaryView(roof_plan), so PV-1 and PV-1B came out as literal
// duplicates. Removed: PV-1B now renders its own schematicGridSvg below.

export function pageArrayGeometry(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null, opts?: { sheetId?: string; titleSuffix?: string }): string {
  const { project, system } = input;
  const _cpArr = projectCodeAuthorityFromInput(input);   // W4 §2 code editions
  // CAD-sourced: use cad.totalPanels as authoritative count
  const cadTotalPanels = cad.totalPanels;
  const cadSystemType = cad.systemType;
  const panels = project.panelPositions as Array<{
    id: string; lat: number; lng: number; row: number; col: number;
    tilt?: number; azimuth?: number; wattage?: number; orientation?: string; systemType?: string;
  }> || [];

  const totalPanels = cadTotalPanels || system.totalPanels || panels.length || 0;
  // Topology-aware circuit count: microinverters are AC BRANCH CIRCUITS, NOT one
  // DC string. Branch max is PER MODEL from the Enphase capability profiles
  // (NEC 80% on a 20A branch: IQ8+ 13, IQ8A 10, ...) — the old hardcoded 16
  // put 14 IQ8As on one branch, an NEC 690.8 plan-check violation.
  const _isMicro = (system.inverters?.[0]?.type === 'micro')
    || String((system as any).topology || '').toLowerCase().includes('micro');
  const _invModel = system.inverters?.[0]?.model;
  // PLANE-AWARE branch plan (never spans roof faces — installer truth). When
  // panel positions are absent (degraded payload), fall back to the flat
  // per-model NEC count.
  const _plan = _isMicro && panels.length > 0
    ? planMicroBranches(panels as any[], _invModel)
    : null;
  // DC-string paths must NEVER count a micro inverter's strings: for micros,
  // inverters[].strings is the phantom "1 string of N" carrier (panel model +
  // count), not an electrical string — a mixed/leaked fleet printed
  // "String 1 × 54 modules" on the roof sheet (Ray 2026-07-17).
  const _dcInverters = (system.inverters ?? []).filter(inv => inv.type !== 'micro');
  const totalStrings = _isMicro
    ? (_plan?.count ?? microBranchCount(totalPanels, _invModel))
    : (_dcInverters.reduce((sum, inv) => sum + (inv.strings?.length || 0), 0) || 1);
  const circuitWord   = _isMicro ? 'BRANCH' : 'STRING';
  const circuitWordPl = _isMicro ? 'BRANCHES' : 'STRINGS';  // proper plural (not "BRANCHS")
  const circuitLabel  = totalStrings !== 1 ? circuitWordPl : circuitWord;
  const circuitWordLc = _isMicro ? 'branch circuit' : 'string';
  // Per-module label prefix: 'B' for AC branch circuits (micro), 'S' for DC strings.
  const cPrefix = _isMicro ? 'B' : 'S';

  // Group panels by row for grid visualization
  const rows: Map<number, typeof panels> = new Map();
  panels.forEach(p => {
    const r = p.row ?? 0;
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r)!.push(p);
  });
  const rowNums = Array.from(rows.keys()).sort((a, b) => a - b);

  // Compute dominant tilt/azimuth from panel data
  // For roof systems, prefer the CAD roof plane azimuth/tilt as the authoritative
  // source (from canonical model), since panelPositions may contain stale or
  // averaged values that disagree with the actual roof face direction.
  const roofPlane0 = cad.roof?.planes?.[0];
  let sumTilt = 0, sumAz = 0, count = 0;
  panels.forEach(p => {
    if (p.tilt != null) { sumTilt += p.tilt; count++; }
    if (p.azimuth != null) sumAz += p.azimuth;
  });
  // Multi-plane roofs: show the RANGE across facets, not plane[0] only —
  // PV-2's per-facet table shows 17-19° while this sheet claimed "16.5°".
  const _pitches = (cad.roof?.planes ?? []).map((p: any) => p.pitch).filter((v: any) => isFinite(v));
  // 2026-08-29 - the RANGE was printed at toFixed(0) while each facet printed at
  // one decimal elsewhere, so this said "17–18" for the same two planes CERT
  // called 16.5 deg. And the fallback invented a 20 deg roof out of nothing: a
  // design with no pitch on file has no pitch to print.
  const _rangeDeg = isRoof(cadSystemType) && _pitches.length > 0
    ? formatPitchRangeDeg(_pitches)
    : (count > 0 ? formatPitchDeg(sumTilt / count) : null);
  const avgTilt = (_rangeDeg ?? 'PENDING').replace(/°$/, '');
  // Multi-plane roofs face MULTIPLE directions — claiming plane[0]'s azimuth
  // for the whole system printed "Azimuth 3° (N)" on a 4-plane N/S/E/W array.
  const _azList = (cad.roof?.planes ?? [])
    .map((p: any) => p.azimuth)
    .filter((v: any) => isFinite(v))
    .map((v: number) => ((v % 360) + 360) % 360);
  const _azDir = (az: number) => az >= 337.5 || az < 22.5 ? 'N' :
    az < 67.5 ? 'NE' : az < 112.5 ? 'E' : az < 157.5 ? 'SE' :
    az < 202.5 ? 'S' : az < 247.5 ? 'SW' : az < 292.5 ? 'W' : 'NW';
  // Gate on isRoof: _azList reads cad.roof.planes, which a hybrid CAD still
  // carries on GROUND/FENCE circuit sheets — PV-1BG printed the ROOF's
  // "MULTI — E/W (SEE PLANE LABELS)" as the ground array's azimuth while the
  // ground faces 181° (S) (Ray, 2026-07-16).
  const _multiAz = isRoof(cadSystemType) && _azList.length > 1
    && new Set(_azList.map(_azDir)).size > 1;
  const avgAz = isRoof(cadSystemType) && roofPlane0?.azimuth != null
    ? roofPlane0.azimuth.toFixed(0)
    : (count > 0 ? (sumAz / count).toFixed(0) : '180');

  // Determine compass direction from azimuth
  const azNum = parseFloat(avgAz);
  const compassDir = _azDir(((azNum % 360) + 360) % 360);
  // Display string — multi-plane arrays list the facet directions.
  const azDisplay = _multiAz
    ? `MULTI — ${[...new Set(_azList.map(_azDir))].join('/')} (SEE PLANE LABELS)`
    : `${avgAz}° (${compassDir})`;

  // Build SVG grid
  const cellW = 28, cellH = 38, gapX = 4, gapY = 6;
  const maxCols = Math.max(...Array.from(rows.values()).map(r => r.length), 1);
  const gridW = maxCols * (cellW + gapX) + 10;
  const gridH = rowNums.length * (cellH + gapY) + 10;
  const svgW = Math.min(gridW + 80, 900);
  const svgH = Math.max(gridH + 60, 200);

  // Color per branch — 16 DISTINCT colors. drawRoofPlan groups trunk runs by
  // color, so a recycled palette would silently merge branch 1 with branch 9.
  const stringColors = ['#1b3f74','#cc0000','#cc6600','#5500cc','#0891b2','#be185d','#65a30d','#e5a100',
                        '#134e4a','#7f1d1d','#92400e','#312e81','#155e75','#831843','#3f6212','#713f12'];

  // Assign branch index to each panel — PLANE-AWARE (Ray, 2026-07-03:
  // "logic says we are not linking strings across opposite sides of the
  // roof"). planMicroBranches (computed above) never lets a branch span
  // planes: each face chunks into its own NEC-sized branches; small hip-cap
  // planes get their own short branch instead of piggybacking over the ridge.
  const panelStringMap: Map<string, number> = _plan
    ? _plan.assign
    : new Map();
  if (!_isMicro) {
    // String-inverter path: keep the serpentine chunking over totalStrings.
    const sortedForStrings = [...panels].sort((a: any, b: any) => {
      const rr = (a.row ?? 0) - (b.row ?? 0);
      if (rr !== 0) return rr;
      return (a.col ?? 0) - (b.col ?? 0);
    });
    const _sizes = balancedBranchSizes(sortedForStrings.length, totalStrings);
    let _bi = 0, _used = 0;
    sortedForStrings.forEach((p) => {
      if (_used >= (_sizes[_bi] ?? Infinity) && _bi < _sizes.length - 1) { _bi++; _used = 0; }
      panelStringMap.set(p.id, _bi);
      _used++;
    });
  }
  const panelsPerString = _plan ? (_plan.sizes[0] ?? totalPanels)
    : Math.ceil(totalPanels / Math.max(totalStrings, 1));

  let svgCells = '';
  if (panels.length > 0 && panels.length <= 200) {
    rowNums.forEach((rn, ri) => {
      const row = rows.get(rn)!.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
      row.forEach((p, ci) => {
        const x = 40 + ci * (cellW + gapX);
        const y = 30 + ri * (cellH + gapY);
        const si = panelStringMap.get(p.id) ?? 0;
        const color = stringColors[si % stringColors.length];
        svgCells += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.2" rx="2"/>`;
        svgCells += `<text x="${x + cellW/2}" y="${y + cellH/2 - 4}" text-anchor="middle" font-size="6" fill="#000" font-weight="600">R${rn+1}</text>`;
        svgCells += `<text x="${x + cellW/2}" y="${y + cellH/2 + 5}" text-anchor="middle" font-size="5.5" fill="#555">C${(p.col??ci)+1}</text>`;
        svgCells += `<text x="${x + cellW/2}" y="${y + cellH/2 + 14}" text-anchor="middle" font-size="5" fill="${color}" font-weight="700">${cPrefix}${si+1}</text>`;
      });
    });
  } else if (panels.length === 0) {
    // Schematic from system config
    const invs = system.inverters || [];
    invs.forEach((inv, ii) => {
      (inv.strings || []).forEach((str, si) => {
        const ppc = str.panelCount;
        for (let pi = 0; pi < Math.min(ppc, 20); pi++) {
          const x = 40 + pi * (cellW + gapX);
          const y = 30 + (ii * (invs[0].strings?.length || 1) + si) * (cellH + gapY);
          const color = stringColors[si % stringColors.length];
          svgCells += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.2" rx="2"/>`;
          svgCells += `<text x="${x + cellW/2}" y="${y + cellH/2 + 4}" text-anchor="middle" font-size="5.5" fill="${color}" font-weight="700">${cPrefix}${si+1}</text>`;
        }
        if (ppc > 20) {
          const x = 40 + 20 * (cellW + gapX);
          const y = 30 + (ii * (invs[0].strings?.length || 1) + si) * (cellH + gapY);
          svgCells += `<text x="${x + 4}" y="${y + cellH/2 + 4}" font-size="8" fill="#555">+${ppc-20} more</text>`;
        }
      });
    });
  }

  // Circuit legend. For microinverters the system has AC branch circuits (not DC
  // strings); inverters[].strings is the phantom "1 string of N" fallback, so derive
  // the legend from the same per-panel branch grouping the grid uses (panelStringMap)
  // — otherwise the legend ("String 1, Qty 52") contradicts the B1..Bn grid cells.
  // Wp from the SYSTEM record (kW ÷ modules), never the stale per-panel
  // wattage field — layout panels carried 440W while the set said 400W,
  // and a checker multiplies qty × Wp on page one.
  // Wp from the sub's REAL nameplate (inverter-fleet string first, then a
  // placed module's own wattage) — NOT kW ÷ count. Dividing the (previously
  // prorated) per-sub kW by the module count printed 421W for a 430W module;
  // even with the kW now correct, count-division is a lossy round-trip, so the
  // nameplate is authoritative and kW÷count is only a last-ditch fallback.
  const _nameplateWp =
    Number(system.inverters?.[0]?.strings?.[0]?.panelWatts)
    || Number(panels.find(p => Number((p as { wattage?: number }).wattage) > 0)?.wattage)
    || 0;
  const _sysWatts = (system.totalDcKw && totalPanels)
    ? Math.round((system.totalDcKw * 1000) / totalPanels) : null;
  const _legendWatts = _nameplateWp
    || _sysWatts
    || system.inverters?.[0]?.strings?.[0]?.panelWatts
    || panels[0]?.wattage || 400;
  const legendItems = _isMicro
    ? Array.from({ length: totalStrings }, (_, bi) => ({
        si: bi,
        label: `Branch ${bi + 1}`,
        count: panels.filter(p => panelStringMap.get(p.id) === bi).length,
        model: '—',
        watts: _legendWatts,
        voc: 0,
        isc: 0,
      }))
    : (_dcInverters.flatMap((inv, ii) =>
        (inv.strings || []).map((str, si) => {
          // BRAIDON PDF AUDIT 2026-08-27 (N1) — `|| 41.6` / `|| 12.26` were the generic
          // copy-paste values, printed on the string legend as if they were the selected
          // module's. Resolve the module by its own model through the canonical accessor;
          // when it will not resolve, print 0 (the legend renders it as blank) rather than
          // another product's electrical data.
          const _rec = resolveModuleIdentity({ model: str.panelModel }).spec;
          return {
            si: ii * (_dcInverters[0]?.strings?.length || 1) + si,
            label: str.label || `String ${si+1}`,
            count: str.panelCount,
            model: str.panelModel || '—',
            watts: str.panelWatts || _rec?.watts || 0,
            voc: str.panelVoc || _rec?.voc || 0,
            isc: str.panelIsc || _rec?.isc || 0,
          };
        })
      ) || []);

  // ── PIPELINE v47.343: Build array grid SVG scaled to fill draw-zone ──────
  const AG_VB_W = 1200;
  const AG_VB_H = 700;
  const agMaxCols = Math.max(...Array.from(rows.values()).map(r => r.length), 1, 12);
  const agRowCount = Math.max(rowNums.length, 1, 3);
  const agCellW = Math.min(Math.floor((AG_VB_W - 120) / agMaxCols) - 4, 72);
  const agCellH = Math.min(Math.floor((AG_VB_H - 80) / agRowCount) - 6, 96);
  const agGapX = Math.max(3, Math.floor(agCellW * 0.08));
  const agGapY = Math.max(4, Math.floor(agCellH * 0.08));

  let agCells = '';
  if (panels.length > 0 && panels.length <= 300) {
    rowNums.forEach((rn, ri) => {
      const row = rows.get(rn)!.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
      row.forEach((p, ci) => {
        const x = 80 + ci * (agCellW + agGapX);
        const y = 42 + ri * (agCellH + agGapY);
        const si = panelStringMap.get(p.id) ?? 0;
        const color = stringColors[si % stringColors.length];
        agCells += `<rect x="${x}" y="${y}" width="${agCellW}" height="${agCellH}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5" rx="3"/>`;
        agCells += `<text x="${x + agCellW/2}" y="${y + agCellH/2 - 6}" text-anchor="middle" font-size="${Math.max(7, agCellH * 0.13)}" fill="#000" font-weight="700">R${rn+1}</text>`;
        agCells += `<text x="${x + agCellW/2}" y="${y + agCellH/2 + 6}" text-anchor="middle" font-size="${Math.max(6, agCellH * 0.11)}" fill="#555">C${(p.col??ci)+1}</text>`;
        agCells += `<text x="${x + agCellW/2}" y="${y + agCellH/2 + 19}" text-anchor="middle" font-size="${Math.max(6, agCellH * 0.11)}" fill="${color}" font-weight="700">${cPrefix}${si+1}</text>`;
      });
      const rowLabelY = 42 + ri * (agCellH + agGapY) + agCellH/2 + 4;
      agCells += `<text x="74" y="${rowLabelY}" text-anchor="end" font-size="${Math.max(7, agCellH * 0.12)}" fill="#333" font-weight="600">R${rn+1}</text>`;
    });
    const firstRowPanels = rows.get(rowNums[0]) || [];
    firstRowPanels.forEach((_p, ci) => {
      const cx = 80 + ci * (agCellW + agGapX) + agCellW/2;
      agCells += `<text x="${cx}" y="30" text-anchor="middle" font-size="${Math.max(7, agCellW * 0.13)}" fill="#555">C${ci+1}</text>`;
    });
  } else if (panels.length === 0) {
    const invs = system.inverters || [];
    const totalSchRows = invs.reduce((s: number, inv: any) => s + (inv.strings?.length || 0), 0) || 1;
    let rowIdx = 0;
    invs.forEach((_inv: any, _ii: number) => {
      (_inv.strings || []).forEach((str: any, si: number) => {
        const ppc = Math.min(str.panelCount, 20);
        const color = stringColors[si % stringColors.length];
        const schCellW = Math.min(Math.floor((AG_VB_W - 120) / Math.max(ppc, 1)) - 3, 80);
        const schCellH = Math.min(Math.floor((AG_VB_H - 80) / totalSchRows) - 5, 100);
        const y = 42 + rowIdx * (schCellH + 4);
        for (let pi = 0; pi < ppc; pi++) {
          const x = 80 + pi * (schCellW + 3);
          agCells += `<rect x="${x}" y="${y}" width="${schCellW}" height="${schCellH}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5" rx="3"/>`;
          agCells += `<text x="${x + schCellW/2}" y="${y + schCellH/2 + 5}" text-anchor="middle" font-size="${Math.max(6, schCellH * 0.11)}" fill="${color}" font-weight="700">${cPrefix}${si+1}</text>`;
        }
        if (str.panelCount > 20) {
          agCells += `<text x="${80 + ppc * (schCellW + 3) + 4}" y="${y + schCellH/2 + 5}" font-size="9" fill="#555">+${str.panelCount - 20} more</text>`;
        }
        agCells += `<text x="74" y="${y + schCellH/2 + 4}" text-anchor="end" font-size="9" fill="#333" font-weight="600">${_isMicro ? 'Br' : 'Str'} ${si+1}</text>`;
        rowIdx++;
      });
    });
  } else {
    agCells = `<text x="${AG_VB_W/2}" y="${AG_VB_H/2 - 20}" text-anchor="middle" font-size="18" fill="#333" font-weight="700">${totalPanels} MODULES</text>`;
    agCells += `<text x="${AG_VB_W/2}" y="${AG_VB_H/2 + 10}" text-anchor="middle" font-size="12" fill="#555">${totalStrings} ${circuitWordLc}${totalStrings !== 1 ? 's' : ''} — see schedule</text>`;
  }

  const schematicGridSvg = `<svg viewBox="0 0 ${AG_VB_W} ${AG_VB_H}" width="100%" height="100%"
    preserveAspectRatio="xMidYMid meet"
    style="display:block;max-width:100%;max-height:100%;"
    xmlns="http://www.w3.org/2000/svg">
    <rect width="${AG_VB_W}" height="${AG_VB_H}" fill="#fafbfc"/>
    <rect width="${AG_VB_W}" height="26" fill="#000"/>
    <text x="10" y="17" font-size="11" fill="#fff" font-weight="700" font-family="SolarPro Sans, SolarPro Symbols">ARRAY GRID — ${totalPanels} MODULES / ${totalStrings} ${circuitLabel} — ${displaySystemType(cadSystemType)}</text>
    <text x="${AG_VB_W - 20}" y="18" text-anchor="end" font-size="12" fill="#fff" font-weight="700" font-family="SolarPro Sans, SolarPro Symbols">N↑</text>
    <g font-family="SolarPro Sans, SolarPro Symbols">
      ${agCells || `<text x="${AG_VB_W/2}" y="${AG_VB_H/2}" text-anchor="middle" font-size="16" fill="#999">No panel position data — schematic only</text>`}
    </g>
    <rect x="80" y="${AG_VB_H - 18}" width="120" height="5" fill="#aaa" rx="1"/>
    <text x="80" y="${AG_VB_H - 5}" font-size="8" fill="#777" font-family="SolarPro Sans, SolarPro Symbols">SCHEMATIC (NOT TO SCALE — NTS)</text>
  </svg>`;

  // ── v65: PV-2B now renders the REAL ROOF with modules colored by AC branch ──
  // Falls back to the schematic grid when no roof geometry is available.
  // Branch coloring + dropping PV-2's dimension callouts keeps the sheets distinct.
  let agDrawSvg: string;
  try {
    // Build per-panel branch color map — inserted in BRANCH ORDER so the
    // drawing's first-appearance color order equals B1..Bn (= legend order).
    const panelColorById: Map<string, string> = new Map();
    const _byBranch = [...panels].sort((a: any, b: any) =>
      (panelStringMap.get(a.id) ?? 0) - (panelStringMap.get(b.id) ?? 0));
    _byBranch.forEach(p => {
      const si = panelStringMap.get(p.id) ?? 0;
      panelColorById.set(p.id, stringColors[si % stringColors.length]);
    });

    // Use the same roof renderer as PV-2, but WITH branch colors
    // (drawRoofPlan switches to "circuit layout" mode when panelColorById is present)
    // Circuit sheet (PV-1B/PV-1BG/PV-1BF): pass the DC-string count + palette so
    // the GROUND top-view colors modules by string (PV-1BG was a clone of PV-1G's
    // physical layout). Only string systems get a string map; micro = AC branches.
    const _groundCircuit = !_isMicro ? { strings: totalStrings, colors: stringColors } : null;
    // Pass the RenderContext (carries the PermitDesignSnapshot) so the circuit
    // sheet draws modules as PURE PROJECTIONS of the canonical drawnPolygon
    // (viewport∘DT-SITE) — the SAME 31 polygons/ids PV-1 draws — instead of the
    // legacy locally-recreated rects. Without the snapshot the renderer falls
    // back to the legacy rect (standalone preview only).
    const roofSvg = drawingEngine.getArrayPlanFromCAD(cad, input, ctx ?? null, panelColorById, _groundCircuit);
    if (roofSvg && roofSvg.length > 500) {
      agDrawSvg = roofSvg;
    } else {
      agDrawSvg = schematicGridSvg;
    }
  } catch (_e) {
    // No usable roof model — fall back to the schematic grid
    console.warn('[PV-2B] Roof renderer failed, using schematic grid:', (_e as Error).message);
    agDrawSvg = schematicGridSvg;
  }

  // Fire-setback numbers from the SAME rule the drawing uses \u2014 needed by the
  // callouts below and the supplemental block further down.
  const _fsRoofFt2Early = ((cad.roof?.planes ?? []) as any[]).reduce((s, x) => s + (Number(x?.areaSqM) || 0), 0) * 10.7639;
  const _fsMeanPitch = (() => {
    const ps = ((cad.roof?.planes ?? []) as any[]).map(x => Number(x?.pitch)).filter(v => isFinite(v));
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : undefined;
  })();
  // P0-2 (data-authority register): the coverage fraction that decides the
  // 18"-vs-36" fire-setback band must use the ROOF sub's OWN module dims.
  // project.panelLengthIn/WidthIn are panel0 scalars — client intake writes
  // inverters[0].strings[0]'s panel there, the FENCE module on hybrids — so
  // the band was decided by fence-panel geometry. Resolve via the per-sub
  // panel-spec authority; single-system output is unchanged (no hybrid
  // carriage → legacy scalars).
  const _fsPanelDims = (() => {
    // W3 §2 — module footprint for the fire-setback coverage test PROJECTS from
    // the canonical snapshot module instance (exact catalog dims). The generic
    // 66×40 fallback is deleted; per-sub hybrids still resolve the roof sub's
    // own dims. No snapshot (standalone) → project scalars, never a made-up size.
    const _spDims = projectStructuralFromInput(input);
    const snapL = _spDims.moduleHeightIn, snapW = _spDims.moduleWidthIn;
    const legacyL = (snapL ?? (project.panelLengthIn as number)) || 0;
    const legacyW = (snapW ?? (project.panelWidthIn as number)) || 0;
    if (!isHybridPlanset(cad)) return { L: legacyL, W: legacyW };
    const ps = resolvePanelSpecs(input, cad, 'roof');
    if (!(ps.lengthIn > 0 && ps.widthIn > 0)) return { L: legacyL, W: legacyW };
    if (Math.abs(ps.lengthIn - legacyL) > 0.05 || Math.abs(ps.widthIn - legacyW) > 0.05) {
      console.warn(`[PV-1B] fire-setback coverage recomputed from roof-sub module dims: `
        + `${legacyL}x${legacyW}in (snapshot/project panel0) → ${ps.lengthIn}x${ps.widthIn}in (${ps.model})`);
    }
    return { L: ps.lengthIn, W: ps.widthIn };
  })();
  const _fsCovEarly = arrayCoverageFrac(totalPanels, _fsPanelDims.L, _fsPanelDims.W, _fsRoofFt2Early, _fsMeanPitch);
  const _fsInEarly = resolveFireSetbackIn(project.ahjRidgeSetbackIn as number | undefined, _fsCovEarly);

  // The canonical open-air branch grounding authority (the SAME object E-1 / PV-4B
  // print). Corrected 2026-07-25: the METHOD comes from the document-based
  // three-outcome resolver, never from the cable conductor count. Under the live
  // PENDING outcome PV-1B states the pending authority \u2014 it does not assert an EGC.
  const _agGnd = projectOpenAirBranchGrounding(peekSnapshot(input));
  const _agGndCallout = (!_isMicro || !_agGnd.present) ? []
    : _agGnd.outcome === 'PENDING_MANUFACTURER_AUTHORITY'
      ? [{ n: 5, label: 'Open-Air Branch Grounding',
           sub: `${GROUNDING_PENDING_LABEL} \u2014 method NOT ESTABLISHED for the selected `
              + `${_agGnd.authority?.selectedMicroinverterSku ?? 'micro'} + ${_agGnd.authority?.selectedCableAssemblySku ?? 'cable'}; `
              + `candidate ${_agGnd.conductorSize ?? '\u2014'} ${_agGnd.bomFootageFt ?? '\u2014'} ft = DESIGN QTY, NOT ORDERABLE `
              + `(${GROUNDING_AUTHORITY_BLOCKER_CODE}; see RS-1 / E-1 / PV-4B)` }]
      : _agGnd.outcome === 'NO_SEPARATE_EGC_REQUIRED'
        ? [{ n: 5, label: 'Open-Air Branch Grounding',
             sub: `LISTED METHOD per ${_agGnd.authority?.documentId ?? 'the verified manufacturer document'} \u2014 no additional `
                + `grounding conductor in the open-air branch section; module/racking bonding still required (see E-1 / PV-4B)` }]
        : [{ n: 5, label: 'NEC 250.122 Branch EGC',
             sub: `ADDITIONAL ${_agGnd.conductorSize ?? '#12'} ${_agGnd.conductorMaterial ?? 'Cu'} EGC open-air with each branch trunk `
                + `per ${_agGnd.authority?.documentId ?? 'the verified manufacturer document'} \u2014 ${_agGnd.bomFootageFt ?? 'PENDING'} ft (BOM); see E-1 / PV-4B` }];

  // Callout notes for data zone
  const agCalloutRows = [
    { n: 1, label: 'NEC 690.8', sub: _isMicro
        ? `AC branch \xd7 1.25 continuous = conductor sizing basis`
        : `String Isc \xd7 1.25 \xd7 1.25 = conductor sizing basis` },
    { n: 2, label: 'Tilt / Azimuth', sub: `${avgTilt}\xb0 tilt / ${azDisplay}` },
    { n: 3, label: isRoof(cadSystemType) ? 'IFC \xa71204.2 Setbacks' : isFence(cadSystemType) ? 'NEC 250.169 Bonding' : 'NEC 690.51 Labeling',
       sub: isRoof(cadSystemType) ? `${_fsInEarly}" ridge \xb7 18" hip/valley setback` : isFence(cadSystemType) ? 'All metalwork bonded to EGC \u2014 min #6 AWG Cu' : 'Equipment labeling at all access points' },
    { n: 4, label: 'DC Capacity', sub: `${system.totalDcKw?.toFixed(2) || '\u2014'} kW DC` },
    ..._agGndCallout,
  ].map(c =>
    `<div class="callout-row">` +
    `<span class="callout-bubble">${c.n}</span>` +
    `<span><strong>${c.label}</strong> \u2014 ${c.sub}</span>` +
    `</div>`
  ).join('');

  // System-specific supplemental data \u2014 setback text from the SAME rule the
  // drawing uses (it claimed 18" per-AHJ while PV-2 hatched 3'-0" bands).
  const _fsRoofFt2 = ((cad.roof?.planes ?? []) as any[]).reduce((s, x) => s + (Number(x?.areaSqM) || 0), 0) * 10.7639;
  // P0-2: same roof-sub module dims as the callout block above — never panel0.
  const _fsCov = arrayCoverageFrac(totalPanels, _fsPanelDims.L, _fsPanelDims.W, _fsRoofFt2, _fsMeanPitch);
  const _fsIn = resolveFireSetbackIn(project.ahjRidgeSetbackIn as number | undefined, _fsCov);
  // \u00a715 \u2014 the setback GEOMETRY is a modeled design assumption; the authority
  // BASIS stays PROVISIONAL until the AHJ + adopted IFC edition are verified.
  // Never assert "per AHJ" against an unverified/pending IFC adoption.
  const _fbArr = resolveFireSetbackBasis({ ifcEdition: _cpArr.ifc, verificationStatus: _cpArr.verificationStatus, ahjName: _cpArr.ahjName });
  const _amendNote = _fsIn >= 36 && _fsCov > 0.33 ? ' (36" governs: array > 33% of roof area)'
    : _fsIn === 18 ? ' (18" exception: array \u2264 33% of roof area)'
    : (_fbArr.verified ? ' (per adopted AHJ amendment)' : ' (provisional \u2014 pending AHJ amendment verification)');
  const agSupplemental = isRoof(cadSystemType) ? `
    <div class="draw-zone-hdr">FIRE SETBACKS \u2014 ${_fbArr.verified ? escapeH(_fbArr.citation) : 'PROVISIONAL BASIS'}</div>
    <div style="padding:2px 4px;font-size:6px;line-height:1.4;font-weight:700;color:${_fbArr.verified ? '#127a3e' : '#8a5a00'};background:${_fbArr.verified ? '#eefaf0' : '#fff7e6'};border:1px solid ${_fbArr.verified ? '#127a3e' : '#c9962a'};margin:0 0 3px;">
      ${escapeH(_fbArr.basisLabel)} \u2014 setback dimensions below are MODELED per IFC \xa71204.2; ${_fbArr.verified ? 'adopted requirement confirmed.' : 'not yet confirmed as an adopted AHJ requirement.'}
    </div>
    <div style="padding:3px 4px;font-size:6.5px;line-height:1.6;color:#333;">
      <div>\u2022 ${_fsIn}" ridge fire setback \u2014 IFC ${_fbArr.verified ? escapeH(_cpArr.ifc as string) : '(edition pending)'} \xa71204.2.1.1${_amendNote}</div>
      <div>\u2022 18" clear at hips/valleys \u2014 IFC ${_fbArr.verified ? escapeH(_cpArr.ifc as string) : '(edition pending)'} \xa71204.2.1.2</div>
      <div>\u2022 Modules may extend to eave (no eave req.)</div>
      <div>\u2022 36" access pathway \u2014 ${_fbArr.verified ? 'per adopted AHJ requirement' : 'modeled; pending AHJ / IFC verification'}</div>
      <div>\u2022 NEC 690.12 MLRS module-level RSD</div>
      ${_isMicro && totalStrings > 5 ? `<div>\u2022 ${totalStrings} AC branches \u2014 IQ Combiner 6C accepts 5; remaining branches land on AC subpanel, see E-1</div>` : ''}
    </div>` :
    isFence(cadSystemType) ? `
    <div class="draw-zone-hdr">FENCE SEGMENTS</div>
    <table style="width:100%;border-collapse:collapse;font-size:6.5px;">
      <thead><tr style="background:#000;color:#fff;">
        <th style="padding:2px 3px;">#</th><th style="padding:2px 3px;">Length</th>
        <th style="padding:2px 3px;">Panels</th><th style="padding:2px 3px;">Az</th>
      </tr></thead>
      <tbody>
        ${(cad.fence?.segments || []).slice(0,8).map((seg: any, i: number) =>
          `<tr style="border-bottom:1px solid #eee;">` +
          `<td style="padding:2px 3px;font-weight:700;">Seg ${i+1}</td>` +
          `<td style="padding:2px 3px;">${(seg.lengthM * 3.28084).toFixed(1)} ft</td>` +
          `<td style="padding:2px 3px;">${seg.panelCount}</td>` +
          `<td style="padding:2px 3px;">${seg.azimuth != null ? seg.azimuth.toFixed(0) : '\u2014'}\xb0</td>` +
          `</tr>`
        ).join('')}
      </tbody>
    </table>` :
    `<div class="draw-zone-hdr">GROUND ARRAY DETAILS</div>
    <table style="width:100%;border-collapse:collapse;font-size:6.5px;">
      <tr style="border-bottom:1px solid #eee;"><td style="padding:2px 3px;color:#555;">Row Count</td><td style="padding:2px 3px;">${cad.ground?.arrays?.[0]?.dimensions?.rowCount || '\u2014'}</td></tr>
      <tr style="border-bottom:1px solid #eee;"><td style="padding:2px 3px;color:#555;">Panels/Row</td><td style="padding:2px 3px;">${cad.ground?.arrays?.[0]?.dimensions?.panelsPerRow || '\u2014'}</td></tr>
      <tr style="border-bottom:1px solid #eee;"><td style="padding:2px 3px;color:#555;">Row Spacing</td><td style="padding:2px 3px;">${cad.ground?.arrays?.[0] ? (cad.ground.arrays[0].rowSpacingM * 3.28084).toFixed(1) : '\u2014'} ft</td></tr>
      <tr><td style="padding:2px 3px;color:#555;">Tilt</td><td style="padding:2px 3px;">${cad.ground?.arrays?.[0]?.tiltDeg || '\u2014'}\xb0</td></tr>
    </table>`;

  return `
  <div class="page">
    ${titleBlock(input, opts?.sheetId ?? 'PV-1B', `${_isMicro ? 'AC BRANCH CIRCUIT LAYOUT' : 'ARRAY GEOMETRY & STRING LAYOUT'}${opts?.titleSuffix ?? ''}`, pageNum, totalPages)}
    ${structuralBannerHtml(projectStructuralFromInput(input).banner, { compact: true, input, sheetId: opts?.sheetId ?? 'PV-1B' })}
    <!-- PIPELINE v47.343: PV-2B now uses draw-zone/data-zone layout -->
    <div style="display:flex;flex-direction:row;gap:0;flex:1 1 0%;min-height:0;overflow:hidden;margin-top:var(--md);">
      <!-- Draw zone 78%: full-height array grid SVG -->
      <div class="draw-zone" style="flex:0 0 78%;max-width:78%;min-height:0;">
        <div class="draw-zone-hdr">CIRCUIT LAYOUT \u2014 ${totalPanels} MODULES / ${totalStrings} ${circuitLabel} \u2014 ${displaySystemType(cadSystemType)}</div>
        <div class="draw-zone-body" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:10px;background:#fff;min-height:0;">
          ${agDrawSvg}
        </div>
      </div>
      <!-- Data zone 22% -->
      <div class="data-zone" style="flex:0 0 22%;max-width:22%;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
        <div style="flex-shrink:0;border-bottom:var(--border);">
          <div class="draw-zone-hdr">ARRAY PARAMETERS</div>
          <table class="comp-data-table">
            <tr><td>Total Modules</td><td>${totalPanels}</td></tr>
            <tr><td>${_isMicro ? 'AC Branches' : 'Strings'}</td><td>${totalStrings}</td></tr>
            <tr><td>Tilt</td><td>${avgTilt}\xb0</td></tr>
            <tr><td>Azimuth</td><td>${azDisplay}</td></tr>
            <tr><td>Rows</td><td>${(() => {
              // Studio ground/fence panels often all carry row=0 — the stamp
              // grouping then said "Rows 1" while GROUND ARRAY DETAILS said
              // "Row Count 2" on the same rail (Ray, 2026-07-16). When stamps
              // are degenerate, band the modules geometrically by latitude
              // (same clustering the ground top-view draws with).
              if (rowNums.length > 1) return rowNums.length;
              const latsM = panels.map(p => p.lat * 111320).filter(v => isFinite(v)).sort((a, b) => a - b);
              if (latsM.length > 1) {
                // cluster in meters: a new row starts when the N-S gap exceeds
                // 0.8 m (ground row pitch is ≥1.5 m; within-row jitter ≪ 0.5 m)
                let geo = 1;
                for (let gi = 1; gi < latsM.length; gi++) {
                  if (latsM[gi] - latsM[gi - 1] > 0.8) geo++;
                }
                if (geo > 1) return geo;
              }
              return rowNums.length > 0 ? rowNums.length : Math.ceil(Math.sqrt(totalPanels));
            })()}</td></tr>
            <tr><td>System</td><td>${isFence(cadSystemType) ? 'FENCE' : isGround(cadSystemType) ? 'GROUND' : 'ROOF'}</td></tr>
            <tr><td>Orient.</td><td>${panels[0]?.orientation?.toUpperCase() || 'PORTRAIT'}</td></tr>
            <tr class="row-bold"><td>DC kW</td><td>${system.totalDcKw?.toFixed(2) || '\u2014'}</td></tr>
          </table>
        </div>
        <div style="flex-shrink:0;border-bottom:var(--border);">
          <div class="draw-zone-hdr">${_isMicro ? 'BRANCH LEGEND' : 'STRING LEGEND'}</div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#000;color:#fff;">
              <th style="padding:1px 2px;width:12px;font-size:6px;"></th>
              <th style="padding:1px 2px;text-align:left;font-size:6px;">${_isMicro ? 'Branch' : 'String'}</th>
              <th style="padding:1px 2px;font-size:6px;">Qty</th>
              <th style="padding:1px 2px;font-size:6px;">Wp</th>
            </tr></thead>
            <tbody>
              ${legendItems.slice(0,16).map((item: {si:number,label:string,count:number,model:string,watts:number,voc:number,isc:number}) => {
                const hex = stringColors[item.si % stringColors.length];
                return `<tr style="border-bottom:1px solid #eee;">
                  <td style="padding:1px 3px;"><span style="display:inline-block;width:9px;height:9px;background:${hex};vertical-align:middle;border:1px solid ${hex};"></span></td>
                  <td style="padding:1px 3px;font-size:6.5px;font-weight:700;">${escapeH(item.label)}</td>
                  <td style="padding:1px 3px;font-size:6.5px;">${item.count}</td>
                  <td style="padding:1px 3px;font-size:6.5px;">${item.watts}W</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="flex-shrink:0;border-bottom:var(--border);">
          ${agSupplemental}
        </div>
        <div style="flex:1;min-height:0;overflow:auto;">
          <div class="draw-zone-hdr" style="flex-shrink:0;">NOTES</div>
          ${agCalloutRows}
        </div>
      </div>
    </div>
  </div>`;
}



// ═══════════════════════════════════════════════════════════════
// DYNAMIC PAGE ROUTERS (PV-2 and PV-3)
// ═══════════════════════════════════════════════════════════════
export function pageArrayPrimary(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null): string {
  // HYBRID (Phase 1): the primary sheet is the TOP-DOWN SITE PLAN — the roof
  // plan-dominant composition whose drawing (getArrayPlanFromCAD → drawRoofPlan)
  // overlays the ground arrays + fence runs. Rendering the winner's view instead
  // made the whole set fence-dominated with the real site plan shrunk to an
  // inset (Stowell). Pass a roof-typed VIEW with the roof section's origin so
  // composition/validation and the drawing agree.
  const _hybRoof = cad.hybrid?.sections.find(sec => sec.key === 'roof');
  if (cad.hybrid && cad.roof && _hybRoof) {
    // Roof-subset totals + roof-only panelPositions: this sheet documents the
    // ROOF; ground/fence draw as labeled overlays. Project-wide data here made
    // the sheet claim all 94 modules on IronRidge and render ground/fence
    // panels as floating roof modules with phantom setback violations.
    // SYSTEMIC ROOT #2: `_hybRoof.dcKw` is the CAD section's PRORATED kW
    // (projectDcKw × roofPanels/projectPanels → 20.23 for 48×430). Use the
    // sub's OWN modules × nameplate instead (subScopedInput computes it, Σ
    // per module) so PV-1's header/SYSTEM DATA reads the true 20.64 SCHED shows.
    const _roofKw = subScopedInput(input, cad, 'roof').system?.totalDcKw ?? _hybRoof.dcKw;
    const roofView = { ...cad, systemType: 'roof' as const,
      originLat: _hybRoof.originLat, originLng: _hybRoof.originLng,
      totalPanels: _hybRoof.totalPanels, totalDcKw: _roofKw };
    const roofInput = { ...input,
      project: { ...(input.project ?? {}),
        panelPositions: ((input.project?.panelPositions ?? []) as any[]).filter(p => classifyPanel(p) === 'roof') },
      system: { ...(input.system ?? {}), totalPanels: _hybRoof.totalPanels, totalDcKw: _roofKw,
        // Project totals for project-wide chrome (title block) — the subset
        // totals above are for the sheet header/drawing only.
        _projectTotalDcKw: input.system?.totalDcKw, _projectTotalPanels: input.system?.totalPanels },
    } as PermitInput;
    return pageRoofPlan(roofInput, roofView, pageNum, totalPages, ctx);
  }
  // HYBRID with NO roof section (ground + fence): the primary sub (fixed
  // roof > ground > fence order) owns PV-1 — scoped, never the project-wide
  // winner page (which would claim the other sub's modules).
  if (cad.hybrid && isHybridPlanset(cad)) {
    const primary = primarySubKey(cad);
    const view = subScopedView(cad, primary);
    const scoped = subScopedInput(input, cad, primary);
    if (primary === 'fence')  return pageFencePlan(scoped, view, pageNum, totalPages, ctx);
    if (primary === 'ground') return pageGroundArrayPlan(scoped, view, pageNum, totalPages, ctx);
    return pageRoofPlan(scoped, view, pageNum, totalPages, ctx);
  }
  // Use cad.systemType — single source of truth
  if (isFence(cad.systemType))  return pageFencePlan(input, cad, pageNum, totalPages, ctx);
  if (isGround(cad.systemType)) return pageGroundArrayPlan(input, cad, pageNum, totalPages, ctx);
  return pageRoofPlan(input, cad, pageNum, totalPages, ctx);
}



