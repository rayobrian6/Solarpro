# v61.9 — Clipping / Inverter Upsizing Audit + Fix

## ROOT CAUSE FINDINGS (Read-only audit complete)

### Finding 1 — CRITICAL: feasibilityEvaluator.ts DC_AC_ACCEPTABLE_MAX = 1.55
Both `ecoflow-ocean-pro-11kw` (ratio=1.683) and `ecoflow-power-ocean-10kw` (ratio=1.936)
are REJECTED by the feasibility evaluator as DC_AC_RATIO_OUT_OF_BAND.
Only `ecoflow-ocean-pro-24kw` (ratio=0.807) PASSES — but ratio < 1.00 so below MIN floor.
Result: feasibility evaluator finds NO feasible EcoFlow model.

### Finding 2 — CRITICAL: sizingEngine pickRatioAwareTier uses ALL supportedInverterModels
Including `active:false` legacy models (ecoflow-power-ocean-5kw, -10kw, -20kw).
3×5kW legacy units wins the ratio window (ratio=1.291) — this becomes the recommendation.
But the legacy 5kW is active:false in equipment-db, so this is a phantom recommendation.

### Finding 3 — CRITICAL: DC_AC_ACCEPTABLE_MAX = 1.55 is too low for hybrid inverters
EcoFlow OCEAN Pro 11.5kW with 19.36 kW DC = ratio 1.683 — electrically VALID for hybrid
(hybrid can absorb excess DC into battery). The 1.55 cap treats this as invalid when it
should be a clipping/economic warning only.

### Finding 4 — WHY "8→6 strings" recommendation
The sizing engine, forced to use the legacy 10kW (user's stored model), reduces string
count to fit within dcKwMax=15.0kW. 6 strings × ~5.5 panels avg = ~33 panels = 14.5 kW DC.
This is a panel reduction masquerading as a string layout fix.

### Finding 5 — dcAcConstants.ts hardMax = 1.55
electrical-calc.ts warns W-DCAC-RATIO when ratio > 1.55. This is correct for string
inverters but too low for hybrid inverters that absorb excess DC into batteries.

### Finding 6 — validationEngine.ts thresholds are reasonable (1.6 warn, 2.0 error)
These already separate "mild clipping" from "severe clipping" correctly.

### Finding 7 — No clipping severity classification or recommendation priority logic
No code distinguishes "electrically invalid" from "economically inefficient clipping".
No code prefers inverter upsizing before panel reduction.

## TASKS

### Phase 1 — Fix DC_AC_ACCEPTABLE_MAX in feasibilityEvaluator.ts
- [ ] Raise DC_AC_ACCEPTABLE_MAX from 1.55 to 2.00 (matches validationEngine severe threshold)
- [ ] Separate electrical invalidity from economic clipping in the evaluator
- [ ] DC/AC ratio band: PASS ≤1.55, warn 1.55-2.00, only error if >2.00

### Phase 2 — Fix pickRatioAwareTier to skip active:false models
- [ ] Filter out inactive equipment-db models before scoring
- [ ] Need access to equipment-db active flag in sizingEngine context

### Phase 3 — Implement DC/AC severity bands as named constants
- [ ] Create DC_AC_CLIPPING_BANDS in dcAcConstants.ts with named thresholds
- [ ] Replace scattered magic numbers with the constants

### Phase 4 — Fix recommendation priority: inverter upsizing before panel reduction
- [ ] When DC/AC > threshold, engine should prefer larger inverter over fewer panels
- [ ] Add clipping recommendation trace

### Phase 5 — Fix UI messaging in SizingRecommendation
- [ ] Distinguish "inverter too small (clipping)" from "string layout invalid"
- [ ] Show correct upsizing recommendation

### Phase 6 — Add [CLIPPING RECOMMENDATION TRACE] debug log

### Phase 7 — TypeScript check + tests + regression validation