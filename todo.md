# BUILD v24: Full SLD Engineering Rebuild — COMPLETE

## Audit Findings (Critical Errors) — ALL FIXED

### A. computed-system.ts — Missing battery/generator/ATS segments
- [x] A1: No BATTERY_TO_BUI_RUN segment — battery AC circuit not sized
- [x] A2: No BUI_TO_MSP_RUN segment — BUI→MSP feeder not sized  
- [x] A3: No GENERATOR_TO_ATS_RUN segment — generator output not sized
- [x] A4: No ATS_TO_MSP_RUN segment — ATS→MSP feeder not sized
- [x] A5: ComputedSystemInput missing batteryBackfeedA, generatorOutputBreakerA, atsAmpRating, backupInterfaceMaxA, hasEnphaseIQSC3
- [x] A6: 120% rule now includes battery backfeed breaker (Math.max of DB lookup vs direct value)
- [x] A7: Generator conductor derived from outputBreakerA via autoSizeWire() — no hardcoded values
- [x] A8: Battery conductor derived from backfeedBreakerA via autoSizeWire() — no hardcoded values

### B. route.ts — Missing fields passed to computeSystem
- [x] B1: batteryBackfeedA, batteryContinuousOutputA passed to csInput (from getBatteryById spec)
- [x] B2: generatorOutputBreakerA, generatorKw passed to csInput (from getGeneratorById spec)
- [x] B3: atsAmpRating, backupInterfaceMaxA, hasEnphaseIQSC3 passed to csInput
- [x] B4: hasEnphaseIQSC3 also passed to SLDProfessionalInput (renderer)

### C. sld-professional-renderer.ts — Rendering errors
- [x] C1: Battery wire label uses BATTERY_TO_BUI_RUN.conductorCallout (NEC-sized)
- [x] C2: Generator wire label uses GENERATOR_TO_ATS_RUN.conductorCallout (was hardcoded #6 AWG — WRONG for 100A)
- [x] C3: ATS→MSP wire label uses ATS_TO_MSP_RUN.conductorCallout (was hardcoded #4 AWG)
- [x] C4: Duplicate ATS fixed — Mode A (IQ SC3): no standalone ATS; Mode B (standalone): ATS rendered
- [x] C5: 120% rule panel shows PV Breaker + Batt. Backfeed Bkr + Total Backfeed + Bus 120% Limit

## Steps — ALL COMPLETE
- [x] Step 1: Extend computed-system.ts (4 new RunSegmentIds + battery/gen/ATS sizing)
- [x] Step 2: Update route.ts (equipment-db lookups + pass new fields to computeSystem + SLDInput)
- [x] Step 3: Update renderer (computed run data, dual-mode ATS routing, 120% rule fix)
- [x] Step 4: TypeScript check (CLEAN — 0 errors) + commit ea489c16 + push to master