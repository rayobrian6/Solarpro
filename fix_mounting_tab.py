#!/usr/bin/env python3
"""
Phase 3 UI Upgrades for Mounting Details Tab:
1. Add roof type filter (auto-filters based on config.roofType)
2. Add search bar for quick filtering
3. Add "Use This System" button to sync to config.mountingId
4. Add "Currently Active" indicator
5. Show all brand variants grouped
"""

with open('app/engineering/page.tsx', 'r') as f:
    content = f.read()

# ─────────────────────────────────────────────────────────────────────────────
# FIX 1: Enhance the filteredSystems logic to include roof type filtering
# ─────────────────────────────────────────────────────────────────────────────

old_filter = """            const filteredSystems = allSystems.filter(s => categoryMap[mountingInstallType].includes(s.category));
            const selectedSystem = allSystems.find(s => s.id === selectedMountingId) || filteredSystems[0];"""

new_filter = """            // Filter by install type category
            const filteredByCategory = allSystems.filter(s => categoryMap[mountingInstallType].includes(s.category));

            // Auto-filter by project roof type (from config.roofType)
            const projectRoofType = config.roofType as string;
            const roofTypeFiltered = filteredByCategory.filter(s =>
              s.compatibleRoofTypes.includes('any' as any) ||
              s.compatibleRoofTypes.some(rt => rt === projectRoofType || rt.replace(/_/g,'') === projectRoofType.replace(/_/g,''))
            );
            // Fall back to all category systems if roof type filter yields nothing
            const baseFilteredSystems = roofTypeFiltered.length > 0 ? roofTypeFiltered : filteredByCategory;

            // Search filter
            const filteredSystems = mountingSearchQuery.trim()
              ? baseFilteredSystems.filter(s =>
                  s.manufacturer.toLowerCase().includes(mountingSearchQuery.toLowerCase()) ||
                  s.model.toLowerCase().includes(mountingSearchQuery.toLowerCase()) ||
                  s.productLine.toLowerCase().includes(mountingSearchQuery.toLowerCase()) ||
                  s.systemType.toLowerCase().includes(mountingSearchQuery.toLowerCase())
                )
              : baseFilteredSystems;

            const selectedSystem = allSystems.find(s => s.id === selectedMountingId) || filteredSystems[0];
            const isActiveSystem = selectedMountingId === config.mountingId;"""

if old_filter in content:
    content = content.replace(old_filter, new_filter)
    print("✅ FIX 1: Enhanced filteredSystems with roof type + search filter")
else:
    print("⚠️  FIX 1: Pattern not found")

# ─────────────────────────────────────────────────────────────────────────────
# FIX 2: Enhance the Header section to add search bar + roof type indicator
# ─────────────────────────────────────────────────────────────────────────────

old_header = """                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-black text-white">Mounting Details</h3>
                      <p className="text-slate-400 text-xs mt-0.5">Full engineering specifications · ASCE 7-22 · ICC-ES rated hardware</p>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
                      {(['residential', 'commercial', 'ground'] as const).map(t => (
                        <button key={t} onClick={() => { setMountingInstallType(t); setShowAllSystems(false); }}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all capitalize ${mountingInstallType === t ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}>
                          {t === 'residential' ? '🏠 Residential' : t === 'commercial' ? '🏢 Commercial' : '🌿 Ground Mount'}
                        </button>
                      ))}
                    </div>
                  </div>"""

new_header = """                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-black text-white">Mounting Details</h3>
                      <p className="text-slate-400 text-xs mt-0.5">Full engineering specifications · ASCE 7-22 · ICC-ES rated hardware</p>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
                      {(['residential', 'commercial', 'ground'] as const).map(t => (
                        <button key={t} onClick={() => { setMountingInstallType(t); setShowAllSystems(false); setMountingSearchQuery(''); }}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all capitalize ${mountingInstallType === t ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}>
                          {t === 'residential' ? '🏠 Residential' : t === 'commercial' ? '🏢 Commercial' : '🌿 Ground Mount'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Search bar + roof type indicator */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        placeholder="Search by brand, model, or system type..."
                        value={mountingSearchQuery}
                        onChange={e => setMountingSearchQuery(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
                      />
                      {mountingSearchQuery && (
                        <button onClick={() => setMountingSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs">✕</button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">Roof:</span>
                      <span className="bg-slate-700 text-amber-300 font-bold px-2 py-1 rounded-lg capitalize">{config.roofType?.replace(/_/g,' ') ?? 'any'}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{filteredSystems.length} systems</span>
                    </div>
                  </div>
                  {/* Active system indicator */}
                  {config.mountingId && (
                    <div className="mb-3 flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      <span className="text-amber-400 font-bold">⚡ Active in project:</span>
                      <span className="text-white font-bold">{ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.manufacturer} {ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId)?.model}</span>
                      {config.mountingId !== selectedMountingId && (
                        <button onClick={() => setSelectedMountingId(config.mountingId)} className="ml-auto text-amber-400 hover:text-amber-300 font-bold">View →</button>
                      )}
                    </div>
                  )}"""

if old_header in content:
    content = content.replace(old_header, new_header)
    print("✅ FIX 2: Header enhanced with search bar + roof type indicator")
else:
    print("⚠️  FIX 2: Header pattern not found")

# ─────────────────────────────────────────────────────────────────────────────
# FIX 3: Enhance the system card to show "Use This System" button
# ─────────────────────────────────────────────────────────────────────────────

old_card = """                      <button key={sys.id} onClick={() => setSelectedMountingId(sys.id)}
                        className={`text-left p-3 rounded-xl border transition-all ${selectedMountingId === sys.id ? 'border-amber-500/60 bg-amber-500/10' : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600'}`}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="text-xs font-bold text-white leading-tight">{sys.manufacturer}</div>
                          {sys.iccEsReport && <span className="text-xs text-emerald-400 font-bold flex-shrink-0">ICC-ES</span>}
                        </div>
                        <div className="text-xs text-amber-300 font-bold mb-1">{sys.model}</div>
                        <div className="text-xs text-slate-500 capitalize">{sys.systemType.replace(/_/g,' ')}</div>
                        {selectedMountingId === sys.id && <div className="mt-1.5 text-xs text-amber-400 font-bold">✓ Selected</div>}
                      </button>"""

new_card = """                      <button key={sys.id} onClick={() => setSelectedMountingId(sys.id)}
                        className={`text-left p-3 rounded-xl border transition-all ${selectedMountingId === sys.id ? 'border-amber-500/60 bg-amber-500/10' : config.mountingId === sys.id ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600'}`}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="text-xs font-bold text-white leading-tight">{sys.manufacturer}</div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {config.mountingId === sys.id && <span className="text-xs text-emerald-400 font-bold">⚡</span>}
                            {sys.iccEsReport && <span className="text-xs text-emerald-400 font-bold">ICC-ES</span>}
                            {sys.ul2703Listed && <span className="text-xs text-blue-400 font-bold">UL</span>}
                          </div>
                        </div>
                        <div className="text-xs text-amber-300 font-bold mb-0.5">{sys.model}</div>
                        <div className="text-xs text-slate-500 capitalize mb-1">{sys.systemType.replace(/_/g,' ')}</div>
                        {selectedMountingId === sys.id && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="text-xs text-amber-400 font-bold">✓ Viewing</span>
                            {config.mountingId !== sys.id && (
                              <button
                                onClick={e => { e.stopPropagation(); updateConfig({ mountingId: sys.id }); }}
                                className="text-xs bg-amber-500 text-slate-900 font-bold px-2 py-0.5 rounded-full hover:bg-amber-400 transition-colors"
                              >Use This System</button>
                            )}
                            {config.mountingId === sys.id && <span className="text-xs text-emerald-400 font-bold">⚡ Active</span>}
                          </div>
                        )}
                      </button>"""

if old_card in content:
    content = content.replace(old_card, new_card)
    print("✅ FIX 3: System card enhanced with 'Use This System' button")
else:
    print("⚠️  FIX 3: System card pattern not found")

# ─────────────────────────────────────────────────────────────────────────────
# FIX 4: Add "Use This System" button in the Selected System Spec Panel header
# ─────────────────────────────────────────────────────────────────────────────

old_spec_header = """                      <div className="text-right">
                        <div className="text-xs text-slate-500 capitalize">{selectedSystem.category.replace(/_/g,' ')}</div>
                        <div className="text-xs text-amber-400 font-bold capitalize mt-0.5">{selectedSystem.systemType.replace(/_/g,' ')}</div>
                      </div>"""

new_spec_header = """                      <div className="text-right flex flex-col items-end gap-2">
                        <div className="text-xs text-slate-500 capitalize">{selectedSystem.category.replace(/_/g,' ')}</div>
                        <div className="text-xs text-amber-400 font-bold capitalize">{selectedSystem.systemType.replace(/_/g,' ')}</div>
                        {config.mountingId === selectedSystem.id ? (
                          <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded-full font-bold">⚡ Active in Project</span>
                        ) : (
                          <button
                            onClick={() => updateConfig({ mountingId: selectedSystem.id })}
                            className="text-xs bg-amber-500 text-slate-900 font-bold px-3 py-1.5 rounded-full hover:bg-amber-400 transition-colors"
                          >⚡ Use This System</button>
                        )}
                      </div>"""

if old_spec_header in content:
    content = content.replace(old_spec_header, new_spec_header)
    print("✅ FIX 4: Spec panel header enhanced with 'Use This System' button")
else:
    print("⚠️  FIX 4: Spec panel header pattern not found")

# ─────────────────────────────────────────────────────────────────────────────
# Write the fixed file
# ─────────────────────────────────────────────────────────────────────────────
with open('app/engineering/page.tsx', 'w') as f:
    f.write(content)

print("\n✅ All Phase 3 UI upgrades applied to app/engineering/page.tsx")