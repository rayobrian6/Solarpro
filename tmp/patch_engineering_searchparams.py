import re

content = open('app/engineering/page.tsx', 'r').read()

# 1. Add useSearchParams import
old_import = "'use client';\nimport React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';"
new_import = "'use client';\nimport React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';\nimport { useSearchParams } from 'next/navigation';"

if old_import in content:
    content = content.replace(old_import, new_import, 1)
    print('Import added OK')
else:
    print('Import NOT FOUND - checking...')
    idx = content.find("import React")
    print(repr(content[idx-20:idx+100]))

# 2. Add auto-load effect after the component function declaration
# Find the line: const [config, setConfig] = useState<ProjectConfig>(defaultProject);
old_state = "  const [config, setConfig] = useState<ProjectConfig>(defaultProject);"
new_state = """  const searchParams = useSearchParams();
  const [config, setConfig] = useState<ProjectConfig>(defaultProject);
  const [projectAutoLoaded, setProjectAutoLoaded] = useState(false);
  const [autoLoadBanner, setAutoLoadBanner] = useState<string | null>(null);

  // Auto-load project data when ?projectId= is in the URL
  useEffect(() => {
    const projectId = searchParams?.get('projectId');
    if (!projectId || projectAutoLoaded) return;
    setProjectAutoLoaded(true);

    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success || !data.project) return;
        const p = data.project;
        const layout = p.layout;

        // Build panel count and system size from layout
        const panelCount = layout?.totalPanels || 0;
        const systemKw = layout?.systemSizeKw || 0;

        // Determine inverter type from selected inverter
        const invType = p.selectedInverter?.type === 'micro' ? 'micro'
                      : p.selectedInverter?.type === 'optimizer' ? 'optimizer'
                      : 'string';

        // Build string configs from panel count
        const panelsPerString = invType === 'micro' ? 1 : Math.min(panelCount, 12);
        const stringCount = invType === 'micro' ? panelCount : Math.max(1, Math.ceil(panelCount / panelsPerString));
        const strings = Array.from({ length: stringCount }, (_, i) => ({
          id: `str-auto-${i}`,
          label: `String ${i + 1}`,
          panelCount: i === stringCount - 1 ? panelCount - (panelsPerString * (stringCount - 1)) || panelsPerString : panelsPerString,
          panelId: p.selectedPanel?.id || 'qcells-peak-duo-400',
          tilt: layout?.groundTilt || 20,
          azimuth: layout?.groundAzimuth || 180,
          roofType: 'shingle' as const,
          mountingSystem: p.selectedMounting?.id || 'ironridge-xr100',
          wireGauge: '#10 AWG',
          wireLength: 50,
        }));

        // Parse state from address
        const stateMatch = (p.address || '').match(/,\\s*([A-Z]{2})(?:\\s+\\d{5})?(?:\\s*,|\\s*$)/);
        const stateCode = p.stateCode || (stateMatch ? stateMatch[1] : '');
        const cityParts = (p.address || '').split(',');
        const city = p.city || (cityParts.length >= 2 ? cityParts[cityParts.length - 2].trim() : '');

        setConfig(prev => ({
          ...prev,
          projectName: p.name || prev.projectName,
          clientName: p.client?.name || prev.clientName,
          address: p.address || prev.address,
          state: stateCode || prev.state,
          city: city || prev.city,
          county: p.county || prev.county || '',
          systemType: p.systemType || prev.systemType,
          inverters: [{
            id: `inv-auto-0`,
            inverterId: p.selectedInverter?.id || prev.inverters[0]?.inverterId || '',
            type: invType,
            strings,
          }],
          batteryId: p.selectedBatteries?.[0]?.id || prev.batteryId,
          batteryCount: p.batteryCount || prev.batteryCount,
          mountingId: p.selectedMounting?.id || prev.mountingId,
          utilityId: p.utilityId || prev.utilityId,
        }));

        setAutoLoadBanner(`Loaded from project: ${p.name}${panelCount ? ` (${panelCount} panels, ${systemKw.toFixed(1)} kW)` : ''}`);
      })
      .catch(err => console.warn('[engineering] auto-load failed:', err));
  }, [searchParams, projectAutoLoaded]);"""

if old_state in content:
    content = content.replace(old_state, new_state, 1)
    print('State/effect added OK')
else:
    print('State NOT FOUND')
    idx = content.find('useState<ProjectConfig>')
    print(repr(content[idx-10:idx+80]))

open('app/engineering/page.tsx', 'w').write(content)
print('File written OK')