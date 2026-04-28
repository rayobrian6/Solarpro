# SLD Engineering Accuracy Fix — 9 Phases

## Phase 1 — Audit SLD Data Input
- [ ] Add [SLD INPUT TRUTH] log block at renderSLDProfessional() entry
- [ ] Add acRequiresNeutral field to SLDProfessionalInput interface
- [ ] Derive acRequiresNeutral from inverter spec in route.ts and forward it
- [ ] Trace what stringCount, conductorGauge, environment, acNeutral, interconnection values arrive

## Phase 2 — Fix Wire Environment Transition
- [ ] PV→JBOX = OPEN_AIR (already done)
- [ ] JBOX→anything = RACEWAY (audit all segments after JBOX)
- [ ] Fix any "OPEN AIR" label on J-box→inverter segment
- [ ] Add regression: no segment after JBOX may be OPEN_AIR

## Phase 3 — Fix DC Conductor Count
- [ ] Audit formatCallout / fb= label construction for DC segments
- [ ] Fix: currentCarryingDcConductors = stringCount * 2 (not hardcoded 8)
- [ ] Verify SEGMENT_2D (JBOX→INV direct) uses stringCount*2
- [ ] Verify SEGMENT_1 (PV→JBOX) uses stringCount*2
- [ ] Expected: "6#10 THWN-2 + #10 EGC IN EMT" for 3 strings

## Phase 4 — Fix Optimizer String Visual
- [ ] PV array block: show module count + string layout + optimizer count clearly
- [ ] "36 MODULES / 3 STRINGS × 12 / 36 OPTIMIZERS — 1 PER MODULE"

## Phase 5 — Fix Inverter String Landings
- [ ] 3 strings → render 3 string landings into inverter
- [ ] Add [SLD STRING LANDING] log

## Phase 6 — Fix AC Conductor Labels
- [ ] Determine acRequiresNeutral from inverter profile
- [ ] SolarEdge SE11400H: 240V split-phase, no neutral required
- [ ] If false: "2#X THWN-2 + #Y EGC IN EMT"
- [ ] If true: "3#X THWN-2 + #Y EGC IN EMT"

## Phase 7 — Fix Interconnection Display
- [ ] Compute max allowed PV breaker (120% rule NEC 705.12)
- [ ] Show FAIL/REVIEW if pvBreaker > maxAllowed
- [ ] Never show PASS unless 705.12 validation passes

## Phase 8 — Clean Grounding
- [ ] Ground drops only at: PV/JBOX, inverter, AC disco, MSP, meter
- [ ] No random mid-run ground drops
- [ ] Common EGC bus at bottom

## Phase 9 — Tests + TSC + Commit
- [ ] Regression test: 3-string SolarEdge — all 9 failure criteria
- [ ] npx tsc --noEmit → 0 errors
- [ ] git commit + push