'use client';
import React, { useEffect, useRef, useState } from 'react';
import type { PlacedPanel, SolarPanel, SystemType } from '@/types';

interface Props {
  panels: PlacedPanel[];
  systemType: SystemType;
  tilt: number;
  fenceHeight: number;
  selectedPanel: SolarPanel;
  mapCenter?: { lat: number; lng: number };
  mapZoom?: number;
}

export default function ThreeViewer({
  panels, systemType, tilt, fenceHeight, selectedPanel,
  mapCenter, mapZoom = 19
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [tileStatus, setTileStatus] = useState<'loading' | 'ok' | 'fallback'>('loading');

  useEffect(() => {
    if (!mountRef.current) return;
    let renderer: any, animId: number, cleanupFn: (() => void) | undefined;

    const init = async () => {
      try {
        const THREE = await import('three');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');

        const container = mountRef.current!;
        const W = container.clientWidth || 800;
        const H = container.clientHeight || 600;

        // ── Scene ──────────────────────────────────────────────────────────
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87ceeb);
        scene.fog = new THREE.FogExp2(0x87ceeb, 0.004);

        // ── Camera ─────────────────────────────────────────────────────────
        const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 2000);
        camera.position.set(0, 25, 40);
        camera.lookAt(0, 0, 0);

        // ── Renderer ───────────────────────────────────────────────────────
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setSize(W, H);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // CRITICAL: Use sRGB output for correct colors (fixes greenish tint)
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        container.appendChild(renderer.domElement);

        // ── Controls ───────────────────────────────────────────────────────
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 2;
        controls.maxDistance = 500;
        controls.maxPolarAngle = Math.PI / 2.05;
        controls.target.set(0, 0, 0);

        // ── Lighting ───────────────────────────────────────────────────────
        scene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const sun = new THREE.DirectionalLight(0xfff8e7, 2.5);
        sun.position.set(40, 80, 30);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 4096;
        sun.shadow.mapSize.height = 4096;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 500;
        sun.shadow.camera.left = -150;
        sun.shadow.camera.right = 150;
        sun.shadow.camera.top = 150;
        sun.shadow.camera.bottom = -150;
        sun.shadow.bias = -0.0005;
        scene.add(sun);
        scene.add(new THREE.HemisphereLight(0xb0d8ff, 0x4a7c3f, 0.6));

        // ── Satellite Ground ───────────────────────────────────────────────
        const groundSize = await buildSatelliteGround(THREE, scene, mapCenter, mapZoom, setTileStatus);

        // ── Materials ──────────────────────────────────────────────────────
        const panelFrontMat = new THREE.MeshPhongMaterial({
          color: systemType === 'roof' ? 0x1a3a6a :
                 systemType === 'ground' ? 0x0d3d2a : 0x1a2a5a,
          shininess: 120,
          specular: new THREE.Color(0x3355aa),
        });
        const panelBackMat = new THREE.MeshPhongMaterial({ color: 0x2a2a3a, shininess: 20 });
        const frameMat = new THREE.MeshPhongMaterial({ color: 0xc0c0c0, shininess: 80 });
        const postMat = new THREE.MeshPhongMaterial({ color: 0x888899, shininess: 40 });
        const rackMat = new THREE.MeshPhongMaterial({ color: 0x999999, shininess: 50 });

        const PW = selectedPanel.width;
        const PH = selectedPanel.height;

        if (panels.length === 0) {
          buildDemoLayout(THREE, scene, systemType, tilt, fenceHeight, PW, PH,
            panelFrontMat, panelBackMat, frameMat, postMat, rackMat, groundSize);
        } else {
          buildRealLayout(THREE, scene, panels, systemType, tilt, fenceHeight, PW, PH,
            panelFrontMat, panelBackMat, frameMat, postMat, rackMat, mapCenter);
        }

        setLoaded(true);

        // ── Resize ─────────────────────────────────────────────────────────
        const onResize = () => {
          if (!container || !renderer) return;
          const w = container.clientWidth;
          const h = container.clientHeight;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        };
        window.addEventListener('resize', onResize);

        // ── Animate ────────────────────────────────────────────────────────
        const animate = () => {
          animId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();

        cleanupFn = () => {
          window.removeEventListener('resize', onResize);
          cancelAnimationFrame(animId);
          controls.dispose();
          renderer.dispose();
          if (container.contains(renderer.domElement)) {
            container.removeChild(renderer.domElement);
          }
        };
      } catch (e: any) {
        console.error('3D error:', e);
        setError(e.message || 'Failed to load 3D viewer');
      }
    };

    init();
    return () => { cleanupFn?.(); };
  }, [panels, systemType, tilt, fenceHeight, selectedPanel, mapCenter, mapZoom]);

  const typeLabel = systemType === 'roof' ? '🏠 Roof Mount' :
                   systemType === 'ground' ? '🌱 Ground Mount' : '⚡ Sol Fence';

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full" />
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
          <div className="text-center">
            <div className="spinner w-8 h-8 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Loading 3D view...</p>
            <p className="text-slate-600 text-xs mt-1">Fetching satellite imagery</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
          <p className="text-red-400 text-sm">3D Error: {error}</p>
        </div>
      )}
      {loaded && (
        <>
          <div className="absolute bottom-4 left-4 glass rounded-lg px-3 py-2 text-xs text-slate-400 pointer-events-none">
            🖱 Drag to rotate • Scroll to zoom • Right-drag to pan
          </div>
          <div className="absolute top-4 right-4 glass rounded-lg px-3 py-2 text-xs text-slate-300 pointer-events-none">
            {typeLabel} — 3D View
          </div>
          {tileStatus === 'ok' && (
            <div className="absolute top-4 left-4 glass rounded-lg px-2 py-1 text-xs text-emerald-400 pointer-events-none">
              🛰 Satellite
            </div>
          )}
          {tileStatus === 'fallback' && (
            <div className="absolute top-4 left-4 glass rounded-lg px-2 py-1 text-xs text-amber-400 pointer-events-none">
              🗺 Terrain
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Satellite ground plane ────────────────────────────────────────────────
async function buildSatelliteGround(
  THREE: any, scene: any,
  mapCenter: { lat: number; lng: number } | undefined,
  zoom: number,
  setTileStatus: (s: 'loading' | 'ok' | 'fallback') => void
): Promise<number> {
  const fetchZoom = Math.min(zoom, 19);
  const tileSize = 256;
  const GRID = 7; // 7×7 for better coverage
  const half = Math.floor(GRID / 2);

  const lat = mapCenter?.lat ?? 38.89;
  const mpp = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, fetchZoom);
  const tileMeters = tileSize * mpp;
  const groundSize = tileMeters * GRID;

  const makePlainGround = () => {
    // Realistic terrain with subtle color variation
    const geo = new THREE.PlaneGeometry(groundSize, groundSize, 20, 20);
    const mat = new THREE.MeshLambertMaterial({ color: 0x4a7c3f });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.05;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // Subtle grid
    const grid = new THREE.GridHelper(groundSize, 30, 0x000000, 0x000000);
    (grid.material as any).opacity = 0.08;
    (grid.material as any).transparent = true;
    scene.add(grid);
    setTileStatus('fallback');
    return groundSize;
  };

  if (!mapCenter) { makePlainGround(); return groundSize; }

  // Store mapCenter as scene origin
  scene.userData.mapCenterLat = mapCenter.lat;
  scene.userData.mapCenterLng = mapCenter.lng;
  scene.userData.mpp = mpp;

  try {
    const sinLat = Math.sin(mapCenter.lat * Math.PI / 180);
    const centerTX = Math.floor(((mapCenter.lng + 180) / 360) * Math.pow(2, fetchZoom));
    const centerTY = Math.floor((0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * Math.pow(2, fetchZoom));

    const canvasSize = tileSize * GRID;
    const offscreen = document.createElement('canvas');
    offscreen.width = canvasSize;
    offscreen.height = canvasSize;
    const ctx = offscreen.getContext('2d')!;
    ctx.fillStyle = '#4a7c3f';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    const loadImg = (url: string): Promise<HTMLImageElement | null> =>
      new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });

    let tilesLoaded = 0;
    const promises: Promise<void>[] = [];
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const tx = centerTX + dx;
        const ty = centerTY + dy;
        const url = `/api/tile?z=${fetchZoom}&x=${tx}&y=${ty}`;
        const px = (dx + half) * tileSize;
        const py = (dy + half) * tileSize;
        promises.push(
          loadImg(url).then(img => {
            if (img && img.naturalWidth > 0) {
              ctx.drawImage(img, px, py, tileSize, tileSize);
              tilesLoaded++;
            }
          })
        );
      }
    }
    await Promise.all(promises);

    if (tilesLoaded === 0) {
      makePlainGround();
      return groundSize;
    }

    // CRITICAL FIX: Use correct color space for satellite imagery
    const texture = new THREE.CanvasTexture(offscreen);
    texture.colorSpace = THREE.SRGBColorSpace; // Prevents greenish tint!
    texture.needsUpdate = true;
    texture.anisotropy = 16; // Sharper at angles

    // Calculate precise pixel offset of mapCenter within center tile
    const n = Math.pow(2, fetchZoom);
    const centerTileOriginLng = (centerTX / n) * 360 - 180;
    const centerTileOriginLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * centerTY / n))) * 180 / Math.PI;
    const nextTileOriginLng = ((centerTX + 1) / n) * 360 - 180;
    const nextTileOriginLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (centerTY + 1) / n))) * 180 / Math.PI;

    const fracX = (mapCenter.lng - centerTileOriginLng) / (nextTileOriginLng - centerTileOriginLng);
    const fracY = (mapCenter.lat - centerTileOriginLat) / (nextTileOriginLat - centerTileOriginLat);

    // Offset so mapCenter aligns with scene origin (0,0)
    const offsetX = (0.5 - fracX) * tileMeters;
    const offsetZ = (fracY - 0.5) * tileMeters;

    const geo = new THREE.PlaneGeometry(groundSize, groundSize);
    const mat = new THREE.MeshLambertMaterial({ map: texture });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(offsetX, -0.05, offsetZ);
    mesh.receiveShadow = true;
    scene.add(mesh);

    setTileStatus('ok');
    return groundSize;

  } catch (e) {
    console.warn('Satellite texture failed:', e);
    makePlainGround();
    return groundSize;
  }
}

// ─── Panel mesh builder ────────────────────────────────────────────────────
function makePanelGroup(THREE: any, PW: number, PH: number, frontMat: any, backMat: any, frameMat: any, vertical = false) {
  const group = new THREE.Group();
  const thickness = 0.04;

  if (vertical) {
    // Fence panel: stands upright in XY plane
    const frontGeo = new THREE.BoxGeometry(PW - 0.02, PH - 0.02, thickness);
    const front = new THREE.Mesh(frontGeo, frontMat);
    front.castShadow = true;
    group.add(front);

    const frameGeo = new THREE.BoxGeometry(PW, PH, thickness + 0.01);
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.z = -0.005;
    group.add(frame);

    const backGeo = new THREE.BoxGeometry(PW - 0.02, PH - 0.02, thickness * 0.5);
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.z = -thickness * 0.75;
    group.add(back);

    addCellLinesVertical(THREE, group, PW, PH);
  } else {
    // Flat/tilted panel: XZ plane
    const panelGeo = new THREE.BoxGeometry(PW - 0.02, thickness, PH - 0.02);
    const panel = new THREE.Mesh(panelGeo, frontMat);
    panel.castShadow = true;
    panel.receiveShadow = true;
    group.add(panel);

    const frameGeo = new THREE.BoxGeometry(PW, thickness + 0.01, PH);
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = -0.005;
    group.add(frame);

    addCellLines(THREE, group, PW, PH);
  }

  return group;
}

// ─── Coordinate conversion ─────────────────────────────────────────────────
function latLngToLocal(lat: number, lng: number, originLat: number, originLng: number) {
  const MPD_LAT = 111320;
  const MPD_LNG = MPD_LAT * Math.cos(originLat * Math.PI / 180);
  return {
    x: (lng - originLng) * MPD_LNG,
    z: -(lat - originLat) * MPD_LAT, // north = -Z
  };
}

// ─── Real layout from placed panels ───────────────────────────────────────
function buildRealLayout(
  THREE: any, scene: any, panels: any[], systemType: SystemType,
  tilt: number, fenceHeight: number, PW: number, PH: number,
  frontMat: any, backMat: any, frameMat: any, postMat: any, rackMat: any,
  mapCenter?: { lat: number; lng: number }
) {
  if (panels.length === 0) return;

  // Use mapCenter as origin (same as satellite ground plane)
  const lats = panels.map((p: any) => p.lat);
  const lngs = panels.map((p: any) => p.lng);
  const fallbackLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const fallbackLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const originLat = mapCenter?.lat ?? fallbackLat;
  const originLng = mapCenter?.lng ?? fallbackLng;

  if (systemType === 'fence') {
    buildFencePanels(THREE, scene, panels, fenceHeight, PW, PH,
      frontMat, backMat, frameMat, postMat, rackMat, originLat, originLng);
  } else {
    buildFlatPanels(THREE, scene, panels, systemType, tilt, PW, PH,
      frontMat, backMat, frameMat, postMat, rackMat, originLat, originLng);
  }
}

// ─── Fence panels: perfectly aligned to drawn fence line ──────────────────
function buildFencePanels(
  THREE: any, scene: any, panels: any[], fenceHeight: number,
  PW: number, PH: number, frontMat: any, backMat: any, frameMat: any,
  postMat: any, rackMat: any, originLat: number, originLng: number
) {
  // Group panels by row (each row = one fence segment)
  const rowMap = new Map<number, any[]>();
  panels.forEach((p: any) => {
    const row = p.row ?? 0;
    if (!rowMap.has(row)) rowMap.set(row, []);
    rowMap.get(row)!.push(p);
  });

  rowMap.forEach((rowPanels) => {
    if (rowPanels.length === 0) return;
    // Sort by column
    rowPanels.sort((a: any, b: any) => (a.col ?? 0) - (b.col ?? 0));

    // Convert all panel positions to local coords
    const localPositions = rowPanels.map((p: any) => ({
      ...latLngToLocal(p.lat, p.lng, originLat, originLng),
      panel: p
    }));

    // Compute fence segment direction from first to last panel position
    let fenceAngleY = 0;
    if (localPositions.length >= 2) {
      const first = localPositions[0];
      const last = localPositions[localPositions.length - 1];
      const dx = last.x - first.x;
      const dz = last.z - first.z;
      // Angle the fence LINE runs (in XZ plane)
      const lineAngle = Math.atan2(dx, dz);
      // Panels face PERPENDICULAR to fence line
      fenceAngleY = lineAngle + Math.PI / 2;
    }

    // Place each panel at its exact GPS position
    localPositions.forEach(({ x, z }) => {
      const group = makePanelGroup(THREE, PW, PH, frontMat, backMat, frameMat, true);
      group.rotation.y = fenceAngleY;
      group.position.set(x, fenceHeight / 2, z);
      scene.add(group);
    });

    // Posts at segment ends + every 4 panels
    const postH = fenceHeight + 0.35;
    const postGeo = new THREE.BoxGeometry(0.08, postH, 0.08);
    const postPositions = [0, localPositions.length - 1];
    for (let i = 4; i < localPositions.length - 1; i += 4) postPositions.push(i);
    Array.from(new Set(postPositions)).forEach(idx => {
      const { x, z } = localPositions[idx];
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, postH / 2, z);
      post.castShadow = true;
      scene.add(post);
    });

    // Rails along the full segment
    if (localPositions.length >= 2) {
      const first = localPositions[0];
      const last = localPositions[localPositions.length - 1];
      const dx = last.x - first.x;
      const dz = last.z - first.z;
      const segLen = Math.sqrt(dx * dx + dz * dz) + PW;
      const midX = (first.x + last.x) / 2;
      const midZ = (first.z + last.z) / 2;

      for (const yOff of [0.12, fenceHeight - 0.12]) {
        const railGeo = new THREE.BoxGeometry(segLen, 0.06, 0.06);
        const rail = new THREE.Mesh(railGeo, rackMat);
        rail.rotation.y = fenceAngleY;
        rail.position.set(midX, yOff, midZ);
        scene.add(rail);
      }
    }
  });
}

// ─── Roof/Ground panels ────────────────────────────────────────────────────
function buildFlatPanels(
  THREE: any, scene: any, panels: any[], systemType: SystemType,
  tilt: number, PW: number, PH: number, frontMat: any, backMat: any,
  frameMat: any, postMat: any, rackMat: any, originLat: number, originLng: number
) {
  const tiltRad = (tilt * Math.PI) / 180;
  const azimuthDeg = panels[0]?.azimuth ?? 180;
  const azimuthRad = ((azimuthDeg - 180) * Math.PI) / 180;
  const baseH = systemType === 'ground'
    ? 0.7 + Math.sin(tiltRad) * PH / 2
    : 3.5 + Math.sin(tiltRad) * PH / 2;

  panels.forEach((p: any) => {
    const { x, z } = latLngToLocal(p.lat, p.lng, originLat, originLng);
    const group = makePanelGroup(THREE, PW, PH, frontMat, backMat, frameMat, false);
    group.rotation.order = 'YXZ';
    group.rotation.y = azimuthRad;
    group.rotation.x = -tiltRad;
    group.position.set(x, baseH, z);
    scene.add(group);
  });

  // Ground mount racking
  if (systemType === 'ground') {
    const rowMap = new Map<number, any[]>();
    panels.forEach((p: any) => {
      const row = p.row ?? 0;
      if (!rowMap.has(row)) rowMap.set(row, []);
      rowMap.get(row)!.push(p);
    });

    rowMap.forEach((rowPanels) => {
      const positions = rowPanels.map((p: any) => latLngToLocal(p.lat, p.lng, originLat, originLng));
      const xs = positions.map(p => p.x);
      const zs = positions.map(p => p.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const avgZ = zs.reduce((a, b) => a + b, 0) / zs.length;
      const railLen = maxX - minX + PW + 0.3;
      const midX = (minX + maxX) / 2;

      const railGeo = new THREE.BoxGeometry(railLen, 0.06, 0.06);
      const rail = new THREE.Mesh(railGeo, rackMat);
      rail.position.set(midX, 0.7, avgZ);
      scene.add(rail);

      for (const px of [minX - PW / 2, maxX + PW / 2]) {
        const postH = 1.2;
        const postGeo = new THREE.CylinderGeometry(0.04, 0.05, postH, 8);
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(px, postH / 2, avgZ);
        post.castShadow = true;
        scene.add(post);
      }
    });
  }
}

// ─── Demo layout ───────────────────────────────────────────────────────────
function buildDemoLayout(
  THREE: any, scene: any, systemType: SystemType,
  tilt: number, fenceHeight: number, PW: number, PH: number,
  frontMat: any, backMat: any, frameMat: any, postMat: any, rackMat: any,
  groundSize: number
) {
  const scale = Math.min(groundSize / 60, 3);

  if (systemType === 'fence') {
    const count = 10;
    const spacing = 0.04;
    const totalW = count * (PW + spacing);

    for (let i = 0; i < count; i++) {
      const group = makePanelGroup(THREE, PW, PH, frontMat, backMat, frameMat, true);
      group.position.set(-totalW / 2 + i * (PW + spacing) + PW / 2, fenceHeight / 2, 0);
      scene.add(group);
    }

    const postH = fenceHeight + 0.35;
    for (let i = 0; i <= count; i += 2) {
      const postGeo = new THREE.BoxGeometry(0.08, postH, 0.08);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(-totalW / 2 + i * (PW + spacing), postH / 2, 0);
      post.castShadow = true;
      scene.add(post);
    }

    for (const yOff of [0.12, fenceHeight - 0.12]) {
      const railGeo = new THREE.BoxGeometry(totalW + 0.2, 0.06, 0.06);
      const rail = new THREE.Mesh(railGeo, rackMat);
      rail.position.set(0, yOff, 0);
      scene.add(rail);
    }

  } else if (systemType === 'ground') {
    const tiltRad = (tilt * Math.PI) / 180;
    const rows = 3, cols = 6;
    const rowSpacing = PH * Math.cos(tiltRad) * 2.5 + 1.5;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const group = makePanelGroup(THREE, PW, PH, frontMat, backMat, frameMat, false);
        group.rotation.x = -tiltRad;
        const baseH = 0.7 + Math.sin(tiltRad) * PH / 2;
        group.position.set(
          (c - (cols - 1) / 2) * (PW + 0.05),
          baseH,
          (r - (rows - 1) / 2) * rowSpacing
        );
        scene.add(group);
      }
    }

  } else {
    // Roof demo
    const tiltRad = (tilt * Math.PI) / 180;
    const cols = 5, rows = 3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const group = makePanelGroup(THREE, PW, PH, frontMat, backMat, frameMat, false);
        group.rotation.x = -tiltRad;
        const baseH = 3.5 + Math.sin(tiltRad) * PH / 2;
        group.position.set(
          (c - (cols - 1) / 2) * (PW + 0.05),
          baseH,
          (r - (rows - 1) / 2) * (PH * Math.cos(tiltRad) + 0.05)
        );
        scene.add(group);
      }
    }
  }
}

// ─── Cell line helpers ─────────────────────────────────────────────────────
function addCellLines(THREE: any, group: any, PW: number, PH: number) {
  const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15 });
  const cols = 6, rows = 10;
  for (let c = 1; c < cols; c++) {
    const x = -PW / 2 + (PW / cols) * c;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.025, -PH / 2),
      new THREE.Vector3(x, 0.025, PH / 2),
    ]);
    group.add(new THREE.Line(geo, mat));
  }
  for (let r = 1; r < rows; r++) {
    const z = -PH / 2 + (PH / rows) * r;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-PW / 2, 0.025, z),
      new THREE.Vector3(PW / 2, 0.025, z),
    ]);
    group.add(new THREE.Line(geo, mat));
  }
}

function addCellLinesVertical(THREE: any, group: any, PW: number, PH: number) {
  const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15 });
  const cols = 6, rows = 10;
  for (let c = 1; c < cols; c++) {
    const x = -PW / 2 + (PW / cols) * c;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, -PH / 2, 0.025),
      new THREE.Vector3(x, PH / 2, 0.025),
    ]);
    group.add(new THREE.Line(geo, mat));
  }
  for (let r = 1; r < rows; r++) {
    const y = -PH / 2 + (PH / rows) * r;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-PW / 2, y, 0.025),
      new THREE.Vector3(PW / 2, y, 0.025),
    ]);
    group.add(new THREE.Line(geo, mat));
  }
}