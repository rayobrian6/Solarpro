# SolarPro v31.2 — Auto Fill Panel Placement Diagnostic & Repair

## Phase 1: Diagnostic Investigation (READ ONLY)
- [ ] 1.1 Read handleAutoRoof() in SolarEngine3D.tsx — understand full flow
- [ ] 1.2 Read getWorldPosition() — understand coordinate system
- [ ] 1.3 Read addPanelEntity() — understand how panels are sized/positioned
- [ ] 1.4 Read roof segment data structure from Solar API
- [ ] 1.5 Read panelDims() — understand panel size calculation
- [ ] 1.6 Trace coordinate flow: Solar API → roof segment → panel lat/lng/height
- [ ] 1.7 Write AUTO_FILL_DIAGNOSTIC.md with root cause findings

## Phase 2: Fix Panel Coordinate Generation
- [ ] 2.1 Fix panel grid generation to use correct roof segment polygon clipping
- [ ] 2.2 Fix panel height to use roof surface z + PANEL_OFFSET

## Phase 3: Fix Panel Rendering
- [ ] 3.1 Fix panel dimensions (Cesium box dimensions in meters)
- [ ] 3.2 Ensure panels render above roof surface (not clipped inside mesh)

## Phase 4: Fix Panel Count Validation
- [ ] 4.1 Discard panels outside valid roof polygon bounds
- [ ] 4.2 Panel counter reflects only valid placed panels

## Phase 5: Build + Validate
- [ ] 5.1 TypeScript compile — zero errors
- [ ] 5.2 Full build — clean
- [ ] 5.3 Bump version, ZIP, git push