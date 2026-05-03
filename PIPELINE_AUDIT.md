# SolarPro Engineering Module — Full Pipeline Audit v1.0

**Date:** 2025-01-31  
**Scope:** Every pipeline that reads, derives, or mutates system state for the engineering module  
**Branches audited:** `dev` (current HEAD after commits 7f4849a, c850961)  
**Auditor:** SuperNinja AI — automated static analysis + code reading

---

## Table of Contents

1. [Pipeline Inventory](#1-pipeline-inventory)
2. [Mutation vs Compute Matrix](#2-mutation-vs-compute-matrix)
3. [Source of Truth Map](#3-source-of-truth-map)
4. [Conflict List](#4-conflict-list)
5. [Architecture Verdict](#5-architecture-verdict)
6. [Risk Assessment](#6-risk-assessment)

---

## 1. Pipeline Inventory

18 distinct pipelines were identified. Each entry lists: trigger, entry point, what it reads, what it writes, and its classification.

---

### P-01 · CAD Layout Pipeline

| Field        | Value |
|--------------|-------|
| **Trigger**  | User places panels in Design Studio (`/design`) |
| **Entry point** | `app/design/page.tsx` → DB write |
| **Reads**    | User mouse/placement input; satellite tiles; geocoded address |
| **Writes**   | `layout` DB record: `panels[]`, `totalPanels`, `systemSizeKw`, `roofPlanes[]`, `updatedAt` |
| **Class**    | **MUTATION — Ground Truth Emitter** |
| **Notes**    | This is the upstream origin of `panelCount`. ALL downstream pipelines derive from `layout.panels.length`. No compute — raw placement data. |

---

### P-02 · Sync Pipeline (Server-side Reconciliation)

| Field        | Value |
|--------------|-------|
| **Trigger**  | Engineering page load (`useEffect` once on `currentProjectId`); also called by permit preflight |
| **Entry point** | `GET /api/engineering/sync-pipeline` → `lib/engineering/syncPipeline.ts:syncProjectPipeline()` |
| **Reads**    | DB: `layout`, `project`, `engineeringReport`; satellite image service |
| **Writes**   | DB: `engineeringReport` (upsert if stale or missing); `designVersionId` |
| **Class**    | **COMPUTE + CONDITIONAL MUTATION** |
| **Notes**    | Calls `generateEngineeringReport()` when report is stale. Performs `validatePipelineSync()` — if `panelCount` mismatch is ERROR severity, adds error to result (does NOT auto-fix DB). Returns `layoutPanelCount`, `panelCount`, `panelModel`, `inverterModel`, `wasRebuilt`. |

---

### P-03 · Panel Count Fix Path (Client-side Sync useEffect)

| Field        | Value |
|--------------|-------|
| **Trigger**  | `useEffect` on page.tsx after sync-pipeline response, when `layout.panelCount > 0` AND (`currentTotal !== layout.panelCount` OR `_is1xNState`) |
| **Entry point** | `app/engineering/page.tsx` ~line 4705 (sync-pipeline useEffect, panel-count-fix block) |
| **Reads**    | `layout.panelCount` (from sync-pipeline API), `config.inverters`, `sizingRecommendation` |
| **Writes**   | `config.inverters[]` (string rebuild), `stringsPerInverter`, `modulesPerString` via `setConfig()` |
| **Class**    | **MUTATION — Config Repair** |
| **Notes**    | Calls `sizeSystemFromBrand()` to produce correct string distribution, then writes via `setConfig`. Also detects 1xN corrupt state (`_is1xNState`). Sets `stringsPerInverter` + `modulesPerString` metadata (v61.2 fix). |

---

### P-04 · savedConfig Hydration + Corruption Detector

| Field        | Value |
|--------------|-------|
| **Trigger**  | Page load — `useEffect` runs `savedConfig` deserialization once |
| **Entry point** | `app/engineering/page.tsx` ~line 1037 (savedConfig useEffect) |
| **Reads**    | `savedConfig` (DB-persisted JSON or localStorage fallback) |
| **Writes**   | `config.inverters[]` via `setConfig()` — rebuilds corrupt strings; sets `stringsPerInverter`, `modulesPerString` |
| **Class**    | **MUTATION — Hydration + Corruption Repair** |
| **Notes**    | Detects two corrupt states: NxN (many strings x 1 panel) and 1xN (1 string x N panels, non-micro). Rebuilds strings via `sizeSystemFromBrand()`. Three hydration sub-paths: `inv-seed-0`, `inv-auto-0`, `inv-restored-0` — all now set metadata (v61.2). Corruption detector also updates `stringsPerInverter` + `modulesPerString` to prevent reconciliation step from undoing the fix. |

---

### P-05 · Sizing/Recommendation Engine

| Field        | Value |
|--------------|-------|
| **Trigger**  | `useMemo` — recomputes on `config.inverters`, `systemPanelCount`, `selectedBrand`, `batteryEnabled`, etc. |
| **Entry point** | `app/engineering/page.tsx` → `sizeSystemFromBrand()` in `lib/system/sizingEngine.ts` |
| **Reads**    | `systemPanelCount`, `config.inverters[0].inverterId`, `selectedBrand`, `batteryEnabled`, `batteryMode`, `config.systemType` |
| **Writes**   | **COMPUTE ONLY** — returns `sizingRecommendation` (React state, not DB) |
| **Class**    | **COMPUTE — Advisory Output** |
| **Notes**    | Pure function. Result stored in `sizingRecommendation` local state. Does NOT write to DB or `config`. Output consumed by: STRING LAYOUT display, banner comparison, Auto-Apply watcher, Smart Defaults bootstrap, Panel Compatibility Watcher. |

---

### P-06 · Smart Defaults (Phase 13 Bootstrap)

| Field        | Value |
|--------------|-------|
| **Trigger**  | `useEffect` fires ONCE when `!config.defaultsApplied && systemPanelCount > 0 && !config.userHasEditedInverters` |
| **Entry point** | `app/engineering/page.tsx` ~line 2524 → `applySmartDefaultsOnce()` in `lib/system/smartDefaults.ts` |
| **Reads**    | `config.systemType`, `config.inverters`, `systemPanelCount`, `panelWattage` |
| **Writes**   | `config.inverters[]`, `config.defaultsApplied = true`, optionally `selectedBrand` via `setConfig()` |
| **Class**    | **MUTATION — One-shot Bootstrap** |
| **Notes**    | Once `defaultsApplied` is set to `true`, this path is permanently disabled until explicit reset. Calls `sizeSystemFromBrand()` internally. Guard: `userHasEditedInverters` blocks re-entry even if sentinel is cleared. NOTE: does NOT set `stringsPerInverter`/`modulesPerString` on built inverters — see C-06. |

---

### P-07 · Auto-Apply Watcher

| Field        | Value |
|--------------|-------|
| **Trigger**  | `useEffect` on `[sizingAutoApply, sizingRecommendation, config.userHasEditedInverters, controlMode, configLocks]` |
| **Entry point** | `app/engineering/page.tsx` ~line 2605 → `applySizingRecommendation()` |
| **Reads**    | `sizingAutoApply` flag, `sizingRecommendation`, `sizingCurrentSnapshot`, `config.userHasEditedInverters`, `controlMode`, `configLocks` |
| **Writes**   | `config.inverters[]`, `config.selectedBrand`, `userHasEditedInverters = false`, `displayMode = 'current'` via `setConfig()` |
| **Class**    | **MUTATION — Automated Recommendation Apply** |
| **Notes**    | Blocked by `userHasEditedInverters = true`. Compares `sizingCurrentSnapshot` vs `sizingRecommendation` — triggers on topology, count, model, or string-layout mismatch. In `guided` mode, queues `pendingSuggestion` instead of silently applying. v61 adds `controlMode` + `configLocks` gate. |

---

### P-08 · Explicit Apply Recommendation (Manual User Action)

| Field        | Value |
|--------------|-------|
| **Trigger**  | User clicks "Apply Recommendation" button |
| **Entry point** | `app/engineering/page.tsx:applySizingRecommendation()` ~line 2313 |
| **Reads**    | `sizingRecommendation`, `config.inverters`, `ecosystemBrand`, `batteryEnabled`, `config.batteryId` |
| **Writes**   | `config.inverters[]` (full rebuild), `selectedBrand`, `userHasEditedInverters = false`, `displayMode = 'current'`, battery fields (if no ecosystem battery) via `setConfig()` |
| **Class**    | **MUTATION — User-triggered** |
| **Notes**    | Groups engine strings by `inverterIndex` into multi-inverter config. Handles micro/optimizer/hybrid/string topologies. Ecosystem battery guard: preserves existing battery if `ecosystemBrand` is set. Panel swap gate: respects `panelCompatibility.autoSwitched`. |

---

### P-09 · Ecosystem Apply Pipeline

| Field        | Value |
|--------------|-------|
| **Trigger**  | User selects brand in Ecosystem Picker component |
| **Entry point** | `app/engineering/page.tsx:onApply` callback ~line 7080 |
| **Reads**    | `payload.brand`, `payload.selections.inverterId`, `payload.selections.batteryId`, `payload.kit`, `config.inverters[0]` |
| **Writes**   | `config.ecosystemBrand`, `config.inverters[0].inverterId`, `config.inverters[0].type`, optionally `optimizerPeripheralId`; `config.batteryId`, `batteryBrand`, `batteryModel`, `batteryKwh`; `userHasEditedInverters = true` via `updateConfig()` |
| **Class**    | **MUTATION — User-triggered Brand Application** |
| **Notes**    | Optimizer peripheral ID resolution: stores `centralInvId` in `inverterId` (for sizing/brand inference) AND `optimizerPeripheralId` (for BOM Stage 1). Locks `userHasEditedInverters = true` after apply to prevent auto-sizing overwrite. Does NOT rebuild `strings[]` directly — sizing engine picks up new `inverterId` and recomputes. |

---

### P-10 · Topology Switch Pipeline

| Field        | Value |
|--------------|-------|
| **Trigger**  | User clicks topology radio (Micro / String / Optimizer / Hybrid) |
| **Entry point** | `app/engineering/page.tsx:handleTopologySwitch()` ~line 2879 → `POST /api/engineering/topology` |
| **Reads**    | New topology type, `config.inverters`, `config.batteryId`, `config.ecosystemBrand` |
| **Writes**   | `config.topologyType`, `config.topologySwitching`; API returns new `sldStages`, `bomStages`, `resolvedAccessories`, `complianceFlags`; propagates to ecosystem if applicable. Clears `ecosystemBrand` if user manually switches. |
| **Class**    | **MUTATION — User-triggered Topology Change** |
| **Notes**    | Uses registry-driven V4 topology manager (`lib/topology-manager.ts:resolveTopology()`). Does NOT rebuild `config.inverters[]` strings — left to downstream sizing engine recalc. |

---

### P-11 · Panel Compatibility Auto-Heal Watcher

| Field        | Value |
|--------------|-------|
| **Trigger**  | `useEffect` on `[sizingRecommendation.panelCompatibility.autoSwitched, effectivePanelId, config.inverters]` |
| **Entry point** | `app/engineering/page.tsx` ~line 2723 |
| **Reads**    | `sizingRecommendation.panelCompatibility` (autoSwitched, effectivePanelId) |
| **Writes**   | `config.inverters[*].strings[*].panelId` via `setConfig()` if any string's panelId doesn't match `effectivePanelId` |
| **Class**    | **MUTATION — NEC Compliance Auto-Heal** |
| **Notes**    | Intentionally does NOT set `userHasEditedInverters = true` (compliance correction, not a user edit). Brand-agnostic — any brand registered in `BRAND_PROFILES` inherits this automatically. |

---

### P-12 · DC/AC Ratio Hard-Error Auto-Heal

| Field        | Value |
|--------------|-------|
| **Trigger**  | `useEffect` on validation result when `DC_AC_RATIO_AC_EXCEEDS_DC` error is present AND `userHasEditedInverters = true` |
| **Entry point** | `app/engineering/page.tsx` ~line 2660 |
| **Reads**    | `validationResult.errors`, `sizingRecommendation`, `config.userHasEditedInverters` |
| **Writes**   | `config.inverters[]` via `applySizingRecommendation()` — overrides user lock for hard electrical constraint |
| **Class**    | **MUTATION — Override Safety Valve** |
| **Notes**    | One of only two places that overrides `userHasEditedInverters`. The other is the explicit Apply button (P-08). |

---

### P-13 · Auto-Fill Pipeline

| Field        | Value |
|--------------|-------|
| **Trigger**  | User clicks "Auto-Fill" button |
| **Entry point** | `app/engineering/page.tsx:handleAutoFill()` ~line 4309 → `POST /api/engineering/topology` + optional Enphase API |
| **Reads**    | Current `config`, system metadata, Enphase BOM result (if micro topology) |
| **Writes**   | Non-inverter config patches: `rackingId`, `wireType`, `conduitType`, `roofType`, `afci`, `rapidShutdownDevice`, etc. via `updateConfig()`. Does NOT write `config.inverters[]`. |
| **Class**    | **MUTATION — Accessory/BOS Auto-Population** |
| **Notes**    | Writes balance-of-system (BOS) fields, not inverter topology. For Enphase, auto-populates trunk cables, terminators, combiners from BOM result. |

---

### P-14 · Auto-Fix All Pipeline

| Field        | Value |
|--------------|-------|
| **Trigger**  | User clicks "Auto-Fix All" button |
| **Entry point** | `app/engineering/page.tsx:handleAutoFixAll()` ~line 4418 → `POST /api/engineering/structural-v2` → feasibility fix engine |
| **Reads**    | Current `config`, `validationResult`, structural constraint inputs |
| **Writes**   | `config.inverters[]` (potentially full rebuild via `applyFeasibleFix()`) + structural fields via `updateConfig()` |
| **Class**    | **MUTATION — User-triggered Structural Fix** |
| **Notes**    | Calls structural API, gets feasibility result, applies via `applyFeasibleFix()`. Can completely replace inverter topology if structural constraints demand it. |

---

### P-15 · SLD Generation Pipeline (Server)

| Field        | Value |
|--------------|-------|
| **Trigger**  | User clicks "Generate SLD" / SLD tab loads |
| **Entry point** | `POST /api/engineering/sld` |
| **Reads**    | Request body: `panelCount`, `inverterId`, `topologyType`, `panelVoc/Isc/Vmp/Imp`, `systemKw`, battery fields, etc. |
| **Writes**   | **No DB write** — returns SVG/HTML SLD document |
| **Class**    | **COMPUTE — Server-side Electrical Calculation** |
| **Notes**    | Calls `sizeSystemFromBrand()` THEN `computeSystem()` in same request. `sizeSystemFromBrand()` is used to derive canonical topology/string layout from brand profile; `computeSystem()` is the SINGLE SOURCE OF TRUTH for all NEC 690.7 voltage, OCPD, wire gauge values. Result = rendered SLD. Does NOT write back to `config`. |

---

### P-16 · Plan-Set / Permit Generation Pipeline (Server)

| Field        | Value |
|--------------|-------|
| **Trigger**  | User requests permit package |
| **Entry point** | `POST /api/engineering/plan-set` → `buildCanonical()` → `computeSystem()` |
| **Reads**    | Request body: full project payload including `layout.panels[]`, `system.inverters[]`, compliance data |
| **Writes**   | **No DB write to config** — returns PDF/HTML permit document |
| **Class**    | **COMPUTE — Server-side Permit Generation** |
| **Notes**    | `buildCanonical()` is the ONLY place that locks system type from `layout.panels` geometry. Throws (hard fail) if `layout` or `layout.panels` is missing. `computeSystem()` called ONCE as single source of truth for all electrical values. |

---

### P-17 · BOM Generation Pipeline (Server)

| Field        | Value |
|--------------|-------|
| **Trigger**  | User opens BOM tab or requests BOM export |
| **Entry point** | `POST /api/engineering/bom` |
| **Reads**    | Request body: `moduleCount`, `inverterId`, `systemKw`, `systemType`, `batteryEnabled`, etc. |
| **Writes**   | **No DB write** — returns BOM line items |
| **Class**    | **COMPUTE — Server-side BOM Calculation** |
| **Notes**    | Calls `sizeSystemFromBrand()` for topology resolution and micro-strip logic. BOM stages driven by `TOPOLOGY_RULES[topology].bomStages`. Does NOT call `computeSystem()` (electrical values not needed for BOM). |

---

### P-18 · Proposal PDF Pipeline (Server)

| Field        | Value |
|--------------|-------|
| **Trigger**  | User generates proposal PDF |
| **Entry point** | `POST /api/proposals/[id]/pdf` → `buildCanonicalProposal()` |
| **Reads**    | Project data, `panelCount`, `panelSpec`, `layoutSystemSizeKw`, energy flow data |
| **Writes**   | **No DB write** — returns PDF document |
| **Class**    | **COMPUTE — Proposal Generation** |
| **Notes**    | `validatePanelIntegrity()` is the single authority on wattage/count/systemSizeKw in this pipeline. Locks `resolvedSystemSizeKw = (count x wattage) / 1000`. Does NOT call `sizeSystemFromBrand()` or `computeSystem()`. |

---

## 2. Mutation vs Compute Matrix

| Pipeline | Class | Writes `config.inverters` | Writes DB | Calls `sizeSystemFromBrand` | Calls `computeSystem` | User Lock Required |
|----------|-------|--------------------------|-----------|----------------------------|----------------------|-------------------|
| P-01 CAD Layout | MUTATION (GT) | No | Yes (layout) | No | No | N/A |
| P-02 Sync Pipeline | COMPUTE + COND MUTATION | No | Yes (engReport) | No | No | No |
| P-03 Panel Count Fix | MUTATION | **Yes** | No | **Yes** | No | No |
| P-04 savedConfig Hydration | MUTATION | **Yes** | No | **Yes** | No | No |
| P-05 Sizing Engine | COMPUTE | No (advisory) | No | **Yes** | No | N/A |
| P-06 Smart Defaults | MUTATION (1-shot) | **Yes** | No (deferred) | **Yes** | No | Yes (`userHasEditedInverters`) |
| P-07 Auto-Apply Watcher | MUTATION | **Yes** | No (deferred) | No (uses P-05 result) | No | Yes (`userHasEditedInverters`) |
| P-08 Explicit Apply | MUTATION | **Yes** | No (deferred) | No (uses P-05 result) | No | N/A (user action) |
| P-09 Ecosystem Apply | MUTATION | **Yes** (inverterId only) | No (deferred) | No | No | N/A (user action) |
| P-10 Topology Switch | MUTATION | No (type only) | No (deferred) | No | No | N/A (user action) |
| P-11 Panel Compat Heal | MUTATION | **Yes** (panelId only) | No | No | No | No (compliance) |
| P-12 DC/AC Hard Heal | MUTATION | **Yes** | No | No (uses P-05) | No | No (overrides lock) |
| P-13 Auto-Fill | MUTATION | No (BOS only) | No (deferred) | No | No | N/A (user action) |
| P-14 Auto-Fix All | MUTATION | **Yes** | No (deferred) | No | No | N/A (user action) |
| P-15 SLD Gen | COMPUTE | No | No | **Yes** | **Yes** | N/A |
| P-16 Plan-Set/Permit | COMPUTE | No | No | No | **Yes** | N/A |
| P-17 BOM Gen | COMPUTE | No | No | **Yes** | No | N/A |
| P-18 Proposal PDF | COMPUTE | No | No | No | No | N/A |

**Summary:** 10 mutation pipelines, 8 compute pipelines. 7 pipelines directly mutate `config.inverters`.

---

## 3. Source of Truth Map

### 3.1 panelCount

```
PRIMARY:  CAD Layout DB (layout.panels.length)
              |
              v
          resolveSystemPanelCount() [lib/system/panelCountSource.ts]
            Priority 1: CAD layout.panels.length
            Priority 2: layout.totalPanels
            Priority 3: SystemDefinition.layout.totalPanels
            Priority 4: config fallback (config.inverters sum)
              |
              v
          systemPanelCount (useMemo in page.tsx)
              |
              v
          -> sizeSystemFromBrand() input (P-05, P-06, P-03, P-04)
          -> Panel Count Fix Path trigger (P-03)

SECONDARY (server only):
          buildCanonical() uses layout.panels.length
          validatePipelineSync() compares layout vs engineeringReport

CONFLICTS:
  [WARN] config.inverters sum can diverge from CAD count (root cause of banner bug)
  [WARN] 1xN corrupt state: config shows 44, CAD shows 7 — different reads diverge
  [WARN] Proposal PDF (P-18) reads panelCount from request body — no live CAD reconciliation
```

### 3.2 inverter config (config.inverters[])

```
WRITES (in execution order on fresh page load):
  1. savedConfig deserialization (P-04) — DB/localStorage restore
  2. Corruption detector (P-04) — rebuilds if Nx1 or 1xN detected
  3. Smart Defaults (P-06) — once-only bootstrap if !defaultsApplied
  4. Panel Count Fix (P-03) — fixes if panelCount diverges from CAD
  5. Auto-Apply Watcher (P-07) — ongoing sync if sizingAutoApply=true

WRITES (user-triggered):
  6. addInverter / removeInverter / updateInverter (direct UI edits)
  7. applySizingRecommendation (P-08) — explicit apply
  8. Ecosystem Apply (P-09) — brand selection
  9. Auto-Fix All (P-14) — structural fix

METADATA (stringsPerInverter, modulesPerString):
  Must be kept in sync with strings[].length and strings[0].panelCount
  All write paths in P-03, P-04 now set these fields (v61.2 fix)
  P-06 (Smart Defaults) does NOT yet set these fields — see C-06

CONFLICTS:
  [WARN] Paths 1-5 can chain in rapid succession on first load
  [WARN] P-04 (corruption rebuild) can be undone by reconciliation step if metadata not updated
  [WARN] P-09 only updates inverterId, not strings[] — P-05 must run after to rebuild strings
```

### 3.3 strings (config.inverters[*].strings[])

```
PRIMARY BUILDERS:
  sizeSystemFromBrand() — brand-aware string distributor
    called by: P-03, P-04 (corruption detector), P-05, P-06, P-15, P-17
  applySizingRecommendation() — groups engine strings by inverterIndex
    called by: P-07, P-08, P-12

DISPLAY:
  STRING LAYOUT section   -> reads sizingRecommendation.strings (engine output, P-05)
  STRINGS/ARRAYS + banner -> reads sizingCurrentSnapshot <- config.inverters
  [CRITICAL] These two reads are from DIFFERENT SOURCES

STRING METADATA FIELDS:
  stringsPerInverter — must equal strings[].length
  modulesPerString   — must equal strings[0].panelCount
  These are informational/UI fields; actual values are in strings[]
```

### 3.4 topology

```
PRIMARY:  config.topologyType (string: 'STRING_INVERTER', 'MICROINVERTER', etc.)
          -> set by P-10 (user selection) or resolved from inverterId brand profile

DERIVED:  resolveTopology() in lib/topology-manager.ts
          Input: inverterId, optimizerId, rackingId, batteryId
          Returns: TopologyType, sldStages, bomStages, resolvedAccessories, complianceFlags

SERVER COPY:
  SLD route (P-15) derives topology from sizeSystemFromBrand() result
  Permit route (P-16) does NOT call topology manager — uses buildCanonical()
    which reads system.inverters[0].type directly

CONFLICTS:
  [WARN] Client config.topologyType can lag behind inverterId-inferred topology
  [WARN] SLD route re-derives topology independently — may differ from client if body is stale
  [WARN] buildCanonical() (P-16) uses its own inverter type resolution,
         independent of client topology manager
```

### 3.5 battery config

```
FIELDS:  batteryId, batteryBrand, batteryModel, batteryKwh, batteryCount, batteryEnabled

WRITES:
  Ecosystem Apply (P-09) — sets all fields from payload.selections.batteryId
  applySizingRecommendation (P-08) — clears/resets if no ecosystem battery
  Manual user selection — direct updateConfig()

GUARD:
  ecosystemBrand flag protects battery selection from being overwritten by
  auto-apply (P-07) and explicit apply (P-08)

CONFLICTS:
  [WARN] If ecosystemBrand is set but batteryEnabled=false, battery fields exist but engine ignores them
  [WARN] batteryKwh on config vs getBatteryById() can diverge if equipment DB changes
```

### 3.6 compliance inputs

```
SOURCE:  Fetched from DB project record + AHJ lookup + compliance API
WRITES:  handleAutoFill (P-13) writes structural/BOS compliance fields
         permit route reads compliance sub-object from request body

FIELDS:  windSpeed, snowLoad, exposureCategory, seismicSDC, state, ahj
         roofType, rafterSize, rafterSpacing, attachmentSpacing

CONFLICTS:
  [WARN] No automatic sync between DB compliance fields and config compliance fields
  [WARN] buildCanonical() reads from input.compliance.structural — if not provided,
         uses project-level defaults which may be stale
```

---

## 4. Conflict List

### CRITICAL (can produce wrong data in production)

---

**C-01 · STRING LAYOUT vs Banner Read from Different Sources**

- **Severity:** CRITICAL
- **Location:** `app/engineering/page.tsx` — STRING LAYOUT section vs banner comparison logic
- **Description:** STRING LAYOUT reads `sizingRecommendation.strings` (engine output, P-05). The banner "Config layout differs from Sizing Recommendation" and the STRINGS/ARRAYS section read `sizingCurrentSnapshot` which is derived from `config.inverters`. When `config.inverters` is in a corrupt state (1xN: 1 string x 44 panels), the banner shows "Current strings: 44" while STRING LAYOUT correctly shows 7 strings.
- **Root cause:** Two independent reads of the same logical concept from architecturally different sources.
- **Fix applied:** v61.2 — corruption detector + panel count fix path now detect and repair 1xN state, and update `stringsPerInverter`/`modulesPerString` metadata. Commits 7f4849a, c850961.
- **Residual risk:** Any future path that writes to `config.inverters` without setting `stringsPerInverter`/`modulesPerString` will re-introduce the divergence.

---

**C-02 · Reconciliation Step Runs Before Corruption Detector Can Stabilize**

- **Severity:** CRITICAL
- **Location:** `app/engineering/page.tsx` — hydration `useEffect` ordering
- **Description:** The `stringsPerInverter` reconciliation step runs on every render using `config.inverters`. If the corruption detector rebuilds 7 strings but leaves `stringsPerInverter = 1`, the reconciler immediately trims back to 1 string on the next render cycle, undoing the fix.
- **Root cause:** React `useEffect` ordering + shared mutable state — the reconciler has no awareness that the corruption detector just ran.
- **Fix applied:** All 5 hydration paths now set `stringsPerInverter = newStrings.length` atomically. Commit c850961.
- **Residual risk:** Any code path that modifies `strings[]` without updating `stringsPerInverter` will trigger the reconciler to undo the change silently.

---

**C-03 · sizeSystemFromBrand() Called with Potentially Stale Inputs in Multiple Contexts**

- **Severity:** HIGH
- **Location:** Called in 7+ distinct call sites: P-03, P-04, P-05, P-06, P-15 (SLD), P-17 (BOM), `lib/system/smartDefaults.ts`
- **Description:** Each call site passes different inputs. The UI call (P-05) uses the live `config` state. The SLD route (P-15) receives inputs from the request body, which may be serialized from a stale client state. If the user has a corrupt `config.inverters` and triggers SLD generation before the corruption detector fires, the SLD will be generated from corrupt state.
- **Root cause:** `sizeSystemFromBrand()` is stateless — it cannot cross-validate across call sites. Each caller is responsible for providing correct inputs.
- **Residual risk:** MEDIUM after v61.2 fixes, since the corruption detector fires on page load. SLD requests made before page load completes may still get stale state.

---

**C-04 · Topology Source of Truth Split Between Client and Server**

- **Severity:** HIGH
- **Location:** `lib/topology-manager.ts:resolveTopology()` vs `lib/permit/utils/canonical.ts:buildCanonical()` vs `lib/system/sizingEngine.ts`
- **Description:** Three independent topology resolution systems exist:
  1. Client `resolveTopology()` — driven by equipment registry, called by topology API (P-10)
  2. `sizeSystemFromBrand()` — derives topology from brand profile (used by SLD, BOM, UI sizing)
  3. `buildCanonical()` — reads `system.inverters[0].type` string directly from input (permit only)

  A project saved with `topologyType = 'MICROINVERTER'` that later has its inverter changed to a string inverter may have a stale `topologyType` on config while `sizeSystemFromBrand()` correctly identifies it as STRING_INVERTER. The SLD and permit routes each resolve topology independently, potentially producing different results.
- **Residual risk:** LOW for happy path, HIGH for brand-switch or topology-switch scenarios where DB serialization is stale.

---

**C-05 · Proposal PDF Reads panelCount from Request Body, Not CAD**

- **Severity:** MEDIUM
- **Location:** `POST /api/proposals/[id]/pdf` → `buildCanonicalProposal()`
- **Description:** The proposal PDF pipeline reads `panelCount` from `input.panelCount` (request body). If the client sends a stale count (e.g., from a corrupt `config.inverters`), the proposal will show the wrong panel count and system size. Unlike the permit pipeline (P-16), the proposal pipeline does NOT cross-validate against `layout.panels.length`.
- **Residual risk:** MEDIUM — proposal could show "44 panels" when CAD has 7. Mitigation: the client should always send `layout.totalPanels` as the canonical count.

---

**C-06 · Smart Defaults (P-06) Does Not Set stringsPerInverter/modulesPerString**

- **Severity:** MEDIUM
- **Location:** `app/engineering/page.tsx` ~line 2564 — Smart Defaults `setConfig` callback
- **Description:** The Smart Defaults path builds `hydratedInverters` but does NOT set `stringsPerInverter` or `modulesPerString` on the inverter objects. If the reconciliation step runs after Smart Defaults, it may see `stringsPerInverter` from the old config (e.g., 1) while `strings.length` is now 7, causing a trim.
- **Root cause:** v61.2 fix was applied to 5 hydration paths in P-03/P-04 but Smart Defaults was not updated.
- **Residual risk:** HIGH — this is an active gap. If `defaultsApplied` is false and Smart Defaults fires before the corruption detector, the reconciler may undo Smart Defaults output.

---

**C-07 · addInverter('micro') Does Not Set stringsPerInverter/modulesPerString**

- **Severity:** MEDIUM
- **Location:** `app/engineering/page.tsx:addInverter()` ~line 2776
- **Description:** The `addInverter('micro')` path creates a new `InverterConfig` with a `strings` array but does not set `stringsPerInverter` or `modulesPerString`. Subsequent reconciliation may override the string count.
- **Root cause:** Same missing metadata pattern — not updated in v61.2.
- **Residual risk:** LOW for micro (single string by design), but metadata inconsistency causes UI dropdown confusion.

---

**C-08 · Ecosystem Apply (P-09) Does Not Rebuild strings[]**

- **Severity:** MEDIUM
- **Location:** `app/engineering/page.tsx:onApply callback` ~line 7113
- **Description:** Ecosystem Apply only updates `inverterId` and `type` on `config.inverters[0]` — it does NOT rebuild the `strings[]` array. The expectation is that the sizing engine (P-05) will pick up the new `inverterId`, recalculate, and the auto-apply watcher (P-07) will propagate. However, if `userHasEditedInverters = true` (which Ecosystem Apply sets), the auto-apply watcher is blocked. The user must manually click "Apply Recommendation" to see the correct strings.
- **Root cause:** Intentional design — ecosystem locks `userHasEditedInverters`. But this means the `strings[]` can be stale until manual apply.
- **Residual risk:** LOW for UX (user sees recommendation banner), but HIGH for downstream consumers (BOM, SLD) that read `config.inverters[0].strings` directly before apply.

---

**C-09 · stringsPerInverter Reconciliation Has No Lower Bound Guard**

- **Severity:** MEDIUM
- **Location:** `app/engineering/page.tsx` — reconciliation useEffect
- **Description:** The reconciliation step that enforces `stringsPerInverter` against `strings.length` has no guard against trimming to 0. If `stringsPerInverter` is somehow 0 (e.g., from a corrupt savedConfig), the reconciler could eliminate all strings.
- **Residual risk:** LOW — requires `stringsPerInverter = 0` to be in DB, which is caught by corruption detector. But worth adding `Math.max(1, ...)` guard.

---

### LOW (cosmetic or edge-case)

**C-10 · Engineering Report panelCount Lags CAD Until Sync**

- **Severity:** LOW
- **Location:** `lib/engineering/syncPipeline.ts` — stale check
- **Description:** The engineering report is only rebuilt when `isStale()` returns true. If a user adds panels in Design Studio but does not reload the engineering page, the stale engineering report shows the old count. The banner in the UI correctly shows the CAD count (via `systemPanelCount`), but the server-side `engineeringReport.panelCount` lags.
- **Residual risk:** LOW — user-visible only as a brief stale state before page reload.

**C-11 · buildCanonical() Mutates input.layout.type In-Place**

- **Severity:** LOW
- **Location:** `lib/permit/utils/canonical.ts:buildCanonical()` ~line 128
- **Description:** `if (layout.type !== rawType) { (layout as any).type = rawType; }` — mutates the input object. In Next.js API routes this is fine (new request per call), but if the same layout object is ever reused within a request, subsequent code sees the mutated type.
- **Residual risk:** LOW — API routes create fresh objects per request. Violates pure-function principles but functionally safe.

---

## 5. Architecture Verdict

### Pipeline Statistics

| Metric | Value |
|--------|-------|
| Total pipelines identified | 18 |
| Mutation pipelines | 10 |
| Compute pipelines | 8 |
| Pipelines writing `config.inverters[]` | 7 |
| Pipelines calling `sizeSystemFromBrand()` | 7 |
| Pipelines calling `computeSystem()` | 2 (P-15, P-16) |
| Single authority for panelCount? | **Partial** — CAD is canonical, but 4-level fallback allows drift |
| Single authority for string layout? | **No** — 7 independent write paths |
| Single authority for electrical values? | **Yes** — `computeSystem()` in plan-set and SLD routes |
| Single authority for topology? | **No** — 3 independent resolvers |

### Architecture Assessment

The engineering module follows a **reactive pipeline architecture** with a React `useMemo` sizing engine at its core. This design is correct in principle: a pure compute function (`sizeSystemFromBrand`) driven by config state, with recommendation output displayed separately from current config.

**Strengths:**
- `computeSystem()` is cleanly isolated as the single authority for NEC electrical values (OCPD, wire gauge, string voltage) in both SLD and plan-set routes
- `buildCanonical()` throws on missing layout data rather than silently degrading — enforces correctness at permit time
- `resolveSystemPanelCount()` provides a clear priority chain (CAD > SystemDefinition > config fallback) with explicit logging
- The `userHasEditedInverters` intent lock correctly prevents auto-pipelines from overwriting manual user choices
- Corruption detector now catches both Nx1 and 1xN states (v61.2)

**Weaknesses:**
1. **No single authority for string layout** — 7 paths write `config.inverters[]` with no central coordinator. Each path must independently ensure `stringsPerInverter` + `modulesPerString` metadata consistency. This is a systemic brittleness: any future path that forgets these fields re-introduces the banner bug.

2. **`sizingCurrentSnapshot` and STRING LAYOUT read from architecturally different sources** — the current source of the banner divergence bug. Fixing individual paths is necessary but insufficient long-term; the architectural divergence remains.

3. **Topology has 3 independent resolvers** — `resolveTopology()` (client V4), `sizeSystemFromBrand()` (brand profile), and `buildCanonical()` (field scan). A topology switch in the client is NOT automatically propagated to the permit pipeline unless the serialized `system.inverters[0].type` field is updated.

4. **Smart Defaults (P-06) was not updated in the v61.2 metadata fix** — active gap identified in C-06.

### Recommended Architecture Improvements (Priority Order)

**P0 — Fix immediately:**
- Apply `stringsPerInverter`/`modulesPerString` metadata update to Smart Defaults path (C-06) and `addInverter` all branches (C-07).

**P1 — Near term:**
- Introduce a single `buildInverterConfig()` helper that ALL write paths must use when constructing `InverterConfig` objects. This helper enforces metadata consistency by construction, eliminating the "forgot to set stringsPerInverter" class of bugs entirely.
- Unify the string layout display source: both the banner and STRING LAYOUT should read from the same source.

**P2 — Medium term:**
- Consolidate topology resolution to a single function called by all contexts. The V4 `resolveTopology()` from `topology-manager.ts` is the best candidate; wrap it for use in `buildCanonical()` and `sizeSystemFromBrand()`.
- Add CAD panel count to the Proposal PDF pipeline (P-18) to prevent proposal/CAD drift.

---

## 6. Risk Assessment

### Risk Registry

| ID | Risk | Pipeline(s) | Likelihood | Impact | Overall | Status |
|----|------|-------------|-----------|--------|---------|--------|
| R-01 | Banner shows wrong string count (1xN corrupt state) | P-04, P-03 | LOW (fixed v61.2) | HIGH | **MEDIUM** | Fixed — commits 7f4849a, c850961 |
| R-02 | Metadata reconciler undoes corruption fix | P-04 | LOW (fixed v61.2) | HIGH | **MEDIUM** | Fixed — all 5 paths set metadata atomically |
| R-03 | Smart Defaults missing metadata update | P-06 | MEDIUM | MEDIUM | **MEDIUM** | OPEN — C-06 |
| R-04 | New string write path forgets metadata fields | Any | MEDIUM | MEDIUM | **MEDIUM** | OPEN — no structural enforcement |
| R-05 | SLD generated from stale/corrupt config.inverters | P-15 | LOW | HIGH | **MEDIUM** | Partially mitigated — corruption detector fires on page load |
| R-06 | Proposal PDF shows wrong panel count | P-18 | LOW | HIGH | **MEDIUM** | OPEN — C-05, no CAD cross-validation |
| R-07 | Ecosystem Apply leaves stale strings until manual apply | P-09 | MEDIUM | LOW | **LOW** | By design — user must click Apply Recommendation |
| R-08 | Topology split between client and permit pipeline | P-10, P-16 | LOW | HIGH | **MEDIUM** | Topology in serialized payload; risk at brand-switch boundary |
| R-09 | Engineering report panelCount lags CAD | P-02 | MEDIUM | LOW | **LOW** | Expected — replaced on next sync |
| R-10 | buildCanonical() in-place mutation of layout.type | P-16 | LOW | LOW | **LOW** | Cosmetic — API routes use fresh objects |
| R-11 | DC/AC hard-error auto-heal overrides user lock | P-12 | LOW | MEDIUM | **LOW** | Intentional safety valve — documented |
| R-12 | addInverter missing metadata | P-direct | LOW | LOW | **LOW** | Micro always 1 string — reconciler correct |

### Summary by Severity

| Level | Count | Items |
|-------|-------|-------|
| HIGH overall | 0 | — |
| MEDIUM overall | 6 | R-01, R-02, R-03, R-04, R-05, R-06, R-08 |
| LOW overall | 5 | R-07, R-09, R-10, R-11, R-12 |

### Open Action Items (P0 first)

| Priority | Ref | Action |
|----------|-----|--------|
| **P0** | C-06 | Update Smart Defaults `setConfig` to include `stringsPerInverter` + `modulesPerString` on every built inverter |
| **P0** | R-03 | Same as C-06 |
| **P1** | C-07 | Update `addInverter()` all branches to set `stringsPerInverter` + `modulesPerString` |
| **P1** | R-04 | Create `buildInverterConfig()` helper to enforce metadata by construction |
| **P2** | C-05 | Pass `layout.panels.length` (not body count) to proposal PDF pipeline |
| **P2** | C-04 | Unify topology resolution to single function across all call sites |

---

*Audit completed. All findings based on static code analysis of the dev branch as of commit c850961.*
*18 pipelines inventoried. 9 conflicts catalogued. 12 risks assessed.*