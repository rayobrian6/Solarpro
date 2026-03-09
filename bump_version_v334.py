with open('lib/version.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    "export const BUILD_VERSION = 'v33.3';",
    "export const BUILD_VERSION = 'v33.4';"
)
content = content.replace(
    "export const BUILD_DATE = '2026-03-09';",
    "export const BUILD_DATE = '2026-03-10';"
)
content = content.replace(
    "export const BUILD_DESCRIPTION = 'AUTO FILL RENDERING FIX v3 \u2014 clampToHeightMostDetailed: handleAutoRoof now uses scene.clampToHeightMostDetailed to get ACTUAL Google 3D Tile surface heights (same source as Row tool pickPosition). Fixes 30m+ height mismatch caused by EllipsoidTerrainProvider + geoid undulation fallback. Panels placed at real tile surface + PANEL_OFFSET. Falls back to computed heights if API unavailable.';",
    "export const BUILD_DESCRIPTION = 'AUTO FILL FIX v4 \u2014 distToRef: handleAutoRoof now uses twinData.lat/lng (Solar API center) as reference for distance filtering instead of stale component props. MAX_BUILDING_RADIUS_M increased 25m\u219240m. Fallback: if all segs filtered by distance, relax constraint to closest building cluster. North-facing threshold fixed (az<45 not az<=45). Panels now correctly placed on picked house after Pick House workflow.';"
)

with open('lib/version.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Version bumped to v33.4")