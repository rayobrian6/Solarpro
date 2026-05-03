# String Pipeline Audit — v61.7

## Summary of Findings

There are **3 active string pipelines**:

### Pipeline 1 — `config.inverters[].strings` (AUTHORITATIVE ✅)
- Source: `buildInverterConfig` / `electricallyNormalizeInverterConfig`
- Used by: `currentDisplayConfig.stringPanelCounts`, `totalStrings` in computeSystem input
- Status: **CORRECT — keep as-is**

### Pipeline 2 — `sizingRecommendation.strings[]` (RECOMMENDATION — NOT TRUTH ❌)
- Source: `sizeSystemFromBrand()` → `sizingRecommendation.strings`
- `strings` is a FLAT array (no per-inverter grouping), `inverterIndex` field differentiates
- **USED BY UI String Layout grid as PRIMARY source** (lines ~7685-7720 in page.tsx):
  ```tsx
  const recStrings = sizingRecommendation?.strings;
  if (recStrings && recStrings.length > 0) {
    return recStrings.map(...)  // ← THIS IS THE BUG
  }
  ```
- This shows the recommendation strings (e.g. 4×11 or 6×8 for the whole system)
  instead of the committed config strings (e.g. 3×[8,8,7] for inverter 0)
- **Must be removed from UI grid — config.inverters is truth**

### Pipeline 3 — `generateStringConfig()` in calculate route (DERIVED ❌)
- Source: `app/api/engineering/calculate/route.ts` lines 70-165
- Calls `generateStringConfig({ totalModules, ... })` — recomputes string layout from scratch
- Used for: NEC 690.7 Voc checks, OCPD sizing, wire gauge
- Result stored in `stringConfig` → sent back as `calcData.stringConfig`
- **The Voc calculation uses computed strings**, not `config.inverters[].strings` panel counts
- This is what causes "String 1: Voc 659V" — it's computing Voc from re-derived strings
  that don't match the actual committed layout

## Root Problem

The UI shows `sizingRecommendation.strings` (Pipeline 2) as the String Layout,
but the electrical validation in the calculate API uses `generateStringConfig` (Pipeline 3)
which independently recomputes string lengths. Neither uses `config.inverters[].strings`.

**Fix:**
1. UI: Remove `recStrings` primary path → render from `config.inverters` grouped per-inverter
2. Calculate API: Replace `generateStringConfig` Voc calc with per-string calc from `config.inverters[].strings`
   OR pass `totalStrings` (already in ComputedSystemInput) to anchor the count

## Files to Change

| File | Change | Scope |
|------|--------|-------|
| `app/engineering/page.tsx` L7685-7720 | Delete `recStrings` primary path; render from `config.inverters` per-inverter | UI fix |
| `app/api/engineering/calculate/route.ts` L70-165 | Pass actual string panel counts from `electrical.inverters[].strings` to `generateStringConfig` | Validation fix |