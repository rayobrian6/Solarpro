#!/usr/bin/env python3
"""
Patch DesignStudio.tsx to add Auto Layout, Fill Roof, and Optimize Panel Layout
automation functions and toolbar buttons.
"""

with open('/workspace/components/design/DesignStudio.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── 1. Add automation functions after autoPlacePanels ───────────────────────
# Find the end of autoPlacePanels function
ANCHOR = "    setPanels(prev => [...prev, ...newPanels]);\n  };\n\n  // \u2500\u2500 Calculate production"

AUTOMATION_FUNCTIONS = """    setPanels(prev => [...prev, ...newPanels]);
  };

  // \u2500\u2500 Auto Layout: fill all existing zones with current settings \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const [autoLayoutRunning, setAutoLayoutRunning] = useState(false);

  const autoLayoutAll = useCallback(() => {
    const hasZones = roofPlanes.length > 0 || groundArea.length > 0 || fenceLine.length > 0;
    if (!hasZones) {
      toast.error('No zones defined', 'Draw a roof, ground, or fence zone first, then click Auto Layout.');
      return;
    }
    setAutoLayoutRunning(true);
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback, panelSpacing, rowSpacing,
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
      });
      allNew = [...allNew, ...newPanels];
    });

    if (groundArea.length >= 3) {
      const layoutId = uuidv4();
      const newPanels = generateGroundLayoutOptimized({
        layoutId, area: groundArea, panel: selectedPanel,
        tilt, azimuth, rowSpacing, panelSpacing, panelsPerRow, groundHeight,
      });
      allNew = [...allNew, ...newPanels];
    }

    if (fenceLine.length >= 2) {
      const layoutId = uuidv4();
      const newPanels = generateFenceLayout({
        layoutId, fenceLine, panel: selectedPanel,
        azimuth, panelSpacing, fenceHeight, bifacialOptimized,
      });
      allNew = [...allNew, ...newPanels];
    }

    setPanels(allNew);
    setAutoLayoutRunning(false);
    toast.success(
      'Auto Layout complete',
      `${allNew.length} panels placed \u00b7 ${(calculateSystemSize(allNew)).toFixed(2)} kW`
    );
  }, [roofPlanes, groundArea, fenceLine, selectedPanel, setback, panelSpacing, rowSpacing,
      tilt, azimuth, panelsPerRow, groundHeight, fenceHeight, bifacialOptimized]);

  // \u2500\u2500 Fill Roof: maximize panels with minimal setback (0.3 m) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const fillRoof = useCallback(() => {
    if (roofPlanes.length === 0 && groundArea.length === 0) {
      toast.error('No zones defined', 'Draw a roof or ground zone first.');
      return;
    }
    setAutoLayoutRunning(true);
    const minSetback = 0.3;
    const tightSpacing = 0.01;
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback: minSetback, panelSpacing: tightSpacing,
        rowSpacing: Math.max(rowSpacing * 0.85, selectedPanel.height + 0.05),
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
      });
      allNew = [...allNew, ...newPanels];
    });

    if (groundArea.length >= 3) {
      const layoutId = uuidv4();
      const newPanels = generateGroundLayoutOptimized({
        layoutId, area: groundArea, panel: selectedPanel,
        tilt, azimuth,
        rowSpacing: Math.max(rowSpacing * 0.85, selectedPanel.height + 0.05),
        panelSpacing: tightSpacing, panelsPerRow, groundHeight,
      });
      allNew = [...allNew, ...newPanels];
    }

    setPanels(allNew);
    setAutoLayoutRunning(false);
    toast.success(
      'Fill Roof complete',
      `${allNew.length} panels \u00b7 ${(calculateSystemSize(allNew)).toFixed(2)} kW (max density)`
    );
  }, [roofPlanes, groundArea, selectedPanel, rowSpacing, tilt, azimuth, panelsPerRow, groundHeight]);

  // \u2500\u2500 Optimize Layout: best production/cost ratio (wider row spacing) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const optimizeLayout = useCallback(() => {
    if (roofPlanes.length === 0 && groundArea.length === 0) {
      toast.error('No zones defined', 'Draw a roof or ground zone first.');
      return;
    }
    setAutoLayoutRunning(true);
    // Optimal row spacing: panel height / tan(tilt) * 2 to avoid inter-row shading
    const tiltRad = (tilt * Math.PI) / 180;
    const shadowLength = tiltRad > 0.05 ? selectedPanel.height * Math.cos(tiltRad) / Math.tan(tiltRad) : selectedPanel.height;
    const optRowSpacing = Math.max(rowSpacing, selectedPanel.height + shadowLength * 0.5);
    const optSetback = Math.max(setback, 0.6);
    let allNew: PlacedPanel[] = [];

    roofPlanes.forEach(plane => {
      const layoutId = uuidv4();
      const newPanels = generateRoofLayoutOptimized({
        layoutId, roofPlane: plane, panel: selectedPanel,
        setback: optSetback, panelSpacing: 0.02, rowSpacing: optRowSpacing,
        tilt: plane.pitch ?? tilt, azimuth: plane.azimuth ?? azimuth,
      });
      allNew = [...allNew, ...newPanels];
    });

    if (groundArea.length >= 3) {
      const layoutId = uuidv4();
      const newPanels = generateGroundLayoutOptimized({
        layoutId, area: groundArea, panel: selectedPanel,
        tilt, azimuth, rowSpacing: optRowSpacing, panelSpacing: 0.02,
        panelsPerRow, groundHeight,
      });
      allNew = [...allNew, ...newPanels];
    }

    setPanels(allNew);
    setAutoLayoutRunning(false);
    toast.success(
      'Optimized Layout complete',
      `${allNew.length} panels \u00b7 ${(calculateSystemSize(allNew)).toFixed(2)} kW \u00b7 min shading`
    );
  }, [roofPlanes, groundArea, selectedPanel, setback, rowSpacing, tilt, azimuth, panelsPerRow, groundHeight]);

  // \u2500\u2500 Calculate production"""

if ANCHOR in content:
    content = content.replace(ANCHOR, AUTOMATION_FUNCTIONS, 1)
    print("✅ Automation functions inserted successfully")
else:
    print("❌ ANCHOR not found for automation functions")
    # Try to find what's around line 1188
    lines = content.split('\n')
    for i, line in enumerate(lines[1185:1195], start=1186):
        print(f"  Line {i}: {repr(line)}")

# ─── 2. Add toolbar buttons ───────────────────────────────────────────────────
# Find the panel count display + existing buttons area
TOOLBAR_ANCHOR = """        <div className="flex items-center gap-2 ml-auto">
          {panels.length > 0 && (
            <div className="flex items-center gap-3 text-xs bg-slate-800/60 rounded-lg px-3 py-1.5">
              <span className="text-slate-400">{panels.length} panels</span>
              <span className="text-amber-400 font-bold">{systemSizeKw.toFixed(2)} kW</span>
            </div>
          )}
          <button
            onClick={() => setShowPanels(!showPanels)}"""

TOOLBAR_REPLACEMENT = """        <div className="flex items-center gap-2 ml-auto">
          {/* Automation buttons */}
          {(roofPlanes.length > 0 || groundArea.length > 0 || fenceLine.length > 0) && (
            <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg px-2 py-1">
              <button
                onClick={autoLayoutAll}
                disabled={autoLayoutRunning}
                className="btn-sm btn-secondary flex items-center gap-1 text-xs"
                title="Auto Layout: fill all zones with current settings"
              >
                {autoLayoutRunning ? <Loader size={11} className="animate-spin" /> : <Zap size={11} className="text-amber-400" />}
                Auto Layout
              </button>
              <button
                onClick={fillRoof}
                disabled={autoLayoutRunning}
                className="btn-sm btn-secondary flex items-center gap-1 text-xs"
                title="Fill Roof: maximize panel count with minimal setback"
              >
                <Layers size={11} className="text-teal-400" />
                Fill Roof
              </button>
              <button
                onClick={optimizeLayout}
                disabled={autoLayoutRunning}
                className="btn-sm btn-secondary flex items-center gap-1 text-xs"
                title="Optimize: best production/cost ratio with inter-row shading avoidance"
              >
                <TrendingUp size={11} className="text-purple-400" />
                Optimize
              </button>
            </div>
          )}
          {panels.length > 0 && (
            <div className="flex items-center gap-3 text-xs bg-slate-800/60 rounded-lg px-3 py-1.5">
              <span className="text-slate-400">{panels.length} panels</span>
              <span className="text-amber-400 font-bold">{systemSizeKw.toFixed(2)} kW</span>
            </div>
          )}
          <button
            onClick={() => setShowPanels(!showPanels)}"""

if TOOLBAR_ANCHOR in content:
    content = content.replace(TOOLBAR_ANCHOR, TOOLBAR_REPLACEMENT, 1)
    print("✅ Toolbar buttons inserted successfully")
else:
    print("❌ ANCHOR not found for toolbar buttons")
    # Debug: show what's around the expected location
    idx = content.find('flex items-center gap-2 ml-auto')
    if idx >= 0:
        print(f"  Found 'ml-auto' at char {idx}")
        print(f"  Context: {repr(content[idx-50:idx+200])}")

with open('/workspace/components/design/DesignStudio.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ File written successfully")