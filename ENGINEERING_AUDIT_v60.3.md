# SolarPro Engineering Audit Report
**Version:** v60.3  
**Commit:** cb1cf6a  
**Audited:** Full codebase sweep — lib/, app/api/, brand profiles, equipment-db  
**Test status:** ✅ 2570/2570 passing  
**TypeScript:** ✅ Clean (2 pre-existing test-stub errors only, non-production)

---

## Executive Summary

The codebase is in a solid state. All 2570 vitest tests pass, TypeScript compiles clean on all production files, and the recent v60.x fixes are working correctly in production. This audit identified **3 real bugs** (1 in dead code, 2 architectural gaps), **2 logic inconsistencies** (non-critical), and **5 TODOs** that represent known incomplete features.

---

## ✅ Findings: CLEAN

### 1. Conductor Ampacity Tables (NEC 310.15)
All 10 THWN-2 conductor entries in `equipment-db.ts` match NEC Table 310.15(B)(16) values exactly:
- `#10 AWG`: 75°C=35A, 90°C=40A ✅
- `#8 AWG`: 75°C=50A, 90°C=55A ✅  
- `#6 AWG`: 75°C=65A, 90°C=75A ✅
- Full table to `#2/0 AWG` verified correct.

### 2. Temperature Derating (NEC 310.15(B)(2)(a))
`getTempDeratingFactor()` in `manufacturer-specs.ts` correctly implements the 90°C conductor derating table:
- ≤30°C → 1.00, ≤35°C → 0.96, ≤40°C → 0.91 ... ≤75°C → 0.50 ✅

### 3. NEC 690.7 Voc Correction Formula
Both `feasibilityEvaluator.ts` and `manufacturer-specs.calcStringVocCorrected()` implement the correct formula:
```
vocCold = panelVoc × (1 + (tempCoeff/100) × (Tmin - 25))
```
- At Tmin=-10°C, tempCoeff=-0.27%/°C: correction factor = 1.0945 ✅
- Cold Voc increases (correct physics) ✅
- Both implementations are mathematically identical ✅

### 4. NEC 705.12(B) 120% Rule
`bom-engine-v4.ts` correctly implements:
```
maxPVBreaker = floor(busRating × 1.2 − mainAmps)
```
- Correctly distinguishes LOAD_SIDE (requires backfeed breaker) vs SUPPLY_SIDE_TAP (no breaker) ✅
- Emits violation warning and caps BOM to max allowed amperage ✅
- All interconnection method aliases (`BACKFED_BREAKER`, `LINE_SIDE`, etc.) handled ✅

### 5. Equipment DB Integrity — Brand Profile IDs
All 58 `equipmentDbId` references across all 15 brand profiles exist in `equipment-db.ts`. Zero orphaned IDs. ✅

### 6. Brand Profile Tier Tables
All 15 brand profiles have:
- Continuous `sizingTiers` (no gaps between tier boundaries) ✅
- Final tier capped at `maxDcKw: Infinity` (handles all system sizes) ✅
- Brands audited: fronius, sol-ark, solaredge, solis, sma, sungrow, goodwe, growatt, tigo, enphase, apsystems, hoymiles, tesla, ecoflow, generic-string ✅

### 7. NEC OCPD Sizing (Production Path)
`electrical-calc.ts` correctly uses `nextStandardOCPD()` from `manufacturer-specs.ts`, which maps to actual NEC 240.6 standard breaker sizes:
`[15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, ...]`

### 8. DC Wire Auto-Sizing (Production Path)
`electrical-calc.ts` correctly routes:
- DC string conductors → `autoSizeDCWire()` (90°C column, USE-2 / PV Wire) ✅
- AC branch circuits → `autoSizeACWire()` (75°C column, THWN-2) ✅

### 9. MPPT Current Escalation Guard (v60.2/v60.3)
`unitsByMpptCurrent` block in `feasibilityEvaluator.ts` correctly guards escalation:
```typescript
const ratioAtU = totalDcKw / Math.max(inverter.acKw * u, 1e-6);
if (ratioAtU >= DC_AC_ACCEPTABLE_MIN - 1e-6) {
  unitsByMpptCurrent = u;
}
```
Prevents Fronius 10kW×2 from being selected when ratio (0.72) would fall below DC_AC_ACCEPTABLE_MIN. ✅

### 10. Feasibility Gate Qty Correction (v60.3)
`applyFeasibilityHardGate` in `sizingEngine.ts` correctly detects and fixes cases where sizing picked qty=1 but feasibility requires qty=2:
```typescript
if (feasibleQty !== null && feasibleQty > resolvedQty) {
  return [{ ...resolved[0], qty: feasibleQty }];  // INVERTER_QTY_CORRECTED info advisory
}
```

### 11. Division-by-Zero Guards
All division operations in the critical sizing path are protected:
- `totalAcKw`: `/ Math.max(totalAc, 0.001)` ✅
- `mpptCount`: context-guarded (array structure ensures count > 0) ✅  
- `inverterACOutputKw`: guarded via `|| 240` fallback on `systemVoltage` ✅
- Voltage drop: guarded with `Number.isFinite()` checks (v57.1 fix) ✅

---

## ⚠️ Findings: BUGS

### BUG-1: `calcSegment()` Uses Wrong Wire-Sizer for DC (Dead Code)
**Severity:** Low (dead code — not called in production)  
**File:** `lib/wire-autosizer.ts`, line ~530  
**Description:** The `calcSegment()` and `calcAllSegments()` functions call `autoSizeACWire()` for both AC and DC `RunSegment` nodes. DC string conductors should use `autoSizeDCWire()` (90°C column, USE-2 insulation rating). Using `autoSizeACWire()` for DC applies the 75°C column (~15% lower ampacity), causing DC conductors to be over-sized.  
**Impact:** These functions are not called from any production code (confirmed by grep). The real production path goes through `electrical-calc.ts` which correctly routes DC to `autoSizeDCWire()`. Impact is zero currently.  
**Fix:** If `calcSegment`/`calcAllSegments` are ever activated, replace the `autoSizeACWire()` call with a conditional routing to `autoSizeDCWire()` for `isDC` segments.

```typescript
// Current (wrong):
const wiresizer = autoSizeACWire({ ... });

// Should be:
const wiresizer = isDC
  ? autoSizeDCWire({ stringId: seg.id, maxCurrentNEC: current, ... })
  : autoSizeACWire({ ... });
```

### BUG-2: `calcSegment()` OCPD Rounding Uses Non-Standard Sizes (Dead Code)
**Severity:** Low (dead code — not called in production)  
**File:** `lib/wire-autosizer.ts`, line 552  
**Description:** `seg.ocpdAmps = Math.ceil(wiresizer.requiredAmpacity / 5) * 5` produces non-standard breaker ratings. NEC 240.6(A) standard sizes skip from 50A→60A and 60A→70A (no 55A or 65A). The `ceil(x/5)*5` formula creates:
- 52.5A → 55A (non-standard, should be 60A)
- 62.5A → 65A (non-standard, should be 70A)  
**Impact:** Zero — this function is dead code. The production path uses `nextStandardOCPD()` from `manufacturer-specs.ts`.  
**Fix:** Replace with `nextStandardOCPD(wiresizer.requiredAmpacity)` when activating this function.

---

## ⚠️ Findings: ARCHITECTURAL GAPS (Not Bugs, but Worth Tracking)

### GAP-1: BOM Route Does Not Forward Panel Electrical Specs
**Severity:** Medium (architectural limitation)  
**File:** `app/api/engineering/bom/route.ts`, lines 392–413  
**Description:** The BOM route calls `sizeSystemFromBrand()` without forwarding panel electrical specs:
```typescript
sizingResult = sizeSystemFromBrand({
  systemType, panelCount, panelWattage,
  selectedInverterId, batteryEnabled, ...
  // MISSING: panelVoc, panelIsc, panelTempCoeffVoc, panelVmp, designTempMin
});
```
`sizeSystemFromBrand` accepts these fields (`SizingInput` interface defines them as optional), but the BOM route never reads them from the request body and never passes them.

**Impact:** When the BOM route is used with a `panelId` that has electrical specs, the sizing engine cannot perform:
- String Voc over-voltage check (NEC 690.7)
- MPPT current feasibility check (NEC 690.8)
- Panel-inverter electrical compatibility gating

The `panelWattage` is derived as `systemKw × 1000 / moduleCount` (back-calculation), which is reasonable for kW-level sizing but loses Voc/Isc/tempCoeff precision.

**Mitigation:** The `/api/engineering/assist` endpoint performs full electrical checks. The BOM route is used after design is already validated. The UI flow typically runs feasibility checks before calling BOM.

**Recommendation:** In BOM route, look up panel specs from `equipment-registry-v4` using `panelId` and forward them to `sizeSystemFromBrand`. This would enable full MPPT/Voc feasibility checking in the BOM path.

### GAP-2: `segment-builder.ts` String Inverter Topology Not Implemented
**Severity:** Low (feature incomplete, not a regression)  
**File:** `lib/segment-builder.ts`, line 588  
**Description:**
```typescript
// STRING INVERTER TOPOLOGY (TODO)
// String inverter segments will be added in next phase
return { segments, interconnectionPass: ..., issues };
```
`buildSegments()` only builds conduit segments for microinverter topology. String/optimizer/hybrid topologies return an empty segments array.

**Impact:** Single-Line Diagram (SLD) conduit schedule for string inverter systems will be incomplete. The rest of the SLD (topology-engine, topology-manager) is not affected.

---

## ⚠️ Findings: LOGIC INCONSISTENCIES

### INCONSISTENCY-1: DC/AC Ratio Target Split Between Engines
**Severity:** Low (intentional design split, but risk of drift)  
**Description:** Two separate scoring systems use different ratio targets:
| Engine | Target | Window |
|--------|--------|--------|
| `sizingEngine.ts` (`pickRatioAwareTier`) | `PREFERRED_DC_AC_RATIO_TARGET = 1.25` | [1.20, 1.40] |
| `bestFitEngine.ts` (`generateFeasibleSystems`) | `DC_AC_IDEAL_TARGET = 1.20` (local const) | [DC_AC_IDEAL_MIN=1.1, DC_AC_IDEAL_MAX=1.3] |
| `layoutScoring.ts` | `1.25` (via `DC_AC_IDEAL_HALF_WIDTH`) | ±0.10 band |

**Root cause:** `bestFitEngine.ts` has its own local `DC_AC_IDEAL_TARGET = 1.20` that is NOT imported from `sizingEngine.ts` or `feasibilityEvaluator.ts`. This means the brand-level sweep (`generateFeasibleSystems`) scores 1.20 as "perfect" while `sizingEngine`'s tier picker targets 1.25.

**Impact:** For borderline cases, `generateFeasibleSystems` might rank a 1.20-ratio system first, while `pickRatioAwareTier` would prefer a 1.25-ratio system. The final selection is determined by `sizingEngine` (which calls `pickRatioAwareTier`), so the practical effect is small.

**Recommendation:** Export `PREFERRED_DC_AC_RATIO_TARGET` from `sizingEngine.ts` and import it in `bestFitEngine.ts` to unify the target. Or explicitly document the intentional split.

### INCONSISTENCY-2: EGC Sizing Table Duplicated
**Severity:** Low (two identical tables, no divergence currently)  
**Description:** `getEGCGauge()` in `wire-autosizer.ts` (line ~109) and `getEGCSize()` in `manufacturer-specs.ts` implement the same NEC Table 250.122 lookup. Both are in production use in different call paths.

**Risk:** If one table is updated (e.g., to add 500A/600A entries), the other will diverge silently.

**Recommendation:** Remove `getEGCGauge()` from `wire-autosizer.ts` and use `getEGCSize()` from `manufacturer-specs.ts` exclusively.

---

## ⚠️ Findings: TODOs IN PRODUCTION CODE

| File | Line | TODO | Severity |
|------|------|------|----------|
| `app/api/equipment/save/route.ts` | 71 | Neon DB migration: persist to `user_equipment_*` tables | Low |
| `lib/segment-builder.ts` | 588 | String inverter SLD segments not yet implemented | Medium |
| `lib/structural-engine-v2.ts` | 564 | `roofZone` hardcoded to `'interior'` — no edge/corner zone calc | Medium |
| `lib/drafting/templates/ground.ts` | 324 | Ground mount row spacing dimension placeholder | Low |
| `lib/survey/ingest/types.ts` | 275 | Photo URL scheme pending partner confirmation | Low |

### Notable: `structural-engine-v2.ts` roofZone Hardcode
The wind uplift calculation always uses `RoofZone = 'interior'` regardless of array position. Edge and corner zones per ASCE 7-22 / IBC have significantly higher wind pressure coefficients (up to 2× interior). For arrays near roof edges, the structural design may be under-conservative.

**Impact:** Permit applications relying solely on this engine for edge arrays could be under-engineered. However, the structural engine output is currently advisory and marked for manual PE review.

---

## ⚠️ Findings: DEBUG ARTIFACTS

### Unconditional `console.log` in `panelLayoutOptimized.ts`
**File:** `lib/panelLayoutOptimized.ts`, lines 134, 139, 151, 156, 227, 237, 241, 244, 399, 413, 471  
**Description:** ~11 unconditional `console.log`/`console.warn` statements emit in every panel layout solve. Tagged with `[SOLVER]` and `[MIXED_FILL_DEBUG]`. Not gated on a debug flag (unlike `groundMountRealityEngine.ts` which has `GROUND_MOUNT_DEBUG = false`).  
**Impact:** Verbose Vercel function logs (~11 lines per solve). No functional impact.  
**Recommendation:** Gate behind a `PANEL_LAYOUT_DEBUG = false` flag, or remove if solver is stable.

### `adminAuth.ts` Verbose Session Logging
**File:** `lib/adminAuth.ts`, lines 29-77  
**Description:** Every admin request emits 4-5 console.log lines including DB lookup result details.  
**Impact:** Verbose but operationally useful for debugging. Low priority.

---

## Summary Table

| # | Finding | Severity | Type | Action |
|---|---------|----------|------|--------|
| 1 | `calcSegment` wrong wire-sizer for DC | Low | Bug (dead code) | Fix if activating |
| 2 | `calcSegment` non-standard OCPD rounding | Low | Bug (dead code) | Fix if activating |
| 3 | BOM route missing panel electrical specs | Medium | Arch gap | Forward panelId→specs in BOM route |
| 4 | String inverter SLD segments not implemented | Medium | TODO | Next feature sprint |
| 5 | DC/AC target split (1.20 vs 1.25) | Low | Inconsistency | Unify constant import |
| 6 | EGC sizing table duplicated | Low | Inconsistency | Remove `wire-autosizer.ts` copy |
| 7 | `roofZone` always `'interior'` | Medium | TODO | Implement edge/corner zone calc |
| 8 | `panelLayoutOptimized` debug logs | Low | Debug artifact | Gate behind flag |
| 9 | Equipment save TODO (Neon migration) | Low | TODO | When DB migration complete |

---

## Confirmed Working (No Action Needed)

- ✅ All 2570 vitest tests pass (64 test files)
- ✅ TypeScript compiles clean (zero production errors)
- ✅ NEC 690.7 Voc correction formula correct in both implementations
- ✅ NEC 705.12(B) 120% backfeed rule correctly enforced
- ✅ All 58 brand profile equipment IDs exist in equipment-db
- ✅ All 15 brand sizingTier tables continuous with Infinity cap
- ✅ NEC conductor ampacity tables match NEC 310.15
- ✅ Temperature derating factors match NEC 310.15(B)(2)(a)
- ✅ Production OCPD sizing uses correct NEC 240.6 standard sizes
- ✅ DC wire auto-sizing uses 90°C column (USE-2/PV Wire) in production path
- ✅ MPPT current escalation guard prevents invalid ratio escalation (v60.3)
- ✅ Feasibility gate qty correction working for Tigo pipeline (v60.3)
- ✅ Sol-Ark 12K-2P×1 correctly selected for 36-panel / 14.4 kW DC system
- ✅ v60.3 deployed to production at solarpro.solutions