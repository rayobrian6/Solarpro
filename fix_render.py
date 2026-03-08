with open('/workspace/components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old = """    // Replace ALL panels with Auto Fill result (do NOT append to existing panels).
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
  }"""

new = """    // Replace ALL panels with Auto Fill result (do NOT append to existing panels).
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

if old in content:
    content = content.replace(old, new, 1)
    with open('/workspace/components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: replacement done")
else:
    # Try to find the section
    idx = content.find("// Replace ALL panels with Auto Fill result")
    if idx >= 0:
        print(f"Found marker at index {idx}")
        print(repr(content[idx:idx+600]))
    else:
        print("ERROR: marker not found")