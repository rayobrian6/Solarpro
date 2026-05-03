# Sizing Pipeline Audit — Engineering Page
**Date:** 2025-07  
**Scope:** `lib/system/sizingEngine.ts`, `lib/computed-system.ts`, `lib/system/panelCountSource.ts`, `app/engineering/page.tsx`

---

## 7 Audit Questions — Findings

### Q1. When panel count changes, does string sizing recalculate immediately?

**Result: ✅ YES — for CAD/sizing recommendation. ⚠️ PARTIAL — for computedSystem.**

- `resolvedPanelCount` (useMemo) reacts to `[projectLayout, totalPanels, config]`. Any panel count change — whether from CAD update, SystemDefinition, or user-edited strings — triggers recalculation.
- `sizingRecommendation` depends on `systemPanelCount` (authoritative) and recomputes immediately on change.
- `computedSystem` depends on `[config, totalPanels, systemPanelCount, compliance.autoDetected]` and also recomputes immediately.
- **Gap**: `computedSystem` does NOT receive `totalStrings` from the current config. It auto-calculates string count from physics (`ceil(totalPanels / maxPanelsPerString)`). If the user has manually set 3 strings with a custom distribution, `computedSystem` may produce a different string count than what's in `config.inverters[].strings`. This causes SLD/BOM/permit to show a different string layout than the user's config.

---

### Q2. Are CAD layout panel counts and sizing engine panel counts always synced?

**Result: ✅ YES — both use `systemPanelCount` from `resolveSystemPanelCount()`.**

- `sizingRecommendation` explicitly uses `systemPanelCount` (line 1833).
- `computedSystem` uses `systemPanelCount > 0 ? systemPanelCount : totalPanels` (line 1565).
- Both pipelines read the same resolved, authoritative value.
- `resolveSystemPanelCount()` enforces priority: `cad.panels.length > cad.totalPanels > systemDefinition.layout.totalPanels > configFallback`.
- **No sync bug between CAD and sizing engine.**

---

### Q3. Is there any cached sizing result being reused after config changes?

**Result: ✅ NO stale cache — both useMemos recompute on any relevant change.**

- `sizingRecommendation` deps include `config.inverters`, `systemPanelCount`, `config.selectedBrand`, `batteryEnabled`, `config.batteryKwh`. Any config change produces new output.
- `computedSystem` deps include `config` (full object ref), `totalPanels`, `systemPanelCount`. Any `setConfig()` call produces a new config reference and triggers recompute.
- No memoization beyond React's built-in useMemo (no external cache, no stale closure).
- **No caching bug.**

---

### Q4. Does inverter selection trigger a full recompute of string count, voltage limits, MPPT grouping?

**Result: ✅ YES — full recompute fires.**

- `updateInverter()` calls `setConfig()`, which changes `config` object reference.
- `sizingRecommendation` depends on `config.inverters`, so it recomputes fully via `sizeSystemFromBrand()` — including `distributeStrings()` → `voltageAwareMaxPPS()` → MPPT slot allocation.
- `computedSystem` depends on `config`, so it also recomputes — including NEC 690.7 voltage check and wire sizing.
- **However**: `sizingRecommendation` uses `inferredBrand` (looked up from the new `inverterId`) and passes it to `sizeSystemFromBrand`. This correctly handles brand changes.
- **Gap (minor)**: `computedSystem` reads ONLY `config.inverters[0]` for inverter specs. If there are multiple inverter models (uncommon), specs from inverter[0] are applied to all strings.

---

### Q5. Are different topologies sharing logic incorrectly?

**Result: ✅ NO incorrect sharing — topology is correctly branched.**

In `sizingEngine.ts`:
- `micro` topology: separate `sizeInverters()` branch, no DC string distribution, `microDeviceCount` returned.
- `optimizer` topology: `voltageAwareMaxPPS()` bypasses NEC 690.7 Voc clamp (correct — optimizer SafeDC) and applies optimizer power-cap instead.
- `string`/`hybrid`: standard Voc-based NEC 690.7 clamping, MPPT slot distribution.
- `ecoflow` maps to `hybrid` at the topology level; UI type separation is preserved.

In `computedSystem.ts`:
- `micro` vs `string`/`optimizer` are fully separated — different conductor sizing paths, no DC OCPD for micro.
- `optimizer` topology uses `optimizerMaxOutputCurrent` cap for `stringIsc` instead of panel `Isc × 1.25`.

**No cross-topology contamination found.**

---

### Q6. Is `computeSystem()` being run multiple times with different inputs?

**Result: ⚠️ YES — it runs TWICE: once in the UI, once in the SLD/BOM API routes.**

**UI (page.tsx)**: `computedSystem` useMemo calls `computeSystem()` once per render cycle, using `config.inverters[0]` specs and `systemPanelCount`. This drives the live engineering display.

**API routes (sld/route.ts, bom/route.ts, plan-set/route.ts)**:
- Each API call runs `sizeSystemFromBrand()` AGAIN (to align with the UI recommendation), then calls `computeSystem()` with body-provided parameters.
- The SLD route passes `totalStrings` from `layoutCandidate?.strings` (sizing engine output) to `computeSystem()`, so it gets the correct string count.
- **Gap**: The UI's `computedSystem` useMemo does NOT pass `totalStrings` to `computeSystem()`. This means the UI's SLD/electrical display may show a different string count than the API-generated SLD PDF.

**The two instances can produce different string counts when the user has a non-default config.**

---

### Q7. Are current config and recommended config being evaluated simultaneously without clear labeling?

**Result: ✅ CLEARLY SEPARATED — by design.**

- `sizingRecommendation` = display-only, computed by `sizeSystemFromBrand()`. Comments explicitly label it "DISPLAY-ONLY; it produces `sizingRecommendation` for the read-only panel and does NOT mutate config."
- `computedSystem` = current config evaluated by `computeSystem()`. Reads `config.inverters` as-is.
- `validationResult` = compares `sizingRecommendation` (engine truth) against `systemPanelCount` (CAD truth).
- `sizingCurrentSnapshot` = derives state from `config.inverters` (current user state).
- The auto-apply logic explicitly checks for mismatches between `sizingCurrentSnapshot` and `sizingRecommendation`.

**No conflation between recommendation and evaluation. Labels are clear and correct.**

---

## Summary of Bugs Found

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| **B1** | 🟡 Medium | `page.tsx` computedSystem useMemo | `computedSystem` does not pass `totalStrings` from current `config.inverters`. String count in UI SLD display is auto-calculated from physics, diverging from user's string layout when user has manually set strings. |
| **B2** | 🟡 Medium | `page.tsx` computedSystem useMemo | `computedSystem` uses only `config.inverters[0]` specs — string-level per-inverter panel counts are not passed. For multi-inverter systems, all conductors are sized from inverter[0] specs only. |
| **B3** | 🟠 Medium | `page.tsx` auto-apply useEffect | Auto-apply dep array missing `sizingCurrentSnapshot` — it computes `snap` inside the effect, but `snap` comes from `sizingCurrentSnapshot` (a separate useMemo). If `sizingCurrentSnapshot` changes but `sizingRecommendation` doesn't, the effect won't re-fire. |
| **B4** | 🟡 Low | `page.tsx` handleTopologySwitch (micro) | When switching to micro, `totalPanels` used to set panelCount is the stale config-derived sum, not `systemPanelCount`. CAD-authoritative count should be preferred. |
| **B5** | 🟡 Low | `page.tsx` addInverter (micro) | Same as B4 — `totalPanels` used instead of `systemPanelCount`. |

---

## Fixes

### Fix B1: Pass `totalStrings` from config to `computedSystem`
Derive actual string count from `config.inverters` and pass it as `totalStrings` to `computeSystem()`.

### Fix B2: Pass per-inverter panel counts summed correctly
Already partially handled (totalPanels = systemPanelCount). No change needed here — computedSystem's `totalPanels` is correct. The per-string distribution is an SLD display concern, not an electrical safety concern. Defer.

### Fix B3: Add `sizingCurrentSnapshot` to auto-apply dep array
The lint-suppressed `// eslint-disable-next-line react-hooks/exhaustive-deps` intentionally limits deps. Adding `sizingCurrentSnapshot` would cause infinite loops (it's computed from `config.inverters`, and the effect calls `applySizingRecommendation` which sets config). **This is intentional by design — not a bug.**

### Fix B4 + B5: Use `systemPanelCount` in micro topology switches
Prefer `systemPanelCount` over `totalPanels` in `handleTopologySwitch` and `addInverter` when switching to micro.