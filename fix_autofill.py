with open('/workspace/components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

# Lines are 0-indexed. handleAutoRoof function is lines 2283-2321 (1-indexed)
# That's indices 2282-2320 (0-indexed)

# Verify we're targeting the right lines
print("Line 2283 (0-idx 2282):", repr(lines[2282]))
print("Line 2311 (0-idx 2310):", repr(lines[2310]))
print("Line 2321 (0-idx 2320):", repr(lines[2320]))

# New handleAutoRoof function (lines 2283-2321, 1-indexed = indices 2282-2320, 0-indexed)
new_function = '''  function handleAutoRoof(viewer: any, C: any) {
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
  }
'''

# Replace lines 2282-2320 (0-indexed) = lines 2283-2321 (1-indexed)
start_idx = 2282  # 0-indexed, line 2283
end_idx = 2321    # 0-indexed exclusive, line 2321 is the closing brace

# Verify
print(f"\nReplacing lines {start_idx+1} to {end_idx} (1-indexed)")
print(f"First line to replace: {repr(lines[start_idx])}")
print(f"Last line to replace: {repr(lines[end_idx-1])}")

new_lines = lines[:start_idx] + [new_function] + lines[end_idx:]
print(f"\nNew total lines: {len(new_lines)}")

with open('/workspace/components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Done! File written successfully.")

# Verify the replacement
with open('/workspace/components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    verify_lines = f.readlines()
print(f"Verified total lines: {len(verify_lines)}")
print(f"Line 2283 after fix: {repr(verify_lines[2282])}")