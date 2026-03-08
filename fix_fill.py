with open('/workspace/components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix PRIMARY PATH - remove direct addPanelEntity call
old1 = """        const panel = createPanel({
          lat: gp.lat, lng: gp.lng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: pitchDeg, roll: 0, orientation: gpOrient,
        });
        panels.push(panel);
        addPanelEntity(viewer, C, panel);
        placed++;"""

new1 = """        const panel = createPanel({
          lat: gp.lat, lng: gp.lng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: pitchDeg, roll: 0, orientation: gpOrient,
        });
        panels.push(panel);
        // NOTE: Do NOT call addPanelEntity here.
        // handleAutoRoof calls renderAllPanels(newPanels) after collecting all segments,
        // which does a clean full-rebuild. Direct addPanelEntity here would cause
        // entities to be added then immediately removed by renderAllPanels full-rebuild.
        placed++;"""

if old1 in content:
    content = content.replace(old1, new1, 1)
    print("Fix 1 (PRIMARY PATH): SUCCESS")
else:
    print("Fix 1 (PRIMARY PATH): NOT FOUND")
    idx = content.find("addPanelEntity(viewer, C, panel);\n        placed++;")
    print(f"  Search result idx: {idx}")
    if idx > 0:
        print(repr(content[idx-200:idx+100]))

# Find and fix FALLBACK PATH addPanelEntity call
# First let's find it
idx2 = content.find("addPanelEntity(viewer, C, panel);\n        placed++;")
if idx2 < 0:
    # Try alternate spacing
    idx2 = content.find("addPanelEntity(viewer, C, panel);")
    print(f"Fallback search: found at {idx2}")
    if idx2 > 0:
        print(repr(content[idx2-100:idx2+100]))

with open('/workspace/components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("File written.")