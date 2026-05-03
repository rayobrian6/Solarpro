# SolarPro v61.4 — Hydration Lock Master Prompt

## Phase 1: Hydration Lock — normalizeInverterConfig() utility
- [x] Create normalizeInverterConfig() in buildInverterConfig.ts
- [x] Fix </thinking> artifact in buildInverterConfig.ts
- [x] Add normalizeInverterConfig import to page.tsx
- [x] Wrap savedConfig merge setConfig with normalizeInverterConfig()
- [x] Wrap seed patches setConfig with normalizeInverterConfig()
- [x] Wrap localStorage fallback setConfig with normalizeInverterConfig()

## Phase 2: Global Runtime Guard
- [x] Add useEffect guard that auto-heals any invalid config.inverters on every render
- [x] Guard checks: stringsPerInverter !== strings.length OR !modulesPerString OR strings[].panelCount=0

## Phase 3: Kill Legacy Fallbacks
- [x] Fix micro corruption path to use _buildStrCfg + _buildInvCfg (not raw object)
- [x] Fix micro panel count update path to use builder (not raw string literal)
- [x] Audit remaining patterns — all others are calc payloads or registry data (safe)

## Phase 4: Force Single Entry Point (audit)
- [x] Audit all remaining InverterConfig creation sites — 100% use _buildInvCfg
- [x] smartDefaults.ts uses SmartDefaultsInverter type, converted via _buildInvCfg in page.tsx

## Phase 5: Hard Assertion (dev mode)
- [x] assertValidInverter() added to buildInverterConfig.ts (alias of assertInverterMetadata)
- [x] Wire into dev-mode useEffect on config.inverters in page.tsx

## Phase 6: UI Trust Fix
- [x] Confirmed compliance engine reads config.inverters (via buildCalcPayload)
- [x] Confirmed string layout reads displayConfig (which maps to config when displayMode=current)
- [x] No sizingRecommendation reads bypass displayConfig abstraction

## Phase 7: SolarDog Truth Lock
- [x] Added INVERTER CONFIG TRUTH LOCK block to engineeringStateStr in assistant/route.ts
- [x] Added mismatch-explanation rule (explains what user must do when panelCountMismatch=true)
- [x] Added never-infer rules (never say "you have N strings" without snapshot data)

## Phase 8: Tests
- [x] normalizeRawInverter idempotent test (8 tests)
- [x] normalizeInverterConfig idempotent + auto-heal tests (6 tests)
- [x] assertValidInverter dev mode tests (3 tests)
- [x] Builder invariants hold after hydration (4 tests)
- [x] npx tsc --noEmit = 0 errors
- [x] All 83 tests pass (3 suites)

## Final
- [ ] git commit + push