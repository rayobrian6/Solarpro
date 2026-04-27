# SLD Ecosystem Truth Fix — 8 Phases

## Phase 1 — Trace SLD Input Truth
- [ ] Read Project Config → sizeSystemFromBrand() chain
- [ ] Read route.ts full input construction
- [ ] Read computeSystem() inputs consumed
- [ ] Add [SLD TRUTH CHECK] logs at each stage
- [ ] Identify first stage where optimizers disappear

## Phase 2 — Wire Ecosystem Components into SLD Input
- [ ] Check route.ts receives selectedBrand, inverterId, optimizerQty, integratedDcDisconnect
- [ ] Add optimizer/battery/topology fields to SLDProfessionalInput if missing

## Phase 3 — Render Optimizer Topology
- [ ] Add optimizerQty + ecosystemType fields to SLDProfessionalInput
- [ ] Render optimizer callout on PV array block
- [ ] Show "STRING + OPTIMIZER" topology label

## Phase 4 — Fix J-Box Environment Transition
- [ ] Verify SEG2 (JBOX→Inverter) = RACEWAY with THWN-2 label

## Phase 5 — Remove Invented DC Disconnect
- [ ] Add integratedDcDisconnect to SLDProfessionalInput
- [ ] Guard DC disco render: skip if integratedDcDisconnect=true
- [ ] Add [SLD DEVICE OMITTED] log

## Phase 6 — Correct DC Conductor Labels
- [ ] Fix formatCallout: raceway = "6#10 THWN-2 + #10 EGC IN EMT"
- [ ] Fix open-air label: "3 STRINGS / 6 PV CONDUCTORS + EGC"

## Phase 7 — Battery Visibility Check
- [ ] Add [SLD BATTERY CHECK] logs at all stages

## Phase 8 — Regression Test
- [ ] Write test: 36×400W SolarEdge SE11400H, 3×12, 36 optimizers, integratedDcDisconnect=true

## Phase 9 — TSC + commit + push
- [ ] npx tsc --noEmit → 0 errors
- [ ] git commit + push