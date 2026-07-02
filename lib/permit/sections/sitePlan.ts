// ═══════════════════════════════════════════════════════════════
// PV-1: Site Plan & Aerial Data
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { sysTypeLabel, topologyDisplayLabel, resolveInverterCount, interconnectionLabel, utilityDisplayName, compassDir } from '../utils/helpers';
import { buildSchemSVG } from '../utils/drawing';
import { isFence, isGround } from '@/lib/system';
import { nearmapConfigured, fetchNearmapStaticAerial, fetchNearmapAIResult, nearmapRoofSnapCenter, OBSTRUCTION_CLEARANCE_M, lngToGlobalPx, latToGlobalPx, type NearmapObstruction } from '@/lib/aerial/nearmap';
import { cropToSubjectBuilding } from '@/lib/aerial/subjectBuildingCrop';
import { locateEquipment } from '../utils/equipmentLocator';

// Ray-casting point-in-ring (lat/lng) — used to join a panel to its roof plane
// for the azimuth fallback when the panel record carries no azimuth.
function _pipRing(lat: number, lng: number, ring: Array<{lat:number;lng:number}>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lng, yj = ring[j].lat, xj = ring[j].lng;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}


// ─── PV-1: Site Plan with Roof Plan ──────────────────────────────────────────
export function pageSiteInformation(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const aerial = input.aerialData;

  const addr    = project.address || '—';
  const ahj     = compliance.jurisdiction?.ahj || '—';
  // FIX v47.341: Convert utility slug to display name
  const utility = utilityDisplayName(project.utilityName || project.utilityMeter || '') || '—';
  const apn     = project.apn || '—';
  const city    = (project.city || '').toUpperCase();

  const firstInv  = system.inverters?.[0];
  const invMfr    = (firstInv?.manufacturer || 'ENPHASE').toUpperCase();
  const invModel  = (firstInv?.model || 'IQ8').toUpperCase();
  const hasBatt   = (project.batteryCount ?? 0) > 0;
  const hasAcDisc = project.acDisconnect !== false;

  interface EItem { label: string; desc: string; }
  const equipItems: EItem[] = [
    { label: '(E) UTILITY METER',                               desc: utility },
    { label: '(E) MAIN SERVICE PANEL',                          desc: `${project.mainPanelAmps || 200}A — ${(project.mainPanelBrand || 'EXISTING').toUpperCase()}` },
    { label: `(N) ${invMfr} SYSTEM CONTROLLER`,                 desc: `${invMfr} ${invModel}` },
    { label: '(N) BACKUP LOAD PANEL',                           desc: 'CRITICAL LOADS SUB-PANEL' },
    { label: `(N) ${hasAcDisc ? '100A' : '60A'} NON-FUSED AC DISCONNECT`, desc: 'WITHIN SIGHT — NEC 690.15' },
    { label: '(N) ENPHASE COMBINER BOX',                        desc: 'EXTERIOR WALL' },
    ...(hasBatt ? [
      { label: `(N) ${(project.batteryBrand || 'ENPHASE').toUpperCase()} BATTERY`, desc: `${project.batteryModel || 'IQ BATTERY'}${(project.batteryKwh ?? 5.0) > 0 ? ' — ' + (project.batteryKwh ?? 5.0).toFixed(1) + ' kWh' : ''}` },
      { label: '(N) 60A NON-FUSED AC DISCONNECT',               desc: 'ADJACENT TO UTILITY METER' },
    ] : []),
  ];

  const totalPanels  = system.totalPanels || 0;
  const panelPos     = project.panelPositions as Array<{lat:number;lng:number;orientation?:string;row?:number;col?:number;arrayId?:string}> | undefined;
  const roofPlanes   = project.roofPlanes as Array<{id?:string;vertices?:Array<{lat:number;lng:number}>;pitch?:number;azimuth?:number;area?:number;edgeTypes?:string[];source?:string;confirmed?:boolean}> | undefined;
  const panelLenIn   = project.panelLengthIn || 66;
  const panelWidIn   = project.panelWidthIn  || 40;

  // SVG canvas dimensions
  const svgW = 900, svgH = 620;

  let drawingContent: string;
  // Aerial mode fills this with what it ACTUALLY drew; null = schematic
  // fallback keeps the system-aware default legend in buildPv1Page.
  let aerialLegend: Array<{fill:string;stroke:string;dash:boolean;label:string}> | null = null;

  if (aerial?.imageBase64) {
    // ── AERIAL MODE: satellite image + SVG overlay layers ─────────────────
    // Layers (bottom→top): subject-dimming mask → module footprints → canopy
    // zones → street label → service-equipment markers → north/scale/badge.
    const imgW = aerial.imageWidth  || 640;
    const imgH = aerial.imageHeight || 640;
    const cLat = aerial.lat!;
    const z    = aerial.zoom || 20;
    const mppEq = 156543.03392 / Math.pow(2, z);
    const mpp   = mppEq * Math.cos(cLat * Math.PI / 180);
    const ppm   = 1 / mpp;  // pixels per meter — drives the scale bar

    const cLngA = aerial.lng!;
    const toPx = (lat: number, lng: number) => ({
      x: imgW / 2 + (lngToGlobalPx(lng, z) - lngToGlobalPx(cLngA, z)),
      y: imgH / 2 + (latToGlobalPx(lat, z) - latToGlobalPx(cLat, z)),
    });

    const _ring = (project.roofPlanes ?? []).flatMap((rp: any) => rp.vertices ?? [])
      .filter((v: any) => isFinite(v?.lat) && isFinite(v?.lng) && Math.abs(v.lat) > 0.001);
    const _pin = isFinite(project.lat as any) && isFinite(project.lng as any)
      ? { lat: project.lat as number, lng: project.lng as number } : null;

    // ── Registration shift: design GPS → imagery GPS ──────────────────────
    // Nearmap's AI roof polygons are registered to the SAME imagery as the
    // tiles; the design trace sits ~1 m off. When subject polygons are in
    // hand, shifting the whole DESIGN layer (modules + equipment) by the
    // centroid delta pins the overlay to the pixels. Capped at 4 m — a big
    // delta means the crop grabbed the wrong cluster; better unshifted.
    const _subjPolys = (aerial as any).subjectRoofPolygons as Array<Array<{lat:number;lng:number}>> | undefined ?? [];
    let _dLat = 0, _dLng = 0;
    if (_subjPolys.length > 0 && _ring.length >= 3) {
      const sv = _subjPolys.flat();
      const sLat = sv.reduce((s, v) => s + v.lat, 0) / sv.length;
      const sLng = sv.reduce((s, v) => s + v.lng, 0) / sv.length;
      const rLat = _ring.reduce((s: number, v: any) => s + v.lat, 0) / _ring.length;
      const rLng = _ring.reduce((s: number, v: any) => s + v.lng, 0) / _ring.length;
      const offM = Math.hypot((sLat - rLat) * 111320, (sLng - rLng) * 111320 * Math.cos(cLat * Math.PI / 180));
      if (offM < 4) { _dLat = sLat - rLat; _dLng = sLng - rLng; }
    }
    const toPxD = (lat: number, lng: number) => toPx(lat + _dLat, lng + _dLng);

    // ── Layer 0: dim everything except the subject building ───────────────
    // An apartment-complex frame shows 4 identical roofs; the reviewer must
    // see OURS instantly. Imagery-registered Nearmap polygons → no offset.
    let dimSvg = '';
    if (_subjPolys.length > 0) {
      const pts = _subjPolys.flat().map(v => toPx(v.lat, v.lng));
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const padX = (Math.max(...xs) - Math.min(...xs)) * 0.22 + 14;
      const padY = (Math.max(...ys) - Math.min(...ys)) * 0.22 + 14;
      const bx = Math.max(0, Math.min(...xs) - padX), by = Math.max(0, Math.min(...ys) - padY);
      const bw = Math.min(imgW, Math.max(...xs) + padX) - bx, bh = Math.min(imgH, Math.max(...ys) + padY) - by;
      // Skip the mask if the subject fills most of the frame (nothing to dim).
      if (bw * bh < imgW * imgH * 0.72 && bw > 20 && bh > 20) {
        dimSvg = `
          <mask id="pv1-subj-dim">
            <rect x="0" y="0" width="${imgW}" height="${imgH}" fill="#fff"/>
            <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="10" fill="#000"/>
          </mask>
          <rect x="0" y="0" width="${imgW}" height="${imgH}" fill="rgba(10,14,22,0.42)" mask="url(#pv1-subj-dim)"/>
          <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="10" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.4" stroke-dasharray="6 4"/>`;
      }
    }

    // ── Layer 1: module footprints (the point of the sheet) ───────────────
    // Real GPS centers + physical module dims + per-panel azimuth. Filled
    // translucent (no crisp outline — the sub-meter registration residual
    // reads on outlines, not on fills).
    let modSvg = '';
    if (panelPos && panelPos.length > 0 && panelPos.length <= 800) {
      const wM = panelWidIn * 0.0254, lM = panelLenIn * 0.0254;
      const planeAz = (p: {lat:number;lng:number}) => {
        const rp = (project.roofPlanes ?? []).find((r: any) =>
          (r.vertices?.length ?? 0) >= 3 && _pipRing(p.lat, p.lng, r.vertices));
        return (rp as any)?.azimuth;
      };
      const parts: string[] = [];
      for (const p of panelPos) {
        if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
        const c = toPxD(p.lat, p.lng);
        if (c.x < -30 || c.x > imgW + 30 || c.y < -30 || c.y > imgH + 30) continue;
        const az = isFinite((p as any).azimuth) ? (p as any).azimuth : (planeAz(p) ?? 180);
        const landscape = (p.orientation || '').toLowerCase() === 'landscape';
        const w = (landscape ? lM : wM) * ppm, h = (landscape ? wM : lM) * ppm;
        parts.push(`<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${(az as number).toFixed(1)})"><rect x="${(-w/2).toFixed(1)}" y="${(-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(30,80,200,0.50)" stroke="rgba(255,255,255,0.85)" stroke-width="0.7" rx="0.5"/></g>`);
      }
      modSvg = parts.join('');
    }

    // ── Layer 2: tree-canopy zones (aerial is blind under them) ───────────
    // Real Nearmap polygons (imagery-registered — NOT design-shifted).
    let canopySvg = '';
    {
      const canopies = ((project as any).roofObstructions ?? []).filter((o: any) =>
        o?.type === 'canopy' && Array.isArray(o.polygon) && o.polygon.length >= 3);
      const parts: string[] = [];
      canopies.forEach((o: any, i: number) => {
        const pts = o.polygon.filter((v: any) => isFinite(v?.lat) && isFinite(v?.lng)).map((v: any) => toPx(v.lat, v.lng));
        if (pts.length < 3) return;
        const d = pts.map((p: any) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const cx = pts.reduce((s: number, p: any) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s: number, p: any) => s + p.y, 0) / pts.length;
        parts.push(`<polygon points="${d}" fill="rgba(22,101,52,0.20)" stroke="#37c871" stroke-width="1.3" stroke-dasharray="5 3"/>`);
        if (i === 0) {
          parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - 4).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="900" fill="#eafff2" stroke="#14532d" stroke-width="2.2" paint-order="stroke">TREE CANOPY</text>`);
          parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.6" font-weight="bold" fill="#eafff2" stroke="#14532d" stroke-width="1.8" paint-order="stroke">CONCEALED — FIELD VERIFY</text>`);
        }
      });
      canopySvg = parts.join('');
    }

    // ── Layer 3: street-name label on the street-facing edge ──────────────
    // Name = address minus house number; edge = geocode-pin direction from
    // the building centroid (same heuristic equipmentLocator tier 2 uses).
    let streetSvg = '';
    if (_ring.length >= 3 && _pin) {
      const rLat = _ring.reduce((s: number, v: any) => s + v.lat, 0) / _ring.length;
      const rLng = _ring.reduce((s: number, v: any) => s + v.lng, 0) / _ring.length;
      const dx = (_pin.lng - rLng) * Math.cos(cLat * Math.PI / 180);
      const dy = _pin.lat - rLat;
      const streetName = (project.address || '').split(',')[0].replace(/^\s*\d+\s+/, '').replace(/\b(apt|unit|ste|#)\.?\s*\S*$/i, '').trim().toUpperCase();
      if (streetName && (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9)) {
        const horiz = Math.abs(dx) > Math.abs(dy);
        const lx = horiz ? (dx > 0 ? imgW - 16 : 16) : imgW / 2;
        const ly = horiz ? imgH / 2 : (dy > 0 ? 26 : imgH - 16);
        const rot = horiz ? (dx > 0 ? 90 : -90) : 0;
        streetSvg = `<text x="${lx}" y="${ly}" transform="rotate(${rot} ${lx} ${ly})" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="900" letter-spacing="2" fill="#fff" stroke="rgba(0,0,0,0.75)" stroke-width="2.6" paint-order="stroke" text-decoration="underline">${streetName}</text>`;
      }
    }

    // ── Layer 4: service-equipment markers (Ray item #3, 2026-07-02) ──────
    // locateEquipment() places UM/MSP/AC-disconnect from the best evidence:
    // labeled survey photos w/ capture-time GPS when they exist, else the
    // street-side wall heuristic — provenance is printed on the leader label
    // so the sheet never claims surveyed precision it doesn't have.
    let eqSvg = '';
    try {
      if (_ring.length >= 3 && aerial.lng != null) {
        const located = locateEquipment(_ring, _pin, (project as any).surveyPhotoHints ?? []);
        const TAGS: Record<string, { tag: string; name: string }> = {
          utility_meter: { tag: 'UM',  name: '(E) UTILITY METER' },
          msp:           { tag: 'MSP', name: '(E) MAIN SERVICE PANEL' },
          ac_disconnect: { tag: 'AC',  name: '(N) AC DISCONNECT' },
        };
        const parts: string[] = [];
        let _lastLy = -Infinity;
        located.forEach((eq, i) => {
          const p = toPxD(eq.lat, eq.lng);
          if (p.x < 8 || p.x > imgW - 8 || p.y < 8 || p.y > imgH - 8) return;
          const meta = TAGS[eq.kind];
          const rightSide = p.x > imgW / 2;
          const lx = rightSide ? Math.min(p.x + 120, imgW - 8) : Math.max(p.x - 120, 8);
          let ly = Math.max(24, Math.min(imgH - 24, p.y - 34 + i * 26));
          if (ly < _lastLy + 24) ly = _lastLy + 24;   // labels never overlap
          _lastLy = ly;
          const prov = eq.provenance === 'survey_photo_gps' ? 'PER SURVEY PHOTO GPS' : 'APPROX. — FIELD VERIFY';
          parts.push(`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#fff" stroke-width="2.2"/>`);
          parts.push(`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#1e40af" stroke-width="1.1"/>`);
          parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7" fill="#1e40af" stroke="#fff" stroke-width="1.6"/>`);
          parts.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + 2.6).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${meta.tag.length > 2 ? 5 : 6.5}" font-weight="900" fill="#fff">${meta.tag}</text>`);
          const tw = Math.max(meta.name.length, prov.length) * 4.4 + 10;
          const tx0 = rightSide ? lx - tw : lx;
          parts.push(`<rect x="${tx0.toFixed(1)}" y="${(ly - 10).toFixed(1)}" width="${tw.toFixed(0)}" height="20" rx="2" fill="rgba(255,255,255,0.94)" stroke="#1e40af" stroke-width="0.8"/>`);
          parts.push(`<text x="${(tx0 + 5).toFixed(1)}" y="${(ly - 2).toFixed(1)}" font-family="Arial,sans-serif" font-size="7" font-weight="900" fill="#111">${meta.name}</text>`);
          parts.push(`<text x="${(tx0 + 5).toFixed(1)}" y="${(ly + 6.5).toFixed(1)}" font-family="Arial,sans-serif" font-size="5.6" fill="#555">${prov}</text>`);
        });
        eqSvg = parts.join('');
      }
    } catch (eqErr: unknown) {
      console.log('[permit/pv1] equipment markers skipped:', (eqErr as Error)?.message);
    }
    const pSvg = dimSvg + modSvg + canopySvg + streetSvg + eqSvg;

    // Graphic scale in FEET (permits are imperial) — 20 ft bar.
    const scalePx = Math.round(20 * 0.3048 * ppm);
    const scaleBar = scalePx>0&&scalePx<300 ? `
      <g transform="translate(${imgW/2-scalePx/2},${imgH-20})">
        <rect x="0" y="-8" width="${scalePx}" height="12" rx="2" fill="rgba(0,0,0,0.65)"/>
        <line x1="0" y1="0" x2="${scalePx}" y2="0" stroke="white" stroke-width="1.5"/>
        <line x1="0" y1="-4" x2="0" y2="4" stroke="white" stroke-width="1.5"/>
        <line x1="${scalePx/2}" y1="-3" x2="${scalePx/2}" y2="3" stroke="white" stroke-width="1"/>
        <line x1="${scalePx}" y1="-4" x2="${scalePx}" y2="4" stroke="white" stroke-width="1.5"/>
        <text x="${scalePx/2}" y="-11" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" fill="white">20 FT</text>
      </g>` : '';

    drawingContent = `
      <div class=\"f-lg fw9 caps center\">${addr}</div>
      <div class=\"aerial-wrap\">
        <img src="${aerial.imageBase64}" style="display:block;width:100%;height:auto;" alt="Aerial — ${addr}"/>
        <svg viewBox="0 0 ${imgW} ${imgH}" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;" xmlns="http://www.w3.org/2000/svg">
          ${pSvg}
          <g transform="translate(${imgW-36},36)">
            <circle cx="0" cy="0" r="22" fill="rgba(0,0,0,0.7)" stroke="white" stroke-width="1.5"/>
            <polygon points="0,-14 5,7 0,2 -5,7" fill="white"/>
            <polygon points="0,14 5,-7 0,-2 -5,-7" fill="rgba(255,255,255,0.3)"/>
            <text x="0" y="-18" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="900" fill="white">N</text>
          </g>
          <rect x="${imgW/2-90}" y="${imgH-22}" width="180" height="18" rx="3" fill="rgba(30,64,175,0.88)"/>
          <text x="${imgW/2}" y="${imgH-10}" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="white">${totalPanels} MODULES — ${system.totalDcKw?.toFixed(2)||'—'} kW DC</text>
          ${scaleBar}
        </svg>
      </div>
      <div class="f-xs muted right" style="font-style:italic;margin-top:2px;">${aerial.imageSource === 'nearmap' ? '🛰️ Nearmap HD aerial · 7.5 cm/px orthophoto' : '🛰️ Satellite aerial'}</div>`;

    // HONEST legend — list exactly what this aerial actually draws, nothing
    // else (the old hardcoded list promised PROPERTY LINE / FIRE SETBACK that
    // aerial mode never drew — an AHJ reads the legend as a content claim).
    aerialLegend = [
      ...(modSvg ? [{ fill:'rgba(30,80,200,0.60)', stroke:'#ffffff', dash:false, label:'PV MODULE (NEW)' }] : []),
      ...(dimSvg ? [{ fill:'none', stroke:'#6b7280', dash:true,  label:'SUBJECT BUILDING' }] : []),
      ...(canopySvg ? [{ fill:'rgba(22,101,52,0.25)', stroke:'#1a7a2e', dash:true, label:'TREE CANOPY — VERIFY' }] : []),
      ...(eqSvg ? [{ fill:'#1e40af', stroke:'#ffffff', dash:false, label:'SERVICE EQUIPMENT (TAGGED)' }] : []),
    ];
  } else {
    // ── SCHEMATIC MODE: proper GPS-projected roof planes + panels ──────────
    const schemSVG = buildSchemSVG(
      roofPlanes, panelPos, totalPanels, system.totalDcKw,
      panelLenIn, panelWidIn, svgW, svgH, addr, city
    );
    drawingContent = `
      <div class=\"f-lg fw9 caps center\">${addr}</div>
      ${schemSVG}`;
  }

  return buildPv1Page(input, pageNum, totalPages, equipItems, drawingContent, apn, ahj, utility, cad, aerialLegend);  // FIX v47.295: pass cad for system-aware title
}

export function buildPv1Page(
  input: PermitInput,
  pageNum: number,
  totalPages: number,
  equipItems: Array<{label:string;desc:string}>,
  drawingHtml: string,
  apn: string,
  ahj: string,
  utility: string,
  cad?: CADModel,  // FIX v47.295: optional cad for system-aware title/legend
  legendOverride?: Array<{fill:string;stroke:string;dash:boolean;label:string}> | null
): string {
  const { project } = input;
  // FIX v47.295: system-aware PV-1 subtitle
  const _pv1SysType = (cad?.systemType as string) || 'roof';
  const _pv1SubTitle = isFence(_pv1SysType) ? 'SITE PLAN WITH FENCE PLAN'
    : isGround(_pv1SysType) ? 'SITE PLAN WITH GROUND ARRAY PLAN'
    : 'SITE PLAN WITH ROOF PLAN';

  const notes = [
    'ALL ELECTRICAL EQUIPMENT, INVERTERS, DISCONNECTS, MAIN SERVICE PANELS, ETC. SHALL NOT BE INSTALLED WITHIN 3\' OF THE GAS METERS\' SUPPLY OR DEMAND PIPING.',
    'ALL PLUMBING VENTS, SKYLIGHTS AND MECHANICAL VENTS SHALL NOT BE COVERED, MOVED, RE-ROUTED OR RELOCATED.',
    'VISIBLE, LOCKABLE, LABELED, KNIFE-BLADE AC DISCONNECT LOCATED WITHIN 10\' OF UTILITY METER.',
  ];

  const equipCallouts = equipItems.map((eq,i)=>`
    <div style="margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid #000;">
      <div style="display:flex;align-items:flex-start;gap:3px;width:100%;">
        <div style="flex-shrink:0;width:16px;">
          <div class="mono fw9 f-xs center" style="width:14px;height:14px;border:var(--border-med);background:#000;color:#fff;line-height:14px;">${i+1}</div>
        </div>
        <div style="flex:1;padding-left:3px;">
          <div class="f-xs fw9 caps" style="line-height:1.35;">${eq.label}</div>
          <div class="f-xs muted" style="line-height:1.3;">${eq.desc}</div>
        </div>
      </div>
    </div>`).join('');

  // FIX v47.295: system-aware legend items
  const _legendItems = isFence(_pv1SysType)
    ? [
        { fill:'#4a7c59', stroke:'#2d5a3d', dash:false, label:'SOLAR FENCE ARRAY' },
        { fill:'rgba(30,80,200,0.80)', stroke:'#2060b0', dash:false, label:'PV MODULE (NEW)' },
        { fill:'none', stroke:'#374151', dash:true, label:'PROPERTY LINE' },
        { fill:'none', stroke:'#4a7c59', dash:true, label:'FENCE BOUNDARY' },
      ]
    : isGround(_pv1SysType)
    ? [
        { fill:'#c8b89a', stroke:'#8b7355', dash:false, label:'GROUND MOUNT ARRAY' },
        { fill:'rgba(30,80,200,0.80)', stroke:'#2060b0', dash:false, label:'PV MODULE (NEW)' },
        { fill:'none', stroke:'#374151', dash:true, label:'PROPERTY LINE' },
        { fill:'none', stroke:'#8b7355', dash:true, label:'ARRAY BOUNDARY' },
      ]
    : [
        { fill:'#9ca3af', stroke:'#374151', dash:false, label:'EXISTING ROOF PLANE' },
        { fill:'rgba(30,80,200,0.80)', stroke:'#2060b0', dash:false, label:'PV MODULE (NEW)' },
        { fill:'none', stroke:'#374151', dash:true, label:'PROPERTY LINE' },
        { fill:'none', stroke:'#cc0000', dash:true, label:'18" FIRE SETBACK' },
      ];
  // Aerial mode passes the list of what it ACTUALLY drew — use it verbatim.
  const _finalLegendItems = (legendOverride && legendOverride.length > 0) ? legendOverride : _legendItems;
  const legendHtml = _finalLegendItems.map(lr=>`
    <div style="margin-bottom:3px;">
      <svg width="18" height="11" style="display:inline-block;vertical-align:middle;margin-right:4px;">
        ${lr.dash
          ? `<line x1="1" y1="5" x2="17" y2="5" stroke="${lr.stroke}" stroke-width="1.5" stroke-dasharray="4,2"/>`
          : `<rect x="1" y="1" width="16" height="9" fill="${lr.fill}" stroke="${lr.stroke}" stroke-width="1" rx="1"/>`}
      </svg>
      <span style="font-size:7.5px;color:#000;vertical-align:middle;">${lr.label}</span>
    </div>`).join('');

  return `
  <div class="page">
    ${titleBlock(input, 'PV-1', 'SITE PLAN', pageNum, totalPages)}
    <div class=\"page-content\">

      <!-- Notes bar -->
      <div class=\"note-bar\">
        <span class=\"f-xs fw9 caps note-bar-label\">NOTE:</span>
        ${notes.map(n=>`<span class="f-xs" style="margin-right:10px;">&bull; ${n}</span>`).join('')}
      </div>

      <!-- Main body: sidebar + drawing -->
      <div style=\"display:grid;grid-template-columns:158px 1fr;width:100%;overflow:hidden;\">

        <!-- Left sidebar (~158px) -->
        <div style="padding:4px 4px 0 6px;border-right:var(--border);overflow:hidden;">
          <div class=\"sec-hdr\">EQUIPMENT LEGEND</div>
          ${equipCallouts}
          <div style="border:var(--border);padding:var(--xs);margin-top:var(--xs);" class="f-xs">
            <div class=\"fw9 caps f-xs sub-hdr\">LOCATION OF AC DISCONNECT:</div>
            EXTERIOR WALL (ESS)<br/>
            UTILITY NUMBER: ${project.utilityMeter || '—'}
          </div>
          <div class="mt-sm">
            <div class=\"sec-hdr\">LEGEND</div>
            ${legendHtml}
          </div>
        </div>

        <!-- Right: big drawing -->
        <div style="padding:4px 6px 0 4px;overflow:hidden;">
          ${drawingHtml}
          <div style="display:flex;align-items:center;border-top:var(--border-hvy);margin-top:var(--xs);padding-top:3px;">
            <div style="flex:1;text-align:center;">
              <span class="f-lg fw9 caps mono">PV-1 — ${_pv1SubTitle}</span>
              &nbsp;&nbsp;
              <span class="f-md">SCALE: NTS &nbsp;|&nbsp; ANSI B 11&Prime; &times; 17&Prime;</span>
              &nbsp;&nbsp;
              <span class="f-xs mono">APN: ${apn} &nbsp;|&nbsp; AHJ: ${ahj} &nbsp;|&nbsp; UTILITY: ${utility}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>`;
}


// ─── AerialRoofData interface & fetchAerialRoofData ─────────────────────────

export interface AerialRoofData {
  imageBase64?: string;
  imageWidth?: number;
  imageHeight?: number;
  lat?: number;
  lng?: number;
  zoom?: number;
  centerSource?: 'array' | 'segment' | 'pin' | 'nearmap_roof'; // why the image is centered where it is (diagnostic)
  imageSource?: 'nearmap' | 'google';         // which provider produced the aerial (diagnostic)
  /** Nearmap AI roof obstructions (vents/chimneys/AC/skylights) with the
   *  per-type keep-out clearance — same AI call as the roof snap (no extra
   *  credit). Real lat/lng; the route forwards them to project.roofObstructions
   *  and roofCAD projects them into the drawing frame. */
  obstructions?: Array<NearmapObstruction & { clearanceM: number }>;
  /** Nearmap AI roof polygons of the SUBJECT building only (imagery-registered
   *  lat/lng — same registration as the tiles, so overlays drawn from these
   *  are pixel-true). Drives the PV-1 subject-dimming mask + the design→
   *  imagery registration shift. */
  subjectRoofPolygons?: Array<Array<{ lat: number; lng: number }>>;
  roofSegments?: Array<{
    center?: { lat: number; lng: number };
    azimuthDegrees: number;
    pitchDegrees: number;
    areaM2: number;
  }>;
  error?: string;
}

// ── chooseAerialCenter ────────────────────────────────────────────────────────
// Decides where to center the aerial image. Pure + exported so it can be unit
// tested without the Google network calls.
//
// Priority (Ray, 2026-06-30 — "3D design drives 2D"):
//   1. The design's array centroid (caller-supplied) — AUTHORITATIVE. The planset
//      must faithfully frame whatever the user built in 3D; the panels sit exactly
//      here. Guarded: a centroid > ARRAY_CENTER_MAX_OFFSET_M from a valid pin is
//      corrupt (cross-project contamination) and is rejected, not trusted.
//   2. The geocoded address pin — fallback when there's no design geometry (or the
//      centroid failed the corruption guard). The Design Studio fly-in geocodes to
//      this point and lands on the building. A Google Solar roof SEGMENT must NEVER
//      override a valid pin: buildingInsights:findClosest routinely returns a
//      NEIGHBOR's building — centering on its segment was the "wrong house" bug.
//   3. A roof segment — ONLY as a last resort when the pin is missing/invalid (e.g.
//      a city-level geocode with no building), where any nearby roof beats (0,0).
type AerialSegment = { center?: { lat: number; lng: number }; azimuthDegrees: number; areaM2: number };

// Max distance (m) the design's array centroid may sit from the address pin and
// still be trusted. Real designs sit within a parcel of the geocode (tens of m);
// a centroid hundreds of m off means the design geometry is cross-contaminated
// (the observed "panels in another state" corruption) — reject it and fall back
// to the pin rather than fly the aerial to the wrong location.
export const ARRAY_CENTER_MAX_OFFSET_M = 300;

export function chooseAerialCenter(
  pinLat: number,
  pinLng: number,
  arrayCenter: { lat: number; lng: number } | undefined,
  roofSegments: AerialSegment[] | undefined,
): { lat: number; lng: number; source: 'array' | 'segment' | 'pin' } {
  const pinValid = isFinite(pinLat) && isFinite(pinLng) && Math.abs(pinLat) > 0.001;

  // 1) Placed-array centroid — most precise (the design drives the 2D framing).
  //    Guard: if a valid pin exists and the centroid is implausibly far from it,
  //    the design geometry is corrupt — don't let it drag the aerial away.
  if (arrayCenter && isFinite(arrayCenter.lat) && isFinite(arrayCenter.lng) && Math.abs(arrayCenter.lat) > 0.001) {
    let trusted = true;
    if (pinValid) {
      const cosLat = Math.cos(pinLat * Math.PI / 180);
      const offsetM = Math.hypot(
        (arrayCenter.lat - pinLat) * 111320,
        (arrayCenter.lng - pinLng) * 111320 * cosLat,
      );
      trusted = offsetM <= ARRAY_CENTER_MAX_OFFSET_M;
      if (!trusted) {
        console.warn('[permit/aerial] array centroid', offsetM.toFixed(0), 'm from pin — rejecting as corrupt, using pin');
      }
    }
    if (trusted) return { lat: arrayCenter.lat, lng: arrayCenter.lng, source: 'array' };
  }

  // 2) The geocoded address pin — authoritative for a real street address. Never let a
  //    Google roof segment override it (that grabs the neighbor's roof).
  if (isFinite(pinLat) && isFinite(pinLng) && Math.abs(pinLat) > 0.001) {
    return { lat: pinLat, lng: pinLng, source: 'pin' };
  }

  // 3) Last resort only when the pin is unusable: the roof segment nearest to it.
  const withCenter = (roofSegments ?? []).filter(
    s => s.center && isFinite(s.center.lat) && isFinite(s.center.lng),
  );
  if (withCenter.length > 0) {
    const cosLat = Math.cos(pinLat * Math.PI / 180);
    const distM = (s: AerialSegment) => Math.hypot(
      (s.center!.lat - pinLat) * 111320,
      (s.center!.lng - pinLng) * 111320 * cosLat,
    );
    const nearest = withCenter.map(s => ({ s, d: distM(s) })).sort((a, b) => a.d - b.d)[0];
    return { lat: nearest.s.center!.lat, lng: nearest.s.center!.lng, source: 'segment' };
  }

  return { lat: pinLat, lng: pinLng, source: 'pin' };
}

export async function fetchAerialRoofData(
  lat: number,
  lng: number,
  address: string,
  arrayCenter?: { lat: number; lng: number }
): Promise<AerialRoofData> {
  const GKEY = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
  // Only a MISSING Google key + no usable coords is fatal (can't geocode). With
  // coords in hand the Nearmap path works fine without a Google key — the old
  // unconditional early-return silently disabled Nearmap in Google-key-less envs.
  const hasCoords = isFinite(lat) && isFinite(lng) && Math.abs(lat) > 0.001;
  if (!GKEY && !hasCoords) {
    console.log('[permit/aerial] No Google Maps API key and no coordinates — skipping aerial fetch');
    return { error: 'No API key configured' };
  }

  try {
    let finalLat = lat, finalLng = lng;

    // ── Step 1: Geocode if lat/lng not provided ──────────────────────────────
    if (!finalLat || !finalLng || (Math.abs(finalLat) < 0.001 && Math.abs(finalLng) < 0.001)) {
      console.log('[permit/aerial] Step 1: Geocoding address [redacted]');
      const gcUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GKEY}`;
      const gcRes = await fetch(gcUrl, { signal: AbortSignal.timeout(8000) });
      const gcJson = await gcRes.json() as any;
      if (gcJson.results?.[0]?.geometry?.location) {
        finalLat = gcJson.results[0].geometry.location.lat;
        finalLng = gcJson.results[0].geometry.location.lng;
        console.log('[permit/aerial] Geocoded:', finalLat, finalLng);
      } else {
        console.log('[permit/aerial] Geocode failed:', gcJson.status);
        return { error: 'Geocode failed: ' + gcJson.status };
      }
    }

    // ── Step 2: Google Solar API roof segments ────────────────────────────────
    let roofSegments: AerialRoofData['roofSegments'] = [];
    if (GKEY) try {
      const solarUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${finalLat}&location.longitude=${finalLng}&requiredQuality=LOW&key=${GKEY}`;
      console.log('[permit/aerial] Step 2: Solar API...');
      const solarRes = await fetch(solarUrl, { signal: AbortSignal.timeout(10000) });
      const solarJson = await solarRes.json() as any;
      if (solarRes.ok && solarJson.solarPotential?.roofSegmentStats) {
        roofSegments = solarJson.solarPotential.roofSegmentStats.map((s: any) => ({
          center: s.center,
          azimuthDegrees: s.azimuthDegrees ?? 180,
          pitchDegrees: s.pitchDegrees ?? 18,
          areaM2: s.stats?.areaMeters2 ?? 0,
        }));
        console.log('[permit/aerial] Solar API roofSegments:', roofSegments.length);
      } else {
        console.log('[permit/aerial] Solar API non-OK:', solarRes.status, JSON.stringify(solarJson).substring(0, 200));
      }
    } catch (solarErr: unknown) {
      console.log('[permit/aerial] Solar API EXCEPTION:', (solarErr as Error)?.message);
    }

    // ── Step 2b: Center the image on the ARRAY, not the parcel pin ────────────
    // The geocode pin is often the street/parcel centroid; when the roof (and so
    // the panels) sit off it, the array renders off-frame (the reported bug).
    // Prefer an explicit array centroid from the caller, else the best (largest,
    // south-facing) Solar API roof segment center, else the geocode pin.
    const _center = chooseAerialCenter(finalLat, finalLng, arrayCenter, roofSegments);
    let centerLat = _center.lat, centerLng = _center.lng;
    let centerSource: AerialRoofData['centerSource'] = _center.source;
    console.log('[permit/aerial] Centering on', _center.source,
      _center.source === 'segment' ? '(nearest on-parcel roof segment)' : '');

    // ── Step 2c: Snap the frame to Nearmap's OWN detected roof ────────────────
    // (Ray, 2026-07-01 — "get this home into the center of the map".) The design
    // centroid / geocode pin both live in GPS space; the imagery has its own
    // registration, and a street-interpolated pin can sit ~15 m off the house.
    // Nearmap's AI roof polygon is registered to the SAME imagery as the Vert
    // tiles, so framing on its bbox center puts the home pixel-exact mid-frame.
    // Trust rules: a roof CONTAINING the chosen center is unambiguous; a merely
    // NEAREST roof is only trusted when the center came from the design ('array')
    // — nearest-to-a-street-pin is how the wrong-house bug happened. Fails safe
    // to the unsnapped center. Coverage-gated + cached (one AI credit/generate).
    let aiObstructions: AerialRoofData['obstructions'];
    let subjectRoofPolygons: AerialRoofData['subjectRoofPolygons'];
    if (nearmapConfigured()) {
      try {
        // ONE AI call returns both roof planes (for the frame snap) and roof
        // OBSTRUCTIONS (vents/chimneys/AC/skylights) for the PV-2 drawing.
        const ai = await fetchNearmapAIResult(centerLat, centerLng, { radiusM: 45 });
        // Subject-building polygons (imagery-registered) → PV-1 dimming mask +
        // design-layer registration shift. cropToSubjectBuilding fails open.
        try {
          const crop = cropToSubjectBuilding(ai.roofPlanes, { lat: centerLat, lng: centerLng });
          const subj = (crop?.planes ?? []).map(p => p.worldPolygon).filter(p => (p?.length ?? 0) >= 3);
          if (subj.length > 0) subjectRoofPolygons = subj;
        } catch { /* fail open — mask is optional */ }
        const snap = nearmapRoofSnapCenter(centerLat, centerLng, ai.roofPlanes, { maxSnapM: 25 });
        if (snap && (snap.contained || _center.source === 'array')) {
          console.log(`[permit/aerial] frame snapped to Nearmap AI roof (${snap.contained ? 'containing' : 'nearest'} roof, ${snap.distM.toFixed(1)} m shift)`);
          centerLat = snap.lat;
          centerLng = snap.lng;
          centerSource = 'nearmap_roof';
        } else if (ai.roofPlanes.length > 0) {
          console.log('[permit/aerial] Nearmap AI roofs found but none qualified for snap — keeping', _center.source, 'center');
        }
        if (ai.obstructions.length > 0) {
          aiObstructions = ai.obstructions.map(o => ({
            ...o,
            clearanceM: OBSTRUCTION_CLEARANCE_M[o.type] ?? OBSTRUCTION_CLEARANCE_M.other,
          }));
          console.log(`[permit/aerial] Nearmap AI obstructions: ${aiObstructions.length} (${aiObstructions.map(o => o.type).join(', ')})`);
        }
      } catch (snapErr: unknown) {
        console.log('[permit/aerial] Nearmap roof snap skipped:', (snapErr as Error)?.message);
      }
    }

    // ── Step 3: Aerial image ──
    // LANDSCAPE 16:9 to match the PV-1 drawing area — a square image overflows the
    // wide column (aerial-wrap is height:auto) and gets clipped to the top band,
    // which shoved the (correctly-centred) roof to the bottom edge. A 16:9 image
    // fills the area and keeps the roof centred.
    const imgSize = '640x360';
    let imageBase64: string | undefined;
    let imageWidth  = 640;
    let imageHeight = 360;
    let usedZoom    = 20;
    let imageSource: 'nearmap' | 'google' = 'google';

    // Step 3a: Nearmap HD (7.5cm @ z21) — PREFERRED. Stitched Vert tiles look far
    // sharper than Google Static Maps satellite. Fails safe → Google below.
    if (nearmapConfigured()) {
      try {
        const nm = await fetchNearmapStaticAerial(centerLat, centerLng, { widthPx: 1440, heightPx: 810 });
        if (nm?.imageBase64) {
          imageBase64 = nm.imageBase64;
          imageWidth  = nm.imageWidth;
          imageHeight = nm.imageHeight;
          usedZoom    = nm.zoom;
          imageSource = 'nearmap';
          console.log(`[permit/aerial] Nearmap HD aerial OK — z${nm.zoom}, ${nm.tilesFetched} tiles`);
        } else {
          console.log('[permit/aerial] Nearmap returned no image — falling back to Google');
        }
      } catch (nmErr: unknown) {
        console.log('[permit/aerial] Nearmap aerial EXCEPTION — falling back to Google:', (nmErr as Error)?.message);
      }
    }

    // Step 3b: Google Maps Static API — satellite fallback (multi-zoom rural fallback).
    const zoomLevels = [20, 18, 17];
    for (const tryZoom of (imageBase64 || !GKEY) ? [] : zoomLevels) {
      const tryUrl =
        `https://maps.googleapis.com/maps/api/staticmap` +
        `?center=${centerLat},${centerLng}` +
        `&zoom=${tryZoom}` +
        `&size=${imgSize}` +
        `&maptype=satellite` +
        `&scale=2` +
        `&key=${GKEY}`;

      console.log(`[permit/aerial] Step 3: Static Maps satellite zoom=${tryZoom}...`);
      try {
        const imgRes = await fetch(tryUrl, { signal: AbortSignal.timeout(12000) });
        const ct = imgRes.headers.get('content-type') || '';
        console.log(`[permit/aerial] Static Maps HTTP:`, imgRes.status, '| Content-Type:', ct, `| zoom=${tryZoom}`);
        if (imgRes.ok && ct.startsWith('image/')) {
          const buf = await imgRes.arrayBuffer();
          if (buf.byteLength < 8000 && tryZoom > 17) {
            console.log(`[permit/aerial] zoom=${tryZoom}: image too small (${buf.byteLength} bytes) — likely blank rural tile, trying lower zoom`);
            continue;
          }
          console.log(`[permit/aerial] Static Maps image OK (zoom=${tryZoom}), bytes:`, buf.byteLength);
          imageBase64 = `data:${ct};base64,` + Buffer.from(buf).toString('base64');
          usedZoom    = tryZoom;
          imageWidth  = 640;
          imageHeight = 360;
          break;
        } else {
          const errBody = await imgRes.text().catch(() => '');
          console.log(`[permit/aerial] Static Maps zoom=${tryZoom} non-image response:`, errBody.substring(0, 300));
        }
      } catch (imgErr: unknown) {
        console.log(`[permit/aerial] Static Maps zoom=${tryZoom} EXCEPTION:`, (imgErr as Error)?.message);
      }
    }

    // Hybrid maptype fallback if satellite failed completely
    if (!imageBase64 && GKEY) {
      console.log('[permit/aerial] Satellite failed — trying hybrid maptype fallback...');
      const hybridUrl =
        `https://maps.googleapis.com/maps/api/staticmap` +
        `?center=${centerLat},${centerLng}` +
        `&zoom=18` +
        `&size=${imgSize}` +
        `&maptype=hybrid` +
        `&scale=2` +
        `&key=${GKEY}`;
      try {
        const hybridRes = await fetch(hybridUrl, { signal: AbortSignal.timeout(10000) });
        const hct = hybridRes.headers.get('content-type') || '';
        if (hybridRes.ok && hct.startsWith('image/')) {
          const hbuf = await hybridRes.arrayBuffer();
          if (hbuf.byteLength > 5000) {
            imageBase64 = `data:${hct};base64,` + Buffer.from(hbuf).toString('base64');
            usedZoom    = 18;
            console.log('[permit/aerial] Hybrid fallback succeeded, bytes:', hbuf.byteLength);
          }
        }
      } catch (hybridErr: unknown) {
        console.log('[permit/aerial] Hybrid fallback EXCEPTION:', (hybridErr as Error)?.message);
      }
    }

    console.log('[permit/aerial] ══ RESULT ══ imageBase64:', imageBase64 ? `YES (${imageBase64.length} chars, zoom=${usedZoom})` : 'MISSING');
    console.log('[permit/aerial] ══ RESULT ══ roofSegments:', roofSegments.length);

    return {
      imageBase64,
      imageWidth,
      imageHeight,
      lat: centerLat,   // image is centered here → overlay projects relative to it
      lng: centerLng,
      zoom: usedZoom,
      centerSource,
      imageSource,
      roofSegments,
      obstructions: aiObstructions,
      subjectRoofPolygons,
    };

  } catch (err: unknown) {
    console.log('[permit/aerial] OUTER EXCEPTION caught:', (err as Error)?.message, (err as Error)?.stack?.substring(0, 300));
    return { error: (err as Error)?.message || 'Aerial fetch failed' };
  }
}

// ─── PV-2: Roof Plan With Modules ─────────────────────────────────────────────
// Professional version matching permit drawing standard:
//  • GPS-projected roof planes + panels via buildSchemSVG (same as PV-1)
//  • Red hatched fire-setback zones along all roof edges
//  • Color-coded circuit conduit run lines (by array)
//  • Per-array data table: array ID, modules, azimuth, pitch, truss, spacing
//  • Array & Roof Calc Total table
//  • Detailed equipment callouts with leader lines
//  • Full legend block + roof plan notes



