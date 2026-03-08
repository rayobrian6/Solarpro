with open('/workspace/components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old = """        const panel = createPanel({
          lat: pLat, lng: pLng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: pitchDeg, roll: 0, orientation: orient,
        });
        panels.push(panel);
        addPanelEntity(viewer, C, panel);
        placed++;"""

new = """        const panel = createPanel({
          lat: pLat, lng: pLng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: pitchDeg, roll: 0, orientation: orient,
        });
        panels.push(panel);
        // NOTE: Do NOT call addPanelEntity here.
        // handleAutoRoof calls renderAllPanels(newPanels) after collecting all segments.
        placed++;"""

if old in content:
    content = content.replace(old, new, 1)
    with open('/workspace/components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: FALLBACK PATH fixed")
else:
    print("NOT FOUND - searching...")
    idx = content.find("addPanelEntity(viewer, C, panel);\n        placed++;")
    if idx >= 0:
        print(f"Found at {idx}:")
        print(repr(content[idx-300:idx+100]))
    else:
        print("Still not found")