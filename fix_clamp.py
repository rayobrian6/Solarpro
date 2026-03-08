with open('/workspace/components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old = """  function handleAutoRoof(viewer: any, C: any) {
    // Mutex guard: prevent concurrent / double-execution of Auto Fill.
    if (autoFillRunningRef.current) {
      addLog('AUTO', 'handleAutoRoof: already running - skipped duplicate call');
      return;
    }
    autoFillRunningRef.current = true;

    const twinData = twinRef.current;
    if (!twinData || twinData.roofSegments.length === 0) {
      setStatusMsg('No roof segments - Solar API data required');
      addLog('AUTO', 'handleAutoRoof: no twinData or no roofSegments');
      autoFillRunningRef.current = false;
      return;
    }

    addLog('AUTO', `handleAutoRoof: ${twinData.roofSegments.length} segments, cesiumGroundElev=${cesiumGroundElevRef.current.toFixed(1)}m`);

    // Step 1: Clear ALL existing panel entities from Cesium viewer.
    // This ensures a clean slate before adding new Auto Fill panels.
    panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    panelMapRef.current.clear();
    lastRenderedPanelsRef.current = [];

    const newPanels: PlacedPanel[] = [];
    const sortedSegs = [...twinData.roofSegments].sort((a: any, b: any) => b.sunshineHours - a.sunshineHours);
    const maxSunshine = sortedSegs[0]?.sunshineHours ?? 0;
    const minThreshold = maxSunshine * 0.5;

    const eligibleSegs = sortedSegs.filter((seg: any) =>
      seg.sunshineHours >= minThreshold && seg.areaM2 >= (PW * PH)
    );

    addLog('AUTO', `eligible: ${eligibleSegs.length}/${sortedSegs.length} segs (threshold=${minThreshold.toFixed(0)}h)`);

    // Step 2: Fill each segment - panels are returned but NOT added to Cesium yet.
    eligibleSegs.forEach((seg: any, idx: number) => {
      addLog('AUTO', `seg[${idx}] id=${seg.id} area=${seg.areaM2?.toFixed(1)}m2 hAG=${seg.heightAboveGround?.toFixed(2)}m pitch=${seg.pitchDegrees?.toFixed(1)}deg az=${seg.azimuthDegrees?.toFixed(1)}deg maxP=${seg.maxPanels} googlePanels=${seg.googlePanels?.length ?? 0}`);
      const segPanels = fillRoofSegmentWithPanels(viewer, C, seg);
      addLog('AUTO', `seg[${idx}] placed ${segPanels.length} panels`);
      newPanels.push(...segPanels);
    });

    addLog('AUTO', `total placed: ${newPanels.length} panels - adding entities to Cesium now`);

    // Step 3: Add each panel entity directly to Cesium (same pattern as Row tool).
    // This is the ONLY place entities are created for Auto Fill panels.
    // We do NOT use renderAllPanels here to avoid the React prop cycle timing issue.
    let entityCount = 0;
    newPanels.forEach(panel => {
      const entity = addPanelEntity(viewer, C, panel);
      if (entity) entityCount++;
    });

    addLog('AUTO', `entities added to Cesium: ${entityCount}/${newPanels.length}`);

    // Step 4: Update lastRenderedPanelsRef so the panels useEffect incremental diff
    // finds no changes and skips re-rendering (avoids double-add/remove cycle).
    lastRenderedPanelsRef.current = newPanels;

    // Step 5: Update React state.
    panelsRef.current = newPanels;
    onPanelsChange(newPanels);
    setPanelCount(newPanels.length);
    setStatusMsg(`Auto-roof: ${newPanels.length} panels on ${eligibleSegs.length} segments`);

    // Step 6: Force Cesium to render the scene with new entities.
    try { viewer.scene.requestRender(); } catch {}
    // Multiple render pumps to ensure tiles + panels are visible
    [100, 300, 600, 1200].forEach(t =>
      setTimeout(() => { try { viewer.scene.requestRender(); } catch {} }, t)
    );

    // Step 7: Release mutex and reset mode to 'select'.
    setTimeout(() => {
      autoFillRunningRef.current = false;
      onPlacementModeChange('select');
    }, 300);
  }"""

new = """  function handleAutoRoof(viewer: any, C: any) {
    // Mutex guard: prevent concurrent / double-execution of Auto Fill.
    if (autoFillRunningRef.current) {
      addLog('AUTO', 'handleAutoRoof: already running - skipped duplicate call');
      return;
    }
    autoFillRunningRef.current = true;

    const twinData = twinRef.current;
    if (!twinData || twinData.roofSegments.length === 0) {
      setStatusMsg('No roof segments - Solar API data required');
      addLog('AUTO', 'handleAutoRoof: no twinData or no roofSegments');
      autoFillRunningRef.current = false;
      return;
    }

    addLog('AUTO', `handleAutoRoof: ${twinData.roofSegments.length} segments, cesiumGroundElev=${cesiumGroundElevRef.current.toFixed(1)}m`);

    // Step 1: Clear ALL existing panel entities from Cesium viewer.
    panelMapRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    panelMapRef.current.clear();
    lastRenderedPanelsRef.current = [];

    const sortedSegs = [...twinData.roofSegments].sort((a: any, b: any) => b.sunshineHours - a.sunshineHours);
    const maxSunshine = sortedSegs[0]?.sunshineHours ?? 0;
    const minThreshold = maxSunshine * 0.5;
    const eligibleSegs = sortedSegs.filter((seg: any) =>
      seg.sunshineHours >= minThreshold && seg.areaM2 >= (PW * PH)
    );

    addLog('AUTO', `eligible: ${eligibleSegs.length}/${sortedSegs.length} segs`);

    // Step 2: Collect panel data from all segments (no Cesium entities yet).
    const newPanels: PlacedPanel[] = [];
    eligibleSegs.forEach((seg: any, idx: number) => {
      addLog('AUTO', `seg[${idx}] id=${seg.id} googlePanels=${seg.googlePanels?.length ?? 0} hAG=${seg.heightAboveGround?.toFixed(2)}m`);
      const segPanels = fillRoofSegmentWithPanels(viewer, C, seg);
      addLog('AUTO', `seg[${idx}] -> ${segPanels.length} panels`);
      newPanels.push(...segPanels);
    });

    addLog('AUTO', `total: ${newPanels.length} panels computed`);

    if (newPanels.length === 0) {
      setStatusMsg('Auto-roof: no panels placed (check roof segments)');
      autoFillRunningRef.current = false;
      onPlacementModeChange('select');
      return;
    }

    // Step 3: Use scene.clampToHeightMostDetailed to get ACTUAL 3D tile surface heights.
    // This is the same height source as the Row tool (which uses scene.pickPosition on click).
    // Our computed cesiumGroundElevRef may be off by 30m+ due to geoid undulation errors.
    // clampToHeightMostDetailed samples the actual Google Photorealistic 3D Tile mesh height.
    const cartesianPositions = newPanels.map(p =>
      C.Cartesian3.fromDegrees(p.lng, p.lat, 500) // start high, clamp down to surface
    );

    const doRender = (panels: PlacedPanel[]) => {
      // Add entities directly (same as Row tool pattern)
      let entityCount = 0;
      panels.forEach(panel => {
        const entity = addPanelEntity(viewer, C, panel);
        if (entity) entityCount++;
      });
      addLog('AUTO', `entities added: ${entityCount}/${panels.length}`);

      lastRenderedPanelsRef.current = panels;
      panelsRef.current = panels;
      onPanelsChange(panels);
      setPanelCount(panels.length);
      setStatusMsg(`Auto-roof: ${panels.length} panels on ${eligibleSegs.length} segments`);

      try { viewer.scene.requestRender(); } catch {}
      [200, 500, 1000, 2000].forEach(t =>
        setTimeout(() => { try { viewer.scene.requestRender(); } catch {} }, t)
      );

      setTimeout(() => {
        autoFillRunningRef.current = false;
        onPlacementModeChange('select');
      }, 400);
    };

    // Try clampToHeightMostDetailed for accurate surface heights
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
    }
  }"""

if old in content:
    content = content.replace(old, new, 1)
    with open('/workspace/components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS")
else:
    print("NOT FOUND")
    idx = content.find("function handleAutoRoof(viewer: any, C: any) {")
    print(f"Function found at: {idx}")