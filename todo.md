# SLD Engineering Accuracy — Post-Audit Fix List

## CRITICAL (data/logic bugs that produce wrong engineering values)

### Fix 1 — String count consistency ✅ DONE
- [x] computeSystem() recalculated stringCount from Voc physics — ignored design's totalStrings
- [x] Added totalStrings?: number to ComputedSystemInput
- [x] When provided, skip Voc recalculation — use design's string count directly
- [x] Route passes resolvedTotalStrings to computeSystem() csInput
- [x] DC run objects now have conductorCount = totalStrings*2 (6 for 3-string, not 8)

### Fix 2 — AC/DC EGC missing from callouts ✅ DONE
- [x] buildConductorCallout() now generates 3-line permit callout with EGC
- [x] All runs: "N×#G INSUL\n1×#G GRN EGC\nIN SIZE CONDUIT"
- [x] INV_TO_DISCO_RUN: 2×#6 THWN-2 | 1×#10 GRN EGC | IN 1" EMT ✅

### Fix 3 — DC_DISCO_TO_INV_RUN THWN-2 override ✅ DONE
- [x] Back-population from buildSegmentSchedule() was overwriting Phase 3 THWN-2 fix
- [x] Added override block in back-population loop to re-apply THWN-2 after back-pop
- [x] DC_DISCO_TO_INV: 6×#10 THWN-2 | 1×#12 GRN EGC | IN 1-1/4" EMT ✅

### Fix 4 — J-box string count label not on ground line ✅ DONE
- [x] Was at jbCY+jbH/2+9 — overlapped ground drop line
- [x] Moved to left-of-box blue side label, clearly informational

### Fix 5 — MPPT allocation (from sizing engine) ✅ ALREADY CORRECT
- [x] Route already rebuilds mpptAllocation from layoutStrings when available
- [x] generateStringConfig() used only for NEC 690.7 Voc/current math
- [x] Test input uses mpptChannels:1 (hardcoded) — real data from route is correct

### Fix 6 — Commit and push ✅ DONE
- [x] npx tsc --noEmit → 0 errors
- [x] npx vitest run → 2573/2573 passing
- [x] git commit a3bd26f + push → origin/master

## Remaining items (from 50-point audit — lower priority)

### Still open visual/NEC clarity items:
- [ ] J-box label should describe function (pass-through / string landing / transition box)
- [ ] Inverter equipment block should show formal nameplate format
- [ ] AC output should explicitly label L1/L2/EGC — NO NEUTRAL for 240V
- [ ] DC conductor type transition (PV Wire → THWN-2) should be more visually explicit
- [ ] Optimizer model number must appear in SLD (current: shows count + "1 PER MODULE")
- [ ] NEC EGC sizing basis should reference OCPD (e.g. 20A OCPD → #12 EGC per 250.122)
- [ ] Legend for line types (solid red=DC+, blue=DC-, green=EGC, etc.)