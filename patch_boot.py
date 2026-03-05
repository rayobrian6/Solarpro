with open('components/3d/SolarEngine3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add geoidOffset back after the cesiumElev/elev lines in drawOverlays
old = """    const cesiumElev = cesiumGroundElevRef.current > 0
      ? cesiumGroundElevRef.current
      : googleElev + geoidUndulationOverlay;
    const elev = cesiumElev;"""

new = """    const cesiumElev = cesiumGroundElevRef.current > 0
      ? cesiumGroundElevRef.current
      : googleElev + geoidUndulationOverlay;
    const elev = cesiumElev;
    // geoidOffset: difference between Cesium ellipsoidal and Google orthometric heights.
    // Used to convert per-segment and per-corner elevations from Google to Cesium coords.
    const geoidOffset = cesiumElev - googleElev;"""

if old in content:
    content = content.replace(old, new)
    print("geoidOffset fix applied")
else:
    print("Pattern not found")

with open('components/3d/SolarEngine3D.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")