# SolarPro Permit Pipeline Error Hunt — Session 7 Handoff Document

## Quick Start for Next Thread

**Repository**: `rayobrian6/Solarpro`, branch `dev`  
**Push command**: `git push https://x-access-token:$GITHUB_TOKEN@github.com/rayobrian6/Solarpro.git dev`  
**Current state**: 37 files modified, ~506 insertions / ~269 deletions, NOT YET COMMITTED  
**Last commit on dev**: `42f149f8 fix(permit): eliminate (project as any) casts — add 27+ missing type fields, fix structural V4 hardcoded defaults, type _canonical injection`

**FIRST THING TO DO**: Commit all uncommitted changes to `dev` with a comprehensive message, then push. The next thread should verify the commit succeeded.

---

## Architecture Overview — Permit Data Pipeline

```
Frontend Design Studio
  ↓ (POST /api/engineering/permit with PermitInput body)
API Route: app/api/engineering/permit/route.ts
  ↓ Enriches body with survey data, AHJ lookup, compliance skeleton
  ↓ Calls: generatePermitHTML(input, storedSldSvg)
generatePermit.ts (orchestrator)
  ↓ 1. buildCanonical(input) → CanonicalInput (site/structure/electrical)
  ↓ 2. generateCADLayout(input) → CADModel (roof/ground/fence geometry)
  ↓ 3. Patches canonical from CAD results
  ↓ 4. Propagates CAD-derived values to input.system & input.project
  ↓ 5. Server-side structural V4 calc → input.compliance.structural
  ↓ 6. BOM generation → input.bom
  ↓ 7. Calls page renderer functions:
  ↓    pageCoverSheet(input, cad, pageNum, totalPages)
  ↓    pageNECCompliance(input, cad, pageNum, totalPages)
  ↓    pageConductorSchedule(input, cad, pageNum, totalPages)
  ↓    pageStructuralCalc(input, cad, pageNum, totalPages)
  ↓    pageSingleLineDiagram(input, cad, pageNum, totalPages)
  ↓    ... etc.
Permit Page Renderers (lib/permit/sections/*.ts)
  ↓ Read from input.project, input.system, input.compliance, cad
  ↓ Generate HTML for each permit sheet
  ↓ Return HTML strings
generatePermit.ts assembles all pages → generatePermitHTML() returns full HTML
  ↓
Route converts to PDF via wkhtmltopdf
```

### Key Type Files
- `lib/permit/types.ts` — `PermitInput` interface (the central data contract)
- `types/index.ts` — `SolarPanel`, `Inverter`, `Layout` shared types
- `lib/permit/utils/helpers.ts` — `necNextStandardOcpd()`, `NEC_STANDARD_OCPD`, `resolveEquipment()`
- `lib/computed-system.ts` — `RunSegment` interface, `computeSystem()` function
- `lib/electrical-calc.ts` — `runElectricalCalc()` function, `ElectricalCalcResult` interface

---

## Errors Found & Fixed (Sessions 3–7)

### Error 3: APN field not on PermitInput.project type
- **File**: `lib/permit/types.ts`
- **Fix**: Added `apn?: string` to project type; replaced `(project as any).apn` with `project.apn` in 5+ template files

### Error 4a: 27 missing fields on `PermitInput.project` type
- **Files**: `lib/permit/types.ts`, all `lib/permit/sections/*.ts`, `lib/permit/utils/*.ts`
- **Fix**: Added all missing fields; replaced all `(project as any).field` with typed `project.field` access

### Error 4b–4k: Various `as any` casts eliminated
- **Files**: types.ts, certPages.ts, sitePlan.ts, coverSheet.ts, compliancePages.ts, structuralPages.ts, drawing.ts, canonical.ts, helpers.ts, bomForPermit.ts
- **Fix**: Added fields to types, removed unnecessary casts

### Error 5: `as any` on canonical write-path and other type-safety issues
- **5a**: `(cad as any).arrayWidthFt` → proper CAD field access
- **5aa**: CAD-derived system values never propagated to `input.system`/`input.project` — `totalAcKw` always 0, `backfeedBreakerA` never set
- **5b**: `(strings[0] as any)?.ocpd` → `strings[0]?.ocpd` (field already declared)
- **5c**: `(inv0 as any)?.mpptChannels` → added `mpptChannels?: number` to inverter type
- **5d**: `compliance.electrical?: any` / `compliance.structural?: any` — STILL TYPED AS `any` (see pending errors)
- **5e**: `(canonical as any).*` mutations in generatePermit.ts → typed access after adding fields to CanonicalStructure/CanonicalElectrical
- **5f**: `(snap.panel as any).weight` → `snap.panel.weight` (already on SolarPanel)
- **5g**: `(panel as any).voc/.vmp/.isc/.imp` → added to SolarPanel type
- **5h**: `(inverter as any)?.maxDcVoltage/.mpptVoltageMax` → added to Inverter type
- **5i**: `(project.selectedPanel || DEFAULT_PANEL as any)` → DEFAULT_PANEL typed as SolarPanel
- **5j**: `(project as any).address/.clientId/.clientName` → typed access
- **5k**: `layout.type` not on Layout type → added `type?: string`
- **5l**: `(system as any)?.modules` → added `modules?: Array<...>` to system type
- **5n**: `isRoofPermitRequest()` used `as any` → typed field access
- **5p**: `apn`, `designer` accessed via `as any` in route → typed access
- **5q**: `_canonicalBuildingModel`, `canonicalBuildingModel` not on PermitInput → added
- **5r**: `compliance.structural/electrical` accessed via `as any` → typed access
- **5s**: `generateCADLayout(input as any)` → `input as PermitInputShape`
- **5t**: `seismicCategory`, `windSpeedMph`, `groundSnowPsf`, `windExposure` not propagated to project → added propagation
- **5x**: `planeId` not on panelPositions → added

### Error 6: NEC OCPD & busbar rule calculation errors
- **6a**: `batteryKwh = (project.batteryCount ?? 2) * (project.batteryKwh ?? 5.0)` — fabricates 2 batteries when undefined → fixed to only compute when `hasBattery`
- **6b**: `buildPermitCoverSheet.ts` used `Math.ceil()` for backfeedA instead of `necNextStandardOcpd()` → fixed
- **6c**: `segment-builder.ts` missing 45A in `STANDARD_OCPD` array → added
- **6d**: 120% busbar rule computed as `(svcAmps + backfeedA) <= svcAmps * 1.2` — WRONG. Correct NEC 705.12(B): `pvBackfeed <= (busRating * 1.2) - mainBreaker`. Fixed in both `coverSheet.ts` and `buildPermitCoverSheet.ts`

### Error 5bb: `Math.ceil(x*1.25/5)*5` → `necNextStandardOcpd(x*1.25)` across entire codebase
- **Files fixed**: `bomForPermit.ts` (4 instances), `buildPermitCoverSheet.ts`, `coverSheet.ts`, `bom-engine-v4.ts` (3 instances), `sld-professional-renderer.ts`, `evaluator.ts` (2 instances), `string-generator.ts`, `reportGenerator.ts` (2 instances), `generatePermit.ts`
- **Root cause**: `Math.ceil(x/5)*5` produces 55, 65, 75, 85, 95A — NOT standard NEC 240.6(A) sizes. The centralized `necNextStandardOcpd()` in `helpers.ts` correctly snaps to the actual NEC list: 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200

### Error 7b: `as any` casts on `RunSegment` in `bom-engine-v4.ts`
- **File**: `lib/bom-engine-v4.ts` lines 556–728
- **Root cause**: `RunSegment` interface (in `lib/computed-system.ts`) already declares `wireGauge`, `egcGauge`, `conductorCount`, `onewayLengthFt`, `conduitType`, `conduitSize`, `isUtilityOwned`, `id` — the `as any` casts were completely unnecessary
- **Fix**: Removed all `(r as any).field` → `r.field`, `(r: any)` → `r`, added `topologyType?: TopologyType` to `BOMGenerationInputV4` interface

### Error 7c: `batteryKwh` default in compliancePages.ts and sitePlan.ts
- **compliancePages.ts**: `(project.batteryCount || 0) * (project.batteryKwh || 0)` → `hasBattery ? ((project.batteryCount || 1) * (project.batteryKwh ?? 5.0)) : 0.0`
- **sitePlan.ts**: `(project.batteryKwh ?? 0)` → `(project.batteryKwh ?? 5.0)` — shows correct kWh when battery exists but `batteryKwh` per-unit is undefined

---

## PENDING ERRORS — Not Yet Fixed

### 🔴 ERROR 7d (MAJOR): `compliance.electrical` Data Flow Gap

**Severity**: Critical — electrical permit pages show "—" for all computed electrical fields

**Problem**: The permit pipeline NEVER calls `runElectricalCalc()` or `computeSystem()`. The `compliance.electrical` object is never populated by `generatePermit.ts`. The structural side has a server-side V4 computation block (lines ~270–350 in generatePermit.ts), but there is NO equivalent for electrical.

**What the pages read from `compliance.electrical` (all show "–" or defaults)**:
```typescript
elec.acConductorCallout     // e.g. "#10 AWG" — AC wire gauge callout
elec.acWireAmpacity         // AC wire ampacity rating
elec.acVoltageDrop          // AC voltage drop percentage
elec.busbar.backfeedBreakerRequired  // backfeed breaker amps
elec.busbar.passes          // 120% rule pass/fail
elec.conduitFill.conduitType / .conduitSize / .fillPercent / .passes  // conduit fill data
elec.dcConductorCallout     // DC wire gauge callout
elec.groundingConductor     // e.g. "#10 Copper"
elec.summary.totalDcKw / .totalAcKw  // system size summary
```

**The computation engine already exists**:
- `lib/electrical-calc.ts`: `runElectricalCalc(input: ElectricalCalcInput): ElectricalCalcResult` — computes ALL of the above
- `lib/computed-system.ts`: `computeSystem(input: ComputedSystemInput): ComputedSystem` — even more comprehensive, includes `runs: RunSegment[]`

**Where it IS called** (but not in permit pipeline):
- `app/api/engineering/calculate/route.ts` line 279: `electricalResult = runElectricalCalc(electricalInput)` — the Design Studio calculation route
- `app/api/engineering/plan-set/route.ts` — calls `computeSystem()` for the plan-set PDF

**Fix approach**: Add a server-side electrical computation block to `generatePermit.ts`, similar to the existing structural V4 block (~lines 270–350). The block should:
1. Check if `compliance.electrical` is already populated (from survey patch or frontend)
2. If not, construct `ElectricalCalcInput` from `input.system`, `input.project`, and CAD data
3. Call `runElectricalCalc()` 
4. Map the result to `compliance.electrical` shape expected by the page renderers
5. The mapping shape is defined by what `electricalPages.ts` reads (see field list above)

**Key interfaces to study**:
- `ElectricalCalcInput` in `lib/electrical-calc.ts` (lines ~200–248)
- `ElectricalCalcResult` in `lib/electrical-calc.ts` (lines ~318–340)
- `BusbarCalcResult`, `ConduitFillResult` in `lib/electrical-calc.ts`

**Watch out for**:
- The `ElectricalCalcInput` requires inverter details with `strings[]` containing `panelVoc`, `panelIsc`, `panelWatts`, `panelCount`
- The frontend may send partial inverter data (missing electrical specs) — need to backfill from equipment DB
- `compliance.electrical` is typed as `any` in `PermitInput` (Error 7e below) — should be properly typed first

---

### 🟡 ERROR 7e: `compliance.electrical?: any` and `compliance.structural?: any` Still Typed as `any`

**File**: `lib/permit/types.ts` lines ~222–224
```typescript
compliance: {
    overallStatus: string;
    jurisdiction?: { ... };
    electrical?: any;    // ← SHOULD BE PROPERLY TYPED
    structural?: any;    // ← SHOULD BE PROPERLY TYPED
};
```

**Impact**: No type-checking on any `compliance.electrical.*` or `compliance.structural.*` access. Typos and missing fields silently compile.

**Fix approach**: 
1. Define `ElectricalCompliance` interface based on what `electricalPages.ts`, `sldAdapter.ts`, and `bomForPermit.ts` actually read
2. Define `StructuralCompliance` interface based on what `structuralPages.ts`, `certPages.ts`, and `peLetter.ts` actually read
3. The `generatePermit.ts` structural V4 block (lines ~270–350) already shows the exact shape of `compliance.structural` — use it as the guide
4. Replace `any` with the new interfaces

**Electrical compliance fields read by permit pages** (from `compliance.electrical`):
```typescript
interface ElectricalCompliance {
  acConductorCallout?: string;     // "#10 AWG" — AC wire gauge
  dcConductorCallout?: string;     // "#10 AWG" — DC wire gauge
  acWireAmpacity?: number;         // AC wire ampacity
  acVoltageDrop?: number;          // AC voltage drop %
  groundingConductor?: string;     // "#10 Copper"
  busbar?: {
    backfeedBreakerRequired?: number;  // backfeed breaker amps
    passes?: boolean;                   // 120% rule pass/fail
    busbarRule?: '120%' | 'supply-side';
    busRating?: number;
    mainBreaker?: number;
    solarBreakerRequired?: number;
    maxAllowedSolarBreaker?: number;
    method?: string;
    message?: string;
    necReference?: string;
  };
  conduitFill?: {
    conduitType?: string;
    conduitSize?: string;
    fillPercent?: number;
    passes?: boolean;
  };
  summary?: {
    totalDcKw?: number;
    totalAcKw?: number;
    dcAcRatio?: number;
  };
}
```

**Structural compliance fields** (already well-defined by the V4 block in generatePermit.ts):
```typescript
interface StructuralCompliance {
  wind?: {
    windSpeed?: number;
    exposureCategory?: string;
    velocityPressure?: number;
    netUpliftPressure?: number;
    upliftPerAttachment?: number;
  };
  snow?: {
    groundSnowLoad?: number;
    roofSnowLoad?: number;
  };
  rafter?: {
    rafterSize?: string;
    rafterSpacing?: number;
    rafterSpan?: number;
    bendingMoment?: number;
    allowableBendingMoment?: number;
    utilizationRatio?: number;
    deflection?: number;
    allowableDeflection?: number;
    Fb_base?: number;
    Cd?: number; Cr?: number;
    Fb_prime?: number;
    totalLoadPsf?: number;
    lineLoad?: number;
  };
  attachment?: {
    safetyFactor?: number;
    lagBoltCapacity?: number;
    maxAllowedSpacing?: number;
    totalUpliftPerAttachment?: number;
  };
  seismic?: {
    sdc?: string;  // Seismic Design Category
  };
  totalDeadLoadPsf?: number;
  moduleLoadPsf?: number;
  rackingLoadPsf?: number;
}
```

---

### 🟡 Remaining `as any` Casts Outside Permit Pipeline (Lower Priority)

These are in non-permit code but follow the same silent-data-loss pattern:

1. **`lib/roofGeometry.ts` lines 565–566**: `(panel as any).manufacturer`, `(panel as any).model`, `(panel as any).id` — panel object missing these fields on its type
2. **`lib/pvwatts.ts` line 392**: `(panels[0] as any)?.wattage` — should be `panels[0]?.wattage` (already on type)
3. **`lib/computed-plan.ts` line 1039**: `electricalCalcInput: {} as any` — should be properly typed
4. **`lib/db/projects.ts` lines 327–332**: `(project as any).stateCode/.city/.county/.zip/.utilityName/.utilityRatePerKwh` — project type missing these fields
5. **`lib/drafting/templates/fence.ts` line 71**: `(cadFence?.segments as any[] | undefined) ?? (layout.fenceSegments as any[] | undefined)` — needs proper array typing
6. **`lib/drafting/templates/ground.ts` lines 72, 428**: `(layout.groundArrays as any[])` — needs proper array typing
7. **`lib/structural-engine-v2.ts` line 491**: `(p as any).rail ?? p.row` — position type missing `rail` field

---

### 🟡 Additional Patterns to Audit

1. **DC string OCPD in electricalPages.ts line ~170**: `str.isc ? Math.ceil(str.isc * 1.25 * 1.25) + 'A'` — this uses `Math.ceil()` rounding, NOT `necNextStandardOcpd()`. This could produce non-standard breaker sizes (e.g., 17A, 33A). Should use `necNextStandardOcpd(str.isc * 1.56)` (1.25 × 1.25 = 1.56 per NEC 690.8 + 690.9).

2. **`lib/segment-builder.ts`**: Has its own local `STANDARD_OCPD` array (fixed to include 45A in session 6). Verify it's consistent with `NEC_STANDARD_OCPD` in helpers.ts. Ideally should import the shared constant.

3. **`lib/bom-engine-v4.ts` `nextStandardBreaker()` function**: This is a separate function from `necNextStandardOcpd()`. Need to verify they produce identical results and consider consolidating.

4. **`lib/equipment-registry-v4.ts` default OCPD ranges**: The `defaultOCPDRanges` use min/max ranges (e.g., `{ acOutputOCPD: { min: 40, max: 50 } }`). These ranges should be validated against NEC 240.6(A) standard sizes — e.g., a range of `{ min: 40, max: 50 }` includes 45A which is correct, but verify none include non-standard sizes.

5. **Site plan API calls** (`lib/permit/sections/sitePlan.ts` lines 317, 334): `gcRes.json() as any` and `solarRes.json() as any` — external API responses typed as `any`. These could benefit from response type definitions, but are lower priority since they're external API responses.

---

## Files Modified (Sessions 5–7, Not Yet Committed)

### Core permit pipeline
| File | Changes |
|------|---------|
| `lib/permit/generatePermit.ts` | +145/-35: CAD→system value propagation, `as any` removal, structural V4 block, `necNextStandardOcpd` for backfeed calculation, seismic/wind propagation |
| `lib/permit/types.ts` | +36/-0: Added `mpptChannels`, `modules[]`, `planeId`, `roofPlanesSource`, `_canonicalBuildingModel`, `_canonicalCADBridge`, `projectId`, request mode fields, `placementType` |
| `lib/permit/utils/helpers.ts` | +13/-1: Added `NEC_STANDARD_OCPD` constant and `necNextStandardOcpd()` function, fixed `system?.modules` access |
| `lib/permit/utils/bomForPermit.ts` | +15/-5: 4× `Math.ceil(x*1.25/5)*5` → `necNextStandardOcpd(x*1.25)`, `compliance.electrical as any` → `compliance.electrical` |
| `lib/permit/utils/sldAdapter.ts` | +18/-10: `batteryKwh` fix, `ocpd` typed access, `dcConductorCallout` from compliance |
| `lib/permit/utils/canonical.ts` | +19/-10: All `(input.project as any)` → typed access, `layout.type` typed |
| `lib/permit/utils/peLetter.ts` | +2/-1: Minor `as any` removal |
| `lib/permit/buildPermitCoverSheet.ts` | +12/-5: `necNextStandardOcpd` for backfeedA, 120% busbar rule fix (mainBreaker + pvBackfeed <= busRating × 1.2) |
| `lib/permit/sections/coverSheet.ts` | +20/-8: `necNextStandardOcpd` for backfeedA, 120% busbar rule fix |
| `lib/permit/sections/electricalPages.ts` | +28/-12: `batteryKwh` fix (only when hasBattery), display text fix |
| `lib/permit/sections/compliancePages.ts` | +2/-1: `batteryKwh` default fix |
| `lib/permit/sections/sitePlan.ts` | +8/-2: `batteryKwh ?? 5.0` fallback |
| `lib/permit/sections/structuralPages.ts` | +5/-3: Minor `as any` removal |
| `lib/permit/sections/certPages.ts` | +2/-1: Minor `as any` removal |

### Engineering & calculation engines
| File | Changes |
|------|---------|
| `lib/engineering/reportGenerator.ts` | +23/-8: `voc/vmp/isc/imp` on SolarPanel, `maxDcVoltage/mpptVoltageMax` on Inverter, `necNextStandardOcpd` for dcOCPD |
| `lib/engineering/designSnapshot.ts` | +7/-2: DEFAULT_PANEL typed as SolarPanel |
| `lib/engineering/syncPipeline.ts` | +8/-2: `(project as any).address/.clientId/.clientName` → typed |
| `lib/engineering/artifactBuilders.ts` | +8/-2: Minor `as any` removals |
| `lib/engineeringDecisionProvenance/evaluator.ts` | +4/-2: 2× `Math.ceil(x*1.25/5)*5` → `necNextStandardOcpd(x*1.25)` |

### BOM & equipment
| File | Changes |
|------|---------|
| `lib/bom-engine-v4.ts` | +67/-20: All `(r as any)` on RunSegment → typed, `topologyType` added to interface, 3× `Math.ceil(x/5)*5` inside `nextStandardBreaker()` removed |
| `lib/string-generator.ts` | +2/-1: `Math.ceil(amps/5)*5` → `necNextStandardOcpd(amps)` |
| `lib/segment-builder.ts` | +2/-1: Added 45A to `STANDARD_OCPD` array |
| `lib/sld-professional-renderer.ts` | +2/-1: `Math.ceil(x*1.25/5)*5` → `necNextStandardOcpd(x*1.25)` |

### CAD & drafting
| File | Changes |
|------|---------|
| `lib/cad/types.ts` | +7/-0: Added fields for typed CAD model access |
| `lib/cad/cadEngine.ts` | +3/-1: `PermitInputShape` instead of `any` |
| `lib/cad/adapter.ts` | +21/-8: Typed field access |
| `lib/cad/roof/roofCAD.ts` | +16/-6: `as any` removals |
| `lib/cad/ground/groundCAD.ts` | +18/-5: `as any` removals |
| `lib/cad/fence/fenceCAD.ts` | +5/-2: `as any` removals |
| `lib/cad/mergeCADModels.ts` | +2/-1: Minor |
| `lib/drafting/types.ts` | +23/-0: Added fields |
| `lib/drafting/permitInputShape.ts` | +10/-0: Added index signatures |
| `lib/drafting/designIntent.ts` | +4/-2: Typed access |
| `lib/drafting/templates/fence.ts` | +12/-5: Typed access |
| `lib/drafting/templates/ground.ts` | +8/-3: Typed access |

### Shared types
| File | Changes |
|------|---------|
| `types/index.ts` | +14/-0: `voc/vmp/isc/imp` on SolarPanel, `maxDcVoltage/mpptVoltageMax` on Inverter, `type` on Layout |

### API route
| File | Changes |
|------|---------|
| `app/api/engineering/permit/route.ts` | +184/-80: All `as any` casts removed, typed compliance access, survey enrichment typed |

---

## Key Helper Function Reference

### `necNextStandardOcpd(amps: number): number`
**File**: `lib/permit/utils/helpers.ts`
**Purpose**: Returns the next standard NEC 240.6(A) OCPD rating ≥ the given ampere value.
**Standard sizes**: 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200
**Usage**: Replaces ALL `Math.ceil(x/5)*5` and `Math.ceil(x*1.25/5)*5` patterns which produced non-standard sizes.

### `NEC_STANDARD_OCPD` constant
**File**: `lib/permit/utils/helpers.ts`
```typescript
export const NEC_STANDARD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200] as const;
```

### `nextStandardBreaker()` in `lib/bom-engine-v4.ts`
Separate function that does the same thing as `necNextStandardOcpd()`. Should be audited for consistency and potentially consolidated.

### `STANDARD_OCPD` in `lib/segment-builder.ts`
Local array (now includes 45A after session 6 fix). Should be audited against `NEC_STANDARD_OCPD` for consistency.

---

## Verification Commands

```bash
# Check for remaining Math.ceil(x/5)*5 patterns (should be 0 in permit pipeline)
cd /workspace/Solarpro && grep -rn "Math\.ceil.*\/\s*5\s*\)\s*\*\s*5" lib/ --include="*.ts" | grep -v test | grep -v node_modules

# Check for remaining (x as any) in permit pipeline (should be only comments)
cd /workspace/Solarpro && grep -rn "as any" lib/permit/ --include="*.ts" | grep -v test | grep -v "// "

# Check for remaining (x as any) in bom-engine
cd /workspace/Solarpro && grep -n "as any" lib/bom-engine-v4.ts

# TypeScript compile check
cd /workspace/Solarpro && npx tsc --noEmit 2>&1 | head -30

# Check git status
cd /workspace/Solarpro && git diff --stat
```

---

## Search Strategy for Finding More Errors

1. **`as any` audit**: `grep -rn "as any" lib/ --include="*.ts" | grep -v test | grep -v node_modules | grep -v "// "` — Every `as any` is a potential silent-data-loss bug where a field exists on an object but isn't declared on its type

2. **Math.ceil/5*5 audit**: `grep -rn "Math\.ceil.*\/\s*5" lib/ --include="*.ts"` — Any remaining `Math.ceil(x/5)*5` pattern is a potential non-standard NEC OCPD rating

3. **Data flow gap audit**: For each permit page renderer, grep what fields it reads from `compliance.electrical`, `compliance.structural`, `project.*`, `system.*` — then trace back to verify those fields are actually populated by `generatePermit.ts` or the API route

4. **Default value audit**: `grep -rn "?? 0\||| 0\b" lib/permit/ --include="*.ts"` — Zero defaults can hide missing data. Should use `?? undefined` and show "—" on permit pages instead of "0"

5. **NEC formula audit**: Search for `1\.25` (continuous load factor), `1\.2` (busbar 120%), `1\.56` (DC OCPD = Isc × 1.25 × 1.25) — verify each usage matches the correct NEC article

6. **Battery data fabrication audit**: `grep -rn "batteryCount ?? [12]\|batteryKwh ?? [50]" lib/ --include="*.ts"` — Any `?? 2` or `?? 5` on battery fields fabricates battery data when it doesn't exist
