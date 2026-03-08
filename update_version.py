with open('lib/version.ts', 'r') as f:
    content = f.read()

content = content.replace(
    "export const BUILD_VERSION = 'v32.8';",
    "export const BUILD_VERSION = 'v32.9';"
)
content = content.replace(
    "export const BUILD_DATE = '2026-03-08';",
    "export const BUILD_DATE = '2026-03-09';"
)

# Replace description
old_desc = "AUTO FILL RENDERING FIX v2 \u2014 panels now visible: handleAutoRoof now mirrors Row tool pattern exactly: (1) clears existing entities first, (2) calls addPanelEntity directly for each panel (same as Row tool), (3) updates lastRenderedPanelsRef to prevent panels useEffect from re-rendering, (4) multiple requestRender pumps to ensure visibility"
new_desc = "AUTO FILL RENDERING FIX v3 \u2014 clampToHeightMostDetailed: handleAutoRoof now uses scene.clampToHeightMostDetailed to get ACTUAL Google 3D Tile surface heights (same source as Row tool pickPosition). Fixes 30m+ height mismatch caused by EllipsoidTerrainProvider + geoid undulation fallback. Panels placed at real tile surface + PANEL_OFFSET. Falls back to computed heights if API unavailable."

content = content.replace(old_desc, new_desc)

with open('lib/version.ts', 'w') as f:
    f.write(content)

print("Done - version updated to v32.9")