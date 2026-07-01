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
import { nearmapConfigured, fetchNearmapStaticAerial } from '@/lib/aerial/nearmap';


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
    const z    = aerial.zoom || 20;
    const mppEq = 156543.03392 / Math.pow(2, z);
    const mpp   = mppEq * Math.cos(cLat * Math.PI / 180);
    const ppm   = 1 / mpp;  // pixels per meter — drives the scale bar

    // PV-1 SITE PLAN: PV modules are intentionally NOT drawn on the aerial (Ray,
    // 2026-06-30). The site plan shows property context + equipment locations; the
    // module layout lives on PV-2 (real roof plan) and PV-2B (circuit plan). We keep
    // the satellite framing, north arrow, scale bar, and the system-size badge.
    const pSvg = '';

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
      <div class="f-xs muted right" style="font-style:italic;margin-top:2px;">${aerial.imageSource === 'nearmap' ? '🛰️ Nearmap HD aerial · 7.5 cm/px orthophoto' : '🛰️ Satellite aerial'}</div>`;
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
  centerSource?: 'array' | 'segment' | 'pin'; // why the image is centered where it is (diagnostic)
  imageSource?: 'nearmap' | 'google';         // which provider produced the aerial (diagnostic)
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

    // ── Step 2b: Center the image on the ARRAY, not the parcel pin ────────────
    // The geocode pin is often the street/parcel centroid; when the roof (and so
    // the panels) sit off it, the array renders off-frame (the reported bug).
    // Prefer an explicit array centroid from the caller, else the best (largest,
    // south-facing) Solar API roof segment center, else the geocode pin.
    const _center = chooseAerialCenter(finalLat, finalLng, arrayCenter, roofSegments);
    const centerLat = _center.lat, centerLng = _center.lng;
    console.log('[permit/aerial] Centering on', _center.source,
      _center.source === 'segment' ? '(nearest on-parcel roof segment)' : '');

    // ── Step 3: Aerial image ──
    const imgSize = '640x640';
    let imageBase64: string | undefined;
    let imageWidth  = 640;
    let imageHeight = 640;
    let usedZoom    = 20;
    let imageSource: 'nearmap' | 'google' = 'google';

    // Step 3a: Nearmap HD (7.5cm @ z21) — PREFERRED. Stitched Vert tiles look far
    // sharper than Google Static Maps satellite. Fails safe → Google below.
    if (nearmapConfigured()) {
      try {
        const nm = await fetchNearmapStaticAerial(centerLat, centerLng, { sizePx: 1024 });
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
    for (const tryZoom of imageBase64 ? [] : zoomLevels) {
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
      centerSource: _center.source,
      imageSource,
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



