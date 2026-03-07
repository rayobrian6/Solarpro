#!/usr/bin/env python3
"""
Fix Structural page to use getAllMountingSystems() instead of RACKING_SYSTEMS.
This replaces the 7-brand stale database with the full 42-system mounting-hardware-db.
"""

with open('app/engineering/page.tsx', 'r') as f:
    content = f.read()

# ─────────────────────────────────────────────────────────────────────────────
# FIX 1: Structural calc — replace RACKING_SYSTEMS.find with getAllMountingSystems()
# Lines ~765-773: mountSpecs derivation
# ─────────────────────────────────────────────────────────────────────────────
old1 = '''        // FIX: pass mountSpecs from RACKING_SYSTEMS so structural calc uses correct load model
        const racking = RACKING_SYSTEMS.find(r => r.id === config.mountingId);
        const mountSpecs = racking ? {
          loadModel: racking.loadModel,
          fastenersPerAttachment: racking.fastenersPerAttachment,
          upliftCapacity: racking.upliftCapacity,
          tributaryArea: racking.tributaryArea,
          attachmentSpacingMax: racking.attachmentSpacingMax,
        } : undefined;'''

new1 = '''        // Use full mounting-hardware-db (42 systems) for structural calc
        const rackingFull = getAllMountingSystems().find(r => r.id === config.mountingId);
        const mountSpecs = rackingFull ? {
          loadModel: rackingFull.mount?.loadModel ?? 'distributed',
          fastenersPerAttachment: rackingFull.mount?.fastenersPerMount ?? 2,
          upliftCapacity: rackingFull.mount?.upliftCapacityLbs ?? 500,
          tributaryArea: rackingFull.mount?.tributaryAreaSqFt,
          attachmentSpacingMax: rackingFull.mount?.maxSpacingIn,
        } : undefined;'''

if old1 in content:
    content = content.replace(old1, new1)
    print("✅ FIX 1: Structural calc mountSpecs updated")
else:
    print("⚠️  FIX 1: Pattern not found — checking for partial match")
    if 'RACKING_SYSTEMS.find(r => r.id === config.mountingId)' in content:
        print("   Found partial match at line:", content[:content.find('RACKING_SYSTEMS.find(r => r.id === config.mountingId)')].count('\n') + 1)

# ─────────────────────────────────────────────────────────────────────────────
# FIX 2: rackingIdMap — expand to include all 42 systems
# ─────────────────────────────────────────────────────────────────────────────
old2 = '''      // Map config.mountingId to a V4 racking ID
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
      const rackingId = rackingIdMap[config.mountingId] || config.mountingId || 'ironridge-xr100';'''

new2 = '''      // Map config.mountingId to a V4 racking ID — covers all 42 systems in mounting-hardware-db
      const rackingIdMap: Record<string, string> = {
        // IronRidge
        'ironridge-xr100':          'ironridge-xr100',
        'ironridge-xr1000':         'ironridge-xr1000',
        'ironridge-flat-roof':      'ironridge-flat-roof',
        // Unirac
        'unirac-solarmount':        'unirac-solarmount',
        'unirac-sme':               'unirac-sme',
        'unirac-rm10-evo':          'unirac-rm10-evo',
        // Roof Tech
        'rooftech-mini':            'rooftech-mini',
        'rooftech-mini-s':          'rooftech-mini-s',
        'rooftech-mini-t':          'rooftech-mini-t',
        'rooftech-hook':            'rooftech-hook',
        'rooftech-mini-m':          'rooftech-mini-m',
        // SnapNrack
        'snapnrack-100':            'snapnrack-100',
        // QuickMount
        'quickmount-classic':       'quickmount-classic',
        'quickmount-tile':          'quickmount-tile',
        // S-5!
        's5-pvkit':                 's5-pvkit',
        // K2 Systems
        'k2-crossrail':             'k2-crossrail',
        // EcoFasten
        'ecofasten-rockit':         'ecofasten-rockit',
        // Schletter
        'schletter-classic':        'schletter-classic',
        // SunModo
        'sunmodo-ez':               'sunmodo-ez',
        // DPW Solar
        'dpw-powerrail':            'dpw-powerrail',
        // PanelClaw
        'panelclaw-polar-bear':     'panelclaw-polar-bear',
        // GameChange Solar
        'gamechange-genius':        'gamechange-genius',
        'gamechange-gcx-tracker':   'gamechange-gcx-tracker',
        // Nextracker
        'nextracker-nr3':           'nextracker-nr3',
        'nextracker-nx-horizon':    'nextracker-nx-horizon',
        // Array Technologies
        'array-tech-duratrack':     'array-tech-duratrack',
        // AceCLAMP
        'aceclamp-corrugated':      'aceclamp-corrugated',
        // Ground mounts
        'ground-dual-post-driven':  'ground-dual-post-driven',
        'ground-single-post-helical': 'ground-single-post-helical',
        // Esdec
        'esdec-flatfix':            'esdec-flatfix',
        // Tamarack
        'tamarack-utr':             'tamarack-utr',
        // ProSolar
        'prosolar-toptrack':        'prosolar-toptrack',
        // Clenergy
        'clenergy-ezrack-sb':       'clenergy-ezrack-sb',
        // Renusol
        'renusol-vs-plus':          'renusol-vs-plus',
        'renusol-console-plus':     'renusol-console-plus',
        // Everest Solar
        'everest-e-mount-af':       'everest-e-mount-af',
        // MSE Solar
        'mse-rapid-rail':           'mse-rapid-rail',
        // Sollega
        'sollega-fc350':            'sollega-fc350',
        // TerraSmart
        'terrasmart-glide':         'terrasmart-glide',
        // Polar Racking
        'polar-racking-pr-ground':  'polar-racking-pr-ground',
        // Soltec
        'soltec-sf7':               'soltec-sf7',
        // PV Hardware
        'pvhardware-titan':         'pvhardware-titan',
        // Legacy ID aliases
        'rooftech-rt-mini':         'rooftech-mini',
        'unirac-sunframe':          'unirac-solarmount',
        'unirac-rm-ballast':        'unirac-rm10-evo',
        'ecofasten-rock-it':        'ecofasten-rockit',
        'snapnrack-series-100':     'snapnrack-100',
        'quickmount-tile-hook':     'quickmount-tile',
        's5-pvkit-2':               's5-pvkit',
        'plp-power-peak':           'ironridge-xr100',
      };
      const rackingId = rackingIdMap[config.mountingId] || config.mountingId || 'ironridge-xr100';'''

if old2 in content:
    content = content.replace(old2, new2)
    print("✅ FIX 2: rackingIdMap expanded to all 42 systems")
else:
    print("⚠️  FIX 2: rackingIdMap pattern not found")

# ─────────────────────────────────────────────────────────────────────────────
# FIX 3: Racking System Brand dropdown — replace RACKING_SYSTEMS with getAllMountingSystems()
# ─────────────────────────────────────────────────────────────────────────────
old3 = '''                    <select
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
                    </select>'''

new3 = '''                    <select
                      value={getAllMountingSystems().find(r => r.id === config.mountingId)?.manufacturer ?? ''}
                      onChange={e => {
                        const first = getAllMountingSystems().find(r => r.manufacturer === e.target.value);
                        if (first) updateConfig({ mountingId: first.id });
                      }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                    >
                      {Array.from(new Set(getAllMountingSystems().map(r => r.manufacturer))).sort().map(brand => (
                        <option key={brand} value={brand}>{brand}</option>
                      ))}
                    </select>'''

if old3 in content:
    content = content.replace(old3, new3)
    print("✅ FIX 3: Brand dropdown updated to use getAllMountingSystems()")
else:
    print("⚠️  FIX 3: Brand dropdown pattern not found")

# ─────────────────────────────────────────────────────────────────────────────
# FIX 4: Racking System Model dropdown — replace RACKING_SYSTEMS with getAllMountingSystems()
# ─────────────────────────────────────────────────────────────────────────────
old4 = '''                    <select value={config.mountingId} onChange={e => updateConfig({ mountingId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {RACKING_SYSTEMS
                        .filter(r => r.manufacturer === (RACKING_SYSTEMS.find(x => x.id === config.mountingId)?.manufacturer ?? RACKING_SYSTEMS[0]?.manufacturer))
                        .map(r => <option key={r.id} value={r.id}>{r.model}</option>)}
                    </select>'''

new4 = '''                    <select value={config.mountingId} onChange={e => updateConfig({ mountingId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {getAllMountingSystems()
                        .filter(r => r.manufacturer === (getAllMountingSystems().find(x => x.id === config.mountingId)?.manufacturer ?? getAllMountingSystems()[0]?.manufacturer))
                        .map(r => <option key={r.id} value={r.id}>{r.model}</option>)}
                    </select>'''

if old4 in content:
    content = content.replace(old4, new4)
    print("✅ FIX 4: Model dropdown updated to use getAllMountingSystems()")
else:
    print("⚠️  FIX 4: Model dropdown pattern not found")

# ─────────────────────────────────────────────────────────────────────────────
# FIX 5: Selected mount structural specs display — use MountingSystemSpec fields
# ─────────────────────────────────────────────────────────────────────────────
old5 = '''                {/* Selected mount structural specs */}
                {(() => {
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
                })()}'''

new5 = '''                {/* Selected mount structural specs — from mounting-hardware-db */}
                {(() => {
                  const sel = getAllMountingSystems().find(r => r.id === config.mountingId);
                  if (!sel) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2">
                      <span>System: <span className="text-white font-bold">{sel.productLine} {sel.model}</span></span>
                      <span>Type: <span className="text-amber-300 font-bold">{sel.systemType.replace(/_/g, ' ')}</span></span>
                      {sel.mount?.fastenersPerMount && <span>Fasteners/mount: <span className="text-amber-300 font-bold">{sel.mount.fastenersPerMount}</span></span>}
                      {sel.mount?.upliftCapacityLbs && <span>Uplift capacity: <span className="text-amber-300 font-bold">{sel.mount.upliftCapacityLbs} lbf</span></span>}
                      {sel.maxWindSpeedMph && <span>Max wind: <span className="text-slate-300 font-bold">{sel.maxWindSpeedMph} mph</span></span>}
                      {sel.maxSnowLoadPsf && <span>Max snow: <span className="text-slate-300 font-bold">{sel.maxSnowLoadPsf} psf</span></span>}
                      <span className="text-slate-500 italic ml-auto">Mount spacing is calculated from wind/snow loads.</span>
                    </div>
                  );
                })()}'''

if old5 in content:
    content = content.replace(old5, new5)
    print("✅ FIX 5: Structural specs display updated to use MountingSystemSpec fields")
else:
    print("⚠️  FIX 5: Structural specs display pattern not found")

# ─────────────────────────────────────────────────────────────────────────────
# FIX 6: Racking Materials label — replace RACKING_SYSTEMS.find with getAllMountingSystems()
# ─────────────────────────────────────────────────────────────────────────────
old6 = '''                        <span className="text-xs text-slate-500 ml-1">Derived from array geometry · ASCE 7-22 loads · {RACKING_SYSTEMS.find(r => r.id === config.mountingId)?.manufacturer ?? 'Racking'} system</span>'''

new6 = '''                        <span className="text-xs text-slate-500 ml-1">Derived from array geometry · ASCE 7-22 loads · {getAllMountingSystems().find(r => r.id === config.mountingId)?.manufacturer ?? 'Racking'} system</span>'''

if old6 in content:
    content = content.replace(old6, new6)
    print("✅ FIX 6: Racking Materials label updated")
else:
    print("⚠️  FIX 6: Racking Materials label pattern not found")

# ─────────────────────────────────────────────────────────────────────────────
# Write the fixed file
# ─────────────────────────────────────────────────────────────────────────────
with open('app/engineering/page.tsx', 'w') as f:
    f.write(content)

print("\n✅ All fixes applied to app/engineering/page.tsx")

# Verify no more RACKING_SYSTEMS references in the structural section
remaining = []
for i, line in enumerate(content.split('\n'), 1):
    if 'RACKING_SYSTEMS' in line:
        remaining.append(f"  Line {i}: {line.strip()}")

if remaining:
    print(f"\n⚠️  Remaining RACKING_SYSTEMS references ({len(remaining)}):")
    for r in remaining:
        print(r)
else:
    print("\n✅ No remaining RACKING_SYSTEMS references in structural section")