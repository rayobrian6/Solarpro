# Solar Platform Structural & Racking Engine Overhaul

## Phase 1: Array Geometry Engine
- [x] Create `lib/array-geometry.ts` — compute full array geometry from panel specs
- [x] Inputs: panel count, dimensions, orientation, rows, cols, spacing
- [x] Outputs: array W/H, rail lengths, rail count, clamp positions, cantilever

## Phase 2: Racking System Database
- [x] Create `lib/racking-database.ts` — comprehensive manufacturer database
- [x] Include: IronRidge, Unirac, Roof Tech, SnapNrack, QuickMount, S-5!, K2, EcoFasten, DPW, Schletter
- [x] Each system: rail dims, max span, mount spacing limits, fastener types, uplift capacity
- [x] Hardware components: rails, L-feet, tile hooks, clamps, splices, grounding lugs

## Phase 3: Structural Load Engine (V3)
- [x] Create `lib/structural-engine-v3.ts` — deterministic load engine
- [x] ASCE 7-22 wind loads (zones: interior/edge/corner)
- [x] Snow load with slope factor
- [x] Load path: modules → rails → mounts → fasteners → rafters
- [x] Mount spacing CALCULATED from loads (not user input)
- [x] Auto-resolve failures by adjusting spacing/count
- [x] NDS 2018 rafter checks: bending, deflection, shear
- [x] Auto-detect framing type: 24" OC → TRUSS, 16" OC → RAFTER

## Phase 4: Racking Material Calculator
- [x] Create `lib/racking-calculator.ts` — BOM quantities from geometry (integrated into V3)
- [x] Rail count, lengths, splices from array geometry
- [x] Mount count from calculated spacing
- [x] Mid/end clamp quantities
- [x] Grounding hardware

## Phase 5: API Route
- [x] Update `app/api/engineering/structural-v2/route.ts` to use V3 engine
- [x] Accept full panel geometry inputs
- [x] Return: geometry, loads, mount layout, racking BOM, rafter check

## Phase 6: UI Integration
- [x] Update Structural tab display
- [x] Update BOM tab with racking materials
- [x] Update System Config panel geometry inputs
- [x] Remove static attachment spacing — show calculated value

## Phase 7: Validation & Build
- [x] Test 34-panel, 2x6 rafter, 24" OC, 115mph, 20psf case → PASS (55% truss util, SF=1.69)
- [x] Run build — compiled clean in 11.6s, zero errors
- [x] Commit and push v24.10