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
import { composeDrawPage, getPrimaryView, getSecondaryView, drawDimension, escapeH } from '../utils/drawing';
import { isFence, isGround, isRoof, displaySystemType } from '@/lib/system';
import { drawingEngine } from '@/lib/drafting';

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
  const drawingSvg = getPrimaryView(comp.primaryView, cad, input, ctx);
  if (!drawingSvg || drawingSvg.length < 500) {
    throw new Error(`[pageRoofPlan] getPrimaryView(${comp.primaryView}) returned empty SVG`);
  }

  // ── Secondary view (Step 6) ───────────────────────────────────────────────
  // Roof plan: no secondary strip (setbacks/obstructions integrated into primary)
  const secondarySvg: string | null = null;

  return `
  <div class="page">
    ${titleBlock(input, 'PV-2', 'ROOF PLAN — MODULE LAYOUT & FIRE SETBACKS', pageNum, totalPages)}
    ${composeDrawPage(comp, drawingSvg, secondarySvg)}
  </div>`;
}



export function pageGroundArrayPlan(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null): string {
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
    ${titleBlock(input, 'PV-2', 'GROUND ARRAY PLAN', pageNum, totalPages)}
    ${composeDrawPage(comp, drawingSvg, secondarySvg)}
  </div>`;
}



export function pageFencePlan(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number, ctx?: RenderContext | null): string {
  console.log('[PLANSET ENGINE] pageFencePlan — PV-2 fence elevation is PRIMARY view');
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
    ${titleBlock(input, 'PV-2', 'SOLAR FENCE ELEVATION & PLAN', pageNum, totalPages)}
    ${composeDrawPage(comp, primarySvg, secondarySvg)}
  </div>`;
}



// ─── PV-1B: Array Geometry & String Layout ────────────────────────────────
// Detailed schematic showing array groupings, string assignments, row/col grid


function buildProfessionalCadArrayVisual(
  input: PermitInput,
  cad: CADModel,
  fallbackSvg: string,
): string {
  try {
    const cadSvg = drawingEngine.getArrayPlanFromCAD(cad, input, undefined);
    if (!cadSvg || cadSvg.length < 500) return fallbackSvg;
    return cadSvg.replace(
      /<svg([^>]*)>/,
      '<svg$1 class="professional-cad-array-visual" style="display:block;width:100%;height:100%;max-width:100%;max-height:100%;" preserveAspectRatio="xMidYMid meet">',
    );
  } catch (error) {
    console.warn('[pageArrayGeometry] Professional CAD visual fallback:', error instanceof Error ? error.message : String(error));
    return fallbackSvg;
  }
}

export function pageArrayGeometry(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system } = input;
  // CAD-sourced: use cad.totalPanels as authoritative count
  const cadTotalPanels = cad.totalPanels;
  const cadSystemType = cad.systemType;
  const panels = (project as any).panelPositions as Array<{
    id: string; lat: number; lng: number; row: number; col: number;
    tilt?: number; azimuth?: number; wattage?: number; orientation?: string; systemType?: string;
  }> || [];

  const totalPanels = cadTotalPanels || system.totalPanels || panels.length || 0;
  const totalStrings = system.inverters?.reduce((sum, inv) => sum + (inv.strings?.length || 0), 0) || 1;

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
  const avgTilt = isRoof(cadSystemType) && roofPlane0?.pitch != null
    ? roofPlane0.pitch.toFixed(1)  // pitch is already in degrees from canonical model
    : (count > 0 ? (sumTilt / count).toFixed(1) : (project.roofPitch || 20).toString());
  const avgAz = isRoof(cadSystemType) && roofPlane0?.azimuth != null
    ? roofPlane0.azimuth.toFixed(0)
    : (count > 0 ? (sumAz / count).toFixed(0) : '180');

  // Determine compass direction from azimuth
  const azNum = parseFloat(avgAz);
  const compassDir = azNum >= 337.5 || azNum < 22.5 ? 'N' :
    azNum < 67.5 ? 'NE' : azNum < 112.5 ? 'E' : azNum < 157.5 ? 'SE' :
    azNum < 202.5 ? 'S' : azNum < 247.5 ? 'SW' : azNum < 292.5 ? 'W' : 'NW';

  // Build SVG grid
  const cellW = 28, cellH = 38, gapX = 4, gapY = 6;
  const maxCols = Math.max(...Array.from(rows.values()).map(r => r.length), 1);
  const gridW = maxCols * (cellW + gapX) + 10;
  const gridH = rowNums.length * (cellH + gapY) + 10;
  const svgW = Math.min(gridW + 80, 900);
  const svgH = Math.max(gridH + 60, 200);

  // Color per string (up to 8 strings)
  const stringColors = ['#000','#000','#cc0000','#cc6600','#5500cc','#0891b2','#be185d','#65a30d'];

  // Assign string index to each panel (distribute evenly)
  const panelStringMap: Map<string, number> = new Map();
  const sortedPanels = [...panels].sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0));
  const panelsPerString = totalStrings > 0 ? Math.ceil(totalPanels / totalStrings) : totalPanels;
  sortedPanels.forEach((p, i) => { panelStringMap.set(p.id, Math.floor(i / panelsPerString)); });

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
        svgCells += `<text x="${x + cellW/2}" y="${y + cellH/2 + 14}" text-anchor="middle" font-size="5" fill="${color}" font-weight="700">S${si+1}</text>`;
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
          svgCells += `<text x="${x + cellW/2}" y="${y + cellH/2 + 4}" text-anchor="middle" font-size="5.5" fill="${color}" font-weight="700">S${si+1}</text>`;
        }
        if (ppc > 20) {
          const x = 40 + 20 * (cellW + gapX);
          const y = 30 + (ii * (invs[0].strings?.length || 1) + si) * (cellH + gapY);
          svgCells += `<text x="${x + 4}" y="${y + cellH/2 + 4}" font-size="8" fill="#555">+${ppc-20} more</text>`;
        }
      });
    });
  }

  // String legend
  const legendItems = system.inverters?.flatMap((inv, ii) =>
    (inv.strings || []).map((str, si) => ({
      si: ii * (system.inverters[0]?.strings?.length || 1) + si,
      label: str.label || `String ${si+1}`,
      count: str.panelCount,
      model: str.panelModel || '—',
      watts: str.panelWatts || 400,
      voc: str.panelVoc || 41.6,
      isc: str.panelIsc || 12.26,
    }))
  ) || [];

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
        agCells += `<text x="${x + agCellW/2}" y="${y + agCellH/2 + 19}" text-anchor="middle" font-size="${Math.max(6, agCellH * 0.11)}" fill="${color}" font-weight="700">S${si+1}</text>`;
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
          agCells += `<text x="${x + schCellW/2}" y="${y + schCellH/2 + 5}" text-anchor="middle" font-size="${Math.max(6, schCellH * 0.11)}" fill="${color}" font-weight="700">S${si+1}</text>`;
        }
        if (str.panelCount > 20) {
          agCells += `<text x="${80 + ppc * (schCellW + 3) + 4}" y="${y + schCellH/2 + 5}" font-size="9" fill="#555">+${str.panelCount - 20} more</text>`;
        }
        agCells += `<text x="74" y="${y + schCellH/2 + 4}" text-anchor="end" font-size="9" fill="#333" font-weight="600">Str ${si+1}</text>`;
        rowIdx++;
      });
    });
  } else {
    agCells = `<text x="${AG_VB_W/2}" y="${AG_VB_H/2 - 20}" text-anchor="middle" font-size="18" fill="#333" font-weight="700">${totalPanels} MODULES</text>`;
    agCells += `<text x="${AG_VB_W/2}" y="${AG_VB_H/2 + 10}" text-anchor="middle" font-size="12" fill="#555">${totalStrings} strings — see string schedule</text>`;
  }

  const schematicGridSvg = `<svg viewBox="0 0 ${AG_VB_W} ${AG_VB_H}" width="100%" height="100%"
    preserveAspectRatio="xMidYMid meet"
    style="display:block;max-width:100%;max-height:100%;"
    xmlns="http://www.w3.org/2000/svg">
    <rect width="${AG_VB_W}" height="${AG_VB_H}" fill="#fafbfc"/>
    <rect width="${AG_VB_W}" height="26" fill="#000"/>
    <text x="10" y="17" font-size="11" fill="#fff" font-weight="700" font-family="Arial,sans-serif">ARRAY GRID — ${totalPanels} MODULES / ${totalStrings} STRING${totalStrings !== 1 ? 'S' : ''} — ${displaySystemType(cadSystemType)}</text>
    <text x="${AG_VB_W - 20}" y="18" text-anchor="end" font-size="12" fill="#fff" font-weight="700" font-family="Arial,sans-serif">N↑</text>
    <g font-family="Arial,sans-serif">
      ${agCells || `<text x="${AG_VB_W/2}" y="${AG_VB_H/2}" text-anchor="middle" font-size="16" fill="#999">No panel position data — schematic only</text>`}
    </g>
    <rect x="80" y="${AG_VB_H - 18}" width="120" height="5" fill="#aaa" rx="1"/>
    <text x="80" y="${AG_VB_H - 5}" font-size="8" fill="#777" font-family="Arial,sans-serif">SCHEMATIC (NOT TO SCALE — NTS)</text>
  </svg>`;

  const agDrawSvg = buildProfessionalCadArrayVisual(input, cad, schematicGridSvg);

  // Callout notes for data zone
  const agCalloutRows = [
    { n: 1, label: 'NEC 690.8', sub: `String Isc \xd7 1.25 \xd7 1.25 = conductor sizing basis` },
    { n: 2, label: 'Tilt / Azimuth', sub: `${avgTilt}\xb0 tilt / ${avgAz}\xb0 (${compassDir})` },
    { n: 3, label: isRoof(cadSystemType) ? 'IFC \xa7605.11 Setbacks' : isFence(cadSystemType) ? 'NEC 250.169 Bonding' : 'NEC 690.51 Labeling',
       sub: isRoof(cadSystemType) ? 'Min 18" eave/ridge setback required' : isFence(cadSystemType) ? 'All metalwork bonded to EGC \u2014 min #6 AWG Cu' : 'Equipment labeling at all access points' },
    { n: 4, label: 'DC Capacity', sub: `${system.totalDcKw?.toFixed(2) || '\u2014'} kW DC` },
  ].map(c =>
    `<div class="callout-row">` +
    `<span class="callout-bubble">${c.n}</span>` +
    `<span><strong>${c.label}</strong> \u2014 ${c.sub}</span>` +
    `</div>`
  ).join('');

  // System-specific supplemental data
  const agSupplemental = isRoof(cadSystemType) ? `
    <div class="draw-zone-hdr">FIRE SETBACKS (IFC \xa7605.11)</div>
    <div style="padding:3px 4px;font-size:6.5px;line-height:1.6;color:#333;">
      <div>\u2022 Min 18" edge setback from eaves</div>
      <div>\u2022 Min 18" setback from ridge</div>
      <div>\u2022 36" access at hip/valley per AHJ</div>
      <div>\u2022 NEC 690.12 MLRS module-level RSD</div>
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
    ${titleBlock(input, 'PV-2B', 'ARRAY GEOMETRY & STRING LAYOUT', pageNum, totalPages)}
    <!-- PIPELINE v47.343: PV-2B now uses draw-zone/data-zone layout -->
    <div style="display:flex;flex-direction:row;gap:0;flex:1 1 0%;min-height:0;overflow:hidden;margin-top:var(--md);">
      <!-- Draw zone 78%: full-height array grid SVG -->
      <div class="draw-zone" style="flex:0 0 78%;max-width:78%;min-height:0;">
        <div class="draw-zone-hdr">PROFESSIONAL CAD ARRAY DIAGRAM \u2014 ${totalPanels} MODULES / ${totalStrings} STRING${totalStrings !== 1 ? 'S' : ''}</div>
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
            <tr><td>Strings</td><td>${totalStrings}</td></tr>
            <tr><td>Tilt</td><td>${avgTilt}\xb0</td></tr>
            <tr><td>Azimuth</td><td>${avgAz}\xb0 (${compassDir})</td></tr>
            <tr><td>Rows</td><td>${rowNums.length > 0 ? rowNums.length : Math.ceil(Math.sqrt(totalPanels))}</td></tr>
            <tr><td>System</td><td>${isFence(cadSystemType) ? 'FENCE' : isGround(cadSystemType) ? 'GROUND' : 'ROOF'}</td></tr>
            <tr><td>Orient.</td><td>${panels[0]?.orientation?.toUpperCase() || 'PORTRAIT'}</td></tr>
            <tr class="row-bold"><td>DC kW</td><td>${system.totalDcKw?.toFixed(2) || '\u2014'}</td></tr>
          </table>
        </div>
        <div style="flex-shrink:0;border-bottom:var(--border);">
          <div class="draw-zone-hdr">STRING LEGEND</div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#000;color:#fff;">
              <th style="padding:1px 2px;width:12px;font-size:6px;"></th>
              <th style="padding:1px 2px;text-align:left;font-size:6px;">String</th>
              <th style="padding:1px 2px;font-size:6px;">Qty</th>
              <th style="padding:1px 2px;font-size:6px;">Wp</th>
            </tr></thead>
            <tbody>
              ${legendItems.slice(0,10).map((item: {si:number,label:string,count:number,model:string,watts:number,voc:number,isc:number}) => {
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
  // Use cad.systemType — single source of truth
  if (isFence(cad.systemType))  return pageFencePlan(input, cad, pageNum, totalPages, ctx);
  if (isGround(cad.systemType)) return pageGroundArrayPlan(input, cad, pageNum, totalPages, ctx);
  return pageRoofPlan(input, cad, pageNum, totalPages, ctx);
}



