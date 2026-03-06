#!/usr/bin/env python3
"""
Add a visible BUILD v24 version badge to the SLD title block.
This makes it immediately obvious which version is rendering.
"""

with open('lib/sld-professional-renderer.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Loaded: {len(lines)} lines")

# Find the "SINGLE LINE DIAGRAM" title line
title_line = None
for i, line in enumerate(lines):
    if "'SINGLE LINE DIAGRAM'" in line and 'tbTitle' in line:
        title_line = i
        break

if title_line is None:
    print("ERROR: title line not found")
    exit(1)

print(f"Title line: {title_line+1}: {repr(lines[title_line][:80])}")

# Find the "PHOTOVOLTAIC SYSTEM" subtitle line (right after)
subtitle_line = None
for i in range(title_line, title_line + 5):
    if "'PHOTOVOLTAIC SYSTEM'" in lines[i]:
        subtitle_line = i
        break

if subtitle_line is None:
    print("ERROR: subtitle line not found")
    exit(1)

print(f"Subtitle line: {subtitle_line+1}: {repr(lines[subtitle_line][:80])}")

# Insert BUILD v24 badge right after the subtitle line
badge_code = """  // BUILD v24 version badge — visible on every render for deployment verification
  parts.push(rect(tbX, tbY+68, TB_W, 10, {fill: '#1B5E20', stroke: 'none', sw: 0}));
  parts.push(txt(tbX+TB_W/2, tbY+76, 'BUILD v24 \u2014 NEC CONDUCTOR SIZING ENGINE', {sz: 4.5, bold: true, anc: 'middle', fill: '#FFFFFF'}));
"""

lines = lines[:subtitle_line+1] + [badge_code] + lines[subtitle_line+1:]
print(f"OK: BUILD v24 badge inserted after subtitle line")

# Also update the tbY2 start to account for the extra 10px badge height
# Find: let tbY2 = tbY+68;
for i, line in enumerate(lines):
    if 'let tbY2 = tbY+68;' in line:
        lines[i] = lines[i].replace('let tbY2 = tbY+68;', 'let tbY2 = tbY+78; // BUILD v24: +10 for version badge')
        print(f"OK: tbY2 start adjusted at line {i+1}")
        break

with open('lib/sld-professional-renderer.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f"\nALL DONE — {len(lines)} lines")