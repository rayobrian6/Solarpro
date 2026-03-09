"""
Fix PRIMARY PATH to use clipPoly setback, and fix FALLBACK PATH grid alignment
"""

with open('components/3d/SolarEngine3D.tsx', 'r') as f:
    content = f.read()

original_len = len(content)

# FIX: PRIMARY PATH - add clipPoly check for each Google panel
old_primary_check = """        const panel = createPanel({
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

new_primary_check = """        // Apply setback: skip panels outside the shrunk clip polygon
        if (clipPoly.length >= 3 && !pointInPolygon(gp.lat, gp.lng, clipPoly)) {
          skipped++; continue;
        }

        const panel = createPanel({
          lat: gp.lat, lng: gp.lng, height: pHeight,
          tilt: pitchDeg, azimuth: azDeg, systemType: 'roof',
          heading, pitch: pitchDeg, roll: 0, orientation: gpOrient,
        });
        panels.push(panel);
        placed++;"""

if old_primary_check in content:
    content = content.replace(old_primary_check, new_primary_check)
    print("Fix PRIMARY PATH: setback clip applied to Google panels")
else:
    print("ERROR: PRIMARY PATH panel push not found")

# FIX: FALLBACK PATH - remove duplicate SETBACK constant (already defined as SETBACK_M_FILL)
old_fallback_setback = """    const SETBACK = 0.5;

    const originCart = C.Carte"""
new_fallback_setback = """    const SETBACK = SETBACK_M_FILL; // use same setback as clip polygon

    const originCart = C.Carte"""

if old_fallback_setback in content:
    content = content.replace(old_fallback_setback, new_fallback_setback)
    print("Fix FALLBACK PATH: unified SETBACK constant")
else:
    print("WARNING: FALLBACK SETBACK not found (may be ok)")

print(f"\nContent: {original_len} -> {len(content)} (+{len(content)-original_len} chars)")

with open('components/3d/SolarEngine3D.tsx', 'w') as f:
    f.write(content)

print("Done")