// ═══════════════════════════════════════════════════════════════
// PV-1: Site Plan & Aerial Data
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { sysTypeLabel, topologyDisplayLabel, resolveInverterCount, interconnectionLabel, utilityDisplayName, compassDir } from '../utils/helpers';
import { buildSchemSVG, escapeH } from '../utils/drawing';
import { isFence, isGround } from '@/lib/system';
import { nearmapConfigured, fetchNearmapStaticAerial, fetchNearmapAIResult, nearmapRoofSnapCenter, OBSTRUCTION_CLEARANCE_M, lngToGlobalPx, latToGlobalPx, type NearmapObstruction } from '@/lib/aerial/nearmap';
import { cropToSubjectBuilding } from '@/lib/aerial/subjectBuildingCrop';
import { locateEquipment } from '../utils/equipmentLocator';
import { computeModuleAzimuthGrid, snapModuleAzimuth } from '../utils/moduleAzimuthGrid';

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

  const addr    = escapeH(project.address || '—');
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

  interface EItem { label: string; desc: string; tag: string; }
  // Battery-only equipment (System Controller, Backup Load Panel) is gated on
  // hasBatt — the legend listed phantom ESS gear on battery-less jobs, with the
  // "controller" model set to the MICROINVERTER model. The AC disconnect on a
  // supply-side tap is the FUSED tap OCPD (see E-1), not non-fused.
  const _pv1SupplySide = project.interconnectionMethod === 'SUPPLY_SIDE_TAP';
  // Legend keys use the SAME tag codes as the wall chips on the drawing —
  // numbered legend rows (1-6) that never appeared on the plan were a
  // coordination P1 an AHJ red-lines.
  const equipItems: EItem[] = [
    { tag: 'UM',  label: '(E) UTILITY METER',                   desc: utility },
    { tag: 'MSP', label: '(E) MAIN SERVICE PANEL',              desc: `${project.mainPanelAmps || 200}A — ${(project.mainPanelBrand || 'EXISTING').toUpperCase()}` },
    { tag: 'AC',  label: `(N) ${hasAcDisc ? '100A' : '60A'} ${_pv1SupplySide ? 'FUSED' : 'NON-FUSED'} AC DISCONNECT`, desc: _pv1SupplySide ? 'TAP OCPD — NEC 705.11(C), 690.15' : 'WITHIN SIGHT — NEC 690.15' },
    { tag: 'CB',  label: `(N) ${invMfr} COMBINER BOX`,          desc: 'EXTERIOR WALL — ADJACENT TO MSP (FIELD VERIFY)' },
    ...(hasBatt ? [
      { tag: 'SC',  label: `(N) ${invMfr} SYSTEM CONTROLLER`,   desc: 'ESS / MICROGRID INTERCONNECT DEVICE' },
      { tag: 'BLP', label: '(N) BACKUP LOAD PANEL',             desc: 'CRITICAL LOADS SUB-PANEL' },
      { tag: 'BAT', label: `(N) ${(project.batteryBrand || 'ENPHASE').toUpperCase()} BATTERY`, desc: `${project.batteryModel || 'IQ BATTERY'}${(project.batteryKwh ?? 5.0) > 0 ? ' — ' + (project.batteryKwh ?? 5.0).toFixed(1) + ' kWh' : ''}` },
      { tag: 'AC2', label: '(N) 60A NON-FUSED AC DISCONNECT',   desc: 'ADJACENT TO UTILITY METER' },
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

    // ── CONTENT-DRIVEN CROP (SVG viewBox over the embedded image) ─────────
    // The raw frame is ~100 m wide for a ~15 m house — 80% dead content, the
    // core of the "sloppy" read. Crop so the subject spans ~45-55% of the
    // frame, biased toward the street side, floor 34 m / cap 70 m of ground.
    // Zero fetch changes: the viewBox crops the already-embedded raster and
    // roughly doubles the effective print resolution of the house.
    let cropX = 0, cropY = 0, cropW = imgW, cropH = imgH;
    if (_ring.length >= 3) {
      const rpx = _ring.map((v: any) => toPx(v.lat, v.lng));
      const hminX = Math.min(...rpx.map(p => p.x)), hmaxX = Math.max(...rpx.map(p => p.x));
      const hminY = Math.min(...rpx.map(p => p.y)), hmaxY = Math.max(...rpx.map(p => p.y));
      const hullW = hmaxX - hminX, hullH = hmaxY - hminY;
      const aspect = imgH / imgW;   // keep the drawing column's aspect
      let cw = Math.max(hullW, hullH / aspect) * 2.3;
      cw = Math.max(34 * ppm, Math.min(70 * ppm, cw, imgW));
      let ch = cw * aspect;
      if (ch < hullH * 1.4) { ch = Math.min(imgH, hullH * 1.4); cw = Math.min(imgW, ch / aspect); ch = cw * aspect; }
      let cx0 = (hminX + hmaxX) / 2, cy0 = (hminY + hmaxY) / 2;
      if (_pin) {   // street-side bias: 0.12·frame toward the geocode pin
        const pp = toPx(_pin.lat, _pin.lng);
        const dx = pp.x - cx0, dy = pp.y - cy0, dl = Math.hypot(dx, dy) || 1;
        cx0 += (dx / dl) * cw * 0.12;
        cy0 += (dy / dl) * ch * 0.12;
      }
      cropX = Math.max(0, Math.min(imgW - cw, cx0 - cw / 2));
      cropY = Math.max(0, Math.min(imgH - ch, cy0 - ch / 2));
      cropW = cw; cropH = ch;
    }
    const inCrop = (p: { x: number; y: number }, pad = 4) =>
      p.x > cropX - pad && p.x < cropX + cropW + pad && p.y > cropY - pad && p.y < cropY + cropH + pad;

    // ── FURNITURE SCALE — resolution independence ──────────────────────────
    // Every overlay size below is in IMAGE pixels and the crop is what maps
    // to the printed sheet. Sized for a ~900px Nearmap crop, the same 9.5px
    // labels rendered ~2.4× oversized on a 640px Google-fallback crop (giant
    // plates burying the aerial — Ray's 07-06 render). Scale all furniture
    // with the crop width instead.
    const fk = Math.min(1.35, Math.max(0.55, cropW / 900));

    // ── Registration shift: design GPS → imagery GPS ──────────────────────
    // Nearmap's AI roof polygons are registered to the SAME imagery as the
    // tiles; the design trace sits ~1 m off. When subject polygons are in
    // hand, shifting the whole DESIGN layer (modules + equipment) by the
    // centroid delta pins the overlay to the pixels. Capped at 4 m — a big
    // delta means the crop grabbed the wrong cluster; better unshifted.
    // Per-plane matched MEDIAN delta — a raw all-vertices centroid diff gets
    // skewed whenever the Nearmap subject crop grabs an extra plane or drops
    // one (that skew shoved the whole module layer off the west eave). Each
    // DESIGN plane matches its nearest subject polygon; the median of those
    // per-plane deltas is applied only when the matches AGREE (≥half within
    // 1.2 m of the median) and the shift is plausibly registration-sized
    // (< 2.5 m). Anything else → no shift (unshifted design GPS is ~1 m off,
    // which the translucent fills absorb).
    const _subjPolys = (aerial as any).subjectRoofPolygons as Array<Array<{lat:number;lng:number}>> | undefined ?? [];
    let _dLat = 0, _dLng = 0;
    if (_subjPolys.length > 0 && (project.roofPlanes?.length ?? 0) > 0) {
      const _cent = (vs: Array<{lat:number;lng:number}>) => ({
        lat: vs.reduce((s, v) => s + v.lat, 0) / vs.length,
        lng: vs.reduce((s, v) => s + v.lng, 0) / vs.length,
      });
      const _cos = Math.cos(cLat * Math.PI / 180);
      const _subjC = _subjPolys.filter(p => (p?.length ?? 0) >= 3).map(_cent);
      const _deltas: Array<{ dLat: number; dLng: number }> = [];
      for (const rp of (project.roofPlanes ?? []) as any[]) {
        const vs = (rp.vertices ?? []).filter((v: any) => isFinite(v?.lat) && isFinite(v?.lng));
        if (vs.length < 3 || !_subjC.length) continue;
        const dc = _cent(vs);
        let best = _subjC[0], bestD = Infinity;
        for (const sc of _subjC) {
          const d = Math.hypot((sc.lat - dc.lat) * 111320, (sc.lng - dc.lng) * 111320 * _cos);
          if (d < bestD) { bestD = d; best = sc; }
        }
        if (bestD < 6) _deltas.push({ dLat: best.lat - dc.lat, dLng: best.lng - dc.lng });
      }
      if (_deltas.length) {
        const _med = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
        const mLat = _med(_deltas.map(d => d.dLat)), mLng = _med(_deltas.map(d => d.dLng));
        const magM = Math.hypot(mLat * 111320, mLng * 111320 * _cos);
        const agree = _deltas.filter(d =>
          Math.hypot((d.dLat - mLat) * 111320, (d.dLng - mLng) * 111320 * _cos) < 1.2).length;
        if (magM < 2.5 && agree * 2 >= _deltas.length) { _dLat = mLat; _dLng = mLng; }
      }
      // FALLBACK: whole-roof bbox-center registration. Nearmap often returns
      // ONE outline for a multi-plane hip roof — every design plane then
      // matches the same subject centroid, the per-plane deltas can never
      // agree, the shift was rejected, and the module layer rendered at raw
      // design GPS (~1 m off the pixels — south row read as past the eave).
      if (_dLat === 0 && _dLng === 0 && _subjPolys.length < ((project.roofPlanes?.length ?? 0))) {
        const _bboxC = (vs: Array<{lat:number;lng:number}>) => ({
          lat: (Math.min(...vs.map(v => v.lat)) + Math.max(...vs.map(v => v.lat))) / 2,
          lng: (Math.min(...vs.map(v => v.lng)) + Math.max(...vs.map(v => v.lng))) / 2,
        });
        const allSubj = _subjPolys.flat().filter(v => isFinite(v?.lat) && isFinite(v?.lng));
        const allDesign = ((project.roofPlanes ?? []) as any[])
          .flatMap(rp => rp.vertices ?? [])
          .filter((v: any) => isFinite(v?.lat) && isFinite(v?.lng) && Math.abs(v.lat) > 0.001);
        if (allSubj.length >= 3 && allDesign.length >= 3) {
          const sc = _bboxC(allSubj), dcAll = _bboxC(allDesign);
          const dLat = sc.lat - dcAll.lat, dLng = sc.lng - dcAll.lng;
          const magM = Math.hypot(dLat * 111320, dLng * 111320 * _cos);
          if (magM < 2.5) { _dLat = dLat; _dLng = dLng; }
        }
      }
    }
    // GOOGLE-FALLBACK registration: no vector layer shares Google's imagery
    // registration (Solar API roofSegments routinely belong to a NEIGHBOR
    // building — measured 14 m off on Melvin), so the permit route pre-computes
    // an image-space EDGE-SNAP shift (see utils/aerialEdgeSnap.ts) and stores
    // it on aerialData.registrationShift. Applied through the same toPxD path
    // as the Nearmap shift; absent/unconfident → unshifted, as before.
    if (_dLat === 0 && _dLng === 0 && _subjPolys.length === 0) {
      const _rs = (aerial as any).registrationShift as { dLat?: number; dLng?: number } | undefined;
      if (_rs && isFinite(_rs.dLat as number) && isFinite(_rs.dLng as number)) {
        _dLat = _rs.dLat as number; _dLng = _rs.dLng as number;
      }
    }
    const toPxD = (lat: number, lng: number) => toPx(lat + _dLat, lng + _dLng);

    // ── Layer 0: dim everything except the subject building ───────────────
    // An apartment-complex frame shows 4 identical roofs; the reviewer must
    // see OURS instantly. Imagery-registered Nearmap polygons → no offset.
    // The mask hole is the CONVEX HULL of the subject polygons scaled ~1.28×
    // about its centroid (a padded organic shape, not a boxy dashed rect),
    // and the actual roof outlines draw as thin white lines — pixel-true,
    // since these polygons share the imagery's own registration.
    let dimSvg = '';
    if (_subjPolys.length > 0) {
      const pts = _subjPolys.flat().map(v => toPx(v.lat, v.lng));
      // Monotone-chain convex hull (px space)
      const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
      const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
      const lower: any[] = [], upper: any[] = [];
      for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }
      for (const p of [...sorted].reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
      if (hull.length >= 3) {
        const hcx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
        const hcy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
        const padded = hull.map(p => ({ x: hcx + (p.x - hcx) * 1.12 + Math.sign(p.x - hcx) * 6, y: hcy + (p.y - hcy) * 1.12 + Math.sign(p.y - hcy) * 6 }));
        const hullStr = padded.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const xs = padded.map(p => p.x), ys = padded.map(p => p.y);
        const hullArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        // Skip the mask if the subject fills most of the frame (nothing to dim).
        if (hullArea < cropW * cropH * 0.8) {
          const outlines = _subjPolys.map(poly => {
            const d = poly.map(v => { const p = toPx(v.lat, v.lng); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
            return `<polygon points="${d}" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1"/>`;
          }).join('');
          // WHITE contextual wash (Aurora-style "photo on paper"), not the
          // old black night-vision dim — the drawing must read as a drawing.
          dimSvg = `
            <mask id="pv1-subj-dim">
              <rect x="${cropX.toFixed(0)}" y="${cropY.toFixed(0)}" width="${cropW.toFixed(0)}" height="${cropH.toFixed(0)}" fill="#fff"/>
              <polygon points="${hullStr}" fill="#000"/>
            </mask>
            <rect x="${cropX.toFixed(0)}" y="${cropY.toFixed(0)}" width="${cropW.toFixed(0)}" height="${cropH.toFixed(0)}" fill="rgba(255,255,255,0.40)" mask="url(#pv1-subj-dim)"/>
            ${outlines}`;
        }
      }
    }

    // ── Layer 0.5: PROPERTY LINE (county GIS parcel, when registered) ─────
    // Classic site-plan treatment: long-dash line with a white halo. Large
    // parcels extend past the frame — SVG clips them naturally and the label
    // sits on the longest visible run.
    let parcelSvg = '';
    {
      const _parcel = (aerial as any).parcel as { polygon?: Array<{lat:number;lng:number}> } | undefined;
      const pv = (_parcel?.polygon ?? []).filter(v => isFinite(v?.lat) && isFinite(v?.lng));
      if (pv.length >= 4) {
        const pts = pv.map(v => toPx(v.lat, v.lng));
        // Gate on the CROP WINDOW and require real visible LENGTH — but accept
        // partially visible edges (clip each segment to the crop). Requiring a
        // fully-in-frame segment suppressed the property line entirely on
        // parcels larger than the frame (e.g. an apartment lot), while the
        // old any-point full-image test drew an unlabeled edge through the
        // street scene. Every visible run long enough now gets its own label.
        const _clipSeg = (a: {x:number;y:number}, b: {x:number;y:number}) => {
          // Liang–Barsky clip of segment a→b against the crop rect.
          let t0 = 0, t1 = 1;
          const dx = b.x - a.x, dy = b.y - a.y;
          const p = [-dx, dx, -dy, dy];
          const q = [a.x - cropX, cropX + cropW - a.x, a.y - cropY, cropY + cropH - a.y];
          for (let k = 0; k < 4; k++) {
            if (p[k] === 0) { if (q[k] < 0) return null; continue; }
            const r = q[k] / p[k];
            if (p[k] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
            else { if (r < t0) return null; if (r < t1) t1 = r; }
          }
          return {
            ax: a.x + t0 * dx, ay: a.y + t0 * dy,
            bx: a.x + t1 * dx, by: a.y + t1 * dy,
          };
        };
        const _vis = pts
          .map((p, i) => { const s = _clipSeg(p, pts[(i + 1) % pts.length]); return s ? { ...s, i } : null; })
          .filter((s): s is NonNullable<typeof s> => !!s)
          .map(s => ({ ...s, len: Math.hypot(s.bx - s.ax, s.by - s.ay) }))
          .filter(s => s.len > 8);
        const _totalVis = _vis.reduce((sum, s) => sum + s.len, 0);
        if (_totalVis > 80) {
          const d = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          parcelSvg = `<polygon points="${d}" fill="none" stroke="#fff" stroke-width="3" opacity="0.7" stroke-dasharray="14 7"/>` +
                      `<polygon points="${d}" fill="none" stroke="#111" stroke-width="1.4" stroke-dasharray="14 7"/>`;
          // TRUE ground length of a lot line (ft) from the county-GIS ring —
          // examiners expect lot-line dimensions on a site plan; the line
          // drew undimensioned.
          const _edgeFt = (i: number) => {
            const a = pv[i], b = pv[(i + 1) % pv.length];
            const cosA = Math.cos(a.lat * Math.PI / 180);
            return Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * cosA) * 3.28084;
          };
          // Label every visible run long enough to carry text (so a clipped
          // edge can never read as a stray unexplained line).
          for (const s of _vis.filter(v => v.len > 110).slice(0, 3)) {
            const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
            let ang = Math.atan2(s.by - s.ay, s.bx - s.ax) * 180 / Math.PI;
            if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
            parcelSvg += `<text x="${mx.toFixed(1)}" y="${(my - 5 * fk).toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})" text-anchor="middle" font-family="Arial,sans-serif" font-size="${(8.5 * fk).toFixed(1)}" font-weight="900" letter-spacing="${(1.5 * fk).toFixed(1)}" fill="#fff" stroke="rgba(0,0,0,0.7)" stroke-width="${(2.4 * fk).toFixed(1)}" paint-order="stroke">PROPERTY LINE</text>`;
            const _ft = _edgeFt(s.i);
            if (isFinite(_ft) && _ft > 5) {
              parcelSvg += `<text x="${mx.toFixed(1)}" y="${(my + 12 * fk).toFixed(1)}" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})" text-anchor="middle" font-family="Arial,sans-serif" font-size="${(8 * fk).toFixed(1)}" font-weight="900" fill="#fff" stroke="rgba(0,0,0,0.7)" stroke-width="${(2.2 * fk).toFixed(1)}" paint-order="stroke">${_ft.toFixed(1)}'</text>`;
            }
          }
        }
      }
    }

    // ── Layer 1: module footprints (the point of the sheet) ───────────────
    // Real GPS centers + physical module dims + per-panel azimuth. Filled
    // translucent (no crisp outline — the sub-meter registration residual
    // reads on outlines, not on fills).
    let modSvg = '';
    if (panelPos && panelPos.length > 0 && panelPos.length <= 800) {
      let wM = panelWidIn * 0.0254;
      const lM = panelLenIn * 0.0254;
      // Module WIDTH from the design's own pitch. The payload often omits real
      // panel dimensions, and the 66×40" default drew each module ~10% narrower
      // than the placement pitch (design pitch 1.13 m vs 40" = 1.016 m) → an
      // ~11 cm gap between every module. On the big rows that just looks loose;
      // on the small triangular hip clusters those gaps make 4 panels read as
      // scattered tiles (Ray 2026-07-06: "hip cluster looks messy"). The median
      // nearest-neighbour spacing IS the module footprint in its tightest-
      // packing direction (= width), so draw to it (less a hairline rail gap)
      // and the panels tile as solid blocks. Length already matches the ~66"
      // row pitch, so it's left alone. Only applies when the real width is
      // absent; sanity-bounded so a stray coordinate can't balloon a module.
      if (!project.panelWidthIn && panelPos.length >= 4) {
        const _mPerLng = 111320 * Math.cos(cLat * Math.PI / 180);
        const nn: number[] = [];
        for (const a of panelPos) {
          if (!isFinite(a.lat) || !isFinite(a.lng)) continue;
          let best = Infinity;
          for (const b of panelPos) {
            if (b === a || !isFinite(b.lat) || !isFinite(b.lng)) continue;
            const d = Math.hypot((b.lng - a.lng) * _mPerLng, (b.lat - a.lat) * 111320);
            if (d > 0 && d < best) best = d;
          }
          if (isFinite(best)) nn.push(best);
        }
        nn.sort((x, y) => x - y);
        const medNN = nn.length ? nn[Math.floor(nn.length / 2)] : 0;
        if (medNN > 0.6 && medNN < 2.5) wM = medNN * 0.96;   // hairline gap
      }
      const planeAz = (p: {lat:number;lng:number}) => {
        const rp = (project.roofPlanes ?? []).find((r: any) =>
          (r.vertices?.length ?? 0) >= 3 && _pipRing(p.lat, p.lng, r.vertices));
        return (rp as any)?.azimuth;
      };
      // ── Module-rotation regularizer (Ray 2026-07-06: "straighter to the
      //    edge of the roof") — see utils/moduleAzimuthGrid.ts. Snaps each
      //    module's draw rotation to the building's principal 90° grid so
      //    arrays that should share a ridge render parallel (Melvin's noisy
      //    N=3.2°/S=180.1° both → the sheet axes).
      const _azForGrid = panelPos.map(p =>
        isFinite((p as any).azimuth) ? (p as any).azimuth : planeAz(p)).filter(isFinite) as number[];
      const azGridOffset = computeModuleAzimuthGrid(_azForGrid);
      const parts: string[] = [];
      for (const p of panelPos) {
        if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
        const c = toPxD(p.lat, p.lng);
        if (c.x < -30 || c.x > imgW + 30 || c.y < -30 || c.y > imgH + 30) continue;
        const az = snapModuleAzimuth(isFinite((p as any).azimuth) ? (p as any).azimuth : (planeAz(p) ?? 180), azGridOffset);
        const landscape = (p.orientation || '').toLowerCase() === 'landscape';
        const w = (landscape ? lM : wM) * ppm, h = (landscape ? wM : lM) * ppm;
        // Near-opaque navy — a DESIGN layer, not a photo tint; also absorbs
        // the sub-meter registration residual far better than a 50% wash.
        parts.push(`<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${(az as number).toFixed(1)})"><rect x="${(-w/2).toFixed(1)}" y="${(-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(23,58,161,0.82)" stroke="rgba(255,255,255,0.95)" stroke-width="0.8" rx="0.5"/></g>`);
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
          parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - 4).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${(8 * fk).toFixed(1)}" font-weight="900" fill="#eafff2" stroke="#14532d" stroke-width="${(2.2 * fk).toFixed(1)}" paint-order="stroke">TREE CANOPY</text>`);
          parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${(5.6 * fk).toFixed(1)}" font-weight="bold" fill="#eafff2" stroke="#14532d" stroke-width="${(1.8 * fk).toFixed(1)}" paint-order="stroke">CONCEALED — FIELD VERIFY</text>`);
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
        // Place ON the street surface: ~65% of the way from the building
        // centroid toward the geocode pin (which sits on the frontage),
        // rotated to run along the road (perpendicular to that vector).
        const cpx = toPx(rLat, rLng), ppx2 = _pin ? toPx(_pin.lat, _pin.lng) : cpx;
        const pinDistM = Math.hypot((ppx2.x - cpx.x), (ppx2.y - cpx.y)) / ppm;
        let sx: number, sy: number, rot: number;
        if (pinDistM > 8) {
          // Pin sits on the street frontage → label ~35% past it, along the road
          sx = cpx.x + (ppx2.x - cpx.x) * 1.35; sy = cpx.y + (ppx2.y - cpx.y) * 1.35;
          rot = Math.atan2(ppx2.y - cpx.y, ppx2.x - cpx.x) * 180 / Math.PI + 90;
          if (rot > 90) rot -= 180; else if (rot < -90) rot += 180;
        } else {
          // Degenerate pin (at the building) → bottom edge, horizontal
          sx = cropX + cropW / 2; sy = cropY + cropH - 44 * fk; rot = 0;
        }
        sx = Math.max(cropX + 60 * fk, Math.min(cropX + cropW - 60 * fk, sx));
        sy = Math.max(cropY + 26 * fk, Math.min(cropY + cropH - 20 * fk, sy));
        streetSvg = `<text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" transform="rotate(${rot.toFixed(0)} ${sx.toFixed(1)} ${sy.toFixed(1)})" text-anchor="middle" font-family="Arial,sans-serif" font-size="${(13 * fk).toFixed(1)}" font-weight="900" letter-spacing="${(3 * fk).toFixed(1)}" fill="#fff" stroke="rgba(0,0,0,0.8)" stroke-width="${(3 * fk).toFixed(1)}" paint-order="stroke">${escapeH(streetName)}</text>`;
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
          ac_disconnect: { tag: 'AC',  name: `(N) ${hasAcDisc ? '100A' : '60A'} ${_pv1SupplySide ? 'FUSED' : 'NON-FUSED'} AC DISCONNECT` },
        };
        // Reference-style: small white SQUARE tags on the wall, straight
        // fanned leaders to a margin column, halo text (no white boxes piled
        // on the focal point — that was half the "sloppy").
        const parts: string[] = [];
        const visible = located
          .map(eq => ({ eq, p: toPxD(eq.lat, eq.lng) }))
          .filter(({ p }) => inCrop(p, -8))
          .sort((a, b) => a.p.y - b.p.y);
        const colRight = visible.length ? (visible[0].p.x > cropX + cropW / 2) : true;
        const colX = colRight ? cropX + cropW - 14 * fk : cropX + 14 * fk;
        let ly = Math.max(cropY + cropH * 0.16, (visible[0]?.p.y ?? 0) - 34 * fk);
        visible.forEach(({ eq, p }) => {
          const meta = TAGS[eq.kind];
          const prov = eq.provenance === 'survey_photo_gps' ? 'PER SURVEY PHOTO GPS' : 'APPROX. — FIELD VERIFY';
          ly = Math.max(ly, cropY + 22 * fk); ly = Math.min(ly, cropY + cropH - 26 * fk);
          // leader: straight, white casing + dark line — ends BEFORE the text
          // block (it used to terminate under the label and read as a
          // strikethrough across its own 'FIELD VERIFY' subtext).
          // EVERYTHING here scales with fk — fixed px buried a low-res crop
          // under giant plates (Ray's Google-fallback render).
          const _nameW = (meta.name.length * 6.2 + 6) * fk;
          const lexEnd = colRight ? colX - _nameW - 6 * fk : colX + _nameW + 6 * fk;
          parts.push(`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${lexEnd.toFixed(1)}" y2="${(ly + 3 * fk).toFixed(1)}" stroke="#fff" stroke-width="${(2.6 * fk).toFixed(2)}" opacity="0.9"/>`);
          parts.push(`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${lexEnd.toFixed(1)}" y2="${(ly + 3 * fk).toFixed(1)}" stroke="#111" stroke-width="${(1.1 * fk).toFixed(2)}"/>`);
          // wall tag: white square + code
          parts.push(`<rect x="${(p.x - 6 * fk).toFixed(1)}" y="${(p.y - 6 * fk).toFixed(1)}" width="${(12 * fk).toFixed(1)}" height="${(12 * fk).toFixed(1)}" fill="#fff" stroke="#111" stroke-width="${(1.3 * fk).toFixed(2)}"/>`);
          parts.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + 3 * fk).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${((meta.tag.length > 2 ? 5.6 : 7) * fk).toFixed(1)}" font-weight="900" fill="#111">${meta.tag}</text>`);
          // margin label on an opaque plate — halo text alone sat straight on
          // the neighbor's parked cars and read as sloppy overlay.
          const anchor = colRight ? 'end' : 'start';
          const _plateX = colRight ? colX - _nameW - 4 * fk : colX - 4 * fk;
          parts.push(`<rect x="${_plateX.toFixed(1)}" y="${(ly - 10 * fk).toFixed(1)}" width="${(_nameW + 8 * fk).toFixed(1)}" height="${(23 * fk).toFixed(1)}" rx="2" fill="rgba(255,255,255,0.90)" stroke="#c9ced6" stroke-width="0.6"/>`);
          parts.push(`<text x="${colX.toFixed(1)}" y="${(ly - 1 * fk).toFixed(1)}" text-anchor="${anchor}" font-family="Arial,sans-serif" font-size="${(9.5 * fk).toFixed(1)}" font-weight="900" fill="#111">${meta.name}</text>`);
          parts.push(`<text x="${colX.toFixed(1)}" y="${(ly + 9 * fk).toFixed(1)}" text-anchor="${anchor}" font-family="Arial,sans-serif" font-size="${(6.8 * fk).toFixed(1)}" font-weight="bold" fill="#333">${prov}</text>`);
          ly += 30 * fk;
        });
        eqSvg = parts.join('');
      }
    } catch (eqErr: unknown) {
      console.log('[permit/pv1] equipment markers skipped:', (eqErr as Error)?.message);
    }
    const pSvg = dimSvg + parcelSvg + modSvg + canopySvg + streetSvg + eqSvg;

    // ── Cartographic furniture (all in CROP coordinates) ──────────────────
    // One white plate bottom-left: 20-ft alternating scale bar + computed
    // ratio; white-circle north arrow top-right; 2px neatline. The floating
    // blue module badge moved to the footer strip.
    const scalePx = Math.round(20 * 0.3048 * ppm);
    const seg = scalePx / 4;
    // Graphic scale bar ONLY — the computed "1\" ≈ 14'" ratio is a
    // non-standard scale an examiner red-lines; the bar carries the scale
    // and the footer already says AS NOTED — SEE SCALE BAR.
    // Plate paddings/fonts scale with fk (the bar itself is ground-true via
    // ppm); the north arrow scales the same way.
    const plateW = scalePx + 34 * fk;
    const fx = cropX + 12 * fk, fy = cropY + cropH - 34 * fk;
    const furniture = `
      <g>
        <rect x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" width="${plateW.toFixed(1)}" height="${(26 * fk).toFixed(1)}" rx="2" fill="rgba(255,255,255,0.93)" stroke="#111" stroke-width="${fk.toFixed(2)}"/>
        ${[0,1,2,3].map(i => `<rect x="${(fx + 8 * fk + i*seg).toFixed(1)}" y="${(fy + 8 * fk).toFixed(1)}" width="${seg.toFixed(1)}" height="${(7 * fk).toFixed(1)}" fill="${i % 2 ? '#fff' : '#111'}" stroke="#111" stroke-width="${(0.8 * fk).toFixed(2)}"/>`).join('')}
        <text x="${(fx + 8 * fk).toFixed(1)}" y="${(fy + 23 * fk).toFixed(1)}" font-family="Arial,sans-serif" font-size="${(7 * fk).toFixed(1)}" font-weight="bold" fill="#111">0</text>
        <text x="${(fx + 8 * fk + scalePx/2).toFixed(1)}" y="${(fy + 23 * fk).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${(7 * fk).toFixed(1)}" font-weight="bold" fill="#111">10</text>
        <text x="${(fx + 8 * fk + scalePx).toFixed(1)}" y="${(fy + 23 * fk).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${(7 * fk).toFixed(1)}" font-weight="bold" fill="#111">20 FT</text>
      </g>
      <g transform="translate(${(cropX + cropW - 30 * fk).toFixed(1)},${(cropY + 30 * fk).toFixed(1)}) scale(${fk.toFixed(3)})">
        <circle cx="0" cy="0" r="19" fill="rgba(255,255,255,0.93)" stroke="#111" stroke-width="1.5"/>
        <polygon points="0,-13 5,8 0,3 -5,8" fill="#111"/>
        <text x="0" y="-22" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="900" fill="#fff" stroke="rgba(0,0,0,0.75)" stroke-width="2.4" paint-order="stroke">N</text>
      </g>
      <rect x="${(cropX + 1.5).toFixed(1)}" y="${(cropY + 1.5).toFixed(1)}" width="${(cropW - 3).toFixed(1)}" height="${(cropH - 3).toFixed(1)}" fill="none" stroke="#111" stroke-width="${(2 * fk).toFixed(2)}"/>`;

    drawingContent = `
      <div class=\"f-lg fw9 caps center\">${addr}</div>
      <div class=\"aerial-wrap\">
        <svg viewBox="${cropX.toFixed(1)} ${cropY.toFixed(1)} ${cropW.toFixed(1)} ${cropH.toFixed(1)}" style="position:static;display:block;width:100%;height:auto;aspect-ratio:${(cropW / cropH).toFixed(4)};" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
          <image x="0" y="0" width="${imgW}" height="${imgH}" href="${aerial.imageBase64}" preserveAspectRatio="none"/>
          ${pSvg}
          ${furniture}
        </svg>
      </div>
      <div class="f-xs muted right" style="font-style:italic;margin-top:2px;">${totalPanels} MODULES — ${system.totalDcKw?.toFixed(2)||'—'} kW DC &nbsp;|&nbsp; ${aerial.imageSource === 'nearmap' ? 'Nearmap HD aerial · 7.5 cm/px orthophoto' : 'Satellite aerial imagery'}</div>`;

    // HONEST legend — list exactly what this aerial actually draws, nothing
    // else (the old hardcoded list promised PROPERTY LINE / FIRE SETBACK that
    // aerial mode never drew — an AHJ reads the legend as a content claim).
    aerialLegend = [
      ...(modSvg ? [{ fill:'rgba(30,80,200,0.60)', stroke:'#ffffff', dash:false, label:'PV MODULE (NEW)' }] : []),
      ...(parcelSvg ? [{ fill:'none', stroke:'#111111', dash:true, label:'PROPERTY LINE (COUNTY GIS)' }] : []),
      ...(dimSvg ? [{ fill:'none', stroke:'#6b7280', dash:true,  label:'SUBJECT BUILDING' }] : []),
      ...(canopySvg ? [{ fill:'rgba(22,101,52,0.25)', stroke:'#1a7a2e', dash:true, label:'TREE CANOPY — VERIFY' }] : []),
      ...(eqSvg ? [{ fill:'#ffffff', stroke:'#111111', dash:false, label:'SERVICE EQUIPMENT (TAGGED)' }] : []),
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
  equipItems: Array<{label:string;desc:string;tag:string}>,
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

  const equipCallouts = equipItems.map((eq)=>`
    <div style="margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid #000;">
      <div style="display:flex;align-items:flex-start;gap:3px;width:100%;">
        <div style="flex-shrink:0;width:16px;">
          <div class="mono fw9 center" style="width:16px;height:14px;border:var(--border-med);background:#fff;color:#111;line-height:14px;font-size:${eq.tag.length > 2 ? '5.6px' : '7px'};">${eq.tag}</div>
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
            EXTERIOR WALL — ADJACENT TO UTILITY METER<br/>
            METER: ${project.utilityMeter || 'FIELD VERIFY'}
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
              <span class="f-md">SCALE: AS NOTED — SEE SCALE BAR &nbsp;|&nbsp; ANSI B 11&Prime; &times; 17&Prime;</span>
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
  /** Design→imagery shift for Google-fallback aerials, pre-computed by the
   *  permit route via utils/aerialEdgeSnap.ts (generatePermitHTML is sync so
   *  the image analysis can't run here). Degrees to ADD to design lat/lng. */
  registrationShift?: { dLat: number; dLng: number; shiftM?: number; scoreRatio?: number; method?: string };
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



