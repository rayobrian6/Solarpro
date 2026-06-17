// ═══════════════════════════════════════════════════════════════
// PV-1: Site Plan & Aerial Data
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { sysTypeLabel, topologyDisplayLabel, resolveInverterCount, interconnectionLabel, utilityDisplayName, compassDir } from '../utils/helpers';
import { mercPx, buildSchemSVG } from '../utils/drawing';
import { isFence, isGround } from '@/lib/system';


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

  if (aerial?.imageBase64) {
    // ── AERIAL MODE: satellite image + SVG panel overlay ──────────────────
    const imgW = aerial.imageWidth  || 640;
    const imgH = aerial.imageHeight || 640;
    const cLat = aerial.lat!;
    const cLng = aerial.lng!;
    const z    = aerial.zoom || 20;
    const mppEq = 156543.03392 / Math.pow(2, z);
    const mpp   = mppEq * Math.cos(cLat * Math.PI / 180);
    const ppm   = 1 / mpp;
    const MPD_LAT2 = 111320;
    const mpd_lng2  = 111320 * Math.cos(cLat * Math.PI / 180);

    function latLngAerial(lat: number, lng: number): { x: number; y: number } {
      return {
        x: imgW/2 + (lng - cLng) * mpd_lng2 * ppm,
        y: imgH/2 - (lat - cLat) * MPD_LAT2 * ppm,
      };
    }

    const pHpxA = Math.max(6, panelLenIn * 0.0254 * ppm);
    const pWpxA = Math.max(4, panelWidIn * 0.0254 * ppm);

    const rawValid = panelPos?.filter(pp =>
      pp.lat && pp.lng && Math.abs(pp.lat) > 0.001 && Math.abs(pp.lng) > 0.001 &&
      isFinite(pp.lat) && isFinite(pp.lng) && Math.abs(pp.lat) <= 90 && Math.abs(pp.lng) <= 180
    );
    let hasExact = false, validPP: typeof rawValid = undefined;
    if (rawValid && rawValid.length > 0) {
      const cLa2 = rawValid.reduce((s,p)=>s+p.lat,0)/rawValid.length;
      const cLo2 = rawValid.reduce((s,p)=>s+p.lng,0)/rawValid.length;
      if (Math.abs(cLa2-cLat)<0.15 && Math.abs(cLo2-cLng)<0.15) { validPP = rawValid; hasExact = true; }
    }

    let pSvg = '';
    if (hasExact && validPP) {
      validPP.slice(0,800).forEach(pp => {
        const {x,y} = latLngAerial(pp.lat, pp.lng);
        const isL = pp.orientation === 'landscape';
        const pw = isL ? pHpxA : pWpxA, ph = isL ? pWpxA : pHpxA;
        pSvg += `<rect x="${(x-pw/2).toFixed(1)}" y="${(y-ph/2).toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="rgba(30,80,200,0.80)" stroke="#2060b0" stroke-width="0.8" rx="0.5"/>`;
      });
    } else {
      let gCx=imgW/2, gCy=imgH*0.38, gW=Math.round(imgW*0.38), gH=Math.round(imgH*0.28);
      const segs = aerial.roofSegments;
      if (segs && segs.length > 0) {
        const best = segs.filter(s=>s.center).map(s=>({seg:s,score:((s.azimuthDegrees>=135&&s.azimuthDegrees<=225)?3:1.5)*(s.areaM2||1)})).sort((a,b)=>b.score-a.score)[0];
        if (best?.seg?.center) {
          const sp = latLngAerial(best.seg.center.lat, best.seg.center.lng);
          gCx=sp.x; gCy=sp.y;
          const side=Math.sqrt((best.seg.areaM2||60)*0.7)*ppm;
          gW=Math.min(Math.max(Math.round(side*1.5),50),imgW*0.5);
          gH=Math.min(Math.max(Math.round(side),35),imgH*0.38);
        }
      }
      const aX=Math.max(8,Math.round(gCx-gW/2)), aY=Math.max(8,Math.round(gCy-gH/2));
      const aW=Math.min(gW,imgW-aX-8), aH=Math.min(gH,imgH-aY-8);
      const cols=Math.ceil(Math.sqrt(totalPanels*1.6)), rows=Math.ceil(totalPanels/cols);
      const mw=Math.max(4,Math.floor((aW-4)/cols)-2), mh=Math.max(3,Math.floor((aH-4)/rows)-2);
      let c2=0;
      for (let r=0;r<rows&&c2<totalPanels;r++) for (let c=0;c<cols&&c2<totalPanels;c++,c2++)
        pSvg+=`<rect x="${aX+2+c*(mw+2)}" y="${aY+2+r*(mh+2)}" width="${mw}" height="${mh}" fill="rgba(30,80,200,0.80)" stroke="#2060b0" stroke-width="0.8" rx="1"/>`;
    }

    const scalePx = Math.round(10*ppm);
    const scaleBar = scalePx>0&&scalePx<250 ? `
      <g transform="translate(${imgW/2-scalePx/2},${imgH-20})">
        <rect x="0" y="-8" width="${scalePx}" height="12" rx="2" fill="rgba(0,0,0,0.65)"/>
        <line x1="0" y1="0" x2="${scalePx}" y2="0" stroke="white" stroke-width="1.5"/>
        <line x1="0" y1="-4" x2="0" y2="4" stroke="white" stroke-width="1.5"/>
        <line x1="${scalePx}" y1="-4" x2="${scalePx}" y2="4" stroke="white" stroke-width="1.5"/>
        <text x="${scalePx/2}" y="-11" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" fill="white">≈ 10 m</text>
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
      <div class="f-xs muted right" style="font-style:italic;margin-top:2px;">📡 Satellite · Zoom ${aerial.zoom||20} · ${aerial.lat?.toFixed(5)}, ${aerial.lng?.toFixed(5)}</div>`;
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

  return buildPv1Page(input, pageNum, totalPages, equipItems, drawingContent, apn, ahj, utility, cad);  // FIX v47.295: pass cad for system-aware title
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
  cad?: CADModel  // FIX v47.295: optional cad for system-aware title/legend
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
        { fill:'none', stroke:'#cc0000', dash:true, label:'18\\" FIRE SETBACK' },
      ];
  const legendHtml = _legendItems.map(lr=>`
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
  roofSegments?: Array<{
    center?: { lat: number; lng: number };
    azimuthDegrees: number;
    pitchDegrees: number;
    areaM2: number;
  }>;
  error?: string;
}

export async function fetchAerialRoofData(
  lat: number,
  lng: number,
  address: string
): Promise<AerialRoofData> {
  const GKEY = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
  if (!GKEY) {
    console.log('[permit/aerial] No Google Maps API key — skipping aerial fetch');
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
    try {
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

    // ── Step 3: Google Maps Static API — satellite image (multi-zoom rural fallback) ──
    const imgSize = '640x640';
    let imageBase64: string | undefined;
    let imageWidth  = 640;
    let imageHeight = 640;
    let usedZoom    = 20;

    const zoomLevels = [20, 18, 17];
    for (const tryZoom of zoomLevels) {
      const tryUrl =
        `https://maps.googleapis.com/maps/api/staticmap` +
        `?center=${finalLat},${finalLng}` +
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
          imageHeight = 640;
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
    if (!imageBase64) {
      console.log('[permit/aerial] Satellite failed — trying hybrid maptype fallback...');
      const hybridUrl =
        `https://maps.googleapis.com/maps/api/staticmap` +
        `?center=${finalLat},${finalLng}` +
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
      lat: finalLat,
      lng: finalLng,
      zoom: usedZoom,
      roofSegments,
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



