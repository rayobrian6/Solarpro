# SLD Engineering Accuracy — Post-Audit Fix List

## CRITICAL (data/logic bugs that produce wrong engineering values)

### Fix 1 — String count consistency (DONE)
- [x] computeSystem() recalculated stringCount from Voc physics — ignored design's totalStrings
- [x] Added totalStrings?: number to ComputedSystemInput
- [x] When provided, skip Voc recalculation — use design's string count directly
- [x] Route passes resolvedTotalStrings to computeSystem() csInput
- [x] DC run objects now have conductorCount = totalStrings*2 (6 for 3-string, not 8)
- [x] All 24 accuracy tests pass + 2573/2573 total

### Fix 2 — AC EGC missing from callout
- [ ] AC callout shows "2#6 THWN-2" — no EGC size listed
- [ ] Should show "2#6 CU THWN-2 + #10 EGC IN 1\" EMT"
- [ ] Fix AC callout in SEG4/SEG5/SEG6 to append EGC gauge

### Fix 3 — MPPT landing schedule must match design strings
- [ ] "MPPT: CH1:3str" when inverter has 2 MPPT channels — all 3 on CH1 is wrong
- [ ] Route builds mpptAllocation from generateStringConfig() which recalculates independently
- [ ] Fix: when layoutStrings is present, build mpptAllocation from layoutStrings grouping
- [ ] When not present, distribute resolvedTotalStrings across mpptChannels evenly

### Fix 4 — J-box label clarity
- [ ] Text "X strings" at jbCY+jbH/2+9 visually co-located with ground drop line
- [ ] Audit and move/add context so string count is not visually on the ground line

### Fix 5 — DC open-air callout should use per-polarity format with PV Wire insulation
- [ ] SEGMENT_1 (PV->JBOX) fallback fb uses "resolvedDcWire USE-2/PV Wire" (single total)
- [ ] Should be "3x#10 PV Wire DC+ / 3x#10 PV Wire DC-" format matching post-JBOX style

### Fix 6 — Commit and push all fixes
- [ ] npx tsc --noEmit -> 0 errors
- [ ] npx vitest run -> all passing
- [ ] git add + commit + push