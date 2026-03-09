with open('components/3d/SolarEngine3D.tsx', 'r') as f:
    content = f.read()

# 1. Add pick_house to toolbar buttons list
old_toolbar = "            { mode: 'auto_roof' as PlacementMode, icon: '\u2728', label: 'Auto' },"
new_toolbar = "            { mode: 'auto_roof' as PlacementMode, icon: '\u2728', label: 'Auto' },\n            { mode: 'pick_house' as PlacementMode, icon: '\U0001f3e1', label: 'Pick House' },"

if old_toolbar in content:
    content = content.replace(old_toolbar, new_toolbar)
    print("Step 1 done: toolbar button added")
else:
    print("ERROR: toolbar string not found")
    idx = content.find("auto_roof' as PlacementMode")
    if idx >= 0:
        print(repr(content[max(0,idx-20):idx+80]))

# 2. Update active tool indicator to include pick_house
old_indicator = "               placementMode === 'auto_roof' ? '\u2728 Auto Fill' : placementMode}"
new_indicator = "               placementMode === 'auto_roof' ? '\u2728 Auto Fill' :\n               placementMode === 'pick_house' ? '\U0001f3e1 Pick House' : placementMode}"

if old_indicator in content:
    content = content.replace(old_indicator, new_indicator)
    print("Step 2 done: tool indicator updated")
else:
    print("ERROR: indicator string not found")
    idx = content.find("auto_roof' ? '\u2728 Auto Fill'")
    if idx >= 0:
        print(repr(content[max(0,idx-20):idx+80]))

# 3. Add pick_house status message when mode changes
old_mode_effect = "    if (placementMode === 'auto_roof' && prevMode !== 'auto_roof') {"
new_mode_effect = "    if (placementMode === 'pick_house' && prevMode !== 'pick_house') {\n      setStatusMsg('\U0001f3e1 Click any house on the map to select it as the target property');\n    }\n    if (placementMode === 'auto_roof' && prevMode !== 'auto_roof') {"

if old_mode_effect in content:
    content = content.replace(old_mode_effect, new_mode_effect)
    print("Step 3 done: pick_house status message added")
else:
    print("ERROR: mode effect string not found")

with open('components/3d/SolarEngine3D.tsx', 'w') as f:
    f.write(content)

print("All done")