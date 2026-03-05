'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { PlacedPanel, SolarPanel, SystemType } from '@/types';

interface Props {
  panels: PlacedPanel[];
  systemType: SystemType;
  tilt: number;
  fenceHeight: number;
  selectedPanel: SolarPanel;
  mapCenter?: { lat: number; lng: number };
  mapZoom?: number;
  solarData?: any; // Google Solar API buildingInsights data
}

const GOOGLE_API_KEY = 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';

declare global {
  interface Window { google: any; }
}

function injectGoogleMapsLoader(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) { resolve(); return; }
    if (document.getElementById('__gm_alpha_loader')) {
      const poll = setInterval(() => {
        if (window.google?.maps?.importLibrary) { clearInterval(poll); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(poll); reject(new Error('Timeout loading Google Maps')); }, 20000);
      return;
    }
    const s = document.createElement('script');
    s.id = '__gm_alpha_loader';
    s.textContent = `(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await(a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src="https://maps."+c+"apis.com/maps/api/js?"+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({key:"${GOOGLE_API_KEY}",v:"alpha"});`;
    document.head.appendChild(s);
    const poll = setInterval(() => {
      if (window.google?.maps?.importLibrary) { clearInterval(poll); resolve(); }
    }, 100);
    setTimeout(() => { clearInterval(poll); reject(new Error('Google Maps load timeout')); }, 20000);
  });
}

type ViewMode = '3d' | 'street';

export default function Google3DViewer({
  panels, systemType, tilt, fenceHeight, selectedPanel,
  mapCenter, mapZoom = 19, solarData
}: Props) {
  const map3dContainerRef = useRef<HTMLDivElement>(null);
  const streetContainerRef = useRef<HTMLDivElement>(null);
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const map3dElRef = useRef<any>(null);
  const streetPanoRef = useRef<any>(null);
  const panelPolygonsRef = useRef<any[]>([]);
  const initDoneRef = useRef(false);
  const svListenerRef = useRef<any>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [msg, setMsg] = useState('Loading Google Maps...');
  const [svReady, setSvReady] = useState(false);

  const lat = mapCenter?.lat ?? 33.4484;
  const lng = mapCenter?.lng ?? -112.0740;
  const range = Math.max(80, 15000 / Math.pow(2, Math.max(0, (mapZoom || 19) - 10)));

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    (async () => {
      try {
        setMsg('Loading Google Maps Platform...');
        await injectGoogleMapsLoader();
        setMsg('Building photorealistic 3D scene...');
        await init3DMap();
        setMsg('Loading Street View...');
        await initStreetView().catch(e => console.warn('SV:', e));
        setStatus('ready');
        setMsg('');
      } catch (e: any) {
        setStatus('error');
        setMsg(e?.message || 'Failed to load');
      }
    })();
  }, []);

  // ── 3D Map ───────────────────────────────────────────────────────────────
  const init3DMap = async () => {
    if (!map3dContainerRef.current) throw new Error('Container missing');
    const { Map3DElement, MapMode } = await window.google.maps.importLibrary('maps3d');
    map3dContainerRef.current.innerHTML = '';
    const map3d = new Map3DElement({
      center: { lat, lng, altitude: 0 },
      tilt: 67.5, heading: 0, range,
      mode: MapMode.SATELLITE,
    });
    map3d.style.cssText = 'width:100%;height:100%;display:block;';
    map3dContainerRef.current.appendChild(map3d);
    map3dElRef.current = map3d;
    await new Promise<void>(res => {
      map3d.addEventListener('gmp-ready', () => res(), { once: true });
      setTimeout(res, 6000);
    });
    await drawPanels3D(map3d);
  };

  // ── Street View ──────────────────────────────────────────────────────────
  const initStreetView = async () => {
    if (!streetContainerRef.current) return;
    const { StreetViewPanorama, StreetViewService, StreetViewStatus } =
      await window.google.maps.importLibrary('streetView');
    const svc = new StreetViewService();
    const result: any = await new Promise((res, rej) => {
      svc.getPanorama({ location: { lat, lng }, radius: 150, preference: 'nearest' },
        (data: any, st: any) => st === StreetViewStatus.OK ? res(data) : rej(new Error('No SV: ' + st)));
    });

    let heading = 0;
    try {
      const { spherical } = await window.google.maps.importLibrary('geometry');
      heading = spherical.computeHeading(result.location.latLng, new window.google.maps.LatLng(lat, lng));
    } catch {}

    const pano = new StreetViewPanorama(streetContainerRef.current, {
      pano: result.location.pano,
      pov: { heading, pitch: 5 },
      zoom: 0,
      addressControl: false,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
      showRoadLabels: false,
    });
    streetPanoRef.current = pano;

    // Listen for POV changes to redraw overlay
    pano.addListener('pov_changed', () => drawStreetViewOverlay());
    pano.addListener('position_changed', () => drawStreetViewOverlay());
    setSvReady(true);
    setTimeout(() => drawStreetViewOverlay(), 1500);
  };

  // ── Draw 3D Panels (Polygon3DElement) ────────────────────────────────────
  const drawPanels3D = useCallback(async (map3d: any) => {
    if (!map3d || !window.google?.maps) return;
    panelPolygonsRef.current.forEach(p => { try { p.remove(); } catch {} });
    panelPolygonsRef.current = [];
    if (!panels?.length) return;

    const { Polygon3DElement } = await window.google.maps.importLibrary('maps3d');

    const fillColor = systemType === 'roof' ? '#1e3a8a'
      : systemType === 'ground' ? '#14532d' : '#1e3a8a';
    const strokeColor = systemType === 'roof' ? '#93c5fd'
      : systemType === 'ground' ? '#86efac' : '#93c5fd';

    const altOffset = systemType === 'fence' ? Math.max(1, fenceHeight)
      : systemType === 'ground' ? 0.5 : 3.0;

    const PW = (selectedPanel?.width ?? 1.0) / 2;
    const PH = (selectedPanel?.height ?? 1.7) / 2;
    const mLat = 111320;
    const mLng = 111320 * Math.cos(lat * Math.PI / 180);

    for (const panel of panels) {
      const pLat = (panel.lat && panel.lat !== 0) ? panel.lat : lat;
      const pLng = (panel.lng && panel.lng !== 0) ? panel.lng : lng;
      const panelTilt = panel.tilt ?? tilt;

      // For tilted panels, offset the top edge upward
      const tiltRad = panelTilt * Math.PI / 180;
      const topAlt = altOffset + PH * 2 * Math.sin(tiltRad);
      const botAlt = altOffset;

      const corners = systemType === 'fence'
        // Fence: vertical panels
        ? [
          { lat: pLat + PH / mLat, lng: pLng - PW / mLng, altitude: altOffset + fenceHeight },
          { lat: pLat + PH / mLat, lng: pLng + PW / mLng, altitude: altOffset + fenceHeight },
          { lat: pLat - PH / mLat, lng: pLng + PW / mLng, altitude: altOffset + fenceHeight },
          { lat: pLat - PH / mLat, lng: pLng - PW / mLng, altitude: altOffset + fenceHeight },
          { lat: pLat + PH / mLat, lng: pLng - PW / mLng, altitude: altOffset + fenceHeight },
        ]
        // Roof/ground: tilted panels
        : [
          { lat: pLat + PH / mLat, lng: pLng - PW / mLng, altitude: topAlt },
          { lat: pLat + PH / mLat, lng: pLng + PW / mLng, altitude: topAlt },
          { lat: pLat - PH / mLat, lng: pLng + PW / mLng, altitude: botAlt },
          { lat: pLat - PH / mLat, lng: pLng - PW / mLng, altitude: botAlt },
          { lat: pLat + PH / mLat, lng: pLng - PW / mLng, altitude: topAlt },
        ];

      try {
        const poly = new Polygon3DElement({
          strokeColor,
          strokeWidth: 1.5,
          fillColor: fillColor + 'ee',
          altitudeMode: 'RELATIVE_TO_GROUND',
          extruded: false,
          drawsOccludedSegments: true,
        });
        poly.outerCoordinates = corners;
        map3d.appendChild(poly);
        panelPolygonsRef.current.push(poly);
      } catch (e) { console.warn('Panel poly error:', e); }
    }
  }, [panels, systemType, tilt, fenceHeight, selectedPanel, lat, lng]);

  // ── Street View Canvas Overlay ───────────────────────────────────────────
  const drawStreetViewOverlay = useCallback(() => {
    const canvas = svCanvasRef.current;
    const pano = streetPanoRef.current;
    if (!canvas || !pano || !panels?.length) return;

    const container = streetContainerRef.current;
    if (!container) return;

    const W = container.clientWidth || 800;
    const H = container.clientHeight || 500;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const pov = pano.getPov();
    const heading = pov.heading || 0;
    const pitch = pov.pitch || 0;
    const zoom = pov.zoom || 0;
    const fov = 90 / Math.pow(2, zoom); // degrees

    const panoPos = pano.getPosition();
    if (!panoPos) return;
    const panoLat = panoPos.lat();
    const panoLng = panoPos.lng();

    const mLat = 111320;
    const mLng = 111320 * Math.cos(panoLat * Math.PI / 180);

    const panelColor = systemType === 'roof' ? 'rgba(30,58,138,0.82)'
      : systemType === 'ground' ? 'rgba(20,83,45,0.82)'
      : 'rgba(30,58,138,0.82)';
    const panelStroke = systemType === 'roof' ? '#93c5fd'
      : systemType === 'ground' ? '#86efac' : '#93c5fd';

    const PW = selectedPanel?.width ?? 1.0;
    const PH = selectedPanel?.height ?? 1.7;
    const altOffset = systemType === 'fence' ? fenceHeight
      : systemType === 'ground' ? 0.5 : 3.5;

    // Project a 3D point (dx, dy, dz in meters from camera) to canvas pixel
    function project(dx: number, dz: number, dy: number): { x: number; y: number; visible: boolean } {
      // dx = east, dz = north, dy = up
      const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (dist < 0.1) return { x: 0, y: 0, visible: false };

      // Bearing from camera to point
      const bearingRad = Math.atan2(dx, dz);
      const bearingDeg = bearingRad * 180 / Math.PI;

      // Elevation angle
      const elevDeg = Math.asin(dy / dist) * 180 / Math.PI;

      // Relative to current heading/pitch
      let relH = bearingDeg - heading;
      while (relH > 180) relH -= 360;
      while (relH < -180) relH += 360;
      const relP = elevDeg - pitch;

      // Only show if in FOV
      if (Math.abs(relH) > fov * 1.5 || Math.abs(relP) > fov) return { x: 0, y: 0, visible: false };

      const x = W / 2 + (relH / fov) * (W / 2);
      const y = H / 2 - (relP / fov) * (H / 2);
      return { x, y, visible: true };
    }

    let panelsDrawn = 0;

    panels.forEach((panel) => {
      const pLat = (panel.lat && panel.lat !== 0) ? panel.lat : lat;
      const pLng = (panel.lng && panel.lng !== 0) ? panel.lng : lng;

      // Vector from panorama to panel center (meters)
      const dx = (pLng - panoLng) * mLng;
      const dz = (pLat - panoLat) * mLat;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Only draw panels within 100m
      if (dist > 100) return;

      const panelTilt = panel.tilt ?? tilt;
      const tiltRad = panelTilt * Math.PI / 180;

      // Panel corners in 3D space relative to pano
      const hw = PW / 2;
      const hh = PH / 2;

      let corners3D: { ex: number; ez: number; ey: number }[];

      if (systemType === 'fence') {
        // Vertical fence panels
        corners3D = [
          { ex: dx - hw, ez: dz, ey: altOffset },
          { ex: dx + hw, ez: dz, ey: altOffset },
          { ex: dx + hw, ez: dz, ey: altOffset + PH },
          { ex: dx - hw, ez: dz, ey: altOffset + PH },
        ];
      } else {
        // Tilted roof/ground panels
        const topY = altOffset + hh * Math.sin(tiltRad);
        const botY = altOffset - hh * Math.sin(tiltRad);
        const topZ = hh * Math.cos(tiltRad);
        const botZ = -hh * Math.cos(tiltRad);
        corners3D = [
          { ex: dx - hw, ez: dz + botZ, ey: botY },
          { ex: dx + hw, ez: dz + botZ, ey: botY },
          { ex: dx + hw, ez: dz + topZ, ey: topY },
          { ex: dx - hw, ez: dz + topZ, ey: topY },
        ];
      }

      const projected = corners3D.map(c => project(c.ex, c.ez, c.ey));
      if (projected.every(p => !p.visible)) return;

      // Draw filled panel
      ctx.beginPath();
      ctx.moveTo(projected[0].x, projected[0].y);
      for (let i = 1; i < projected.length; i++) {
        ctx.lineTo(projected[i].x, projected[i].y);
      }
      ctx.closePath();

      // Depth-based opacity (closer = more opaque)
      const opacity = Math.max(0.4, Math.min(0.9, 1 - dist / 80));
      ctx.fillStyle = panelColor.replace('0.82', String(opacity));
      ctx.fill();

      // Panel grid lines (simulate cell pattern)
      ctx.strokeStyle = panelStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw internal grid (3x6 cells)
      ctx.strokeStyle = panelStroke.replace('#', 'rgba(').replace('fd', 'fd,0.3)') || 'rgba(147,197,253,0.3)';
      ctx.lineWidth = 0.5;
      for (let gi = 1; gi < 3; gi++) {
        const t = gi / 3;
        const lx1 = projected[0].x + t * (projected[1].x - projected[0].x);
        const ly1 = projected[0].y + t * (projected[1].y - projected[0].y);
        const lx2 = projected[3].x + t * (projected[2].x - projected[3].x);
        const ly2 = projected[3].y + t * (projected[2].y - projected[3].y);
        ctx.beginPath(); ctx.moveTo(lx1, ly1); ctx.lineTo(lx2, ly2); ctx.stroke();
      }
      for (let gi = 1; gi < 6; gi++) {
        const t = gi / 6;
        const lx1 = projected[0].x + t * (projected[3].x - projected[0].x);
        const ly1 = projected[0].y + t * (projected[3].y - projected[0].y);
        const lx2 = projected[1].x + t * (projected[2].x - projected[1].x);
        const ly2 = projected[1].y + t * (projected[2].y - projected[1].y);
        ctx.beginPath(); ctx.moveTo(lx1, ly1); ctx.lineTo(lx2, ly2); ctx.stroke();
      }

      panelsDrawn++;
    });

    // Draw info overlay if panels visible
    if (panelsDrawn > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.roundRect?.(12, H - 48, 220, 34, 8);
      ctx.fill();
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillText(`☀️ ${panelsDrawn} panels visible · ${((panelsDrawn * (selectedPanel?.wattage ?? 400)) / 1000).toFixed(1)} kW`, 22, H - 26);
    }
  }, [panels, systemType, tilt, fenceHeight, selectedPanel, lat, lng, svReady]);

  // Redraw SV overlay when panels/view changes
  useEffect(() => {
    if (status === 'ready' && viewMode === 'street') {
      drawStreetViewOverlay();
    }
  }, [panels, viewMode, status, drawStreetViewOverlay]);

  // Redraw 3D panels when they change
  useEffect(() => {
    if (status === 'ready' && map3dElRef.current) {
      drawPanels3D(map3dElRef.current);
    }
  }, [panels, status, drawPanels3D]);

  // Switch to street view → draw overlay
  useEffect(() => {
    if (viewMode === 'street' && svReady) {
      setTimeout(() => drawStreetViewOverlay(), 500);
    }
  }, [viewMode, svReady]);

  const totalKw = ((panels.length * (selectedPanel?.wattage ?? 400)) / 1000).toFixed(1);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 500, background: '#0d1117', display: 'flex', flexDirection: 'column' }}>

      {/* ── Tab Bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px',
        background: 'rgba(0,0,0,0.92)', borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0, zIndex: 20,
      }}>
        {(['3d', 'street'] as ViewMode[]).map((mode, i) => (
          <button key={mode} onClick={() => setViewMode(mode)} style={{
            padding: '6px 16px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            borderRadius: i === 0 ? '7px 0 0 7px' : '0 7px 7px 0',
            background: viewMode === mode
              ? 'linear-gradient(135deg,#1d4ed8,#2563eb)'
              : 'rgba(255,255,255,0.05)',
            color: viewMode === mode ? '#fff' : '#64748b',
            transition: 'all 0.15s',
          }}>
            {mode === '3d' ? '🏙️ Photorealistic 3D' : '🚶 Street View + AR Panels'}
          </button>
        ))}
        {panels.length > 0 && (
          <div style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ color: '#fbbf24' }}>☀️</span>
            <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{panels.length}</span>
            <span style={{ color: '#475569' }}>panels ·</span>
            <span style={{ color: '#60a5fa', fontWeight: 700 }}>{totalKw} kW</span>
          </div>
        )}
      </div>

      {/* ── Map Area ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* 3D Map */}
        <div ref={map3dContainerRef} style={{
          position: 'absolute', inset: 0,
          display: viewMode === '3d' ? 'block' : 'none',
        }} />

        {/* Street View + Canvas Overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          display: viewMode === 'street' ? 'block' : 'none',
        }}>
          <div ref={streetContainerRef} style={{ position: 'absolute', inset: 0 }} />
          {/* AR Panel overlay canvas */}
          <canvas ref={svCanvasRef} style={{
            position: 'absolute', inset: 0,
            pointerEvents: 'none', zIndex: 5,
          }} />
          {/* Redraw button */}
          {svReady && (
            <button
              onClick={() => drawStreetViewOverlay()}
              style={{
                position: 'absolute', top: 10, right: 10, zIndex: 10,
                background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
                border: '1px solid rgba(59,130,246,0.4)', borderRadius: 8,
                color: '#93c5fd', fontSize: 11, fontWeight: 600,
                padding: '5px 12px', cursor: 'pointer',
              }}
            >
              🔄 Refresh Overlay
            </button>
          )}
        </div>

        {/* Loading */}
        {status === 'loading' && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 30,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(160deg,#0d1117,#0f172a)', gap: 22,
          }}>
            <div style={{ position: 'relative', width: 76, height: 76 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle at 38% 38%,#1e3a8a,#0f172a)', boxShadow: '0 0 40px rgba(59,130,246,0.2)' }} />
              <div style={{ position: 'absolute', inset: -6, borderRadius: '50%', border: '3px solid transparent', borderTopColor: '#3b82f6', borderRightColor: 'rgba(59,130,246,0.2)', animation: 'gv_spin 0.9s linear infinite' }} />
              <div style={{ position: 'absolute', inset: 9, borderRadius: '50%', border: '2px solid transparent', borderBottomColor: '#60a5fa', animation: 'gv_spin 0.6s linear infinite reverse' }} />
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 12, height: 12, borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 14px #3b82f6' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#f1f5f9', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Google Photorealistic 3D</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>{msg}</div>
            </div>
            <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, padding: '6px 16px', color: '#3b82f6', fontSize: 11, fontWeight: 600 }}>
              Maps Platform · Alpha · Photorealistic 3D Tiles
            </div>
            <style>{`@keyframes gv_spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0d1117', gap: 16 }}>
            <div style={{ fontSize: 48 }}>🌐</div>
            <div style={{ color: '#f87171', fontSize: 16, fontWeight: 700 }}>3D Map Failed</div>
            <div style={{ color: '#6b7280', fontSize: 13, maxWidth: 340, textAlign: 'center', lineHeight: 1.6 }}>{msg}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <a href="/test3d.html" target="_blank" style={{ padding: '8px 20px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8, fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>
                Test API →
              </a>
              <button onClick={() => { initDoneRef.current = false; window.location.reload(); }}
                style={{ padding: '8px 20px', background: 'linear-gradient(135deg,#1d4ed8,#2563eb)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Reload
              </button>
            </div>
          </div>
        )}

        {/* Ready badges */}
        {status === 'ready' && (
          <>
            <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 7, pointerEvents: 'none' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
              <span style={{ color: '#f1f5f9', fontSize: 11, fontWeight: 600 }}>
                {viewMode === '3d' ? 'Google Photorealistic 3D · Alpha' : 'Street View · AR Solar Overlay'}
              </span>
            </div>
            {viewMode === '3d' && (
              <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', borderRadius: 8, padding: '5px 14px', color: '#94a3b8', fontSize: 11, display: 'flex', gap: 14, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                <span>🖱️ Drag: orbit</span><span>⚲ Scroll: zoom</span><span>⇧ Shift+drag: tilt</span>
              </div>
            )}
            {viewMode === 'street' && panels.length > 0 && (
              <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'rgba(30,58,138,0.85)', backdropFilter: 'blur(8px)', borderRadius: 8, padding: '5px 14px', color: '#bfdbfe', fontSize: 11, pointerEvents: 'none', whiteSpace: 'nowrap', border: '1px solid rgba(59,130,246,0.3)' }}>
                ☀️ Solar panels overlaid on real Street View · Drag to look around
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}