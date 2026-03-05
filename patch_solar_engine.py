#!/usr/bin/env python3
"""
patch_solar_engine.py — Patch SolarEngine3D.tsx with GPU-instanced rendering
Replaces viewer.entities.add() per-panel with PanelPrimitiveRenderer (ONE draw call).
Also wires up LOD system and sun vector cache.
"""

import re, sys, shutil
from pathlib import Path

SRC = Path("components/3d/SolarEngine3D.tsx")
BAK = Path("components/3d/SolarEngine3D.tsx.bak")

if not SRC.exists():
    print(f"ERROR: {SRC} not found"); sys.exit(1)

# Backup
shutil.copy(SRC, BAK)
print(f"Backed up to {BAK}")

content = SRC.read_text(encoding="utf-8")
original_len = len(content)

changes = []

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 1: Add imports after existing imports
# ─────────────────────────────────────────────────────────────────────────────
OLD_IMPORTS = "import type { PlacedPanel } from '@/types';"
NEW_IMPORTS = """import type { PlacedPanel } from '@/types';
import { PanelPrimitiveRenderer, type PanelRenderData } from '@/lib/panelPrimitiveRenderer';
import { LODManager } from '@/lib/panelLOD';
import { batchComputeShadeFactors, precomputeDaySunPositions, clearSunCache } from '@/lib/sunVectorCache';"""

if OLD_IMPORTS in content:
    content = content.replace(OLD_IMPORTS, NEW_IMPORTS, 1)
    changes.append("✅ PATCH 1: Added imports for PanelPrimitiveRenderer, LODManager, sunVectorCache")
else:
    print("⚠️  PATCH 1: import target not found — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 2: Replace panelMapRef with primitiveRendererRef + lodManagerRef
# ─────────────────────────────────────────────────────────────────────────────
OLD_PANEL_MAP_REF = "  const panelMapRef = useRef<Map<string, any>>(new Map());"
NEW_PANEL_MAP_REF = """  // GPU-instanced renderer — replaces panelMapRef (one entity per panel → one draw call for all)
  const primitiveRendererRef = useRef<PanelPrimitiveRenderer | null>(null);
  const lodManagerRef        = useRef<LODManager | null>(null);"""

if OLD_PANEL_MAP_REF in content:
    content = content.replace(OLD_PANEL_MAP_REF, NEW_PANEL_MAP_REF, 1)
    changes.append("✅ PATCH 2: Replaced panelMapRef with primitiveRendererRef + lodManagerRef")
else:
    print("⚠️  PATCH 2: panelMapRef declaration not found — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 3: Replace renderAllPanels() — was O(n) entity teardown+rebuild
# ─────────────────────────────────────────────────────────────────────────────
OLD_RENDER_ALL = """  // ── Render all panels ──────────────────────────────────────────────────────────────────────────────────────────────────
  function renderAllPanels(viewer: any, C: any, panelList: PlacedPanel[]) {
    panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    panelMapRef.current.clear();
    panelList.forEach(p => addPanelEntity(viewer, C, p));
    try { viewer.scene.requestRender(); } catch {}
  }"""

NEW_RENDER_ALL = """  // ── Render all panels (GPU-instanced — ONE draw call) ──────────────────────────────────────────────────────────────
  function renderAllPanels(viewer: any, C: any, panelList: PlacedPanel[]) {
    // Lazily create the renderer on first call
    if (!primitiveRendererRef.current) {
      primitiveRendererRef.current = new PanelPrimitiveRenderer(C, viewer.scene);
      addLog('RENDER', 'PanelPrimitiveRenderer initialized');
    }
    const renderData = panelList.map(p => panelToRenderData(p));
    primitiveRendererRef.current.rebuild(renderData, showShadeRef.current);
    try { viewer.scene.requestRender(); } catch {}
  }"""

if OLD_RENDER_ALL in content:
    content = content.replace(OLD_RENDER_ALL, NEW_RENDER_ALL, 1)
    changes.append("✅ PATCH 3: Replaced renderAllPanels() with GPU-instanced rebuild")
else:
    # Try with unicode box-drawing chars
    OLD_RENDER_ALL2 = "  function renderAllPanels(viewer: any, C: any, panelList: PlacedPanel[]) {\n    panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });\n    panelMapRef.current.clear();\n    panelList.forEach(p => addPanelEntity(viewer, C, p));\n    try { viewer.scene.requestRender(); } catch {}\n  }"
    NEW_RENDER_ALL2 = """  function renderAllPanels(viewer: any, C: any, panelList: PlacedPanel[]) {
    // GPU-instanced: ONE draw call for all panels
    if (!primitiveRendererRef.current) {
      primitiveRendererRef.current = new PanelPrimitiveRenderer(C, viewer.scene);
      addLog('RENDER', 'PanelPrimitiveRenderer initialized');
    }
    const renderData = panelList.map(p => panelToRenderData(p));
    primitiveRendererRef.current.rebuild(renderData, showShadeRef.current);
    try { viewer.scene.requestRender(); } catch {}
  }"""
    if OLD_RENDER_ALL2 in content:
        content = content.replace(OLD_RENDER_ALL2, NEW_RENDER_ALL2, 1)
        changes.append("✅ PATCH 3b: Replaced renderAllPanels() (alt match)")
    else:
        print("⚠️  PATCH 3: renderAllPanels body not found — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 4: Replace addPanelEntity() — was viewer.entities.add() per panel
# ─────────────────────────────────────────────────────────────────────────────
OLD_ADD_ENTITY_BLOCK = """  // ── Add single panel entity ──────────────────────────────────────────────────────────────────────────────────────────
  function addPanelEntity(viewer: any, C: any, panel: PlacedPanel) {
    try {
      const h = panel.height ?? 0;
      const tiltDeg = panel.tilt ?? 0;
      const azDeg = panel.azimuth ?? 180;

      if (!isValidCoord(panel.lat, panel.lng, h)) {
        addLog('ERROR', `Panel ${panel.id} invalid coords`); return;
      }
      if (!isFinite(tiltDeg) || !isFinite(azDeg)) {
        addLog('ERROR', `Panel ${panel.id} invalid tilt/az`); return;
      }

      const heading = isFinite(panel.heading ?? NaN) ? panel.heading! : headingFromAzimuth(azDeg);
      const pitchRad = -tiltDeg * Math.PI / 180;
      const rollRad = (panel.roll ?? 0) * Math.PI / 180;

      if (!isFinite(heading) || !isFinite(pitchRad) || !isFinite(rollRad)) return;

      const pos = safeCartesian3(C, panel.lng, panel.lat, h);
      if (!pos || C.Cartesian3.magnitude(pos) < 1000) {
        addLog('ERROR', `Panel ${panel.id} invalid Cartesian3`); return;
      }

      const hpr = new C.HeadingPitchRoll(heading, pitchRad, rollRad);
      const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
      if (!orientation || !isFinite(orientation.x) || !isFinite(orientation.y) ||
          !isFinite(orientation.z) || !isFinite(orientation.w)) {
        addLog('ERROR', `Panel ${panel.id} invalid quaternion`); return;
      }

      const sType = (panel.systemType ?? 'roof') as SystemType;
      let color: any;
      if (showShadeRef.current && twinRef.current) {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear(), 5, 21);
        d.setUTCHours(Math.floor(simHourRef.current), Math.round((simHourRef.current % 1) * 60), 0, 0);
        const sunPos = getSunPosition(lat, lng, d);
        color = new C.ColorMaterialProperty(shadeToColor(C, computeShade(panel, sunPos)));
      } else {
        color = new C.ColorMaterialProperty(systemTypeColor(C, sType));
      }

      // Use stored orientation on the panel, fallback to current ref
      const orient: PanelOrientation = (panel as any).orientation ?? panelOrientationRef.current;
      const { pw, ph } = panelDims(orient);
      const entity = viewer.entities.add({
        position: pos, orientation,
        box: {
          dimensions: new C.Cartesian3(pw, ph, PT),
          material: color, outline: true,
          outlineColor: C.Color.fromCssColorString('#1a1a2e').withAlpha(0.8),
          outlineWidth: 1, shadows: C.ShadowMode.ENABLED,
        },
      });
      panelMapRef.current.set(panel.id, entity);
      return entity;
    } catch (err: any) {
      addLog('ERROR', `addPanelEntity ${panel.id}: ${err.message}`);
    }
  }"""

NEW_ADD_ENTITY_BLOCK = """  // ── panelToRenderData: convert PlacedPanel → PanelRenderData for GPU renderer ──────────────────────────────────────
  function panelToRenderData(panel: PlacedPanel): PanelRenderData {
    const azDeg = panel.azimuth ?? 180;
    return {
      id:          panel.id,
      lat:         panel.lat,
      lng:         panel.lng,
      height:      panel.height ?? 0,
      tilt:        panel.tilt ?? 0,
      azimuth:     azDeg,
      heading:     isFinite(panel.heading ?? NaN) ? panel.heading! : headingFromAzimuth(azDeg),
      roll:        panel.roll ?? 0,
      systemType:  (panel.systemType ?? 'roof') as SystemType,
      orientation: (panel as any).orientation ?? panelOrientationRef.current,
      shadeFactor: undefined,
      selected:    false,
    };
  }

  // ── addPanelEntity: adds a single panel via GPU renderer (triggers rebuild) ─────────────────────────────────────────
  function addPanelEntity(viewer: any, C: any, panel: PlacedPanel) {
    if (!primitiveRendererRef.current) {
      primitiveRendererRef.current = new PanelPrimitiveRenderer(C, viewer.scene);
    }
    // Rebuild with the full updated panel list (renderer handles dirty-flag throttle)
    const renderData = panelsRef.current.map(p => panelToRenderData(p));
    primitiveRendererRef.current.rebuild(renderData, showShadeRef.current);
    try { viewer.scene.requestRender(); } catch {}
  }"""

if OLD_ADD_ENTITY_BLOCK in content:
    content = content.replace(OLD_ADD_ENTITY_BLOCK, NEW_ADD_ENTITY_BLOCK, 1)
    changes.append("✅ PATCH 4: Replaced addPanelEntity() with GPU renderer + panelToRenderData()")
else:
    print("⚠️  PATCH 4: addPanelEntity block not found — trying line-based replacement")
    # Try matching just the function signature + first few lines
    OLD_ADD_SIMPLE = "  function addPanelEntity(viewer: any, C: any, panel: PlacedPanel) {\n    try {\n      const h = panel.height ?? 0;"
    if OLD_ADD_SIMPLE in content:
        # Find the full function by counting braces
        start = content.index(OLD_ADD_SIMPLE)
        # Find the comment line before it
        comment_start = content.rfind("  // ──", 0, start)
        if comment_start == -1:
            comment_start = start
        # Find end of function (matching closing brace)
        depth = 0
        i = start
        while i < len(content):
            if content[i] == '{': depth += 1
            elif content[i] == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
            i += 1
        old_block = content[comment_start:end]
        content = content[:comment_start] + NEW_ADD_ENTITY_BLOCK + content[end:]
        changes.append("✅ PATCH 4b: Replaced addPanelEntity() (brace-matching)")
    else:
        print("⚠️  PATCH 4: Could not find addPanelEntity — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 5: Replace updateShadeColors() — was O(n) entity.box.material updates
# ─────────────────────────────────────────────────────────────────────────────
OLD_UPDATE_SHADE = """  function updateShadeColors() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const C = (window as any).Cesium;
    if (!C) return;

    // Build simulation date: June 21 at simulated hour (UTC)
    // IMPORTANT: Use UTC hours so Cesium's sun position (which uses UTC) matches our calculation
    const hour = simHourRef.current;
    const d = new Date();
    // Set to June 21 of current year, at the simulated hour in UTC
    d.setUTCFullYear(d.getUTCFullYear(), 5, 21); // June 21
    d.setUTCHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);

    // Sync Cesium clock so the built-in sun/shadow system moves with the slider
    try {
      const julianDate = C.JulianDate.fromDate(d);
      viewer.clock.currentTime = julianDate;
      viewer.clock.shouldAnimate = false; // keep clock frozen at our chosen time

      // Enable/disable lighting and shadows based on shade mode
      const shadeOn = showShadeRef.current;
      viewer.scene.globe.enableLighting = shadeOn;
      viewer.scene.shadowMap.enabled = shadeOn;
      viewer.scene.shadowMap.softShadows = shadeOn;
      viewer.scene.shadowMap.size = 1024;

      // Always show the sun disc
      if (viewer.scene.sun) viewer.scene.sun.show = true;

      // Force Cesium to re-evaluate the scene with the new clock time
      viewer.scene.requestRender();
      // Second render call after a tick to ensure shadow map recalculates
      setTimeout(() => {
        try { viewer.scene.requestRender(); } catch {}
      }, 50);
    } catch (e: any) {
      addLog('WARN', `updateShadeColors clock sync: ${e.message}`);
    }

    // Compute sun position for panel shade factor coloring
    // Use local time for getSunPosition (it expects local solar time)
    const dLocal = new Date();
    dLocal.setUTCFullYear(dLocal.getUTCFullYear(), 5, 21);
    dLocal.setUTCHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    const sunPos = getSunPosition(lat, lng, dLocal);

    // Recolor panel entities based on computed shade factor
    panelsRef.current.forEach(panel => {
      const entity = panelMapRef.current.get(panel.id);
      if (!entity || !entity.box) return;
      try {
        let color: any;
        if (showShadeRef.current) {
          const shade = computeShade(panel, sunPos);
          color = new C.ColorMaterialProperty(shadeToColor(C, shade));
        } else {
          color = new C.ColorMaterialProperty(systemTypeColor(C, (panel.systemType ?? 'roof') as SystemType));
        }
        entity.box.material = color;
      } catch {}
    });

    // Final render request
    try { viewer.scene.requestRender(); } catch {}
  }"""

NEW_UPDATE_SHADE = """  function updateShadeColors() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const C = (window as any).Cesium;
    if (!C) return;

    // Build simulation date: June 21 at simulated hour (UTC)
    const hour = simHourRef.current;
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear(), 5, 21); // June 21
    d.setUTCHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);

    // Sync Cesium clock so the built-in sun/shadow system moves with the slider
    try {
      const julianDate = C.JulianDate.fromDate(d);
      viewer.clock.currentTime = julianDate;
      viewer.clock.shouldAnimate = false;

      const shadeOn = showShadeRef.current;
      viewer.scene.globe.enableLighting = shadeOn;
      viewer.scene.shadowMap.enabled = shadeOn;
      viewer.scene.shadowMap.softShadows = shadeOn;
      viewer.scene.shadowMap.size = 1024;
      if (viewer.scene.sun) viewer.scene.sun.show = true;

      viewer.scene.requestRender();
      setTimeout(() => { try { viewer.scene.requestRender(); } catch {} }, 50);
    } catch (e: any) {
      addLog('WARN', `updateShadeColors clock sync: ${e.message}`);
    }

    if (!primitiveRendererRef.current) return;

    // ── FAST PATH: batch shade computation via sunVectorCache ──────────────────
    // Compute sun position ONCE, then dot-product per panel (~40x faster than per-panel getSunPosition)
    const sunPos = getSunPosition(lat, lng, d);
    const panels = panelsRef.current;

    // Build shade factors using batch computation
    const shadeFactors = batchComputeShadeFactors(
      panels.map(p => ({ tilt: p.tilt ?? 0, azimuth: p.azimuth ?? 180 })),
      sunPos
    );

    // Build render data with shade factors
    const renderData: PanelRenderData[] = panels.map((p, i) => ({
      ...panelToRenderData(p),
      shadeFactor: shadeFactors[i] ?? 0,
      selected: p.id === selectedPanelIdRef.current,
    }));

    // Fast color update — no geometry rebuild
    primitiveRendererRef.current.updateColors(renderData, showShadeRef.current);
    try { viewer.scene.requestRender(); } catch {}
  }"""

if OLD_UPDATE_SHADE in content:
    content = content.replace(OLD_UPDATE_SHADE, NEW_UPDATE_SHADE, 1)
    changes.append("✅ PATCH 5: Replaced updateShadeColors() with batch shade computation + fast color update")
else:
    print("⚠️  PATCH 5: updateShadeColors body not found — trying partial match")
    # Try matching just the function start
    OLD_SHADE_START = "  function updateShadeColors() {\n    const viewer = viewerRef.current;\n    if (!viewer) return;\n    const C = (window as any).Cesium;\n    if (!C) return;"
    if OLD_SHADE_START in content:
        start = content.index(OLD_SHADE_START)
        # Find end of function
        depth = 0
        i = start
        in_func = False
        while i < len(content):
            if content[i] == '{':
                depth += 1
                in_func = True
            elif content[i] == '}':
                depth -= 1
                if in_func and depth == 0:
                    end = i + 1
                    break
            i += 1
        content = content[:start] + NEW_UPDATE_SHADE + content[end:]
        changes.append("✅ PATCH 5b: Replaced updateShadeColors() (brace-matching)")
    else:
        print("⚠️  PATCH 5: Could not find updateShadeColors — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 6: Replace clearPanels() — was forEach entity.remove
# ─────────────────────────────────────────────────────────────────────────────
OLD_CLEAR_PANELS = """  function clearPanels() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    panelMapRef.current.clear();
    panelsRef.current = [];
    onPanelsChange([]);
    setPanelCount(0);
    setStatusMsg('🗑️ All panels cleared');
    try { viewer.scene.requestRender(); } catch {}
  }"""

NEW_CLEAR_PANELS = """  function clearPanels() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    // GPU renderer: rebuild with empty list (removes all instances in one call)
    if (primitiveRendererRef.current) {
      primitiveRendererRef.current.rebuild([], false);
    }
    panelsRef.current = [];
    onPanelsChange([]);
    setPanelCount(0);
    setStatusMsg('🗑️ All panels cleared');
    try { viewer.scene.requestRender(); } catch {}
  }"""

if OLD_CLEAR_PANELS in content:
    content = content.replace(OLD_CLEAR_PANELS, NEW_CLEAR_PANELS, 1)
    changes.append("✅ PATCH 6: Replaced clearPanels() with GPU renderer rebuild([])")
else:
    print("⚠️  PATCH 6: clearPanels body not found — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 7: Replace deleteSelectedPanel() — was entity.remove + map.delete
# ─────────────────────────────────────────────────────────────────────────────
OLD_DELETE_PANEL = """  function deleteSelectedPanel() {
    const viewer = viewerRef.current;
    const id = selectedPanelIdRef.current;
    if (!id || !viewer) return;
    const ent = panelMapRef.current.get(id);
    if (ent) { try { viewer.entities.remove(ent); } catch {} }
    panelMapRef.current.delete(id);
    const newPanels = panelsRef.current.filter(p => p.id !== id);
    panelsRef.current = newPanels;
    onPanelsChange(newPanels);
    setPanelCount(newPanels.length);
    selectedPanelIdRef.current = null;
    setSelectedPanelId(null);
    setStatusMsg('🗑️ Panel deleted');
    try { viewer.scene.requestRender(); } catch {}
  }"""

NEW_DELETE_PANEL = """  function deleteSelectedPanel() {
    const viewer = viewerRef.current;
    const id = selectedPanelIdRef.current;
    if (!id || !viewer) return;
    const newPanels = panelsRef.current.filter(p => p.id !== id);
    panelsRef.current = newPanels;
    onPanelsChange(newPanels);
    setPanelCount(newPanels.length);
    selectedPanelIdRef.current = null;
    setSelectedPanelId(null);
    // GPU renderer: rebuild with filtered list
    if (primitiveRendererRef.current) {
      const C = (window as any).Cesium;
      primitiveRendererRef.current.rebuild(newPanels.map(p => panelToRenderData(p)), showShadeRef.current);
    }
    setStatusMsg('🗑️ Panel deleted');
    try { viewer.scene.requestRender(); } catch {}
  }"""

if OLD_DELETE_PANEL in content:
    content = content.replace(OLD_DELETE_PANEL, NEW_DELETE_PANEL, 1)
    changes.append("✅ PATCH 7: Replaced deleteSelectedPanel() with GPU renderer rebuild")
else:
    print("⚠️  PATCH 7: deleteSelectedPanel body not found — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 8: Replace clearPanelSelection() — was entity.box.material direct set
# ─────────────────────────────────────────────────────────────────────────────
OLD_CLEAR_SELECTION = """  function clearPanelSelection() {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    const prevId = selectedPanelIdRef.current;
    if (prevId && viewer && C) {
      const ent = panelMapRef.current.get(prevId);
      if (ent) {
        const panel = panelsRef.current.find(p => p.id === prevId);
        if (panel) {
          const sType = (panel.systemType ?? 'roof') as SystemType;
          ent.box.material = new C.ColorMaterialProperty(systemTypeColor(C, sType));
        }
      }
    }
    selectedPanelIdRef.current = null;
    setSelectedPanelId(null);
  }"""

NEW_CLEAR_SELECTION = """  function clearPanelSelection() {
    const prevId = selectedPanelIdRef.current;
    selectedPanelIdRef.current = null;
    setSelectedPanelId(null);
    // GPU renderer: fast color update to deselect (no geometry rebuild)
    if (prevId && primitiveRendererRef.current) {
      primitiveRendererRef.current.setSelected(null, panelsRef.current.map(p => panelToRenderData(p)), showShadeRef.current);
      const viewer = viewerRef.current;
      try { viewer?.scene.requestRender(); } catch {}
    }
  }"""

if OLD_CLEAR_SELECTION in content:
    content = content.replace(OLD_CLEAR_SELECTION, NEW_CLEAR_SELECTION, 1)
    changes.append("✅ PATCH 8: Replaced clearPanelSelection() with GPU renderer setSelected(null)")
else:
    print("⚠️  PATCH 8: clearPanelSelection body not found — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 9: Replace handleSelectClick() — was panelMapRef.forEach entity lookup
# ─────────────────────────────────────────────────────────────────────────────
OLD_HANDLE_SELECT = """  function handleSelectClick(viewer: any, C: any, screenPos: any) {
    try {
      const picked = viewer.scene.pick(screenPos);
      if (!picked || !picked.id) { clearPanelSelection(); return; }
      const entity = picked.id;
      let foundId: string | null = null;
      panelMapRef.current.forEach((ent, id) => { if (ent === entity) foundId = id; });
      if (!foundId) { clearPanelSelection(); return; }
      clearPanelSelection();
      entity.box.material = new C.ColorMaterialProperty(C.Color.fromCssColorString('#ff3333').withAlpha(0.92));
      selectedPanelIdRef.current = foundId;
      setSelectedPanelId(foundId);
      const panel = panelsRef.current.find(p => p.id === foundId);
      if (panel) setStatusMsg(`📌 Panel selected — ${panel.tilt?.toFixed(0) ?? '?'}° tilt, ${panel.azimuth?.toFixed(0) ?? '?'}° az | Press Delete or click 🗑️ to remove`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: any) { addLog('ERROR', `handleSelectClick: ${err.message}`); }
  }"""

NEW_HANDLE_SELECT = """  function handleSelectClick(viewer: any, C: any, screenPos: any) {
    try {
      const picked = viewer.scene.pick(screenPos);
      if (!picked) { clearPanelSelection(); return; }

      // GPU renderer: pick returns GeometryInstance id directly (O(1) lookup)
      let foundId: string | null = null;
      if (primitiveRendererRef.current) {
        foundId = primitiveRendererRef.current.pickPanel(picked);
      }
      // Fallback: legacy entity pick (for overlays, ghost panels, etc.)
      if (!foundId && picked.id && typeof picked.id === 'object' && picked.id.box) {
        // This is a legacy entity — not a panel primitive, ignore
        clearPanelSelection(); return;
      }
      if (!foundId) { clearPanelSelection(); return; }

      clearPanelSelection();
      selectedPanelIdRef.current = foundId;
      setSelectedPanelId(foundId);
      // GPU renderer: fast color update for selection highlight (no geometry rebuild)
      primitiveRendererRef.current?.setSelected(foundId, panelsRef.current.map(p => panelToRenderData(p)), showShadeRef.current);
      const panel = panelsRef.current.find(p => p.id === foundId);
      if (panel) setStatusMsg(`📌 Panel selected — ${panel.tilt?.toFixed(0) ?? '?'}° tilt, ${panel.azimuth?.toFixed(0) ?? '?'}° az | Press Delete or click 🗑️ to remove`);
      try { viewer.scene.requestRender(); } catch {}
    } catch (err: any) { addLog('ERROR', `handleSelectClick: ${err.message}`); }
  }"""

if OLD_HANDLE_SELECT in content:
    content = content.replace(OLD_HANDLE_SELECT, NEW_HANDLE_SELECT, 1)
    changes.append("✅ PATCH 9: Replaced handleSelectClick() with O(1) GPU renderer pick")
else:
    print("⚠️  PATCH 9: handleSelectClick body not found — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 10: Wire up LOD manager + sun cache warm-up in boot()
# Insert after: renderAllPanelsRef.current = renderAllPanels;
# ─────────────────────────────────────────────────────────────────────────────
OLD_BOOT_EXPOSE = "      // Expose renderAllPanels so the panels useEffect can call it after boot\n      renderAllPanelsRef.current = renderAllPanels;"

NEW_BOOT_EXPOSE = """      // Expose renderAllPanels so the panels useEffect can call it after boot
      renderAllPanelsRef.current = renderAllPanels;

      // ── LOD Manager: dynamic tile quality based on camera altitude ──────────
      lodManagerRef.current = new LODManager(C);
      lodManagerRef.current.forceApply(viewer, tilesetRef.current, showShadeRef.current);

      // Camera change handler: update LOD tier on altitude change
      viewer.camera.changed.addEventListener(() => {
        try {
          if (lodManagerRef.current && tilesetRef.current) {
            const changed = lodManagerRef.current.update(viewer, tilesetRef.current, showShadeRef.current);
            if (changed) { try { viewer.scene.requestRender(); } catch {} }
          }
        } catch {}
      });

      // ── Sun vector cache: precompute full day at boot for fast shade updates ─
      const bootDate = new Date();
      bootDate.setUTCFullYear(bootDate.getUTCFullYear(), 5, 21); // June 21
      precomputeDaySunPositions(lat, lng, bootDate, getSunPosition);
      addLog('BOOT', 'Sun vector cache warmed for June 21');"""

if OLD_BOOT_EXPOSE in content:
    content = content.replace(OLD_BOOT_EXPOSE, NEW_BOOT_EXPOSE, 1)
    changes.append("✅ PATCH 10: Added LOD manager init + camera change handler + sun cache warm-up in boot()")
else:
    print("⚠️  PATCH 10: boot expose target not found — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 11: Add renderer cleanup in useEffect cleanup / destroy
# Find the viewer.destroy() call and add renderer cleanup before it
# ─────────────────────────────────────────────────────────────────────────────
OLD_VIEWER_DESTROY = "        try { viewer.destroy(); } catch {}"
NEW_VIEWER_DESTROY = """        // Cleanup GPU renderer
        try { primitiveRendererRef.current?.destroy(); primitiveRendererRef.current = null; } catch {}
        try { viewer.destroy(); } catch {}"""

if OLD_VIEWER_DESTROY in content:
    content = content.replace(OLD_VIEWER_DESTROY, NEW_VIEWER_DESTROY, 1)
    changes.append("✅ PATCH 11: Added GPU renderer cleanup in viewer destroy")
else:
    print("⚠️  PATCH 11: viewer.destroy() not found — skipping")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 12: Remove computeShade() — now handled by sunVectorCache
# Keep it as a fallback (just rename to _legacyComputeShade to avoid TS unused warning)
# Actually: keep it since it's still used in addPanelEntity fallback path
# ─────────────────────────────────────────────────────────────────────────────
# No change needed — computeShade is still referenced in the new addPanelEntity

# ─────────────────────────────────────────────────────────────────────────────
# Write patched file
# ─────────────────────────────────────────────────────────────────────────────
SRC.write_text(content, encoding="utf-8")
new_len = len(content)

print(f"\n{'='*60}")
print(f"PATCH SUMMARY — SolarEngine3D.tsx")
print(f"{'='*60}")
for c in changes:
    print(c)
print(f"\nOriginal size: {original_len:,} chars")
print(f"Patched size:  {new_len:,} chars")
print(f"Delta:         {new_len - original_len:+,} chars")
print(f"\nTotal patches applied: {len(changes)}")
print(f"Backup saved to: {BAK}")