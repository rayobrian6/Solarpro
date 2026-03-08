# SolarPro v30.1 — BOM Wire Gauge Fix

## Tasks
- [x] 1. Investigate BOM wire gauge mismatch (summary cards vs line items table)
- [x] 2. Fix lib/bom-engine-v4.ts — generate one wire line item per gauge from ComputedSystem.runs
- [x] 3. Add DC wire (ROOF_RUN #10 AWG) as separate BOM line item for microinverter systems
- [x] 4. Group conduit by type+size — one line item per conduit type/size combination
- [x] 5. TypeScript compile check — zero errors
- [x] 6. Full build — clean, zero errors
- [x] 7. Bump version to v30.1, update BUILD_FEATURES
- [x] 8. Package solarpro-v30.1.zip