# SolarPro v61.6 — String Commit Integrity

## Root Cause Analysis
The bug: config.inverters[0].strings = [{ panelCount: 44 }] for non-micro inverter with maxPanelsPerString=7.
This is a STRUCTURALLY VALID config (stringsPerInverter=1, modulesPerString=44 are consistent).
The v61.4/v61.5 builder enforces metadata consistency but NOT electrical validity.
normalizeInverterConfig preserves the bad layout because it is "consistent".

## The fix: detect 1×N electrical violation and rebuild via sizeSystemFromBrand

### Phase 1 — Create electricalNormalize utility
- [ ] Create lib/system/electricalNormalize.ts
- [ ] isElectricallyInvalid(inv, inverterId, topology): detects 1×N when panelCount > maxPanelsPerString
- [ ] electricallyNormalizeInverterConfig(config, panelCount): rebuilds 1×N inverters via sizeSystemFromBrand
- [ ] Uses getBrandProfileByInverterId → maxPanelsPerString lookup
- [ ] Falls back to sizeSystemFromBrand for actual string layout

### Phase 2 — Wire into all entry points
- [ ] Page load (savedConfig, seed, localStorage): wrap setConfig with electricallyNormalizeInverterConfig
- [ ] Runtime guard useEffect: add electrical validity check alongside metadata check
- [ ] applySizingRecommendation: fix buildString helper to use _buildStrCfg (Phase 4 from prompt)
- [ ] Ecosystem apply: after inverterId change, trigger electrical normalization

### Phase 3 — Add debug logs
- [ ] [STRING NORMALIZE INPUT/OUTPUT] logs at each normalization point
- [ ] [APPLY RECOMMENDATION COMMIT] log

### Phase 4 — Tests
- [ ] 1×44 string for Solis/string inverter → electricallyNormalizeInverterConfig rebuilds to multi-string
- [ ] Healthy multi-string config → no-op
- [ ] Micro topology with 44 panels → preserved (micro allows it)
- [ ] normalizeInverterConfig + electricallyNormalize together are idempotent

### Phase 5 — TypeScript + all tests pass
- [ ] npx tsc --noEmit = 0
- [ ] All tests pass

### Final
- [ ] git commit + push