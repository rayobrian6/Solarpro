# SolarPro — Lock Architecture Master Prompt (v61.3+)

## Phase 1: buildInverterConfig.ts — single factory ✅
- [x] Create lib/system/buildInverterConfig.ts
- [x] Create lib/system/__tests__/buildInverterConfig.test.ts (26 tests passing)
- [x] jest.config.ts + tsconfig.json exclude fix

## Phase 2: Patch open bugs C-06, C-07, C-09 ✅
- [x] C-06: Smart Defaults sets stringsPerInverter + modulesPerString metadata
- [x] C-07: newInverter(), addInverter('micro'), singleMicroInv → central builder
- [x] C-09: reconciler lower bound Math.max(1, target); extra strings use _buildStrCfg

## Phase 3: Demote mutators into suggesters ✅
- [x] P-03: Panel Count Fix setConfig uses _buildStrCfg + _buildInvCfg
- [x] P-09: Ecosystem Apply — auto-mode string rebuild via setTimeout + applySizingRecommendation
- [x] P-04: Hydration Repair — inv-seed-0, inv-auto-0, inv-restored-0, inv-applied, inv-fix all use _buildInvCfg
- [x] P-06: Smart Defaults — fully routed through _buildInvCfg + _buildStrCfg
- [x] P-07: Auto-Apply — already gated by shouldAllowOverride(controlMode, configLocks)
- [x] P-11: Panel Compat Heal — controlMode=manual guard added
- [x] P-12: DC/AC Hard Heal — already calls applySizingRecommendation (canonical writer)
- [x] P-14: Auto-Fix All — already uses _buildInvCfg + _buildStrCfg (inv-fix path)

## Phase 4: Display separation (current vs recommended) ✅
- [x] DisplayMode type: 'current' | 'recommended' (line 87)
- [x] displayMode state (default 'current') (line 1549)
- [x] currentDisplayConfig and recommendedDisplayConfig objects (lines 2247–2284)
- [x] displayConfig selector — single source of truth (line 2287)
- [x] String layout + header use displayConfig (lines 6400–6408)
- [x] Display Mode toggle UI (lines 6277–6301)
- [x] applySizingRecommendation resets displayMode to 'current' (line 2536)

## Phase 5: Ecosystem compatibility engine ✅
- [x] lib/system/ecosystemCompatibility.ts created — facade over brandCompatibility.ts
- [x] isEcosystemCompatible(input): boolean — thin wrapper over evaluateCompatibility().ok
- [x] getEcosystemConflicts(input): CompatibilityIssue[] — filters errors only
- [x] Full impl in brandCompatibility.ts (444 lines) wired to validationEngine + sizingEngine

## Phase 6: Panel count authority ✅
- [x] lib/system/panelCountSource.ts — resolveSystemPanelCount with source: 'cad-panels' | 'cad-total' | 'system-definition' | 'config-fallback'
- [x] mismatchedWithConfig flag — explicit mismatch detection
- [x] systemPanelCount = resolvedPanelCount.value used everywhere in page.tsx
- [x] mismatchedWithConfig passed to UI component at line 7333

## Phase 7: SolarDog awareness ✅
- [x] store/engineeringStore.ts — EngineeringSnapshot type + Zustand store + simplifyPanelCountSource()
- [x] Engineering page writes snapshot via useEffect (controlMode, sizingAutoApply, userHasEditedInverters, displayMode, panelCountSource, panelCount, topology, inverterModel, stringCount, complianceStatus)
- [x] SolarDog reads engineeringSnapshot from useEngineeringStore + injects into richContext
- [x] AssistantRequest context type updated with engineeringState field
- [x] System prompt in route.ts includes ENGINEERING PAGE STATE block when snapshot present
- [x] Cleanup useEffect clears snapshot on engineering page unmount

## Phase 8: Tests for all architectural invariants ✅
- [x] Central builder invariants: Smart Defaults uses builder, addInverter uses builder
- [x] validateInverterMetadata catches stale metadata
- [x] reconciler never trims to zero (targetStringCount=0 / -5 both → 1)
- [x] ecosystem apply no stale strings (brand switch produces fresh metadata)
- [x] EcoFlow+Enphase battery → incompatible; SolarEdge+Enphase battery → error conflict
- [x] display mode isolation (DisplayMode type contract + EngineeringSnapshot.displayMode)
- [x] CAD vs config explicit choice (resolveSystemPanelCount priority chain)
- [x] panel lock (userHasEditedInverters + clearEngineeringSnapshot)
- [x] hard safety override (ratio < 1.0 is a violation)
- [x] ecosystemCompatibility facade exports + return types
- [x] engineeringStore shape + simplifyPanelCountSource all 7 mappings
- [x] npx tsc --noEmit = 0 errors ✅
- [x] 62/62 tests pass ✅

## Final
- [ ] git commit + push