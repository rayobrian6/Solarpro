# BUILD v24: Full SLD Engineering Rebuild

## Audit Findings (Critical Errors)

### A. computed-system.ts — Missing battery/generator/ATS segments
- [ ] A1: No BATTERY_TO_BUI_RUN segment — battery AC circuit not sized
- [ ] A2: No BUI_TO_MSP_RUN segment — BUI→MSP feeder not sized  
- [ ] A3: No GENERATOR_TO_ATS_RUN segment — generator output not sized
- [ ] A4: No ATS_TO_MSP_RUN segment — ATS→MSP feeder not sized
- [ ] A5: ComputedSystemInput missing batteryId, generatorKw, generatorOutputA, atsAmpRating
- [ ] A6: 120% rule only checks PV backfeed — must include battery backfeed breaker
- [ ] A7: Generator conductor hardcoded nowhere — must derive from outputBreakerA
- [ ] A8: Battery conductor hardcoded nowhere — must derive from backfeedBreakerA

### B. route.ts — Missing fields passed to computeSystem
- [ ] B1: batteryId not passed to csInput
- [ ] B2: generatorKw/outputBreakerA not passed to csInput
- [ ] B3: atsAmpRating not passed to csInput

### C. sld-professional-renderer.ts — Rendering errors
- [ ] C1: Battery wire label hardcoded — must use computed run data
- [ ] C2: Generator wire label hardcoded (#6 AWG) — must use computed run data
- [ ] C3: ATS→MSP wire label hardcoded (#4 AWG) — must use computed run data
- [ ] C4: Duplicate ATS: IQ SC3 IS the ATS — no separate renderATS() for Enphase
- [ ] C5: 120% rule calc panel missing battery backfeed contribution

## Steps
- [ ] Step 1: Extend computed-system.ts (new RunSegmentIds + battery/gen/ATS sizing)
- [ ] Step 2: Update route.ts (pass new fields to computeSystem)
- [ ] Step 3: Update renderer (use computed run data, fix ATS duplication)
- [ ] Step 4: TypeScript check + commit + push + zip