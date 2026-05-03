# SolarPro v61.2 — Display Mode + Single Source of Truth

## Phase 1: Audit current string/inverter rendering (find exact mixing points)
- [ ] A1. Find all places that render string count/layout in the UI
- [ ] A2. Find all places that render inverter model in the UI
- [ ] A3. Find computeSystem call sites and what feeds them
- [ ] A4. Find header panel count display
- [ ] A5. Find the "change project" button and diagnose why it doesn't work

## Phase 2: Core infrastructure
- [ ] B1. Add DisplayMode type + state to engineering page (default 'current')
- [ ] B2. Build currentDisplayConfig and recommendedDisplayConfig objects
- [ ] B3. Build displayConfig selector (single source of truth)

## Phase 3: Patch UI components
- [ ] C1. Patch string layout rendering to use displayConfig.strings
- [ ] C2. Patch inverter card to use displayConfig.inverter
- [ ] C3. Patch header summary panel count
- [ ] C4. Patch validation/compliance computeSystem to use displayConfig
- [ ] C5. Add Display Mode toggle UI (Current | Recommended)
- [ ] C6. Update warning/mismatch card copy

## Phase 4: Apply + SolarDog
- [ ] D1. Update onApplyRecommendation to reset displayMode to 'current'
- [ ] D2. Add SolarDog knowledge about display mode
- [ ] D3. Expose setDisplayMode to SolarDog context

## Phase 5: Fix "change project" button
- [ ] E1. Diagnose and fix change project button

## Phase 6: Tests + commit
- [ ] F1. Add test cases for display mode (4 required)
- [ ] F2. TypeScript check
- [ ] F3. Full test suite run
- [ ] F4. Commit to dev