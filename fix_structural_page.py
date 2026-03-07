#!/usr/bin/env python3
"""
Fix Structural page to use getAllMountingSystems() instead of RACKING_SYSTEMS.
This addresses the core issue: only 7 brands showing instead of 38.
"""

import re

with open('app/engineering/page.tsx', 'r') as f:
    content = f.read()

original = content

# ─────────────────────────────────────────────────────────────────────────────
# FIX 1: Add a useMemo-based allMountingSystems at the top of the component
# We'll add it right after the getAllMountingSystems import is already there.
# We need to add a const at the top of the component body.
# Find the first useState in the component and add before it.
# ─────────────────────────────────────────────────────────────────────────────

# The import is already there (line 15). We need to add a const in the component.
# Find a good anchor — the first useState call in the component
# We'll add allMountingSystems as a module-level const (outside component) since it's static data

# Add module-level const after the import line
old_import = "import { getAllMountingSystems, getMountingSystemsByCategory, getMountingSystemsByRoofType, type MountingSystemSpec, type SystemCategory as MountingCategory } from '@/lib/mounting-hardware-db';"
new_import = """import { getAllMountingSystems, getMountingSystemsByCategory, getMountingSystemsByRoofType, type MountingSystemSpec, type SystemCategory as MountingCategory } from '@/lib/mounting-hardware-db';

// ── Mounting systems from the canonical mounting-hardware-db (38 systems, 24 manufacturers) ──
const ALL_MOUNTING_SYSTEMS: MountingSystemSpec[] = getAllMountingSystems();
const MOUNTING_BRANDS: string[] = Array.from(new Set(ALL_MOUNTING_SYSTEMS.map(s => s.manufacturer))).sort();"""

content = content.replace(old_import, new_import)

# ─────────────────────────────────────────────────────────────────────────────
# FIX 2: Replace the structural calc mountSpecs section (lines ~765-775)
# Old: uses RACKING_SYSTEMS with old field names
# New: uses ALL_MOUNTING_SYSTEMS with MountingSystemSpec field names
# ─────────────────────────────────────────────────────────────────────────────

old_structural_calc = """        // FIX: pass mountSpecs from RACKING_SYSTEMS so structural calc uses correct load model
        const racking = RACKING_SYSTEMS.find(r => r.id === config.mountingId);
        const mountSpecs = racking ? {
          loadModel: racking.loadModel,
          fastenersPerAttachment: racking.fastenersPerAttachment,
          upliftCapacity: racking.upliftCapacity,
          tributaryArea: racking.tributaryArea,
          attachmentSpacingMax: racking.attachmentSpacingMax,
        } : undefined;"""

new_structural_calc = """        // Use mounting-hardware-db (38 systems) for structural calc specs
        const mountingSystem = ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId);
        const mountSpecs = mountingSystem ? {
          loadModel: mountingSystem.mount?.loadModel ?? 'distributed',
          fastenersPerAttachment: mountingSystem.mount?.fastenersPerMount ?? 2,
          upliftCapacity: mountingSystem.mount?.upliftCapacityLbs ?? 500,
          tributaryArea: mountingSystem.mount?.tributaryAreaSqFt,
          attachmentSpacingMax: mountingSystem.mount?.maxSpacingIn,
        } : undefined;"""

content = content.replace(old_structural_calc, new_structural_calc)

# ─────────────────────────────────────────────────────────────────────────────
# FIX 3: Replace the rackingIdMap with a comprehensive auto-generated one
# ─────────────────────────────────────────────────────────────────────────────

old_racking_map = """      // Map config.mountingId to a V4 racking ID
      const rackingIdMap: Record<string, string> = {
        'ironridge-xr100':    'ironridge-xr100',
        'ironridge-xr1000':   'ironridge-xr1000',
        'snapnrack-100':      'snapnrack-100',
        'unirac-sunframe':    'unirac-sunframe',
        'unirac-rm-ballast':  'unirac-rm-ballast',
        'rooftech-rt-mini':   'rooftech-rt-mini',
        'quickmount-classic': 'quickmount-classic',
        'ecofasten-rock-it':  'ecofasten-rock-it',
        's5-pvkit':           's5-pvkit',
        'plp-power-peak':     'plp-power-peak',
      };
      const rackingId = rackingIdMap[config.mountingId] || config.mountingId || 'ironridge-xr100';"""

new_racking_map = """      // Map config.mountingId to a V4 racking ID (auto-includes all mounting-hardware-db IDs)
      const rackingIdMap: Record<string, string> = {
        // Legacy ID mappings (old IDs → new IDs)
        'rooftech-rt-mini':   'rooftech-mini',
        'unirac-sunframe':    'unirac-solarmount',
        'unirac-rm-ballast':  'unirac-rm10-evo',
        'snapnrack-series-100': 'snapnrack-100',
        'quickmount-tile-hook': 'quickmount-tile',
        's5-pvkit-2':         's5-pvkit',
        'ecofasten-rock-it':  'ecofasten-rockit',
        'plp-power-peak':     'ironridge-xr100',
        // Current IDs pass through (all 42 systems in mounting-hardware-db)
        ...Object.fromEntries(ALL_MOUNTING_SYSTEMS.map(s => [s.id, s.id])),
      };
      const rackingId = rackingIdMap[config.mountingId] || config.mountingId || 'ironridge-xr100';"""

content = content.replace(old_racking_map, new_racking_map)

# ─────────────────────────────────────────────────────────────────────────────
# FIX 4: Replace the Racking System UI section (Brand + Model dropdowns)
# Old: uses RACKING_SYSTEMS (7 brands)
# New: uses ALL_MOUNTING_SYSTEMS (38 systems, 24 brands)
# ─────────────────────────────────────────────────────────────────────────────

old_racking_ui = """                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Mount Brand</label>
                    <select
                      value={RACKING_SYSTEMS.find(r => r.id === config.mountingId)?.manufacturer ?? ''}
                      onChange={e => {
                        const first = RACKING_SYSTEMS.find(r => r.manufacturer === e.target.value);
                        if (first) updateConfig({ mountingId: first.id });
                      }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                    >
                      {Array.from(new Set(RACKING_SYSTEMS.map(r => r.manufacturer))).map(brand => (
                        <option key={brand} value={brand}>{brand}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Mount Type / Model</label>
                    <select value={config.mountingId} onChange={e => updateConfig({ mountingId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {RACKING_SYSTEMS
                        .filter(r => r.manufacturer === (RACKING_SYSTEMS.find(x => x.id === config.mountingId)?.manufacturer ?? RACKING_SYSTEMS[0]?.manufacturer))
                        .map(r => <option key={r.id} value={r.id}>{r.model}</option>)}
                    </select>
                  </div>"""

new_racking_ui = """                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Mount Brand</label>
                    <select
                      value={ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.manufacturer ?? MOUNTING_BRANDS[0]}
                      onChange={e => {
                        const first = ALL_MOUNTING_SYSTEMS.find(s => s.manufacturer === e.target.value);
                        if (first) updateConfig({ mountingId: first.id });
                      }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                    >
                      {MOUNTING_BRANDS.map(brand => (
                        <option key={brand} value={brand}>{brand}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Mount Type / Model</label>
                    <select value={config.mountingId} onChange={e => updateConfig({ mountingId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {ALL_MOUNTING_SYSTEMS
                        .filter(s => s.manufacturer === (ALL_MOUNTING_SYSTEMS.find(x => x.id === config.mountingId)?.manufacturer ?? MOUNTING_BRANDS[0]))
                        .map(s => <option key={s.id} value={s.id}>{s.model}</option>)}
                    </select>
                  </div>"""

content = content.replace(old_racking_ui, new_racking_ui)

# ─────────────────────────────────────────────────────────────────────────────
# FIX 5: Replace the "Selected mount structural specs" display
# Old: uses RACKING_SYSTEMS with old field names (loadModel, fastenersPerAttachment, upliftCapacity)
# New: uses ALL_MOUNTING_SYSTEMS with MountingSystemSpec field names
# ─────────────────────────────────────────────────────────────────────────────

old_specs_display = """                {(() => {
                  const sel = RACKING_SYSTEMS.find(r => r.id === config.mountingId);
                  if (!sel) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2">
                      <span>Load model: <span className="text-white font-bold">{sel.loadModel ?? 'distributed'}</span></span>
                      {sel.fastenersPerAttachment && <span>Fasteners/mount: <span className="text-amber-300 font-bold">{sel.fastenersPerAttachment}</span></span>}
                      {sel.upliftCapacity && <span>Uplift capacity: <span className="text-amber-300 font-bold">{sel.upliftCapacity} lbf/lag</span></span>}
                      <span className="text-slate-500 italic ml-auto">Mount spacing is calculated from wind/snow loads.</span>
                    </div>
                  );
                })()}"""

new_specs_display = """                {(() => {
                  const sel = ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId);
                  if (!sel) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2">
                      <span>System: <span className="text-white font-bold">{sel.systemType.replace(/_/g, ' ')}</span></span>
                      <span>Load model: <span className="text-white font-bold">{sel.mount?.loadModel ?? 'distributed'}</span></span>
                      {sel.mount?.fastenersPerMount && <span>Fasteners/mount: <span className="text-amber-300 font-bold">{sel.mount.fastenersPerMount}</span></span>}
                      {sel.mount?.upliftCapacityLbs && <span>Uplift capacity: <span className="text-amber-300 font-bold">{sel.mount.upliftCapacityLbs} lbf</span></span>}
                      {sel.maxWindSpeedMph && <span>Max wind: <span className="text-amber-300 font-bold">{sel.maxWindSpeedMph} mph</span></span>}
                      {sel.maxSnowLoadPsf && <span>Max snow: <span className="text-amber-300 font-bold">{sel.maxSnowLoadPsf} psf</span></span>}
                      {sel.ul2703Listed && <span className="text-emerald-400 font-bold">✓ UL 2703</span>}
                      <span className="text-slate-500 italic ml-auto">Mount spacing is calculated from wind/snow loads.</span>
                    </div>
                  );
                })()}"""

content = content.replace(old_specs_display, new_specs_display)

# ─────────────────────────────────────────────────────────────────────────────
# FIX 6: Replace the footer "Racking system" label (line ~6016)
# ─────────────────────────────────────────────────────────────────────────────

old_footer = """                        <span className="text-xs text-slate-500 ml-1">Derived from array geometry · ASCE 7-22 loads · {RACKING_SYSTEMS.find(r => r.id === config.mountingId)?.manufacturer ?? 'Racking'} system</span>"""

new_footer = """                        <span className="text-xs text-slate-500 ml-1">Derived from array geometry · ASCE 7-22 loads · {ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.manufacturer ?? 'Racking'} system</span>"""

content = content.replace(old_footer, new_footer)

# ─────────────────────────────────────────────────────────────────────────────
# Verify all RACKING_SYSTEMS references are gone (except the import)
# ─────────────────────────────────────────────────────────────────────────────

remaining = [i+1 for i, line in enumerate(content.split('\n')) if 'RACKING_SYSTEMS' in line]
print(f"Remaining RACKING_SYSTEMS references at lines: {remaining}")

# Count replacements
fixes = [
    ("Import + module const", old_import, new_import),
    ("Structural calc mountSpecs", old_structural_calc, new_structural_calc),
    ("rackingIdMap", old_racking_map, new_racking_map),
    ("Racking UI dropdowns", old_racking_ui, new_racking_ui),
    ("Specs display", old_specs_display, new_specs_display),
    ("Footer label", old_footer, new_footer),
]

for name, old, new in fixes:
    if old in original:
        if new in content:
            print(f"  ✅ {name}: replaced successfully")
        else:
            print(f"  ❌ {name}: replacement FAILED")
    else:
        print(f"  ⚠️  {name}: old text NOT FOUND in original")

with open('app/engineering/page.tsx', 'w') as f:
    f.write(content)

print(f"\nDone. File written.")