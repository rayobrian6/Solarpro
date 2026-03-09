with open('components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the exact block to replace using unique anchors
start_marker = '    // \u2500\u2500 Solar placement rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'
end_marker = '      addLog(\'AUTO\', `seg ${seg.id}: OK az=${azDeg.toFixed(0)} pitch=${pitchDeg.toFixed(0)} dist=${dist.toFixed(0)}m area=${seg.areaM2.toFixed(0)}m2`);\n      return true;\n    });'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1:
    print("ERROR: start_marker not found")
    # Try alternate
    start_marker2 = 'const MAX_BUILDING_RADIUS_M = 25;'
    idx2 = content.find(start_marker2)
    print(f"  MAX_BUILDING_RADIUS_M=25 at: {idx2}")
else:
    print(f"start_marker found at: {start_idx}")

if end_idx == -1:
    print("ERROR: end_marker not found")
else:
    print(f"end_marker found at: {end_idx}")
    end_idx_full = end_idx + len(end_marker)
    
    old_block = content[start_idx:end_idx_full]
    print(f"Block length: {len(old_block)} chars")
    print("First 100 chars:", repr(old_block[:100]))
    print("Last 100 chars:", repr(old_block[-100:]))