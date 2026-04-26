# Stage 8.4 — Brand-Profile Centralization (v47.433)

## Directive
Fix the 3 stale brand-profile drifts + align the 2 "intentional" overrides to registry.
Goal: drift-guards pass with ZERO overridesEquipmentDb=true flags remaining.

## Resolution table

| SKU | File | Field | Before | After (= registry) |
|---|---|---|---|---|
| se-7600h | generic-string.ts | mpptCount | 2 | 1 |
| se-10000h | generic-string.ts | mpptCount | 2 | 1 |
| sma-sb-7.7 | sma.ts | mpptCount | 2 | 3 |
| goodwe-gw10k-ms | goodwe.ts | acKw | 10.0 | 9.6 |
| goodwe-gw10k-ms | goodwe.ts | dcKwMax | 15.0 | 14.4 |
| goodwe-gw10k-ms | goodwe.ts | mpptCount | 2 | 3 |
| sungrow-sg15rs | sungrow.ts | maxParallelStringsPerMppt | 1 | 2 |
| sma-sb-10.0 | sma.ts | maxParallelStringsPerMppt | 1 | 6 |

## Behavior-impact notes
- se-7600h / se-10000h: mpptCount was stale; 1-MPPT-channel HD-Wave is the correct topology.
  Sizing already reads registry for MPPT-channel dispatch (bom-engine-v4 path), so
  real impact on BOM is minimal — this is pure drift hygiene.
- sma-sb-7.7: profile was 2, registry is 3 per v47.417 datasheet. Correct fix.
  Impact: SB 7.7 projects now correctly allow 3-tracker string allocation.
- goodwe-gw10k-ms: profile was stale 10.0/15.0/2; registry remapped to GW9600-MS-US
  with correct 9.6/14.4/3 in v47.417. Profile alignment brings all GoodWe 10K projects
  onto the accurate spec.
- sungrow-sg15rs: active=false SKU (no US residential catalog). Aligning to
  registry maxParallel=2 is hardware-correct, zero live-project impact.
- sma-sb-10.0: active=false SKU (discontinued). Aligning to registry maxParallel=6
  (external combiner) is hardware-correct, zero live-project impact.

## Tasks
- [ ] Fix se-7600h mpptCount: 2 -> 1 in generic-string.ts (+ remove flag + comment)
- [ ] Fix se-10000h mpptCount: 2 -> 1 in generic-string.ts (+ remove flag + comment)
- [ ] Fix sma-sb-7.7 mpptCount: 2 -> 3 in sma.ts (+ remove flag + comment)
- [ ] Fix sma-sb-10.0 maxParallel: 1 -> 6 in sma.ts (+ remove flag + comment)
- [ ] Fix goodwe-gw10k-ms acKw/dcKwMax/mpptCount in goodwe.ts (+ remove flag + comment)
- [ ] Fix sungrow-sg15rs maxParallel: 1 -> 2 in sungrow.ts (+ remove flag + comment)
- [ ] Verify ZERO overridesEquipmentDb=true remain
- [ ] tsc --noEmit clean
- [ ] Full vitest suite pass
- [ ] Build clean (46/46 pages)
- [ ] Bump version.ts to v47.433
- [ ] Update roadmap doc + roadmapRE26.ts
- [ ] Commit + push