# Post-Fix Audit — v61.11 String Packing Correction

**Date:** $(date -u +"%Y-%m-%d")  
**Branch:** dev  
**Tests:** 81 files / 3441 passed / 0 failed

---

## 9 Audit Questions — Answers

### Q1. What was the root cause of the over-creation of strings?

The old **Phase 14.3 `chosenParallel` selection loop** (lines ~1521–1531 pre-fix) searched for the minimum `p` (1..`maxParallelStringsPerMppt`) such that:

```
average(panelShare / (mpptCount × p)) ≤ maxPPS
```

For 44 panels / 4 MPPT / maxPPS=10:
- `p=1` → avg = 44/(4×1) = 11 > 10 → FAIL  
- `p=2` → avg = 44/(4×2) = 5.5 ≤ 10 → PASS → `chosenParallel=2`

It then built `mpptCount × chosenParallel = 4×2 = 8` slots, yielding strings `[6,6,6,6,5,5,5,5]` — **8 strings when only 5 were needed**.

The algorithm treated MPPT count as a _target_ (every channel must fill both parallel slots) rather than as hardware _capacity_.

---

### Q2. What is the correct formula for required strings?

```typescript
requiredStrings = Math.ceil(panelShare / effectiveMax)
```

Where `effectiveMax` is `voltageAwareMaxPPS()` — the voltage-safe maximum panels per string (cold-Voc clamp × 0.99 × maxDcVoltage, capped at brand profile `maxPanelsPerString`).

For 44 panels / effectiveMax=10: `ceil(44/10) = 5` strings.

---

### Q3. What changed in `chosenParallel` computation?

**Before (Phase 14.3):** Iterative search for minimum `p` satisfying `avg ≤ maxPPS`.

**After (v61.11):**
```typescript
// Step 1: minimum strings needed
const requiredStrings = maxPPS > 0
  ? Math.ceil(panelShare / maxPPS)
  : totalMpptThisModel;

// Step 2: minimum parallel count per MPPT to accommodate requiredStrings
const parallelNeeded = totalMpptThisModel > 0
  ? Math.ceil(requiredStrings / totalMpptThisModel)
  : 1;

// Step 3: clamp to hardware ceiling [1, maxParallelPerMppt]
const chosenParallel = Math.max(1, Math.min(parallelNeeded, maxParallelPerMppt));
```

`chosenParallel` is now a _derived value_ (minimum parallel depth needed) rather than a search target used to set slot count.

---

### Q4. What changed in the slot-building loop?

**Before:** Built `mpptCount × chosenParallel` slots (all hardware capacity), iterating `instanceIdx → mppt → p`.

**After:** Builds exactly `slotsForThisModel = max(requiredStrings, inv.qty)` slots, using a unit-interleaved `unitMpptPairs` array.

Two key changes:
1. **`slotsForThisModel`** is `min(max(requiredStrings, inv.qty), hardwareCap)` — at least one slot per physical inverter unit.
2. **`unitMpptPairs` build order** is `p → mppt → instanceIdx` (unit-interleaved) rather than `instanceIdx → mppt → p` (unit-sequential). This ensures every physical unit receives a string before any unit receives a second string.

---

### Q5. Why did the regression occur (52 panels / se-6000h × 3)?

The original v61.11 fix changed the slot count but used the old `instanceIdx → mppt → p` iteration order for `unitMpptPairs`. With `slotsForThisModel=4` and 3 units × 3 MPPT × 2 parallel = 18 entries, all unit-0 slots came first (indices 0–5). Taking indices `s % 18` for `s=0,1,2,3` picked `{physIdx=0,mppt=0}` four times — units 1 and 2 received no strings.

**Fix:** Changed `unitMpptPairs` build order to `p → mppt → instanceIdx`, producing:
```
{unit0,mppt0}, {unit1,mppt0}, {unit2,mppt0},
{unit0,mppt1}, {unit1,mppt1}, {unit2,mppt1},
...
```
Now `s=0,1,2,3` → units `0,1,2,0` — all three units receive at least one string.

---

### Q6. Does MPPT count as capacity or target?

**Capacity.** MPPT channels are the _maximum_ number of independent string inputs an inverter can accept, not a required fill count. A system with fewer strings than MPPT channels simply leaves some channels idle — this is normal and NEC-compliant. The engine must never force extra strings to fill unused MPPT slots.

---

### Q7. What is the `slotsForThisModel >= inv.qty` guard for?

When `requiredStrings < inv.qty` (e.g., 1 required string but 3 physical inverters selected), the naive formula would assign all panels to one inverter and leave the others empty. The guard `slotsForThisModel = max(requiredStrings, inv.qty)` ensures every physical unit gets at least one slot/string, distributing load across all hardware.

---

### Q8. Are there any remaining edge cases?

The following are handled correctly:
- **`requiredStrings > hardwareCap`**: capped at `totalMpptThisModel × maxParallelPerMppt`; overflow panels are reported as `STRING_OVERFLOW` warning.
- **`maxPPS = 0`**: falls back to `totalMpptThisModel` slots.
- **`totalMpptThisModel = 0`**: `parallelNeeded` defaults to 1.
- **`inv.qty = 0`**: loop body never executes; no slots added.
- **Micro topology**: bypassed entirely before `distributeStrings` slot logic.
- **Optimizer topology**: `voltageAwareMaxPPS()` bypasses voltage clamp and uses `mpptCount × parallel × brandMaxPPS` as the per-unit ceiling.

---

### Q9. What test coverage was added?

**8 new scenarios (A–H)** added to `lib/system/sizingEngine.test.ts` under describe block `'Sizing Engine — v61.11: String packing scenarios A–H'`:

| Scenario | Description | Key Assert |
|----------|-------------|------------|
| A | 44p / 2 MPPT / maxPPS=16 (Fronius) | strings.length ≤ 4 (was 8) |
| B | 10p / 2 MPPT / maxPPS=13 (Sungrow 7.6RS) | exactly 1 string |
| C | 52p / se-6000h × 3 | every physical unit has ≥1 string |
| D | 30p / Fronius × 2 units | strings spread across both units |
| E | 24p / Sungrow SG10RS / effectiveMax=12 | exactly 2 balanced strings |
| F | Sungrow 5–20p sweep | no STRING_OVERFLOW, all panels placed |
| G | 20p SolarEdge optimizer | voltage clamp bypassed, ≤25 pps, 1 unit |
| H | 44p Sol-Ark 15K (3 MPPT) | strings ≤ 5 (was 6), all panels placed |

Total test count: **3441** (81 files), up from 3433 pre-v61.11.

---

## Change Summary

| File | Change |
|------|--------|
| `lib/system/sizingEngine.ts` | Replaced Phase 14.3 `chosenParallel` loop with compact packing formula; rewrote `unitMpptPairs` build order (unit-interleaved); added `slotsForThisModel >= inv.qty` guard; removed `[STRING PACKING TRACE]` console.log |
| `lib/system/sizingEngine.test.ts` | Added 8 new string packing scenarios A–H |