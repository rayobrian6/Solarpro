# Phase 1 Audit Report — Source of Truth Violations

## Architecture Summary

### Current Data Flow (BROKEN)
```
Engineering Page (UI)
  → Constructs BOM payload manually from config.*
  → Hardcodes fenceData/groundData from constants
  → Forces panelId based on systemType
  → POST /api/engineering/bom
  → generateBOMV4() (V4 engine)
    → STAGE 5b: deriveStructuralBOM() (structural inside electrical!)
  → Returns combined electrical+structural BOM

Permit System (CORRECT architecture, separate path)
  → generateCADLayout() → CADModel (with SystemDefinition attached)
  → cad.systemDefinition available
  → Uses canonical pipeline
  → Does NOT call BOM (BOM is engineering page only)
```

### Desired Data Flow (MASTER TASK)
```
Config → buildSystemDefinition() → SystemDefinition
Config → generateCADLayout() → CADModel (with SystemDefinition)
SystemDefinition + CADModel → buildBOM() → BOMResult (geometry/structural)
BOMGenerationInputV4 from SystemDefinition → generateBOMV4() → V4 BOM (electrical)
V4 BOM + Geometry BOM → mergeBOM() → MergedBOMResult (final)
```

---

## VIOLATION 1: BOM Selects Equipment (HARD FAIL)

**File:** `app/engineering/page.tsx` line 2228
```ts
panelId: config.systemType === 'fence' ? 'panel-fence-ps1' : (firstStr?.panelId || 'qcells-peak-duo-400')
```
- **Problem:** BOM pipeline forces panel selection based on systemType
- **Impact:** Overrides user's panel selection for ALL fence projects
- **Fix:** Remove forced override. If no panel selected, apply default ONCE at config level (non-destructive)

**File:** `app/engineering/page.tsx` line 758
```ts
if (!panelId) panelId = 'qcells-peak-duo-400';
```
- **Problem:** Hardcoded fallback panel in UI layer
- **Fix:** Default should come from SystemDefinition/resolver, not hardcoded in UI

---

## VIOLATION 2: UI Injects Defaults Directly into BOM

**File:** `app/engineering/page.tsx` lines 2289-2340
- UI constructs `fenceData` from hardcoded constants (postSpacingFt=8, postEmbedFt=3, panelWidthFt=3.28)
- UI constructs `groundData` from compliance + hardcoded values (pileSpacingFt=10, railsPerRow=2)
- **Problem:** These should come from CADModel geometry, not be re-derived in UI
- **Impact:** CAD solver output is IGNORED for BOM; UI invents its own geometry

**File:** `app/engineering/page.tsx` lines 1085-1138
- Wire run lengths derived from hardcoded formulas in UI
- References bom-unified.ts patterns but doesn't actually call it
- **Problem:** Duplicates bom-unified.ts deriveWiring() logic in UI layer

---

## VIOLATION 3: Structural Inside V4 Electrical Engine

**File:** `lib/bom-engine-v4.ts` lines 811-845 (STAGE 5b)
```ts
if (input.systemType && input.systemType !== 'roof') {
    const profileResult = deriveStructuralBOM({...});
    for (const si of profileResult.items) { items.push(...) }
}
```
- **Problem:** V4 engine should own ONLY electrical (inverters, wiring, conduit, breakers, labels)
- **Impact:** Structural items injected into V4 stages, no clean separation
- **Fix:** Remove STAGE 5b. Use mergeBOM() to combine V4 + geometry engines

---

## VIOLATION 4: Equipment Defined in 3+ Places

`panel-fence-ps1` exists in:
1. `lib/systemEquipmentResolver.ts` line 256 (canonical)
2. `lib/equipment-registry-v4.ts` line 241 (V4 registry duplicate)
3. `lib/db.ts` line 224 (DB seed duplicate)

Other duplications:
- `equipment-db.ts` has ~30 panels/inverters with different IDs than `equipment-registry-v4.ts`
- `systemEquipmentResolver.ts` defines racking specs independently

**Fix:** Single source per equipment type. V4 registry is needed for V4 engine's lookup; systemEquipmentResolver is for structural profiles. But panel-fence-ps1 in db.ts is pure duplication.

---

## VIOLATION 5: SystemDefinition Built But Not Used by BOM

- `buildSystemDefinition()` is called in CAD engine (line 108 of cadEngine.ts)
- `model.systemDefinition` is populated on CADModel
- BUT: Engineering page doesn't use CADModel at all for BOM
- Engineering page reads scattered `config.*` fields instead
- BOM API route receives raw fields, not SystemDefinition

**Impact:** SystemDefinition exists as intended single source of truth but is completely bypassed by the BOM pipeline.

---

## VIOLATION 6: Two Separate BOM Paths (Engineering vs Permit)

1. **Engineering page** → `POST /api/engineering/bom` → `generateBOMV4()` (V4 only, with STAGE 5b hack)
2. **Permit system** → `generateCADLayout()` → CADModel (has fence/ground geometry) but never calls BOM

The unified BOM engine (`buildBOM()`) and merge layer (`mergeBOM()`) are DEAD CODE — never called in production.

---

## EXISTING GOOD CODE (to leverage)

1. **`lib/bom-unified.ts`** — Well-architected, takes `{systemDefinition, cadModel}`, derives geometry BOM
2. **`lib/bom-merge.ts`** — Complete merge layer with V4-wins-electrical, geometry-wins-structural rules
3. **`lib/cad/cadEngine.ts`** — Already attaches SystemDefinition to CADModel
4. **`lib/system/systemDefinition.ts`** — Complete SystemDefinition builder

---

## ACTION PLAN (Phases 2-9)

### Phase 2: Remove forced overrides
- Remove `config.systemType === 'fence' ? 'panel-fence-ps1'` from line 2228
- Implement non-destructive default: `firstStr?.panelId || resolveDefaultPanel(config.systemType)`
- Add mismatch warning (not auto-change)

### Phase 3: Equipment consolidation
- Keep `panel-fence-ps1` in equipment-registry-v4.ts (V4 needs it for lookup)
- Keep `panel-fence-ps1` in systemEquipmentResolver.ts (structural resolver needs it)
- Remove from db.ts (pure duplication)
- Add comment linking the two remaining definitions

### Phase 4: BOM engine structure — THE BIG CHANGE
- Remove STAGE 5b from bom-engine-v4.ts
- Wire mergeBOM() into BOM API route:
  1. Run generateBOMV4() for electrical
  2. If systemType !== 'roof' AND cadModel available, run buildBOM() for geometry
  3. mergeBOM(v4Result, geometryResult) → final output
- Remove fenceData/groundData construction from engineering page
- Pass CAD-derived data through API instead

### Phase 5: Geometry derivation
- bom-system-profiles.ts → DELETE (replaced by bom-unified.ts which does the same thing properly)
- All structural quantities from CADModel geometry

### Phase 6: Wiring logic
- Tag all wire estimates with derivedFrom
- Remove hardcoded wire formulas from engineering page
- Let bom-unified.ts handle wiring estimation

### Phase 7: Config → SystemDefinition pipeline
- Engineering page: build SystemDefinition from config
- Pass SystemDefinition through BOM API (not raw config fields)

### Phase 8: Validation layer
- Panel-systemType compatibility check
- Inverter topology validation
- Structure-exists-for-systemType check

### Phase 9: Golden tests
- Fence, ground, roof BOM tests
- Cross-contamination tests