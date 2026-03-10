with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── 1. Add useSearchParams import ───────────────────────────────────────────
old_import = "import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';"
new_import = "import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense } from 'react';\nimport { useSearchParams } from 'next/navigation';"

if old_import in content:
    content = content.replace(old_import, new_import)
    print('✅ Added useSearchParams import')
else:
    print('❌ Could not find React import line')

# ─── 2. Add MICROINVERTERS import if not already there ───────────────────────
# Already imported — just verify
if 'MICROINVERTERS' in content:
    print('✅ MICROINVERTERS already imported')

# ─── 3. Add seed state + auto-load effect after the existing state declarations
# Insert after the showDecisionLog state declaration
old_state_block = "  const [showDecisionLog, setShowDecisionLog] = useState(false);"

new_state_block = """  const [showDecisionLog, setShowDecisionLog] = useState(false);

  // ── Engineering Seed auto-load ─────────────────────────────────────────────
  const searchParams = useSearchParams();
  const [seedLoaded, setSeedLoaded] = useState(false);
  const [seedBanner, setSeedBanner] = useState<string | null>(null);

  useEffect(() => {
    const projectId = searchParams.get('projectId');
    if (!projectId || seedLoaded) return;

    const loadSeed = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        const data = await res.json();
        if (!data.success || !data.data) return;

        const proj = data.data;
        const seed = proj.engineeringSeed;

        // Build config patches from seed
        const patches: Partial<ProjectConfig> = {};

        if (proj.name) patches.projectName = proj.name;
        if (proj.address) patches.address = proj.address;
        if (proj.client?.name) patches.clientName = proj.client.name;
        if (proj.systemType) patches.systemType = proj.systemType as SystemType;

        if (seed) {
          // State code → utility lookup
          if (seed.state_code) patches.state = seed.state_code;

          // Inverter type
          const invType = seed.inverter_type as InverterType;
          const defaultInvId = invType === 'micro'
            ? (MICROINVERTERS[0]?.id ?? 'enphase-iq8plus')
            : (STRING_INVERTERS[0]?.id ?? 'se-7600h');

          // Panel count: distribute across strings
          // For micro: 1 string per inverter, all panels in one string
          const panelCount = seed.panel_count;
          const panelsPerString = invType === 'micro' ? panelCount : Math.min(panelCount, 13);
          const stringCount = invType === 'micro' ? 1 : Math.ceil(panelCount / panelsPerString);

          // Find best matching panel by wattage
          const targetWatt = seed.panel_watt;
          const bestPanel = SOLAR_PANELS.reduce((best, p) => {
            return Math.abs(p.wattage - targetWatt) < Math.abs(best.wattage - targetWatt) ? p : best;
          }, SOLAR_PANELS[0]);

          // Build strings
          const strings = Array.from({ length: stringCount }, (_, i) => ({
            id: `str-seed-${i}`,
            label: `String ${i + 1}`,
            panelCount: i === stringCount - 1
              ? panelCount - panelsPerString * (stringCount - 1)
              : panelsPerString,
            panelId: bestPanel?.id ?? 'rec-400aa',
            tilt: 20,
            azimuth: 180,
            roofType: 'shingle' as RoofType,
            mountingSystem: 'ironridge-xr100',
            wireGauge: '#10 AWG THWN-2',
            wireLength: 50,
          }));

          patches.inverters = [{
            id: `inv-seed-0`,
            inverterId: defaultInvId,
            type: invType,
            strings,
          }];

          // Utility: try to match by name
          if (seed.utility && seed.state_code) {
            const utils = getUtilitiesByState(seed.state_code);
            const matched = utils.find(u =>
              u.name.toLowerCase().includes(seed.utility.toLowerCase()) ||
              seed.utility.toLowerCase().includes(u.name.toLowerCase())
            );
            if (matched) patches.utilityId = matched.id;
          }

          setSeedBanner(
            `✅ Auto-loaded from bill: ${seed.system_kw} kW · ${seed.panel_count} panels · ${seed.annual_kwh.toLocaleString()} kWh/yr usage`
          );
        } else if (proj.layout) {
          // Fallback: use layout data if no seed
          setSeedBanner(`✅ Loaded project: ${proj.name}`);
        }

        if (Object.keys(patches).length > 0) {
          setConfig(prev => ({ ...prev, ...patches }));
        }
        setSeedLoaded(true);
      } catch (err) {
        console.warn('[EngineeringPage] Seed load failed:', err);
      }
    };

    loadSeed();
  }, [searchParams, seedLoaded]);"""

if old_state_block in content:
    content = content.replace(old_state_block, new_state_block)
    print('✅ Added seed state + auto-load effect')
else:
    print('❌ Could not find showDecisionLog state declaration')

# ─── 4. Wrap the export in Suspense for useSearchParams ──────────────────────
old_export = "export default function EngineeringPage() {"
new_export = """function EngineeringPageInner() {"""

if old_export in content:
    content = content.replace(old_export, new_export, 1)
    print('✅ Renamed EngineeringPage to EngineeringPageInner')
else:
    print('❌ Could not find export default function EngineeringPage')

# ─── 5. Add the seed banner UI just after the AppShell opening ────────────────
# Find the AppShell return and add banner after it
# We'll look for the first <AppShell> in the return statement
old_appshell = "  return (\n    <AppShell>"
new_appshell = """  return (
    <AppShell>
      {/* Engineering Seed Banner */}
      {seedBanner && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
          <span className="text-sm text-emerald-400 font-medium">{seedBanner}</span>
          <button
            onClick={() => setSeedBanner(null)}
            className="text-emerald-500/60 hover:text-emerald-400 text-xs ml-4"
          >✕</button>
        </div>
      )}"""

if old_appshell in content:
    content = content.replace(old_appshell, new_appshell, 1)
    print('✅ Added seed banner UI')
else:
    print('❌ Could not find AppShell return statement')

# ─── 6. Add Suspense wrapper + re-export at the end of the file ──────────────
# Find the last closing brace of the file and append the wrapper
old_last_line = "export { EngineeringPage };"
# The file likely ends with just the component — append wrapper at end
if 'EngineeringPageInner' in content and 'export default function EngineeringPage' not in content:
    # Add the Suspense wrapper export at the end
    content = content.rstrip() + """

export default function EngineeringPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="spinner w-8 h-8" /></div>}>
      <EngineeringPageInner />
    </Suspense>
  );
}
"""
    print('✅ Added Suspense wrapper export')

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')