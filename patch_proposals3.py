import re

with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the racking section by line numbers and replace it
lines = content.split('\n')

# Find start: line with "Railing & Mounting System"
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if 'Railing & Mounting System' in line and 'text-xs font-bold' in line:
        start_idx = i - 1  # include the <div className="mb-4"> line
        break

if start_idx is None:
    print("❌ Could not find start of racking section")
    exit(1)

print(f"Found racking section start at line {start_idx + 1}: {lines[start_idx]}")

# Find end: the closing </div> after the attachment cards section
# We need to find the second major section end after "Roof Attachment Hardware"
attachment_idx = None
for i in range(start_idx, len(lines)):
    if 'Roof Attachment Hardware' in lines[i] or 'attachment' in lines[i].lower() and 'sectionTitle' not in lines[i]:
        attachment_idx = i
        break

if attachment_idx:
    print(f"Found attachment section at line {attachment_idx + 1}")

# Count div depth to find the matching closing div
depth = 0
in_section = False
for i in range(start_idx, len(lines)):
    line = lines[i]
    opens = line.count('<div') + line.count('<div ')
    closes = line.count('</div>')
    if i == start_idx:
        in_section = True
    if in_section:
        depth += opens - closes
        if depth <= 0 and i > start_idx + 5:
            end_idx = i
            break

print(f"Found racking section end at line {end_idx + 1 if end_idx else 'NOT FOUND'}")

if end_idx is None:
    print("❌ Could not find end of racking section")
    exit(1)

# Print the section we're replacing
print(f"\nReplacing lines {start_idx+1} to {end_idx+1}:")
print('\n'.join(lines[start_idx:start_idx+3]))
print("...")
print('\n'.join(lines[end_idx-2:end_idx+2]))

# Build replacement
new_racking_lines = """                {/* Mounting & Railing — system-type-aware */}
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
                </div>""".split('\n')

# Replace the lines
new_lines = lines[:start_idx] + new_racking_lines + lines[end_idx+1:]

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))

print(f"\n✅ Replaced {end_idx - start_idx + 1} lines with {len(new_racking_lines)} lines")
print("✅ Racking section updated to use systemEquipmentResolver")