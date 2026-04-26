# Bug Fix: Load-Side Tap Shows "Backfed Breaker" Error
**Priority:** P1 — Immediate Fix Required  
**File:** `lib/computed-system.ts`  
**Status:** Root cause identified — fix below

---

## Problem Description

When the user selects **"Load-Side Tap"** as the interconnection method in the Compliance section, the Electrical Sizing tab displays an error referencing **"backfed breaker"** — which is incorrect terminology for a load-side tap interconnection.

---

## Root Cause Analysis

### Location: `lib/computed-system.ts` — Lines 1044–1057

```typescript
const backfeedBreakerAmps = acOcpdAmps;

// NEC 705.12(B) — 120% rule: backfeed + main ≤ 1.2 × busRating
const interconnectionPass = (backfeedBreakerAmps + input.mainPanelAmps) <= (input.panelBusRating * 1.2);
if (!interconnectionPass) {
  issues.push({
    severity: 'error',
    code: 'NEC_705_12B_120PCT',
    message: `Interconnection: ${backfeedBreakerAmps}A backfeed + ${input.mainPanelAmps}A main = ...`,
    necReference: 'NEC 705.12(B)',
    suggestion: 'Consider supply-side tap (NEC 705.11) or panel upgrade',
  });
}
```

### Two Issues Found:

**Issue 1 — Wrong terminology for Load-Side Tap:**  
The error message says "backfeed" regardless of interconnection method. For a load-side tap, the correct term is "backfed breaker" only when `interconnectionMethod === 'BACKFED_BREAKER'`. For load-side tap, the message should say "load-side breaker."

**Issue 2 — 120% rule applied to Supply-Side Tap:**  
The NEC 705.12(B) 120% rule check runs unconditionally. However, for **supply-side tap (NEC 705.11)**, the 120% rule does NOT apply — the connection is made before the main breaker, so there is no busbar loading concern. This causes a false error for supply-side tap systems.

**Issue 3 — `interconnectionMethod` not passed to `computeSystem` in some API paths:**  
The SLD route passes `interconnectionMethod` correctly, but the electrical sizing calculation at line 1044 runs before the interconnection method is resolved (line 1783), so it always uses the generic "backfeed" label.

---

## Fix

### In `lib/computed-system.ts`:

**Replace lines 1044–1057 with:**

```typescript
const backfeedBreakerAmps = acOcpdAmps;

// NEC 705.12(B) — 120% rule applies ONLY to load-side connections (backfed breaker or load-side tap)
// NEC 705.11 — Supply-side tap: 120% rule does NOT apply (connection before main breaker)
const interconMethodRaw = String(input.interconnectionMethod ?? 'LOAD_SIDE').toUpperCase();
const isSupplySideTap = interconMethodRaw.includes('SUPPLY') || interconMethodRaw.includes('LINE');
const isLoadSideTap = !isSupplySideTap;

const interconnectionPass = isSupplySideTap
  ? true  // NEC 705.11: no busbar loading concern
  : (backfeedBreakerAmps + input.mainPanelAmps) <= (input.panelBusRating * 1.2);

if (!interconnectionPass) {
  // Use correct terminology based on interconnection method
  const interconLabel = interconMethodRaw.includes('BACKFED') || interconMethodRaw.includes('BREAKER')
    ? 'backfed breaker'
    : 'load-side breaker';
  issues.push({
    severity: 'error',
    code: 'NEC_705_12B_120PCT',
    message: `Interconnection: ${backfeedBreakerAmps}A ${interconLabel} + ${input.mainPanelAmps}A main = ${backfeedBreakerAmps + input.mainPanelAmps}A > 120% of ${input.panelBusRating}A bus (${Math.round(input.panelBusRating * 1.2)}A max)`,
    necReference: 'NEC 705.12(B)',
    autoFixed: false,
    suggestion: 'Consider supply-side tap (NEC 705.11) or panel upgrade',
  });
}
```

---

## Steps to Reproduce

1. Open Engineering page
2. Set system to any microinverter or string inverter configuration
3. Set Main Panel to 200A (bus rating 200A)
4. Set system size so AC OCPD > 40A (e.g., 10+ kW system → OCPD = 60A+)
5. In Compliance section → Interconnection Method → select **"Load-Side Tap"**
6. Click **Run Compliance Check** or **Recalculate**
7. **Observe:** Electrical Sizing tab shows error with "backfed breaker" text even though load-side tap was selected

---

## NEC References

| Method | NEC Reference | 120% Rule Applies? |
|--------|--------------|-------------------|
| Load-Side Tap (Backfed Breaker) | NEC 705.12(B) | ✅ Yes |
| Load-Side Tap (Bus Connection) | NEC 705.12(B) | ✅ Yes |
| Supply-Side Tap | NEC 705.11 | ❌ No |
| Main Breaker Derate | NEC 705.12(B) | ✅ Yes (derate main) |
| Panel Upgrade | NEC 705.12(B) | ✅ Yes (new bus rating) |

---

## Testing

After applying fix, verify:
- [ ] Load-side tap with passing 120% rule → no error shown
- [ ] Load-side tap with failing 120% rule → error says "load-side breaker" (not "backfed breaker")
- [ ] Supply-side tap → no 120% rule error regardless of system size
- [ ] Backfed breaker method → error correctly says "backfed breaker"