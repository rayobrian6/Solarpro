with open('/workspace/components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the handleAutoRoof function and replace it entirely
old = """  function handleAutoRoof(viewer: any, C: any) {
    // Mutex guard: prevent concurrent / double-execution of Auto Fill.
    // This fires from the placementMode useEffect only (NOT from the toolbar button directly).
    // Without this guard, rapid clicks or React re-renders can trigger multiple concurrent fills.
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

    // IMPORTANT: Start fresh - do NOT spread panelsRef.current here.
    // Previously used [...panelsRef.current, ...newPanels] which APPENDED panels
    // on every Auto Fill call, causing panel count to multiply on repeated clicks.
    const newPanels: PlacedPanel[] = [];
    const sortedSegs = [...twinData.roofSegments].sort((a: any, b: any) => b.sunshineHours - a.sunshineHours);
    const maxSunshine = sortedSegs[0]?.sunshineHours ?? 0;
    const minThreshold = maxSunshine * 0.5;

    const eligibleSegs = sortedSegs.filter((seg: any) =>
      seg.sunshineHours >= minThreshold && seg.areaM2 >= (PW * PH)
    );

    addLog('AUTO', `eligible: ${eligibleSegs.length}/${sortedSegs.length} segs (threshold=${minThreshold.toFixed(0)}h)`);

    eligibleSegs.forEach((seg: any, idx: number) => {
      addLog('AUTO', `seg[${idx}] id=${seg.id} area=${seg.areaM2?.toFixed(1)}m2 hAG=${seg.heightAboveGround?.toFixed(2)}m pitch=${seg.pitchDegrees?.toFixed(1)}deg az=${seg.azimuthDegrees?.toFixed(1)}deg maxP=${seg.maxPanels} googlePanels=${seg.googlePanels?.length ?? 0}`);
      const segPanels = fillRoofSegmentWithPanels(viewer, C, seg);
      addLog('AUTO', `seg[${idx}] placed ${segPanels.length} panels`);
      newPanels.push(...segPanels);
    });

    // Replace ALL panels with Auto Fill result (do NOT append to existing panels).
    panelsRef.current = newPanels;

    // Directly render panels into Cesium NOW (synchronous, bypasses React prop cycle).
    // This ensures panels are visible immediately without waiting for React re-render.
    // The panels useEffect will also fire later (via onPanelsChange) but renderAllPanels
    // is idempotent - it diffs and finds no changes since lastRenderedPanelsRef is updated here.
    if (renderAllPanelsRef.current) {
      addLog('AUTO', `calling renderAllPanels directly with ${newPanels.length} panels`);
      renderAllPanelsRef.current(viewer, C, newPanels);
    } else {
      addLog('AUTO', 'renderAllPanelsRef not set - panels will render via useEffect');
    }

    onPanelsChange(newPanels);
    setPanelCount(newPanels.length);
    setStatusMsg(`Auto-roof: ${newPanels.length} panels on ${eligibleSegs.length} segments`);
    addLog('AUTO', `total placed: ${newPanels.length} panels`);
    try { viewer.scene.requestRender(); } catch {}

    // Release mutex then reset mode to 'select'.
    // Delay ensures mode state settles before mutex releases,
    // preventing a rapid select->auto_roof re-trigger.
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

if old in content:
    content = content.replace(old, new, 1)
    with open('/workspace/components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: handleAutoRoof rewritten")
else:
    print("NOT FOUND - searching for key marker...")
    idx = content.find("function handleAutoRoof(viewer: any, C: any) {")
    if idx >= 0:
        print(f"Found at index {idx}")
        print(repr(content[idx:idx+200]))
    else:
        print("Function not found at all!")