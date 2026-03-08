# SolarPro Auto Fill Rendering & Placement Fix v31.7

## Phase 1: Deep Audit
- [ ] Trace addPanelEntity() — verify it adds to Cesium scene
- [ ] Check renderMode TERRAIN_ONLY — does it block panel rendering?
- [ ] Compare Auto Fill vs Row tool entity creation path
- [ ] Check depthTestAgainstTerrain setting on panel entities
- [ ] Verify panel height offset (PANEL_OFFSET) in Auto Fill path
- [ ] Check if panelMapRef is updated in Auto Fill
- [ ] Check if scene.requestRender() is called after Auto Fill

## Phase 2: Fix Rendering
- [ ] Ensure addPanelEntity() is called for every Auto Fill panel
- [ ] Ensure depthTestAgainstTerrain = false on panel boxes
- [ ] Ensure PANEL_OFFSET applied correctly
- [ ] Ensure scene.requestRender() called after fill

## Phase 3: Fix Placement Algorithm
- [ ] Wire Auto Fill through Row placement engine
- [ ] Apply fire setbacks (edge/ridge/pathway)
- [ ] Enforce convexHull polygon clipping
- [ ] Respect portrait/landscape orientation

## Phase 4: Validate
- [ ] TypeScript compile — 0 errors
- [ ] Build clean
- [ ] Version bump
- [ ] ZIP + git push