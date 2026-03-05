with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ── Fix 1: Replace hardcoded racking section ──────────────────────────────
old_racking = """                {/* Mounting & Railing */}
                <div className="mb-4">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Railing & Mounting System</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Racking Brand', value: (proj?.selectedMounting?.manufacturer) || 'IronRidge' },
                      { label: 'Racking Model', value: (proj?.selectedMounting?.name) || 'XR100 Flush Mount' },
                      { label: 'System Type', value: proj?.systemType === 'ground' ? 'Ground Mount' : proj?.systemType === 'fence' ? 'Sol Fence Vertical' : 'Roof Mount' },
                      { label: 'Tilt / Azimuth', value: `${layout.groundTilt || 20}\u00b0 / ${layout.groundAzimuth || 180}\u00b0` },
                      { label: 'Rail Material', value: 'Anodized Aluminum 6005-T5' },
                      { label: 'Hardware', value: 'Stainless Steel Grade 316' },
                    ].map(item => (
                      <div key={item.label} className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-100">
                        <div className="text-xs text-slate-400 mb-0.5">{item.label}</div>
                        <div className="text-xs font-bold text-slate-800">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Roof Attachment */}
                <div>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Roof Attachment Hardware</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      {
                        label: 'Asphalt Shingle',
                        hardware: 'Flashed L-Foot + 5/16" \u00d7 3" lag bolt into rafter',
                        note: 'EPDM flashing, min. 2.5" rafter embedment',
                        icon: '\ud83c\udfe0',
                      },
                      {
                        label: 'Tile Roof',
                        hardware: 'QuickMount PV Tile Hook or tile replacement mount',
                        note: 'Remove tile, install flashing, replace tile',
                        icon: '\ud83c\udfdb\ufe0f',
                      },
                      {
                        label: 'Metal Roof',
                        hardware: 'S-5! PVKIT 2.0 clamp \u2014 no penetrations',
                        note: 'Clamp to standing seam, no roof penetrations',
                        icon: '\ud83c\udfd7\ufe0f',
                      },
                      {
                        label: 'Flat TPO/EPDM',
                        hardware: 'Esdec FlatFix Fusion ballasted system',
                        note: 'No penetrations, ballasted tray system',
                        icon: '\ud83c\udfe2',
                      },
                      {
                        label: 'Corrugated Metal',
                        hardware: 'SnapNrack Series 100 + EPDM washers',
                        note: 'Self-tapping screws into structural purlins',
                        icon: '\ud83c\udfed',
                      },
                      {
                        label: 'Ground Mount',
                        hardware: 'Unirac RM10 or IronRidge driven pier system',
                        note: 'Adjustable tilt 10\u201330\u00b0, galvanized steel piers',
                        icon: '\ud83c\udf31',
                      },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-sm">{item.icon}</span>
                          <div className="text-xs font-bold text-slate-700">{item.label}</div>
                        </div>
                        <div className="text-xs text-slate-600 mb-0.5">{item.hardware}</div>
                        <div className="text-xs text-slate-400">{item.note}</div>
                      </div>
                    ))}
                  </div>
                </div>"""

new_racking = """                {/* Mounting & Railing — system-type-aware */}
                <div className="mb-4">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Railing & Mounting System</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Racking Brand',  value: racking.rackingBrand },
                      { label: 'Racking Model',  value: racking.rackingModel },
                      { label: 'System Type',    value: systemTypeLabel },
                      { label: 'Tilt Range',     value: racking.tiltRange },
                      { label: 'Rail Material',  value: racking.railMaterial },
                      { label: 'Hardware',       value: racking.hardware },
                      { label: 'Attachment',     value: racking.attachmentType },
                      { label: 'Warranty',       value: racking.warranty },
                      { label: 'Certifications', value: racking.certifications },
                    ].map(item => (
                      <div key={item.label} className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-100">
                        <div className="text-xs text-slate-400 mb-0.5">{item.label}</div>
                        <div className="text-xs font-bold text-slate-800">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Attachment Hardware — system-type-aware */}
                <div>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{equipment.sectionTitle}</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {equipment.attachmentCards.map(item => (
                      <div key={item.label} className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-sm">{item.icon}</span>
                          <div className="text-xs font-bold text-slate-700">{item.label}</div>
                        </div>
                        <div className="text-xs text-slate-600 mb-0.5">{item.hardware}</div>
                        <div className="text-xs text-slate-400">{item.note}</div>
                      </div>
                    ))}
                  </div>
                </div>"""

if old_racking in content:
    content = content.replace(old_racking, new_racking, 1)
    print("✅ Racking section replaced")
else:
    print("❌ Racking section NOT found — checking partial match...")
    # Try to find a key substring
    if "Racking Brand', value: (proj?.selectedMounting?.manufacturer)" in content:
        print("  Found partial: selectedMounting line")
    if "'IronRidge'" in content:
        print("  Found: IronRidge hardcode")

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)