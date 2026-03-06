with open('lib/sld-renderer.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the old static legend box + header lines (they're now inside the legendItems block)
old_static = """  parts.push(rect(legX, legY, 180, 130, { fill: '#FAFAFA', stroke: C.border, strokeW: 1, rx: 3 }));
  parts.push(text(legX + 90, legY + 16, 'LEGEND', { size: F.label, weight: 'bold' }));
  parts.push(line(legX, legY + 22, legX + 180, legY + 22, { stroke: '#CCC', strokeW: 1 }));
  const legendItems = ["""

new_static = """  const legendItems = ["""

if old_static in content:
    content = content.replace(old_static, new_static)
    print("SUCCESS: Removed duplicate legend box header")
else:
    print("ERROR: Could not find duplicate legend header")

with open('lib/sld-renderer.ts', 'w', encoding='utf-8') as f:
    f.write(content)