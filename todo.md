# v61.13d — Hybrid DC/AC Floor Fix

## Tasks
- [x] Read all relevant files (sizingEngine.ts, ecoflow.ts, types.ts, equipment-db.ts, dcAcConstants.ts)
- [x] Add HYBRID_MIN_DC_AC_RATIO = 0.75 constant to sizingEngine.ts
- [x] Add maxUnits field to BrandInverterModelRef type (types.ts)
- [x] Update EcoFlow profile: maxUnits=2 on 11kW model, dcAcRatioRange.min 1.0→0.75
- [x] Update pickRatioAwareTier() — topology-aware floor + multi-unit expansion
- [x] Update attemptDownsize() — topology-aware floor + respect maxUnits
- [x] Update applyFeasibilityHardGate() — topology-aware floor (_fhg_floor)
- [x] Update sizeInverters() — _sizeFloor variable replacing MIN_DC_AC_RATIO throughout
- [x] TypeScript compile — CLEAN (0 errors)
- [x] Jest tests — 210/210 PASS
- [x] Verification script confirms correct engine behavior across 5 test scenarios
- [x] Commit as v61.13d