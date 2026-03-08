# SolarPro v30.5 — Multi-Feature Development

## Task 1: Generator Wire Run (Conditional Display + Data Flow)
- [x] 1.1 Add generatorWireLength field to engineering config state
- [x] 1.2 Add conditional UI input: "Generator to ATS Wire Length" (only shows when generator selected)
- [x] 1.3 Wire generatorWireLength through ComputedSystem (runLengthsBatteryGen.generatorToAts)
- [x] 1.4 SLD picks up correct wire gauge/length from GENERATOR_TO_ATS_RUN (sld-professional-renderer.ts line 1059)
- [x] 1.5 BOM picks up GENERATOR_TO_ATS_RUN wire via runs[] in bom-engine-v4.ts (all runs included)

## Task 2: 3D Design Performance Optimization
- [ ] 2.1 Implement incremental/diff rendering in renderAllPanels (only add/remove changed panels)
- [ ] 2.2 Debounce the panels useEffect to avoid rapid re-renders on bulk operations
- [ ] 2.3 Verify no existing 3D features are broken

## Task 3: Ground Mount Placement Feature
- [x] 3.1 3D ground placement already works (handleGroundClick in SolarEngine3D.tsx)
- [x] 3.2 2D ground zone drawing already works (draw_ground mode in DesignStudio.tsx)
- [ ] 3.3 Verify ground mount data flows to BOM/engineering (check systemType='ground' in BOM)
- [ ] 3.4 Add "Ground Mount" row placement to 3D (row mode for ground panels, similar to roof row)

## Final Steps
- [ ] 4.1 TypeScript compile check — zero errors
- [ ] 4.2 Full build — clean
- [ ] 4.3 Bump version, package ZIP, push to git