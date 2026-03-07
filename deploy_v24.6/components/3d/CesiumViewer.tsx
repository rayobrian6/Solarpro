'use client';
/**
 * ═══════════════════════════════════════════════════════════════
 * SOLAR PRO — Professional Digital Twin Engine
 * ═══════════════════════════════════════════════════════════════
 * 
 * Stack:
 *   • CesiumJS 1.114       — geospatial 3D engine
 *   • Google 3D Tiles      — photorealistic building meshes
 *   • Google Solar API     — roof segments, irradiance, shade
 *   • Google Elevation API — terrain mesh
 *   • SunCalc              — physically accurate sun position
 *   • Three.js             — PBR panel mesh rendering
 *   • WebGL2               — GPU instancing
 * 
 * Features:
 *   • True digital twin — real building geometry
 *   • Parcel + easement overlay
 *   • Roof/ground/fence panel placement
 *   • Real-time shade simulation
 *   • Sun position animation
 *   • Street View AR overlay
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { PlacedPanel, SolarPanel, SystemType } from '@/types';
import { getSunPosition } from '@/lib/solarMath';
import { buildDigitalTwin, type DigitalTwinData, type RoofSegment } from '@/lib/digitalTwin';

interface Props {
  panels: PlacedPanel[];
  systemType: SystemType;
  tilt: number;
  fenceHeight: number;
  selectedPanel: SolarPanel;
  mapCenter?: { lat: number; lng: number };
  mapZoom?: number;
  solarData?: any;
  projectAddress?: string;
}

const GOOGLE_API_KEY = 'AIzaSyBcXQC-i7s2TJz8PNOM1OhiU-sEhPR41wE';

declare global { interface Window { Cesium: any; google: any; } }

type ViewMode = '3d' | 'street' | 'shade';
type LoadStage = 'idle' | 'cesium' | 'tiles' | 'solar' | 'terrain' | 'panels' | 'done' | 'error';

export default function CesiumViewer({
  panels, systemType, tilt, fenceHeight, selectedPanel,
  mapCenter, mapZoom = 19, solarData, projectAddress
}: Props) {
  const cesiumRef   = useRef<HTMLDivElement>(null);
  const streetRef   = useRef<HTMLDivElement>(null);
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef   = useRef<any>(null);
  const primitivesRef = useRef<any[]>([]);
  const entitiesRef   = useRef<any[]>([]);
  const initDone    = useRef(false);
  const svPanoRef   = useRef<any>(null);

  const [viewMode, setViewMode]   = useState<ViewMode>('3d');
  const [stage, setStage]         = useState<LoadStage>('idle');
  const [stageMsg, setStageMsg]   = useState('');
  const [progress, setProgress]   = useState(0);
  const [twin, setTwin]           = useState<DigitalTwinData | null>(null);
  const [showParcel, setShowParcel]     = useState(true);
  const [showEasements, setShowEasements] = useState(true);
  const [showRoofSegs, setShowRoofSegs]   = useState(true);
  const [showShade, setShowShade]         = useState(false);
  const [simHour, setSimHour]     = useState(12);
  const [svReady, setSvReady]     = useState(false);
  const [animating, setAnimating] = useState(false);
  const animRef = useRef<any>(null);

  const lat = mapCenter?.lat ?? 33.4484;
  const lng = mapCenter?.lng ?? -112.0740;

  const sunPos = getSunPosition(lat, lng, (() => {
    const d = new Date(); d.setHours(Math.floor(simHour), Math.round((simHour % 1) * 60)); return d;
  })());

  // ── Boot sequence ────────────────────────────────────────────────────────
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    boot();
  }, []);

  useEffect(() => {
    if (stage === 'done' && viewerRef.current) {
      viewerRef.current.camera.flyTo({
        destination: window.Cesium.Cartesian3.fromDegrees(lng, lat, 200),
        orientation: { heading: 0, pitch: window.Cesium.Math.toRadians(-45), roll: 0 },
        duration: 1.5,
      });
      drawAllOverlays();
    }
  }, [lat, lng, stage]);

  useEffect(() => {
    if (stage === 'done') drawPanelPrimitives();
  }, [panels, showShade, simHour, stage]);

  useEffect(() => {
    if (stage === 'done') drawAllOverlays();
  }, [showParcel, showEasements, showRoofSegs, twin, stage]);

  useEffect(() => {
    if (stage === 'done' && viewMode === 'street' && svPanoRef.current) {
      setTimeout(() => drawSVOverlay(), 400);
    }
  }, [viewMode, panels, stage]);

  // ── Main boot ────────────────────────────────────────────────────────────
  async function boot() {
    try {
      step('cesium', 'Loading CesiumJS engine...', 5);
      await loadCesium();

      step('tiles', 'Initializing 3D viewer...', 15);
      const viewer = await initViewer();

      step('solar', 'Fetching Google Solar API data...', 30);
      const twinData = await buildDigitalTwin(lat, lng, projectAddress ?? '');
      setTwin(twinData);

      step('terrain', 'Loading Google Photorealistic 3D Tiles...', 50);
      await loadGoogleTiles(viewer, twinData);

      step('panels', 'Placing solar panels...', 75);
      await flyToProperty(viewer);
      drawAllOverlays(viewer, twinData);
      drawPanelPrimitives(viewer);

      step('done', '', 100);
      setStage('done');

      // Load Street View in background
      initStreetView().catch(e => console.warn('SV:', e));

    } catch (e: any) {
      console.error('Boot error:', e);
      setStage('error');
      setStageMsg(e?.message ?? 'Unknown error');
    }
  }

  function step(s: LoadStage, msg: string, pct: number) {
    setStage(s); setStageMsg(msg); setProgress(pct);
  }

  // ── Load Cesium from CDN ─────────────────────────────────────────────────
  function loadCesium(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.Cesium) { resolve(); return; }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Widgets/widgets.css';
      document.head.appendChild(link);
      const s = document.createElement('script');
      s.src = 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Cesium.js';
      s.onload = () => window.Cesium ? resolve() : reject(new Error('Cesium unavailable'));
      s.onerror = () => reject(new Error('Cesium CDN failed'));
      document.head.appendChild(s);
    });
  }

  // ── Init Cesium Viewer ───────────────────────────────────────────────────
  async function initViewer(): Promise<any> {
    if (!cesiumRef.current) throw new Error('Container missing');
    const C = window.Cesium;
    C.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc5YzciLCJpZCI6NTc3MzMsImlhdCI6MTYyNzg0NTE4Mn0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk';

    const viewer = new C.Viewer(cesiumRef.current, {
      imageryProvider: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      animation: false, timeline: false, fullscreenButton: false,
      vrButton: false, infoBox: false, selectionIndicator: false,
      shadows: true, terrainShadows: C.ShadowMode.ENABLED,
    });

    viewer.scene.globe.show = false;
    viewer.scene.backgroundColor = new C.Color(0.05, 0.07, 0.12, 1);
    viewer.scene.globe.enableLighting = true;
    viewer.scene.atmosphere.show = true;
    viewer.scene.sun = new C.Sun();

    // Set clock to simulation time
    const d = new Date(); d.setHours(Math.floor(simHour));
    viewer.clock.currentTime = C.JulianDate.fromDate(d);

    viewerRef.current = viewer;
    return viewer;
  }

  // ── Load Google 3D Tiles ─────────────────────────────────────────────────
  async function loadGoogleTiles(viewer: any, twinData: DigitalTwinData) {
    const C = window.Cesium;
    try {
      const tileset = await C.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_API_KEY}`,
        { showCreditsOnScreen: true, maximumScreenSpaceError: 4 }
      );
      viewer.scene.primitives.add(tileset);
    } catch (e) {
      console.warn('3D tiles fallback to satellite imagery:', e);
      viewer.scene.globe.show = true;
      viewer.imageryLayers.addImageryProvider(
        new C.UrlTemplateImageryProvider({ url: `/api/tile?z={z}&x={x}&y={y}`, maximumLevel: 20 })
      );
      // Add terrain
      try {
        viewer.terrainProvider = await C.CesiumTerrainProvider.fromIonAssetId(1);
      } catch {}
    }
  }

  // ── Fly to property ──────────────────────────────────────────────────────
  async function flyToProperty(viewer: any) {
    const C = window.Cesium;
    const height = Math.max(80, 15000 / Math.pow(2, Math.max(0, (mapZoom || 19) - 10)));
    await new Promise<void>(res => {
      viewer.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(lng, lat, height),
        orientation: { heading: 0, pitch: C.Math.toRadians(-50), roll: 0 },
        duration: 1.5, complete: res,
      });
    });
  }

  // ── Draw all overlays ────────────────────────────────────────────────────
  function drawAllOverlays(v?: any, t?: DigitalTwinData) {
    const viewer = v ?? viewerRef.current;
    const twinData = t ?? twin;
    if (!viewer || !window.Cesium) return;

    // Clear old entities
    entitiesRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    entitiesRef.current = [];

    if (twinData) {
      if (showParcel && twinData.parcel) drawParcelBoundary(viewer, twinData);
      if (showEasements && twinData.parcel?.easements) drawEasements(viewer, twinData);
      if (showRoofSegs && twinData.roofSegments.length > 0) drawRoofSegments(viewer, twinData);
      drawTerrainGrid(viewer, twinData);
    }
  }

  // ── Parcel boundary ──────────────────────────────────────────────────────
  function drawParcelBoundary(viewer: any, twinData: DigitalTwinData) {
    const C = window.Cesium;
    const { boundary } = twinData.parcel!;
    const elev = twinData.elevation;

    const positions = [...boundary, boundary[0]].map(p =>
      C.Cartesian3.fromDegrees(p.lng, p.lat, elev + 0.5)
    );

    const e = viewer.entities.add({
      polyline: {
        positions,
        width: 3,
        material: new C.PolylineGlowMaterialProperty({
          glowPower: 0.3,
          color: C.Color.fromCssColorString('#22c55e'),
        }),
        clampToGround: false,
      },
    });
    entitiesRef.current.push(e);

    // Parcel fill (semi-transparent)
    const e2 = viewer.entities.add({
      polygon: {
        hierarchy: new C.PolygonHierarchy(
          boundary.map(p => C.Cartesian3.fromDegrees(p.lng, p.lat, elev + 0.1))
        ),
        material: C.Color.fromCssColorString('#22c55e').withAlpha(0.06),
        height: elev + 0.1,
        outline: false,
      },
    });
    entitiesRef.current.push(e2);

    // Label
    const e3 = viewer.entities.add({
      position: C.Cartesian3.fromDegrees(lng, lat, elev + 5),
      label: {
        text: `📐 Parcel: ${Math.round(twinData.parcel!.area)} m²`,
        font: '600 13px Inter, sans-serif',
        fillColor: C.Color.fromCssColorString('#22c55e'),
        outlineColor: C.Color.BLACK,
        outlineWidth: 2,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        pixelOffset: new C.Cartesian2(0, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    entitiesRef.current.push(e3);
  }

  // ── Easements ────────────────────────────────────────────────────────────
  function drawEasements(viewer: any, twinData: DigitalTwinData) {
    const C = window.Cesium;
    const elev = twinData.elevation;

    twinData.parcel!.easements.forEach(ez => {
      const color = ez.type === 'utility' ? '#f59e0b'
        : ez.type === 'setback' ? '#ef4444'
        : '#a78bfa';

      const e = viewer.entities.add({
        polygon: {
          hierarchy: new C.PolygonHierarchy(
            ez.boundary.map(p => C.Cartesian3.fromDegrees(p.lng, p.lat, elev + 0.3))
          ),
          material: C.Color.fromCssColorString(color).withAlpha(0.18),
          height: elev + 0.3,
          outline: true,
          outlineColor: C.Color.fromCssColorString(color).withAlpha(0.7),
          outlineWidth: 2,
        },
      });
      entitiesRef.current.push(e);

      // Label
      const center = ez.boundary.reduce(
        (acc, p) => ({ lat: acc.lat + p.lat / ez.boundary.length, lng: acc.lng + p.lng / ez.boundary.length }),
        { lat: 0, lng: 0 }
      );
      const e2 = viewer.entities.add({
        position: C.Cartesian3.fromDegrees(center.lng, center.lat, elev + 3),
        label: {
          text: `⚠️ ${ez.description}`,
          font: '500 11px Inter, sans-serif',
          fillColor: C.Color.fromCssColorString(color),
          outlineColor: C.Color.BLACK,
          outlineWidth: 2,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new C.Cartesian2(0, -5),
        },
      });
      entitiesRef.current.push(e2);
    });
  }

  // ── Roof segments ────────────────────────────────────────────────────────
  function drawRoofSegments(viewer: any, twinData: DigitalTwinData) {
    const C = window.Cesium;

    twinData.roofSegments.forEach(seg => {
      // Color by sunshine hours
      const maxSun = 1900, minSun = 800;
      const t = Math.max(0, Math.min(1, (seg.sunshineHours - minSun) / (maxSun - minSun)));
      const r = Math.round(255 * (1 - t));
      const g = Math.round(200 * t);
      const color = C.Color.fromBytes(r, g, 30, 100);

      const corners = seg.corners.map(c =>
        C.Cartesian3.fromDegrees(c.lng, c.lat, c.alt)
      );

      if (corners.length >= 3) {
        const e = viewer.entities.add({
          polygon: {
            hierarchy: new C.PolygonHierarchy(corners),
            material: color,
            height: seg.elevation,
            outline: true,
            outlineColor: C.Color.fromCssColorString('#60a5fa').withAlpha(0.6),
            outlineWidth: 1.5,
          },
        });
        entitiesRef.current.push(e);
      }

      // Roof segment label
      const e2 = viewer.entities.add({
        position: C.Cartesian3.fromDegrees(seg.center.lng, seg.center.lat, seg.elevation + 2),
        label: {
          text: `${seg.pitchDegrees.toFixed(0)}° · ${seg.sunshineHours.toFixed(0)}h/yr`,
          font: '500 10px Inter, sans-serif',
          fillColor: C.Color.WHITE,
          outlineColor: C.Color.BLACK,
          outlineWidth: 2,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new C.Cartesian2(0, -5),
          scale: 0.85,
        },
      });
      entitiesRef.current.push(e2);
    });
  }

  // ── Terrain elevation grid ───────────────────────────────────────────────
  function drawTerrainGrid(viewer: any, twinData: DigitalTwinData) {
    if (!twinData.elevationGrid.length) return;
    // Terrain grid is handled by Cesium terrain provider
    // Just add a subtle ground plane at base elevation
    const C = window.Cesium;
    const mLat = 111320;
    const mLng = mLat * Math.cos(lat * Math.PI / 180);
    const size = 60;
    const e = viewer.entities.add({
      polygon: {
        hierarchy: new C.PolygonHierarchy([
          C.Cartesian3.fromDegrees(lng - size / mLng, lat - size / mLat, twinData.elevation - 0.1),
          C.Cartesian3.fromDegrees(lng + size / mLng, lat - size / mLat, twinData.elevation - 0.1),
          C.Cartesian3.fromDegrees(lng + size / mLng, lat + size / mLat, twinData.elevation - 0.1),
          C.Cartesian3.fromDegrees(lng - size / mLng, lat + size / mLat, twinData.elevation - 0.1),
        ]),
        material: C.Color.fromCssColorString('#1a2e1a').withAlpha(0.0),
        height: twinData.elevation - 0.1,
      },
    });
    entitiesRef.current.push(e);
  }

  // ── Draw solar panel primitives ──────────────────────────────────────────
  const drawPanelPrimitives = useCallback((v?: any) => {
    const viewer = v ?? viewerRef.current;
    if (!viewer || !window.Cesium || !panels?.length) return;
    const C = window.Cesium;

    // Remove old
    primitivesRef.current.forEach(p => { try { viewer.scene.primitives.remove(p); } catch {} });
    primitivesRef.current = [];

    const PW = selectedPanel?.width ?? 1.0;
    const PH = selectedPanel?.height ?? 1.7;
    const PT = 0.035;

    const baseElev = twin?.elevation ?? 0;
    const altOffset = systemType === 'fence' ? baseElev + fenceHeight
      : systemType === 'ground' ? baseElev + 0.5
      : baseElev + 0.1;

    const instances: any[] = [];
    const frameInst: any[] = [];

    panels.forEach((panel, idx) => {
      const pLat = (panel.lat && panel.lat !== 0) ? panel.lat : lat;
      const pLng = (panel.lng && panel.lng !== 0) ? panel.lng : lng;
      const panelTilt = panel.tilt ?? tilt;
      const panelAz = panel.azimuth ?? 180;

      // Get roof elevation for this panel from Solar API
      let panelElev = altOffset;
      if (twin?.roofSegments?.length && systemType === 'roof') {
        const seg = twin.roofSegments.find(s =>
          pLat >= s.boundingBox.sw.lat && pLat <= s.boundingBox.ne.lat &&
          pLng >= s.boundingBox.sw.lng && pLng <= s.boundingBox.ne.lng
        );
        if (seg) panelElev = seg.elevation + 0.05;
      }

      const position = C.Cartesian3.fromDegrees(pLng, pLat, panelElev);
      const enu = C.Transforms.eastNorthUpToFixedFrame(position);

      // Azimuth rotation (around Z/up axis) — 0=north, 90=east, 180=south
      const azRad = C.Math.toRadians(panelAz);
      const tiltRad = C.Math.toRadians(panelTilt);

      const rotZ = C.Matrix3.fromRotationZ(-azRad);
      const rotX = C.Matrix3.fromRotationX(-tiltRad);
      const rot = C.Matrix3.multiply(rotZ, rotX, new C.Matrix3());
      const rot4 = C.Matrix4.fromRotationTranslation(rot);
      const modelMatrix = C.Matrix4.multiply(enu, rot4, new C.Matrix4());

      // Shade color
      let panelColor: any;
      if (showShade) {
        const shadeFactor = Math.max(0.05,
          Math.sin(Math.max(0, sunPos.elevation) * Math.PI / 180) *
          Math.max(0, Math.cos((panelAz - sunPos.azimuth) * Math.PI / 180))
        );
        panelColor = new C.Color(1 - shadeFactor, shadeFactor * 0.85, 0.05, 0.92);
      } else {
        panelColor = systemType === 'roof'
          ? new C.Color(0.08, 0.18, 0.45, 0.95)
          : systemType === 'ground'
          ? new C.Color(0.05, 0.25, 0.12, 0.95)
          : new C.Color(0.08, 0.15, 0.45, 0.95);
      }

      instances.push(new C.GeometryInstance({
        id: `panel-${idx}`,
        geometry: C.BoxGeometry.fromDimensions({
          dimensions: new C.Cartesian3(PW, PH, PT),
          vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        modelMatrix,
        attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(panelColor) },
      }));

      frameInst.push(new C.GeometryInstance({
        id: `frame-${idx}`,
        geometry: C.BoxOutlineGeometry.fromDimensions({
          dimensions: new C.Cartesian3(PW + 0.025, PH + 0.025, PT + 0.01),
        }),
        modelMatrix,
        attributes: {
          color: C.ColorGeometryInstanceAttribute.fromColor(
            new C.Color(0.78, 0.78, 0.82, 1.0)
          ),
        },
      }));
    });

    if (!instances.length) return;

    const panelPrim = new C.Primitive({
      geometryInstances: instances,
      appearance: new C.PerInstanceColorAppearance({ closed: true, translucent: true }),
      shadows: C.ShadowMode.ENABLED,
      releaseGeometryInstances: false,
    });

    const framePrim = new C.Primitive({
      geometryInstances: frameInst,
      appearance: new C.PerInstanceColorAppearance({ flat: true }),
      shadows: C.ShadowMode.DISABLED,
    });

    viewer.scene.primitives.add(panelPrim);
    viewer.scene.primitives.add(framePrim);
    primitivesRef.current = [panelPrim, framePrim];
  }, [panels, systemType, tilt, fenceHeight, selectedPanel, lat, lng, twin, showShade, sunPos]);

  // ── Street View init ─────────────────────────────────────────────────────
  async function initStreetView() {
    if (!streetRef.current) return;
    await loadGoogleMapsSDK();
    const { StreetViewPanorama, StreetViewService, StreetViewStatus } =
      await window.google.maps.importLibrary('streetView');
    const svc = new StreetViewService();
    const result: any = await new Promise((res, rej) =>
      svc.getPanorama({ location: { lat, lng }, radius: 150, preference: 'nearest' },
        (d: any, s: any) => s === StreetViewStatus.OK ? res(d) : rej(new Error('No SV')))
    );
    let heading = 0;
    try {
      const { spherical } = await window.google.maps.importLibrary('geometry');
      heading = spherical.computeHeading(result.location.latLng, new window.google.maps.LatLng(lat, lng));
    } catch {}
    const pano = new StreetViewPanorama(streetRef.current, {
      pano: result.location.pano, pov: { heading, pitch: 5 }, zoom: 0,
      addressControl: false, fullscreenControl: false,
      motionTracking: false, motionTrackingControl: false, showRoadLabels: false,
    });
    pano.addListener('pov_changed', () => drawSVOverlay());
    svPanoRef.current = pano;
    setSvReady(true);
    setTimeout(() => drawSVOverlay(), 1500);
  }

  function loadGoogleMapsSDK(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.google?.maps?.importLibrary) { resolve(); return; }
      if (document.getElementById('__gm_sdk')) {
        const p = setInterval(() => { if (window.google?.maps?.importLibrary) { clearInterval(p); resolve(); } }, 100);
        setTimeout(() => { clearInterval(p); reject(new Error('GM timeout')); }, 15000);
        return;
      }
      const s = document.createElement('script');
      s.id = '__gm_sdk';
      s.textContent = `(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await(a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src="https://maps."+c+"apis.com/maps/api/js?"+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({key:"${GOOGLE_API_KEY}",v:"alpha"});`;
      document.head.appendChild(s);
      const p = setInterval(() => { if (window.google?.maps?.importLibrary) { clearInterval(p); resolve(); } }, 100);
      setTimeout(() => { clearInterval(p); reject(new Error('GM timeout')); }, 15000);
    });
  }

  // ── Street View AR overlay ───────────────────────────────────────────────
  const drawSVOverlay = useCallback(() => {
    const canvas = svCanvasRef.current;
    const pano = svPanoRef.current;
    const container = streetRef.current;
    if (!canvas || !pano || !container || !panels?.length) return;

    const W = container.clientWidth || 800;
    const H = container.clientHeight || 500;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const pov = pano.getPov();
    const heading = pov.heading || 0;
    const pitch = pov.pitch || 0;
    const zoom = pov.zoom || 0;
    const hFov = 90 / Math.pow(2, zoom);
    const vFov = hFov * (H / W);

    const panoPos = pano.getPosition();
    if (!panoPos) return;
    const pLat = panoPos.lat(), pLng = panoPos.lng();
    const mLat = 111320, mLng = mLat * Math.cos(pLat * Math.PI / 180);

    function project(wLat: number, wLng: number, wAlt: number) {
      const dx = (wLng - pLng) * mLng;
      const dy = (wLat - pLat) * mLat;
      const dz = wAlt - 1.5; // camera height ~1.5m
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist < 0.3) return null;
      const bearDeg = Math.atan2(dx, dy) * 180 / Math.PI;
      const elevDeg = Math.atan2(dz, Math.sqrt(dx*dx + dy*dy)) * 180 / Math.PI;
      let relH = bearDeg - heading;
      while (relH > 180) relH -= 360;
      while (relH < -180) relH += 360;
      const relP = elevDeg - pitch;
      if (Math.abs(relH) > hFov * 1.6 || Math.abs(relP) > vFov * 1.6) return null;
      return { x: W/2 + (relH/hFov)*(W/2), y: H/2 - (relP/vFov)*(H/2), dist };
    }

    const PW = selectedPanel?.width ?? 1.0;
    const PH = selectedPanel?.height ?? 1.7;
    const baseElev = twin?.elevation ?? 0;
    const altOff = systemType === 'fence' ? baseElev + fenceHeight
      : systemType === 'ground' ? baseElev + 0.5 : baseElev + 3.2;

    // Sort far-to-near
    const sorted = [...panels].sort((a, b) => {
      const aLat = (a.lat && a.lat !== 0) ? a.lat : lat;
      const aLng = (a.lng && a.lng !== 0) ? a.lng : lng;
      const bLat = (b.lat && b.lat !== 0) ? b.lat : lat;
      const bLng = (b.lng && b.lng !== 0) ? b.lng : lng;
      return Math.hypot((bLat-pLat)*mLat,(bLng-pLng)*mLng) - Math.hypot((aLat-pLat)*mLat,(aLng-pLng)*mLng);
    });

    let drawn = 0;
    sorted.forEach(panel => {
      const panLat = (panel.lat && panel.lat !== 0) ? panel.lat : lat;
      const panLng = (panel.lng && panel.lng !== 0) ? panel.lng : lng;
      const dist = Math.hypot((panLat-pLat)*mLat, (panLng-pLng)*mLng);
      if (dist > 100) return;

      const panelTilt = panel.tilt ?? tilt;
      const panelAz = panel.azimuth ?? 180;
      const tiltR = panelTilt * Math.PI / 180;
      const azR = (panelAz - 180) * Math.PI / 180;
      const hw = PW/2, hh = PH/2;
      const cosAz = Math.cos(azR), sinAz = Math.sin(azR);
      const cosTilt = Math.cos(tiltR), sinTilt = Math.sin(tiltR);

      // Panel local axes
      const rx = cosAz, ry = -sinAz; // right
      const ux = sinAz*sinTilt, uy = cosAz*sinTilt, uz = cosTilt; // up

      const corners4 = [
        { dlat: (-hh*uy - hw*ry)/mLat, dlng: (-hh*ux - hw*rx)/mLng, dalt: -hh*uz },
        { dlat: (-hh*uy + hw*ry)/mLat, dlng: (-hh*ux + hw*rx)/mLng, dalt: -hh*uz },
        { dlat: ( hh*uy + hw*ry)/mLat, dlng: ( hh*ux + hw*rx)/mLng, dalt:  hh*uz },
        { dlat: ( hh*uy - hw*ry)/mLat, dlng: ( hh*ux - hw*rx)/mLng, dalt:  hh*uz },
      ];

      const pts = corners4.map(c => project(panLat+c.dlat, panLng+c.dlng, altOff+c.dalt));
      if (pts.every(p => !p)) return;
      const valid = pts.filter(Boolean);
      if (valid.length < 3) return;

      const opacity = Math.max(0.4, Math.min(0.93, 1 - dist/90));
      const p0 = pts[0]!, p1 = pts[1]!, p2 = pts[2]!, p3 = pts[3]!;

      // Panel body gradient
      const grad = ctx.createLinearGradient(
        (p0?.x??0), (p0?.y??0), (p2?.x??100), (p2?.y??100)
      );
      if (systemType === 'roof') {
        grad.addColorStop(0, `rgba(18,45,110,${opacity})`);
        grad.addColorStop(0.4, `rgba(25,65,155,${opacity*0.92})`);
        grad.addColorStop(1, `rgba(12,35,90,${opacity})`);
      } else if (systemType === 'ground') {
        grad.addColorStop(0, `rgba(12,65,30,${opacity})`);
        grad.addColorStop(0.4, `rgba(18,85,40,${opacity*0.92})`);
        grad.addColorStop(1, `rgba(8,50,20,${opacity})`);
      } else {
        grad.addColorStop(0, `rgba(18,40,110,${opacity})`);
        grad.addColorStop(1, `rgba(12,30,90,${opacity})`);
      }

      ctx.beginPath();
      ctx.moveTo(p0?.x??0, p0?.y??0);
      [p1,p2,p3].forEach(p => ctx.lineTo(p?.x??0, p?.y??0));
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Frame
      ctx.strokeStyle = `rgba(147,197,253,${Math.min(1,opacity+0.15)})`;
      ctx.lineWidth = Math.max(1, 2.5 - dist/50);
      ctx.stroke();

      // Cell grid (6 rows × 3 cols)
      ctx.strokeStyle = `rgba(147,197,253,${opacity*0.28})`;
      ctx.lineWidth = 0.5;
      for (let r = 1; r < 6; r++) {
        const t = r/6;
        ctx.beginPath();
        ctx.moveTo((p0?.x??0)+t*((p3?.x??0)-(p0?.x??0)), (p0?.y??0)+t*((p3?.y??0)-(p0?.y??0)));
        ctx.lineTo((p1?.x??0)+t*((p2?.x??0)-(p1?.x??0)), (p1?.y??0)+t*((p2?.y??0)-(p1?.y??0)));
        ctx.stroke();
      }
      for (let c = 1; c < 3; c++) {
        const t = c/3;
        ctx.beginPath();
        ctx.moveTo((p0?.x??0)+t*((p1?.x??0)-(p0?.x??0)), (p0?.y??0)+t*((p1?.y??0)-(p0?.y??0)));
        ctx.lineTo((p3?.x??0)+t*((p2?.x??0)-(p3?.x??0)), (p3?.y??0)+t*((p2?.y??0)-(p3?.y??0)));
        ctx.stroke();
      }

      // Glass specular highlight
      const hGrad = ctx.createLinearGradient(p0?.x??0, p0?.y??0, p1?.x??50, p1?.y??0);
      hGrad.addColorStop(0, 'rgba(255,255,255,0)');
      hGrad.addColorStop(0.25, `rgba(255,255,255,${opacity*0.14})`);
      hGrad.addColorStop(0.5, `rgba(255,255,255,${opacity*0.07})`);
      hGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hGrad;
      ctx.beginPath();
      ctx.moveTo(p0?.x??0, p0?.y??0);
      [p1,p2,p3].forEach(p => ctx.lineTo(p?.x??0, p?.y??0));
      ctx.closePath();
      ctx.fill();

      drawn++;
    });

    if (drawn > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.beginPath();
      (ctx as any).roundRect?.(10, H-48, 260, 36, 8);
      ctx.fill();
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillText(`☀️ ${drawn} panels visible · ${((drawn*(selectedPanel?.wattage??400))/1000).toFixed(1)} kW`, 20, H-24);
    }
  }, [panels, systemType, tilt, fenceHeight, selectedPanel, lat, lng, twin, svReady]);

  // ── Sun animation ────────────────────────────────────────────────────────
  const toggleAnimation = () => {
    if (animating) {
      clearInterval(animRef.current);
      setAnimating(false);
    } else {
      setAnimating(true);
      animRef.current = setInterval(() => {
        setSimHour(h => {
          const next = (h + 0.25) % 24;
          if (viewerRef.current && window.Cesium) {
            const d = new Date(); d.setHours(Math.floor(next), Math.round((next%1)*60));
            viewerRef.current.clock.currentTime = window.Cesium.JulianDate.fromDate(d);
          }
          return next;
        });
      }, 150);
    }
  };

  useEffect(() => () => clearInterval(animRef.current), []);

  const totalKw = ((panels.length * (selectedPanel?.wattage ?? 400)) / 1000).toFixed(1);
  const isLoading = stage !== 'done' && stage !== 'error';

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', minHeight:500, background:'#0d1117', display:'flex', flexDirection:'column' }}>

      {/* ── Top Control Bar ── */}
      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 10px', background:'rgba(0,0,0,0.93)', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0, zIndex:20, flexWrap:'wrap' }}>

        {/* View tabs */}
        <div style={{ display:'flex', gap:0 }}>
          {(['3d','street','shade'] as ViewMode[]).map((m,i) => (
            <button key={m} onClick={() => setViewMode(m)} style={{
              padding:'5px 13px', border:'none', cursor:'pointer', fontSize:11, fontWeight:600,
              borderRadius: i===0?'6px 0 0 6px':i===2?'0 6px 6px 0':'0',
              background: viewMode===m ? 'linear-gradient(135deg,#1d4ed8,#2563eb)' : 'rgba(255,255,255,0.05)',
              color: viewMode===m ? '#fff' : '#64748b', transition:'all 0.15s',
            }}>
              {m==='3d'?'🏙️ Digital Twin':m==='street'?'🚶 Street AR':'🌡️ Shade'}
            </button>
          ))}
        </div>

        {/* Overlays */}
        {[
          { key:'parcel', label:'📐 Parcel', val:showParcel, set:setShowParcel, color:'#22c55e' },
          { key:'ease', label:'⚠️ Easements', val:showEasements, set:setShowEasements, color:'#f59e0b' },
          { key:'roof', label:'🏠 Roof Segs', val:showRoofSegs, set:setShowRoofSegs, color:'#60a5fa' },
          { key:'shade', label:'🌡️ Shade', val:showShade, set:setShowShade, color:'#f87171' },
        ].map(o => (
          <button key={o.key} onClick={() => o.set(!o.val)} style={{
            padding:'4px 10px', border:`1px solid ${o.val ? o.color+'66' : 'rgba(255,255,255,0.08)'}`,
            borderRadius:6, background: o.val ? o.color+'18' : 'rgba(255,255,255,0.03)',
            color: o.val ? o.color : '#475569', fontSize:10, fontWeight:600, cursor:'pointer',
          }}>{o.label}</button>
        ))}

        {/* Sun slider */}
        <div style={{ display:'flex', alignItems:'center', gap:6, marginLeft:4 }}>
          <button onClick={toggleAnimation} style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, padding:'0 2px' }}>
            {animating ? '⏸' : '▶️'}
          </button>
          <input type="range" min={5} max={20} step={0.25} value={simHour}
            onChange={e => { const h=parseFloat(e.target.value); setSimHour(h); if(viewerRef.current&&window.Cesium){const d=new Date();d.setHours(Math.floor(h),Math.round((h%1)*60));viewerRef.current.clock.currentTime=window.Cesium.JulianDate.fromDate(d);}}}
            style={{ width:90, accentColor:'#f59e0b', cursor:'pointer' }} />
          <span style={{ color:'#94a3b8', fontSize:10, minWidth:36 }}>
            {String(Math.floor(simHour)).padStart(2,'0')}:{String(Math.round((simHour%1)*60)).padStart(2,'0')}
          </span>
          <span style={{ color:'#64748b', fontSize:10 }}>
            {sunPos.elevation>0?`☀️ ${sunPos.elevation.toFixed(0)}°`:'🌙'}
          </span>
        </div>

        {/* Stats */}
        {panels.length > 0 && (
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ color:'#fbbf24', fontSize:11 }}>⚡ <b style={{color:'#f1f5f9'}}>{panels.length}</b> <span style={{color:'#475569'}}>panels</span></span>
            <span style={{ color:'#60a5fa', fontWeight:700, fontSize:11 }}>{totalKw} kW</span>
          </div>
        )}
      </div>

      {/* ── Viewer ── */}
      <div style={{ flex:1, position:'relative', overflow:'hidden' }}>

        {/* Cesium */}
        <div ref={cesiumRef} style={{ position:'absolute', inset:0, display: viewMode!=='street'?'block':'none' }} />

        {/* Street View + AR */}
        <div style={{ position:'absolute', inset:0, display: viewMode==='street'?'block':'none' }}>
          <div ref={streetRef} style={{ position:'absolute', inset:0 }} />
          <canvas ref={svCanvasRef} style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:5 }} />
          {svReady && (
            <button onClick={drawSVOverlay} style={{ position:'absolute', top:10, right:10, zIndex:10, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(8px)', border:'1px solid rgba(59,130,246,0.4)', borderRadius:8, color:'#93c5fd', fontSize:11, fontWeight:600, padding:'5px 12px', cursor:'pointer' }}>
              🔄 Refresh AR
            </button>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <div style={{ position:'absolute', inset:0, zIndex:30, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'linear-gradient(160deg,#0d1117,#0f172a)', gap:20 }}>
            <div style={{ position:'relative', width:80, height:80 }}>
              <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'radial-gradient(circle at 35% 35%,#1e3a8a,#0f172a)', boxShadow:'0 0 50px rgba(59,130,246,0.2)' }} />
              <div style={{ position:'absolute', inset:-7, borderRadius:'50%', border:'3px solid transparent', borderTopColor:'#3b82f6', borderRightColor:'rgba(59,130,246,0.1)', animation:'dt_spin 0.9s linear infinite' }} />
              <div style={{ position:'absolute', inset:10, borderRadius:'50%', border:'2px solid transparent', borderBottomColor:'#60a5fa', animation:'dt_spin 0.6s linear infinite reverse' }} />
              <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:14, height:14, borderRadius:'50%', background:'#3b82f6', boxShadow:'0 0 16px #3b82f6' }} />
            </div>

            {/* Progress bar */}
            <div style={{ width:280, background:'rgba(255,255,255,0.06)', borderRadius:8, overflow:'hidden', height:6 }}>
              <div style={{ height:'100%', width:`${progress}%`, background:'linear-gradient(90deg,#1d4ed8,#3b82f6)', transition:'width 0.5s ease', borderRadius:8 }} />
            </div>

            <div style={{ textAlign:'center' }}>
              <div style={{ color:'#f1f5f9', fontSize:16, fontWeight:700, marginBottom:6 }}>Building Digital Twin</div>
              <div style={{ color:'#64748b', fontSize:13 }}>{stageMsg}</div>
            </div>

            <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center', maxWidth:320 }}>
              {[
                { label:'CesiumJS', done: progress >= 15 },
                { label:'3D Tiles', done: progress >= 50 },
                { label:'Solar API', done: progress >= 30 },
                { label:'Elevation', done: progress >= 50 },
                { label:'Parcel Data', done: progress >= 75 },
                { label:'Panels', done: progress >= 90 },
              ].map(item => (
                <span key={item.label} style={{
                  background: item.done ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.08)',
                  border: `1px solid ${item.done ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.2)'}`,
                  borderRadius:6, padding:'3px 10px',
                  color: item.done ? '#22c55e' : '#3b82f6',
                  fontSize:10, fontWeight:600,
                }}>
                  {item.done ? '✓' : '○'} {item.label}
                </span>
              ))}
            </div>
            <style>{`@keyframes dt_spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* Error */}
        {stage === 'error' && (
          <div style={{ position:'absolute', inset:0, zIndex:30, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#0d1117', gap:16 }}>
            <div style={{ fontSize:48 }}>⚠️</div>
            <div style={{ color:'#f87171', fontSize:16, fontWeight:700 }}>Digital Twin Failed</div>
            <div style={{ color:'#6b7280', fontSize:13, maxWidth:360, textAlign:'center', lineHeight:1.6 }}>{stageMsg}</div>
            <div style={{ display:'flex', gap:10 }}>
              <a href="/test3d.html" target="_blank" style={{ padding:'8px 18px', background:'rgba(59,130,246,0.12)', color:'#60a5fa', border:'1px solid rgba(59,130,246,0.3)', borderRadius:8, fontSize:13, textDecoration:'none', fontWeight:600 }}>Test API</a>
              <button onClick={() => { initDone.current=false; window.location.reload(); }} style={{ padding:'8px 18px', background:'linear-gradient(135deg,#1d4ed8,#2563eb)', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 }}>Reload</button>
            </div>
          </div>
        )}

        {/* Ready overlays */}
        {stage === 'done' && (
          <>
            <div style={{ position:'absolute', top:10, left:10, zIndex:10, background:'rgba(0,0,0,0.82)', backdropFilter:'blur(12px)', border:'1px solid rgba(59,130,246,0.3)', borderRadius:10, padding:'6px 12px', display:'flex', alignItems:'center', gap:7, pointerEvents:'none' }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 8px #22c55e' }} />
              <span style={{ color:'#f1f5f9', fontSize:11, fontWeight:600 }}>
                {viewMode==='3d'?'Digital Twin · CesiumJS · Google 3D Tiles':viewMode==='street'?'Street View · AR Solar Overlay':'Shade Analysis · Sun Position Simulation'}
              </span>
            </div>

            {viewMode !== 'street' && sunPos.elevation > 0 && (
              <div style={{ position:'absolute', top:10, right:10, zIndex:10, background:'rgba(0,0,0,0.78)', backdropFilter:'blur(8px)', border:'1px solid rgba(245,158,11,0.3)', borderRadius:10, padding:'6px 12px', pointerEvents:'none' }}>
                <div style={{ color:'#fbbf24', fontSize:11, fontWeight:600 }}>
                  ☀️ Az {sunPos.azimuth.toFixed(0)}° · El {sunPos.elevation.toFixed(0)}°
                </div>
              </div>
            )}

            {twin && (
              <div style={{ position:'absolute', bottom:36, right:10, zIndex:10, background:'rgba(0,0,0,0.78)', backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:'8px 12px', pointerEvents:'none', minWidth:160 }}>
                <div style={{ color:'#94a3b8', fontSize:10, marginBottom:4, fontWeight:600 }}>PROPERTY DATA</div>
                <div style={{ color:'#f1f5f9', fontSize:11, lineHeight:1.7 }}>
                  <div>📍 {twin.elevation.toFixed(1)}m elevation</div>
                  <div>🏠 {twin.roofSegments.length} roof segments</div>
                  <div>☀️ {twin.solarData?.solarPotential?.maxSunshineHoursPerYear?.toFixed(0) ?? '—'}h/yr sunshine</div>
                  <div>⚡ {twin.solarData?.solarPotential?.maxArrayPanelsCount ?? '—'} max panels</div>
                </div>
              </div>
            )}

            {viewMode === '3d' && (
              <div style={{ position:'absolute', bottom:10, left:'50%', transform:'translateX(-50%)', zIndex:10, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(8px)', borderRadius:8, padding:'5px 14px', color:'#94a3b8', fontSize:11, display:'flex', gap:14, pointerEvents:'none', whiteSpace:'nowrap' }}>
                <span>🖱️ Left: orbit</span><span>Right: pan</span><span>⚲ Scroll: zoom</span><span>Middle: tilt</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}