import re

with open('app/engineering/page.tsx', 'r') as f:
    content = f.read()

# Find the runCalc function and update it
old_block = '''  const runCalc = useCallback(async () => {
    setCalculating(true);
    setCalcError(null);
    setConfigDirty(false);
    try {
      const payload = buildCalcPayload();

      // Run legacy calculate + new rules engine in parallel
      const [calcRes, rulesRes] = await Promise.all([
        fetch('/api/engineering/calculate', {
          method: 'POST',
        cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        fetch('/api/engineering/rules', {
          method: 'POST',
        cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            electrical: { ...payload.electrical, designTempMin: -10, designTempMax: 40, rooftopTempAdder: 30, necVersion: '2023' },
            structural: payload.structural,
            engineeringMode,
            overrides,
          }),
        }),
      ]);

      const calcData = await calcRes.json();
      if (calcData.success) {
        setCompliance(calcData);'''

new_block = '''  const runCalc = useCallback(async () => {
    setCalculating(true);
    setCalcError(null);
    setConfigDirty(false);
    try {
      const payload = buildCalcPayload();

      // Get panel data for V2 structural calc
      const firstStrV2 = config.inverters[0]?.strings[0];
      const panelDataV2 = firstStrV2?.panelId ? (SOLAR_PANELS as any[]).find((p: any) => p.id === firstStrV2.panelId) : null;

      // Run legacy calculate + new rules engine + V2 structural in parallel
      const [calcRes, rulesRes, structV2Res] = await Promise.all([
        fetch('/api/engineering/calculate', {
          method: 'POST',
        cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        fetch('/api/engineering/rules', {
          method: 'POST',
        cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            electrical: { ...payload.electrical, designTempMin: -10, designTempMax: 40, rooftopTempAdder: 30, necVersion: '2023' },
            structural: payload.structural,
            engineeringMode,
            overrides,
          }),
        }),
        fetch('/api/engineering/structural-v2', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            windSpeed:      config.windSpeed,
            windExposure:   config.windExposure,
            groundSnowLoad: config.groundSnowLoad,
            roofType:       config.roofType,
            roofPitch:      config.roofPitch,
            rafterSpacing:  config.rafterSpacing,
            rafterSpan:     config.rafterSpan,
            rafterSize:     config.rafterSize,
            rafterSpecies:  config.rafterSpecies,
            framingType:    config.framingType,
            panelCount:     totalPanels,
            panelLength:    panelDataV2?.length ?? 70.9,
            panelWidth:     panelDataV2?.width ?? 41.7,
            panelWeight:    panelDataV2?.weight ?? 44.1,
            mountingSystem: config.mountingId?.includes('rt-mini') ? 'rt-mini' : 'rail-based',
            rowCount:       config.rowCount ?? 2,
          }),
        }).catch(() => null),  // V2 structural is best-effort
      ]);

      const calcData = await calcRes.json();
      if (calcData.success) {
        // Merge V2 structural results into compliance data
        try {
          if (structV2Res && structV2Res.ok) {
            const structV2Data = await structV2Res.json();
            if (structV2Data?.success) {
              calcData.structural = {
                // V2 fields (new)
                status:          structV2Data.status,
                framing:         structV2Data.framing,
                mountLayout:     structV2Data.mountLayout,
                railSystem:      structV2Data.railSystem,
                rackingBOM:      structV2Data.rackingBOM,
                wind:            structV2Data.wind,
                snow:            structV2Data.snow,
                errors:          structV2Data.errors,
                warnings:        structV2Data.warnings,
                recommendations: structV2Data.recommendations,
                complianceTable: structV2Data.complianceTable,
                // V1 compatibility fields (for existing UI references)
                attachment: { safetyFactor: structV2Data.summary?.safetyFactor },
                rafter:     { utilizationRatio: structV2Data.framing?.utilization },
              };
              // Auto-update framing type if detected
              if (structV2Data.framing?.type && config.framingType === 'unknown') {
                updateConfig({ framingType: structV2Data.framing.type });
              }
            }
          }
        } catch (_) { /* V2 structural merge is best-effort */ }

        setCompliance(calcData);'''

if old_block in content:
    content = content.replace(old_block, new_block, 1)
    with open('app/engineering/page.tsx', 'w') as f:
        f.write(content)
    print("SUCCESS: runCalc updated with V2 structural integration")
else:
    print("ERROR: Could not find the target block")
    # Show what we're looking for
    idx = content.find("const runCalc = useCallback")
    if idx >= 0:
        print(f"Found runCalc at index {idx}")
        print(repr(content[idx:idx+200]))