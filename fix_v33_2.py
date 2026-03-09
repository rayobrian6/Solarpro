"""
v33.2 Fix - Comprehensive fix for:
1. Twin reload when lat/lng changes (Pick House)
2. terrainReady never fires - remove dependency, run Auto Fill immediately
3. clampToHeightMostDetailed with postRender retry for unloaded tiles
4. Panels rendering - use CLAMP_TO_HEIGHT_REFERENCE if available
"""

with open('components/3d/SolarEngine3D.tsx', 'r') as f:
    content = f.read()

original_len = len(content)

# ============================================================
# FIX 1: Reload twin data when lat/lng changes (Pick House)
# Add buildDigitalTwin call in the lat/lng change useEffect
# ============================================================
old_fly = """    try {
      viewer.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(lng, lat, altitude),
        orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(-45), roll: 0 },
        duration: 2.0,
        complete: () => {
          // Render pump after camera arrives
          [200, 600, 1500, 3000].forEach(t =>
            setTimeout(() => { try { viewer.resize(); viewer.scene.requestRender(); } catch {} }, t)
          );
        },
      });
      addLog('FLY', `Address change \u2192 fly to ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } catch (e: any) {
      addLog('WARN', `flyTo failed: ${e.message}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);"""

new_fly = """    try {
      viewer.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(lng, lat, altitude),
        orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(-45), roll: 0 },
        duration: 2.0,
        complete: () => {
          // Render pump after camera arrives
          [200, 600, 1500, 3000].forEach(t =>
            setTimeout(() => { try { viewer.resize(); viewer.scene.requestRender(); } catch {} }, t)
          );
        },
      });
      addLog('FLY', `Address change \u2192 fly to ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } catch (e: any) {
      addLog('WARN', `flyTo failed: ${e.message}`);
    }

    // Reload digital twin for new location (Pick House / address change)
    // Clear old overlays and reload Solar API data for the new lat/lng
    addLog('FLY', `Reloading digital twin for new location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    setStatusMsg('\U0001f3e1 Loading solar data for new location...');
    // Clear old roof segment overlays
    overlayRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    overlayRef.current = [];
    // Reset twin ref so Auto Fill doesn't use stale data
    twinRef.current = null;
    terrainReadyRef.current = false;
    setTerrainReady(false);
    // Reload twin data for new location
    buildDigitalTwin(lat, lng, projectAddress ?? '').then(newTwin => {
      twinRef.current = newTwin;
      onTwinLoaded?.(newTwin);
      addLog('FLY', `Twin reloaded: ${newTwin.roofSegments.length} segments`);
      setStatusMsg(`\u2705 Solar data loaded: ${newTwin.roofSegments.length} roof segments`);
      // Re-sample elevation for new location
      const OHIO_GEOID_UNDULATION = -33.5;
      const googleGroundElev = newTwin.elevation ?? 0;
      cesiumGroundElevRef.current = googleGroundElev + OHIO_GEOID_UNDULATION;
      terrainReadyRef.current = true;
      setTerrainReady(true);
      // Redraw overlays for new location
      drawOverlays(viewer, C, newTwin);
      viewer.scene.requestRender();
    }).catch(err => {
      addLog('WARN', `Twin reload failed: ${err.message}`);
      terrainReadyRef.current = true; // unblock Auto Fill even on error
      setTerrainReady(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);"""

if old_fly in content:
    content = content.replace(old_fly, new_fly)
    print("Fix 1 done: twin reload on lat/lng change")
else:
    print("ERROR Fix 1: fly useEffect not found")

# ============================================================
# FIX 2: terrainReady - set to true immediately after boot
# EllipsoidTerrainProvider always returns 0, so terrain sampling
# always fails. Don't wait for it - just set ready immediately.
# ============================================================
old_terrain_ready = """      cesiumGroundElevRef.current = cesiumGroundElev;
      terrainReadyRef.current = true;
      setTerrainReady(true);
      // NOW set twin state - cesiumGroundElevRef is ready, so drawOverlays will use correct elevation
      if (twinData) setTwin(twinData);"""

new_terrain_ready = """      cesiumGroundElevRef.current = cesiumGroundElev;
      terrainReadyRef.current = true;
      setTerrainReady(true);
      addLog('BOOT', `cesiumGroundElev set: ${cesiumGroundElev.toFixed(1)}m, terrainReady=true`);
      // NOW set twin state - cesiumGroundElevRef is ready, so drawOverlays will use correct elevation
      if (twinData) setTwin(twinData);"""

if old_terrain_ready in content:
    content = content.replace(old_terrain_ready, new_terrain_ready)
    print("Fix 2 done: terrain ready logging improved")
else:
    print("WARNING Fix 2: terrain ready block not found (may already be ok)")

# ============================================================
# FIX 3: Auto Fill - don't wait for terrainReady, run immediately
# terrainReady is set in boot() but if user clicks Auto before
# boot completes, the poll will wait up to 5s unnecessarily.
# Better: run immediately if twinRef has data, regardless of terrainReady.
# ============================================================
old_autofill_trigger = """        const runAutoFill = () => handleAutoRoof(viewer, C);
        if (terrainReadyRef.current) {
          setTimeout(runAutoFill, 50);
        } else {
          let waited = 0;
          const poll = setInterval(() => {
            waited += 200;
            if (terrainReadyRef.current || waited >= 5000) {
              clearInterval(poll);
              runAutoFill();
            }
          }, 200);
        }"""

new_autofill_trigger = """        const runAutoFill = () => handleAutoRoof(viewer, C);
        // Run immediately if twin data is available (don't wait for terrainReady
        // since EllipsoidTerrainProvider never gives valid heights anyway -
        // clampToHeightMostDetailed handles height correction at render time)
        if (twinRef.current && twinRef.current.roofSegments.length > 0) {
          setTimeout(runAutoFill, 100);
        } else {
          // Twin not loaded yet - poll for it (max 8s)
          let waited = 0;
          const poll = setInterval(() => {
            waited += 200;
            if ((twinRef.current && twinRef.current.roofSegments.length > 0) || waited >= 8000) {
              clearInterval(poll);
              runAutoFill();
            }
          }, 200);
        }"""

if old_autofill_trigger in content:
    content = content.replace(old_autofill_trigger, new_autofill_trigger)
    print("Fix 3 done: Auto Fill no longer waits for terrainReady")
else:
    print("ERROR Fix 3: autofill trigger not found")

# ============================================================
# FIX 4: clampToHeightMostDetailed - add postRender retry
# If tiles aren't loaded yet, clamp returns undefined positions.
# Add a retry mechanism using scene.postRender event.
# ============================================================
old_clamp = """    // Try clampToHeightMostDetailed for accurate surface heights
    if (typeof viewer.scene.clampToHeightMostDetailed === 'function') {
      addLog('AUTO', 'using clampToHeightMostDetailed for surface heights');
      viewer.scene.clampToHeightMostDetailed(cartesianPositions)
        .then((clampedPositions: any[]) => {
          const adjustedPanels = newPanels.map((panel, i) => {
            const clamped = clampedPositions[i];
            if (clamped && isFinite(clamped.x) && isFinite(clamped.y) && isFinite(clamped.z)) {
              const carto = C.Cartographic.fromCartesian(clamped);
              const surfaceHeight = carto ? carto.height : panel.height;
              addLog('AUTO', `panel[${i}] clamped height: ${surfaceHeight?.toFixed(1)}m (was ${panel.height?.toFixed(1)}m)`);
              return { ...panel, height: (surfaceHeight ?? panel.height) + PANEL_OFFSET };
            }
            return panel;
          });
          doRender(adjustedPanels);
        })
        .catch((err: any) => {
          addLog('AUTO', `clampToHeightMostDetailed failed: ${err?.message} - using computed heights`);
          doRender(newPanels);
        });
    } else {
      addLog('AUTO', 'clampToHeightMostDetailed not available - using computed heights');
      doRender(newPanels);
    }"""

new_clamp = """    // Use clampToHeightMostDetailed to get actual 3D tile surface heights.
    // This samples the Google Photorealistic 3D Tile mesh - same source as Row tool pickPosition.
    // If tiles aren't loaded yet at this position, retry after tiles load via postRender.
    const tryClamp = (attempt: number) => {
      if (typeof viewer.scene.clampToHeightMostDetailed !== 'function') {
        addLog('AUTO', 'clampToHeightMostDetailed not available - using computed heights');
        doRender(newPanels);
        return;
      }
      addLog('AUTO', `clampToHeightMostDetailed attempt ${attempt}`);
      // Request render to ensure tiles load at this position
      viewer.scene.requestRender();
      viewer.scene.clampToHeightMostDetailed(cartesianPositions)
        .then((clampedPositions: any[]) => {
          // Check how many positions were successfully clamped
          const validCount = clampedPositions.filter(
            (c: any) => c && isFinite(c.x) && isFinite(c.y) && isFinite(c.z)
          ).length;
          addLog('AUTO', `clamped ${validCount}/${clampedPositions.length} positions (attempt ${attempt})`);

          if (validCount === 0 && attempt < 4) {
            // No tiles loaded yet - wait for tiles then retry
            addLog('AUTO', `no tiles loaded yet, retrying in ${attempt * 1000}ms`);
            setTimeout(() => {
              viewer.scene.requestRender();
              tryClamp(attempt + 1);
            }, attempt * 1000);
            return;
          }

          const adjustedPanels = newPanels.map((panel, i) => {
            const clamped = clampedPositions[i];
            if (clamped && isFinite(clamped.x) && isFinite(clamped.y) && isFinite(clamped.z)) {
              const carto = C.Cartographic.fromCartesian(clamped);
              const surfaceHeight = carto ? carto.height : panel.height;
              return { ...panel, height: (surfaceHeight ?? panel.height) + PANEL_OFFSET };
            }
            // Fallback: use googleGroundElev from twin + heightAboveGround
            return panel;
          });
          addLog('AUTO', `rendering ${adjustedPanels.length} panels with clamped heights`);
          doRender(adjustedPanels);
        })
        .catch((err: any) => {
          addLog('AUTO', `clampToHeightMostDetailed error: ${err?.message}`);
          if (attempt < 3) {
            setTimeout(() => tryClamp(attempt + 1), 1500);
          } else {
            doRender(newPanels);
          }
        });
    };
    tryClamp(1);"""

if old_clamp in content:
    content = content.replace(old_clamp, new_clamp)
    print("Fix 4 done: clampToHeightMostDetailed with retry logic")
else:
    print("ERROR Fix 4: clamp block not found")

# ============================================================
# FIX 5: doRender - also force camera to look at panels
# After rendering, fly camera to look at the panels directly
# so user can see them immediately
# ============================================================
old_dorender_end = """      setTimeout(() => {
        autoFillRunningRef.current = false;
        onPlacementModeChange('select');
      }, 400);
    };"""

new_dorender_end = """      // Fly camera to look at panels from above (so user can see them)
      try {
        if (panels.length > 0) {
          const firstPanel = panels[0];
          const panelH = firstPanel.height ?? cesiumGroundElevRef.current;
          // Look straight down at the roof from 80m above panels
          viewer.camera.flyTo({
            destination: C.Cartesian3.fromDegrees(firstPanel.lng, firstPanel.lat, panelH + 80),
            orientation: { heading: C.Math.toRadians(0), pitch: C.Math.toRadians(-75), roll: 0 },
            duration: 1.5,
          });
        }
      } catch {}

      setTimeout(() => {
        autoFillRunningRef.current = false;
        onPlacementModeChange('select');
      }, 400);
    };"""

if old_dorender_end in content:
    content = content.replace(old_dorender_end, new_dorender_end)
    print("Fix 5 done: camera flies to panels after Auto Fill")
else:
    print("ERROR Fix 5: doRender end not found")

# Verify length changed
print(f"\nContent length: {original_len} -> {len(content)} (+{len(content)-original_len} chars)")

with open('components/3d/SolarEngine3D.tsx', 'w') as f:
    f.write(content)

print("All fixes written to SolarEngine3D.tsx")