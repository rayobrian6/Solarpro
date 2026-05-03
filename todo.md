# SolarPro v61.5 — Final Lock Master Prompt

## Audit: what was already done from the prompt (v61.4)
- [x] Task 1 (normalizeConfig on load): normalizeInverterConfig() wraps all 3 hydration paths
- [x] Task 3 (runtime guard useEffect): implemented in v61.4 Phase 2
- [x] Task 4 (assertValidInverter dev useEffect): implemented in v61.4 Phase 5
- [x] Task 5 (ban raw strings): raw patterns outside builder already cleaned in v61.4 Phase 3

## New fixes in v61.5

### T2-A: Ecosystem Apply — inverter object bypasses builder
- [x] Line ~7339: updatedInverters[0] = { ...firstInv, type, inverterId } → replaced with _buildInvCfg()

### T2-B/C: updateInverter() — raw spread at exit point bypasses builder
- [x] Exit point wrapped with _buildInvCfg() — all patches (inverterId, type, strings, etc.) rebuild metadata
- [x] stringsPerInverter resize: new strings now use _buildStrCfg (was newString() spread)
- [x] modulesPerString change: strings rebuilt via _buildStrCfg (not raw spread)
- [x] Minimum-1 guard added (never trim to zero)

### T2-D: addString() — used newString() without builder
- [x] Replaced with _buildStrCfg() + _buildInvCfg() rebuild

### T2-E: removeString() — raw { ...i, strings: filtered } without builder
- [x] Replaced with _buildInvCfg() rebuild + never-trim-to-zero guard

### T2-F: updateString() — raw { ...s, ...patch } without builder
- [x] Patched string rebuilt through _buildStrCfg(); inverter rebuilt through _buildInvCfg()

### T2-G: savedConfig reconciliation (trim/pad path)
- [x] Both trim and pad branches now use _buildInvCfg() at exit (was { ...inv, strings: ... })

### T2-H: Auto-Apply Strings button
- [x] newStrings now built via _buildStrCfg() (was newString() spread)

## Tests
- [x] 6 new mutation path invariant tests (v61.5)
- [x] 89 total tests pass
- [x] npx tsc --noEmit = 0 errors

## Final
- [ ] git commit + push