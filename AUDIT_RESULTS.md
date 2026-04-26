# BOM & Electrical Pipeline Audit — Session Results

## Commits This Session
| Commit | Description |
|--------|-------------|
| `a0aa847` | fix(bom): `csAcOcpdBom` locally defined — `csAcOcpd` was scoped to SLD callback, crashing fetchBOM |
| `31cd2f0` | fix(electrical): micro AC wire sizing (per-device→system-level current) + NaN VDrop guard + busbar UI |
| `30d1dc0` | fix(bom): micro structural quantities + NEC 705.12(B) 120% rule BOM warning |

---

## Bugs Found & Fixed

### BOM Crash: `csAcOcpd is not defined`
- **Root cause**: `csAcOcpd` defined inside SLD callback, referenced in fetchBOM callback
- **Fix**: Defined `csAcOcpdBom` locally in fetchBOM using same derivation logic

### E-AC-WIRE-FAIL / VDrop NaN% → #2/0 AWG
- **Root cause 1**: `autoSizeACWire` received `inv.acOutputCurrentMax=1.21A` (per-device) for micros — should use combined system current (44.25A for 36× IQ8+)
- **Root cause 2**: `calcVoltageDrop` returns NaN when wireLength=0 → `NaN <= 2.0 = false` → every gauge fails → hits #2/0 AWG fallback
- **Fix 1**: Compute `acBranchCurrentA = (invAcKw × 1000) / systemVoltage` for micro topology
- **Fix 2**: NaN guards in `calcVoltageDrop` + 4 call sites in `autoSizeACWire`

### BOM Structural: Micro Topology Zeros (Rails/End-Clamps = 0)
- **Root cause**: `stringCount=0` sent for micro (correct — no DC strings), but structural formulas use `strings` as row count proxy → `strings * 2 = 0` rails, `strings * 4 = 0` end clamps
- **Fix**: Compute `effectiveRows` in BOM engine: `rowCount ?? ceil(railSections/2) ?? ceil(modules/4)`
- **Impact**: 36-panel micro now correctly generates 18 rails, 36 end clamps, 54 mid clamps (9 rows × 2 rails, 9 rows × 4 ends, 27 interior modules × 2 clamps)

### BOM Backfeed: Silent 120% Rule Cap
- **Root cause**: When `BACKFED_BREAKER` violates NEC 705.12(B), BOM silently capped to `maxPVBreaker` with no user warning
- **Fix**: Added explicit `warnings.push(...)` when `requestedBreaker > maxPVBreaker` — guides user to SUPPLY_SIDE_TAP

---

## Audit Areas Verified Clean

| Component | Status | Notes |
|-----------|--------|-------|
| `evaluateQuantityFormulaV4` | ✅ Clean | Correctly handles all formula variables |
| `V4_OWNED_CATEGORIES` | ✅ Clean | Comprehensive, prevents all sizing engine duplicates |
| `perInverter` quantityRule in Stage 5 | ✅ Not an issue | Only used in inverter accessories, not racking — all racking entries use `perAttachment`/`formula`/`perSystem` |
| `nextStandardBreaker()` | ✅ Clean | Follows NEC 240.6(A) standard sizes correctly |
| `evaluateConditionBOM()` | ✅ Clean | Handles `roofType === shingle \|\| roofType === tile` correctly |
| AC wire run construction (computed-system.ts) | ✅ Clean | COMBINER_TO_DISCO_RUN correctly uses total system current |
| Interconnection alternatives UI | ✅ Clean | Displays all alternatives, "Apply Supply-Side Tap" button works |
| `formulaCtx.attachments` vs `input.attachmentCount` | ✅ Consistent | Stage 5 loop correctly uses `input.attachmentCount` directly for perAttachment rule |
| NEC 705.12(B) electrical calc | ✅ Clean | LOAD_SIDE, SUPPLY_SIDE_TAP, MAIN_BREAKER_DERATE, PANEL_UPGRADE all correct |
| `autoResolutions[]` pipeline | ✅ Clean | Flows from electrical calc → API → compliance → UI |
| TypeScript compilation | ✅ Clean | Zero errors after all changes |

---

## Real-World Accuracy Status

| Check | Before | After |
|-------|--------|-------|
| AC wire gauge for 36× IQ8+ micro | ❌ #2/0 AWG (NaN VDrop) | ✅ #4-#6 AWG (44.25A correct) |
| Roof rails for 36-panel micro | ❌ 0 rails, 0 end clamps | ✅ 18 rails, 36 end clamps |
| Backfeed breaker on 200A/200A panel | ❌ Silent 40A cap | ✅ 40A + clear NEC 705.12(B) warning |
| BOM tab crash | ❌ `csAcOcpd is not defined` | ✅ No crash |
| Busbar resolution UI | ❌ Missing | ✅ Alternatives panel with one-click Apply |