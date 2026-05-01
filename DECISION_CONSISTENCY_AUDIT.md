# SolarPro — Decision Consistency Audit
## Audit Date: v60.4 (pre-Phase B)
## Scope: DC/AC governance, inverter selection, string layout, BOM integration, UI truth source

---

## EXECUTIVE SUMMARY

**Phase B is SAFE to proceed** — no blocking issues.
The architecture is fundamentally sound. The findings below are fragmentation risks
and display inconsistencies, not logic errors. All must be resolved during or before Phase B.

---

## 1. DC/AC RATIO GOVERNANCE

### Constants Map

| Constant | Value | File | Used By |
|---|---|---|---|
| `DC_AC_ACCEPTABLE_MIN` | **0.9** | `feasibilityEvaluator.ts` | `bestFitEngine` (imported) |
| `DC_AC_ACCEPTABLE_MAX` | **1.55** | `feasibilityEvaluator.ts` | `bestFitEngine` (imported) |
| `DC_AC_IDEAL_MIN` | **1.1** | `feasibilityEvaluator.ts` | `bestFitEngine` (imported) |
| `DC_AC_IDEAL_MAX` | **1.3** | `feasibilityEvaluator.ts` | `bestFitEngine` (imported) |
| `PREFERRED_DC_AC_RATIO_MIN` | **1.20** | `sizingEngine.ts` | `sizingEngine` only |
| `PREFERRED_DC_AC_RATIO_MAX` | **1.40** | `sizingEngine.ts` | `sizingEngine` only |
| `PREFERRED_DC_AC_RATIO_TARGET` | **1.25** | `sizingEngine.ts` | `sizingEngine` only |
| `DC_AC_IDEAL_TARGET` | **1.20** | `bestFitEngine.ts` (local) | `bestFitEngine` only |
| *(hardcoded)* | **1.5** | `electrical-calc.ts` line 1019 | warning threshold |
| *(hardcoded)* | **1.1** | `electrical-calc.ts` line 1035 | recommendation trigger |
| *(hardcoded)* | **1.35 / 1.15** | `engineering/page.tsx` line 6796 | UI color thresholds |

### ⚠️ FINDING 1 — Two separate "ideal" definitions

`sizingEngine.ts` targets **1.25** (`PREFERRED_DC_AC_RATIO_TARGET`), ideal window **1.20–1.40**.
`bestFitEngine.ts` has its own local `DC_AC_IDEAL_TARGET = 1.20`, ideal window **1.1–1.3** (from `feasibilityEvaluator`).

These two engines use **different ideal targets** (1.25 vs 1.20) and **different ideal windows** (1.20–1.40 vs 1.10–1.30).

**Impact:** Auto-sizing prefers 1.25; best-fit scoring peaks at 1.20. These engines are currently
called in different contexts (sizingEngine via BOM route + UI; bestFitEngine not called in production —
see Finding 4), so there's no active conflict. But it's a landmine for Phase B when both paths consolidate.

**Fix:** `bestFitEngine.ts:43` — change `DC_AC_IDEAL_TARGET = 1.20` to import `PREFERRED_DC_AC_RATIO_TARGET`
from `sizingEngine.ts`, making both engines agree on 1.25.

### ⚠️ FINDING 2 — `electrical-calc.ts` uses hardcoded thresholds (not constants)

`electrical-calc.ts` lines 1019 and 1035 use magic numbers `1.5` and `1.1` for its DC/AC
warning and recommendation. These are not imported from `feasibilityEvaluator.ts`.

**Impact:** If canonical thresholds change, `electrical-calc.ts` silently disagrees.
`electrical-calc.ts`'s warning fires at 1.5 (not 1.55) — 0.05 gap vs `DC_AC_ACCEPTABLE_MAX`.

**Fix:** Import `DC_AC_ACCEPTABLE_MAX` from `feasibilityEvaluator` and replace the hardcoded 1.5.

### ⚠️ FINDING 3 — UI color thresholds (1.35 / 1.15) not derived from constants

`engineering/page.tsx` line 6796 colors the DC/AC badge using `> 1.35` and `< 1.15` thresholds.
These are not imported from any constants file. The "ideal" band for display disagrees with
`DC_AC_IDEAL_MIN = 1.1` and `DC_AC_IDEAL_MAX = 1.3`.

**Impact:** A ratio of 1.32 is green on the scoring engine but amber in the UI badge.
A ratio of 1.12 is ideal per `feasibilityEvaluator` but amber in the UI badge.

**Fix:** Derive UI color thresholds from `DC_AC_IDEAL_MIN` / `DC_AC_IDEAL_MAX` constants.

---

## 2. INVERTER SELECTION PATH

### Path Map

```
User selects inverter
       │
       ▼
sizeSystemFromBrand()  ← called from:
  - engineering/page.tsx (4 call sites: lines 779, 892, 1089, 1721, 4193)
  - /api/engineering/bom/route.ts
       │
       ▼
getBestLayoutCandidate()
  → generateLayoutCandidates()
  → selectBestLayoutCandidate()
  → returns LayoutCandidate (authoritative)
       │
       ▼
sizingRecommendation (state in engineering/page.tsx)
  - .selectedLayoutCandidate  ← the canonical LayoutCandidate
  - .inverterCount
  - .inverterModels[]
```

### ✅ LayoutCandidate IS the authority for inverter selection

`generateLayoutCandidates()` → `selectBestLayoutCandidate()` is the single path.
`sizingEngine.ts` calls it via `getBestLayoutCandidate()`. No other code path
generates a LayoutCandidate — it is defined and constructed only in
`lib/system/layoutCandidateGenerator.ts`.

### ⚠️ FINDING 4 — `bestFitEngine.ts` is DEAD CODE in production

`bestFitEngine.ts` is only called from its own test files (`bestFitEngine.test.ts`,
`hardConstraint.test.ts`). **Nothing in production calls `generateBestFitSystems()`.**

`sizingEngine.ts` uses `generateLayoutCandidates()` + `selectBestLayoutCandidate()` instead
(its own internal pipeline). `bestFitEngine` is a parallel, complete inverter selection engine
that has been superseded but not removed.

**Impact:** Dead code accrues maintenance debt; its DC/AC constants disagreement (Finding 1)
will become active if it's ever wired in. The `DC_AC_IDEAL_TARGET = 1.20` local constant
in `bestFitEngine` is a signal it was last updated before `sizingEngine` was promoted.

**Action:** Mark `bestFitEngine.ts` as `@deprecated` (same pattern as V1/V2 structural engines).
Phase C candidate for removal after confirming test coverage doesn't depend on it exclusively.

### ⚠️ FINDING 5 — `inverterCount` has 3 fallback layers in the UI

`engineering/page.tsx` resolves `inverterCount` via a cascaded IIFE at 4 call sites (lines
3380, 3731, 4025, 4561):
1. `if (firstInv?.type === 'micro') return 1`
2. `if (sizingRecommendation?.inverterCount) return sizingRecommendation.inverterCount`
3. Fallback: infer from `config.inverters.length` with stale-state detection

This means if `sizingRecommendation` is null/stale, `inverterCount` falls back to
raw config state which may be wrong (e.g. string-count-as-inverter-count bug).

**Impact:** Low risk today (sizing rec is always run before render), but the duplicated
IIFE at 4 separate call sites creates maintenance risk. A single `resolvedInverterCount`
variable should be derived once at the top of the component.

---

## 3. STRING LAYOUT CONSISTENCY

### Path Map

```
LayoutCandidate.stringLayout  ←  generateLayoutCandidates()
       │                              (lib/system/layoutCandidateGenerator.ts)
       ▼
sizingRecommendation.selectedLayoutCandidate.stringLayout
       │
       ├─► SLD renderer (via prop: selectedLayoutCandidate)
       ├─► Validation panel (via prop: selectedLayoutCandidate)
       └─► Engineering Truth store
```

```
/api/engineering/sld  ←  calls generateStringConfig() DIRECTLY
/api/engineering/calculate  ←  calls generateStringConfig() DIRECTLY
```

### ⚠️ FINDING 6 — SLD API route bypasses LayoutCandidate, calls `generateStringConfig()` directly

`/api/engineering/sld/route.ts` and `/api/engineering/calculate/route.ts` both call
`generateStringConfig()` directly from `lib/string-generator.ts`, **not** from a `LayoutCandidate`.

`lib/string-generator.ts` is a lower-level primitive; `layoutCandidateGenerator.ts` calls it
internally but adds the full MPPT allocation, feasibility scoring, and BOM generation on top.

**Impact:**
- The SLD diagram is generated from a raw `generateStringConfig()` call, not the
  `LayoutCandidate.stringLayout` that the UI displays. If these disagree (e.g. MPPT
  allocation differs), the SLD won't match the UI string plan.
- `dcAcRatio` in the SLD response (line 405, 447) is recomputed as
  `stringResult.totalDcPower / (acOutputKw * 1000)` — a third independent calculation.

**Fix (Phase B target):** The SLD API route should accept a `selectedCandidateKey` and look up
the pre-computed `LayoutCandidate.stringLayout`, falling back to `generateStringConfig()` only
when no candidate is available (backward compat). This ensures SLD = UI = BOM for string plans.

### ✅ UI string recommendation reads from `sizingRecommendation`

`engineering/page.tsx` line 5423: `_branchCount` prefers `sizingRecommendation.strings.length`
over raw `config.inverters` string count. This is correct.

---

## 4. BOM INTEGRATION

### Path Map

```
/api/engineering/bom  →  sizeSystemFromBrand()  →  sizingResultToBomItems()  →  V4 BOM engine
```

### ⚠️ FINDING 7 — BOM route derives `panelWattage` from `systemKw / moduleCount`, not from panel ID

```typescript
const panelWattage = input.moduleCount > 0
  ? Math.max(50, Math.round((input.systemKw * 1000) / input.moduleCount))
  : 400;
```

The BOM route **infers** panel wattage by dividing system kW by module count.
It does not look up the actual panel's electrical specs (`Voc`, `Isc`, `Vmp`, `Imp`)
from the equipment database. These are passed to the SLD route explicitly but
**not** to `sizeSystemFromBrand()` in the BOM route.

**Impact:**
- If panel wattage inference rounds incorrectly (e.g. rounding error on non-round wattages
  like 405W, 415W), the BOM sizing engine may select a slightly different inverter
  than what the UI displays.
- `panelIsc` / `panelVoc` are not available to the BOM's sizing path — only panel wattage.
  The SLD route explicitly accepts `panelVoc`, `panelIsc` from the request body.

**Fix:** BOM route should accept and pass `panelId` → look up full panel specs from equipment-db
instead of inferring wattage. This is already done by the SLD route.

### ✅ V4 BOM engine uses `inverterId` + `panelId` for electrical counting

`/api/engineering/bom/route.ts` passes `panelId` and `inverterId` to V4, which
looks up all electrical specs directly from `equipment-db`. The sizing engine only
needs `panelWattage` for inverter selection logic; V4 handles electrical BOM independently.

### ✅ `sizingToBom.ts` correctly avoids duplicating V4-owned categories

The `V4_OWNED_FOR_ADAPTER` set prevents double-counting of panels, inverters,
batteries, wire, conduit, and breakers.

---

## 5. UI TRUTH SOURCE

### `canonicalAcKw` derivation (correct)

```typescript
const canonicalAcKw = _recInverterAcKw > 0   // sizingRecommendation.inverterModels sum
  ? _recInverterAcKw
  : Number(totalInverterKw);                  // fallback: config.inverters sum from equipment-db
```

`canonicalAcKw` correctly prefers the sizing engine's authoritative result and only
falls back to config state when no recommendation exists.

### ✅ Electrical tab, Engineering Summary, right-panel DC/AC: all read `canonicalAcKw`

Lines 5419, 7671, 7701 all use `canonicalAcKw`. Consistent.

### ⚠️ FINDING 8 — Two independent `dcAcRatio` computations in `engineering/page.tsx`

| Location | Formula | Used For |
|---|---|---|
| Line 5420 | `(_totalKwNum / canonicalAcKw).toFixed(2)` | Display badge, compliance summary |
| Line 1749 | `_dcKw / _acKw` | Guard: suppress `selectedInverterId` when ratio < 1.0 |
| `/api/engineering/sld` line 447 | `stringResult.totalDcPower / (acOutputKw * 1000)` | SLD response payload |

Line 5420 uses `canonicalAcKw` (correct). Line 1749 uses `Number(totalInverterKw)` (config-derived,
may be stale). SLD route computes its own ratio from string generator output.

**Impact:** Minor — line 1749 is a guard condition, not a display value. SLD ratio is for
diagram metadata. But three independent formulas means three potential sources of drift.

**Fix:** Consolidate: derive `canonicalDcAcRatio` once from `canonicalAcKw` and reuse everywhere.

### ⚠️ FINDING 9 — `totalDcKw` in structural/BOM call at lines 4364 and 10746 uses `panels * 0.4`

```typescript
totalDcKw: parseFloat(projectLayout?.panels?.length > 0
  ? (projectLayout.panels.length * 0.4).toFixed(2)  // ← hardcoded 0.4 kW/panel
  : totalKw),
```

This hardcodes 400W per panel for the DC kW calculation inside the structural input object.
If the selected panel is not 400W (e.g. 415W Silfab, 440W REC), this produces a wrong `totalDcKw`.

**Impact:** The structural input gets incorrect DC power. This affects:
- Load calculations in structural-engine-v4
- BOM kW display in the structural section

**Fix:** Replace `panels.length * 0.4` with `panels.length * (panelWattage / 1000)` where
`panelWattage` comes from the selected panel's equipment-db entry (same as `totalWatts` computation).

---

## 6. SUMMARY: FINDINGS BY SEVERITY

### 🔴 Must fix before Phase B wires engines together (2 findings)

| # | Finding | File | Fix |
|---|---|---|---|
| 1 | `bestFitEngine` DC_AC_IDEAL_TARGET = 1.20 disagrees with sizingEngine target of 1.25 | `bestFitEngine.ts:43` | Import `PREFERRED_DC_AC_RATIO_TARGET` from sizingEngine |
| 9 | `panels * 0.4` hardcodes 400W for structural DC kW input — wrong for non-400W panels | `page.tsx:4364, 10746` | Use `panelWattage / 1000` from equipment-db |

### 🟡 Fix during Phase B (4 findings)

| # | Finding | File | Fix |
|---|---|---|---|
| 2 | `electrical-calc.ts` magic numbers 1.5 / 1.1 not from constants | `electrical-calc.ts:1019,1035` | Import `DC_AC_ACCEPTABLE_MAX` / `DC_AC_IDEAL_MIN` |
| 3 | UI badge color thresholds 1.35 / 1.15 not from constants | `page.tsx:6796` | Derive from `DC_AC_IDEAL_MIN` / `DC_AC_IDEAL_MAX` |
| 6 | SLD + calculate API routes call `generateStringConfig()` directly, bypass LayoutCandidate | `sld/route.ts`, `calculate/route.ts` | Accept `candidateKey`, look up from LayoutCandidate |
| 8 | Three independent `dcAcRatio` computations in UI + SLD route | `page.tsx:5420,1749`, `sld/route.ts:447` | Derive `canonicalDcAcRatio` once, reuse |

### 🟢 Fix in Phase C or next sprint (3 findings)

| # | Finding | File | Fix |
|---|---|---|---|
| 4 | `bestFitEngine.ts` is dead code — only called from tests, never in production | `bestFitEngine.ts` | Mark `@deprecated`, Phase C removal |
| 5 | `inverterCount` IIFE duplicated at 4 call sites in UI | `page.tsx:3380,3731,4025,4561` | Single `resolvedInverterCount` variable |
| 7 | BOM route infers `panelWattage` from `systemKw/moduleCount`, doesn't pass `panelId` to sizeSystemFromBrand | `bom/route.ts:391` | Accept `panelId`, look up from equipment-db |

---

## 7. PHASE B SAFETY VERDICT

**✅ Safe to proceed with Phase B DB consolidation.**

None of the findings above block the Phase B work of:
- Collapsing `racking-database.ts` into `mounting-hardware-db.ts`
- Making `equipment-registry.ts` a thin shim over V4

The red findings (1, 9) should be addressed as quick fixes **at the start of Phase B** before
the database migration begins, since they affect correctness of values flowing through the
consolidated DB paths.

---

## 8. FILES THAT BYPASS CANONICAL LAYOUT LOGIC

| File | What it bypasses | Severity |
|---|---|---|
| `app/api/engineering/sld/route.ts` | Calls `generateStringConfig()` directly, not from `LayoutCandidate.stringLayout` | 🟡 Medium |
| `app/api/engineering/calculate/route.ts` | Calls `generateStringConfig()` directly, not from `LayoutCandidate.stringLayout` | 🟡 Medium |
| `lib/system/bestFitEngine.ts` | Complete parallel inverter selection engine, not wired to production | 🟢 Low (dead code) |

## 9. DUPLICATE DECISION PATHS

| Decision | Paths | Files |
|---|---|---|
| DC/AC ratio calculation | 3 independent formulas | `page.tsx:5420`, `page.tsx:1749`, `sld/route.ts:447` |
| `inverterCount` resolution | 3-layer IIFE at 4 call sites | `page.tsx:3380,3731,4025,4561` |
| Panel wattage in structural input | Hardcoded `* 0.4` vs `totalWatts` computation | `page.tsx:4364,10746` vs `page.tsx:1394` |
| DC/AC ideal target | 1.25 in `sizingEngine` vs 1.20 in `bestFitEngine` | `sizingEngine.ts:615` vs `bestFitEngine.ts:43` |

## 10. CONFLICTING DC/AC CONSTANTS

| Constant purpose | Value in feasibilityEvaluator | Value in sizingEngine | Value in bestFitEngine | Value in electrical-calc | Value in UI display |
|---|---|---|---|---|---|
| Acceptable min | 0.9 | 1.00 (hard floor) | — (imports 0.9) | — | — |
| Acceptable max | 1.55 | 1.40 (preferred max) | — (imports 1.55) | **1.5** (hardcoded) | **1.6** (red threshold) |
| Ideal min | 1.1 | **1.20** | — (imports 1.1) | — | **1.15** (amber threshold) |
| Ideal max | 1.3 | **1.40** | — (imports 1.3) | — | **1.35** (amber threshold) |
| Ideal target | — | **1.25** | **1.20** (local) | — | — |