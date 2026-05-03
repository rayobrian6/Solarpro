# v61.8 ROOT CAUSE AUDIT — Hydration Stale Inverter Config Contamination

**Commit:** d1f53b2  
**Branch:** dev  
**Date:** 2025  
**Status:** ✅ PASS

---

## ROOT CAUSE SUMMARY

`newString()` has a hardcoded default `panelCount: 10` (page.tsx line 440).  
`defaultProject` seeds React state with `newInverter('string')` → 1 inverter, 1 string of 10 panels.  
Before CAD layout loads, the 800ms auto-save debounce fires → `1×10` config written to DB as `engineeringConfig`.  
On every subsequent page load, `savedConfig = p.engineeringConfig` restores this stale `1×10` config.  
The old corruption detector used `> 20` threshold → `panelCount=10` passes undetected.  
`isUserControlled=true` (stamped by Smart Defaults) blocks all automatic remediation.  
Result: the engineering page permanently shows 1 inverter / 1 string / 10 panels regardless of CAD.

---

## DIVERGENCE TABLE

| Stage | Value | Source |
|-------|-------|--------|
| `newString()` default | `panelCount: 10` | Hardcoded line 440 |
| `defaultProject` seed | `1×10` | `newInverter('string')` |
| Auto-save (pre-CAD) | `1×10` → DB | 800ms debounce, `isHydrated=true` |
| CAD loads | `panelCount: 23` (example) | `layout.panels.length` |
| `savedConfig` restore | `1×10` (from DB) | `p.engineeringConfig` |
| Old corruption check | PASSES (10 ≤ 20) | `> 20` threshold |
| `isUserControlled` | `true` | Smart Defaults stamps unconditionally |
| Result | Permanently stuck at `1×10` | All auto-fix paths blocked |

---

## PROOF CHAIN

1. `newString()` line 440: `panelCount: 10` → seeds React state
2. `isHydrated` set to `true` after hydration → enables auto-save
3. Auto-save fires (800ms debounce) before `layout.panels` populates
4. DB stores `engineeringConfig = { inverters: [{ strings: [{ panelCount: 10 }] }] }`
5. Next load: `savedConfig.inverters[0].strings[0].panelCount === 10`
6. Old gate: `10 > 20` → `false` → config NOT discarded
7. Smart Defaults: `isUserControlled = true` stamped → blocks re-sizing
8. CAD sync: `_cadUserLocked = true` → proportional scale only (1×10 → does not fix string layout)
9. User sees wrong panel count forever

---

## 3-TIER FIX HIERARCHY

### Tier 1 — Prevention (Phases 1 + 5)
Stop the stale config from ever being persisted or applied.

**Phase 1 — Hydration Gate** (lines 1034-1079):
```typescript
const expectedHydrationPanelCount = _hydLayoutPanelCount > 0 
  ? _hydLayoutPanelCount : _hydSeedPanelCount;

if (savedConfig && Array.isArray(savedConfig.inverters) && expectedHydrationPanelCount > 0) {
  const _savedInvTotal = /* sum all string panelCounts */;
  if (_savedInvTotal > 0 && _savedInvTotal !== expectedHydrationPanelCount) {
    // [HYDRATION STALE CONFIG DISCARD]
    delete savedConfig.inverters;
    delete savedConfig.isUserControlled;
    delete savedConfig.defaultsApplied;
  }
}
```

**Phase 5 — Auto-save Guard** (lines 1607-1626):
```typescript
const _asIsPlaceholder =
  config.inverters.length === 1 &&
  config.inverters[0].strings.length === 1 &&
  _asConfigTotal <= 20 &&
  _asSystemPc > _asConfigTotal * 2;
if (_asIsPlaceholder) return; // [AUTO-SAVE BLOCKED: STALE INVERTER CONFIG]
```

### Tier 2 — Detection (Phases 2 + 4)
Catch surviving stale configs that slip through Tier 1.

**Phase 2 — Semantic Corruption Detector** (lines 1163-1169, 5312-5318):
```typescript
// BEFORE (broken): || _savedSinglePc > 20  ← misses panelCount=10
// AFTER (fixed):
const _is1xNCorrupt = inverterType !== 'micro'
  && _allStrings.length === 1
  && _savedSinglePc > 1
  && (expectedHydrationPanelCount > 0
      ? _savedSinglePc !== expectedHydrationPanelCount  // semantic mismatch
      : _savedSinglePc > 20);                           // fallback only
```

**Phase 4 — CAD Sync Placeholder Detection** (lines 5376-5388):
```typescript
const _cadIsPlaceholder = config.inverters.length === 1
  && _cadAllStr.length === 1
  && currentTotal <= 20
  && layout.panelCount > currentTotal * 2;
if (_cadIsPlaceholder) {
  setConfig(prev => ({ ...prev, isUserControlled: false, ... }));
}
```

### Tier 3 — Guardrails (Phases 3 + 6)
Prevent false locks and add observability.

**Phase 3 — Smart Defaults Guard** (lines 2932-2948):
```typescript
const _sdCountOk = systemPanelCount > 0 && _sdBuiltTotal === systemPanelCount;
// Only stamp isUserControlled=true when built total matches system panel count
return { ...prev, isUserControlled: _sdCountOk, ... };
```

**Phase 6 — Inverter Truth Trace** (lines 2262-2285):
```typescript
useEffect(() => {
  console.log(`[INVERTER TRUTH TRACE]\n  projectId: ${currentProjectId}\n  ...`);
}, [systemPanelCount, config.inverters, sizingRecommendation, currentProjectId]);
```

---

## FIRST READ-ONLY AUDIT — 10 QUESTIONS

| # | Question | Answer |
|---|----------|--------|
| Q1 | Where is `expectedHydrationPanelCount` declared? | Line 1040, before `savedConfig` is read |
| Q2 | What is the gate condition? | `_savedInvTotal > 0 && _savedInvTotal !== expectedHydrationPanelCount` (line 1062) |
| Q3 | What fields are deleted on discard? | `inverters`, `isUserControlled`, `defaultsApplied` (lines 1073-1075) |
| Q4 | Where is the savedConfig corruption detector? | `_is1xNCorrupt` at line 1163 |
| Q5 | Where is the CAD sync detector? | `_is1xNState` at line 5312 |
| Q6 | Where is `_sdCountOk`? | Lines 2935-2948 — Smart Defaults guard |
| Q7 | Where is CAD placeholder detection? | `_cadIsPlaceholder` at line 5376 |
| Q8 | Where is the auto-save guard? | `_asIsPlaceholder` at lines 1613-1618 |
| Q9 | Where is the Truth Trace useEffect? | Lines 2262-2285, after `sizingRecommendation` useMemo |
| Q10 | Do both corruption detectors use ternary (not OR)? | ✅ Yes — lines 1167-1169 and 5316-5318 |

---

## MANUAL VALIDATION SCENARIOS

| Scenario | Description | Expected Behavior | Fixed By |
|----------|-------------|-------------------|----------|
| **A** | New project, auto-save fires before CAD loads (1×10 in DB) | `[HYDRATION STALE CONFIG DISCARD]` — inverters discarded, Smart Defaults re-runs | Phase 1 |
| **B** | Returning to project with correct 2×12+11 saved config | Config preserved exactly, no discard | Phase 1 (total matches) |
| **C** | User manually edits inverter to 3 strings, saves, returns | `isUserControlled=true` preserved, layout unchanged | Phase 1 + Phase 3 |
| **D** | CAD panel count changes from 23→30 (user-controlled config) | Proportional scale fires (not placeholder path) | Phase 4 |
| **E** | Micro inverter system (23×1 strings) | `type='micro'` exempts from 1×N corruption check | Phase 2 |
| **F** | Small system (10 panels) legitimately configured as 1×10 | NOT discarded — `_savedInvTotal === expectedHydrationPanelCount` (10===10) | Phase 1 + Phase 2 |
| **G** | Auto-save fires with placeholder (1×10, system=23) | `[AUTO-SAVE BLOCKED: STALE INVERTER CONFIG]` | Phase 5 |

---

## SECONDARY BUG FOUND AND FIXED

**Bug discovered during test authoring:**  
Both `_is1xNCorrupt` (Phase 2a) and `_is1xNState` (Phase 2b) originally used OR logic:
```typescript
(expectedCount > 0 && singlePc !== expectedCount) || singlePc > 20
```
This incorrectly flagged valid single-string systems with panel count 21+ as corrupt
(e.g., a legitimate 1-inverter, 1-string, 22-panel system would be rebuilt unnecessarily).

**Fix:** Replaced OR with ternary:
```typescript
expectedCount > 0 ? singlePc !== expectedCount : singlePc > 20
```
The `> 20` fallback now only fires when no authoritative expected count is available.

---

## TEST RESULTS

```
Test Suites: 7 passed, 7 total
Tests:       180 passed, 180 total  (154 existing + 26 new)
TypeScript:  0 errors
```

### New Tests (lib/system/__tests__/hydrationGate.test.ts — 26 tests)

**Scenario A** (7 tests): Stale 1×10 discarded, `inverters`/`isUserControlled`/`defaultsApplied` removed, other fields preserved. Phase 2 semantic detector correctly flags 10≠23. Regression proof: `10 > 20 === false` (old logic was broken).

**Scenario B** (8 tests): Correct configs preserved — single-inverter 12+11, multi-string 8+8+7, multi-inverter 12+11. Phase 2 does NOT flag 1×23 when expected=23. Seed fallback works. Zero-expected-count does not discard.

**Scenario E** (4 tests): Micro inverter 1×10 not flagged. Micro 1×1 not flagged. Micro 23×1 total=23 preserved. String 1×15 with expected=15 not flagged.

**Edge cases** (7 tests): null config, no-inverters config, empty strings, panelCount=1 guard, `> 20` fallback when expected=0, 1×10 with expected=10 not corrupt, multi-string not affected.

---

## FINAL VERDICT

### ✅ PASS

All 6 fix phases applied, tested, and committed to `dev` (commit `d1f53b2`).

The root cause — `newString()` default `panelCount:10` auto-saved to DB before CAD loads, then restored on every page load, passing all old guards — is blocked at **3 independent layers**:

1. **Hydration gate (Phase 1)** discards stale configs on load before they reach React state
2. **Auto-save guard (Phase 5)** blocks persistence of placeholder configs entirely
3. **Corruption detector (Phase 2)** catches any that survive, triggering rebuild from sizing engine

A secondary latent bug (valid single-string systems with 21+ panels incorrectly flagged as corrupt due to OR logic) was found during test authoring and fixed in the same commit.

**Files changed:**
- `app/engineering/page.tsx`: +212 lines, -35 lines
- `lib/system/__tests__/hydrationGate.test.ts`: +310 lines (new file)