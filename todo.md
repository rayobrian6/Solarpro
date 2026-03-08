# SolarPro v30.9 — Panel Placement Engine Upgrade

## Phase 1: New Placement Engine Library
- [ ] 1.1 Create lib/placementEngine.ts — grid snapping, setback zones, orientation, row generation
- [ ] 1.2 Add orientation ('portrait'|'landscape') to PlacedPanel type + DesignToolState
- [ ] 1.3 Add setback config type (FireSetbackConfig) to types/index.ts

## Phase 2: DesignStudio Upgrades
- [ ] 2.1 Add orientation toggle (Portrait/Landscape) to sidebar + toolbar
- [ ] 2.2 Add fire setback controls (edge/ridge/pathway) to sidebar
- [ ] 2.3 Upgrade autoPlacePanels() to use new engine with setbacks + orientation
- [ ] 2.4 Upgrade fillRoof() to use fire-code setbacks + orientation
- [ ] 2.5 Add multi-row placement tool (row count selector + auto-generate rows)
- [ ] 2.6 Add setback zone overlay rendering on canvas (red/green zones)
- [ ] 2.7 Add grid snap visual feedback on canvas

## Phase 3: panelLayoutOptimized.ts Upgrades
- [ ] 3.1 Add orientation support (portrait/landscape swaps width/height)
- [ ] 3.2 Add azimuth-aligned grid rotation for roof arrays
- [ ] 3.3 Add fire setback inset to generateRoofLayoutOptimized()

## Phase 4: Build + Version
- [ ] 4.1 TypeScript compile check — zero errors
- [ ] 4.2 Full build — clean
- [ ] 4.3 Bump version to v30.9, package ZIP, push to git