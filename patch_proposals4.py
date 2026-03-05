with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find start line (0-indexed): line containing "Mounting & Railing" comment
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if 'Mounting & Railing' in line:
        start_idx = i
        break

if start_idx is None:
    print("❌ Could not find 'Mounting & Railing'")
    exit(1)

print(f"Start at line {start_idx+1}: {lines[start_idx].rstrip()}")

# Find end: look for the blank line after the closing </div> of the Roof Attachment section
# The section ends with two consecutive </div> lines followed by a blank line
depth = 0
for i in range(start_idx, len(lines)):
    line = lines[i]
    opens = line.count('<div')
    closes = line.count('</div>')
    depth += opens - closes
    # We want to find where depth returns to 0 (the outer div closes)
    if i > start_idx + 5 and depth <= 0:
        end_idx = i
        break

print(f"End at line {end_idx+1}: {lines[end_idx].rstrip()}")

new_section = """                {/* Mounting & Railing — system-type-aware via systemEquipmentResolver */}
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
                </div>

"""

new_lines = lines[:start_idx] + [new_section] + lines[end_idx+1:]

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"✅ Replaced lines {start_idx+1}–{end_idx+1} with system-type-aware racking section")