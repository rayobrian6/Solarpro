# BUILD v20.1 — Data Integration & Logic Audit Fixes

## AUDIT FINDINGS SUMMARY
1. **data/equipment/ files NOT wired into app** — batteries, generators, ATS, backup-interfaces are JSON files sitting on disk with no imports
2. **data/utilities/ co-op files NOT in utility-rules.ts** — 12 IL co-ops exist as JSON but getUtilityRules() never finds them → falls back to DEFAULT_UTILITY
3. **DS3-S spec discrepancy** — data/equipment/inverters.json has 760W/3.33A but equipment-db.ts (the active NEC engine) has 640W/2.7A — need to verify correct value and reconcile
4. **IL co-op utility rules missing from UTILITY_REGISTRY** — need to add all 12 co-ops to lib/utility-rules.ts so NEC engine uses correct net metering caps, interconnection rules, etc.
5. **equipment-db.ts missing batteries/generators/ATS/backup** — UI has no battery/generator selector wired to NEC logic
6. **UI utility dropdown only shows utilities from getUtilitiesByState()** — co-ops won't appear until added to UTILITY_REGISTRY
7. **swec-il.json has different schema** than other co-op files — needs reconciliation

## Phase 1: Fix DS3-S Spec Discrepancy
- [ ] Verify correct DS3-S rated AC output (640W vs 760W) from datasheet
- [ ] Reconcile data/equipment/inverters.json DS3-S spec with equipment-db.ts

## Phase 2: Wire IL Co-ops into utility-rules.ts UTILITY_REGISTRY
- [ ] Add all 12 IL co-ops to UTILITY_REGISTRY in lib/utility-rules.ts
- [ ] Add name aliases for fuzzy matching (e.g. "southwestern electric" -> swec-il)
- [ ] Verify getUtilitiesByState('IL') returns all co-ops

## Phase 3: Wire equipment-db.ts with batteries/generators/ATS/backup
- [ ] Add BatterySystem interface to lib/equipment-db.ts
- [ ] Add BATTERIES array with Tesla Powerwall 3, Enphase IQ 5P/10T, Generac PWRcell, Franklin aPower, SolarEdge
- [ ] Add GeneratorSystem interface + GENERATORS array
- [ ] Add ATSUnit interface + ATS_UNITS array
- [ ] Add BackupInterface interface + BACKUP_INTERFACES array

## Phase 4: Wire battery/generator into NEC compliance engine
- [ ] Battery backfeed breaker → NEC 705.12(B) 120% rule check (battery adds to bus loading)
- [ ] Battery interconnection method → load-side vs supply-side
- [ ] Generator ATS → verify neutral switching, bonding rules NEC 250.30
- [ ] Add battery/generator to BOM derivation in computed-plan.ts

## Phase 5: Wire battery/generator selector into engineering UI
- [ ] Add battery selector dropdown to engineering page config
- [ ] Add generator/ATS selector to engineering page config
- [ ] Show battery backfeed breaker in compliance panel
- [ ] Show generator/ATS in equipment schedule

## Phase 6: Commit and package
- [ ] Run tests to verify no regressions
- [ ] Commit as BUILD v20.1
- [ ] Push to GitHub
- [ ] Create solar-platform-build-v20.1.zip